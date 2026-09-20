// Стенд для исследования электропривода с двигателем постоянного тока
// (шкафы А1–А6, монтажный отсек в шкафу А2, рис. В.12 методички).
import { row, pairs, art } from './common.js';

const nodes = [];
const buses = [];
const jumpers = [];

// ---- Вводы питания (шкаф А2, верх наборного поля) ----
nodes.push(...row('in1', ['A', 'B', 'C', 'N'], 265, 70));
nodes.push(...row('in2', ['A', 'B', 'C', 'N'], 405, 70));
nodes.push(...row('in3', ['+', '−'], 545, 70, 40));

// ---- Цепь управления Стоп/Пуск с контакторами KM1..KM3 ----
nodes.push({ id: 'ctrl.X1', label: 'X1', x: 125, y: 350 });
nodes.push({ id: 'ctrl.X2', label: 'X2', x: 325, y: 350 });

// ---- Силовые контакты контакторов: по два НО-контакта ----
for (const [km, x0] of [['km1', 395], ['km2', 490], ['km3', 585]]) {
  nodes.push(...row(km, ['1', '2', '3', '4'], x0, 350, 22));
}

// ---- Преобразователи и проходные устройства (правый верх) ----
nodes.push(...row('tp.in', ['A', 'B', 'C'], 995, 70));
nodes.push(...row('tp.out', ['В+', 'В−', 'Я+', 'Я−'], 970, 250));
nodes.push(...row('pw.in', ['A', 'B', 'C'], 1115, 70));
nodes.push(...row('pw.out', ['U', 'V', 'W'], 1115, 250));
jumpers.push(['pw.in.A', 'pw.out.U'], ['pw.in.B', 'pw.out.V'], ['pw.in.C', 'pw.out.W']);
nodes.push(...row('sens.in', ['A', 'B', 'C'], 1235, 70));
nodes.push(...row('sens.out', ['U', 'V', 'W'], 1235, 250));
jumpers.push(['sens.in.A', 'sens.out.U'], ['sens.in.B', 'sens.out.V'], ['sens.in.C', 'sens.out.W']);
nodes.push(...row('fc.in', ['A', 'B', 'C'], 1355, 70));
nodes.push(...row('fc.out', ['U', 'V', 'W'], 1355, 250));

// ---- Резисторы (левый низ) ----
const resistors = [
  { id: 'r1', ohm: 6.3, x0: 790 },
  { id: 'r2', ohm: 1.7, x0: 890 },
  { id: 'r3', ohm: 8.6, x0: 990 },
];
for (const r of resistors) {
  nodes.push(...row(r.id, ['1', '2', '3', '4'], r.x0, 500, 25));
  buses.push([`${r.id}.1`, `${r.id}.2`], [`${r.id}.3`, `${r.id}.4`]);
}

// ---- Машины (правый низ) ----
const m1 = pairs('m1', ['В+', 'В−', 'Я+', 'Я−'], 1115, 500, 25, 50);
nodes.push(...m1.nodes); buses.push(...m1.buses);
nodes.push(...row('m2', ['A', 'B', 'C'], 1350, 500));

