// Интерфейс модели электропривода и квазистатическая модель-заглушка.
//
// Полноценная электромеханическая модель (уравнения машин, преобразователей,
// механики вала) должна реализовать тот же интерфейс DriveModel и быть
// зарегистрирована в sim/index.js. Всё, что модель получает, — контекст ctx:
//
//   ctx.dt          шаг времени, с
//   ctx.nl          нетлист: nl.netOf(nodeId) -> {nodes, sources}
//   ctx.bench       описание стенда
//   ctx.converters  {id: {powered, running, mode, ref (со знаком, в единицах режима),
//                         fieldRef (А), ramp (0..1 для ТПН)}}
//   ctx.contactors  {km1: bool, ...}
//
// Модель возвращает:
//   {
//     potentials: Map(net -> {re, im}) — потенциалы сетей (В, фаза-нейтраль),
//     meters:  {PV1: value, PA1: value, ...} — показания всех приборов стенда,
//     shaft:   {speed (об/мин), torque (Нм)},
//     motors:  {m1: {state:'run'|'stop'|'stall'|'runaway', note}},
//     currents:{m1: {field: A, arm: A}, ...},
//     pw:      {U, I, P} — показания анализатора сети,
//     events:  [{level, text}] — сообщения (защиты и т.п.)
//   }

export class DriveModel {
  constructor(bench) { this.bench = bench; }
  reset() {}
  // eslint-disable-next-line no-unused-vars
  step(ctx) { throw new Error('not implemented'); }
}

const SQRT3 = Math.sqrt(3);
const UPH = 220; // фазное напряжение сети, В
const ang = (deg) => ({ re: Math.cos(deg * Math.PI / 180), im: Math.sin(deg * Math.PI / 180) });
const PH_ANG = { A: 0, B: -120, C: 120, U: 0, V: -120, W: 120 };
const scale = (v, k) => ({ re: v.re * k, im: v.im * k });
const sub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
const mag = (v) => Math.hypot(v.re, v.im);
const lag = (cur, target, dt, tau) => cur + (target - cur) * Math.min(1, dt / tau);

/**
 * Квазистатическая модель: потенциалы сетей по источникам, показания
 * приборов по разности потенциалов, скорость вала — апериодическое звено,
 * токи — по грубым оценкам. Достаточно для отработки схем и защит.
 */
export class QuasiStaticModel extends DriveModel {
  constructor(bench) {
    super(bench);
    this.reset();
  }

  reset() {
    this.speed = 0;
    this.torque = 0;
    this.currents = {};
    this.uf = 0; // напряжение возбуждения ТП (ДПТ-стенд)
  }

  /** Потенциал сети по её источникам (первый источник главный). */
  netPotential(net, ctx) {
    if (!net || !net.sources.length) return null;
    const s = net.sources[0];
    if (s.kind === 'ac') return s.phase === 'N' ? { re: 0, im: 0 } : scale(ang(PH_ANG[s.phase]), UPH);
    if (s.kind === 'dc') return { re: s.pol === '+' ? 240 : 0, im: 0 };
    const cv = ctx.converters[s.dev];
    const conv = this.bench.converters.find(c => c.id === s.dev);
    if (!cv || !cv.running) return { re: 0, im: 0 };
    if (conv.kind === 'fc') {
      const f = this.fcFrequency(conv, cv);
      return scale(ang(PH_ANG[s.term]), UPH * Math.min(1, Math.abs(f) / 50));
    }
    if (conv.kind === 'ss') {
      return scale(ang(PH_ANG[s.term]), UPH * cv.ramp);
    }
    // ТП
    if (s.term === 'Я+' || s.term === '+') return { re: this.tpArmVoltage(conv, cv), im: 0 };
    if (s.term === 'В+') return { re: 220, im: 0 };
    return { re: 0, im: 0 };
  }

  fcFrequency(conv, cv) {
    const sync = this.bench.motors[0].nominal.speed; // синхронная скорость при 50 Гц
    if (cv.mode === 'f') return cv.ref;
    if (cv.mode === 'w') return cv.ref / sync * 50;
    return 50; // режим момента — частота «по скорости вала»
  }

  tpArmVoltage(conv, cv) {
    if (cv.mode === 'U') return cv.ref;
    if (cv.mode === 'w') return cv.ref / 2000 * 240;
    if (cv.mode === 'I') return Math.sign(cv.ref) * Math.min(240, 60 + Math.abs(cv.ref) * 4);
    return 0;
  }

