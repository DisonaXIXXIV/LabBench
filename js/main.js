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

const BENCHES = { dc: dcBench, ac: acBench };
const WIRE_COLORS = ['#d02020', '#1a1a1a', '#1f5fd0', '#e8b800', '#1e9e3e', '#f0f0f0', '#8a4b1f'];

const $ = s => document.querySelector(s);
const hintEl = $('#hint');
let hintTimer = null;
function hint(text, flash = false) {
  hintEl.textContent = text;
  hintEl.classList.toggle('show', !!text);
  hintEl.classList.toggle('flash', flash);
  clearTimeout(hintTimer);
  if (flash) hintTimer = setTimeout(() => hintEl.classList.remove('show'), 2500);
}

class App {
  constructor() {
    this.benchId = localStorage.getItem('abblab.bench') || 'dc';
    this.buildToolbar();
    this.mount(this.benchId);
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
    $('#btn-check').addEventListener('click', () => this.log.report(staticCheck(this.bench, this.state.wires)));
    $('#btn-clear').addEventListener('click', () => {
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
      try {
        if (!this.state.door) throw new Error('Сначала откройте дверь монтажного отсека');
        const wires = importWires(this.bench, await f.text());
        this.field.setWires(wires);
        this.log.ok(`Загружена схема: ${wires.length} пров.`);
      } catch (err) { this.log.error(`Загрузка: ${err.message}`); }
      e.target.value = '';
    });
    $('#btn-door').addEventListener('click', () => { this.rt.toggleDoor(); this.syncDoor(); saveState(this.state); });
    const zoomLabel = z => { $('#zoom-fit').textContent = `${Math.round(z * 100)}%`; };
    $('#zoom-in').addEventListener('click', () => zoomLabel(this.field.setZoom(this.field.zoom * 1.25)));
    $('#zoom-out').addEventListener('click', () => zoomLabel(this.field.setZoom(this.field.zoom / 1.25)));
    $('#zoom-fit').addEventListener('click', () => zoomLabel(this.field.setZoom(1)));
    this.zoomLabel = zoomLabel;
    $('#btn-log-clear').addEventListener('click', () => this.log.clear());
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
    $('#field-title').textContent = `Монтажный отсек (наборное поле) · шкаф ${id === 'dc' ? 'А2' : 'Б5'}`;

    this.state = loadState(bench);
    this.log = new Log($('#log'), ids => this.field?.highlight(ids));
    this.model = createModel(bench);
    this.rt = new BenchRuntime(bench, this.state, this.model, this.log);

    this.power = new PowerPanel($('#power-panel'), bench, this.rt);
    this.buildMeters();
    const convRoot = $('#converters');
    convRoot.innerHTML = '';
    this.convPanels = bench.converters.map(c => new ConverterPanel(convRoot, bench, c, this.rt));
    this.field = new Field($('#field-panel'), bench, this.state, {
      onChange: () => { saveState(this.state); },
      hint,
      canEdit: () => this.state.door,
      onZoom: z => this.zoomLabel(z),
    });
    this.zoomLabel(1);
    this.fieldCtl = new FieldControls($('#field-controls'), bench, this.rt);
    this.motors = new MotorsPanel($('#motors'), bench);
    this.updateColorUI();
    this.syncDoor();
    this.log.info(`${bench.title}`);
    this.log.info('Откройте дверь отсека, соберите схему проводами, закройте дверь, включите автоматы и вводы.');
  }

  syncDoor() {
    const open = this.state.door;
    this.field.setDoor(open);
    $('#btn-door').textContent = open ? 'Закрыть дверь' : 'Открыть дверь';
    $('#door-state').textContent = open ? 'дверь открыта — монтаж разрешён' : 'дверь закрыта — можно подавать питание';
    $('#door-state').className = 'door-state ' + (open ? 'open' : 'closed');
  }

  buildMeters() {
    const root = $('#meters-panel');
    root.innerHTML = '';
    this.gauges = {};
    const defs = Object.fromEntries(this.bench.meters.map(m => [m.id, m]));
    for (const row of this.bench.metersLayout) {
      const r = document.createElement('div');
      r.className = 'meters-row';
      for (const id of row) {
        if (!id) { const e = document.createElement('div'); e.className = 'gauge empty'; r.appendChild(e); continue; }
        const d = defs[id];
        const g = d.kind === 'PW' ? new PowerAnalyzer(d) : new Gauge(d);
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
    // автосохранение положений органов управления (нечасто)
    this.saveAcc = (this.saveAcc || 0) + dt;
    if (this.saveAcc > 2) { this.saveAcc = 0; saveState(this.state); }
    requestAnimationFrame(t => this.frame(t));
  }
}

window.app = new App();
