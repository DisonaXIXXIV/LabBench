// Построение нетлиста: объединение клеммников в электрические узлы (сети)
// через провода пользователя, внутренние шины, проходные перемычки и
// замкнутые контакты. Нагрузки (резисторы, обмотки) сети НЕ объединяют.

class UnionFind {
  constructor(ids) {
    this.p = new Map();
    for (const id of ids) this.p.set(id, id);
  }
  find(a) {
    let r = a;
    while (this.p.get(r) !== r) r = this.p.get(r);
    while (this.p.get(a) !== r) { const n = this.p.get(a); this.p.set(a, r); a = n; }
    return r;
  }
  union(a, b) {
    if (!this.p.has(a) || !this.p.has(b)) return;
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.p.set(ra, rb);
  }
}

/**
 * Источники потенциала на клеммниках.
 * ac:  {kind:'ac', phase:'A'|'B'|'C'|'N', src:'in1'}
 * dc:  {kind:'dc', pol:'+'|'−', src:'in3'}
 * conv:{kind:'conv', dev:'fc', term:'U'}   — выход работающего преобразователя
 */
function collectSources(bench, live) {
  const map = new Map(); // nodeId -> source
  for (const inp of bench.inputs) {
    if (!live.inputs[inp.id]) continue;
    for (const [t, node] of Object.entries(inp.nodes)) {
      map.set(node, inp.kind === 'ac'
        ? { kind: 'ac', phase: t, src: inp.id }
        : { kind: 'dc', pol: t, src: inp.id });
    }
  }
  for (const c of bench.converters) {
    // ТПН в байпасе: тиристоры зашунтированы контактором K4, выход — просто сеть
    if (c.bypass && live.bypass?.[c.id]) continue;
    for (const [t, node] of Object.entries(c.out)) {
      // выходы возбудителя (В+/В−) включаются отдельно от якорных
      const on = c.fieldOut?.includes(t) ? live.field?.[c.id] : live.converters[c.id];
      if (on) map.set(node, { kind: 'conv', dev: c.id, term: t });
    }
  }
  return map;
}

/**
 * @param bench описание стенда
 * @param wires провода [{a:{node,clamp}, b:{node,clamp}}]
 * @param live  {inputs:{in1:bool}, converters:{fc:bool}, field:{tp:bool}, contactors:{km1:bool}, bypass:{tpn:bool}}
 * @param opts  {jumpers: false} — не объединять проходные перемычки измерителей (PW, ДТ):
 *              для модели они — ветви цепи, через которые считается ток
 */
export function buildNetlist(bench, wires, live, { jumpers = true } = {}) {
  const ids = bench.field.nodes.map(n => n.id);
  const uf = new UnionFind(ids);
  for (const [a, b] of bench.field.buses) uf.union(a, b);
  if (jumpers) for (const [a, b] of bench.field.jumpers) uf.union(a, b);
  for (const w of wires) uf.union(w.a.node, w.b.node);
  for (const km of bench.contactors) {
    if (live.contactors[km.id]) for (const [a, b] of km.contacts) uf.union(a, b);
  }
  for (const c of bench.converters) {
    if (c.bypass && live.bypass[c.id]) for (const [a, b] of c.bypass) uf.union(a, b);
  }

  const srcMap = collectSources(bench, live);
  const nets = new Map(); // root -> net
  const netOfNode = new Map();
  for (const id of ids) {
    const r = uf.find(id);
    let net = nets.get(r);
    if (!net) { net = { id: r, nodes: [], sources: [] }; nets.set(r, net); }
    net.nodes.push(id);
    netOfNode.set(id, net);
    const s = srcMap.get(id);
    if (s) net.sources.push({ ...s, node: id });
  }

  const nl = {
    nets: [...nets.values()],
    netOf: id => netOfNode.get(id),
    /** объединены ли клеммники в одну сеть */
    same: (a, b) => netOfNode.get(a) === netOfNode.get(b),
    /** сети, к которым подключены провода/что-то кроме самого клеммника */
    isConnected: id => {
      const n = netOfNode.get(id);
      return n && n.nodes.length > 1;
    },
  };
  return nl;
}

/** Уникальные «метки» источников сети для сравнения. */
export function sourceKey(s) {
  if (s.kind === 'ac') return `ac:${s.phase}`;
  if (s.kind === 'dc') return `dc:${s.pol}`;
  return `conv:${s.dev}:${s.term}`;
}

export function describeSource(bench, s) {
  if (s.kind === 'ac') {
    const inp = bench.inputs.find(i => i.id === s.src);
    return s.phase === 'N' ? `N (${inp.label})` : `фаза ${s.phase} (${inp.label})`;
  }
  if (s.kind === 'dc') {
    const inp = bench.inputs.find(i => i.id === s.src);
    return `«${s.pol}» ${inp.voltage} (${inp.label})`;
  }
  const c = bench.converters.find(c => c.id === s.dev);
  return `выход ${s.term} ${shortName(c)}`;
}

export function shortName(conv) {
  return { fc: 'ПЧ', dc: 'ТП', ss: 'ТПН' }[conv.kind] || conv.id;
}
