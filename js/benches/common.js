// Вспомогательные функции для описания стендов.
//
// Клеммник (node) — пружинный push-in клеммник с тремя зажимами на общей
// шине: один занят внутренней проводкой стенда, два свободных расположены
// рядом на одной стороне (side: 'top' — сверху, 'bottom' — снизу).
// clamp 0 — левый свободный зажим, clamp 1 — правый. В один зажим входит
// один провод. color — цвет корпуса: gray | blue | orange | green.

export const PITCH = 24; // шаг клеммников на рейке
export const TERM = { w: 22, h: 52, clampDx: 5.5, clampDy: 16 };

/** Блок клеммников подряд на рейке. colors — строка или массив по клеммникам. */
export function block(prefix, labels, x0, y, side, colors = 'gray', extra = {}) {
  return labels.map((label, i) => ({
    id: `${prefix}.${label}`,
    label,
    x: x0 + i * PITCH,
    y,
    side,
    color: Array.isArray(colors) ? colors[i] : colors,
    ...extra,
  }));
}

/** Блок пар: два соседних клеммника с одной подписью, объединённые шиной. */
export function pairBlock(prefix, labels, x0, y, side, colors = 'gray') {
  const nodes = [], buses = [];
  labels.forEach((label, i) => {
    const c = Array.isArray(colors) ? colors[i] : colors;
    const a = { id: `${prefix}.${label}.1`, label, x: x0 + 2 * i * PITCH, y, side, color: c };
    const b = { id: `${prefix}.${label}.2`, label, x: x0 + (2 * i + 1) * PITCH, y, side, color: c };
    nodes.push(a, b);
    buses.push([a.id, b.id]);
  });
  return { nodes, buses };
}

/** x-координаты клеммников блока. */
export const xs = nodes => nodes.map(n => n.x);

// ---------- SVG-графика наборного поля (строки SVG) ----------

