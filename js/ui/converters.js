// Преобразователи (лицевые панели) и органы управления ими.
import { shortName } from '../core/netlist.js';

function knobControl({ cls, label, positions, value, onChange }) {
  // positions: [{id, label, deg}]
  const w = document.createElement('div');
  w.className = `ctl ${cls}`;
  w.innerHTML = `<div class="ctl-tag">${label}</div>
    <div class="selector">
      <div class="sel-labels">${positions.map(p => `<span style="--deg:${p.deg}deg">${p.label}</span>`).join('')}</div>
      <div class="sel-knob"><div class="sel-mark"></div></div>
    </div>`;
  const knob = w.querySelector('.sel-knob');
  const set = (v, fire = true) => {
    value = v;
    const p = positions.find(p => p.id === v) || positions[0];
    knob.style.transform = `rotate(${p.deg}deg)`;
    for (const [i, s] of [...w.querySelectorAll('.sel-labels span')].entries()) s.classList.toggle('active', positions[i].id === p.id);
    if (fire) onChange(p.id);
  };
  knob.addEventListener('click', () => {
    const i = positions.findIndex(p => p.id === value);
    set(positions[(i + 1) % positions.length].id);
  });
  set(value, false);
  return { el: w, set: v => set(v, false) };
}

function potControl({ label, value, format, onChange }) {
  const w = document.createElement('div');
  w.className = 'ctl pot';
  w.innerHTML = `<div class="ctl-tag">${label}</div>
    <div class="pot-knob" title="Крутить: перетаскивание или колесо мыши"><div class="pot-mark"></div></div>
    <div class="pot-scale"><span>0</span><span>10</span></div>
    <div class="pot-value"></div>`;
  const knob = w.querySelector('.pot-knob');
  const val = w.querySelector('.pot-value');
  let v = value;
  const render = () => {
    knob.style.transform = `rotate(${-135 + v * 270}deg)`;
    val.textContent = format(v);
  };
  const set = (nv, fire = true) => { v = Math.max(0, Math.min(1, nv)); render(); if (fire) onChange(v); };
  knob.addEventListener('wheel', e => { e.preventDefault(); set(v - Math.sign(e.deltaY) * 0.02); });
  let drag = null;
  knob.addEventListener('pointerdown', e => { drag = { y: e.clientY, v }; knob.setPointerCapture(e.pointerId); });
  knob.addEventListener('pointermove', e => { if (drag) set(drag.v + (drag.y - e.clientY) / 150); });
  knob.addEventListener('pointerup', () => { drag = null; });
  knob.addEventListener('dblclick', () => set(0));
  render();
  return { el: w, set: nv => { v = nv; render(); }, setFormat: f => { format = f; render(); } };
}

function pushButton(label, cls, onPress) {
  const w = document.createElement('div');
  w.className = `ctl push ${cls}`;
  w.innerHTML = `<div class="ctl-tag">${label}</div><button class="push-btn"><span></span></button>`;
  w.querySelector('button').addEventListener('click', onPress);
  return { el: w };
}

export class ConverterPanel {
  constructor(container, bench, conv, runtime) {
    this.bench = bench;
    this.conv = conv;
    this.rt = runtime;
    this.cs = runtime.state.conv[conv.id];
    this._lastRef = this.cs.ref;
    this.el = document.createElement('div');
    this.el.className = `conv-unit conv-${conv.kind}`;
    container.appendChild(this.el);
    this.build();
  }

