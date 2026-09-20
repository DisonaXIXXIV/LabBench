// Проверки собранной схемы по нетлисту.
// Возвращают сообщения {level:'error'|'warn'|'info', text, nodes:[ids]}.
import { buildNetlist, describeSource, shortName } from './netlist.js';

/** Проверка одной конфигурации нетлиста на короткие замыкания. */
export function checkShorts(bench, nl) {
  const msgs = [];
  const seen = new Set();
  let curInputs = [];
  const add = (level, text, nodes) => {
    const key = level + text;
    if (seen.has(key)) return;
    seen.add(key);
    msgs.push({ level, text, nodes, inputs: curInputs });
  };

  for (const net of nl.nets) {
    const S = net.sources;
    if (S.length < 2) continue;
    const ac = S.filter(s => s.kind === 'ac' && s.phase !== 'N');
    const nn = S.filter(s => s.kind === 'ac' && s.phase === 'N');
    const dc = S.filter(s => s.kind === 'dc');
    const cv = S.filter(s => s.kind === 'conv');
    const nodes = net.nodes;
    curInputs = uniq(S.filter(s => s.src).map(s => s.src));

    // фазы между собой
    const phases = new Map();
    for (const s of ac) (phases.get(s.phase) || phases.set(s.phase, []).get(s.phase)).push(s);
    if (phases.size > 1) {
      add('error', `КЗ между фазами ${[...phases.keys()].join('–')} (${uniq(ac.map(s => inputLabel(bench, s.src))).join(', ')})`, nodes);
    } else if (phases.size === 1) {
      const list = [...phases.values()][0];
      const inputs = uniq(list.map(s => s.src));
      if (inputs.length > 1) add('warn', `Фаза ${list[0].phase} вводов ${inputs.map(i => inputLabel(bench, i)).join(' и ')} соединены параллельно`, nodes);
    }
    if (ac.length && nn.length) add('error', `КЗ фаза–ноль (${describeSource(bench, ac[0])} — N)`, nodes);
    if (nn.length > 1 && uniq(nn.map(s => s.src)).length > 1) add('warn', 'Нулевые проводники двух вводов соединены', nodes);

    // постоянный ток
    const pols = uniq(dc.map(s => s.pol));
    if (pols.length > 1) add('error', `КЗ в цепи ${inputVoltage(bench, dc[0].src)}: «+» соединён с «−»`, nodes);
    if (dc.length && (ac.length || nn.length)) add('error', `Цепь ${inputVoltage(bench, dc[0].src)} соединена с сетью ~380 В`, nodes);

    // выходы преобразователей
    if (cv.length && (ac.length || nn.length || dc.length)) {
      const c = bench.converters.find(c => c.id === cv[0].dev);
      add('error', `Напряжение сети подано на выход ${shortName(c)} (${cv[0].term})`, nodes);
    }
    if (cv.length > 1) {
      const devs = uniq(cv.map(s => s.dev));
      if (devs.length > 1) {
        add('error', `Соединены выходы разных преобразователей: ${devs.map(d => shortName(bench.converters.find(c => c.id === d))).join(' и ')}`, nodes);
      } else {
        const terms = uniq(cv.map(s => s.term));
        if (terms.length > 1) {
          const c = bench.converters.find(c => c.id === devs[0]);
          const negs = terms.every(t => /−$/.test(t));
          add(negs ? 'warn' : 'error', `${negs ? 'Соединены минусовые' : 'КЗ'} выходы ${shortName(c)}: ${terms.join('–')}`, nodes);
        }
      }
    }
  }
  return msgs;
}

