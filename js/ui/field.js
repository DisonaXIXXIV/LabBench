// Наборное поле: клеммники, графика схемы, провода и их монтаж мышью.
const NS = 'http://www.w3.org/2000/svg';
const BODY_W = 18, BODY_H = 44, CLAMP_DY = 13, CLAMP_R = 5;

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
    svg('rect', { x: 0, y: 0, width: w, height: h, class: 'field-bg' }, root);
    const art = svg('g', { class: 'art' }, root);
    art.innerHTML = this.bench.field.art();
    this.gNodes = svg('g', { class: 'nodes' }, root);
    this.gWires = svg('g', { class: 'wires' }, root);
    this.gTemp = svg('g', { class: 'temp' }, root);
    this.clampEls = new Map(); // `${id}:${clamp}` -> circle

    for (const n of this.bench.field.nodes) {
      const g = svg('g', { class: 'node', 'data-id': n.id, transform: `translate(${n.x},${n.y})` }, this.gNodes);
      svg('rect', { x: -BODY_W / 2, y: -BODY_H / 2, width: BODY_W, height: BODY_H, rx: 2, class: 'node-body' }, g);
      svg('rect', { x: -BODY_W / 2 + 3, y: -BODY_H / 2 + 3, width: BODY_W - 6, height: BODY_H - 6, rx: 1, class: 'node-inner' }, g);
      const t = svg('text', { x: 0, y: 3.5, class: 'node-label', 'text-anchor': 'middle' }, g);
      t.textContent = n.label;
      for (const c of [0, 1]) {
        const cy = c === 0 ? -CLAMP_DY : CLAMP_DY;
        const circ = svg('circle', { cx: 0, cy, r: CLAMP_R, class: 'clamp', 'data-node': n.id, 'data-clamp': c }, g);
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
    const names = {
      in1: 'Ввод 1 ~380 В', in2: 'Ввод 2 ~380 В', in3: 'Ввод 3 =240 В', ctrl: 'Цепь управления',
      km1: 'Контакты KM1', km2: 'Контакты KM2', km3: 'Контакты KM3', tp: 'ТП', fc: 'ПЧ', tpn: 'ТПН', pw: 'Ваттметр PW', sens: 'Датчики',
      m1: 'М1 ДПТ', m2: 'М2 СДПМ', m3: 'М3 статор', m3r: 'М3 ротор', m4: 'М4', r1: 'Резистор',
    };
    return `${names[group] || group}: клемма «${n.label}»`;
  }

  toSvg(e) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  clampPos(ref) {
    const n = this.nodeById.get(ref.node);
    return { x: n.x, y: n.y + (ref.clamp === 0 ? -CLAMP_DY : CLAMP_DY) };
  }

  clampBusy(ref) {
    return this.state.wires.some(w => (w.a.node === ref.node && w.a.clamp === ref.clamp) || (w.b.node === ref.node && w.b.clamp === ref.clamp));
  }

  wirePath(p1, p2) {
    const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const sag = Math.min(140, 28 + d * 0.18);
    return `M${p1.x} ${p1.y} C${p1.x} ${p1.y + sag}, ${p2.x} ${p2.y + sag}, ${p2.x} ${p2.y}`;
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
      for (const p of [p1, p2]) svg('circle', { cx: p.x, cy: p.y, r: 4.5, class: 'wire-end', fill: w.color }, g);
      this.clampEls.get(`${w.a.node}:${w.a.clamp}`)?.classList.add('busy');
      this.clampEls.get(`${w.b.node}:${w.b.clamp}`)?.classList.add('busy');
    }
  }

  onClick(e) {
    const clamp = e.target.closest('.clamp');
    if (clamp) {
      if (!this.cb.canEdit()) { this.cb.hint('Откройте дверь монтажного отсека, чтобы менять схему', true); return; }
      const ref = { node: clamp.dataset.node, clamp: +clamp.dataset.clamp };
      if (this.clampBusy(ref)) { this.cb.hint('Зажим занят — в один пружинный зажим входит один провод', true); return; }
      if (!this.pending) {
        this.pending = ref;
        clamp.classList.add('pending');
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
