// Точка входа: выбор стенда, сборка панелей, цикл моделирования.
import { dcBench } from './benches/dc.js';
import { acBench } from './benches/ac.js';
import { loadState, saveState, exportWires, importWires } from './core/state.js';
import { BenchRuntime } from './core/runtime.js';
import { staticCheck } from './core/checks.js';
import { createModel } from './sim/index.js';
import { Field } from './ui/field.js';
import { Gauge, PowerAnalyzer } from './ui/gauges.js';
import { PowerPanel } from './ui/power.js';
import { ConverterPanel } from './ui/converters.js';
import { MotorsPanel } from './ui/motors.js';
import { FieldControls } from './ui/fieldctl.js';
import { Log } from './ui/log.js';
import { PointsPanel } from './ui/points.js';
import { Scope } from './ui/scope.js';
import { PcMonitor } from './ui/pc.js';
import { MobileLayout } from './ui/mobile.js';
import { VERSION } from './version.js';

const BENCHES = { dc: dcBench, ac: acBench };
const WIRE_COLORS = ['#d02020', '#1a1a1a', '#1f5fd0', '#e8b800', '#1e9e3e', '#f0f0f0', '#8a4b1f'];

const $ = s => document.querySelector(s);
const hintEl = $('#hint');
let hintTimer = null;
/** Подсказка внизу экрана: постоянная (пока не сменится) или всплывающая на 2,5 с (flash: true — красная, 'warn' — жёлтая). */
function hint(text, flash = false) {
  hintEl.textContent = text;
  hintEl.classList.toggle('show', !!text);
  hintEl.classList.toggle('flash', flash === true);
  hintEl.classList.toggle('warn', flash === 'warn');
  clearTimeout(hintTimer);
  if (flash) hintTimer = setTimeout(() => hintEl.classList.remove('show'), 2500);
}

class App {
  constructor() {
    this.benchId = localStorage.getItem('abblab.bench') || 'dc';
    this.fieldOpen = localStorage.getItem('abblab.fieldOpen') === '1';
    $('#version').textContent = `v. ${VERSION}`;
    this.buildToolbar();
    this.mobile = new MobileLayout(this);
    this.pc = new PcMonitor(this);
    this.mount(this.benchId);
    this.setupFit();
    this.last = performance.now();
    requestAnimationFrame(t => this.frame(t));
  }

