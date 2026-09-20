// Стенд для исследования электроприводов с асинхронными двигателями
// (шкафы Б1–Б6, монтажный отсек в шкафу Б5, рис. В.13 методички).
import { row, pairs, art } from './common.js';

const nodes = [];
const buses = [];
const jumpers = [];

// ---- Вводы питания ----
nodes.push(...row('in1', ['A', 'B', 'C', 'N'], 85, 40));
nodes.push(...row('in2', ['A', 'B', 'C', 'N'], 215, 40));

// ---- Цепь управления ----
nodes.push({ id: 'ctrl.X1', label: 'X1', x: 100, y: 190 });
nodes.push({ id: 'ctrl.X2', label: 'X2', x: 300, y: 190 });

// ---- Контакторы: по три силовых контакта, верх/низ ----
const kmX = { km1: 365, km2: 445, km3: 525 };
for (const [km, x0] of Object.entries(kmX)) {
  nodes.push(...row(km, ['1', '3', '5'], x0, 190, 25));
  nodes.push(...row(km, ['2', '4', '6'], x0, 650, 25));
}

// ---- Резисторы: две группы по три ----
const resistors = [];
for (const [g, ohm, x0] of [['ra', 4.2, 75], ['rb', 1.2, 225]]) {
  for (let i = 0; i < 3; i++) {
    const id = `${g}${i + 1}`;
    nodes.push({ id: `${id}.1`, label: '1', x: x0 + i * 50, y: 650 });
    nodes.push({ id: `${id}.2`, label: '2', x: x0 + i * 50 + 25, y: 650 });
    resistors.push({ id, ohm, a: `${id}.1`, b: `${id}.2`, x: x0 + i * 50 });
  }
}

// ---- Преобразователи и проходные устройства ----
nodes.push(...row('tpn.in', ['A', 'B', 'C'], 690, 40));
nodes.push(...row('tpn.byp', ['B1', 'B2', 'B3'], 800, 40));
nodes.push(...row('tpn.out', ['U', 'V', 'W'], 690, 215));
nodes.push(...row('tpn.k4', ['1', '2', '3'], 800, 215));
nodes.push(...row('tp.in', ['A', 'B', 'C'], 915, 40));
nodes.push(...row('tp.out', ['+', '−'], 927, 215, 26));
nodes.push(...row('pw.in', ['A', 'B', 'C'], 1035, 40));
nodes.push(...row('pw.out', ['U', 'V', 'W'], 1035, 215));
jumpers.push(['pw.in.A', 'pw.out.U'], ['pw.in.B', 'pw.out.V'], ['pw.in.C', 'pw.out.W']);
nodes.push(...row('sens.in', ['A', 'B', 'C'], 1155, 40));
nodes.push(...row('sens.out', ['U', 'V', 'W'], 1155, 215));
jumpers.push(['sens.in.A', 'sens.out.U'], ['sens.in.B', 'sens.out.V'], ['sens.in.C', 'sens.out.W']);
nodes.push(...row('fc.in', ['A', 'B', 'C'], 1275, 40));
nodes.push(...row('fc.out', ['U', 'V', 'W'], 1275, 215));
nodes.push(...row('fc.br', ['Br+', 'Br−'], 1365, 215));

// ---- Машины ----
const m3r = pairs('m3r', ['a', 'b', 'c'], 705, 450, 25, 50);
const m3s = pairs('m3', ['A', 'B', 'C'], 880, 450, 25, 50);
const m4s = pairs('m4', ['A', 'B', 'C'], 1085, 450, 25, 50);
nodes.push(...m3r.nodes, ...m3s.nodes, ...m4s.nodes);
buses.push(...m3r.buses, ...m3s.buses, ...m4s.buses);
nodes.push(...row('m4', ['Y', 'X', 'Z'], 1265, 450));
const r1 = pairs('r1', ['1', '2'], 1355, 450, 25, 50);
nodes.push(...r1.nodes); buses.push(...r1.buses);
resistors.push({ id: 'r1', ohm: 10, a: 'r1.1.1', b: 'r1.2.1', x: 1355 });

