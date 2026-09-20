// Логика работы стенда в реальном времени: автоматы, вводы, цепь управления
// с контакторами, преобразователи, защиты. На каждом шаге строит нетлист,
// вызывает модель привода и отдаёт «вид» для отрисовки.
import { buildNetlist } from './netlist.js';
import { checkShorts } from './checks.js';

export class BenchRuntime {
  constructor(bench, state, model, log) {
    this.bench = bench;
    this.state = state;
    this.model = model;
    this.log = log;
    this.rt = {
      contactors: Object.fromEntries(bench.contactors.map(k => [k.id, false])),
      timers: Object.fromEntries(bench.contactors.map(k => [k.id, 0])),
      conv: Object.fromEntries(bench.converters.map(c => [c.id, { powered: false, running: false, fault: null, ramp: 0, bypass: false }])),
      chainLive: false,
      tripFlash: 0,
      lastShortKey: '',
    };
    this.view = null;
  }

  // ---------- действия пользователя ----------

  toggleBreaker(id) {
    const b = this.bench.breakers.find(b => b.id === id);
    const st = this.state.breakers;
    if (st[id]) {
      st[id] = false;
      this.log.info(`Автомат «${b.label}» выключен`);
    } else {
      st[id] = true;
      this.log.info(`Автомат «${b.label}» включён`);
    }
    this.afterPowerChange();
  }

  pressEstop() {
    this.state.estop = !this.state.estop;
    if (this.state.estop) {
      this.log.error('АВАРИЙНОЕ ОТКЛЮЧЕНИЕ: монтажный отсек обесточен');
      this.tripAll('аварийная кнопка');
    } else this.log.info('Кнопка аварийного отключения возвращена');
    this.afterPowerChange();
  }

  toggleDoor() {
    const s = this.state;
    if (s.door) {
      s.door = false;
      this.log.info('Дверь монтажного отсека закрыта');
    } else {
      const wasLive = Object.values(s.inputs).some(Boolean);
      s.door = true;
      if (wasLive) {
        this.log.error('Дверь открыта под напряжением — сработал независимый расцепитель');
        this.tripAll('открыта дверь');
      } else this.log.info('Дверь монтажного отсека открыта — можно собирать схему');
    }
    this.afterPowerChange();
  }

  setInput(id, on) {
    const inp = this.bench.inputs.find(i => i.id === id);
    const s = this.state;
    if (!on) {
      if (s.inputs[id]) this.log.info(`${inp.label} ${inp.voltage}: выключен`);
      s.inputs[id] = false;
      return;
    }
    if (s.door) { this.log.warn(`${inp.label}: нельзя подать питание — открыта дверь монтажного отсека`); return; }
    if (!this.breakerLive(inp.breaker)) {
      const b = this.bench.breakers.find(b => b.id === inp.breaker);
      this.log.warn(`${inp.label}: нет питания — не включён автомат «${b.label}»`);
      return;
    }
    // проверка на КЗ до подачи напряжения (как сработает защита сразу после включения)
    s.inputs[id] = true;
    const live = this.liveState();
    const nl = buildNetlist(this.bench, s.wires, live);
    const shorts = checkShorts(this.bench, nl).filter(m => m.level === 'error');
    if (shorts.length) {
      s.inputs[id] = false;
      for (const m of shorts) this.log.error(m.text, m.nodes);
      this.tripFor(inp);
      return;
    }
    this.log.ok(`${inp.label} ${inp.voltage}: подано напряжение в монтажный отсек`);
  }

  pressStart(down) { this.state.ctrl.start = down; }
  pressStop(down) { this.state.ctrl.stop = down; }

  convCommand(id, on) {
    const c = this.bench.converters.find(c => c.id === id);
    const cs = this.state.conv[id];
    const r = this.rt.conv[id];
    if (on) {
      if (!r.powered) { this.log.warn(`${c.title}: нет питания на входе (A, B, C) или не включён автомат ~220 В`); return; }
      cs.on = true; r.fault = null;
      this.log.ok(`${c.title}: пуск`);
    } else {
      cs.on = false;
      this.log.info(`${c.title}: останов`);
    }
  }

