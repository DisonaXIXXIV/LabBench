// Интерфейс модели электропривода и квазистатическая модель.
//
// Всё, что модель получает, — контекст ctx:
//
//   ctx.dt          шаг времени, с
//   ctx.nl          нетлист без перемычек измерителей: nl.netOf(nodeId) -> {nodes, sources}
//   ctx.probes      ветви измерителей [{id:'pw.A', a, b}] (см. sim/circuit.js)
//   ctx.bench       описание стенда
//   ctx.converters  {id: {powered, running, field (возбуждение включено), mode, setup ('man'|'fix'),
//                         ref (со знаком, в единицах режима), fieldRef (А), ramp (0..1 для ТПН),
//                         params: {'22.01': значение, ...}}}
//   ctx.contactors  {km1: bool, ...}
//
// Модель возвращает:
//   {
//     potentials: Map(net -> {re, im}) — потенциалы сетей (В, фаза-нейтраль),
//     meters:  {PV1: value, PA1: value, ..., PW: {U, I, P, cos}} — показания приборов стенда,
//     shaft:   {speed (об/мин), torque (Нм)},
//     motors:  {m1: {state:'run'|'stop'|'stall'|'brake'|'runaway', note}},
//     currents:{m1: {field: A, arm: A}, m3: {stator, rotor, cos, f2, U2}, ...},
//     conv:    {tp: {I, U, If}, fc: {I, U, f, Iin, Ibr}, tpn: {I, U}} — величины преобразователей,
//     signals: {id: {dc, ac:[{rms, f, ph, src}]}} — сигналы для осциллографа (мгновенные значения — sample(t)),
//     energized: bool — на какую-либо машину подано питание (для фиксации выбега),
//     events:  [{level, text}] — сообщения: 'trip' — общая защита стенда,
//              'fault' (+dev, fault) — авария преобразователя, 'warn'/'info' — в журнал
//   }
import { Circuit } from './circuit.js';
import { C, csub, cmul, cscale, cabs, carg, cexp, RPM, dcKphi, imT, imFromTorque, imBrake, frictionTorque } from './machines.js';

export class DriveModel {
  constructor(bench) { this.bench = bench; }
  reset() {}
  // eslint-disable-next-line no-unused-vars
  step(ctx) { throw new Error('not implemented'); }
  /** Мгновенные значения сигналов в момент t (с) — для осциллографа. */
  // eslint-disable-next-line no-unused-vars
  sample(t) { return {}; }
}

const SQRT3 = Math.sqrt(3);
const UPH = 220;      // фазное напряжение сети, В
const UDC = 240;      // напряжение ввода постоянного тока, В
const UDC_LINK = 540; // звено постоянного тока ПЧ, В
const PH_ANG = { A: 0, B: -120, C: 120, U: 0, V: -120, W: 120 };
const ang = (deg) => cexp(deg * Math.PI / 180);
const lag = (cur, target, dt, tau) => cur + (target - cur) * Math.min(1, dt / tau);
const fmt = (v) => (Math.round(v * 10) / 10).toString().replace('.', ',');
const clamp = (v, lim) => Math.max(-lim, Math.min(lim, v));
const REGEN_W = 150;  // порог генераторной мощности ПЧ, Вт
const REGEN_T = 0.5;  // время до перенапряжения звена ПТ без тормозного резистора, с
const IM_DEFAULTS = { r1: 1, x1: 1.8, r2: 1, x2: 1.8, x0: 20 };
const TP_RIPPLE = { f: 300, k: 0.05 }; // пульсации выпрямленного тока ТП (шестипульсная схема)

/** Направление трёхфазной системы по порядку фаз на трёх выводах: +1 — прямое (ABC), −1 — обратное, 0 — не три разные. */
function sequence(names) {
  const order = ['A', 'B', 'C', 'U', 'V', 'W'];
  const idx = names.map(n => order.indexOf(n) % 3);
  if (idx.includes(-1) || new Set(idx).size !== 3) return 0;
  return (idx[1] - idx[0] + 3) % 3 === 1 ? 1 : -1;
}

/**
 * Квазистатическая модель: токи и напряжения — действующие значения и фазоры,
 * характеристики машин — по схемам замещения, вал — уравнение движения.
 */
export class QuasiStaticModel extends DriveModel {
  constructor(bench) {
    super(bench);
    this.reset();
  }

  reset() {
    this.t = 0;
    this.speed = 0;
    this.torque = 0;
    this.regen = {};    // время генераторного режима ПЧ без тормозного резистора
    this.tpU = {};      // ЭДС выхода ТП, выставленная регулятором тока/скорости
    this.refCur = {};   // текущее (после рампы) задание преобразователей
    this.refMode = {};
    this.stalled = {};
    this.theta = {};    // фазы источников частоты для синтеза сигналов
    this.freqs = {};
    this.signals = {};
    this.loopI = 0;     // ток якоря в контуре скорости ТП
    this.coast = null;  // фиксация выбега {n0, t0}
    this.wasEnergized = false;
  }

  // ---------- преобразователи ----------

  /** Параметр пульта преобразователя: в положении «Руч» — введённое значение, иначе заводское. */
  param(conv, cv, id) {
    const p = (conv.params || []).find(p => p.id === id);
    if (!p) return undefined;
    const v = cv?.setup === 'man' ? cv.params?.[id] : undefined;
    return Number.isFinite(v) ? v : p.def;
  }

  /** Задание с рампой: ТП в режиме U — 200 В за время 22.01; ПЧ — номинал (50 Гц / макс. скорость) за 28.72. */
  rampedRef(conv, cv, dt) {
    const key = conv.id;
    const target = cv.running ? cv.ref : 0;
    let rate = Infinity;
    if (conv.kind === 'dc' && cv.mode === 'U') rate = 200 / Math.max(0.05, this.param(conv, cv, '22.01') ?? 0.05);
    if (conv.kind === 'fc' && cv.mode !== 'M') {
      const T = Math.max(0.05, this.param(conv, cv, '28.72') ?? 0.05);
      rate = (cv.mode === 'f' ? 50 : (conv.modes.find(m => m.id === 'w')?.max || 1500)) / T;
    }
    if (this.refMode[key] !== cv.mode) { this.refMode[key] = cv.mode; this.refCur[key] = target; return target; }
    const cur = this.refCur[key] ?? 0;
    const next = rate === Infinity ? target : cur + clamp(target - cur, rate * dt);
    this.refCur[key] = next;
    return next;
  }

  /** Фазное напряжение ПЧ по частоте: ломаная U(f) через (0; U0), (0,5·fн; 0,5·Uн), (fн; Uн). */
  fcVoltage(conv, cv, f) {
    const un = (this.param(conv, cv, '99.07') ?? 380) / SQRT3;
    const u0 = un * (this.param(conv, cv, '97.13') ?? 0) / 100;
    const fa = Math.abs(f);
    if (fa >= 50) return un;
    if (fa >= 25) return un * fa / 50;
    return u0 + (un / 2 - u0) * fa / 25;
  }

  /** Частота на выходе ПЧ в текущем режиме, Гц (со знаком направления). */
  fcFrequency(conv, cv) {
    const sync = this.fcSync(conv);
    const ref = this.refCur[conv.id] ?? cv.ref;
    if (cv.mode === 'f') return ref;
    if (cv.mode === 'w') return ref / sync * 50;
    return Math.sign(this.speed || 1) * Math.max(3, Math.abs(this.speed) / sync * 50); // режим момента — частота по скорости вала
  }