export const art = {
  text(x, y, s, cls = 'lbl', anchor = 'middle') {
    return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${s}</text>`;
  },
  /** DIN-рейка с концевыми фиксаторами. */
  rail(x1, x2, y) {
    return `<rect x="${x1}" y="${y - 7.5}" width="${x2 - x1}" height="15" class="rail"/>` +
      `<rect x="${x1}" y="${y - 2}" width="${x2 - x1}" height="4" class="rail-slot"/>` +
      `<rect x="${x1 - 6}" y="${y - 22}" width="7" height="44" rx="1" class="rail-clip"/>` +
      `<rect x="${x2 - 1}" y="${y - 22}" width="7" height="44" rx="1" class="rail-clip"/>`;
  },
  /** Перфорированный кабель-канал между рейками: внутренняя проводка клеммников уходит в него. */
  duct(x1, x2, y, h) {
    let s = `<rect x="${x1}" y="${y}" width="${x2 - x1}" height="${h}" rx="1.5" class="duct"/>` +
      `<rect x="${x1}" y="${y + 6}" width="${x2 - x1}" height="${h - 12}" class="duct-lid"/>`;
    for (let x = x1 + 5; x < x2 - 4; x += 8) {
      s += `<rect x="${x}" y="${y + 1.5}" width="4" height="3.5" rx=".8" class="duct-slot"/>` +
        `<rect x="${x}" y="${y + h - 5}" width="4" height="3.5" rx=".8" class="duct-slot"/>`;
    }
    return s;
  },
  /** Табличка со схемой (белый лист под/над клеммниками). */
  plate(x, y, w, h) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="plate"/>`;
  },
  /** Кружок свободного зажима на табличке. */
  pin(x, y) {
    return `<circle cx="${x}" cy="${y}" r="3" class="pin"/>`;
  },
  /** Кружки под рядом клеммников. */
  pins(xs, y) {
    return xs.map(x => art.pin(x, y)).join('');
  },
  box(x, y, w, h, title, sub = '') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="dev-box"/>` +
      `<text x="${x + w / 2}" y="${y + h / 2 + (sub ? -2 : 6)}" class="dev-title" text-anchor="middle">${title}</text>` +
      (sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 16}" class="dev-sub" text-anchor="middle">${sub}</text>` : '');
  },
  line(x1, y1, x2, y2, cls = 'art-line') {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`;
  },
  /** Вертикальные отводы от кружков к устройству. */
  leads(xs, y1, y2, cls = 'art-line') {
    return xs.map(x => art.line(x, y1, x, y2, cls)).join('');
  },
  poly(points, cls = 'art-line') {
    return `<polyline points="${points.map(p => p.join(',')).join(' ')}" class="${cls}"/>`;
  },
  /** Резистор горизонтально между (x1,y) и (x2,y). */
  resistorH(x1, x2, y, label) {
    const w = 40, h = 12, cx = (x1 + x2) / 2;
    return art.line(x1, y, cx - w / 2, y) + art.line(cx + w / 2, y, x2, y) +
      `<rect x="${cx - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" class="art-res"/>` +
      (label ? art.text(cx, y + 24, label, 'lbl-small') : '');
  },
  /** Резистор вертикально между (x,y1) и (x,y2). */
  resistorV(x, y1, y2, label) {
    const w = 12, h = 34, cy = (y1 + y2) / 2;
    return art.line(x, y1, x, cy - h / 2) + art.line(x, cy + h / 2, x, y2) +
      `<rect x="${x - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" class="art-res"/>` +
      (label ? art.text(x + 10, cy + 4, label, 'lbl-small', 'start') : '');
  },
  /** Катушка контактора (подпись над катушкой). */
  /** Катушка контактора: узкий прямоугольник с отводами до x±9 и подписью сверху. */
  coil(x, y, label) {
    return art.line(x - 9, y, x - 7, y) + art.line(x + 7, y, x + 9, y) +
      `<rect x="${x - 7}" y="${y - 9}" width="14" height="18" class="art-coil"/>` +
      art.text(x, y - 13, label, 'lbl-small');
  },
  /** НО-контакт (горизонтально) с подписью. timed — контакт реле времени по ГОСТ 2.755:
   *  замедление при срабатывании, «парашют» (полукруг вверх) на двойном штоке над контактом. */
  contactH(x, y, label, timed = false) {
    let s = art.line(x - 14, y, x - 4, y) + art.line(x - 4, y, x + 10, y - 9) + art.line(x + 8, y, x + 14, y);
    if (timed) {
      const xs = x + 2, top = y - 16;                      // ось штока и вершина парашюта
      s += art.line(xs - 1.3, y - 4, xs - 1.3, top) + art.line(xs + 1.3, y - 4, xs + 1.3, top) +
        `<path d="M${xs - 5} ${top + 5} a5 5 0 0 1 10 0" class="art-line"/>`;
    }
    return s + art.text(x, y - (timed ? 20 : 13), label, 'lbl-small');
  },
  /** Силовой контакт между двумя клеммниками (x1, x2) с отводами к кружкам на y. */
  contactPair(x1, x2, y, up = true) {
    const d = up ? -1 : 1;
    const y1 = y + d * 30, y2 = y + d * 44;
    return art.line(x1, y, x1, y1) + art.line(x2, y, x2, y1) +
      art.line(x1, y1, x1 + 6, y2) + art.line(x1 + 8, y2 + d * 2, x2, y2 + d * 2) + art.line(x2, y2 + d * 2, x2, y1);
  },
  /** Кнопка по ГОСТ 2.755: шляпка ⊓ на двойном штоке; подвижный контакт наклонный —
   *  у НО (Пуск) уходит вверх, у НЗ (Стоп) ложится вниз на зубчик неподвижного контакта. */
  button(x, y, label, nc = false) {
    const xs = x + 1, capY = y - 14;                       // ось штока и высота шляпки
    let s = art.line(x - 14, y, x - 5, y) + art.line(x + 5, y, x + 14, y);
    if (nc) {
      s += art.line(x + 5, y, x + 5, y + 5) +              // зубчик неподвижного контакта
        art.line(x - 5, y, x + 11, y + 8);                 // подвижный контакт (замкнут)
    } else {
      s += art.line(x - 5, y, x + 8, y - 8);               // подвижный контакт (разомкнут)
    }
    const stemEnd = nc ? y + 3 : y - 4;                    // шток опирается на наклонный контакт
    s += art.line(xs - 1.3, capY, xs - 1.3, stemEnd) + art.line(xs + 1.3, capY, xs + 1.3, stemEnd) +
      art.line(xs - 5, capY, xs + 5, capY) +               // шляпка
      art.line(xs - 5, capY, xs - 5, capY + 3) + art.line(xs + 5, capY, xs + 5, capY + 3) +
      art.text(x, capY - 4, label, 'lbl-small');
    return s;
  },
  /** Круг с буквой (прибор, двигатель). */
  circle(x, y, r, label, cls = 'art-circle') {
    return `<circle cx="${x}" cy="${y}" r="${r}" class="${cls}"/>` +
      art.text(x, y + (r > 14 ? 6 : 4), label, r > 14 ? 'dev-title' : 'lbl-small');
  },
  /** Стрелочный прибор в цепи (маленький кружок с буквой). */
  meter(x, y, letter, id) {
    return `<circle cx="${x}" cy="${y}" r="8" class="art-meter"/>` +
      art.text(x, y + 3.5, letter, 'lbl-tiny') + (id ? art.text(x + 10, y - 6, id, 'lbl-tiny', 'start') : '');
  },
  /** Вольтметр между двумя вертикальными линиями x1, x2 на высоте y. */
  meterAcross(x1, x2, y, id) {
    const cx = (x1 + x2) / 2;
    return art.line(x1, y, cx - 8, y) + art.line(cx + 8, y, x2, y) + art.meter(cx, y, 'V', id);
  },
  dashedBox(x, y, w, h) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="art-dashed-box"/>`;
  },
  /** Датчики напряжения/тока внутри пунктирного блока на трёх линиях xs. */
  sensors(xs, y1, y2) {
    const [a, b, c] = xs;
    let s = art.dashedBox(a - 22, y1, c - a + 44, y2 - y1) + art.text((a + c) / 2, y1 - 6, 'ДН / ДТ', 'lbl-tiny');
    const my = (y1 + y2) / 2;
    for (const x of xs) s += `<rect x="${x - 7}" y="${my + 8}" width="14" height="10" class="art-res"/>`;
    s += `<rect x="${(a + b) / 2 - 7}" y="${my - 20}" width="14" height="10" class="art-res"/>` +
      `<rect x="${(b + c) / 2 - 7}" y="${my - 6}" width="14" height="10" class="art-res"/>`;
    return s;
  },
  /** Концевой выключатель двери (декор). */
  limitSwitch(x, y) {
    return `<rect x="${x}" y="${y}" width="46" height="70" rx="3" class="lsw-body"/>` +
      `<rect x="${x + 6}" y="${y + 8}" width="34" height="28" rx="2" class="lsw-label"/>` +
      `<text x="${x + 23}" y="${y + 26}" class="lbl-tiny" text-anchor="middle">LS</text>` +
      `<rect x="${x + 16}" y="${y + 70}" width="14" height="12" class="lsw-plunger"/>` +
      `<circle cx="${x + 23}" cy="${y + 88}" r="6" class="lsw-roller"/>`;
  },
};
