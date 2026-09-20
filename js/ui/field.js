// Наборное поле: клеммники, графика схемы, провода и их монтаж мышью.
import { TERM } from '../benches/common.js';
const NS = 'http://www.w3.org/2000/svg';
const CLAMP_R = 4;

function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

export class Field {
  /**
   * @param container DOM-элемент
   * @param bench описание стенда
   * @param state состояние (state.wires изменяется здесь)
   * @param cb {onChange(), hint(text), canEdit():bool}
   */
  constructor(container, bench, state, cb) {
    this.container = container;
    this.bench = bench;
    this.state = state;
    this.cb = cb;
    this.nodeById = new Map(bench.field.nodes.map(n => [n.id, n]));
    this.pending = null;   // {node, clamp}
    this.selected = null;  // wire id
    this.build();
  }

  build() {
    const { w, h } = this.bench.field;
    const root = svg('svg', { viewBox: `0 0 ${w} ${h}`, class: 'field-svg' });
    this.svg = root;
    const defs = svg('defs', {}, root);
    defs.innerHTML = `
      <linearGradient id="fld-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dcd9"/><stop offset="1" stop-color="#c6cac8"/></linearGradient>
      <linearGradient id="fld-rail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6e8ea"/><stop offset=".5" stop-color="#b3b8be"/><stop offset="1" stop-color="#8e949b"/></linearGradient>
      <filter id="fld-shadow" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-opacity=".35"/></filter>`;
    svg('rect', { x: 0, y: 0, width: w, height: h, class: 'field-bg' }, root);
    const art = svg('g', { class: 'art' }, root);
    art.innerHTML = this.bench.field.art();
    this.gNodes = svg('g', { class: 'nodes' }, root);
    this.gWires = svg('g', { class: 'wires' }, root);
    this.gTemp = svg('g', { class: 'temp' }, root);
    this.clampEls = new Map(); // `${id}:${clamp}` -> circle

    for (const n of this.bench.field.nodes) {
      const g = svg('g', { class: `node c-${n.color || 'gray'}`, 'data-id': n.id, transform: `translate(${n.x},${n.y})` }, this.gNodes);
      const up = n.side === 'top';           // свободные зажимы сверху
      const dir = up ? -1 : 1;               // направление «наружу» от свободных зажимов
      const fy = dir * TERM.clampDy;         // y свободных зажимов
      const sy = -fy;                        // y зажима внутренней проводки
      // внутренняя проводка: провод уходит в кабель-канал (если он есть на пути) либо за пределы корпуса
      const wd = -dir;                       // направление внутреннего провода
      const duct = (this.bench.field.ducts || []).find(d => n.x >= d.x1 && n.x <= d.x2 &&
        (wd < 0 ? d.y + d.h <= n.y - TERM.h / 2 : d.y >= n.y + TERM.h / 2));
      const inwire = duct
        ? `M0 ${sy} L0 ${(wd < 0 ? duct.y + duct.h : duct.y) - n.y + wd * 2}`
        : `M0 ${sy} L0 ${sy + wd * 30} q0 ${wd * 6} 6 ${wd * 8}`;
      svg('path', { d: inwire, class: 'node-inwire' }, g);
      svg('rect', { x: -TERM.w / 2, y: -TERM.h / 2, width: TERM.w, height: TERM.h, rx: 2, class: 'node-body' }, g);
      svg('circle', { cx: 0, cy: sy, r: 3.2, class: 'node-hole' }, g);
      svg('rect', { x: -2.5, y: sy + (up ? 5 : -10), width: 5, height: 5, class: 'node-btn' }, g);
      // маркировочная полоска с подписью
      svg('rect', { x: -8.5, y: -6, width: 17, height: 12, rx: 1, class: 'node-inner' }, g);
      const t = svg('text', { x: 0, y: 3, class: 'node-label', 'text-anchor': 'middle' }, g);
      t.textContent = n.label;
      // два свободных push-in зажима с кнопками-фиксаторами
      for (const c of [0, 1]) {
        const cx = c === 0 ? -TERM.clampDx : TERM.clampDx;
        svg('rect', { x: cx - 2.5, y: fy + (up ? 5 : -10), width: 5, height: 5, class: 'node-btn' }, g);
        const circ = svg('circle', { cx, cy: fy, r: CLAMP_R, class: 'clamp' }, g);
        svg('circle', { cx, cy: fy, r: 7.5, class: 'clamp-hit', 'data-node': n.id, 'data-clamp': c }, g);
        this.clampEls.set(`${n.id}:${c}`, circ);
      }
      g.addEventListener('mouseenter', () => this.cb.hint(this.nodeHint(n)));
      g.addEventListener('mouseleave', () => this.cb.hint(''));
    }

    root.addEventListener('click', e => this.onClick(e));
    root.addEventListener('contextmenu', e => { e.preventDefault(); this.onContext(e); });
    root.addEventListener('mousemove', e => this.onMove(e));
    window.addEventListener('keydown', e => this.onKey(e));

    this.container.innerHTML = '';
    this.scroller = document.createElement('div');
    this.scroller.className = 'field-scroll';
    this.scroller.appendChild(root);
    this.container.appendChild(this.scroller);
    this.zoom = 1;
    root.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.cb.onZoom?.(this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    }, { passive: false });
    this.door = document.createElement('div');
    this.door.className = 'door';
    this.door.innerHTML = '<div class="door-glass"></div><div class="door-handle"></div>';
    this.container.appendChild(this.door);
    this.refreshWires();
  }

  nodeHint(n) {
    const group = n.id.split('.')[0];
    const names = this.bench.field.names || {};
    return `${names[group] || group}: клемма «${n.label}»`;
  }

  toSvg(e) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  /** Положение свободного зажима и направление выхода провода (−1 вверх, +1 вниз). */
  clampPos(ref) {
    const n = this.nodeById.get(ref.node);
    const dir = n.side === 'top' ? -1 : 1;
    return { x: n.x + (ref.clamp === 0 ? -TERM.clampDx : TERM.clampDx), y: n.y + dir * TERM.clampDy, dir };
  }

  clampBusy(ref) {
    return this.state.wires.some(w => (w.a.node === ref.node && w.a.clamp === ref.clamp) || (w.b.node === ref.node && w.b.clamp === ref.clamp));
  }

  /** Провод выходит из зажима в его сторону (dir), затем провисает к другому зажиму. */
  wirePath(p1, p2) {
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const lead = Math.min(150, 30 + d * 0.3);
    const d1 = p1.dir ?? 1, d2 = p2.dir ?? 0;
    return `M${p1.x} ${p1.y} C${p1.x} ${p1.y + d1 * lead}, ${p2.x} ${p2.y + d2 * lead}, ${p2.x} ${p2.y}`;
  }

  refreshWires() {
    this.gWires.innerHTML = '';
    for (const c of this.clampEls.values()) c.classList.remove('busy');
    for (const w of this.state.wires) {
      const p1 = this.clampPos(w.a), p2 = this.clampPos(w.b);
      const g = svg('g', { class: 'wire' + (w.id === this.selected ? ' selected' : ''), 'data-id': w.id }, this.gWires);
      const d = this.wirePath(p1, p2);
      svg('path', { d, class: 'wire-hit' }, g);
      svg('path', { d, class: 'wire-shadow' }, g);
      svg('path', { d, class: 'wire-core', stroke: w.color }, g);
      svg('path', { d, class: 'wire-gloss' }, g);
      for (const p of [p1, p2]) svg('circle', { cx: p.x, cy: p.y, r: 4, class: 'wire-end', fill: w.color }, g);
      this.clampEls.get(`${w.a.node}:${w.a.clamp}`)?.classList.add('busy');
      this.clampEls.get(`${w.b.node}:${w.b.clamp}`)?.classList.add('busy');
    }
  }

  onClick(e) {
    const clamp = e.target.closest('.clamp-hit');
    if (clamp) {
      if (!this.cb.canEdit()) { this.cb.hint('Откройте дверь монтажного отсека, чтобы менять схему', true); return; }
      const ref = { node: clamp.dataset.node, clamp: +clamp.dataset.clamp };
      if (this.clampBusy(ref)) { this.cb.hint('Зажим занят — в один пружинный зажим входит один провод', true); return; }
      if (!this.pending) {
        this.pending = ref;
        this.clampEls.get(`${ref.node}:${ref.clamp}`)?.classList.add('pending');
        this.cb.hint('Выберите второй зажим (Esc — отмена)');
      } else {
        if (this.pending.node === ref.node && this.pending.clamp === ref.clamp) { this.cancelPending(); return; }
        if (this.pending.node === ref.node) { this.cb.hint('Оба зажима одного клеммника уже соединены шиной', true); return; }
        this.state.wires.push({ id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, a: this.pending, b: ref, color: this.state.wireColor });
        this.cancelPending();
        this.refreshWires();
        this.cb.onChange();
      }
      return;
    }
    const wire = e.target.closest('.wire');
    if (wire) {
      this.selected = wire.dataset.id;
      this.refreshWires();
      this.cb.hint('Провод выбран: Delete — удалить, правая кнопка — удалить сразу');
      return;
    }
    if (this.pending) this.cancelPending();
    if (this.selected) { this.selected = null; this.refreshWires(); }
  }

  onContext(e) {
    const wire = e.target.closest('.wire');
    if (wire && this.cb.canEdit()) this.removeWire(wire.dataset.id);
  }

  onKey(e) {
    if (e.key === 'Escape') this.cancelPending();
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && this.cb.canEdit()) {
      if (document.activeElement && /input|textarea/i.test(document.activeElement.tagName)) return;
      this.removeWire(this.selected);
    }
  }

  removeWire(id) {
    this.state.wires = this.state.wires.filter(w => w.id !== id);
    if (this.selected === id) this.selected = null;
    this.refreshWires();
    this.cb.onChange();
  }

  onMove(e) {
    if (!this.pending) return;
    const p = this.toSvg(e);
    const p1 = this.clampPos(this.pending);
    this.gTemp.innerHTML = '';
    svg('path', { d: this.wirePath(p1, p), class: 'wire-temp', stroke: this.state.wireColor }, this.gTemp);
  }

  cancelPending() {
    if (this.pending) this.clampEls.get(`${this.pending.node}:${this.pending.clamp}`)?.classList.remove('pending');
    this.pending = null;
    this.gTemp.innerHTML = '';
    this.cb.hint('');
  }

  clearWires() {
    this.state.wires = [];
    this.selected = null;
    this.refreshWires();
    this.cb.onChange();
  }

  setWires(wires) {
    this.state.wires = wires;
    this.selected = null;
    this.refreshWires();
    this.cb.onChange();
  }

  setZoom(z) {
    this.zoom = Math.max(1, Math.min(4, z));
    this.svg.style.width = `${this.zoom * 100}%`;
    this.container.classList.toggle('zoomed', this.zoom > 1);
    return this.zoom;
  }

  highlight(ids) {
    const set = new Set(ids);
    for (const g of this.gNodes.children) g.classList.toggle('hl', set.has(g.dataset.id));
  }

  setDoor(open) {
    this.door.classList.toggle('open', open);
    this.container.classList.toggle('editable', open);
    if (!open) this.cancelPending();
  }

  /** Индикация напряжения на клеммах по нетлисту из runtime. */
  update(view) {
    const nl = view.nl;
    for (const g of this.gNodes.children) {
      const net = nl.netOf(g.dataset.id);
      let cls = '';
      if (net && net.sources.length) {
        const s = net.sources[0];
        cls = s.kind === 'ac' ? (s.phase === 'N' ? 'live-n' : 'live-ac') : s.kind === 'dc' ? (s.pol === '+' ? 'live-dc' : 'live-n') : 'live-conv';
      }
      for (const c of ['live-ac', 'live-n', 'live-dc', 'live-conv']) g.classList.toggle(c, c === cls);
    }
    // цвет проводов под напряжением — лёгкое свечение
    for (const g of this.gWires.children) {
      const w = this.state.wires.find(w => w.id === g.dataset.id);
      const net = w && nl.netOf(w.a.node);
      g.classList.toggle('energized', !!(net && net.sources.length));
    }
  }
}
