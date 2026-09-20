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
//     motors:  {m1: {state:'run'|'stop'|'stall'|'brake'|'runaway', note}},
//     currents:{m1: {field: A, arm: A}, ...},
//     conv:    {tp: {I}} — ток выхода ТП, А,
//     pw:      {U, I, P} — показания анализатора сети,
//     events:  [{level, text}] — сообщения: 'trip' — общая защита стенда,
//              'fault' (+dev, fault) — авария преобразователя, 'warn'/'info' — в журнал
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
const fmt = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');
// параметры АД (переопределяются в bench.motors[].im):
// r1 — сопротивление фазы статора, Ом; r2 — ротора (приведённое), Ом;
// xm — сопротивление намагничивания, Ом; xk — индуктивное сопротивление КЗ (x1 + x2'), Ом;
// mcr — критический момент двигательной характеристики при номинальном напряжении, Нм;
// mk — максимальный тормозной момент при динамическом торможении и I_экв = Iном, Нм
const IM_DEFAULTS = { r1: 0.5, r2: 0.3, xm: 15, xk: 2, mcr: 60, mk: 40 };
// механика вала двухмашинного агрегата
const J_SHAFT = 0.4;                  // суммарный момент инерции, кг·м²
const RPM_PER_NM = 60 / (2 * Math.PI) / J_SHAFT; // ускорение, (об/мин)/с на 1 Нм
const friction = (w) => 3 * Math.tanh(w / 30) + 0.004 * w; // трение + вентиляция, Нм
const REGEN_W = 150;                  // порог генераторной мощности ПЧ, Вт
const REGEN_T = 0.5;                  // время до перенапряжения звена ПТ без тормозного резистора, с

/**
 * Момент АД по упрощённой формуле Клосса (r1 ≈ 0): M = 2·Mк·s·sк / (s² + sк²).
 * im = {w0 — синхронная скорость со знаком направления, об/мин; sk — критическое
 * скольжение (r2 + Rдоб)/xк; mk — критический момент при данном напряжении}.
 */
