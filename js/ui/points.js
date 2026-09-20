// Таблица снятых точек и секундомер на мониторе ПК: кнопка «Записать точку»
// добавляет строку с показаниями всех приборов и состоянием преобразователей;
// строки удаляются, таблица экспортируется в CSV / копируется; по точкам
// строится график n(X). Секундомер — старт/стоп/сброс; выбег фиксируется
// моделью автоматически (событие coast) и показывается рядом.

const fmtNum = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');
const KEY = id => `abblab.points.${id}`;

export class PointsPanel {
  constructor(container, bench, runtime) {
    this.bench = bench;
    this.rt = runtime;
    this.el = container;
    this.rows = [];
    this.sw = { run: false, t: 0 };
    this.coast = null;
    try { const raw = localStorage.getItem(KEY(bench.id)); if (raw) this.rows = JSON.parse(raw); } catch { /* пусто */ }
    this.columns = this.buildColumns();
    this.build();
  }

  /** Столбцы: приборы стенда, преобразователи (режим, задание), контакторы. */
  buildColumns() {
    const cols = [];
    for (const m of this.bench.meters) {
      if (m.kind === 'PW') cols.push({ id: 'PW.U', label: 'PW U', unit: 'В', get: v => v.sim.meters.PW?.U ?? 0, d: 0 }, { id: 'PW.I', label: 'PW I', unit: 'А', get: v => v.sim.meters.PW?.I ?? 0 }, { id: 'PW.P', label: 'PW P', unit: 'кВт', get: v => v.sim.meters.PW?.P ?? 0, d: 2 });
      else cols.push({ id: m.id, label: m.id, unit: m.unit || { V: 'В', A: 'А', n: 'об/мин', M: 'Нм' }[m.kind], get: v => v.sim.meters[m.id] ?? 0, d: m.kind === 'n' ? 0 : m.kind === 'A' && m.max <= 5 ? 2 : 1 });
    }
    for (const c of this.bench.converters) {
      const name = { dc: 'ТП', fc: 'ПЧ', ss: 'ТПН' }[c.kind];
      cols.push({ id: `${c.id}.mode`, label: `${name} режим`, unit: '', text: true, get: v => { const cv = v.conv[c.id]; if (!cv.running) return cv.field ? 'возб.' : '—'; const m = c.modes.find(m => m.id === cv.mode); return m ? `${m.label} = ${fmtNum(cv.ref, Math.abs(cv.ref) >= 100 ? 0 : 1)} ${m.unit}` : 'вкл.'; } });
      if (c.fieldCol) cols.push({ id: `${c.id}.If`, label: 'ТП Iв', unit: 'А', get: v => v.sim.conv?.[c.id]?.If ?? 0, d: 2 });
    }
    cols.push({ id: 'km', label: 'KM', unit: '', text: true, get: v => this.bench.contactors.filter(k => v.rt.contactors[k.id]).map(k => k.id.toUpperCase()).join('+') || '—' });
    return cols;
  }

  build() {
    this.el.innerHTML = `
      <div class="pt-bar">
        <button class="mini pt-add" title="Записать текущие показания всех приборов строкой таблицы">Записать точку</button>
        <span class="pt-sw"><b class="sw-val">0,0</b> с
          <button class="mini sw-start">старт</button><button class="mini sw-stop">стоп</button><button class="mini sw-reset">сброс</button></span>
        <span class="pt-coast" title="Выбег фиксируется автоматически: от снятия питания до остановки вала"></span>
        <span class="pt-spacer"></span>
        <label class="pt-chart-x">график n(<select></select>)</label>
        <button class="mini pt-copy" title="Скопировать таблицу (табуляция — для вставки в Excel)">копировать</button>
        <button class="mini pt-csv">CSV</button>
        <button class="mini pt-clear">очистить</button>
      </div>
      <div class="pt-body"><div class="pt-table-wrap"><table class="pt-table"><thead></thead><tbody></tbody></table></div><svg class="pt-chart" viewBox="0 0 320 200"></svg></div>`;
    const q = s => this.el.querySelector(s);
    q('.pt-add').addEventListener('click', () => this.addPoint());
    q('.sw-start').addEventListener('click', () => { this.sw.run = true; });
    q('.sw-stop').addEventListener('click', () => { this.sw.run = false; });
    q('.sw-reset').addEventListener('click', () => { this.sw.t = 0; this.sw.run = false; this.renderSw(); });
    q('.pt-clear').addEventListener('click', () => { if (!this.rows.length || confirm('Удалить все записанные точки?')) { this.rows = []; this.save(); this.render(); } });
    q('.pt-csv').addEventListener('click', () => this.download());
    q('.pt-copy').addEventListener('click', () => navigator.clipboard?.writeText(this.text('\t')).catch(() => {}));
    const sel = q('.pt-chart-x select');
    for (const c of this.columns.filter(c => !c.text && c.id !== 'n')) sel.appendChild(Object.assign(document.createElement('option'), { value: c.id, textContent: c.label }));
    sel.value = this.columns.some(c => c.id === 'M') ? 'M' : sel.value;
    sel.addEventListener('change', () => this.renderChart());
    this.render();
  }

  addPoint() {
    const v = this.rt.view;
    if (!v) return;
    const row = { t: new Date().toLocaleTimeString('ru-RU'), sw: this.sw.t };
    for (const c of this.columns) row[c.id] = c.text ? c.get(v) : Math.round(c.get(v) * 1000) / 1000;
    this.rows.push(row);
    this.save();
    this.render();
    this.rt.log.info(`Записана точка ${this.rows.length}: n = ${Math.round(row.n ?? 0)} об/мин, M = ${fmtNum(row.M ?? 0)} Нм`);
  }

