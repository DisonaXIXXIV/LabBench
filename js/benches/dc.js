// Стенд для исследования электропривода с двигателем постоянного тока
// (шкафы А1–А6, монтажный отсек в шкафу А2, рис. В.11а и В.12 методички).
//
// Компоновка отсека повторяет реальную: четыре DIN-рейки с блоками
// клеммников и белые таблички со схемами, кружки которых стоят под/над
// соответствующими клеммниками.
import { block, pairBlock, xs, art } from './common.js';

const nodes = [];
const buses = [];
const jumpers = [];

const PH3 = ['blue', 'gray', 'orange'];            // трёхфазные вводы/выходы устройств
const IN = ['gray', 'gray', 'gray', 'blue'];        // сетевые вводы A, B, C, N
const PAIRS = ['orange', 'orange', 'blue', 'blue']; // контакты KM, резисторы

// ---- Рейка 1 (верх): вводы питания и входы устройств; свободные зажимы снизу ----
const R1 = 50;
const in1 = block('in1', ['A', 'B', 'C', 'N'], 60, R1, 'bottom', IN);
const in2 = block('in2', ['A', 'B', 'C', 'N'], 180, R1, 'bottom', IN);
const in3 = block('in3', ['+', '−'], 300, R1, 'bottom', ['orange', 'blue']);
const tpIn = block('tp.in', ['A', 'B', 'C'], 960, R1, 'bottom', PH3);
const pwIn = block('pw.in', ['A', 'B', 'C'], 1070, R1, 'bottom', PH3);
const snIn = block('sens.in', ['A', 'B', 'C'], 1180, R1, 'bottom', PH3);
const fcIn = block('fc.in', ['A', 'B', 'C'], 1290, R1, 'bottom', PH3);
nodes.push(...in1, ...in2, ...in3, ...tpIn, ...pwIn, ...snIn, ...fcIn);

// ---- Рейка 2 (середина): цепь управления, контакты KM1–KM3, выходы устройств; зажимы сверху ----
const R2 = 335;
const ctrl = [
  { id: 'ctrl.X1', label: 'X1', x: 60, y: R2, side: 'top', color: 'gray' },
  { id: 'ctrl.X2', label: 'X2', x: 150, y: R2, side: 'top', color: 'gray' },
];
const km = {
  km1: block('km1', ['1', '2', '3', '4'], 200, R2, 'top', PAIRS),
  km2: block('km2', ['1', '2', '3', '4'], 296, R2, 'top', PAIRS),
  km3: block('km3', ['1', '2', '3', '4'], 392, R2, 'top', PAIRS),
};
const tpOut = block('tp.out', ['В+', 'В−', 'Я+', 'Я−'], 948, R2, 'top', ['blue', 'orange', 'blue', 'orange']);
const pwOut = block('pw.out', ['U', 'V', 'W'], 1070, R2, 'top', PH3);
const snOut = block('sens.out', ['U', 'V', 'W'], 1180, R2, 'top', PH3);
const fcOut = block('fc.out', ['U', 'V', 'W'], 1290, R2, 'top', PH3);
nodes.push(...ctrl, ...km.km1, ...km.km2, ...km.km3, ...tpOut, ...pwOut, ...snOut, ...fcOut);
jumpers.push(['pw.in.A', 'pw.out.U'], ['pw.in.B', 'pw.out.V'], ['pw.in.C', 'pw.out.W']);
jumpers.push(['sens.in.A', 'sens.out.U'], ['sens.in.B', 'sens.out.V'], ['sens.in.C', 'sens.out.W']);

// ---- Рейка 3 (справа): резисторы и машины; зажимы снизу ----
const R3 = 430;
const DUCT = { x1: 740, x2: 1390, y: R2 + 30, h: R3 - R2 - 60 };
const resistors = [
  { id: 'r1', ohm: 6.3, x0: 760 },
  { id: 'r2', ohm: 1.7, x0: 856 },
  { id: 'r3', ohm: 8.6, x0: 952 },
];
for (const r of resistors) {
  r.nodes = block(r.id, ['1', '2', '3', '4'], r.x0, R3, 'bottom', PAIRS);
  nodes.push(...r.nodes);
  buses.push([`${r.id}.1`, `${r.id}.2`], [`${r.id}.3`, `${r.id}.4`]);
}
const m1 = pairBlock('m1', ['В+', 'В−', 'Я+', 'Я−'], 1064, R3, 'bottom', ['orange', 'blue', 'orange', 'blue']);
nodes.push(...m1.nodes); buses.push(...m1.buses);
const m2 = block('m2', ['A', 'B', 'C'], 1272, R3, 'bottom', ['orange', 'gray', 'blue']);
nodes.push(...m2);

