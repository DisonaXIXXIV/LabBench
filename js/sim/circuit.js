// Граф силовой цепи поверх нетлиста: сети — узлы, ветви — резисторы стенда и
// «проходные» перемычки измерителей (ваттметр PW, датчики ДТ). Модель ищет
// от клеммников обмотки путь к источнику через ветви (алгоритм Дейкстры по
// сопротивлению), суммирует сопротивление и запоминает, через какие
// измерители прошёл ток, — так резисторы в якоре/статоре, нагрузка на
// выходе ТП и показания PW/ДТ считаются по реально собранной схеме.
//
// Нетлист для модели строится без перемычек (buildNetlist(..., {jumpers:false})):
// pw.in.A и pw.out.U — разные сети, соединённые ветвью 0 Ом с меткой probe.

export class Circuit {
  /**
   * @param bench описание стенда
   * @param nl    нетлист без перемычек
   * @param probes ветви измерителей: [{id, a, b}] (id — 'pw.A', 'sens.A' и т.п.)
   */
  constructor(bench, nl, probes) {
    this.bench = bench;
    this.nl = nl;
    this.adj = new Map(); // net -> [{net, ohm, probe, res}]
    const link = (a, b, ohm, tag) => {
      // dir: +1 — обход от a к b (для измерителя: вход → выход)
      const e1 = { net: b, ohm, dir: 1, ...tag }, e2 = { net: a, ohm, dir: -1, ...tag };
      (this.adj.get(a) || this.adj.set(a, []).get(a)).push(e1);
      (this.adj.get(b) || this.adj.set(b, []).get(b)).push(e2);
    };
    for (const r of bench.resistors || []) {
      const a = nl.netOf(r.a), b = nl.netOf(r.b);
      if (!a || !b || a === b) continue; // зашунтирован (контактом или проводом) — как провод
      link(a, b, r.ohm, { res: r.id });
    }
    for (const p of probes) {
      const a = nl.netOf(p.a), b = nl.netOf(p.b);
      if (!a || !b || a === b) continue;
      link(a, b, 0, { probe: p.id });
    }
  }

  /**
   * Кратчайший (по сопротивлению) путь от сети from до сети, удовлетворяющей
   * accept(net) (например, содержащей источник); сама from не проверяется,
   * если skipSelf. Возвращает {net, ohm, probes:[{id, dir}], res:[id], chain:[{net, ohm}]}
   * (dir измерителя: +1 — обход прошёл его от входа к выходу)
   * или null. block(net) — сети, через которые идти нельзя (например, второй
   * вывод той же обмотки: путь «сквозь» обмотку не считается).
   */
  path(from, accept, { block = null, skipSelf = false } = {}) {
    if (!skipSelf && accept(from)) return { net: from, ohm: 0, probes: [], res: [], chain: [{ net: from, ohm: 0 }] };
    const dist = new Map([[from, 0]]);
    const prev = new Map();
    const done = new Set();
    for (;;) {
      let cur = null;
      for (const [n, v] of dist) if (!done.has(n) && (cur === null || v < dist.get(cur))) cur = n;
      if (cur === null) return null;
      done.add(cur);
      if (cur !== from && accept(cur)) {
        const chain = [], probes = [], res = [];
        for (let n = cur; n; n = prev.get(n)?.net) {
          chain.unshift({ net: n, ohm: dist.get(n) });
          const e = prev.get(n)?.edge;
          if (e?.probe) probes.push({ id: e.probe, dir: e.dir });
          if (e?.res) res.push(e.res);
        }
        return { net: cur, ohm: dist.get(cur), probes, res, chain };
      }
      if (block && block(cur)) continue;
      for (const e of this.adj.get(cur) || []) {
        if (done.has(e.net)) continue;
        const nd = dist.get(cur) + e.ohm;
        if (!dist.has(e.net) || nd < dist.get(e.net)) { dist.set(e.net, nd); prev.set(e.net, { net: cur, edge: e }); }
      }
    }
  }

  /** Сопротивление между двумя сетями через резисторы (null — не соединены). */
  between(a, b, opts) {
    if (a === b) return 0;
    const p = this.path(a, n => n === b, opts);
    return p ? p.ohm : null;
  }
}

/** Ветви измерителей по описанию поля: перемычки pw.in.X–pw.out.Y → 'pw.X', sens.in.X–sens.out.Y → 'sens.X'. */
export function probeBranches(bench) {
  return (bench.field.jumpers || []).map(([a, b]) => {
    const [dev, , term] = a.split('.');
    return { id: `${dev}.${term}`, a, b, dev, term };
  });
}