  step(ctx) {
    const { bench, nl, dt } = ctx;
    const pot = new Map();
    for (const net of nl.nets) {
      const p = this.netPotential(net, ctx);
      if (p) pot.set(net, p);
    }
    const V = (a, b) => {
      const pa = pot.get(nl.netOf(a)), pb = pot.get(nl.netOf(b));
      if (!pa && !pb) return 0;
      return mag(sub(pa || { re: 0, im: 0 }, pb || { re: 0, im: 0 }));
    };
    const Vdc = (a, b) => {
      const pa = pot.get(nl.netOf(a)), pb = pot.get(nl.netOf(b));
      if (!pa && !pb) return 0;
      return (pa?.re ?? 0) - (pb?.re ?? 0);
    };
    const events = [];
    const motors = {};
    const currents = {};

    // --- механика: кто задаёт скорость, кто момент ---
    let speedTarget = null; // об/мин
    let torqueTarget = 0;   // Нм
    let anyEnergized = false;

    for (const m of bench.motors) {
      const st = { state: 'stop', note: '' };
      const cur = {};
      if (m.kind === 'dc') {
        const [fp, fn] = m.windings.field;
        const [ap, an] = m.windings.arm;
        const uf = Math.abs(Vdc(fp, fn));
        const ua = Vdc(ap, an);
        const hasField = uf > 50;
        const hasArm = Math.abs(ua) > 5;
        cur.field = hasField ? 1.0 * uf / 220 : 0;
        if (hasArm) {
          anyEnergized = true;
          if (hasField) {
            const drv = this.tpDrive(ctx, ap, an);
            if (drv && drv.mode === 'w') speedTarget = drv.ref;
            else if (drv && drv.mode === 'I') { torqueTarget = drv.ref * 0.9; speedTarget = Math.sign(drv.ref) * 1800; }
            else speedTarget = ua / 240 * 2000;
            st.state = 'run';
          } else {
            // без возбуждения — разнос
            speedTarget = Math.sign(ua) * 3200;
            st.state = 'runaway';
            st.note = 'нет тока возбуждения';
          }
        } else if (hasField) st.note = 'возбуждение подано';
        currents[m.id] = cur;
      } else if (m.kind === 'pmsm') {
        const [a, b, c] = m.windings.stator;
        const drv = this.acSource(ctx, [a, b, c]);
        if (drv && drv.kind === 'conv') {
          anyEnergized = true;
          const cv = ctx.converters[drv.dev];
          if (cv.mode === 'M') torqueTarget = -cv.ref;
          else speedTarget = speedTarget ?? cv.ref;
          st.state = 'run';
        } else if (drv && drv.kind === 'mains') {
          st.state = 'stall'; st.note = 'СДПМ подключён к сети напрямую';
          anyEnergized = true;
        }
      } else if (m.kind === 'im-wound' || m.kind === 'im-cage') {
        const sync = m.nominal.speed;
        const st3 = m.windings.stator;
        const drv = this.acSource(ctx, st3);
        let closed = true, rotorNote = '';
        if (m.kind === 'im-cage') {
          const en = m.windings.ends.map(n => nl.netOf(n));
          const sn = st3.map(n => nl.netOf(n));
          const star = en.every(n => n === en[0]);
          const delta = en.every(n => sn.includes(n)) && new Set(en).size === 3;
          closed = star || delta;
          rotorNote = closed ? (star ? 'звезда' : 'треугольник') : 'концы X,Y,Z не соединены';
        } else {
          const rn = m.windings.rotor.map(n => nl.netOf(n));
          const shorted = rn.every(n => n === rn[0]);
          const viaR = !shorted && rn.every(n => n.nodes.some(id => bench.resistors.some(r => r.a === id || r.b === id)));
          closed = shorted || viaR;
          rotorNote = shorted ? 'ротор замкнут' : viaR ? 'ротор через резисторы' : 'ротор разомкнут';
        }
        if (drv) {
          anyEnergized = true;
          st.note = rotorNote;
          if (!closed) { st.state = 'stall'; }
          else if (drv.kind === 'mains') {
            speedTarget = speedTarget ?? sync * (rotorNote === 'ротор через резисторы' ? 0.9 : 0.96);
            st.state = 'run';
          } else {
            const cv = ctx.converters[drv.dev];
            const conv = bench.converters.find(c => c.id === drv.dev);
            if (conv.kind === 'ss') speedTarget = speedTarget ?? sync * 0.96 * cv.ramp;
            else if (cv.mode === 'M') torqueTarget = -cv.ref;
            else if (cv.mode === 'f') speedTarget = speedTarget ?? sync * cv.ref / 50 * 0.97;
            else speedTarget = speedTarget ?? cv.ref;
            st.state = 'run';
          }
        } else if (closed === false && m.kind === 'im-cage') st.note = '';
        currents[m.id] = cur;
      }
      motors[m.id] = st;
    }

    // --- вал ---
    let target = speedTarget ?? 0;
    if (speedTarget === null && torqueTarget !== 0) target = Math.sign(torqueTarget) * 300; // момент без регулятора скорости — вал «уплывает»
    this.speed = lag(this.speed, target, dt, anyEnergized ? 0.8 : 1.5);
    if (Math.abs(this.speed) < 1) this.speed = 0;
    const friction = 0.0005 * this.speed;
    this.torque = lag(this.torque, torqueTarget !== 0 ? torqueTarget : friction, dt, 0.4);

    // --- токи по грубым оценкам ---
    for (const m of bench.motors) {
      const st = motors[m.id];
      const cur = currents[m.id] || (currents[m.id] = {});
      const inom = m.nominal.current || 20;
      if (m.kind === 'dc') {
        const base = st.state === 'run' ? 2 + Math.abs(this.torque) * 1.0 : st.state === 'runaway' ? 8 : 0;
        cur.arm = Math.sign(Vdc(...m.windings.arm) || 1) * base;
      } else {
        const stall = st.state === 'stall';
        cur.stator = stall ? inom * 3 : st.state === 'run' ? 0.3 * inom + Math.abs(this.torque) / 55 * inom : 0;
        if (m.kind === 'im-wound') cur.rotor = cur.stator * 0.8;
      }
    }

    // --- показания приборов ---
    const meters = {};
    for (const mt of bench.meters) {
      if (mt.kind === 'V') {
        const raw = mt.min < 0 ? Vdc(mt.across[0], mt.across[1]) : V(mt.across[0], mt.across[1]);
        meters[mt.id] = raw;
      } else if (mt.kind === 'A') {
        meters[mt.id] = currents[mt.series.motor]?.[mt.series.winding] ?? 0;
      } else if (mt.kind === 'n') meters[mt.id] = this.speed;
      else if (mt.kind === 'M') meters[mt.id] = this.torque;
      else if (mt.kind === 'PW') {
        const [a, b, c] = mt.in;
        const u = (V(a, b) + V(b, c) + V(c, a)) / 3;
        const I = u > 0 ? Object.values(currents).reduce((s, x) => s + (x.stator || 0), 0) : 0;
        meters[mt.id] = { U: u, I, P: u * I * SQRT3 * 0.85 / 1000 };
      }
    }

    // --- защиты ---
    if (bench.protections.overspeed && Math.abs(this.speed) > bench.protections.overspeed) {
      events.push({ level: 'trip', text: `Защита: частота вращения ${Math.round(Math.abs(this.speed))} об/мин превысила ${bench.protections.overspeed} об/мин` });
    }
    const dcm = bench.motors.find(m => m.kind === 'dc');
    if (bench.protections.overcurrent && dcm && Math.abs(currents[dcm.id]?.arm || 0) > bench.protections.overcurrent) {
      events.push({ level: 'trip', text: `Максимально-токовая защита: ток якоря превысил ${bench.protections.overcurrent} А` });
    }

    return { potentials: pot, meters, shaft: { speed: this.speed, torque: this.torque }, motors, currents, events };
  }