  // ---------- внутреннее ----------

  breakerLive(id) {
    const s = this.state;
    if (s.estop) return false;
    const b = this.bench.breakers.find(b => b.id === id);
    if (!b || !s.breakers[id]) return false;
    return (b.needs || []).every(n => this.breakerLive(n));
  }

  tripAll(reason) {
    const s = this.state;
    for (const b of this.bench.breakers) if (b.trip && s.breakers[b.id]) { s.breakers[b.id] = false; this.log.warn(`Расцепитель: автомат «${b.label}» отключён (${reason})`); }
    for (const k of Object.keys(s.inputs)) s.inputs[k] = false;
    this.rt.tripFlash = 1.5;
  }

  tripFor(inp) {
    const s = this.state;
    const b = this.bench.breakers.find(b => b.id === inp.breaker);
    if (b && b.trip) { s.breakers[b.id] = false; this.log.warn(`Расцепитель: автомат «${b.label}» отключён`); }
    for (const i of this.bench.inputs) if (i.breaker === inp.breaker) s.inputs[i.id] = false;
    this.rt.tripFlash = 1.5;
  }

  afterPowerChange() {
    const s = this.state;
    for (const inp of this.bench.inputs) {
      if (s.inputs[inp.id] && (!this.breakerLive(inp.breaker) || s.door)) s.inputs[inp.id] = false;
    }
  }

  liveState() {
    const s = this.state;
    return {
      inputs: Object.fromEntries(this.bench.inputs.map(i => [i.id, !!s.inputs[i.id] && this.breakerLive(i.breaker) && !s.door])),
      converters: Object.fromEntries(this.bench.converters.map(c => [c.id, this.rt.conv[c.id].running])),
      contactors: { ...this.rt.contactors },
      bypass: Object.fromEntries(this.bench.converters.map(c => [c.id, this.rt.conv[c.id].bypass])),
    };
  }

  /** Есть ли напряжение между X1 и X2 цепи управления. */
  chainEnergized(nl) {
    const { X1, X2 } = this.bench.ctrlChain;
    const a = nl.netOf(X1).sources, b = nl.netOf(X2).sources;
    if (!a.length || !b.length) return false;
    const ph = s => s.kind === 'ac' && s.phase !== 'N';
    const nn = s => s.kind === 'ac' && s.phase === 'N';
    return (a.some(ph) && b.some(nn)) || (a.some(nn) && b.some(ph));
  }

  /** Три различные фазы сети на входе преобразователя? */
  convPowered(c, nl) {
    if (!this.breakerLive('aux220')) return false;
    const ph = Object.values(c.in).map(n => nl.netOf(n).sources.find(s => s.kind === 'ac' && s.phase !== 'N')?.phase);
    return ph.every(Boolean) && new Set(ph).size === 3;
  }