  /** Скорость, соответствующая 50 Гц, для машины на выходе ПЧ (об/мин). */
  fcSync(conv) {
    const m = this.fcMotor?.[conv.id];
    if (m?.nominal.poles) return 50 * 60 / (m.nominal.poles / 2);
    return (m || this.bench.motors.find(x => x.kind === 'pmsm') || this.bench.motors[0]).nominal.speed;
  }

  /** ЭДС холостого хода якорного выхода ТП: режим U — задание (с рампой), ω и I — по регулятору с прошлого шага. */
  tpEmf(conv, cv) {
    if (cv.mode === 'U') return this.refCur[conv.id] ?? cv.ref;
    return this.tpU[conv.id] ?? 0;
  }

  /**
   * Сети с источниками → {pot: фазор В, kind:'ac'|'dc', sys, dev, term, phase|pol, f, src, rint}.
   * ТП: pot — ЭДС холостого хода, rint — внутреннее сопротивление; sys — «система» источника
   * (сеть, ввод =240 В, выход конкретного преобразователя) — цепь замыкается только в пределах одной.
   */
  collectSources(ctx) {
    const map = new Map();
    for (const net of ctx.nl.nets) {
      if (!net.sources.length) continue;
      const s = net.sources[0];
      let e = null;
      if (s.kind === 'ac') e = { kind: 'ac', pot: s.phase === 'N' ? C(0) : cscale(ang(PH_ANG[s.phase]), UPH), phase: s.phase, sys: 'mains', f: 50, src: 'mains' };
      else if (s.kind === 'dc') e = { kind: 'dc', pot: C(s.pol === '+' ? UDC : 0), pol: s.pol, sys: s.src, src: 'dc' };
      else {
        const cv = ctx.converters[s.dev];
        const conv = this.bench.converters.find(c => c.id === s.dev);
        if (conv.fieldOut?.includes(s.term)) {
          // возбудитель ТП — регулятор тока: напряжение по заданию и сопротивлению ОВ
          const rf = this.bench.motors.find(m => m.kind === 'dc')?.rf || 153;
          const uf = cv?.field && s.term === 'В+' ? Math.min(UDC, (cv.fieldRef || 0) * rf) : 0;
          e = { kind: 'dc', pot: C(uf), pol: s.term === 'В+' ? '+' : '−', sys: `${s.dev}.field`, dev: s.dev, term: s.term, src: 'dc' };
        } else if (!cv?.running) e = null;
        else if (conv.kind === 'fc') {
          const f = this.fcFrequency(conv, cv);
          e = { kind: 'ac', pot: cscale(ang(PH_ANG[s.term]), this.fcVoltage(conv, cv, f)), phase: s.term, sys: s.dev, dev: s.dev, term: s.term, f, src: `fc:${s.dev}`, pwm: true };
        } else if (conv.kind === 'ss') {
          e = { kind: 'ac', pot: cscale(ang(PH_ANG[s.term]), UPH * cv.ramp), phase: s.term, sys: s.dev, dev: s.dev, term: s.term, f: 50, src: 'mains' };
        } else {
          const plus = s.term === 'Я+' || s.term === '+';
          e = { kind: 'dc', pot: C(plus ? this.tpEmf(conv, cv) : 0), pol: plus ? '+' : '−', sys: s.dev, dev: s.dev, term: s.term, rint: plus ? (conv.rint || 0) : 0, src: `tp:${s.dev}` };
        }
      }
      if (e) map.set(net, { ...e, node: s.node });
    }
    return map;
  }

  // ---------- поиск источников по цепи ----------

  /** Путь от сети к ближайшей сети с источником, для которого acc(src) истинно. */
  reach(cir, srcMap, net, acc) {
    if (!net) return null;
    const p = cir.path(net, n => { const s = srcMap.get(n); return !!s && acc(s); });
    return p ? { ...p, src: srcMap.get(p.net) } : null;
  }

  /**
   * Двухполюсная цепь постоянного тока между сетями p и n:
   *   {kind:'src', up, un, r, rint, sys, dev, src, chains:[к «+», к «−»]} — от источника (обе стороны одной системы),
   *   {kind:'loop', r, chain}   — замкнута через резисторы без источника,
   *   {kind:'short'}            — p и n в одной сети,
   *   {kind:'open', half}       — разомкнута (half — сторона, у которой источник есть).
   */
  dcCircuit(cir, srcMap, p, n) {
    if (p === n) return { kind: 'short', r: 0 };
    const isDc = s => s.kind === 'dc';
    const a = this.reach(cir, srcMap, p, isDc), b = this.reach(cir, srcMap, n, isDc);
    if (a && b) {
      if (a.src.sys !== b.src.sys) return { kind: 'open', note: 'разные источники' };
      return { kind: 'src', up: a.src.pot.re, un: b.src.pot.re, r: a.ohm + b.ohm, rint: (a.src.rint || 0) + (b.src.rint || 0), sys: a.src.sys, dev: a.src.dev, src: a.src, chains: [a, b] };
    }
    if (!a && !b) {
      const loop = cir.path(p, x => x === n);
      return loop ? { kind: 'loop', r: loop.ohm, chain: loop } : { kind: 'open' };
    }
    return { kind: 'open', half: a || b };
  }

  /**
   * Трёхфазный источник на трёх сетях обмотки: {kind:'mains'|'conv', dev, seq, r (среднее
   * добавочное сопротивление в линии), chains, u (фазное напряжение источника), f, src} или null.
   */
  acCircuit(cir, srcMap, nets) {
    const ps = nets.map(n => this.reach(cir, srcMap, n, s => s.kind === 'ac'));
    if (ps.some(p => !p)) return null;
    const S = ps.map(p => p.src);
    if (S.some(s => s.phase === 'N' || s.sys !== S[0].sys)) return null;
    const seq = sequence(S.map(s => s.phase));
    if (!seq) return null;
    return { kind: S[0].dev ? 'conv' : 'mains', dev: S[0].dev, seq, r: ps.reduce((a, p) => a + p.ohm, 0) / 3, chains: ps, u: cabs(S[0].pot), f: S[0].f * seq, src: S[0] };
  }

  /**
   * Постоянный ток в статоре от ТП (динамическое торможение): выводы «+»/«−» одного ТП
   * на двух или трёх фазах. {dev, u, rint, parallel, r, chains, nP, nN, src} или null.
   */
  dcCircuit3(cir, srcMap, nets) {
    const isTp = s => s.kind === 'dc' && s.dev && !s.sys.endsWith('.field');
    const ps = nets.map(n => this.reach(cir, srcMap, n, isTp));
    const found = ps.filter(Boolean);
    if (found.length < 2) return null;
    const dev = found[0].src.dev;
    if (found.some(p => p.src.dev !== dev)) return null;
    const nP = found.filter(p => p.src.pol === '+').length, nN = found.filter(p => p.src.pol === '−').length;
    if (!nP || !nN) return null;
    const plus = found.find(p => p.src.pol === '+').src;
    return { dev, u: plus.pot.re, rint: plus.rint || 0, parallel: found.length === 3, r: found.reduce((a, p) => a + p.ohm, 0) / found.length, chains: ps, nP, nN, src: plus };
  }