const kloss = (im, w) => {
  const s = (im.w0 - w) / im.w0;
  return Math.sign(im.w0) * 2 * im.mk * s * im.sk / (s * s + im.sk * im.sk);
};

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
    this.regen = {};   // время генераторного режима ПЧ без тормозного резистора, по преобразователям
    this.stalled = {}; // АД, опрокинутые моментом нагрузки (для однократного сообщения)
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
    return Math.max(3, Math.abs(this.speed) / sync * 50); // режим момента — частота по скорости вала
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
    const convI = {}; // ток выхода ТП по преобразователям, А

    // --- механика: кто задаёт скорость, кто момент ---
    // speedTarget — «жёсткий» источник скорости (замкнутый контур ПЧ/ТП);
    // torqueTarget — момент, приложенный к валу источником момента (режим M / I);
    // ims — АД на естественной/искусственной характеристике (сеть, ТПН, ПЧ в режиме f):
    //       момент зависит от скорости вала по формуле Клосса;
    // brakes — АД в динамическом торможении.
    let speedTarget = null; // об/мин
    let torqueTarget = 0;   // Нм
    let anyEnergized = false;
    const brakes = [];      // {id, mk, wk, ieq}
    const ims = [];         // {id, w0, sk, mk, u}
    let fcDrive = null;     // чем ПЧ нагружает вал: {dev, kind:'torque'|'speed'|'im', im}

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
          if (cv.mode === 'M') { torqueTarget = -cv.ref; fcDrive = { dev: drv.dev, kind: 'torque' }; }
          else { speedTarget = speedTarget ?? cv.ref; fcDrive = { dev: drv.dev, kind: 'speed' }; }
          st.state = 'run';
        } else if (drv && drv.kind === 'mains') {
          st.state = 'stall'; st.note = 'СДПМ подключён к сети напрямую';
          anyEnergized = true;
        }
      } else if (m.kind === 'im-wound' || m.kind === 'im-cage') {
        const sync = m.nominal.speed;
        const inom = m.nominal.current || 20;
        const name = m.title.split(' — ')[0];
        const P = { ...IM_DEFAULTS, ...(m.im || {}) };
        const st3 = m.windings.stator;
        const drv = this.acSource(ctx, st3);
        let closed = true, rotorNote = '', rExt = 0;
        if (m.kind === 'im-cage') {
          const en = m.windings.ends.map(n => nl.netOf(n));
          const sn = st3.map(n => nl.netOf(n));
          const star = en.every(n => n === en[0]);
          const delta = en.every(n => sn.includes(n)) && new Set(en).size === 3;
          closed = star || delta;
          rotorNote = closed ? (star ? 'звезда' : 'треугольник') : 'концы X,Y,Z не соединены';
        } else {
          rExt = this.rotorExtR(ctx, m.windings.rotor);
          closed = rExt !== null;
          rotorNote = !closed ? 'ротор разомкнут' : rExt < 0.05 ? 'ротор замкнут' : `ротор через ${fmt(rExt)} Ом`;
          if (!closed) rExt = 0;
        }
        if (drv) {
          anyEnergized = true;
          st.note = rotorNote;
          // критическое скольжение растёт с добавочным сопротивлением ротора:
          // sк = (r2 + Rдоб)/xк, критический момент от Rдоб не зависит
          const im = { id: m.id, w0: sync, sk: (P.r2 + rExt) / P.xk, mk: P.mcr, u: 1 };
          if (!closed) { st.state = 'stall'; }
          else if (drv.kind === 'mains') {
            ims.push(im);
            st.state = 'run';
          } else {
            const cv = ctx.converters[drv.dev];
            const conv = bench.converters.find(c => c.id === drv.dev);
            if (conv.kind === 'ss') {
              // пониженное напряжение: критический момент ∝ U²
              im.u = cv.ramp; im.mk = P.mcr * cv.ramp * cv.ramp;
              ims.push(im);
            } else if (cv.mode === 'M') { torqueTarget = -cv.ref; fcDrive = { dev: drv.dev, kind: 'torque' }; }
            else if (cv.mode === 'f') {
              // скалярное управление U/f: синхронная скорость по частоте, выше 50 Гц — ослабление поля
              const f = cv.ref;
              if (Math.abs(f) >= 1) {
                im.w0 = sync * f / 50;
                im.u = Math.min(1, Math.abs(f) / 50);
                im.mk = P.mcr * Math.min(1, (50 / Math.abs(f)) ** 2);
                ims.push(im);
                fcDrive = { dev: drv.dev, kind: 'im', im };
              } else st.note += ', f = 0';
            } else { speedTarget = speedTarget ?? cv.ref; fcDrive = { dev: drv.dev, kind: 'speed' }; }
            st.state = 'run';
          }
        } else {
          // динамическое торможение: постоянный ток от ТП в двух (трёх) фазах статора
          const dc = this.dcSource(ctx, st3);
          if (dc) {
            anyEnergized = true;
            const idc = Math.abs(dc.u) / ((dc.parallel ? 1.5 : 2) * P.r1);
            cur.stator = idc;
            cur.dc = true;
            convI[dc.dev] = (convI[dc.dev] || 0) + idc;
            if (!closed) {
              st.state = 'stall';
              st.note = `постоянный ток ${fmt(idc)} А в статоре, ${rotorNote} — момента нет`;
            } else {
              // эквивалентный переменный ток по МДС; момент ~ I², с учётом насыщения
              const ieq = idc * (dc.parallel ? Math.SQRT1_2 : Math.sqrt(2 / 3));
              const k = Math.min(ieq / inom, 1.5);
              const mk = P.mk * k * k;
              const wk = sync * (P.r2 + rExt) / P.xm;
              brakes.push({ id: m.id, mk, wk, ieq });
              st.state = 'brake';
              st.note = `I = ${fmt(idc)} А, ${rotorNote}, ωк ≈ ${Math.round(wk)} об/мин`;
            }
            if (idc > 1.5 * inom) events.push({ level: 'warn', text: `${name}: постоянный ток статора больше 1,5·Iном — перегрев обмотки, снизьте задание ТП` });
          } else if (closed === false && m.kind === 'im-cage') st.note = '';
        }
        currents[m.id] = cur;
      }
      motors[m.id] = st;
    }

    // --- вал ---
    // суммарный тормозной момент АД в динамическом торможении при скорости w
    const brakeM = (w) => brakes.reduce((sum, b) => { const x = Math.abs(w) / b.wk; return sum + 2 * b.mk * x / (1 + x * x); }, 0);
    // момент всех АД на характеристиках при скорости w
    const imTorque = (w) => ims.reduce((sum, im) => sum + kloss(im, w), 0);
    // всё, что действует на вал, кроме источников момента
    const passive = (w) => imTorque(w) - Math.sign(w) * brakeM(w) - friction(w);
    const shaftTorque = (w) => passive(w) + torqueTarget;
    if (speedTarget !== null) {
      // жёсткий источник скорости (замкнутый контур): вал следует за заданием
      this.speed = lag(this.speed, speedTarget, dt, anyEnergized ? 0.8 : 1.5);
    } else {
      // J·dω/dt = ΣM: неявный шаг Эйлера с линеаризацией — устойчив на крутых участках
      // характеристик. Момент без нагрузки разгоняет вал до срабатывания защиты по скорости.
      const w = this.speed;
      const F = shaftTorque(w);
      const dF = (shaftTorque(w + 1) - shaftTorque(w - 1)) / 2;
      this.speed = w + dt * F * RPM_PER_NM / (1 - dt * Math.min(0, dF) * RPM_PER_NM);
    }
    if (Math.abs(this.speed) < 1) this.speed = 0;
    // показание датчика момента: момент в муфте, положительный — когда нагрузочная
    // машина (вторая в агрегате) крутит испытуемую (первую)
    const idA = bench.motors[0].id;
    const imA = ims.find(im => im.id === idA), imB = ims.find(im => im.id !== idA);
    let dispTorque = torqueTarget;
    if (dispTorque === 0 && imA) dispTorque = -kloss(imA, this.speed);
    else if (dispTorque === 0 && imB) dispTorque = kloss(imB, this.speed);
    else if (dispTorque === 0 && brakes.length) dispTorque = Math.sign(this.speed) * brakeM(this.speed);
    else if (dispTorque === 0) dispTorque = 0.0005 * this.speed;
    this.torque = lag(this.torque, dispTorque, dt, 0.4);

    // состояние АД на характеристиках: скольжение, опрокидывание
    for (const im of ims) {
      const st = motors[im.id];
      const name = bench.motors.find(x => x.id === im.id).title.split(' — ')[0];
      const sl = (im.w0 - this.speed) / im.w0;
      const stalled = Math.abs(this.speed) < 0.1 * Math.abs(im.w0) && shaftTorque(this.speed) * Math.sign(im.w0) <= 0;
      if (stalled) {
        st.state = 'stall';
        st.note += ', момент нагрузки больше критического — опрокидывание';
        if (!this.stalled[im.id]) events.push({ level: 'warn', text: `${name}: опрокидывание — момент нагрузки больше критического (Mк = ${Math.round(im.mk)} Нм), ток статора недопустимо велик` });
      } else st.note += `, s = ${Math.round(sl * 100)} %${sl < -0.005 ? ' (генераторный режим)' : sl > 1 ? ' (противовключение)' : ''}`;
      this.stalled[im.id] = stalled;
    }
    for (const id of Object.keys(this.stalled)) if (!ims.some(im => im.id === id)) this.stalled[id] = false;

    // рекуперация: генераторный режим ПЧ без тормозного резистора на Br+/Br− — перенапряжение звена ПТ
    if (fcDrive) {
      const conv = bench.converters.find(c => c.id === fcDrive.dev);
      let mFc; // момент машины, питаемой от ПЧ, на валу
      if (fcDrive.kind === 'torque') mFc = torqueTarget;
      else if (fcDrive.kind === 'im') mFc = kloss(fcDrive.im, this.speed);
      else mFc = -passive(this.speed);
      const pMech = mFc * this.speed * 2 * Math.PI / 60;
      if (conv.brake && pMech < -REGEN_W) {
        const [bp, bn] = conv.brake;
        const shorted = nl.same(bp, bn);
        const hasR = !shorted && (bench.resistors || []).some(r => (nl.same(bp, r.a) && nl.same(bn, r.b)) || (nl.same(bp, r.b) && nl.same(bn, r.a)));
        if (shorted) events.push({ level: 'fault', dev: conv.id, fault: 'КЗ ТОРМОЗНОГО КЛЮЧА', text: 'ПЧ: выводы Br+ и Br− замкнуты накоротко — при рекуперации сгорел тормозной ключ' });
        else if (!hasR) {
          this.regen[conv.id] = (this.regen[conv.id] || 0) + dt;
          if (this.regen[conv.id] >= REGEN_T) events.push({ level: 'fault', dev: conv.id, fault: 'ПЕРЕНАПРЯЖЕНИЕ ЗПТ', text: `ПЧ: перенапряжение звена постоянного тока — рекуперация ${Math.round(-pMech)} Вт без тормозного резистора на Br+/Br−` });
        } else this.regen[conv.id] = 0;
      } else this.regen[conv.id] = 0;
    }

    // --- токи по грубым оценкам ---
    for (const m of bench.motors) {
      const st = motors[m.id];
      const cur = currents[m.id] || (currents[m.id] = {});
      const inom = m.nominal.current || 20;
      if (m.kind === 'dc') {
        const base = st.state === 'run' ? 2 + Math.abs(this.torque) * 1.0 : st.state === 'runaway' ? 8 : 0;
        cur.arm = Math.sign(Vdc(...m.windings.arm) || 1) * base;
        const dev = this.tpDev(ctx, ...m.windings.arm);
        if (dev) convI[dev] = (convI[dev] || 0) + Math.abs(cur.arm);
      } else if (cur.dc) {
        // динамическое торможение: ток статора задан ТП, ток ротора растёт со скоростью
        const b = brakes.find(b => b.id === m.id);
        const x = b ? Math.abs(this.speed) / b.wk : 0;
        if (m.kind === 'im-wound') cur.rotor = b ? b.ieq * x / Math.sqrt(1 + x * x) : 0;
      } else {
        const im = ims.find(im => im.id === m.id);
        if (im) {
          // ток ротора по Г-образной схеме: I2 = I2к·s/√(s² + sк²), I2к — пусковой при Rдоб = 0;
          // ток статора — геометрическая сумма с намагничивающим
          const sl = (im.w0 - this.speed) / im.w0;
          const i2 = 4 * inom * im.u * Math.abs(sl) / Math.hypot(sl, im.sk);
          const i0 = 0.35 * inom * im.u;
          cur.stator = Math.hypot(i0, i2);
          if (m.kind === 'im-wound') cur.rotor = 1.1 * i2;
        } else {
          // статор под напряжением, но ротор разомкнут / концы не соединены — только намагничивающий ток;
          // от ПЧ в режимах M / ω — ток по моменту
          cur.stator = st.state === 'stall' ? 0.35 * inom : st.state === 'run' ? 0.3 * inom + Math.abs(this.torque) / 55 * inom : 0;
          if (m.kind === 'im-wound') cur.rotor = st.state === 'run' ? cur.stator * 0.8 : 0;
        }
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
    // максимально-токовая защита ТП: ток выхода больше допустимого (например, постоянный
    // ток в статоре АД при большом задании напряжения) — авария преобразователя
    const conv = {};
    for (const c of bench.converters) {
      if (c.kind !== 'dc') continue;
      const i = convI[c.id] || 0;
      conv[c.id] = { I: i };
      if (c.imax && ctx.converters[c.id]?.running && i > c.imax) {
        events.push({ level: 'fault', dev: c.id, fault: 'ПРЕВЫШЕНИЕ ТОКА', text: `ТП: максимально-токовая защита — ток выхода ${fmt(i)} А при допустимых ${c.imax} А, снизьте задание` });
      }
    }

    return { potentials: pot, meters, shaft: { speed: this.speed, torque: this.torque }, motors, currents, conv, events };
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

  /**
   * Постоянный ток в статоре от работающего ТП (динамическое торможение):
   * на клеммниках обмотки только выводы «+»/«−» одного ТП, оба полюса
   * присутствуют. parallel — «+» на одной фазе, «−» на двух (или наоборот).
   */
  dcSource(ctx, ids) {
    const srcs = ids.map(id => ctx.nl.netOf(id).sources[0] || null);
    const dev = srcs.find(Boolean)?.dev;
    if (!dev || srcs.some(s => s && (s.kind !== 'conv' || s.dev !== dev))) return null;
    const conv = this.bench.converters.find(c => c.id === dev);
    if (!conv || conv.kind !== 'dc') return null;
    const isP = t => t === '+' || t === 'Я+', isN = t => t === '−' || t === 'Я−';
    if (srcs.some(s => s && !isP(s.term) && !isN(s.term))) return null; // обмотка возбуждения и т.п.
    const nP = srcs.filter(s => s && isP(s.term)).length, nN = srcs.filter(s => s && isN(s.term)).length;
    if (!nP || !nN) return null;
    const cv = ctx.converters[dev];
    if (!cv || !cv.running) return null;
    return { dev, u: this.tpArmVoltage(conv, cv), parallel: nP + nN === 3 };
  }

  /**
   * Добавочное сопротивление в фазе ротора, Ом: кольца замкнуты накоротко — 0,
   * через резисторы (в т.ч. последовательные, через контакты KM) — среднее по
   * фазам, цепь не замкнута — null.
   */
  rotorExtR(ctx, ids) {
    const nl = ctx.nl;
    const nets = ids.map(id => nl.netOf(id));
    if (nets.every(n => n === nets[0])) return 0;
    const adj = new Map();
    const link = (a, b, ohm) => (adj.get(a) || adj.set(a, []).get(a)).push({ net: b, ohm });
    for (const r of this.bench.resistors || []) {
      const a = nl.netOf(r.a), b = nl.netOf(r.b);
      if (!a || !b || a === b) continue;
      link(a, b, r.ohm); link(b, a, r.ohm);
    }
    const dist = (from) => {
      const d = new Map([[from, 0]]), done = new Set();
      for (;;) {
        let cur = null;
        for (const [n, v] of d) if (!done.has(n) && (cur === null || v < d.get(cur))) cur = n;
        if (cur === null) return d;
        done.add(cur);
        for (const e of adj.get(cur) || []) {
          const nd = d.get(cur) + e.ohm;
          if (!d.has(e.net) || nd < d.get(e.net)) d.set(e.net, nd);
        }
      }
    };
    let sum = 0;
    for (let i = 0; i < nets.length; i++) {
      const dj = dist(nets[i]).get(nets[(i + 1) % nets.length]);
      if (dj === undefined) return null;
      sum += dj;
    }
    return sum / (2 * nets.length); // звезда из R на фазу: каждая пара — 2R
  }

  /** Идентификатор работающего ТП, питающего якорь, или null. */
  tpDev(ctx, ap, an) {
    const s = ctx.nl.netOf(ap).sources[0], t = ctx.nl.netOf(an).sources[0];
    for (const s0 of [s, t]) {
      if (s0 && s0.kind === 'conv') {
        const conv = this.bench.converters.find(c => c.id === s0.dev);
        if (conv.kind === 'dc' && ctx.converters[conv.id].running) return conv.id;
      }
    }
    return null;
  }

  /** Питается ли якорь от работающего ТП. */
  tpDrive(ctx, ap, an) {
    const dev = this.tpDev(ctx, ap, an);
    return dev ? ctx.converters[dev] : null;
  }
}