  tick(dt) {
    const s = this.state, rt = this.rt, bench = this.bench;
    const aux = this.breakerLive('aux220');
    this.afterPowerChange();

    // 1. нетлист по предыдущему состоянию контакторов/преобразователей
    let nl = buildNetlist(bench, s.wires, this.liveState());

    // 2. цепь управления и контакторы с выдержкой времени
    const live = this.chainEnergized(nl);
    rt.chainLive = live;
    const km1 = bench.contactors[0];
    if (!live || s.ctrl.stop) {
      for (const k of bench.contactors) { rt.contactors[k.id] = false; rt.timers[k.id] = 0; }
    } else {
      if (s.ctrl.start) rt.contactors[km1.id] = true;
      for (const k of bench.contactors.slice(1)) {
        const prev = rt.contactors[k.after];
        if (prev) {
          rt.timers[k.id] += dt;
          const delay = 0.5 + (s.ctrl[k.timer] ?? 0) * 9.5; // 0,5…10 с
          if (rt.timers[k.id] >= delay) rt.contactors[k.id] = true;
        } else { rt.contactors[k.id] = false; rt.timers[k.id] = 0; }
      }
    }

    // 3. преобразователи
    for (const c of bench.converters) {
      const r = rt.conv[c.id], cs = s.conv[c.id];
      const powered = this.convPowered(c, nl);
      if (r.powered && !powered && r.running) {
        r.fault = aux ? 'ОБРЫВ ФАЗЫ' : null;
        if (aux) this.log.error(`${c.title}: пропало питание на входе — авария`);
      }
      r.powered = powered;
      if (!powered) { r.running = false; cs.on = false; r.ramp = 0; r.bypass = false; continue; }
      r.running = cs.on && !r.fault;
      if (c.kind === 'ss') {
        if (r.running) { r.ramp = Math.min(1, r.ramp + dt / (c.rampTime || 5)); r.bypass = r.ramp >= 1; }
        else { r.ramp = 0; r.bypass = false; }
      }
    }

    // 4. итоговый нетлист и проверка на КЗ во время работы
    const liveNow = this.liveState();
    nl = buildNetlist(bench, s.wires, liveNow);
    const anyLive = Object.values(liveNow.inputs).some(Boolean) || Object.values(liveNow.converters).some(Boolean);
    let shorts = [];
    if (anyLive) {
      shorts = checkShorts(bench, nl).filter(m => m.level === 'error');
      if (shorts.length) {
        const key = shorts.map(m => m.text).join('|');
        if (key !== rt.lastShortKey) for (const m of shorts) this.log.error(m.text, m.nodes);
        rt.lastShortKey = key;
        // отключаем задействованные вводы (расцепители)
        const involved = new Set(shorts.flatMap(m => m.inputs || []));
        for (const inp of bench.inputs) if (involved.has(inp.id) && s.inputs[inp.id]) this.tripFor(inp);
        for (const c of bench.converters) if (rt.conv[c.id].running) { rt.conv[c.id].running = false; rt.conv[c.id].fault = 'КЗ НА ВЫХОДЕ'; s.conv[c.id].on = false; }
        nl = buildNetlist(bench, s.wires, this.liveState());
      } else rt.lastShortKey = '';
    } else rt.lastShortKey = '';

    // 5. модель привода
    const convCtx = {};
    for (const c of bench.converters) {
      const r = rt.conv[c.id], cs = s.conv[c.id];
      const mode = c.modes.find(m => m.id === cs.mode) || c.modes[0];
      convCtx[c.id] = {
        powered: r.powered, running: r.running, mode: mode?.id ?? null,
        ref: mode ? cs.ref * mode.max * (c.controls.includes('polarity') ? cs.polarity : 1) : 0,
        refUnit: mode?.unit ?? '', fieldRef: c.fieldCol ? cs.fieldRef * c.fieldCol.max : null,
        ramp: r.ramp, bypass: r.bypass, setup: cs.setup,
      };
    }
    const sim = this.model.step({ dt, nl, bench, converters: convCtx, contactors: { ...rt.contactors } });

    // 6. защиты по результатам модели
    for (const ev of sim.events) {
      if (ev.level === 'trip') {
        if (Object.values(liveNow.inputs).some(Boolean) || Object.values(liveNow.converters).some(Boolean)) {
          this.log.error(ev.text);
          this.tripAll('защита');
          for (const c of bench.converters) { rt.conv[c.id].running = false; s.conv[c.id].on = false; }
        }
      } else this.log.push(ev.level, ev.text);
    }
    if (rt.tripFlash > 0) rt.tripFlash -= dt;

    this.view = { nl, sim, live: liveNow, aux, conv: convCtx, rt, shorts };
    return this.view;
  }
}
