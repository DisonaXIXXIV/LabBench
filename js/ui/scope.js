// Компьютерный осциллограф на ПК стенда (по мотивам L-Card + PowerGraph):
// запись блоками с выбранной частотой выборки, каналы датчиков ДТ1–ДТ3,
// ДН1–ДН2, ТГ, ДМ и внутренние сигналы преобразователей, шкалы и смещение
// по каналам, курсор, режим X-Y, математические каналы (умножение,
// сложение/вычитание, масштаб/смещение, сглаживание, интеграл), наборы
// настроек (в том числе предустановленные для ЛР7), экспорт блока в CSV.
//
// Мгновенные значения берутся у модели (model.sample(t)) после каждого её
// подшага — runtime.onSubstep; см. sim/model.js.

const COLORS = ['#f5c400', '#3cc8ff', '#ff5c5c', '#6fe07f', '#ff9c3c', '#d18bff', '#ffffff', '#8ef7e0', '#ff7ad9', '#a5c9ff'];
const RATES = [1000, 2000, 5000];
const LENGTHS = [2, 5, 10, 20];
const fmt = (v, d = 2) => (Math.abs(v) >= 1000 ? Math.round(v) : Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');
const KEY = id => `abblab.scope.${id}`;

/** Список сигналов стенда: датчики, машины, преобразователи. */
export function channelCatalog(bench) {
  const list = [
    { id: 'sens.IA', label: 'ДТ1 — ток A', unit: 'А' }, { id: 'sens.IB', label: 'ДТ2 — ток B', unit: 'А' }, { id: 'sens.IC', label: 'ДТ3 — ток C', unit: 'А' },
    { id: 'sens.UAB', label: 'ДН1 — U A–B', unit: 'В' }, { id: 'sens.UBC', label: 'ДН2 — U B–C', unit: 'В' },
    { id: 'n', label: 'ТГ — скорость', unit: 'об/мин' }, { id: 'M', label: 'ДМ — момент', unit: 'Нм' }, { id: 'PW_P', label: 'PW — мощность', unit: 'Вт' },
  ];
  for (const c of bench.converters) {
    if (c.kind === 'dc') list.push({ id: `${c.id}.I`, label: 'ТП — ток выхода', unit: 'А' }, { id: `${c.id}.U`, label: 'ТП — напряжение выхода', unit: 'В' }, { id: `${c.id}.Iin`, label: 'ТП — ток входа (фаза A)', unit: 'А' });
    if (c.kind === 'fc') list.push({ id: `${c.id}.Iout`, label: 'ПЧ — ток выхода', unit: 'А' }, { id: `${c.id}.Uout`, label: 'ПЧ — напряжение выхода (ШИМ)', unit: 'В' }, { id: `${c.id}.Iin`, label: 'ПЧ — ток входа (фаза A)', unit: 'А' }, { id: `${c.id}.Uin`, label: 'ПЧ — напряжение входа', unit: 'В' }, { id: `${c.id}.Ibr`, label: 'ПЧ — ток тормозного резистора', unit: 'А' });
    if (c.kind === 'ss') list.push({ id: `${c.id}.U`, label: 'ТПН — напряжение выхода', unit: 'В' }, { id: `${c.id}.I`, label: 'ТПН — ток', unit: 'А' });
  }
  for (const m of bench.motors) {
    const name = m.title.split(' — ')[0];
    if (m.kind === 'dc') list.push({ id: `${m.id}.Ia`, label: `${name} — ток якоря`, unit: 'А' }, { id: `${m.id}.Ua`, label: `${name} — напряжение якоря`, unit: 'В' });
    if (m.kind === 'pmsm') list.push({ id: `${m.id}.I`, label: `${name} — ток статора`, unit: 'А' });
    if (m.kind.startsWith('im')) { list.push({ id: `${m.id}.I1`, label: `${name} — ток статора`, unit: 'А' }); if (m.kind === 'im-wound') list.push({ id: `${m.id}.I2`, label: `${name} — ток ротора`, unit: 'А' }); }
  }
  return list;
}

/** Математические операции над записанными каналами. */
const OPS = {
  mul: { label: 'A × B', args: ['a', 'b'], fn: (A, B) => A.map((v, i) => v * B[i]) },
  add: { label: 'A + B', args: ['a', 'b'], fn: (A, B) => A.map((v, i) => v + B[i]) },
  sub: { label: 'A − B', args: ['a', 'b'], fn: (A, B) => A.map((v, i) => v - B[i]) },
  scale: { label: 'k·A + b', args: ['a', 'k', 'b0'], fn: (A, _, k, b0) => A.map(v => k * v + b0) },
  smooth: { label: 'сглаживание A (окно, мс)', args: ['a', 'win'], fn: (A, _, win, __, fs) => {
    const n = Math.max(1, Math.round(win / 1000 * fs));
    const out = new Float64Array(A.length);
    let acc = 0;
    for (let i = 0; i < A.length; i++) { acc += A[i]; if (i >= n) acc -= A[i - n]; out[i] = acc / Math.min(n, i + 1); }
    return out;
  } },
  integ: { label: '∫A dt', args: ['a'], fn: (A, _, __, ___, fs) => { const out = new Float64Array(A.length); let acc = 0; for (let i = 0; i < A.length; i++) { acc += A[i] / fs; out[i] = acc; } return out; } },
};

/** Предустановленные наборы настроек (ЛР7): энергия из сети W1, потери ΔW1, ΔW2. */
const PRESETS = {
  LR7_W1: {
    title: 'ЛР7: энергия из сети W1 (два ваттметра по ДН1, ДН2, ДТ1, ДТ2; i_C по (7.10))',
    channels: ['sens.UAB', 'sens.UBC', 'sens.IA', 'sens.IB'],
    math: [
      { name: 'i_C', op: 'scale', a: 'iAB', k: -1, b0: 0 }, { name: 'iAB', op: 'add', a: 'sens.IA', b: 'sens.IB' },
      { name: 'u_CB', op: 'scale', a: 'sens.UBC', k: -1, b0: 0 },
      { name: 'p_AB', op: 'mul', a: 'sens.UAB', b: 'sens.IA' }, { name: 'p_CB', op: 'mul', a: 'u_CB', b: 'i_C' },
      { name: 'p1', op: 'add', a: 'p_AB', b: 'p_CB' }, { name: 'P1_ср', op: 'smooth', a: 'p1', win: 20 }, { name: 'W1', op: 'integ', a: 'p1' },
    ],
    show: ['sens.IA', 'P1_ср', 'W1'],
  },
  LR7_delta_W1: {
    title: 'ЛР7: потери в статоре ΔW1 = ∫3·iф²·r1 dt по линейному току ДТ1 (М4 в треугольнике: iф = i/√3, r1 = 2,07 Ом; для звезды k = 6,2)',
    channels: ['sens.IA'],
    math: [{ name: 'i²', op: 'mul', a: 'sens.IA', b: 'sens.IA' }, { name: 'i²_ср', op: 'smooth', a: 'i²', win: 20 }, { name: 'p_Cu1', op: 'scale', a: 'i²_ср', k: 2.07, b0: 0 }, { name: 'ΔW1', op: 'integ', a: 'p_Cu1' }],
    show: ['sens.IA', 'p_Cu1', 'ΔW1'],
  },
  LR7_delta_W2: {
    title: 'ЛР7: потери в роторе ΔW2 = ∫M·(ω0 − ω) dt (по ДМ и ТГ; ДМ показывает момент нагрузки со знаком минус)',
    channels: ['M', 'n'],
    math: [{ name: 'ω−ω0', op: 'scale', a: 'n', k: 2 * Math.PI / 60, b0: -2 * Math.PI * 1000 / 60 }, { name: 'p2', op: 'mul', a: 'M', b: 'ω−ω0' }, { name: 'ΔW2', op: 'integ', a: 'p2' }],
    show: ['n', 'M', 'p2', 'ΔW2'],
  },
};

export class Scope {
  constructor(container, bench, runtime) {
    this.bench = bench;
    this.rt = runtime;
    this.el = container;
    this.catalog = channelCatalog(bench);
    this.fs = 2000;
    this.maxT = 5;
    this.rec = null;      // {t0, n, data: {id: Float32Array}}
    this.block = null;    // записанный блок {fs, n, data, math:{name: array}}
    this.cfg = { tDiv: 0.5, tPos: 0, xy: false, xCh: 'M', chans: {}, math: [] };
    this.cursor = null;   // время курсора, с
    this.selected = null; // выбранный канал (для шкалы/смещения)
    try { const raw = localStorage.getItem(KEY(bench.id)); if (raw) Object.assign(this.cfg, JSON.parse(raw)); } catch { /* пусто */ }
    if (!Object.keys(this.cfg.chans).length) this.applyPreset('LR7_W1', false);
    this.build();
    runtime.onSubstep = (t, model, dt) => this.record(t, model, dt);
  }

  // ---------- запись ----------

  start() {
    this.rec = { t0: this.rt.time, n: 0, data: Object.fromEntries(this.catalog.map(c => [c.id, new Float32Array(Math.ceil(this.maxT * this.fs) + 1)])) };
    this.block = null;
    this.lastSample = this.rt.time;
    this.renderBar();
  }

  stop() {
    if (!this.rec) return;
    this.block = { fs: this.fs, n: this.rec.n, data: this.rec.data, t0: this.rec.t0 };
    this.rec = null;
    this.computeMath();
    this.autoscaleAll();
    this.renderBar();
    this.draw();
  }

  record(t, model) {
    const r = this.rec;
    if (!r) return;
    const step = 1 / this.fs;
    const cap = r.data[this.catalog[0].id].length;
    while (this.lastSample + step <= t + 1e-9) {
      this.lastSample += step;
      if (r.n >= cap) { this.stop(); return; }
      const v = model.sample(this.lastSample);
      for (const c of this.catalog) r.data[c.id][r.n] = v[c.id] ?? 0;
      r.n++;
    }
  }

  /** Данные канала (базового или математического) текущего блока. */
  series(id) {
    const b = this.block || (this.rec && { data: this.rec.data, n: this.rec.n });
    if (!b) return null;
    if (b.data[id]) return b.data[id].subarray ? b.data[id].subarray(0, b.n) : b.data[id];
    return this.block?.math?.[id] || null;
  }

  computeMath() {
    if (!this.block) return;
    const out = {};
    const n = this.block.n, fs = this.block.fs;
    const get = (id) => out[id] || (this.block.data[id] ? this.block.data[id].subarray(0, n) : null);
    // математические каналы могут ссылаться друг на друга — вычисляем, пока получается
    let pending = [...this.cfg.math];
    for (let pass = 0; pending.length && pass < 10; pass++) {
      pending = pending.filter(m => {
        const op = OPS[m.op];
        if (!op) return false;
        const A = get(m.a); if (!A) return true;
        const B = op.args.includes('b') ? get(m.b) : null;
        if (op.args.includes('b') && !B) return true;
        out[m.name] = op.fn(A, B, m.op === 'smooth' ? (m.win ?? 20) : (m.k ?? 1), m.b0 ?? 0, fs);
        return false;
      });
    }
    this.block.math = out;
  }

  // ---------- настройки ----------

  allChannels() {
    return [...this.catalog.map(c => ({ ...c, math: false })), ...this.cfg.math.map(m => ({ id: m.name, label: `${m.name} = ${OPS[m.op]?.label || m.op}`, unit: '', math: true }))];
  }

  chanCfg(id) {
    return this.cfg.chans[id] || (this.cfg.chans[id] = { on: false, scale: 1, pos: 0, color: COLORS[Object.keys(this.cfg.chans).length % COLORS.length] });
  }

  applyPreset(name, notify = true) {
    const p = PRESETS[name];
    if (!p) return;
    this.cfg.math = p.math.map(m => ({ ...m }));
    this.cfg.chans = {};
    let i = 0;
    for (const id of [...p.channels, ...p.math.map(m => m.name)]) this.cfg.chans[id] = { on: p.show.includes(id), scale: 1, pos: 0, color: COLORS[i++ % COLORS.length] };
    this.cfg.xy = false;
    this.save();
    if (notify) { this.rt.log.info(`Осциллограф: загружен набор ${name} — ${p.title}`); this.computeMath(); this.autoscaleAll(); this.renderAll(); }
  }

  save() { try { localStorage.setItem(KEY(this.bench.id), JSON.stringify(this.cfg)); } catch { /* приватный режим */ } }

  autoscaleAll() {
    for (const [id, c] of Object.entries(this.cfg.chans)) if (c.on) this.autoscale(id);
  }

  autoscale(id) {
    const s = this.series(id);
    const c = this.chanCfg(id);
    if (!s || !s.length) return;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < s.length; i++) { if (s[i] < lo) lo = s[i]; if (s[i] > hi) hi = s[i]; }
    const span = Math.max(hi - lo, Math.abs(hi), Math.abs(lo), 1e-6);
    const nice = (v) => { const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
    c.scale = nice(span / 3);
    c.pos = 0;
  }

  // ---------- интерфейс ----------

  build() {
    this.el.innerHTML = `
      <div class="sc-bar">
        <button class="mini sc-rec">● Старт</button><button class="mini sc-stop">■ Стоп</button>
        <label>fs <select class="sc-fs">${RATES.map(r => `<option value="${r}">${r / 1000} кГц</option>`).join('')}</select></label>
        <label>блок <select class="sc-len">${LENGTHS.map(l => `<option value="${l}">${l} с</option>`).join('')}</select></label>
        <span class="sc-status"></span>
        <span class="pt-spacer"></span>
        <label>развёртка <select class="sc-tdiv">${[0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2].map(v => `<option value="${v}">${fmt(v * 1000, 0)} мс/дел</option>`).join('')}</select></label>
        <label><input type="checkbox" class="sc-xy"> X‑Y, X = <select class="sc-xch"></select></label>
        <button class="mini sc-auto" title="Подобрать шкалы по всем включённым каналам">авто</button>
        <label>набор <select class="sc-preset"><option value="">—</option>${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" title="${p.title}">${k}</option>`).join('')}</select></label>
        <button class="mini sc-save" title="Сохранить настройки в файл">сохр.</button>
        <label class="mini file-label">загр.<input type="file" accept=".json" class="sc-load" hidden></label>
        <button class="mini sc-csv" title="Экспорт записанного блока в CSV">CSV</button>
      </div>
      <div class="sc-body">
        <div class="sc-plot"><canvas class="sc-canvas"></canvas><input type="range" class="sc-pos" min="0" max="1000" value="0" title="Положение окна в блоке"></div>
        <div class="sc-side">
          <div class="sc-chans"></div>
          <details class="sc-math"><summary>Математика</summary><div class="sc-math-list"></div><button class="mini sc-math-add">+ канал</button></details>
        </div>
      </div>`;
    const q = s => this.el.querySelector(s);
    q('.sc-rec').addEventListener('click', () => this.start());
    q('.sc-stop').addEventListener('click', () => this.stop());
    q('.sc-fs').value = this.fs; q('.sc-fs').addEventListener('change', e => { this.fs = +e.target.value; });
    q('.sc-len').value = this.maxT; q('.sc-len').addEventListener('change', e => { this.maxT = +e.target.value; });
    q('.sc-tdiv').value = this.cfg.tDiv; q('.sc-tdiv').addEventListener('change', e => { this.cfg.tDiv = +e.target.value; this.save(); this.draw(); });
    q('.sc-xy').checked = this.cfg.xy; q('.sc-xy').addEventListener('change', e => { this.cfg.xy = e.target.checked; this.save(); this.draw(); });
    q('.sc-xch').addEventListener('change', e => { this.cfg.xCh = e.target.value; this.save(); this.draw(); });
    q('.sc-auto').addEventListener('click', () => { this.autoscaleAll(); this.renderChans(); this.draw(); });
    q('.sc-preset').addEventListener('change', e => { if (e.target.value) this.applyPreset(e.target.value); e.target.value = ''; });
    q('.sc-save').addEventListener('click', () => this.downloadCfg());
    q('.sc-load').addEventListener('change', async e => { const f = e.target.files[0]; if (f) { try { Object.assign(this.cfg, JSON.parse(await f.text())); this.save(); this.computeMath(); this.renderAll(); } catch (err) { this.rt.log.error(`Осциллограф: ${err.message}`); } } e.target.value = ''; });
    q('.sc-csv').addEventListener('click', () => this.downloadCsv());
    q('.sc-pos').addEventListener('input', e => { this.cfg.tPos = +e.target.value / 1000; this.draw(); });
    q('.sc-math-add').addEventListener('click', () => { this.cfg.math.push({ name: `M${this.cfg.math.length + 1}`, op: 'mul', a: this.catalog[0].id, b: this.catalog[1].id, k: 1, b0: 0, win: 20 }); this.save(); this.renderAll(); });
    this.canvas = q('.sc-canvas');
    this.canvas.addEventListener('mousemove', e => { const r = this.canvas.getBoundingClientRect(); this.cursorPx = (e.clientX - r.left) / r.width; this.draw(); });
    this.canvas.addEventListener('mouseleave', () => { this.cursorPx = null; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    this.renderAll();
  }

  renderAll() { this.renderBar(); this.renderChans(); this.renderMath(); this.draw(); }

  renderBar() {
    const st = this.el.querySelector('.sc-status');
    if (this.rec) st.textContent = `запись… ${fmt(this.rec.n / this.fs, 1)} с`;
    else if (this.block) st.textContent = `блок ${fmt(this.block.n / this.block.fs, 2)} с, ${this.block.fs / 1000} кГц`;
    else st.textContent = 'нет записи';
    this.el.classList.toggle('recording', !!this.rec);
    const xs = this.el.querySelector('.sc-xch');
    const cur = xs.value || this.cfg.xCh;
    xs.innerHTML = this.allChannels().map(c => `<option value="${c.id}">${c.id}</option>`).join('');
    xs.value = cur;
  }

  renderChans() {
    const box = this.el.querySelector('.sc-chans');
    box.innerHTML = '';
    for (const c of this.allChannels()) {
      const cc = this.chanCfg(c.id);
      const row = document.createElement('div');
      row.className = `sc-ch${cc.on ? ' on' : ''}${this.selected === c.id ? ' sel' : ''}`;
      row.innerHTML = `<label><input type="checkbox" ${cc.on ? 'checked' : ''}><i style="background:${cc.color}"></i><span class="sc-ch-name" title="${c.label}">${c.id}</span></label>
        <span class="sc-ch-val"></span>
        <span class="sc-ch-ctl"><input type="number" class="sc-scale" step="any" value="${cc.scale}" title="Единиц на деление">${c.unit ? `<small>${c.unit}/дел</small>` : '<small>/дел</small>'}
        <input type="number" class="sc-off" step="0.5" value="${cc.pos}" title="Смещение, делений"></span>`;
      row.querySelector('input[type=checkbox]').addEventListener('change', e => { cc.on = e.target.checked; if (cc.on && this.block) this.autoscale(c.id); this.save(); this.renderChans(); this.draw(); });
      row.querySelector('.sc-scale').addEventListener('change', e => { cc.scale = Math.abs(+e.target.value) || 1; this.save(); this.draw(); });
      row.querySelector('.sc-off').addEventListener('change', e => { cc.pos = +e.target.value || 0; this.save(); this.draw(); });
      row.querySelector('.sc-ch-name').addEventListener('click', () => { this.selected = c.id; this.renderChans(); });
      row.dataset.id = c.id;
      box.appendChild(row);
    }
  }

  renderMath() {
    const box = this.el.querySelector('.sc-math-list');
    box.innerHTML = '';
    const ids = this.allChannels().map(c => c.id);
    this.cfg.math.forEach((m, i) => {
      const op = OPS[m.op];
      const row = document.createElement('div');
      row.className = 'sc-m';
      const sel = (cls, val) => `<select class="${cls}">${ids.map(id => `<option value="${id}" ${id === val ? 'selected' : ''}>${id}</option>`).join('')}</select>`;
      row.innerHTML = `<input class="sc-m-name" value="${m.name}" title="Имя канала"> = <select class="sc-m-op">${Object.entries(OPS).map(([k, o]) => `<option value="${k}" ${k === m.op ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
        A: ${sel('sc-m-a', m.a)} ${op.args.includes('b') ? `B: ${sel('sc-m-b', m.b)}` : ''}
        ${op.args.includes('k') ? `k <input class="sc-m-k" type="number" step="any" value="${m.k ?? 1}"> b <input class="sc-m-b0" type="number" step="any" value="${m.b0 ?? 0}">` : ''}
        ${op.args.includes('win') ? `окно <input class="sc-m-win" type="number" step="1" value="${m.win ?? 20}"> мс` : ''}
        <button class="mini sc-m-del" title="Удалить">×</button>`;
      const upd = () => { this.save(); this.computeMath(); this.renderAll(); };
      row.querySelector('.sc-m-name').addEventListener('change', e => { const old = m.name; m.name = e.target.value.trim() || old; if (this.cfg.chans[old]) { this.cfg.chans[m.name] = this.cfg.chans[old]; delete this.cfg.chans[old]; } upd(); });
      row.querySelector('.sc-m-op').addEventListener('change', e => { m.op = e.target.value; upd(); });
      row.querySelector('.sc-m-a').addEventListener('change', e => { m.a = e.target.value; upd(); });
      row.querySelector('.sc-m-b')?.addEventListener('change', e => { m.b = e.target.value; upd(); });
      row.querySelector('.sc-m-k')?.addEventListener('change', e => { m.k = +e.target.value; upd(); });
      row.querySelector('.sc-m-b0')?.addEventListener('change', e => { m.b0 = +e.target.value; upd(); });
      row.querySelector('.sc-m-win')?.addEventListener('change', e => { m.win = +e.target.value; upd(); });
      row.querySelector('.sc-m-del').addEventListener('click', () => { this.cfg.math.splice(i, 1); delete this.cfg.chans[m.name]; upd(); });
      box.appendChild(row);
    });
  }

  // ---------- отрисовка ----------

  draw() {
    const cv = this.canvas;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0d1a10';
    g.fillRect(0, 0, W, H);
    const NX = 10, NY = 8;
    const dx = W / NX, dy = H / NY;
    g.strokeStyle = '#1f3a26'; g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < NX; i++) { g.moveTo(i * dx + 0.5, 0); g.lineTo(i * dx + 0.5, H); }
    for (let i = 1; i < NY; i++) { g.moveTo(0, i * dy + 0.5); g.lineTo(W, i * dy + 0.5); }
    g.stroke();
    g.strokeStyle = '#2f5a3a';
    g.beginPath(); g.moveTo(0, H / 2 + 0.5); g.lineTo(W, H / 2 + 0.5); g.moveTo(W / 2 + 0.5, 0); g.lineTo(W / 2 + 0.5, H); g.stroke();
    const on = this.allChannels().filter(c => this.cfg.chans[c.id]?.on);
    const first = on.length ? this.series(on[0].id) : null;
    const fs = this.block?.fs || this.fs;
    const n = first ? first.length : 0;
    const total = n / fs;
    const win = this.cfg.tDiv * NX;
    const tStart = Math.max(0, Math.min(total - win, this.cfg.tPos * Math.max(0, total - win)));
    g.font = '10px Consolas, monospace';
    g.fillStyle = '#7fbf8f';
    if (!n) { g.fillText('нет данных — нажмите «● Старт»', 8, 14); return; }
    const yOf = (v, cc) => H / 2 - (v / cc.scale + cc.pos) * dy;
    if (this.cfg.xy) {
      // режим X-Y: по горизонтали — канал X, по вертикали — включённые каналы (в окне развёртки)
      const X = this.series(this.cfg.xCh), cx = this.chanCfg(this.cfg.xCh);
      if (!X) return;
      const i0 = Math.floor(tStart * fs), i1 = Math.min(n, Math.ceil((tStart + win) * fs));
      for (const c of on) {
        if (c.id === this.cfg.xCh) continue;
        const Y = this.series(c.id), cc = this.chanCfg(c.id);
        if (!Y) continue;
        g.strokeStyle = cc.color; g.lineWidth = 1.2; g.beginPath();
        for (let i = i0; i < i1; i++) { const x = W / 2 + (X[i] / cx.scale + cx.pos) * dx, y = yOf(Y[i], cc); if (i === i0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke();
      }
      g.fillStyle = '#7fbf8f';
      g.fillText(`X: ${this.cfg.xCh} ${fmt(cx.scale)}/дел`, 8, H - 6);
      return;
    }
    // временная развёртка: на каждый пиксель — min/max выборок
    for (const c of on) {
      const s = this.series(c.id), cc = this.chanCfg(c.id);
      if (!s) continue;
      g.strokeStyle = cc.color; g.lineWidth = 1.2; g.beginPath();
      let started = false;
      for (let px = 0; px < W; px++) {
        const ia = Math.floor((tStart + px / W * win) * fs), ib = Math.max(ia + 1, Math.floor((tStart + (px + 1) / W * win) * fs));
        if (ia >= n) break;
        let lo = Infinity, hi = -Infinity;
        for (let i = ia; i < Math.min(ib, n); i++) { if (s[i] < lo) lo = s[i]; if (s[i] > hi) hi = s[i]; }
        if (lo === Infinity) continue;
        const y1 = yOf(hi, cc), y2 = yOf(lo, cc);
        if (!started) { g.moveTo(px, y1); started = true; } else g.lineTo(px, y1);
        if (y2 !== y1) g.lineTo(px, y2);
      }
      g.stroke();
    }
    g.fillStyle = '#7fbf8f';
    g.fillText(`${fmt(this.cfg.tDiv * 1000, 0)} мс/дел   t = ${fmt(tStart, 2)}…${fmt(Math.min(total, tStart + win), 2)} с из ${fmt(total, 2)} с`, 8, H - 6);
    // курсор
    const vals = {};
    if (this.cursorPx !== null && this.cursorPx !== undefined) {
      const tc = tStart + this.cursorPx * win;
      const i = Math.min(n - 1, Math.max(0, Math.round(tc * fs)));
      const x = this.cursorPx * W;
      g.strokeStyle = '#e8e8e8'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#e8e8e8';
      g.fillText(`t = ${fmt(tc, 3)} с`, Math.min(W - 90, x + 6), 12);
      for (const c of on) { const s = this.series(c.id); if (s) vals[c.id] = s[i]; }
    }
    for (const row of this.el.querySelectorAll('.sc-ch')) {
      const id = row.dataset.id;
      const v = vals[id];
      const c = this.catalog.find(x => x.id === id);
      row.querySelector('.sc-ch-val').textContent = v === undefined ? '' : `${fmt(v, Math.abs(v) < 10 ? 3 : 1)} ${c?.unit || ''}`;
    }
  }

  // ---------- файлы ----------

  downloadCfg() {
    const blob = new Blob([JSON.stringify(this.cfg, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `scope-${this.bench.id}.json`; a.click(); URL.revokeObjectURL(a.href);
  }

  downloadCsv() {
    const b = this.block;
    if (!b) { this.rt.log.warn('Осциллограф: нет записанного блока'); return; }
    const cols = this.allChannels().filter(c => this.cfg.chans[c.id]?.on || !c.math);
    const lines = [['t, с', ...cols.map(c => `${c.id}${c.unit ? `, ${c.unit}` : ''}`)].join(';')];
    for (let i = 0; i < b.n; i++) lines.push([(i / b.fs).toFixed(4), ...cols.map(c => { const s = this.series(c.id); return s ? String(Math.round(s[i] * 1000) / 1000) : ''; })].join(';').replace(/\./g, ','));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `scope-${this.bench.id}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  update() {
    if (this.rec) { this.renderBar(); if ((this._frame = (this._frame || 0) + 1) % 4 === 0) this.draw(); }
  }
}