// ---- Рейка 4 (низ слева): контакты KM4–KM8, управляемых из шкафа А6; зажимы сверху ----
const R4 = 640;
const aux = [['k4a', 'KM4'], ['k4b', 'KM4'], ['k5a', 'KM5'], ['k5b', 'KM5'], ['k6', 'KM6'], ['k7', 'KM7'], ['k8', 'KM8']]
  .map(([id, label], i) => ({ id, label, nodes: block(id, ['1', '2', '3', '4'], 60 + i * 96, R4, 'top', PAIRS) }));
for (const a of aux) nodes.push(...a.nodes);

// ---- Графика наборного поля ----
function fieldArt() {
  const a = art;
  let s = '';

  // рейки
  s += a.rail(30, 370, R1) + a.rail(920, 1380, R1);
  s += a.rail(40, 80, R2) + a.rail(128, 480, R2) + a.rail(920, 1380, R2);
  s += a.rail(740, 1340, R3);
  // кабель-канал между рейками 2 и 3: сюда уходит внутренняя проводка обоих рядов
  s += a.duct(DUCT.x1, DUCT.x2, DUCT.y, DUCT.h);
  s += a.rail(40, 730, R4);

  // ---- табличка 1 (слева): вводы, цепь управления, контакты KM1–KM3 ----
  const P1 = 92, P1B = 300;
  s += a.plate(40, P1, 560, P1B - P1);
  for (const [b, x, v, t] of [[in1, 96, '~380 В', 'Ввод 1'], [in2, 216, '~380 В', 'Ввод 2'], [in3, 312, '= 240 В', 'Ввод 3']]) {
    s += a.pins(xs(b), P1 + 8);
    s += b.map(n => a.text(n.x, P1 + 22, n.label, 'lbl-tiny')).join('');
    s += a.text(x, P1 + 42, v, 'lbl-big') + a.text(x, P1 + 62, t, 'lbl-big');
  }
  // цепь управления: X1 — Стоп — Пуск/KM1 — катушки KM1..KM3 — X2
  const cy = 185, y2 = cy + 22, y3 = cy + 55, y4 = cy + 87;
  s += a.pin(60, P1B - 8) + a.line(60, P1B - 11, 60, cy) + a.line(60, cy, 68, cy);
  s += a.button(82, cy, 'Стоп', true) + a.line(96, cy, 100, cy);
  s += a.button(114, cy, 'Пуск') + a.line(128, cy, 132, cy);
  s += a.line(100, cy, 100, y2) + a.contactH(114, y2, 'KM1') + a.line(128, y2, 132, y2) + a.line(132, y2, 132, cy);
  s += a.coil(141, cy, 'KM1') + a.line(150, cy, 150, P1B - 11) + a.pin(150, P1B - 8);
  s += a.line(100, y2, 100, y3) + a.contactH(114, y3, 'KM1', true) + a.line(128, y3, 132, y3) + a.coil(141, y3, 'KM2');
  s += a.line(100, y3, 100, y4) + a.contactH(114, y4, 'KM2', true) + a.line(128, y4, 132, y4) + a.coil(141, y4, 'KM3');
  // силовые контакты KM1..KM3: по два НО-контакта
  for (const [id, b] of Object.entries(km)) {
    const [x1, x2, x3, x4] = xs(b);
    s += a.pins([x1, x2, x3, x4], P1B - 8);
    s += a.text((x2 + x3) / 2, P1B - 66, id.toUpperCase(), 'lbl-big');
    s += a.contactPair(x1, x2, P1B - 11, true) + a.contactPair(x3, x4, P1B - 11, true);
    s += a.line(x1 + 8, P1B - 52, x3 + 4, P1B - 52, 'art-line art-dashed');
  }

  // ---- табличка 1 (справа): ТП, ваттметр, датчики, ПЧ ----
  s += a.plate(910, P1, 470, P1B - P1);
  const dev = (inB, outB, x, w, title, sub) => {
    let d = a.pins(xs(inB), P1 + 8) + inB.map(n => a.text(n.x, P1 + 22, n.label, 'lbl-tiny')).join('');
    d += a.leads(xs(inB), P1 + 24, P1 + 46) + a.box(x, P1 + 46, w, 80, title, sub);
    d += a.leads(xs(outB), P1 + 126, P1B - 24) + outB.map(n => a.text(n.x, P1B - 14, n.label, 'lbl-tiny')).join('') + a.pins(xs(outB), P1B - 8);
    return d;
  };
  s += dev(tpIn, tpOut, 934, 100, 'ТП', 'DCS800');
  s += dev(pwIn, pwOut, 1054, 80, 'Ваттметр', 'PW');
  s += a.pins(xs(snIn), P1 + 8) + snIn.map(n => a.text(n.x, P1 + 22, n.label, 'lbl-tiny')).join('');
  s += a.leads(xs(snIn), P1 + 24, P1B - 24) + a.sensors(xs(snIn), P1 + 52, P1 + 126);
  s += snOut.map(n => a.text(n.x, P1B - 14, n.label, 'lbl-tiny')).join('') + a.pins(xs(snOut), P1B - 8);
  s += dev(fcIn, fcOut, 1274, 80, 'ПЧ', 'ACS880');

  // ---- табличка 3 (справа внизу): резисторы, М1, М2 ----
  const P3 = 472;
  s += a.plate(740, P3, 660, 228);
  for (const r of resistors) {
    const [x1, x2, x3, x4] = xs(r.nodes), c1 = (x1 + x2) / 2, c2 = (x3 + x4) / 2;
    s += a.pins([x1, x2, x3, x4], P3 + 8);
    s += a.leads([x1, x2, x3, x4], P3 + 11, P3 + 48) + a.line(x1, P3 + 48, x2, P3 + 48) + a.line(x3, P3 + 48, x4, P3 + 48);
    s += a.line(c1, P3 + 48, c1, P3 + 88) + a.line(c2, P3 + 48, c2, P3 + 88);
    s += a.resistorH(c1, c2, P3 + 88, `${String(r.ohm).replace('.', ',')} Ом`);
  }
  // М1: В+ → PA1 → ОВ → В−; Я+ → PA2 → якорь → Я−
  const mp = m1.nodes, cB1 = (mp[0].x + mp[1].x) / 2, cB2 = (mp[2].x + mp[3].x) / 2, cA1 = (mp[4].x + mp[5].x) / 2, cA2 = (mp[6].x + mp[7].x) / 2;
  s += a.pins(xs(mp), P3 + 8) + a.leads(xs(mp), P3 + 11, P3 + 43);
  for (let i = 0; i < 8; i += 2) s += a.line(mp[i].x, P3 + 43, mp[i + 1].x, P3 + 43);
  s += ['В+', 'В−', 'Я+', 'Я−'].map((l, i) => a.text([cB1, cB2, cA1, cA2][i], P3 + 24, l, 'lbl-tiny')).join('');
  const my = P3 + 43;
  s += a.line(cB1, my, cB1, 690) + a.meterAcross(cB1, cB2, my + 25, 'PV1') + a.meter(cB1, my + 50, 'A', 'PA1');
  s += a.line(cB2, my, cB2, 600) + a.line(cB2, 600, 1140, 600) + a.line(1140, 600, 1140, 690);
  s += a.line(cB1, 690, 1092, 690) + `<path d="M1092 690 q6 -9 12 0 q6 -9 12 0 q6 -9 12 0 q6 -9 12 0" class="art-line"/>`;
  s += a.text(1116, 703, 'ОВ', 'lbl-tiny');
  const M1 = { x: 1196, y: 640 };
  s += a.line(cA1, my, cA1, 618) + a.line(cA2, my, cA2, 618) + a.meterAcross(cA1, cA2, my + 25, 'PV2') + a.meter(cA1, my + 50, 'A', 'PA2');
  s += a.line(cA1, 618, M1.x - 14, M1.y - 14) + a.line(cA2, 618, M1.x + 14, M1.y - 14);
  s += a.circle(M1.x, M1.y, 20, 'M1');
  s += a.circle(1160, M1.y, 8, 'ТГ') + a.line(1168, M1.y, M1.x - 20, M1.y, 'art-shaft');
  s += a.line(M1.x + 20, M1.y, 1228, M1.y, 'art-shaft') + `<rect x="1228" y="${M1.y - 10}" width="34" height="20" class="dev-box"/>` + a.text(1245, M1.y + 4, 'ДМ', 'lbl-tiny');
  // М2 (СДПМ)
  const M2 = { x: 1300, y: 640 };
  s += a.line(1262, M1.y, M2.x - 22, M1.y, 'art-shaft');
  s += a.circle(M2.x, M2.y, 22, '') + a.text(M2.x, M2.y - 3, 'N', 'lbl-small') + a.text(M2.x, M2.y + 11, 'S', 'lbl-small') + a.line(M2.x - 22, M2.y, M2.x + 22, M2.y);
  s += a.text(M2.x + 30, M2.y + 5, 'M2', 'dev-title', 'start');
  const [ma, mb, mc] = xs(m2);
  s += a.pins([ma, mb, mc], P3 + 8) + m2.map(n => a.text(n.x, P3 + 24, n.label, 'lbl-tiny')).join('');
  s += a.line(ma, P3 + 11, ma, 604) + a.line(ma, 604, M2.x - 10, M2.y - 20);
  s += a.line(mb, P3 + 11, mb, M2.y - 22);
  s += a.line(mc, P3 + 11, mc, 604) + a.line(mc, 604, M2.x + 10, M2.y - 20);
  s += a.meterAcross(ma, mb, P3 + 62, 'PV3') + a.meter(ma, P3 + 92, 'A', 'PA3');

  // ---- табличка 4 (слева внизу): KM4–KM8 ----
  const P4 = 478, P4B = 590;
  s += a.plate(40, P4, 690, P4B - P4);
  s += a.text(385, P4 + 18, 'Схема управления контакторами KM4, KM5, KM6, KM7 и KM8 собирается в шкафу А6', 'lbl-small');
  for (const g of aux) {
    const [x1, x2, x3, x4] = xs(g.nodes);
    s += a.pins([x1, x2, x3, x4], P4B - 8);
    s += a.text((x2 + x3) / 2, P4B - 62, g.label, 'lbl');
    s += a.contactPair(x1, x2, P4B - 11, true) + a.contactPair(x3, x4, P4B - 11, true);
    s += a.line(x1 + 8, P4B - 52, x3 + 4, P4B - 52, 'art-line art-dashed');
  }

  // концевой выключатель двери
  s += a.limitSwitch(1420, 600);
  return s;
}

