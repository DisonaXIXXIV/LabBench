// Стрелочные приборы (квадратный корпус 96×96, шкала 90°) и анализатор сети.
const NS = 'http://www.w3.org/2000/svg';
const S = 120, CX = 60, CY = 86, R = 68, ANG = 45;

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const pt = (deg, r = R) => ({ x: CX + r * Math.sin(deg * Math.PI / 180), y: CY - r * Math.cos(deg * Math.PI / 180) });

export class Gauge {
  constructor(def) {
    this.def = def;
    this.value = 0;
    this.shown = 0;
    const root = document.createElement('div');
    root.className = 'gauge';
    const s = el('svg', { viewBox: `0 0 ${S} ${S}`, class: 'gauge-svg' });
    el('rect', { x: 1, y: 1, width: S - 2, height: S - 2, rx: 4, class: 'gauge-frame' }, s);
    el('rect', { x: 7, y: 7, width: S - 14, height: S - 14, rx: 2, class: 'gauge-face' }, s);
    // шкала
    const a0 = pt(-ANG), a1 = pt(ANG);
    el('path', { d: `M${a0.x} ${a0.y} A${R} ${R} 0 0 1 ${a1.x} ${a1.y}`, class: 'gauge-arc' }, s);
    const { min, max, ticks } = def;
    const nMinor = 5;
    for (let i = 0; i <= ticks * nMinor; i++) {
      const f = i / (ticks * nMinor);
      const deg = -ANG + f * 2 * ANG;
      const major = i % nMinor === 0;
      const p1 = pt(deg, R), p2 = pt(deg, R - (major ? 9 : 5));
      el('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: major ? 'gauge-tick' : 'gauge-tick-minor' }, s);
      if (major) {
        const v = min + f * (max - min);
        const tp = pt(deg, R - 17);
        const t = el('text', { x: tp.x, y: tp.y + 3, class: 'gauge-num', 'text-anchor': 'middle' }, s);
        t.textContent = fmtTick(v);
      }
    }
    // единицы измерения — под осью стрелки
    const unit = el('text', { x: CX, y: CY + 19, class: 'gauge-unit', 'text-anchor': 'middle' }, s);
    unit.textContent = def.unit || { V: 'V', A: 'A', n: 'об/мин', M: 'Нм' }[def.kind] || '';
    if (def.mult) {
      const m = el('text', { x: S - 12, y: S - 11, class: 'gauge-mult', 'text-anchor': 'end' }, s);
      m.textContent = `×${def.mult}`;
    }
    const idt = el('text', { x: 12, y: S - 11, class: 'gauge-id', 'text-anchor': 'start' }, s);
    idt.textContent = def.id;
    // стрелка
    this.needle = el('g', { class: 'gauge-needle' }, s);
    el('line', { x1: CX, y1: CY, x2: CX, y2: CY - R + 2, class: 'gauge-needle-line' }, this.needle);
    el('circle', { cx: CX, cy: CY, r: 5, class: 'gauge-pivot' }, s);
    el('rect', { x: 7, y: 7, width: S - 14, height: S - 14, rx: 2, class: 'gauge-glass' }, s);
    root.appendChild(s);
    const cap = document.createElement('div');
    cap.className = 'gauge-cap';
    cap.textContent = def.caption || '';
    root.appendChild(cap);
    this.el = root;
    this.setValue(0, true);
  }

  setValue(v, immediate = false) {
    const { min, max } = this.def;
    const scaled = v / (this.def.mult || 1);
    // упор стрелки чуть дальше края шкалы
    const over = (max - min) * 0.04;
    this.value = Math.max(min - over, Math.min(max + over, scaled));
    if (immediate) this.shown = this.value;
  }

  /** Плавное движение стрелки; вызывается каждый кадр. */
  animate(dt) {
    this.shown += (this.value - this.shown) * Math.min(1, dt * 6);
    const { min, max } = this.def;
    const f = (this.shown - min) / (max - min);
    const deg = -ANG + f * 2 * ANG;
    this.needle.setAttribute('transform', `rotate(${deg} ${CX} ${CY})`);
  }
}

function fmtTick(v) {
  const s = Math.abs(v) < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v));
  return s.replace('.', ',');
}

/** Анализатор сети: цифровые показания. */
export class PowerAnalyzer {
  constructor(def) {
    this.def = def;
    const root = document.createElement('div');
    root.className = 'gauge pw';
    root.innerHTML = `
      <div class="pw-frame">
        <div class="pw-brand">Анализатор сети</div>
        <div class="pw-lcd">
          <div class="pw-row"><span>U</span><b data-k="U">---</b><i>В</i></div>
          <div class="pw-row"><span>I</span><b data-k="I">---</b><i>А</i></div>
          <div class="pw-row"><span>P</span><b data-k="P">---</b><i>кВт</i></div>
        </div>
        <div class="pw-keys"><span>◀</span><span>▶</span><span>▲</span><span>▼</span><span class="ok">OK</span></div>
        <div class="pw-sub">U · I · P</div>
      </div>
      <div class="gauge-cap">PW</div>`;
    this.el = root;
    this.cells = { U: root.querySelector('[data-k=U]'), I: root.querySelector('[data-k=I]'), P: root.querySelector('[data-k=P]') };
  }
  setValue(v, powered) {
    if (!powered) { for (const c of Object.values(this.cells)) c.textContent = ''; this.el.classList.remove('on'); return; }
    this.el.classList.add('on');
    if (!v) v = { U: 0, I: 0, P: 0 };
    this.cells.U.textContent = v.U.toFixed(0);
    this.cells.I.textContent = v.I.toFixed(1);
    this.cells.P.textContent = v.P.toFixed(2);
  }
  animate() {}
}