  buildToolbar() {
    for (const b of document.querySelectorAll('#bench-tabs button')) {
      b.addEventListener('click', () => this.mount(b.dataset.bench));
    }
    const wc = $('#wire-colors');
    for (const c of WIRE_COLORS) {
      const d = document.createElement('button');
      d.className = 'wc';
      d.style.background = c;
      d.dataset.color = c;
      d.addEventListener('click', () => { this.state.wireColor = c; this.updateColorUI(); saveState(this.state); });
      wc.appendChild(d);
    }
    $('#btn-check').addEventListener('click', () => {
      this.log.report(staticCheck(this.bench, this.state.wires));
      if (this.mobile.active) { this.mobile.select('pc'); this.toggleMenu(false); }
    });
    $('#btn-menu').addEventListener('click', () => this.toggleMenu());
    $('#btn-wire-del').addEventListener('click', () => { if (this.field.selected) this.field.removeWire(this.field.selected); });
    $('#btn-clear').addEventListener('click', () => {
      this.setFieldOpen(true);
      if (!this.state.door) { hint('Сначала откройте дверь монтажного отсека', true); return; }
      if (this.state.wires.length && confirm('Снять все провода со схемы?')) this.field.clearWires();
    });
    $('#btn-save').addEventListener('click', () => {
      const blob = new Blob([exportWires(this.state)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `scheme-${this.bench.id}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('#file-load').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      this.setFieldOpen(true);
      try {
        if (!this.state.door) throw new Error('Сначала откройте дверь монтажного отсека');
        const wires = importWires(this.bench, await f.text());
        this.field.setWires(wires);
        this.log.ok(`Загружена схема: ${wires.length} пров.`);
      } catch (err) { this.log.error(`Загрузка: ${err.message}`); }
      e.target.value = '';
    });
    $('#btn-field').addEventListener('click', () => this.setFieldOpen(this.mobile.active || !this.fieldOpen));
    $('#btn-field-close').addEventListener('click', () => this.setFieldOpen(false));
    $('#btn-door').addEventListener('click', () => { this.rt.toggleDoor(); this.syncDoor(); saveState(this.state); });
    const zoomLabel = z => { $('#zoom-fit').textContent = `${Math.round(z * 100)}%`; };
    $('#zoom-in').addEventListener('click', () => zoomLabel(this.field.setZoom(this.field.zoom * 1.25)));
    $('#zoom-out').addEventListener('click', () => zoomLabel(this.field.setZoom(this.field.zoom / 1.25)));
    $('#zoom-fit').addEventListener('click', () => zoomLabel(this.field.setZoom(1)));
    this.zoomLabel = zoomLabel;
    $('#btn-log-clear').addEventListener('click', () => this.log.clear());
    $('#btn-log-clear2').addEventListener('click', () => this.log.clear());
  }

  /** Выпадающее меню действий со схемой в мобильной шапке. */
  toggleMenu(show) {
    const tb = $('#toolbar');
    tb.classList.toggle('show', show ?? !tb.classList.contains('show'));
  }

  /** Смена компоновки (мобильная ↔ обычная): цвета проводов переезжают из шапки в заголовок поля и обратно. */
  onModeChange(mobile) {
    const wc = $('#wire-colors'), ver = $('#version');
    if (mobile) { $('#btn-wire-del').before(wc); $('#toolbar').appendChild(ver); }
    else { $('#toolbar').appendChild(wc); $('.brand').appendChild(ver); }
    this.toggleMenu(false);
    this.syncField();
    this.pc?.apply();
    this.fit?.();
  }

  /** Показана другая зона стенда: закрыть меню, поле — сбросить масштаб под новую ширину. */
  onZoneChange(id) {
    this.toggleMenu(false);
    this.syncField();
    if (id === 'field') this.zoomLabel(this.field.setZoom(this.field.zoom));
  }

  updateColorUI() {
    for (const b of document.querySelectorAll('.wc')) b.classList.toggle('active', b.dataset.color === this.state.wireColor);
  }

  mount(id) {
    if (this.state) saveState(this.state);
    this.benchId = id;
    localStorage.setItem('abblab.bench', id);
    const bench = this.bench = BENCHES[id];
    for (const b of document.querySelectorAll('#bench-tabs button')) b.classList.toggle('active', b.dataset.bench === id);
    document.title = `${bench.title}`;
    const L = bench.layout;
    $('#field-title').textContent = `Монтажный отсек (наборное поле) · шкаф ${L.field}`;
    $('#no-rest').textContent = L.rest;
    $('#no-pc').textContent = `${L.pc} · ПК`;
    $('#no-conv').textContent = L.conv;
    $('#no-field').textContent = L.field;
    $('#no-power').textContent = L.power;

    this.state = loadState(bench);
    this.log = new Log([$('#log'), $('#log2')], ids => { if (ids.length) this.setFieldOpen(true); this.field?.highlight(ids); });
    this.log.onPush = (level, text) => {
      this.mobile.notify(level);
      // на телефоне экран ПК не виден постоянно — аварии и предупреждения показываем всплывающей подсказкой
      if (this.mobile.active && this.mobile.zone !== 'pc' && (level === 'error' || level === 'warn')) hint(text, level === 'error' ? true : 'warn');
    };
    this.model = createModel(bench);
    this.rt = new BenchRuntime(bench, this.state, this.model, this.log);
    this.points = new PointsPanel($('#pc-points'), bench, this.rt);
    this.scope = new Scope($('#pc-scope'), bench, this.rt);
    this.rt.onEvent = ev => this.points.onEvent(ev);
    this.pc.apply();

    this.power = new PowerPanel($('#power-top'), $('#power-inputs'), bench, this.rt);
    this.buildMeters();
    // преобразователи раскладываются по шкафам: основной шкаф ПЧ/ТП и шкаф с автоматами
    const convRoots = { [L.conv]: $('#converters-conv'), [L.power]: $('#converters-power') };
    for (const r of Object.values(convRoots)) r.innerHTML = '';
    this.convPanels = bench.converters.map(c => new ConverterPanel(convRoots[c.cabinet] || convRoots[L.conv], bench, c, this.rt));
    this.field = new Field($('#field-panel'), bench, this.state, {
      onChange: () => { saveState(this.state); this.refreshPreview(); },
      hint,
      canEdit: () => this.state.door,
      onZoom: z => this.zoomLabel(z),
      onSelect: id => document.querySelector('.cabinet-field').classList.toggle('has-sel', !!id),
    });
    document.querySelector('.cabinet-field').classList.remove('has-sel');
    this.zoomLabel(1);
    this.fieldCtl = new FieldControls($('#field-controls'), bench, this.rt);
    this.motors = new MotorsPanel($('#motors'), bench);
    this.updateColorUI();
    this.syncDoor();
    this.mobile.mount();
    this.syncField();
    this.refreshPreview();
    this.fit?.();
    this.log.info(`${bench.title}`);
    this.log.info('Откройте дверь отсека, соберите схему проводами, закройте дверь, включите автоматы и вводы.');
  }

  /** Показать/скрыть наборное поле (сам монтажный отсек); органы под ним остаются на виду. */
  setFieldOpen(open) {
    // на телефоне поле — отдельная зона стенда; «свернуть» возвращает к приборам того же шкафа
    if (this.mobile.active) { this.mobile.select(open ? 'field' : 'meters'); return; }
    if (this.fieldOpen === open) return;
    this.fieldOpen = open;
    localStorage.setItem('abblab.fieldOpen', open ? '1' : '0');
    this.syncField();
    this.fitHeight?.();
    if (open) document.querySelector('.cab-row-field').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  syncField() {
    const open = this.mobile.active ? this.mobile.zone === 'field' : this.fieldOpen;
    document.querySelector('.cab-row-field').classList.toggle('open', open && !this.mobile.active);
    $('#btn-field').classList.toggle('open', open);
    $('#ft-title').textContent = open ? 'Свернуть наборное поле' : 'Открыть наборное поле';
    $('#ft-sub').textContent = open ? 'увеличенный вид показан ниже' : 'монтажный отсек за стеклянной дверью';
  }

  /** Миниатюра поля за стеклом дверцы шкафа — копия SVG наборного поля. */
  refreshPreview() {
    const box = $('#fd-preview');
    box.innerHTML = '';
    const svg = this.field.svg.cloneNode(true);
    svg.removeAttribute('style');
    svg.setAttribute('class', 'fd-svg');
    box.appendChild(svg);
  }

  syncDoor() {
    const open = this.state.door;
    this.field.setDoor(open);
    $('#btn-field').classList.toggle('door-open', open);
    $('#btn-door').textContent = open ? 'Закрыть дверь' : 'Открыть дверь';
    $('#door-state').textContent = open ? 'дверь открыта — монтаж разрешён' : 'дверь закрыта — можно подавать питание';
    $('#door-state').className = 'door-state ' + (open ? 'open' : 'closed');
  }

  /** Вписать стенд в ширину окна. Ряд рабочих шкафов имеет естественную ширину;
   *  если места хватает, слева дорисовываются шкафы автоматики (А5–А6 / Б1–Б2),
   *  иначе они скрываются, а страница масштабируется целиком. */
  setupFit() {
    const outer = $('#app-outer'), app = $('#app'), bench = $('#bench');
    let scale = 1;
    const fitH = () => { outer.style.height = `${Math.ceil(app.offsetHeight * scale)}px`; };
    const fit = () => {
      if (this.mobile.active) { app.style.width = ''; app.style.transform = ''; outer.style.height = ''; scale = 1; bench.classList.remove('measure'); return; }
      bench.classList.add('measure');
      app.style.width = '';
      const natural = bench.offsetWidth + 36;
      const vw = document.documentElement.clientWidth;
      if (vw >= natural + 150) {
        bench.classList.remove('measure');
        scale = 1;
        app.style.transform = '';
      } else {
        app.style.width = `${natural}px`;
        scale = Math.min(1, vw / natural);
        app.style.transform = scale < 1 ? `scale(${scale})` : '';
      }
      fitH();
    };
    this.fit = fit;
    this.fitHeight = fitH;
    window.addEventListener('resize', fit);
    new ResizeObserver(fitH).observe(app);
    fit();
  }

  buildMeters() {
    const root = $('#meters-panel');
    root.innerHTML = '';
    $('#pw-slot').innerHTML = '';
    $('#pw-slot-right').innerHTML = '';
    this.gauges = {};
    const defs = Object.fromEntries(this.bench.meters.map(m => [m.id, m]));
    const layout = this.bench.metersLayout;
    // анализатор сети: справа от стрелочных приборов (ДПТ) или сверху рядом с кнопками вводов (АД)
    const pwDef = this.bench.meters.find(m => m.kind === 'PW');
    if (pwDef) {
      const g = new PowerAnalyzer(pwDef);
      this.gauges[pwDef.id] = g;
      $(layout.pw === 'top' ? '#pw-slot' : '#pw-slot-right').appendChild(g.el);
    }
    for (const row of layout.rows) {
      const r = document.createElement('div');
      r.className = 'meters-row';
      for (const id of row) {
        if (!id) { const e = document.createElement('div'); e.className = 'gauge empty'; r.appendChild(e); continue; }
        const d = defs[id];
        const g = new Gauge(d);
        this.gauges[id] = g;
        r.appendChild(g.el);
      }
      root.appendChild(r);
    }
  }

  frame(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const view = this.rt.tick(dt);
    // приборы
    for (const m of this.bench.meters) {
      const g = this.gauges[m.id];
      if (!g) continue;
      if (m.kind === 'PW') g.setValue(view.sim.meters[m.id], view.aux);
      else g.setValue(view.sim.meters[m.id] ?? 0);
      g.animate(dt);
    }
    this.power.update(view);
    for (const p of this.convPanels) p.update(view);
    this.field.update(view);
    this.fieldCtl.update(view);
    this.motors.update(view, dt);
    this.points.update(view, dt);
    this.scope.update(view, dt);
    this.mobile.update(view, dt);
    // автосохранение положений органов управления (нечасто)
    this.saveAcc = (this.saveAcc || 0) + dt;
    if (this.saveAcc > 2) { this.saveAcc = 0; saveState(this.state); }
    requestAnimationFrame(t => this.frame(t));
  }
}

window.app = new App();