  /** Источник трёхфазного питания на трёх клеммниках: сеть, преобразователь или ничего. */
  acSource(ctx, ids) {
    const nets = ids.map(id => ctx.nl.netOf(id));
    const srcs = nets.map(n => n.sources[0]).filter(Boolean);
    if (srcs.length < 3) return null;
    if (srcs.every(s => s.kind === 'ac' && s.phase !== 'N')) {
      return new Set(srcs.map(s => s.phase)).size === 3 ? { kind: 'mains' } : null;
    }
    if (srcs.every(s => s.kind === 'conv' && s.dev === srcs[0].dev)) {
      const cv = ctx.converters[srcs[0].dev];
      return cv && cv.running && new Set(srcs.map(s => s.term)).size === 3 ? { kind: 'conv', dev: srcs[0].dev } : null;
    }
    return null;
  }

  /** Питается ли якорь от работающего ТП. */
  tpDrive(ctx, ap, an) {
    const s = ctx.nl.netOf(ap).sources[0], t = ctx.nl.netOf(an).sources[0];
    for (const s0 of [s, t]) {
      if (s0 && s0.kind === 'conv') {
        const conv = this.bench.converters.find(c => c.id === s0.dev);
        if (conv.kind === 'dc' && ctx.converters[conv.id].running) return ctx.converters[conv.id];
      }
    }
    return null;
  }
}