  build() {
    const c = this.conv;
    const wrap = document.createElement('div');
    wrap.className = 'conv-wrap';
    this.el.innerHTML = `<div class="conv-title">${c.title}</div>`;
    this.el.appendChild(wrap);
    wrap.appendChild(this.buildFace());

    // левый столбец (только ТП на стенде ДПТ): задание тока возбуждения
    if (c.fieldCol) {
      const col = document.createElement('div');
      col.className = 'ctl-col';
      this.fieldPot = potControl({
        label: 'ЗАДАНИЕ', value: this.cs.fieldRef,
        format: v => `${(v * c.fieldCol.max).toFixed(2)} А`,
        onChange: v => { this.cs.fieldRef = v; this.rt.log.info(`${c.title}: задание тока возбуждения ${(v * c.fieldCol.max).toFixed(2)} А`); },
      });
      col.appendChild(this.fieldPot.el);
      col.appendChild(pushButton('ВКЛ.', 'green', () => this.rt.log.info(`${c.title}: кнопка левого столбца не задействована`)).el);
      col.appendChild(pushButton('ВЫКЛ.', 'red', () => this.rt.log.info(`${c.title}: кнопка левого столбца не задействована`)).el);
      const cap = document.createElement('div');
      cap.className = 'ctl-col-cap';
      cap.textContent = 'Возбуждение';
      col.appendChild(cap);
      wrap.appendChild(col);
    }

    const col = document.createElement('div');
    col.className = 'ctl-col';
    const has = id => c.controls.includes(id);
    if (has('setup')) {
      this.setupSel = knobControl({
        cls: 'sel2', label: 'НАСТРОЙКА', value: this.cs.setup,
        positions: [{ id: 'man', label: 'Руч.', deg: -35 }, { id: 'fix', label: 'Фикс.', deg: 35 }],
        onChange: v => { this.cs.setup = v; this.rt.log.info(`${c.title}: настройка «${v === 'man' ? 'Ручная' : 'Фиксированная'}»`); },
      });
      col.appendChild(this.setupSel.el);
    }
    if (has('mode') && c.modes.length > 1) {
      const degs = c.modes.length === 3 ? [-40, 0, 40] : [-35, 35];
      this.modeSel = knobControl({
        cls: 'sel3', label: 'СТАБИЛИЗАЦИЯ', value: this.cs.mode,
        positions: c.modes.map((m, i) => ({ id: m.id, label: m.label, deg: degs[i] })),
        onChange: v => { this.cs.mode = v; this.refPot.setFormat(this.refFormat()); this.rt.log.info(`${c.title}: стабилизация «${c.modes.find(m => m.id === v).label}»`); },
      });
      col.appendChild(this.modeSel.el);
    }
    if (has('polarity')) {
      this.polSel = knobControl({
        cls: 'sel2', label: 'ПОЛЯРНОСТЬ ЗАДАНИЯ', value: this.cs.polarity,
        positions: [{ id: 1, label: '+', deg: -35 }, { id: -1, label: '−', deg: 35 }],
        onChange: v => { this.cs.polarity = v; },
      });
      col.appendChild(this.polSel.el);
    }
    if (has('ref')) {
      this.refPot = potControl({ label: 'ЗАДАНИЕ', value: this.cs.ref, format: this.refFormat(), onChange: v => { this.cs.ref = v; } });
      col.appendChild(this.refPot.el);
    }
    if (has('on')) col.appendChild(pushButton('ВКЛ.', 'green', () => this.rt.convCommand(c.id, true)).el);
    if (has('off')) col.appendChild(pushButton('ВЫКЛ.', 'red', () => this.rt.convCommand(c.id, false)).el);
    wrap.appendChild(col);
  }

  refFormat() {
    const c = this.conv;
    return v => {
      const m = c.modes.find(m => m.id === this.cs.mode) || c.modes[0];
      if (!m) return '';
      const val = v * m.max;
      return `${(m.max >= 100 ? Math.round(val) : val.toFixed(1)).toString().replace('.', ',')} ${m.unit}`;
    };
  }

