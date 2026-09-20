// Стенд для исследования электроприводов с асинхронными двигателями
// (шкафы Б1–Б6, монтажный отсек в шкафу Б5, рис. В.11б и В.13 методички).
//
// Компоновка отсека повторяет реальную: рейки с блоками клеммников и
// таблички со схемами, кружки которых стоят под/над клеммниками.
import { block, pairBlock, xs, art } from './common.js';

const nodes = [];
const buses = [];
const jumpers = [];

const PH3 = ['blue', 'gray', 'orange'];
const IN = ['gray', 'gray', 'gray', 'blue'];

// ---- Рейка 1 (верх): вводы и входы устройств; свободные зажимы снизу ----
const R1 = 50;
const in1 = block('in1', ['A', 'B', 'C', 'N'], 60, R1, 'bottom', IN);
const in2 = block('in2', ['A', 'B', 'C', 'N'], 180, R1, 'bottom', IN);
const tpnIn = block('tpn.in', ['A', 'B', 'C'], 700, R1, 'bottom', PH3);
const tpnByp = block('tpn.byp', ['B1', 'B2', 'B3'], 796, R1, 'bottom', PH3);
const tpIn = block('tp.in', ['A', 'B', 'C'], 880, R1, 'bottom', PH3);
const pwIn = block('pw.in', ['A', 'B', 'C'], 990, R1, 'bottom', PH3);
const snIn = block('sens.in', ['A', 'B', 'C'], 1100, R1, 'bottom', PH3);
const fcIn = block('fc.in', ['A', 'B', 'C'], 1210, R1, 'bottom', PH3);
nodes.push(...in1, ...in2, ...tpnIn, ...tpnByp, ...tpIn, ...pwIn, ...snIn, ...fcIn);

// ---- Рейка 2 (середина): цепь управления, верх контактов KM1–KM3, выходы устройств; зажимы сверху ----
const R2 = 335;
const ctrl = [
  { id: 'ctrl.X1', label: 'X1', x: 60, y: R2, side: 'top', color: 'gray' },
  { id: 'ctrl.X2', label: 'X2', x: 140, y: R2, side: 'top', color: 'gray' },
  { id: 'ctrl.X3', label: 'X3', x: 164, y: R2, side: 'top', color: 'gray' },
  { id: 'ctrl.X4', label: 'X4', x: 210, y: R2, side: 'top', color: 'gray' },
];
const kmX = { km1: 350, km2: 430, km3: 510 };
const kmTop = {}, kmBot = {};
for (const [id, x0] of Object.entries(kmX)) {
  kmTop[id] = block(id, ['1', '3', '5'], x0, R2, 'top', PH3);
  kmBot[id] = block(id, ['2', '4', '6'], x0, 650, 'top', PH3);
}
const tpnOut = block('tpn.out', ['U', 'V', 'W'], 700, R2, 'top', PH3);
const tpnK4 = block('tpn.k4', ['1', '2', '3'], 796, R2, 'top', 'gray');
const tpOut = block('tp.out', ['+', '−'], 886, R2, 'top', ['orange', 'blue']);
const pwOut = block('pw.out', ['U', 'V', 'W'], 990, R2, 'top', PH3);
const snOut = block('sens.out', ['U', 'V', 'W'], 1100, R2, 'top', PH3);
const fcOut = block('fc.out', ['U', 'V', 'W'], 1210, R2, 'top', PH3);
const fcBr = block('fc.br', ['Br+', 'Br−'], 1294, R2, 'top', ['orange', 'blue']);
nodes.push(...ctrl, ...Object.values(kmTop).flat(), ...tpnOut, ...tpnK4, ...tpOut, ...pwOut, ...snOut, ...fcOut, ...fcBr);
jumpers.push(['pw.in.A', 'pw.out.U'], ['pw.in.B', 'pw.out.V'], ['pw.in.C', 'pw.out.W']);
jumpers.push(['sens.in.A', 'sens.out.U'], ['sens.in.B', 'sens.out.V'], ['sens.in.C', 'sens.out.W']);

