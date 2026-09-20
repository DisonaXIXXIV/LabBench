// Состояние стенда: провода, положения органов управления, питание.
// Сохраняется в localStorage; провода можно экспортировать в JSON.

export function createState(bench) {
  const conv = {};
  for (const c of bench.converters) {
    conv[c.id] = {
      setup: 'fix',            // 'man' | 'fix'  — тумблер «Настройка»
      mode: c.modes[0]?.id ?? null, // тумблер «Стабилизация»
      polarity: 1,             // тумблер «Полярность задания»
      ref: 0,                  // потенциометр «Задание», 0..1
      fieldRef: 0.7,           // потенциометр задания тока возбуждения, 0..1
      on: false,               // команда Вкл/Выкл (якорная цепь)
      field: false,            // возбуждение включено (ТП с возбудителем: первая ступень «ВКЛ.»)
      params: Object.fromEntries((c.params || []).map(p => [p.id, p.def])), // пульт параметров (действует в «Руч»)
    };
  }
  return {
    benchId: bench.id,
    wires: [],                 // {id, a:{node,clamp}, b:{node,clamp}, color}
    breakers: Object.fromEntries(bench.breakers.map(b => [b.id, false])),
    estop: false,
    door: true,                // true — дверь монтажного отсека открыта
    inputs: Object.fromEntries(bench.inputs.map(i => [i.id, false])),
    // t1/t2 — потенциометры «Время 1/2» (0..1; крайнее положение — ∞), manual — ручное включение KM2/KM3
    ctrl: { start: false, stop: false, t1: 0.3, t2: 0.3, manual: Object.fromEntries(bench.contactors.filter(k => k.after).map(k => [k.id, false])) },
    conv,
    wireColor: '#d02020',
  };
}

const KEY = id => `abblab.state.${id}`;

export function saveState(state) {
  try {
    const { wires, breakers, inputs, ctrl, conv, door, wireColor } = state;
    localStorage.setItem(KEY(state.benchId), JSON.stringify({ wires, breakers, inputs, ctrl, conv, door, wireColor }));
  } catch { /* приватный режим и т.п. */ }
}

export function loadState(bench) {
  const st = createState(bench);
  try {
    const raw = localStorage.getItem(KEY(bench.id));
    if (raw) {
      const s = JSON.parse(raw);
      if (Array.isArray(s.wires)) st.wires = s.wires.filter(w => validWire(bench, w));
      Object.assign(st.breakers, pick(s.breakers, st.breakers));
      Object.assign(st.inputs, pick(s.inputs, st.inputs));
      Object.assign(st.ctrl, pick(s.ctrl, st.ctrl));
      for (const id of Object.keys(st.conv)) {
        if (!s.conv?.[id]) continue;
        const params = { ...st.conv[id].params, ...pick(s.conv[id].params, st.conv[id].params) };
        Object.assign(st.conv[id], pick(s.conv[id], st.conv[id]), { params });
      }
      st.ctrl.manual = Object.fromEntries(Object.keys(st.ctrl.manual).map(k => [k, false]));
      if (typeof s.door === 'boolean') st.door = s.door;
      if (s.wireColor) st.wireColor = s.wireColor;
      st.ctrl.start = false; st.ctrl.stop = false;
      // новая сессия начинается с обесточенного отсека и остановленных преобразователей
      for (const k of Object.keys(st.inputs)) st.inputs[k] = false;
      for (const c of Object.values(st.conv)) { c.on = false; c.field = false; }
    }
  } catch { /* игнорируем битые данные */ }
  return st;
}

function pick(src, tmpl) {
  const out = {};
  if (!src) return out;
  for (const k of Object.keys(tmpl)) if (k in src) out[k] = src[k];
  return out;
}

export function validWire(bench, w) {
  const ids = new Set(bench.field.nodes.map(n => n.id));
  return w && w.a && w.b && ids.has(w.a.node) && ids.has(w.b.node) &&
    [0, 1].includes(w.a.clamp) && [0, 1].includes(w.b.clamp);
}

export function exportWires(state) {
  return JSON.stringify({ bench: state.benchId, version: 1, wires: state.wires }, null, 2);
}

export function importWires(bench, text) {
  const data = JSON.parse(text);
  if (data.bench !== bench.id) throw new Error(`Файл для другого стенда (${data.bench})`);
  if (!Array.isArray(data.wires)) throw new Error('В файле нет списка проводов');
  return data.wires.filter(w => validWire(bench, w)).map((w, i) => ({ ...w, id: w.id ?? `w${Date.now()}_${i}` }));
}
