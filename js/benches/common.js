// Вспомогательные функции для описания стендов.
//
// Клеммник (node) — один зажим с шиной и двумя свободными пружинными
// зажимами (clamp 0 — верхний, clamp 1 — нижний). Провод подключается к
// конкретному свободному зажиму; в один зажим входит один провод.

/** Ряд клеммников с одинаковым шагом. */
export function row(prefix, labels, x0, y, dx = 25, extra = {}) {
  return labels.map((label, i) => ({
    id: `${prefix}.${label}`,
    label,
    x: x0 + i * dx,
    y,
    ...extra,
  }));
}

/** Пара клеммников с одной подписью (например «В+ В+»), объединённых шиной. */
export function pair(prefix, label, x0, y, dx = 25, extra = {}) {
  const a = { id: `${prefix}.${label}.1`, label, x: x0, y, ...extra };
  const b = { id: `${prefix}.${label}.2`, label, x: x0 + dx, y, ...extra };
  return { nodes: [a, b], bus: [a.id, b.id] };
}

/** Несколько пар подряд. Возвращает nodes и buses. */
export function pairs(prefix, labels, x0, y, dx = 25, gap = 50, extra = {}) {
  const nodes = [], buses = [];
  labels.forEach((l, i) => {
    const p = pair(prefix, l, x0 + i * gap, y, dx, extra);
    nodes.push(...p.nodes);
    buses.push(p.bus);
  });
  return { nodes, buses };
}

// ---------- SVG-графика наборного поля (строки SVG) ----------

export const art = {
  text(x, y, s, cls = 'lbl', anchor = 'middle') {
    return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}">${s}</text>`;
  },
  box(x, y, w, h, title, sub = '') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="dev-box"/>` +
      `<text x="${x + w / 2}" y="${y + h / 2 + (sub ? -2 : 6)}" class="dev-title" text-anchor="middle">${title}</text>` +
      (sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 16}" class="dev-sub" text-anchor="middle">${sub}</text>` : '');
  },
  line(x1, y1, x2, y2, cls = 'art-line') {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`;
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
  /** Катушка контактора. */
  coil(x, y, label) {
    return `<rect x="${x - 9}" y="${y - 14}" width="18" height="28" class="art-coil"/>` +
      art.text(x + 14, y + 4, label, 'lbl-small', 'start');
  },
  /** НО-контакт (горизонтально) с подписью. */
  contactH(x, y, label, timed = false) {
    return art.line(x - 14, y, x - 4, y) + art.line(x - 4, y, x + 10, y - 9) + art.line(x + 8, y, x + 14, y) +
      (timed ? `<path d="M${x} ${y + 4} a5 5 0 0 0 10 0" class="art-line"/>` : '') +
      art.text(x, y - 13, label, 'lbl-small');
  },
  /** Кнопка (нормально разомкнутая — Пуск, замкнутая — Стоп). */
  button(x, y, label, nc = false) {
    return art.line(x - 14, y, x - 5, y) + art.line(x + 5, y, x + 14, y) +
      (nc ? art.line(x - 6, y + 3, x + 8, y - 6) : art.line(x - 6, y - 3, x + 8, y - 12)) +
      art.line(x + 1, y - 8, x + 1, y - 16) + art.line(x - 4, y - 16, x + 6, y - 16) +
      art.text(x, y - 20, label, 'lbl-small');
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
  /** Клеммники ваттметра/датчиков — проходные шины между рядами. */
  passLines(xs, y1, y2) {
    return xs.map(x => art.line(x, y1, x, y2, 'art-line art-dashed')).join('');
  },
  dashedBox(x, y, w, h) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="art-dashed-box"/>`;
  },
};