// ---- Рейка 3 (справа): машины и R1; зажимы снизу ----
const R3 = 430;
const DUCT = { x1: 660, x2: 1380, y: R2 + 30, h: R3 - R2 - 60 };
const m3r = pairBlock('m3r', ['a', 'b', 'c'], 700, R3, 'bottom', PH3);
const m3s = pairBlock('m3', ['A', 'B', 'C'], 860, R3, 'bottom', PH3);
const m4s = pairBlock('m4', ['A', 'B', 'C'], 1020, R3, 'bottom', PH3);
const m4e = block('m4', ['Y', 'X', 'Z'], 1180, R3, 'bottom', 'gray');
const r1 = pairBlock('r1', ['1', '2'], 1270, R3, 'bottom', ['orange', 'blue']);
nodes.push(...m3r.nodes, ...m3s.nodes, ...m4s.nodes, ...m4e, ...r1.nodes);
buses.push(...m3r.buses, ...m3s.buses, ...m4s.buses, ...r1.buses);

// ---- Рейка 4 (низ слева): резисторы и низ контактов KM1–KM3; зажимы сверху ----
const R4 = 650;
const resistors = [];
const resGroups = [['ra', 4.2, 60], ['rb', 1.2, 204]];
for (const [g, ohm, x0] of resGroups) {
  for (let i = 0; i < 3; i++) {
    const id = `${g}${i + 1}`;
    const b = block(id, ['1', '2'], x0 + i * 48, R4, 'top', ['orange', 'blue']);
    nodes.push(...b);
    resistors.push({ id, ohm, a: `${id}.1`, b: `${id}.2`, x: b[0].x });
  }
}
nodes.push(...Object.values(kmBot).flat());
resistors.push({ id: 'r1', ohm: 10, a: 'r1.1.1', b: 'r1.2.1', x: 1270 });