  save() { try { localStorage.setItem(KEY(this.bench.id), JSON.stringify(this.rows)); } catch { /* приватный режим */ } }

  render() {
    const thead = this.el.querySelector('thead'), tbody = this.el.querySelector('tbody');
    thead.innerHTML = `<tr><th>№</th><th>время</th><th>секундомер, с</th>${this.columns.map(c => `<th>${c.label}${c.unit ? `, ${c.unit}` : ''}</th>`).join('')}<th></th></tr>`;
    tbody.innerHTML = '';
    this.rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i + 1}</td><td>${r.t}</td><td>${fmtNum(r.sw)}</td>${this.columns.map(c => `<td>${c.text ? r[c.id] : fmtNum(r[c.id] ?? 0, c.d ?? 1)}</td>`).join('')}<td><button class="mini pt-del" title="Удалить строку">×</button></td>`;
      tr.querySelector('.pt-del').addEventListener('click', () => { this.rows.splice(i, 1); this.save(); this.render(); });
      tbody.appendChild(tr);
    });
    this.el.querySelector('.pt-table-wrap').scrollTop = 1e9;
    this.renderChart();
  }

  /** График n(X) по записанным точкам. */
  renderChart() {
    const svg = this.el.querySelector('.pt-chart');
    const xid = this.el.querySelector('.pt-chart-x select').value;
    const col = this.columns.find(c => c.id === xid);
    const pts = this.rows.filter(r => Number.isFinite(r[xid]) && Number.isFinite(r.n));
    if (!col || pts.length < 1) { svg.innerHTML = '<text x="160" y="100" text-anchor="middle" class="pt-empty">нет точек</text>'; return; }
    const W = 320, H = 200, L = 44, B = 26, T = 8, R = 10;
    const xs = pts.map(p => p[xid]), ys = pts.map(p => p.n);
    const span = (a) => { let lo = Math.min(0, ...a), hi = Math.max(0, ...a); if (hi - lo < 1e-9) hi = lo + 1; const pad = (hi - lo) * 0.08; return [lo - pad, hi + pad]; };
    const [x0, x1] = span(xs), [y0, y1] = span(ys);
    const X = x => L + (x - x0) / (x1 - x0) * (W - L - R), Y = y => H - B - (y - y0) / (y1 - y0) * (H - B - T);
    let s = '';
    // сетка и оси
    for (let i = 0; i <= 4; i++) {
      const gx = x0 + (x1 - x0) * i / 4, gy = y0 + (y1 - y0) * i / 4;
      s += `<line x1="${X(gx)}" y1="${T}" x2="${X(gx)}" y2="${H - B}" class="pt-grid"/><text x="${X(gx)}" y="${H - B + 12}" text-anchor="middle" class="pt-tick">${fmtNum(gx, Math.abs(x1 - x0) < 10 ? 1 : 0)}</text>`;
      s += `<line x1="${L}" y1="${Y(gy)}" x2="${W - R}" y2="${Y(gy)}" class="pt-grid"/><text x="${L - 3}" y="${Y(gy) + 3}" text-anchor="end" class="pt-tick">${Math.round(gy)}</text>`;
    }
    if (x0 < 0 && x1 > 0) s += `<line x1="${X(0)}" y1="${T}" x2="${X(0)}" y2="${H - B}" class="pt-axis"/>`;
    if (y0 < 0 && y1 > 0) s += `<line x1="${L}" y1="${Y(0)}" x2="${W - R}" y2="${Y(0)}" class="pt-axis"/>`;
    s += `<text x="${W - R}" y="${H - 4}" text-anchor="end" class="pt-lbl">${col.label}, ${col.unit}</text><text x="${L + 3}" y="${T + 9}" class="pt-lbl">n, об/мин</text>`;
    // точки, соединённые в порядке возрастания X
    const ord = pts.map((p, i) => i).sort((a, b) => xs[a] - xs[b]);
    s += `<polyline points="${ord.map(i => `${X(xs[i])},${Y(ys[i])}`).join(' ')}" class="pt-line"/>`;
    pts.forEach((p, i) => { s += `<circle cx="${X(xs[i])}" cy="${Y(ys[i])}" r="3" class="pt-dot"><title>${i + 1}: ${col.label} = ${fmtNum(xs[i])} ${col.unit}, n = ${Math.round(ys[i])}</title></circle>`; });
    svg.innerHTML = s;
  }

  text(sep = ';') {
    const head = ['№', 'время', 'секундомер, с', ...this.columns.map(c => `${c.label}${c.unit ? `, ${c.unit}` : ''}`)];
    const lines = [head.join(sep)];
    this.rows.forEach((r, i) => lines.push([i + 1, r.t, fmtNum(r.sw), ...this.columns.map(c => c.text ? r[c.id] : fmtNum(r[c.id] ?? 0, c.d ?? 1))].join(sep)));
    return lines.join('\n');
  }

  download() {
    const blob = new Blob(['﻿' + this.text(';')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `points-${this.bench.id}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  renderSw() {
    this.el.querySelector('.sw-val').textContent = fmtNum(this.sw.t);
    this.el.classList.toggle('sw-run', this.sw.run);
  }

  /** Событие модели: выбег зафиксирован. */
  onEvent(ev) {
    if (!ev.coast) return;
    this.coast = ev.coast;
    this.el.querySelector('.pt-coast').textContent = `выбег: ${Math.round(Math.abs(ev.coast.n0))} об/мин → 0 за ${fmtNum(ev.coast.t)} с`;
  }

  update(view, dt) {
    if (this.sw.run) this.sw.t += dt;
    if (this.sw.run || this._lastSw !== this.sw.t) { this.renderSw(); this._lastSw = this.sw.t; }
  }
}