/** Проверки подключения устройств (не КЗ, а предупреждения). */
export function checkDevices(bench, nl) {
  const msgs = [];
  const gap = bench.ctrlChain.gap;
  if (gap && !nl.same(gap[0], gap[1])) {
    msgs.push({ level: 'info', text: 'Разрыв X2–X3 в цепи катушки KM1 не замкнут — контакторы KM1–KM3 не включатся', nodes: gap });
  }
  for (const c of bench.converters) {
    const nets = Object.values(c.in).map(n => nl.netOf(n));
    const phases = nets.map(net => net.sources.filter(s => s.kind === 'ac' && s.phase !== 'N').map(s => s.phase));
    const connected = phases.filter(p => p.length).length;
    if (connected === 0) continue;
    if (connected < 3) msgs.push({ level: 'warn', text: `${shortName(c)}: на вход подключены не все фазы (${connected} из 3)`, nodes: Object.values(c.in) });
    else {
      const set = new Set(phases.map(p => p[0]));
      if (set.size < 3) msgs.push({ level: 'error', text: `${shortName(c)}: на входе повторяется фаза (${phases.map(p => p[0]).join(', ')})`, nodes: Object.values(c.in) });
    }
  }
  for (const m of bench.motors) {
    for (const [w, ids] of Object.entries(m.windings)) {
      if (w === 'ends') continue;
      const nets = ids.map(n => nl.netOf(n));
      const hasSrc = nets.map(net => net.sources.length > 0);
      const conn = nets.map(net => net.nodes.length > 1);
      const nSrc = hasSrc.filter(Boolean).length;
      const srcs = nets.flatMap(net => net.sources);
      // статор АД от ТП — динамическое торможение: две фазы (третья свободна) или все три
      const tpOnly = w === 'stator' && nSrc >= 2 && srcs.every(s => s.kind === 'conv' && bench.converters.find(c => c.id === s.dev)?.kind === 'dc');
      if (tpOnly) {
        const terms = new Set(srcs.map(s => s.term));
        const both = [...terms].some(t => t.includes('+')) && [...terms].some(t => t.includes('−'));
        if (both) msgs.push({ level: 'info', text: `${m.title.split(' — ')[0]}: статор от ТП — динамическое торможение${nSrc === 2 ? ' (третья фаза свободна)' : ''}`, nodes: ids });
        else msgs.push({ level: 'warn', text: `${m.title.split(' — ')[0]}: к статору подключён только один полюс ТП («${[...terms][0]}») — тока не будет`, nodes: ids });
      } else if (nSrc > 0 && nSrc < ids.length && ids.length === 3) {
        msgs.push({ level: 'warn', text: `${m.title.split(' — ')[0]}: обмотка «${windingName(w)}» подключена не всеми фазами`, nodes: ids });
      }
      if (nSrc === 1 && ids.length === 2 && !conn[hasSrc.indexOf(false)]) {
        msgs.push({ level: 'warn', text: `${m.title.split(' — ')[0]}: обмотка «${windingName(w)}» подключена одним концом`, nodes: ids });
      }
    }
    if (m.windings.ends && m.windings.stator) {
      const st = m.windings.stator.map(n => nl.netOf(n));
      const en = m.windings.ends.map(n => nl.netOf(n));
      const energized = st.some(n => n.sources.length);
      const star = en.every(n => n === en[0]);
      const delta = en.every(n => st.includes(n)) && new Set(en).size === 3;
      if (energized && !star && !delta) {
        msgs.push({ level: 'warn', text: `${m.title.split(' — ')[0]}: концы фаз статора (X, Y, Z) не соединены в звезду или треугольник`, nodes: m.windings.ends });
      }
      if (star && en[0].sources.length) {
        msgs.push({ level: 'error', text: `${m.title.split(' — ')[0]}: на нулевую точку звезды подано напряжение`, nodes: m.windings.ends });
      }
    }
  }
  return msgs;
}

/**
 * Статическая проверка: все вводы считаются включёнными, преобразователи
 * работающими; контакторы — в обоих состояниях (разомкнуты/замкнуты).
 */
export function staticCheck(bench, wires) {
  const live = {
    inputs: Object.fromEntries(bench.inputs.map(i => [i.id, true])),
    converters: Object.fromEntries(bench.converters.map(c => [c.id, true])),
    contactors: Object.fromEntries(bench.contactors.map(k => [k.id, false])),
    bypass: Object.fromEntries(bench.converters.map(c => [c.id, false])),
  };
  const nlOpen = buildNetlist(bench, wires, live);
  const out = [...checkShorts(bench, nlOpen), ...checkDevices(bench, nlOpen)];
  const liveClosed = {
    ...live,
    contactors: Object.fromEntries(bench.contactors.map(k => [k.id, true])),
    bypass: Object.fromEntries(bench.converters.map(c => [c.id, true])),
  };
  const nlClosed = buildNetlist(bench, wires, liveClosed);
  const texts = new Set(out.map(m => m.text));
  for (const m of [...checkShorts(bench, nlClosed), ...checkDevices(bench, nlClosed)]) {
    if (!texts.has(m.text)) out.push({ ...m, text: m.text + ' — при замкнутых контакторах' });
  }
  if (!wires.length) out.push({ level: 'info', text: 'Схема пуста: провода не подключены', nodes: [] });
  else if (!out.some(m => m.level === 'error')) out.unshift({ level: 'ok', text: 'Коротких замыканий не обнаружено', nodes: [] });
  return out;
}

function uniq(a) { return [...new Set(a)]; }
function inputLabel(bench, id) { return bench.inputs.find(i => i.id === id)?.label ?? id; }
function inputVoltage(bench, id) { return bench.inputs.find(i => i.id === id)?.voltage ?? ''; }
function windingName(w) {
  return { field: 'возбуждение', arm: 'якорь', stator: 'статор', rotor: 'ротор' }[w] || w;
}