function fieldArt() {
  const a = art;
  let s = '';

  // рейки
  s += a.rail(30, 280, R1) + a.rail(660, 1300, R1);
  s += a.rail(40, 80, R2) + a.rail(118, 240, R2) + a.rail(330, 580, R2) + a.rail(660, 1350, R2);
  s += a.rail(680, 1370, R3);
  // кабель-канал между рейками 2 и 3: сюда уходит внутренняя проводка обоих рядов
  s += a.duct(DUCT.x1, DUCT.x2, DUCT.y, DUCT.h);
  s += a.rail(40, 580, R4);

  // ---- табличка 1 (слева): вводы ----
  const P1 = 92;
  s += a.plate(40, P1, 240, 78);
  for (const [b, x, t] of [[in1, 96, 'Ввод 1'], [in2, 216, 'Ввод 2']]) {
    s += a.pins(xs(b), P1 + 8) + b.map(n => a.text(n.x, P1 + 22, n.label, 'lbl-tiny')).join('');
    s += a.text(x, P1 + 42, '~380 В', 'lbl-big') + a.text(x, P1 + 62, t, 'lbl-big');
  }

  // ---- табличка 1 (справа): ТПН, ТП, ваттметр, датчики, ПЧ ----
  const P1B = 300;
  s += a.plate(660, P1, 700, P1B - P1);
  const inPins = b => a.pins(xs(b), P1 + 8) + b.map(n => a.text(n.x, P1 + 22, n.label, 'lbl-tiny')).join('');
  const outPins = b => b.map(n => a.text(n.x, P1B - 14, n.label, 'lbl-tiny')).join('') + a.pins(xs(b), P1B - 8);
  const dev = (inB, outB, x, w, title, sub) =>
    inPins(inB) + a.leads(xs(inB), P1 + 24, P1 + 46) + a.box(x, P1 + 46, w, 80, title, sub) +
    a.leads(xs(outB), P1 + 126, P1B - 24) + outPins(outB);
  // ТПН с байпасом K4
  s += dev(tpnIn, tpnOut, 680, 88, 'ТПН', 'PST30');
  s += inPins(tpnByp) + a.leads(xs(tpnByp), P1 + 24, P1B - 24) + outPins(tpnK4);
  s += a.dashedBox(778, P1 + 46, 80, 80) + a.text(818, P1 + 40, 'байпас K4', 'lbl-tiny');
  for (const x of xs(tpnByp)) s += `<rect x="${x - 6}" y="${P1 + 74}" width="12" height="24" class="art-blank"/>` + a.line(x, P1 + 74, x + 9, P1 + 92);
  s += a.line(768, P1 + 86, 778, P1 + 86, 'art-line art-dashed');
  // ТП
  s += dev(tpIn, tpOut, 860, 90, 'ТП', 'DCS800');
  // PW
  s += dev(pwIn, pwOut, 970, 90, 'Ваттметр', 'PW');
  // датчики
  s += inPins(snIn) + a.leads(xs(snIn), P1 + 24, P1B - 24) + a.sensors(xs(snIn), P1 + 52, P1 + 126) + outPins(snOut);
  // ПЧ с тормозным резистором
  s += dev(fcIn, fcOut, 1190, 90, 'ПЧ', 'ACS880');
  s += a.line(1280, P1 + 80, 1294, P1 + 80) + a.line(1294, P1 + 80, 1294, P1B - 24);
  s += a.line(1280, P1 + 92, 1318, P1 + 92) + a.line(1318, P1 + 92, 1318, P1B - 24) + outPins(fcBr);

  // ---- табличка 2 (слева внизу): цепь управления, контакты KM1–KM3, резисторы ----
  const P2 = 376, P2B = 612;
  s += a.plate(40, P2, 560, P2B - P2);
  const cy = 428, y2 = cy + 22, y3 = cy + 50, y4 = cy + 78;
  s += a.pins(xs(ctrl), P2 + 8);
  s += a.line(60, P2 + 11, 60, cy) + a.line(60, cy, 70, cy) + a.button(84, cy, 'Стоп', true) + a.line(98, cy, 104, cy);
  s += a.button(118, cy, 'Пуск') + a.line(132, cy, 140, cy) + a.line(140, cy, 140, P2 + 11);
  s += a.line(104, cy, 104, y2) + a.contactH(118, y2, 'KM1') + a.line(132, y2, 140, y2) + a.line(140, y2, 140, cy);
  s += a.line(164, P2 + 11, 164, cy) + a.line(164, cy, 167, cy) + a.coil(176, cy, 'KM1') + a.line(185, cy, 210, cy) + a.line(210, cy, 210, P2 + 11);
  s += a.line(104, y2, 104, y3) + a.contactH(118, y3, 'KM1', true) + a.line(132, y3, 167, y3) + a.coil(176, y3, 'KM2') + a.line(185, y3, 210, y3);
  s += a.line(104, y3, 104, y4) + a.contactH(118, y4, 'KM2', true) + a.line(132, y4, 167, y4) + a.coil(176, y4, 'KM3') + a.line(185, y4, 210, y4);
  s += a.line(210, cy, 210, y4);
  // силовые контакты: три полюса, контакт на разной высоте
  const kmY = { km1: 450, km2: 500, km3: 550 };
  for (const [id, x0] of Object.entries(kmX)) {
    const y = kmY[id];
    s += a.pins(xs(kmTop[id]), P2 + 8) + a.pins(xs(kmBot[id]), P2B - 8);
    s += a.text(x0 + 24, y - 24, id.toUpperCase(), 'lbl-big') + a.dashedBox(x0 - 14, y - 14, 76, 34);
    for (const x of xs(kmTop[id])) s += a.line(x, P2 + 11, x, y - 8) + a.line(x, y - 8, x + 9, y + 8) + a.line(x, y + 9, x, P2B - 11);
  }
  // резисторы: 4,2 Ом и 1,2 Ом — по три штуки
  for (const [g, ohm, x0] of resGroups) {
    s += a.text(x0 + 60, 538, `${String(ohm).replace('.', ',')} Ом`, 'lbl-small');
    for (let i = 0; i < 3; i++) {
      const x1 = x0 + i * 48, x2 = x1 + 24;
      s += a.pin(x1, P2B - 8) + a.pin(x2, P2B - 8);
      s += a.resistorV(x1, 546, P2B - 11, '') + a.line(x1, 546, x2, 546) + a.line(x2, 546, x2, P2B - 11);
    }
  }

  // ---- табличка 3 (справа внизу): М3, М4, R1 ----
  const P3 = 472;
  s += a.plate(680, P3, 700, 246);
  const joinPairs = (pb, y) => {
    let d = a.pins(xs(pb.nodes), P3 + 8) + a.leads(xs(pb.nodes), P3 + 11, y);
    const cs = [];
    for (let i = 0; i < pb.nodes.length; i += 2) {
      d += a.line(pb.nodes[i].x, y, pb.nodes[i + 1].x, y);
      cs.push((pb.nodes[i].x + pb.nodes[i + 1].x) / 2);
      d += a.text(cs[cs.length - 1], P3 + 24, pb.nodes[i].label, 'lbl-tiny');
    }
    return [d, cs];
  };
  const jy = P3 + 40;
  const M3 = { x: 900, y: 640 }, M4 = { x: 1040, y: 640 };
  // ротор М3 (кольца a, b, c) → PV2, PA2 → снизу в машину
  const [dR, [ra, rb, rc]] = joinPairs(m3r, jy);
  s += dR;
  s += a.line(ra, jy, ra, 700) + a.line(ra, 700, M3.x - 8, 700) + a.line(M3.x - 8, 700, M3.x - 8, M3.y + 22);
  s += a.line(rb, jy, rb, 690) + a.line(rb, 690, M3.x, 690) + a.line(M3.x, 690, M3.x, M3.y + 24);
  s += a.line(rc, jy, rc, 680) + a.line(rc, 680, M3.x + 8, 680) + a.line(M3.x + 8, 680, M3.x + 8, M3.y + 22);
  s += a.meterAcross(rb, rc, jy + 30, 'PV2') + a.meter(rb, jy + 60, 'A', 'PA2');
  // статор М3 → PV1, PA1 → сверху в машину
  const [dS, [sa, sb, sc]] = joinPairs(m3s, jy);
  s += dS;
  s += a.line(sa, jy, sa, 600) + a.line(sa, 600, M3.x - 10, M3.y - 20);
  s += a.line(sb, jy, sb, M3.y - 24);
  s += a.line(sc, jy, sc, 600) + a.line(sc, 600, M3.x + 10, M3.y - 20);
  s += a.meterAcross(sa, sb, jy + 30, 'PV1') + a.meter(sa, jy + 60, 'A', 'PA1');
  s += a.circle(M3.x, M3.y, 24, 'M3');
  s += a.circle(852, M3.y, 9, 'ТГ') + a.line(861, M3.y, M3.x - 24, M3.y, 'art-shaft');
  // датчик момента и М4
  s += a.line(M3.x + 24, M3.y, 944, M3.y, 'art-shaft') + `<rect x="944" y="${M3.y - 12}" width="48" height="24" class="dev-box"/>`;
  s += a.text(968, M3.y + 28, 'Датчик', 'lbl-tiny') + a.text(968, M3.y + 38, 'момента', 'lbl-tiny');
  s += a.line(992, M3.y, M4.x - 24, M3.y, 'art-shaft');
  const [dU, [ua, ub, uc]] = joinPairs(m4s, jy);
  s += dU;
  s += a.line(ua, jy, ua, 600) + a.line(ua, 600, M4.x - 10, M4.y - 20);
  s += a.line(ub, jy, ub, 600) + a.line(ub, 600, M4.x, M4.y - 24);
  s += a.line(uc, jy, uc, 600) + a.line(uc, 600, M4.x + 10, M4.y - 20);
  s += a.meterAcross(ua, ub, jy + 30, 'PV3') + a.meter(ua, jy + 60, 'A', 'PA3');
  s += a.circle(M4.x, M4.y, 24, '') + a.text(M4.x, M4.y - 4, 'A B C', 'lbl-tiny') + a.text(M4.x, M4.y + 8, 'Z X Y', 'lbl-tiny');
  s += a.text(M4.x + 30, M4.y + 5, 'M4', 'dev-title', 'start');
  // концы фаз М4: Y, X, Z — снизу в машину
  const [ey, ex, ez] = xs(m4e);
  s += a.pins([ey, ex, ez], P3 + 8) + m4e.map(n => a.text(n.x, P3 + 24, n.label, 'lbl-tiny')).join('');
  s += a.line(ey, P3 + 11, ey, 700) + a.line(ey, 700, M4.x - 8, 700) + a.line(M4.x - 8, 700, M4.x - 8, M4.y + 22);
  s += a.line(ex, P3 + 11, ex, 690) + a.line(ex, 690, M4.x, 690) + a.line(M4.x, 690, M4.x, M4.y + 24);
  s += a.line(ez, P3 + 11, ez, 680) + a.line(ez, 680, M4.x + 8, 680) + a.line(M4.x + 8, 680, M4.x + 8, M4.y + 22);
  // R1
  const [dQ, [q1, q2]] = joinPairs(r1, jy);
  s += dQ;
  s += a.line(q1, jy, q1, 540) + a.resistorV(q1, 540, 600, 'R₁') + a.line(q1, 600, q1, 620) + a.line(q1, 620, q2, 620) + a.line(q2, 620, q2, jy);

  // концевой выключатель двери
  s += a.limitSwitch(1420, 600);
  return s;
}
const names = {
  in1: 'Ввод 1 ~380 В', in2: 'Ввод 2 ~380 В', ctrl: 'Цепь управления',
  km1: 'Контакты KM1', km2: 'Контакты KM2', km3: 'Контакты KM3',
  tpn: 'ТПН PST30', tp: 'ТП DCS800', fc: 'ПЧ ACS880', pw: 'Ваттметр PW', sens: 'Датчики ДН/ДТ',
  m3: 'М3 статор', m3r: 'М3 ротор', m4: 'М4 статор', r1: 'Резистор R1',
  ra1: 'Резистор 4,2 Ом', ra2: 'Резистор 4,2 Ом', ra3: 'Резистор 4,2 Ом',
  rb1: 'Резистор 1,2 Ом', rb2: 'Резистор 1,2 Ом', rb3: 'Резистор 1,2 Ом',
};