  buildFace() {
    const c = this.conv;
    const f = document.createElement('div');
    f.className = `conv-face face-${c.kind}`;
    if (c.kind === 'dc') {
      f.innerHTML = `
        <div class="face-dcs">
          <div class="dcs-model">ТП</div>
          <div class="dcs-panel">
            <div class="lcd"><div class="lcd-l1"></div><div class="lcd-l2"></div><div class="lcd-l3"></div></div>
            <div class="keys"><span>▲</span><span>▼</span><span>◀</span><span>▶</span></div>
            <div class="keys2"><span class="k-stop">STOP</span><span class="k-start">START</span></div>
          </div>
          <div class="dcs-curve"></div>
        </div>`;
    } else if (c.kind === 'fc') {
      f.innerHTML = `
        <div class="face-acs">
          <div class="acs-panel">
            <div class="lcd"><div class="lcd-l1"></div><div class="lcd-l2"></div><div class="lcd-l3"></div></div>
            <div class="keys"><span>◁</span><span>▲</span><span>▷</span><span>◀</span><span>▼</span><span>▶</span></div>
            <div class="keys2"><span class="k-stop">Stop</span><span class="k-lr">Loc/Rem</span><span class="k-start">Start</span></div>
          </div>
          <div class="acs-brand">ПЧ</div>
          <div class="acs-warn">⚠</div>
        </div>`;
    } else {
      f.innerHTML = `
        <div class="face-pst">
          <div class="pst-terms">${'<i></i>'.repeat(12)}</div>
          <div class="pst-brand">ТПН</div>
          <div class="pst-leds"><span data-led="on">Power on</span><span data-led="fault">Fault</span><span data-led="prot">Protection</span></div>
          <div class="pst-panel">
            <div class="lcd"><div class="lcd-l1"></div><div class="lcd-l2"></div></div>
            <div class="keys"><span>◀</span><span>▶</span><span>▲</span><span>▼</span></div>
          </div>
          <div class="pst-label"></div>
        </div>`;
    }
    this.lcd = [...f.querySelectorAll('.lcd > div')];
    this.leds = { on: f.querySelector('[data-led=on]'), fault: f.querySelector('[data-led=fault]'), prot: f.querySelector('[data-led=prot]') };
    return f;
  }

  update(view) {
    const c = this.conv;
    const cv = view.conv[c.id];
    const r = view.rt.conv[c.id];
    const sh = view.sim.shaft;
    this.el.classList.toggle('powered', cv.powered);
    this.el.classList.toggle('running', cv.running);
    this.el.classList.toggle('fault', !!r.fault);
    let lines;
    if (!cv.powered) lines = ['', '', ''];
    else if (r.fault) lines = ['АВАРИЯ', r.fault, 'нажмите ВЫКЛ.'];
    else if (!cv.running) lines = ['ГОТОВ', `${shortName(c)} ${cv.setup === 'man' ? 'РУЧ' : 'ФИКС'}`, this.refLine(cv)];
    else if (c.kind === 'ss') lines = [r.bypass ? 'БАЙПАС K4' : `ПУСК ${Math.round(cv.ramp * 100)} %`, `U = ${Math.round(220 * cv.ramp * Math.sqrt(3))} В`];
    else lines = ['РАБОТА', this.refLine(cv), `n = ${Math.round(sh.speed)} об/мин`];
    this.lcd.forEach((l, i) => { l.textContent = lines[i] ?? ''; });
    if (this.leds.on) {
      this.leds.on.classList.toggle('lit', cv.powered);
      this.leds.fault.classList.toggle('lit', !!r.fault);
      this.leds.prot.classList.toggle('lit', false);
    }
    // синхронизация органов управления с состоянием (после загрузки)
    if (this.refPot && Math.abs(this.cs.ref - this._lastRef) > 1e-9) { this.refPot.set(this.cs.ref); this._lastRef = this.cs.ref; }
  }

  refLine(cv) {
    if (cv.mode === null) return '';
    const m = this.conv.modes.find(x => x.id === cv.mode);
    const v = cv.ref;
    return `${m.label} = ${(Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)).toString().replace('.', ',')} ${m.unit}`;
  }
}