function fieldArt() {
  const a = art;
  let s = '';
  s += a.text(122, 100, '~380 В', 'lbl-big') + a.text(122, 120, 'Ввод 1', 'lbl-big');
  s += a.text(252, 100, '~380 В', 'lbl-big') + a.text(252, 120, 'Ввод 2', 'lbl-big');

  // цепь управления
  s += a.line(100, 210, 100, 290) + a.line(100, 290, 115, 290);
  s += a.button(130, 290, 'Стоп', true) + a.line(145, 290, 165, 290);
  s += a.button(180, 290, 'Пуск') + a.line(195, 290, 215, 290);
  s += a.line(165, 290, 165, 320) + a.contactH(180, 320, 'KM1') + a.line(195, 320, 215, 320) + a.line(215, 320, 215, 290);
  s += a.line(215, 290, 235, 290) + a.coil(250, 290, 'KM1');
  s += a.line(215, 320, 215, 355) + a.contactH(180, 355, 'KM1', true) + a.line(165, 355, 165, 320) + a.line(195, 355, 235, 355) + a.coil(250, 355, 'KM2');
  s += a.line(215, 355, 215, 390) + a.contactH(180, 390, 'KM2', true) + a.line(165, 390, 165, 355) + a.line(195, 390, 235, 390) + a.coil(250, 390, 'KM3');
  s += a.line(265, 290, 300, 290) + a.line(265, 355, 300, 355) + a.line(265, 390, 300, 390) + a.line(300, 290, 300, 390) + a.line(300, 290, 300, 210);
  s += a.text(200, 430, 'Цепь управления', 'lbl-small');
  s += a.text(200, 445, '(Пуск/Стоп, KM1–KM3 с выдержкой времени)', 'lbl-small');

  // контакторы: три полюса каждый, контакт на разной высоте
  const kmY = { km1: 300, km2: 400, km3: 500 };
  for (const [km, x0] of Object.entries(kmX)) {
    const y = kmY[km];
    s += a.text(x0 + 25, y - 25, km.toUpperCase(), 'lbl-big');
    s += a.dashedBox(x0 - 15, y - 15, 80, 40);
    for (let i = 0; i < 3; i++) {
      const x = x0 + i * 25;
      s += a.line(x, 210, x, y - 5) + a.line(x, y - 5, x + 10, y + 12) + a.line(x, y + 15, x, 630);
    }
  }

  // резисторы
  for (const [g, label, x0] of [['ra', '4,2 Ом', 75], ['rb', '1,2 Ом', 225]]) {
    s += a.text(x0 + 62, 540, label, 'lbl-small');
    for (let i = 0; i < 3; i++) {
      const x = x0 + i * 50;
      s += a.line(x, 630, x, 615) + a.line(x, 615, x + 12, 615) + a.line(x + 25, 630, x + 25, 615) + a.line(x + 25, 615, x + 12, 615);
      s += a.resistorV(x + 12, 555, 615, '');
      s += a.line(x + 12, 555, x + 12, 548);
    }
  }

  // ТПН
  s += a.box(665, 90, 210, 90, 'ТПН', 'PST30');
  for (const x of [690, 715, 740]) s += a.line(x, 60, x, 90) + a.line(x, 180, x, 195);
  for (const x of [800, 825, 850]) s += a.line(x, 60, x, 90) + a.line(x, 180, x, 195);
  s += a.text(825, 76, 'байпас K4', 'lbl-tiny');
  // ТП
  s += a.box(895, 90, 90, 90, 'ТП', 'DCS800');
  for (const x of [915, 940, 965]) s += a.line(x, 60, x, 90);
  s += a.line(927, 180, 927, 195) + a.line(953, 180, 953, 195);
  // PW
  s += a.box(1015, 90, 90, 90, 'Ваттметр', 'PW');
  for (const x of [1035, 1060, 1085]) s += a.line(x, 60, x, 90) + a.line(x, 180, x, 195);
  // датчики
  s += a.dashedBox(1132, 90, 96, 90) + a.text(1180, 82, 'ДН / ДТ', 'lbl-small');
  for (const x of [1155, 1180, 1205]) s += a.line(x, 60, x, 195);
  s += `<rect x="1148" y="130" width="14" height="10" class="art-res"/><rect x="1173" y="130" width="14" height="10" class="art-res"/><rect x="1198" y="130" width="14" height="10" class="art-res"/>`;
  s += `<rect x="1160" y="108" width="14" height="10" class="art-res"/><rect x="1185" y="152" width="14" height="10" class="art-res"/>`;
  // ПЧ
  s += a.box(1250, 90, 100, 90, 'ПЧ', 'ACS880');
  for (const x of [1275, 1300, 1325]) s += a.line(x, 60, x, 90) + a.line(x, 180, x, 195);
  s += a.line(1350, 135, 1365, 135) + a.line(1365, 135, 1365, 195) + a.line(1350, 145, 1390, 145) + a.line(1390, 145, 1390, 195);

  // машины: М3 (фазный ротор) — ротор a,b,c и статор A,B,C
  const drop = (x1, x2, y1, y2) => a.line(x1, y1, x1, y2) + a.line(x2, y1, x2, y2) + a.line(x1, y2, x2, y2);
  for (const x of [705, 755, 805]) s += drop(x, x + 25, 470, 500);
  for (const x of [880, 930, 980]) s += drop(x, x + 25, 470, 500);
  for (const x of [1085, 1135, 1185]) s += drop(x, x + 25, 470, 500);
  // ротор М3 → кольца
  s += a.line(717, 500, 717, 660) + a.line(717, 660, 900, 660) + a.line(767, 500, 767, 600) + a.line(817, 500, 817, 600);
  s += a.meter(767, 540, 'V', 'PV2') + a.line(767, 540, 792, 540) + a.line(792, 540, 817, 540);
  s += a.meter(817, 570, 'A', 'PA2');
  s += a.line(767, 600, 900, 640) + a.line(817, 600, 905, 620);
  // статор М3
  s += a.line(892, 500, 892, 560) + a.line(942, 500, 942, 560) + a.line(992, 500, 992, 560);
  s += a.meter(917, 530, 'V', 'PV1') + a.line(892, 530, 909, 530) + a.line(925, 530, 942, 530);
  s += a.meter(892, 560, 'A', 'PA1');
  s += a.line(892, 568, 892, 585) + a.line(942, 560, 942, 585) + a.line(992, 560, 992, 585);
  s += a.circle(940, 610, 24, 'M3');
  s += a.circle(880, 610, 11, 'ТГ') + a.line(891, 610, 916, 610, 'art-shaft');
  s += a.line(964, 610, 1000, 610, 'art-shaft') + `<rect x="1000" y="598" width="44" height="24" class="dev-box"/>` + a.text(1022, 640, 'Датчик', 'lbl-tiny') + a.text(1022, 650, 'момента', 'lbl-tiny');
  s += a.line(1044, 610, 1080, 610, 'art-shaft');
  // статор М4: начала A,B,C и концы Y,X,Z
  s += a.line(1097, 500, 1097, 560) + a.line(1147, 500, 1147, 560) + a.line(1197, 500, 1197, 560);
  s += a.meter(1122, 530, 'V', 'PV3') + a.line(1097, 530, 1114, 530) + a.line(1130, 530, 1147, 530);
  s += a.meter(1097, 560, 'A', 'PA3');
  s += a.line(1097, 568, 1097, 585) + a.line(1147, 560, 1147, 585) + a.line(1197, 560, 1197, 585);
  s += a.circle(1104, 610, 24, '') + a.text(1104, 606, 'A B C', 'lbl-tiny') + a.text(1104, 616, 'Z X Y', 'lbl-tiny') + a.text(1104, 626, 'M4', 'lbl-small');
  s += a.text(1140, 615, 'M4', 'dev-title', 'start');
  s += a.line(1265, 470, 1265, 640) + a.line(1290, 470, 1290, 650) + a.line(1315, 470, 1315, 660);
  s += a.line(1265, 640, 1130, 640) + a.line(1290, 650, 1128, 650) + a.line(1315, 660, 1126, 660);
  // R1
  s += drop(1355, 1380, 470, 500) + drop(1405, 1430, 470, 500);
  s += a.line(1367, 500, 1367, 530) + a.resistorV(1367, 530, 600, 'R₁') + a.line(1367, 600, 1367, 610) + a.line(1367, 610, 1417, 610) + a.line(1417, 610, 1417, 500);
  return s;
}

export const acBench = {
  id: 'ac',
  title: 'Стенд для исследования электроприводов с асинхронными двигателями',
  cabinets: 'Б1–Б6',
  field: { w: 1500, h: 700, nodes, buses, jumpers, art: fieldArt },

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

  ctrlChain: { X1: 'ctrl.X1', X2: 'ctrl.X2' },
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