export const acBench = {
  id: 'ac',
  title: 'Стенд для исследования электроприводов с асинхронными двигателями',
  cabinets: 'Б1–Б6',
  field: { w: 1500, h: 740, nodes, buses, jumpers, ducts: [DUCT], art: fieldArt, names },

  breakers: [
    { id: 'rcd', label: 'УЗО', poles: 2, group: 'main' },
    { id: 'main380', label: 'Главный выключатель ~380 В', poles: 3, group: 'main', needs: ['rcd'] },
    { id: 'drives', label: 'Питание на приводы ~380 В', poles: 3, needs: ['main380'], trip: true },
    { id: 'aux220', label: 'Питание внутренних цепей ~220 В', poles: 1, needs: ['main380'] },
  ],
  inputs: [
    { id: 'in1', label: 'Ввод 1', voltage: '~380 В', kind: 'ac', breaker: 'drives', nodes: { A: 'in1.A', B: 'in1.B', C: 'in1.C', N: 'in1.N' } },
    { id: 'in2', label: 'Ввод 2', voltage: '~380 В', kind: 'ac', breaker: 'drives', nodes: { A: 'in2.A', B: 'in2.B', C: 'in2.C', N: 'in2.N' } },
  ],

  // X1 — начало цепи (Стоп), X4 — возврат; разрыв X2–X3 стоит последовательно
  // с катушкой KM1 и должен быть замкнут проводом (или внешним контактом).
  ctrlChain: { X1: 'ctrl.X1', X2: 'ctrl.X4', gap: ['ctrl.X2', 'ctrl.X3'] },
  contactors: [
    { id: 'km1', contacts: [['km1.1', 'km1.2'], ['km1.3', 'km1.4'], ['km1.5', 'km1.6']] },
    { id: 'km2', contacts: [['km2.1', 'km2.2'], ['km2.3', 'km2.4'], ['km2.5', 'km2.6']], after: 'km1', timer: 't1' },
    { id: 'km3', contacts: [['km3.1', 'km3.2'], ['km3.3', 'km3.4'], ['km3.5', 'km3.6']], after: 'km2', timer: 't2' },
  ],

  converters: [
    {
      id: 'fc', kind: 'fc', title: 'Преобразователь частоты', model: 'ABB ACS880', cabinet: 'Б6',
      in: { A: 'fc.in.A', B: 'fc.in.B', C: 'fc.in.C' },
      out: { U: 'fc.out.U', V: 'fc.out.V', W: 'fc.out.W' },
      modes: [
        { id: 'f', label: 'f', unit: 'Гц', max: 70 },
        { id: 'w', label: 'ω', unit: 'об/мин', max: 1500 },
        { id: 'M', label: 'M', unit: 'Нм', max: 55 },
      ],
      controls: ['setup', 'mode', 'polarity', 'ref', 'on', 'off'],
    },
    {
      id: 'tp', kind: 'dc', title: 'Тиристорный преобразователь', model: 'ABB DCS800', cabinet: 'Б4',
      in: { A: 'tp.in.A', B: 'tp.in.B', C: 'tp.in.C' },
      out: { '+': 'tp.out.+', '−': 'tp.out.−' },
      modes: [{ id: 'U', label: 'U', unit: 'В', max: 240 }],
      controls: ['ref', 'on', 'off'],
    },
    {
      id: 'tpn', kind: 'ss', title: 'Тиристорный преобразователь напряжения', model: 'ABB PST30', cabinet: 'Б4',
      in: { A: 'tpn.in.A', B: 'tpn.in.B', C: 'tpn.in.C' },
      out: { U: 'tpn.out.U', V: 'tpn.out.V', W: 'tpn.out.W' },
      bypass: [['tpn.byp.B1', 'tpn.k4.1'], ['tpn.byp.B2', 'tpn.k4.2'], ['tpn.byp.B3', 'tpn.k4.3']],
      modes: [],
      controls: ['on', 'off'],
      rampTime: 5,
    },
  ],

  resistors,

  motors: [
    {
      id: 'm3', kind: 'im-wound', title: 'М3 — АД с фазным ротором', tacho: true,
      windings: { stator: ['m3.A.1', 'm3.B.1', 'm3.C.1'], rotor: ['m3r.a.1', 'm3r.b.1', 'm3r.c.1'] },
      nominal: { speed: 1000, poles: 6, current: 20 },
    },
    {
      id: 'm4', kind: 'im-cage', title: 'М4 — АД с к.з. ротором',
      windings: { stator: ['m4.A.1', 'm4.B.1', 'm4.C.1'], ends: ['m4.X', 'm4.Y', 'm4.Z'] },
      nominal: { speed: 1000, poles: 6, current: 20 },
    },
  ],

  meters: [
    { id: 'PV1', kind: 'V', model: 'VLM-1-400/96', min: 0, max: 400, ticks: 4, across: ['m3.A.1', 'm3.B.1'] },
    { id: 'PV2', kind: 'V', model: 'VLM-1-400/96', min: 0, max: 400, ticks: 4, across: ['m3r.b.1', 'm3r.c.1'] },
    { id: 'n', kind: 'n', model: 'М42607', min: -2, max: 2, mult: 1000, ticks: 4, unit: 'об/мин', source: 'speed' },
    { id: 'PV3', kind: 'V', model: 'VLM-1-400/96', min: 0, max: 400, ticks: 4, across: ['m4.A.1', 'm4.B.1'] },
    { id: 'PA1', kind: 'A', model: 'AMT1-A1-20/96', min: 0, max: 20, ticks: 4, series: { motor: 'm3', winding: 'stator' } },
    { id: 'PA2', kind: 'A', model: 'AMT1-A1-30/96', min: 0, max: 30, ticks: 3, series: { motor: 'm3', winding: 'rotor' } },
    { id: 'M', kind: 'M', model: 'М42607', min: -2, max: 2, mult: 40, ticks: 4, unit: 'Нм', source: 'torque' },
    { id: 'PA3', kind: 'A', model: 'AMT1-A1-20/96', min: 0, max: 20, ticks: 4, series: { motor: 'm4', winding: 'stator' } },
    { id: 'PW', kind: 'PW', model: 'ANR96', in: ['pw.in.A', 'pw.in.B', 'pw.in.C'] },
  ],
  metersLayout: [['PW', 'PV1', 'PV2', 'n', 'PV3'], [null, 'PA1', 'PA2', 'M', 'PA3']],

  protections: { overspeed: 1400, overcurrent: null },
};