// ---- Графика наборного поля ----
function fieldArt() {
  const a = art;
  let s = '';
  // подписи вводов
  s += a.text(302, 130, '~380 В', 'lbl-big') + a.text(302, 150, 'Ввод 1', 'lbl-big');
  s += a.text(442, 130, '~380 В', 'lbl-big') + a.text(442, 150, 'Ввод 2', 'lbl-big');
  s += a.text(565, 130, '= 240 В', 'lbl-big') + a.text(565, 150, 'Ввод 3', 'lbl-big');

  // цепь управления (схематично): X1 — Стоп — Пуск/KM1 — катушки — X2
  s += a.line(125, 330, 125, 230) + a.line(125, 230, 150, 230);
  s += a.button(165, 230, 'Стоп', true);
  s += a.line(180, 230, 200, 230);
  s += a.button(215, 230, 'Пуск');
  s += a.line(230, 230, 250, 230);
  // самоподхват KM1 параллельно Пуску
  s += a.line(200, 230, 200, 260) + a.contactH(215, 260, 'KM1') + a.line(230, 260, 250, 260) + a.line(250, 260, 250, 230);
  s += a.line(250, 230, 270, 230) + a.coil(285, 230, 'KM1');
  // ветвь KM2: контакт KM1 с выдержкой времени
  s += a.line(250, 230, 250, 290) + a.contactH(215, 290, 'KM1', true) + a.line(200, 290, 200, 260) + a.line(230, 290, 270, 290) + a.coil(285, 290, 'KM2');
  // ветвь KM3: контакт KM2 с выдержкой времени
  s += a.line(250, 290, 250, 320) + a.contactH(215, 320, 'KM2', true) + a.line(200, 320, 200, 290) + a.line(230, 320, 270, 320) + a.coil(285, 320, 'KM3');
  s += a.line(300, 230, 325, 230) + a.line(300, 290, 325, 290) + a.line(300, 320, 325, 320) + a.line(325, 230, 325, 330);
  s += a.text(225, 400, 'Цепь управления (Пуск/Стоп, KM1–KM3 с выдержкой времени)', 'lbl-small');

  // силовые контакты KM1..KM3
  for (const [km, x0] of [['KM1', 395], ['KM2', 490], ['KM3', 585]]) {
    s += a.text(x0 + 33, 300, km, 'lbl-big');
    s += a.line(x0, 330, x0, 318) + a.line(x0, 318, x0 + 22, 308) + a.line(x0 + 22, 318, x0 + 22, 330);
    s += a.line(x0 + 44, 330, x0 + 44, 318) + a.line(x0 + 44, 318, x0 + 66, 308) + a.line(x0 + 66, 318, x0 + 66, 330);
    s += a.dashedBox(x0 - 10, 296, 86, 30);
  }

  // преобразователи
  s += a.box(965, 120, 110, 90, 'ТП', 'DCS800');
  s += a.line(995, 90, 995, 120) + a.line(1020, 90, 1020, 120) + a.line(1045, 90, 1045, 120);
  s += a.line(970, 210, 970, 230) + a.line(995, 210, 995, 230) + a.line(1020, 210, 1020, 230) + a.line(1045, 210, 1045, 230);
  s += a.box(1095, 120, 90, 90, 'Ваттметр', 'PW');
  s += a.line(1115, 90, 1115, 120) + a.line(1140, 90, 1140, 120) + a.line(1165, 90, 1165, 120);
  s += a.line(1115, 210, 1115, 230) + a.line(1140, 210, 1140, 230) + a.line(1165, 210, 1165, 230);
  s += a.dashedBox(1212, 120, 96, 90) + a.text(1260, 112, 'ДН / ДТ', 'lbl-small');
  for (const x of [1235, 1260, 1285]) s += a.line(x, 90, x, 230);
  s += `<rect x="1228" y="150" width="14" height="10" class="art-res"/><rect x="1253" y="150" width="14" height="10" class="art-res"/><rect x="1278" y="150" width="14" height="10" class="art-res"/>`;
  s += `<rect x="1240" y="130" width="14" height="10" class="art-res"/><rect x="1265" y="180" width="14" height="10" class="art-res"/>`;
  s += a.box(1325, 120, 110, 90, 'ПЧ', 'ACS880');
  s += a.line(1355, 90, 1355, 120) + a.line(1380, 90, 1380, 120) + a.line(1405, 90, 1405, 120);
  s += a.line(1355, 210, 1355, 230) + a.line(1380, 210, 1380, 230) + a.line(1405, 210, 1405, 230);

  // резисторы
  for (const r of resistors) {
    const x1 = r.x0 + 12, x2 = r.x0 + 62;
    s += a.line(r.x0, 520, r.x0, 560) + a.line(r.x0 + 25, 520, r.x0 + 25, 560) + a.line(r.x0, 560, x1, 560);
    s += a.line(r.x0 + 50, 520, r.x0 + 50, 560) + a.line(r.x0 + 75, 520, r.x0 + 75, 560) + a.line(x2, 560, r.x0 + 75, 560);
    s += a.resistorH(x1, x2, 560, `${String(r.ohm).replace('.', ',')} Ом`);
  }

  // машина М1 (ДПТ НВ) с приборами
  s += a.line(1115, 520, 1115, 560) + a.line(1140, 520, 1140, 560) + a.line(1115, 560, 1140, 560);
  s += a.line(1165, 520, 1165, 560) + a.line(1190, 520, 1190, 560) + a.line(1165, 560, 1190, 560);
  s += a.line(1215, 520, 1215, 560) + a.line(1240, 520, 1240, 560) + a.line(1215, 560, 1240, 560);
  s += a.line(1265, 520, 1265, 560) + a.line(1290, 520, 1290, 560) + a.line(1265, 560, 1290, 560);
  // возбуждение: В+ → PA1 → ОВ → В−, PV1 между В+ и В−
  s += a.line(1127, 560, 1127, 700) + a.line(1127, 700, 1280, 700) + a.line(1177, 560, 1177, 690) + a.line(1177, 690, 1230, 690);
  s += a.meter(1127, 600, 'A', 'PA1') + a.meter(1152, 585, 'V', 'PV1') + a.line(1127, 585, 1144, 585) + a.line(1160, 585, 1177, 585);
  s += `<path d="M1230 690 q6 -8 12 0 q6 -8 12 0 q6 -8 12 0 q6 -8 12 0" class="art-line"/>` + a.line(1278, 690, 1280, 700);
  s += a.text(1205, 712, 'ОВ', 'lbl-small');
  // якорь: Я+ → PA2 → M1 → Я−, PV2 между Я+ и Я−
  s += a.line(1227, 560, 1227, 640) + a.line(1277, 560, 1277, 640);
  s += a.meter(1227, 600, 'A', 'PA2') + a.meter(1252, 585, 'V', 'PV2') + a.line(1227, 585, 1244, 585) + a.line(1260, 585, 1277, 585);
  s += a.circle(1252, 650, 20, 'M1') + a.line(1227, 640, 1232, 650) + a.line(1277, 640, 1272, 650);
  s += a.circle(1195, 650, 11, 'ТГ') + a.line(1206, 650, 1232, 650, 'art-shaft');
  // датчик момента и М2
  s += a.line(1272, 650, 1300, 650, 'art-shaft') + `<rect x="1300" y="640" width="40" height="20" class="dev-box"/>` + a.text(1320, 654, 'ДМ', 'lbl-tiny');
  s += a.line(1340, 650, 1360, 650, 'art-shaft');
  s += a.circle(1385, 650, 22, '') + a.text(1385, 646, 'N', 'lbl-small') + a.text(1385, 660, 'S', 'lbl-small') + a.text(1420, 655, 'M2', 'dev-title', 'start');
  s += a.line(1350, 520, 1350, 628) + a.line(1375, 520, 1375, 628) + a.line(1400, 520, 1400, 628);
  s += a.meter(1350, 570, 'A', '') + a.meter(1362, 545, 'V', '') + a.line(1350, 545, 1354, 545) + a.line(1370, 545, 1375, 545);
  return s;
}

export const dcBench = {
  id: 'dc',
  title: 'Стенд для исследования электропривода с двигателем постоянного тока',
  cabinets: 'А1–А6',
  field: { w: 1500, h: 740, nodes, buses, jumpers, art: fieldArt },

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
