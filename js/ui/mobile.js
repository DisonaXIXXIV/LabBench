// Мобильная компоновка: миникарта стенда (схематичный фасад) и показ одной
// «зоны» стенда за раз. Зоны — те же DOM-элементы, что и шкафы на десктопе;
// здесь только переключается, какой из них виден, и рисуется карта.
const NS = 'http://www.w3.org/2000/svg';
const MQ = '(max-width: 1000px)';

function svg(tag, attrs = {}, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

/* геометрия миникарты (viewBox 400×142): ширины шкафов пропорциональны реальным */
const W = 400, H = 142;
const CAB = { x: 3, y: 4, h: 88 };
const COLS = [['pc', 64], ['conv', 78], ['field', 130], ['power', 115]];
const TABLE_Y = CAB.y + CAB.h, BASE_Y = TABLE_Y + 5, BASE_H = H - BASE_Y - 3;
const FIELD_SPLIT = 0.42; // доля верхней части шкафа с приборами (ниже — дверь монтажного отсека)

export class MobileLayout {
  /**
   * @param app экземпляр App: bench, state, rt, setFieldOpen, fit, hint
   */
  constructor(app) {
    this.app = app;
    this.active = false;
    this.zone = localStorage.getItem('abblab.zone') || 'meters';
    this.root = document.getElementById('minimap');
    this.mq = window.matchMedia(MQ);
    this.mq.addEventListener('change', () => this.apply());
    this.buildNav();
  }

  /** Зоны стенда: id → элемент(ы), подпись на карте и в шапке зоны. */
  zones() {
    const L = this.app.bench.layout;
    const kinds = { dc: 'ТП', ss: 'ТПН', fc: 'ПЧ' };
    const convIn = cab => this.app.bench.converters.filter(c => (c.cabinet || L.conv) === cab).map(c => kinds[c.kind] || c.kind);
    return [
      { id: 'pc', title: `${L.pc} · ПК, диагностика`, map: 'ПК', els: ['#cab-pc'] },
      { id: 'conv', title: `${L.conv} · ${convIn(L.conv).join(', ')}`, map: convIn(L.conv).join('·'), els: ['#cab-conv'] },
      { id: 'meters', title: `${L.field} · вводы, приборы, пуск/стоп`, map: 'Приборы', els: ['#cab-field'] },
      { id: 'field', title: `${L.field} · наборное поле`, map: 'Поле', els: ['.cab-row-field'] },
      { id: 'power', title: `${L.power} · автоматы, ${convIn(L.power).join(', ') || 'ПЧ'}`, map: `Автоматы · ${convIn(L.power).join('·') || 'ПЧ'}`, els: ['#cab-power'] },
      { id: 'motors', title: 'Двухмашинный агрегат', map: 'Агрегат', els: ['.base-motors'] },
    ];
  }

  buildNav() {
    this.root.innerHTML = `
      <div class="mm-svg"></div>
      <div class="mm-bar">
        <button class="mm-prev" title="Предыдущая зона">◀</button>
        <button class="mm-title" title="Свернуть или развернуть карту стенда"><span></span><i class="mm-caret"></i></button>
        <button class="mm-next" title="Следующая зона">▶</button>
      </div>`;
    this.root.querySelector('.mm-prev').addEventListener('click', () => this.step(-1));
    this.root.querySelector('.mm-next').addEventListener('click', () => this.step(1));
    // карту можно свернуть до строки с названием зоны — больше места под поле
    this.root.querySelector('.mm-title').addEventListener('click', () => this.collapse(!this.root.classList.contains('collapsed')));
    this.collapse(localStorage.getItem('abblab.mapCollapsed') === '1');
  }

  collapse(on) {
    this.root.classList.toggle('collapsed', on);
    localStorage.setItem('abblab.mapCollapsed', on ? '1' : '0');
  }

  step(d) {
    const z = this.zones();
    const i = z.findIndex(x => x.id === this.zone);
    this.select(z[(i + d + z.length) % z.length].id);
  }

  /** Перестроить карту под текущий стенд (вызывается из App.mount). */
  mount() {
    this.drawMap();
    this.apply();
  }

  /** Включить/выключить мобильный режим по медиазапросу. */
  apply() {
    const on = this.mq.matches;
    if (on !== this.active) {
      this.active = on;
      document.body.classList.toggle('mobile', on);
      this.app.onModeChange?.(on);
    }
    if (on) this.select(this.zone, false);
    else for (const el of document.querySelectorAll('.zone-active')) el.classList.remove('zone-active');
  }

  select(id, save = true) {
    const zs = this.zones();
    if (!zs.some(z => z.id === id)) id = zs[0].id;
    this.zone = id;
    if (save) localStorage.setItem('abblab.zone', id);
    for (const el of document.querySelectorAll('.zone-active')) el.classList.remove('zone-active');
    const z = zs.find(z => z.id === id);
    for (const s of z.els) document.querySelector(s)?.classList.add('zone-active');
    for (const g of this.root.querySelectorAll('.mm-zone')) g.classList.toggle('active', g.dataset.zone === id);
    this.root.querySelector('.mm-title span').textContent = z.title;
    if (id === 'pc') this.unread = { error: 0, warn: 0 };
    this.app.onZoneChange?.(id);
    window.scrollTo({ top: 0 });
  }

  /** Сообщение журнала пришло, пока экран ПК не виден: считаем непрочитанные аварии. */
  notify(level) {
    if (!this.active || this.zone === 'pc' || !(level === 'error' || level === 'warn')) return;
    this.unread ??= { error: 0, warn: 0 };
    this.unread[level]++;
  }

  /* ---------- миникарта ---------- */
  drawMap() {
    const box = this.root.querySelector('.mm-svg');
    box.innerHTML = '';
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mm' }, box);
    const L = this.app.bench.layout;
    const isAc = this.app.bench.id === 'ac';
    this.dots = {};

    // столешница и цоколь
    svg('rect', { x: 0, y: TABLE_Y, width: W, height: 5, class: 'mm-table' }, root);
    let x = CAB.x;
    const rects = {};
    for (const [id, w] of COLS) { rects[id] = { x, w }; x += w + 2; }
    const pcR = rects.pc, convR = rects.conv, fieldR = rects.field, powerR = rects.power;
    svg('rect', { x: pcR.x, y: BASE_Y, width: pcR.w, height: BASE_H, class: 'mm-cab' }, root);
    svg('rect', { x: pcR.x + 4, y: BASE_Y + 4, width: pcR.w - 8, height: BASE_H - 8, class: 'mm-perf' }, root);
    const motorsR = { x: convR.x, y: BASE_Y, w: powerR.x + powerR.w - convR.x, h: BASE_H };
    svg('rect', { x: motorsR.x, y: motorsR.y, width: motorsR.w, height: motorsR.h, class: 'mm-cab' }, root);

    // шкафы
    for (const [id] of COLS) {
      const r = rects[id];
      svg('rect', { x: r.x, y: CAB.y, width: r.w, height: CAB.h, rx: 2, class: 'mm-cab' }, root);
      const t = svg('text', { x: r.x + 4, y: CAB.y + 9, class: 'mm-no' }, root);
      t.textContent = L[id];
      // смотровое окно сверху
      svg('rect', { x: r.x + 4, y: CAB.y + 12, width: r.w - 8, height: 7, class: 'mm-window' }, root);
    }

    // ПК: монитор и клавиатура
    {
      const r = pcR, y0 = CAB.y + 22;
      svg('rect', { x: r.x + 6, y: y0, width: r.w - 12, height: 44, rx: 2, class: 'mm-screen' }, root);
      for (let i = 0; i < 5; i++) svg('rect', { x: r.x + 10, y: y0 + 6 + i * 7, width: (r.w - 20) * (0.5 + (i % 3) * 0.2), height: 2, class: 'mm-screen-line' }, root);
      svg('rect', { x: r.x + 8, y: CAB.y + 74, width: r.w - 16, height: 6, rx: 1, class: 'mm-dark' }, root);
    }
    // ТП (и ТПН на стенде АД)
    {
      const r = convR, y0 = CAB.y + 22;
      const h1 = isAc ? 30 : 56;
      svg('rect', { x: r.x + 5, y: y0, width: r.w - 10, height: h1, rx: 2, class: 'mm-face' }, root);
      svg('rect', { x: r.x + 9, y: y0 + 5, width: 18, height: 9, class: 'mm-lcd' }, root);
      svg('circle', { cx: r.x + r.w - 12, cy: y0 + 8, r: 3, class: 'mm-btn-g' }, root);
      svg('circle', { cx: r.x + r.w - 12, cy: y0 + 18, r: 3, class: 'mm-btn-r' }, root);
      if (isAc) {
        svg('rect', { x: r.x + 5, y: y0 + 34, width: r.w - 10, height: 30, rx: 2, class: 'mm-dark' }, root);
        svg('rect', { x: r.x + 9, y: y0 + 40, width: 18, height: 8, class: 'mm-lcd' }, root);
        svg('circle', { cx: r.x + r.w - 12, cy: y0 + 42, r: 3, class: 'mm-btn-g' }, root);
        svg('circle', { cx: r.x + r.w - 12, cy: y0 + 52, r: 3, class: 'mm-btn-r' }, root);
      }
    }
    // приборы и дверь монтажного отсека
    {
      const r = fieldR, y0 = CAB.y + 21, split = CAB.y + 12 + (CAB.h - 12) * FIELD_SPLIT;
      // анализатор сети и кнопки вводов
      svg('rect', { x: r.x + 6, y: y0, width: 16, height: 12, rx: 1, class: 'mm-dark' }, root);
      for (let i = 0; i < 4; i++) svg('circle', { cx: r.x + 30 + i * 9, cy: y0 + 6, r: 2.6, class: i % 2 ? 'mm-btn-r' : 'mm-btn-g' }, root);
      // стрелочные приборы
      const n = this.app.bench.metersLayout.rows[0].length, gw = (r.w - 12) / n;
      for (let row = 0; row < 2; row++) for (let i = 0; i < n; i++) {
        const cx = r.x + 6 + gw * (i + 0.5), cy = y0 + 20 + row * 12;
        svg('rect', { x: cx - 5.5, y: cy - 5, width: 11, height: 10, rx: 1, class: 'mm-gauge' }, root);
        svg('line', { x1: cx, y1: cy + 3, x2: cx - 2.5, y2: cy - 2.5, class: 'mm-needle' }, root);
      }
      // стеклянная дверь с миниатюрой поля и красной табличкой
      const dy = split + 2, dh = CAB.y + CAB.h - dy - 4;
      svg('rect', { x: r.x + 5, y: dy, width: r.w - 10, height: dh, rx: 1, class: 'mm-glass' }, root);
      this.doorEl = svg('rect', { x: r.x + 5, y: dy, width: r.w - 10, height: dh, rx: 1, class: 'mm-door' }, root);
      svg('rect', { x: r.x + r.w / 2 - 22, y: dy + dh / 2 - 5, width: 44, height: 10, rx: 2, class: 'mm-red' }, root);
      // пуск/стоп под дверью
      svg('circle', { cx: r.x + 12, cy: CAB.y + CAB.h - 8, r: 2.6, class: 'mm-btn-g' }, root);
      svg('circle', { cx: r.x + 22, cy: CAB.y + CAB.h - 8, r: 2.6, class: 'mm-btn-r' }, root);
      this.hit(root, 'meters', r.x, CAB.y, r.w, split - CAB.y);
      this.hit(root, 'field', r.x, split, r.w, CAB.y + CAB.h - split);
    }
    // автоматы, аварийная кнопка, ПЧ
    {
      const r = powerR, y0 = CAB.y + 22;
      svg('rect', { x: r.x + 5, y: y0, width: r.w - 34, height: 16, rx: 1, class: 'mm-rail' }, root);
      for (let i = 0; i < 4; i++) svg('rect', { x: r.x + 10 + i * 14, y: y0 + 3, width: 10, height: 10, rx: 1, class: 'mm-brk' }, root);
      svg('circle', { cx: r.x + r.w - 15, cy: y0 + 8, r: 7, class: 'mm-estop-ring' }, root);
      svg('circle', { cx: r.x + r.w - 15, cy: y0 + 8, r: 4, class: 'mm-btn-r' }, root);
      svg('rect', { x: r.x + 8, y: y0 + 22, width: 30, height: 42, rx: 3, class: 'mm-dark' }, root);
      svg('rect', { x: r.x + 14, y: y0 + 28, width: 18, height: 9, class: 'mm-lcd' }, root);
      for (let i = 0; i < 3; i++) svg('circle', { cx: r.x + 54 + i * 16, cy: y0 + 32, r: 4, class: 'mm-knob' }, root);
      svg('circle', { cx: r.x + 54, cy: y0 + 52, r: 3.5, class: 'mm-btn-g' }, root);
      svg('circle', { cx: r.x + 70, cy: y0 + 52, r: 3.5, class: 'mm-btn-r' }, root);
    }
    // агрегат
    {
      const r = motorsR, cy = r.y + r.h / 2 + 1;
      svg('rect', { x: r.x + 30, y: cy - 10, width: 42, height: 20, rx: 4, class: 'mm-motor' }, root);
      svg('rect', { x: r.x + 72, y: cy - 2, width: 14, height: 4, class: 'mm-shaft' }, root);
      this.discEl = svg('g', { transform: `translate(${r.x + 79},${cy})` }, root);
      svg('circle', { r: 5, class: 'mm-disc' }, this.discEl);
      svg('rect', { x: -5, y: -1, width: 10, height: 2, class: 'mm-disc-mark' }, this.discEl);
      svg('rect', { x: r.x + 86, y: cy - 2, width: 14, height: 4, class: 'mm-shaft' }, root);
      svg('rect', { x: r.x + 100, y: cy - 9, width: 38, height: 18, rx: 4, class: 'mm-motor' }, root);
      this.discCx = r.x + 79; this.discCy = cy;
    }

    for (const [id] of COLS) if (id !== 'field') this.hit(root, id, rects[id].x, CAB.y, rects[id].w, CAB.h);
    this.hit(root, 'motors', motorsR.x, motorsR.y, motorsR.w, motorsR.h);

    root.addEventListener('click', e => {
      const z = e.target.closest('.mm-zone');
      if (z) this.select(z.dataset.zone);
    });
  }

  /** Область-зона: невидимый прямоугольник, рамка активной зоны, подпись и индикатор состояния. */
  hit(root, id, x, y, w, h) {
    const z = this.zones().find(z => z.id === id);
    const g = svg('g', { class: 'mm-zone', 'data-zone': id }, root);
    svg('rect', { x: x + 1, y: y + 1, width: w - 2, height: h - 2, rx: 2, class: 'mm-hit' }, g);
    const lab = svg('g', { class: 'mm-label' }, g);
    const t = svg('text', { x: x + w / 2, y: y + h - 5, 'text-anchor': 'middle' }, lab);
    t.textContent = z.map;
    // подложка под подпись — ширина по числу символов (getBBox до вставки в документ недоступен)
    const tw = z.map.length * 5.6 + 8;
    lab.insertBefore(svg('rect', { x: x + w / 2 - tw / 2, y: y + h - 13, width: tw, height: 11, rx: 3 }), t);
    this.dots[id] = svg('circle', { cx: x + w - 6, cy: y + 6, r: 3, class: 'mm-dot' }, g);
  }

  /** Живые маркеры на карте: состояние зон и дверь монтажного отсека. */
  update(view, dt) {
    if (!this.active) return;
    const s = this.app.state, rt = view.rt;
    const st = {};
    st.power = s.estop ? 'fault' : Object.values(s.breakers).some(Boolean) ? 'on' : '';
    st.meters = Object.values(view.live.inputs).some(Boolean) ? 'on' : '';
    st.field = s.door ? 'warn' : '';
    const L = this.app.bench.layout;
    for (const c of this.app.bench.converters) {
      const zone = (c.cabinet || L.conv) === L.power ? 'power' : 'conv';
      const cv = view.conv[c.id], r = rt.conv[c.id];
      if (r.fault) st[zone] = 'fault';
      else if (cv.running && st[zone] !== 'fault') st[zone] = 'on';
    }
    const sh = view.sim.shaft;
    const runaway = Object.values(view.sim.motors).some(m => m.state === 'runaway');
    st.motors = runaway ? 'fault' : Math.abs(sh.speed) > 1 ? 'on' : '';
    st.pc = this.unread?.error ? 'fault' : this.unread?.warn ? 'warn' : '';
    for (const [id, d] of Object.entries(this.dots)) d.setAttribute('class', `mm-dot ${st[id] || ''}`);
    this.doorEl.classList.toggle('open', !!s.door);
    this.angle = ((this.angle || 0) + sh.speed / 60 * 360 * dt * 0.08) % 360;
    this.discEl.setAttribute('transform', `translate(${this.discCx},${this.discCy}) rotate(${this.angle})`);
  }
}