  /** Добавочное сопротивление в фазе ротора, Ом (кольца накоротко — 0, не замкнуты — null). */
  rotorExtR(cir, nets) {
    if (nets.every(n => n === nets[0])) return 0;
    let sum = 0;
    for (let i = 0; i < nets.length; i++) {
      const d = cir.between(nets[i], nets[(i + 1) % nets.length]);
      if (d === null) return null;
      sum += d;
    }
    return sum / (2 * nets.length); // звезда из R на фазу: каждая пара — 2R
  }

  // ---------- шаг ----------

  step(ctx) {
    const { bench, nl, dt } = ctx;
    this.t += dt;
    const cir = new Circuit(bench, nl, ctx.probes || []);
    // какая машина сидит на выходе какого ПЧ — для пересчёта скорости в частоту
    this.fcMotor = {};
    for (const c of bench.converters) {
      if (c.kind !== 'fc') continue;
      const outNets = new Set(Object.values(c.out).map(n => nl.netOf(n)));
      for (const m of bench.motors) {
        if (m.windings.stator?.some(id => cir.path(nl.netOf(id), n => outNets.has(n)))) { this.fcMotor[c.id] = m; break; }
      }
    }
    for (const c of bench.converters) this.rampedRef(c, ctx.converters[c.id], dt);

    const srcMap = this.collectSources(ctx);
    const pot = new Map();
    for (const [net, s] of srcMap) pot.set(net, s.pot);
    const events = [];
    const motors = {};
    const currents = {};
    const conv = {};
    for (const c of bench.converters) conv[c.id] = { I: 0, U: 0, If: 0, Iin: 0, Ibr: 0, f: 0 };
    const flows = [];   // токи через измерители: {probes:[{id, dir, k}], i, kind:'dc'|'ac', f, ph, seq, P, src, ripple}
    const signals = {};
    const frict = bench.friction || {};
    const friction = (w) => frictionTorque(w, frict.m0, frict.kv);
    const rpmPerNm = 1 / ((bench.J || 0.1) * RPM);

    // --- механика: кто задаёт скорость, кто момент ---
    let speedTarget = null; // жёсткий источник скорости, об/мин
    let torqueTarget = 0;   // момент источников момента (ПЧ в режиме M), Нм
    let anyEnergized = false;
    const brakes = [];      // АД в динамическом торможении: {id, side, torque(w) ≥ 0}
    const softs = [];       // машины на характеристиках: {id, side, torque(w)}
    let stiff = null;       // {dev, side, kind:'fc'|'tp'} — кто держит скорость
    let fcDrive = null;     // чем ПЧ нагружает вал: {dev, kind:'torque'|'speed'|'im', side, calc}
    const sideOf = id => bench.motors[0].id === id ? 'A' : 'B';

    // потенциалы вдоль цепочки резисторов от источника к обмотке: падение I·R;
    // i — ток в направлении «источник → обмотка» (фазор)
    const setChain = (ch, i) => {
      if (!ch) return;
      const s = srcMap.get(ch.net);
      const vsrc = csub(pot.get(ch.net) || C(0), cscale(i, s?.rint || 0));
      for (const { net, ohm } of ch.chain) if (net !== ch.net) pot.set(net, csub(vsrc, cscale(i, ch.ohm - ohm)));
    };
    // поток тока через измерители на путях chains (k — номер фазы/стороны обмотки);
    // dirs[k] — направление физического тока относительно обхода (обход идёт от обмотки к источнику;
    // ток «источник → обмотка» — против обхода, −1)
    const flow = (chains, i, extra) => {
      const probes = [];
      chains.forEach((ch, k) => {
        if (!ch) return;
        const sign = extra.dirs ? extra.dirs[k] : -1;
        for (const p of ch.probes) probes.push({ id: p.id, dir: p.dir * sign, k });
      });
      flows.push({ probes, i, ...extra });
    };

    let dcm = null; // состояние ДПТ (одна машина на стенде)
    const imStates = {};
    let pmsm = null;

    for (const m of bench.motors) {
      const st = { state: 'stop', note: '' };
      const cur = {};
      const name = m.title.split(' — ')[0];
      if (m.kind === 'dc') {
        // ---- ДПТ ----
        const [fp, fn] = m.windings.field.map(id => nl.netOf(id));
        const [ap, an] = m.windings.arm.map(id => nl.netOf(id));
        const rf = m.rf || 153, ra = m.ra || 1;
        // обмотка возбуждения
        const fc = this.dcCircuit(cir, srcMap, fp, fn);
        let If = 0;
        if (fc.kind === 'src') {
          If = Math.max(0, (fc.up - fc.un) / (rf + fc.r + fc.rint));
          setChain(fc.chains[0], C(If)); setChain(fc.chains[1], C(-If));
          flow(fc.chains, If, { kind: 'dc', dirs: [-1, 1], P: If * If * rf, src: fc.src.src });
          if (fc.dev) conv[fc.dev].If += If;
        }
        cur.field = If;
        const kphi = dcKphi(m, If);
        cur.kphi = kphi;
        const hasField = If > 0.15;
        const emf = (w) => kphi * w * RPM;
        // якорная цепь
        const ac = this.dcCircuit(cir, srcMap, ap, an);
        const tpId = ac.kind === 'src' && ac.dev && !ac.sys.endsWith('.field') ? ac.dev : null;
        const tpc = tpId ? bench.converters.find(c => c.id === tpId) : null;
        const drv = tpId ? ctx.converters[tpId] : null;
        if (ac.kind === 'src' && (Math.abs(ac.up - ac.un) > 1 || (drv && drv.mode !== 'U'))) {
          anyEnergized = true;
          const rtot = ra + ac.r + ac.rint;
          const uSrc = ac.up - ac.un; // ЭДС холостого хода источника (ТП — по регулятору)
          if (!hasField) {
            // без возбуждения — разнос
            speedTarget = Math.sign(uSrc || 1) * 3200;
            st.state = 'runaway';
            st.note = 'нет тока возбуждения';
            dcm = { id: m.id, ac, tpId, ra, uSrc, armI: () => uSrc / rtot, armU: () => uSrc / rtot * ra, note: () => '' };
          } else {
            const umax = tpc?.umax || UDC;
            const ilim = tpc ? (tpc.ilim || Infinity) : Infinity;
            let armI, note;
            if (drv?.mode === 'I') {
              // ТП держит ток, поднимая ЭДС: U = E + I·Rсум, пока не упрётся в предел umax
              const iRef = drv.ref;
              const need = (w) => emf(w) + iRef * rtot;
              const uTp = (w) => clamp(need(w), umax);
              armI = (w) => (uTp(w) - emf(w)) / rtot;
              this.tpU[tpId] = uTp(this.speed);
              softs.push({ id: m.id, side: sideOf(m.id), torque: w => kphi * armI(w) });
              note = (w) => Math.abs(need(w)) > umax ? ' — ТП на пределе напряжения, ток меньше задания' : ', ТП держит ток — вал разгоняется';
            } else if (drv?.mode === 'w') {
              // замкнутый контур скорости: вал следует за заданием, пока хватает напряжения и тока
              const wRef = this.refCur[tpId] ?? drv.ref;
              const iNeed = this.loopI; // ток по моменту нагрузки с прошлого шага
              const uNeed = emf(wRef) + iNeed * rtot;
              if (Math.abs(iNeed) > ilim) {
                const iRef = clamp(iNeed, ilim);
                const uTp = (w) => clamp(emf(w) + iRef * rtot, umax);
                armI = (w) => (uTp(w) - emf(w)) / rtot;
                this.tpU[tpId] = uTp(this.speed);
                softs.push({ id: m.id, side: sideOf(m.id), torque: w => kphi * armI(w) });
                note = () => ' — ТП в ограничении тока';
              } else if (Math.abs(uNeed) > umax) {
                const uTp = Math.sign(uNeed) * umax;
                armI = (w) => clamp((uTp - emf(w)) / rtot, ilim);
                this.tpU[tpId] = uTp;
                softs.push({ id: m.id, side: sideOf(m.id), torque: w => kphi * armI(w) });
                note = () => ' — ТП на пределе напряжения, скорость ниже задания';
              } else {
                speedTarget = wRef;
                stiff = { dev: tpId, side: sideOf(m.id), kind: 'tp' };
                armI = () => this.loopI;
                this.tpU[tpId] = uNeed;
                note = () => ', ТП держит скорость';
              }
            } else {
              // режим U (или сеть =240 В): естественная характеристика I = (U − E)/Rсум с ограничением тока регулятора
              armI = (w) => clamp((uSrc - emf(w)) / rtot, ilim);
              softs.push({ id: m.id, side: sideOf(m.id), torque: w => kphi * armI(w) });
              note = () => '';
            }
            st.state = 'run';
            dcm = { id: m.id, ac, tpId, ra, uSrc, armI, armU: (w) => emf(w) + armI(w) * ra, note };
          }
        } else if ((ac.kind === 'loop' || ac.kind === 'short') && hasField) {
          // динамическое торможение: якорь без источника замкнут накоротко или на резистор
          anyEnergized = true;
          const armI = (w) => -emf(w) / (ra + ac.r);
          softs.push({ id: m.id, side: sideOf(m.id), torque: w => kphi * armI(w) });
          st.state = 'brake';
          dcm = { id: m.id, ac, ra, loop: true, armI, armU: (w) => emf(w) + armI(w) * ra, note: () => '' };
        } else {
          if (hasField) st.note = 'возбуждение подано';
          if (ac.kind === 'open' && ac.half && hasField) st.note += ' — якорь подключён одним концом';
          cur.arm = 0;
        }
        currents[m.id] = cur;
      } else if (m.kind === 'pmsm') {
        // ---- СДПМ от ПЧ ----
        const nets = m.windings.stator.map(id => nl.netOf(id));
        const src = this.acCircuit(cir, srcMap, nets);
        if (src && src.kind === 'conv') {
          anyEnergized = true;
          const cv = ctx.converters[src.dev];
          if (cv.mode === 'M') { torqueTarget += -cv.ref; fcDrive = { dev: src.dev, kind: 'torque', side: sideOf(m.id) }; }
          else { speedTarget ??= this.refCur[src.dev] ?? cv.ref; stiff ??= { dev: src.dev, side: sideOf(m.id), kind: 'fc' }; fcDrive = { dev: src.dev, kind: 'speed', side: sideOf(m.id) }; }
          st.state = 'run';
          pmsm = { id: m.id, src, kt: m.kt || 1.5 };
        } else if (src && src.kind === 'mains') {
          st.state = 'stall'; st.note = 'СДПМ подключён к сети напрямую';
          anyEnergized = true;
        }
        currents[m.id] = cur;
      } else if (m.kind === 'im-wound' || m.kind === 'im-cage') {
        // ---- АД ----
        const N = m.nominal;
        const pp = (N.poles || 6) / 2;
        const inom = N.current || 15;
        const P = { ...IM_DEFAULTS, ...(m.im || {}) };
        const nets = m.windings.stator.map(id => nl.netOf(id));
        const src = this.acCircuit(cir, srcMap, nets);
        let closed = true, rotorNote = '', r2Ext = 0, delta = false, rRotor = 0;
        if (m.kind === 'im-cage') {
          const en = m.windings.ends.map(n => nl.netOf(n));
          const star = en.every(n => n === en[0]);
          delta = en.every(n => nets.includes(n)) && new Set(en).size === 3;
          closed = star || delta;
          rotorNote = closed ? (star ? 'звезда' : 'треугольник') : 'концы X,Y,Z не соединены';
        } else {
          rRotor = this.rotorExtR(cir, m.windings.rotor.map(id => nl.netOf(id)));
          closed = rRotor !== null;
          rotorNote = !closed ? 'ротор разомкнут' : rRotor < 0.05 ? 'ротор замкнут' : `ротор через ${fmt(rRotor)} Ом`;
          if (!closed) rRotor = 0;
          r2Ext = rRotor * (P.kpr || 1) ** 2; // приведение к статору
        }
        const s = { id: m.id, P, pp, inom, closed, delta, r2Ext, rRotor, src, nets, side: sideOf(m.id) };
        imStates[m.id] = s;
        if (src) {
          anyEnergized = true;
          st.note = rotorNote;
          // фазное напряжение по схеме соединения: звезда — линейное/√3, треугольник — линейное;
          // добавочное сопротивление в линии для треугольника пересчитывается в фазу (R/3)
          s.u = delta ? src.u * SQRT3 : src.u;
          s.rExt = delta ? src.r / 3 : src.r;
          s.f = src.f;
          const cv = src.kind === 'conv' ? ctx.converters[src.dev] : null;
          const cconv = cv ? bench.converters.find(c => c.id === src.dev) : null;
          const calc = (w) => imT(P, { u: s.u, f: s.f, w, rExt: s.rExt, r2Ext, poles: pp });
          if (!closed) st.state = 'stall';
          else if (src.kind === 'mains' || cconv.kind === 'ss' || (cconv.kind === 'fc' && cv.mode === 'f')) {
            if (cconv?.kind === 'fc' && Math.abs(s.f) < 1) st.note += ', f = 0';
            else {
              softs.push({ id: m.id, side: s.side, torque: w => calc(w).M });
              s.calc = calc;
              if (cconv?.kind === 'fc') fcDrive = { dev: src.dev, kind: 'im', side: s.side, calc };
              st.state = 'run';
            }
          } else if (cv.mode === 'M') { torqueTarget += -cv.ref; fcDrive = { dev: src.dev, kind: 'torque', side: s.side }; s.vector = true; st.state = 'run'; }
          else { speedTarget ??= this.refCur[src.dev] ?? cv.ref; stiff ??= { dev: src.dev, side: s.side, kind: 'fc' }; fcDrive = { dev: src.dev, kind: 'speed', side: s.side }; s.vector = true; st.state = 'run'; }
        } else {
          // динамическое торможение: постоянный ток от ТП в двух (трёх) фазах статора
          const dc = this.dcCircuit3(cir, srcMap, nets);
          if (dc) {
            anyEnergized = true;
            const kSer = dc.parallel ? 1.5 : 2; // две фазы последовательно или одна + две параллельно
            const idc = Math.abs(dc.u) / (kSer * (P.r1 + dc.r) + dc.rint);
            cur.stator = idc;
            cur.dc = true;
            conv[dc.dev].I += idc; conv[dc.dev].U = Math.abs(dc.u) - idc * dc.rint;
            s.dc = dc; s.idc = idc;
            dc.chains.forEach(ch => { if (ch) setChain(ch, C(ch.src.pol === '+' ? idc / dc.nP : -idc / dc.nN)); });
            if (!closed) {
              st.state = 'stall';
              st.note = `постоянный ток ${fmt(idc)} А в статоре, ${rotorNote} — момента нет`;
            } else {
              const ieq = idc * (dc.parallel ? Math.SQRT1_2 : Math.sqrt(2 / 3));
              const br = (w) => imBrake(P, { ieq, w, r2Ext, poles: pp, i0: N.i0 });
              brakes.push({ id: m.id, side: s.side, torque: w => br(w).M });
              s.brake = br; s.ieq = ieq;
              st.state = 'brake';
              st.note = `I = ${fmt(idc)} А, ${rotorNote}, ωк ≈ ${Math.round(br(0).nuK * 50 * 60 / pp)} об/мин`;
            }
            if (idc > 1.5 * inom) events.push({ level: 'warn', text: `${name}: постоянный ток статора больше 1,5·Iном — перегрев обмотки, снизьте задание ТП` });
          }
        }
        currents[m.id] = cur;
      }
      motors[m.id] = st;
    }

    // --- вал ---
    const sumT = (list, w) => list.reduce((s, x) => s + x.torque(w), 0);
    const brakeM = (w) => sumT(brakes, w);
    // всё, что действует на вал, кроме источников момента и жёсткого источника скорости
    const passive = (w) => sumT(softs, w) - Math.sign(w) * brakeM(w) - friction(w);
    const shaftTorque = (w) => passive(w) + torqueTarget;
    if (speedTarget !== null) {
      this.speed = lag(this.speed, speedTarget, dt, 0.4);
    } else {
      // J·dω/dt = ΣM: неявный шаг Эйлера с линеаризацией — устойчив на крутых участках характеристик
      const w = this.speed;
      const F = shaftTorque(w);
      const dF = (shaftTorque(w + 1) - shaftTorque(w - 1)) / 2;
      const next = w + dt * F * rpmPerNm / (1 - dt * Math.min(0, dF) * rpmPerNm);
      // сухое трение: вал не проходит через ноль сам по себе и не трогается с места без момента
      this.speed = (w !== 0 && Math.sign(next) !== Math.sign(w)) || (w === 0 && Math.abs(shaftTorque(0) + friction(0)) <= (frict.m0 ?? 2.5)) ? 0 : next;
    }
    if (Math.abs(this.speed) < 0.3) this.speed = 0;
    const w = this.speed;

    // ток якоря ДПТ в контуре скорости ТП — по моменту, который нужен валу от этой машины
    if (stiff?.kind === 'tp' && dcm) {
      const kphi = currents[dcm.id].kphi;
      this.loopI = kphi > 0.05 ? clamp(-passive(w) / kphi, 60) : 0;
    } else this.loopI = 0;

    // показание датчика момента: момент в муфте = момент машины B (нагрузочной, второй в агрегате);
    // положительный — нагрузочная машина крутит испытуемую
    const sideTorque = (side) => sumT(softs.filter(x => x.side === side), w) - Math.sign(w) * sumT(brakes.filter(x => x.side === side), w)
      + (fcDrive?.kind === 'torque' && fcDrive.side === side ? torqueTarget : 0);
    let dispTorque;
    if (stiff?.side === 'B') dispTorque = -(sideTorque('A') - friction(w)); // B держит скорость: реакция всего остального
    else if (stiff?.side === 'A') dispTorque = sideTorque('B');
    else dispTorque = sideTorque('B');
    this.torque = lag(this.torque, dispTorque, dt, 0.15);

    // --- токи, потенциалы, заметки ---
    let fcPower = null; // {dev, p} — электрическая мощность на выходе ПЧ
    for (const m of bench.motors) {
      const st = motors[m.id];
      const cur = currents[m.id] || (currents[m.id] = {});
      const name = m.title.split(' — ')[0];
      if (m.kind === 'dc') {
        const [fp, fn] = m.windings.field.map(id => nl.netOf(id));
        if (cur.field > 0 && !pot.has(fp)) { pot.set(fn, pot.get(fn) || C(0)); pot.set(fp, C(pot.get(fn).re + cur.field * (m.rf || 153))); }
        if (dcm?.id === m.id) {
          const i = dcm.armI(w), ua = dcm.armU(w);
          cur.arm = i;
          const [ap, an] = m.windings.arm.map(id => nl.netOf(id));
          if (dcm.loop) {
            // якорь на резисторе: минус якоря — опорный потенциал, ток по контуру I_я (генераторный, < 0)
            pot.set(an, C(0)); pot.set(ap, C(ua));
            for (const { net, ohm } of dcm.ac.chain.chain) if (net !== ap && net !== an) pot.set(net, C(ua * (1 - ohm / Math.max(dcm.ac.r, 1e-9))));
            flow([dcm.ac.chain], i, { kind: 'dc', P: i * i * dcm.ac.r, src: 'dc' });
            st.note = `I_я = ${fmt(i)} А, E = ${fmt(ua - i * dcm.ra)} В, R = ${fmt(dcm.ac.r)} Ом`;
          } else {
            const [cp, cn] = dcm.ac.chains;
            setChain(cp, C(i)); setChain(cn, C(-i));
            const un = (pot.get(cn.net)?.re ?? 0) + i * cn.ohm;
            pot.set(an, C(un)); pot.set(ap, C(un + ua));
            flow(dcm.ac.chains, i, { kind: 'dc', dirs: [-1, 1], P: ua * i, src: dcm.ac.src.src, ripple: dcm.tpId ? TP_RIPPLE : null });
            if (dcm.tpId) { conv[dcm.tpId].I += Math.abs(i); conv[dcm.tpId].U = dcm.uSrc - i * dcm.ac.rint; }
            if (st.state === 'run') st.note = `I_я = ${fmt(i)} А` + dcm.note(w);
          }
          signals[`${m.id}.Ia`] = { dc: i, ac: dcm.tpId ? [{ rms: Math.abs(i) * TP_RIPPLE.k, f: TP_RIPPLE.f, ph: 0, src: 'tp' }] : [] };
          signals[`${m.id}.Ua`] = { dc: ua, ac: dcm.tpId ? [{ rms: Math.abs(ua) * 0.06, f: TP_RIPPLE.f, ph: 0.3, src: 'tp' }] : [] };
        } else { signals[`${m.id}.Ia`] = { dc: 0, ac: [] }; signals[`${m.id}.Ua`] = { dc: 0, ac: [] }; }
      } else if (m.kind === 'pmsm') {
        if (pmsm?.id === m.id) {
          // ток по моменту машины на валу; напряжение — с выхода ПЧ
          const mB = stiff?.kind === 'fc' && stiff.side === sideOf(m.id) ? this.torque * (sideOf(m.id) === 'B' ? 1 : -1) : (fcDrive?.kind === 'torque' ? torqueTarget : 0);
          const i = Math.abs(mB) / pmsm.kt + 0.5;
          cur.stator = i;
          const c0 = bench.converters.find(c => c.id === pmsm.src.dev);
          const f = this.fcFrequency(c0, ctx.converters[pmsm.src.dev]);
          const uPh = cabs(pmsm.src.src.pot);
          const pEl = mB * w * RPM + 3 * i * i * 0.3;
          fcPower = { dev: pmsm.src.dev, p: pEl };
          pmsm.src.chains.forEach((ch, k) => setChain(ch, cscale(cexp(-pmsm.src.seq * k * 2 * Math.PI / 3), i)));
          flow(pmsm.src.chains, i, { kind: 'ac', f: Math.abs(f), ph: 0, P: pEl, u: uPh, src: pmsm.src.src.src, seq: pmsm.src.seq });
          signals[`${m.id}.I`] = { dc: 0, ac: [{ rms: i, f: Math.abs(f), ph: 0, src: pmsm.src.src.src }] };
          conv[pmsm.src.dev].I = i; conv[pmsm.src.dev].U = uPh; conv[pmsm.src.dev].f = f;
        } else signals[`${m.id}.I`] = { dc: 0, ac: [] };
      } else if (m.kind === 'im-wound' || m.kind === 'im-cage') {
        const s = imStates[m.id];
        const N = m.nominal;
        const ki = (s.P.kpr || 1) / ((N.voltage || 380) / (N.rotorVoltage || 210)); // ток ротора: I2 = I2'·ki
        const wound = m.kind === 'im-wound';
        let r = null, f1 = 0;
        if (s.src && s.closed) {
          if (s.calc) r = s.calc(w);
          else if (s.vector) {
            // ПЧ в режимах M/ω: ток по моменту машины на валу при текущей частоте
            const mm = stiff?.side === s.side && stiff.kind === 'fc' ? this.torque * (s.side === 'B' ? 1 : -1) : (fcDrive?.kind === 'torque' ? torqueTarget : 0);
            const f = this.fcFrequency(bench.converters.find(c => c.id === s.src.dev), ctx.converters[s.src.dev]);
            r = imFromTorque(s.P, { u: s.u, f, w, M: mm, rExt: s.rExt, r2Ext: s.r2Ext, poles: s.pp });
          }
        } else if (s.src && !s.closed) {
          // статор под напряжением, ротор разомкнут / концы не соединены — ток холостого хода
          r = imT(s.P, { u: s.u, f: s.f, w: s.f * 60 / s.pp * (1 - 1e-6), rExt: s.rExt, r2Ext: 1e9, poles: s.pp });
        }
        if (r) {
          f1 = Math.abs(r.f);
          const i1 = cabs(r.I1);
          const iLine = s.delta ? i1 * SQRT3 : i1; // амперметр стоит в линии
          cur.stator = iLine; cur.phase = i1; cur.cos = r.cosPhi; cur.P1 = r.P1;
          const i2 = cabs(r.I2) * ki;
          if (wound) {
            cur.rotor = i2; cur.f2 = Math.abs(r.s * f1);
            cur.U2 = !s.closed ? (N.rotorVoltage || 210) * Math.min(1, Math.abs(r.s)) : s.rRotor > 0.05 ? SQRT3 * i2 * s.rRotor : 0;
          }
          // потенциалы на зажимах статора: напряжение источника минус падение на добавочных резисторах
          const phA = carg(r.I1) - (s.delta ? Math.PI / 6 : 0);
          s.src.chains.forEach((ch, k) => setChain(ch, cscale(cexp(phA - s.src.seq * k * 2 * Math.PI / 3), iLine)));
          flow(s.src.chains, iLine, { kind: 'ac', f: f1, ph: phA, P: r.P1, u: s.u, cos: r.cosPhi, src: s.src.src.src, seq: s.src.seq });
          if (s.src.kind === 'conv') {
            const c0 = bench.converters.find(c => c.id === s.src.dev);
            conv[s.src.dev].I = iLine; conv[s.src.dev].U = s.src.u; conv[s.src.dev].f = f1;
            if (c0.kind === 'fc') fcPower = { dev: s.src.dev, p: r.P1 };
          }
          if (s.calc) {
            const stalled = st.state === 'run' && Math.abs(w) < 0.1 * Math.abs(r.w0) && shaftTorque(w) * Math.sign(r.w0) <= 0;
            if (stalled) {
              st.state = 'stall';
              st.note += `, момент нагрузки больше критического — опрокидывание, I1 = ${fmt(i1)} А`;
              if (!this.stalled[m.id]) events.push({ level: 'warn', text: `${name}: опрокидывание — момент нагрузки больше критического, ток статора ${fmt(i1)} А недопустимо велик` });
            } else st.note += `, s = ${Math.round(r.s * 100)} %${r.s < -0.005 ? ' (генераторный режим)' : r.s > 1 ? ' (противовключение)' : ''}, cos φ = ${r.cosPhi.toFixed(2).replace('.', ',')}`;
            this.stalled[m.id] = stalled;
          } else if (s.vector) st.note += `, I1 = ${fmt(iLine)} А`;
          signals[`${m.id}.I1`] = { dc: 0, ac: [{ rms: iLine, f: f1, ph: phA, src: s.src.src.src }] };
        } else if (s.dc) {
          // динамическое торможение: ток статора задан ТП, ток ротора растёт со скоростью
          const b = s.brake ? s.brake(w) : null;
          if (wound) { cur.rotor = b ? b.I2 * ki : 0; cur.f2 = Math.abs(w) * s.pp / 60; cur.U2 = s.rRotor > 0.05 ? SQRT3 * cur.rotor * s.rRotor : 0; }
          flow(s.dc.chains, s.idc, { kind: 'dc', dirs: s.dc.chains.map(ch => ch?.src.pol === '−' ? 1 : -1), P: s.idc * s.idc * 2 * s.P.r1, src: `tp:${s.dc.dev}`, ripple: TP_RIPPLE });
          signals[`${m.id}.I1`] = { dc: s.idc, ac: [{ rms: s.idc * TP_RIPPLE.k, f: TP_RIPPLE.f, ph: 0, src: 'tp' }] };
        } else {
          this.stalled[m.id] = false;
          signals[`${m.id}.I1`] = { dc: 0, ac: [] };
        }
        if (wound) {
          signals[`${m.id}.I2`] = { dc: 0, ac: cur.rotor ? [{ rms: cur.rotor, f: cur.f2, ph: 0, src: `rot:${m.id}` }] : [] };
          this.rotorF = { ...(this.rotorF || {}), [m.id]: cur.f2 || 0 };
          if (cur.U2 !== undefined) {
            // напряжение на кольцах ротора (PV2 между b и c): фазоры трёх колец
            const u2ph = cur.U2 / SQRT3;
            m.windings.rotor.map(id => nl.netOf(id)).forEach((net, k) => { if (!pot.has(net)) pot.set(net, cscale(cexp(-k * 2 * Math.PI / 3), u2ph)); });
          }
        }
      }
    }

    // --- преобразователи: нагрузка на выходе ТП, вход ПЧ, рекуперация, защиты ---
    // ток на входе преобразователя проходит через измерители между сетью и его клеммниками A, B, C
    const inputFlow = (c, i, ph, P) => {
      if (i < 0.01) return;
      const chains = Object.values(c.in).map(n => this.reach(cir, srcMap, nl.netOf(n), s => s.kind === 'ac' && s.phase !== 'N'));
      if (chains.every(Boolean)) flow(chains, i, { kind: 'ac', f: 50, ph, P, u: UPH, src: 'mains', seq: sequence(chains.map(ch => ch.src.phase)) || 1 });
    };
    for (const c of bench.converters) {
      const cv = ctx.converters[c.id];
      const cx = conv[c.id];
      if (c.kind === 'dc') {
        if (cv.running) {
          // резистивная нагрузка между «+» и «−» ТП (например, 1,7 Ом — ЛР2 п.2)
          const pn = nl.netOf(c.out['Я+'] || c.out['+']), mn = nl.netOf(c.out['Я−'] || c.out['−']);
          const src = srcMap.get(pn);
          const ld = pn && mn && pn !== mn ? cir.path(pn, n => n === mn) : null;
          const armHere = dcm?.tpId === c.id;
          if (ld && src && ld.ohm > 0.01) {
            const e = src.pot.re;
            let i = e / (ld.ohm + (src.rint || 0));
            if (cv.mode === 'I' && !armHere) { i = clamp(cv.ref, (c.umax || UDC) / ld.ohm); this.tpU[c.id] = clamp(i * (ld.ohm + (src.rint || 0)), c.umax || UDC); }
            cx.I += Math.abs(i);
            cx.U = e - i * (src.rint || 0);
            pot.set(mn, pot.get(mn) || C(0));
            for (const { net, ohm } of ld.chain) pot.set(net, C(pot.get(mn).re + cx.U * (1 - ohm / ld.ohm)));
            flow([ld], i, { kind: 'dc', dirs: [1], P: cx.U * i, src: `tp:${c.id}`, ripple: TP_RIPPLE });
          } else if (src && !cx.I) cx.U = src.pot.re;
          if (!armHere && !ld) {
            // якорь не подключён: регулятору скорости не на чем работать — ЭДС по заданию, ток — 0
            if (cv.mode === 'w') this.tpU[c.id] = clamp(cv.ref / 2000 * UDC, c.umax || UDC);
            if (cv.mode === 'I') this.tpU[c.id] = 0;
          }
          if (pn && pot.has(pn) && src) pot.set(pn, C(cx.U || src.pot.re));
          if (c.imax && cx.I > c.imax) events.push({ level: 'fault', dev: c.id, fault: 'ПРЕВЫШЕНИЕ ТОКА', text: `ТП: максимально-токовая защита — ток выхода ${fmt(cx.I)} А при допустимых ${c.imax} А, снизьте задание` });
        }
        if (c.fieldOut && cv.running && cx.If < c.fieldMin) events.push({ level: 'fault', dev: c.id, fault: 'ОШИБКА ТОКА ОВ', text: `ТП: ошибка тока возбуждения — I_в = ${cx.If.toFixed(2)} А меньше ${c.fieldMin} А, якорная цепь отключена` });
        // вход ТП: шестипульсный мост — I₁ ≈ 0,816·Id, cos φ ≈ Ud/Ud0 (угол управления)
        if (cv.powered) {
          const pOut = Math.abs(cx.U * cx.I) + cx.If * cx.If * (bench.motors.find(m => m.kind === 'dc')?.rf || 153);
          const iIn = 0.816 * cx.I + 0.4 * cx.If;
          const cosIn = Math.max(0.1, Math.min(0.95, Math.abs(cx.U) / 260));
          inputFlow(c, iIn, -Math.acos(cosIn), pOut / 0.97);
        }
        signals[`${c.id}.I`] = { dc: cx.I, ac: cx.I ? [{ rms: cx.I * TP_RIPPLE.k, f: TP_RIPPLE.f, ph: 0, src: 'tp' }] : [] };
        signals[`${c.id}.U`] = { dc: cx.U, ac: cx.U ? [{ rms: Math.abs(cx.U) * 0.06, f: TP_RIPPLE.f, ph: 0.3, src: 'tp' }] : [] };
      } else if (c.kind === 'fc') {
        // мощность на выходе → ток на входе; генераторный режим → тормозной резистор или перенапряжение
        let pOut = 0;
        if (cv.running && fcDrive?.dev === c.id) {
          if (fcPower?.dev === c.id) pOut = fcPower.p;
          else if (fcDrive.kind === 'torque') pOut = torqueTarget * w * RPM;
          else if (fcDrive.kind === 'im') pOut = fcDrive.calc(w).P1;
        }
        const pIn = pOut > 0 ? pOut / 0.96 : 0;
        cx.Iin = pIn / (SQRT3 * 380 * 0.95);
        cx.Ibr = 0;
        if (c.brake && cv.running && pOut < -REGEN_W) {
          const [bp, bn] = c.brake;
          const shorted = nl.same(bp, bn);
          const rb = (bench.resistors || []).find(r => (nl.same(bp, r.a) && nl.same(bn, r.b)) || (nl.same(bp, r.b) && nl.same(bn, r.a)));
          if (shorted) events.push({ level: 'fault', dev: c.id, fault: 'КЗ ТОРМОЗНОГО КЛЮЧА', text: 'ПЧ: выводы Br+ и Br− замкнуты накоротко — при рекуперации сгорел тормозной ключ' });
          else if (!rb) {
            this.regen[c.id] = (this.regen[c.id] || 0) + dt;
            if (this.regen[c.id] >= REGEN_T) events.push({ level: 'fault', dev: c.id, fault: 'ПЕРЕНАПРЯЖЕНИЕ ЗПТ', text: `ПЧ: перенапряжение звена постоянного тока — рекуперация ${Math.round(-pOut)} Вт без тормозного резистора на Br+/Br−` });
          } else { this.regen[c.id] = 0; cx.Ibr = -pOut / UDC_LINK; }
        } else this.regen[c.id] = 0;
        if (cv.powered) inputFlow(c, cx.Iin, -0.32, pIn);
        const fo = Math.abs(cx.f || 0);
        signals[`${c.id}.Iin`] = { dc: 0, ac: cx.Iin ? [{ rms: cx.Iin, f: 50, ph: -0.32, src: 'mains' }] : [] };
        signals[`${c.id}.Uin`] = { dc: 0, ac: cv.powered ? [{ rms: 380, f: 50, ph: Math.PI / 6, src: 'mains' }] : [] };
        signals[`${c.id}.Ibr`] = { dc: cx.Ibr, ac: cx.Ibr ? [{ rms: cx.Ibr * 0.3, f: 1000, ph: 0, src: 'pwm' }] : [] };
        signals[`${c.id}.Uout`] = { dc: 0, ac: cv.running && fo ? [{ rms: cx.U, f: fo, ph: 0, src: `fc:${c.id}` }, { rms: cx.U * 0.35, f: 1000, ph: 0, src: 'pwm' }] : [] };
        signals[`${c.id}.Iout`] = { dc: 0, ac: cv.running && fo ? [{ rms: cx.I, f: fo, ph: -0.5, src: `fc:${c.id}` }, { rms: cx.I * 0.04, f: 1000, ph: 0, src: 'pwm' }] : [] };
      } else if (c.kind === 'ss') {
        cx.U = UPH * cv.ramp * SQRT3;
        // вход ТПН: ток машины на его выходе (тиристоры — последовательно в линии)
        const load = Object.values(currents).find(x => x.stator && Object.values(imStates).some(s => s.src?.dev === c.id && currents[s.id] === x));
        if (cv.running && load) inputFlow(c, load.stator, -Math.acos(Math.max(-1, Math.min(1, load.cos ?? 0.8))), load.P1 || 0);
        signals[`${c.id}.U`] = { dc: 0, ac: cv.running ? [{ rms: UPH * cv.ramp, f: 50, ph: 0, src: 'mains' }] : [] };
        signals[`${c.id}.I`] = { dc: 0, ac: cv.running ? [{ rms: cx.I, f: 50, ph: -0.6, src: 'mains' }] : [] };
      }
    }

    // --- показания приборов ---
    const V = (a, b) => {
      const pa = pot.get(nl.netOf(a)), pb = pot.get(nl.netOf(b));
      return !pa && !pb ? 0 : cabs(csub(pa || C(0), pb || C(0)));
    };
    const Vdc = (a, b) => {
      const pa = pot.get(nl.netOf(a)), pb = pot.get(nl.netOf(b));
      return !pa && !pb ? 0 : (pa?.re ?? 0) - (pb?.re ?? 0);
    };
    // ток через измеритель: сумма компонент потоков, прошедших через его ветвь
    const probeCurrent = (id) => {
      let dc = 0, P = 0;
      const acs = [];
      for (const f of flows) {
        for (const p of f.probes) {
          if (p.id !== id) continue;
          P += f.P;
          if (f.kind === 'dc') {
            dc += p.dir * f.i;
            if (f.ripple) acs.push({ rms: Math.abs(f.i) * f.ripple.k, f: f.ripple.f, ph: 0, src: 'tp' });
          } else {
            // фаза тока k-й фазы обмотки: сдвиг на k·120° по порядку следования фаз
            const ph = f.ph - (f.seq || 1) * p.k * 2 * Math.PI / 3 + (p.dir > 0 ? 0 : Math.PI);
            acs.push({ rms: f.i, f: f.f, ph, src: f.src });
          }
        }
      }
      return { dc, ac: acs, P };
    };
    const rms = (p) => Math.hypot(p.dc, ...p.ac.filter(x => x.src !== 'tp' && x.src !== 'pwm').map(x => x.rms));
    const meters = {};
    for (const mt of bench.meters) {
      if (mt.kind === 'V') meters[mt.id] = mt.min < 0 ? Vdc(mt.across[0], mt.across[1]) : V(mt.across[0], mt.across[1]);
      else if (mt.kind === 'A') meters[mt.id] = currents[mt.series.motor]?.[mt.series.winding] ?? 0;
      else if (mt.kind === 'n') meters[mt.id] = this.speed;
      else if (mt.kind === 'M') meters[mt.id] = this.torque;
      else if (mt.kind === 'PW') {
        const [a, b, c] = mt.in;
        const u = (V(a, b) + V(b, c) + V(c, a)) / 3;
        const ps = ['A', 'B', 'C'].map(t => probeCurrent(`pw.${t}`));
        const I = ps.reduce((s, p) => s + rms(p), 0) / 3;
        // активная мощность — сумма мощностей нагрузок, ток которых прошёл через ваттметр
        const P = Math.max(...ps.map(p => Math.abs(p.P))) * Math.sign(ps[0].P || 1);
        const S = SQRT3 * u * I;
        meters[mt.id] = { U: u, I, P: P / 1000, cos: S > 1 ? clamp(P / S, 1) : 1 };
      }
    }

    // --- сигналы датчиков ДТ1–ДТ3 (ток в линиях A, B, C) и ДН1–ДН2 (напряжения A–B, B–C) ---
    for (const t of ['A', 'B', 'C']) {
      const p = probeCurrent(`sens.${t}`);
      signals[`sens.I${t}`] = { dc: p.dc, ac: p.ac };
    }
    if (nl.netOf('sens.in.A')) {
      const vp = (a, b) => csub(pot.get(nl.netOf(a)) || C(0), pot.get(nl.netOf(b)) || C(0));
      const srcA = ['sens.in.A', 'sens.in.B'].map(id => this.reach(cir, srcMap, nl.netOf(id), () => true)?.src).find(Boolean);
      const mk = (v) => {
        if (!srcA || cabs(v) < 1e-6) return { dc: 0, ac: [] };
        if (srcA.kind === 'dc') return { dc: v.re, ac: [] };
        return { dc: 0, ac: [{ rms: cabs(v), f: Math.abs(srcA.f || 50), ph: carg(v), src: srcA.src }, ...(srcA.pwm ? [{ rms: cabs(v) * 0.35, f: 1000, ph: 0, src: 'pwm' }] : [])] };
      };
      signals['sens.UAB'] = mk(vp('sens.in.A', 'sens.in.B'));
      signals['sens.UBC'] = mk(vp('sens.in.B', 'sens.in.C'));
    }
    signals.n = { dc: this.speed, ac: [] };
    signals.M = { dc: this.torque, ac: [] };
    signals.PW_P = { dc: (meters.PW?.P || 0) * 1000, ac: [] };

    // фазы источников частоты накапливаются, чтобы синусоиды были непрерывны при смене частоты
    const freqs = { mains: 50, tp: TP_RIPPLE.f, pwm: 1000 };
    for (const c of bench.converters) if (c.kind === 'fc') freqs[`fc:${c.id}`] = Math.abs(conv[c.id].f || 0);
    for (const [id, f] of Object.entries(this.rotorF || {})) freqs[`rot:${id}`] = f;
    for (const [k, f] of Object.entries(freqs)) this.theta[k] = ((this.theta[k] || 0) + 2 * Math.PI * f * dt) % (2 * Math.PI);
    this.freqs = freqs;
    this.signals = signals;
    this.tSig = this.t;

    // --- защиты стенда ---
    if (bench.protections.overspeed && Math.abs(this.speed) > bench.protections.overspeed) {
      events.push({ level: 'trip', text: `Защита: частота вращения ${Math.round(Math.abs(this.speed))} об/мин превысила ${bench.protections.overspeed} об/мин` });
    }
    const dcMotor = bench.motors.find(m => m.kind === 'dc');
    if (bench.protections.overcurrent && dcMotor && Math.abs(currents[dcMotor.id]?.arm || 0) > bench.protections.overcurrent) {
      events.push({ level: 'trip', text: `Максимально-токовая защита: ток якоря превысил ${bench.protections.overcurrent} А` });
    }

    // --- выбег: от снятия питания со всех машин до остановки ---
    if (!anyEnergized && this.wasEnergized && Math.abs(this.speed) > 30) this.coast = { n0: this.speed, t0: this.t };
    if (this.coast && (anyEnergized || this.speed === 0)) {
      if (!anyEnergized) events.push({ level: 'info', text: `Выбег: от ${Math.round(Math.abs(this.coast.n0))} об/мин до остановки за ${(this.t - this.coast.t0).toFixed(1).replace('.', ',')} с`, coast: { n0: this.coast.n0, t: this.t - this.coast.t0 } });
      this.coast = null;
    }
    this.wasEnergized = anyEnergized;

    return { potentials: pot, meters, shaft: { speed: this.speed, torque: this.torque }, motors, currents, conv, signals, events, energized: anyEnergized };
  }

  /**
   * Мгновенные значения сигналов в момент t (с, абсолютное время модели):
   * v = dc + Σ √2·rms·sin(θ_src(t) + ph), где θ_src — накопленная фаза источника частоты.
   */
  sample(t) {
    const out = {};
    const dtau = t - (this.tSig ?? t);
    for (const [id, s] of Object.entries(this.signals)) {
      let v = s.dc;
      for (const c of s.ac) {
        const f = this.freqs[c.src] ?? c.f;
        const th = (this.theta[c.src] ?? 0) + 2 * Math.PI * f * dtau;
        // ШИМ-подобный остаток: меандр несущей, промодулированный
        if (c.src === 'pwm') v += Math.SQRT2 * c.rms * (((th / (2 * Math.PI)) % 1) < 0.5 ? 1 : -1) * Math.sin(th * 0.137 + c.ph);
        else v += Math.SQRT2 * c.rms * Math.sin(th + c.ph);
      }
      out[id] = v;
    }
    return out;
  }
}