const names = {
  in1: 'Ввод 1 ~380 В', in2: 'Ввод 2 ~380 В', in3: 'Ввод 3 =240 В', ctrl: 'Цепь управления',
  km1: 'Контакты KM1', km2: 'Контакты KM2', km3: 'Контакты KM3',
  tp: 'ТП DCS800', fc: 'ПЧ ACS880', pw: 'Ваттметр PW', sens: 'Датчики ДН/ДТ',
  r1: 'Резистор 6,3 Ом', r2: 'Резистор 1,7 Ом', r3: 'Резистор 8,6 Ом',
  m1: 'М1 — ДПТ НВ', m2: 'М2 — СДПМ',
  ...Object.fromEntries(aux.map(g => [g.id, `Контакты ${g.label} (управление из шкафа А6, в модели не задействованы)`])),
};

export const dcBench = {
  id: 'dc',
  title: 'Стенд для исследования электропривода с двигателем постоянного тока',
  cabinets: 'А1–А6',
  field: { w: 1500, h: 720, nodes, buses, jumpers, ducts: [DUCT], art: fieldArt, names },

  breakers: [
    { id: 'rcd', label: 'УЗО', poles: 2, group: 'main' },
    { id: 'main380', label: 'Главный выключатель ~380 В', poles: 3, group: 'main', needs: ['rcd'] },
    { id: 'drives', label: 'Питание на приводы ~380 В', poles: 3, needs: ['main380'], trip: true },
    { id: 'aux220', label: 'Питание внутренних цепей ~220 В', poles: 1, needs: ['main380'] },
    { id: 'main240', label: 'Главный выключатель =240 В', poles: 2, needs: ['rcd'], trip: true, separate: true },
  ],
  inputs: [
    { id: 'in1', label: 'Ввод 1', voltage: '~380 В', kind: 'ac', breaker: 'drives', nodes: { A: 'in1.A', B: 'in1.B', C: 'in1.C', N: 'in1.N' } },
    { id: 'in2', label: 'Ввод 2', voltage: '~380 В', kind: 'ac', breaker: 'drives', nodes: { A: 'in2.A', B: 'in2.B', C: 'in2.C', N: 'in2.N' } },
    { id: 'in3', label: 'Ввод 3', voltage: '= 240 В', kind: 'dc', breaker: 'main240', nodes: { '+': 'in3.+', '−': 'in3.−' } },
  ],

  ctrlChain: { X1: 'ctrl.X1', X2: 'ctrl.X2' },
  contactors: [
    { id: 'km1', contacts: [['km1.1', 'km1.2'], ['km1.3', 'km1.4']] },
    { id: 'km2', contacts: [['km2.1', 'km2.2'], ['km2.3', 'km2.4']], after: 'km1', timer: 't1' },
    { id: 'km3', contacts: [['km3.1', 'km3.2'], ['km3.3', 'km3.4']], after: 'km2', timer: 't2' },
  ],

  converters: [
    {
      id: 'tp', kind: 'dc', title: 'Тиристорный преобразователь', model: 'ABB DCS800', cabinet: 'А3',
      in: { A: 'tp.in.A', B: 'tp.in.B', C: 'tp.in.C' },
      out: { 'Я+': 'tp.out.Я+', 'Я−': 'tp.out.Я−', 'В+': 'tp.out.В+', 'В−': 'tp.out.В−' },
      modes: [
        { id: 'I', label: 'I', unit: 'А', max: 25 },
        { id: 'w', label: 'ω', unit: 'об/мин', max: 2000 },
        { id: 'U', label: 'U', unit: 'В', max: 240 },
      ],
      fieldCol: { label: 'Задание тока возбуждения', unit: 'А', max: 1.44 },
      controls: ['setup', 'mode', 'polarity', 'ref', 'on', 'off'],
    },
    {
      id: 'fc', kind: 'fc', title: 'Преобразователь частоты', model: 'ABB ACS880', cabinet: 'А1',
      in: { A: 'fc.in.A', B: 'fc.in.B', C: 'fc.in.C' },
      out: { U: 'fc.out.U', V: 'fc.out.V', W: 'fc.out.W' },
      modes: [
        { id: 'w', label: 'ω', unit: 'об/мин', max: 2000 },
        { id: 'M', label: 'M', unit: 'Нм', max: 25 },
      ],
      controls: ['setup', 'mode', 'polarity', 'ref', 'on', 'off'],
    },
  ],

  resistors: resistors.map(r => ({ id: r.id, ohm: r.ohm, a: `${r.id}.1`, b: `${r.id}.3` })),

  motors: [
    {
      id: 'm1', kind: 'dc', title: 'М1 — ДПТ НВ', tacho: true,
      windings: { field: ['m1.В+.1', 'm1.В−.1'], arm: ['m1.Я+.1', 'm1.Я−.1'] },
      nominal: { speed: 2000, current: 25 },
    },
    {
      id: 'm2', kind: 'pmsm', title: 'М2 — СДПМ (нагрузочная)',
      windings: { stator: ['m2.A', 'm2.B', 'm2.C'] },
      nominal: { speed: 2000 },
    },
  ],

  meters: [
    { id: 'PV1', kind: 'V', model: 'VLM-2-250/96', min: 0, max: 250, ticks: 5, across: ['m1.В+.1', 'm1.В−.1'] },
    { id: 'PV2', kind: 'V', model: 'М42607', min: -300, max: 300, ticks: 6, across: ['m1.Я+.1', 'm1.Я−.1'] },
    { id: 'n', kind: 'n', model: 'М42607', min: -3, max: 3, mult: 1000, ticks: 6, unit: 'об/мин', source: 'speed' },
    { id: 'PA1', kind: 'A', model: 'М4272', min: 0, max: 2.5, ticks: 5, series: { motor: 'm1', winding: 'field' } },
    { id: 'PA2', kind: 'A', model: 'М42607', min: -50, max: 50, ticks: 10, series: { motor: 'm1', winding: 'arm' } },
    { id: 'M', kind: 'M', model: 'М42607', min: -2, max: 2, mult: 20, ticks: 4, unit: 'Нм', source: 'torque' },
    { id: 'PW', kind: 'PW', model: 'ANR96', in: ['pw.in.A', 'pw.in.B', 'pw.in.C'] },
  ],
  metersLayout: [['PV1', 'PV2', 'n', 'PW'], ['PA1', 'PA2', 'M', null]],

  protections: { overspeed: 2200, overcurrent: 70 },
};
