// Характеристики машин агрегата: ДПТ независимого возбуждения, асинхронный
// двигатель по Т-образной схеме замещения (формулы (4.4)–(4.8) методички),
// динамическое торможение АД (4.13)–(4.15).

// ---- комплексные числа {re, im} ----
export const C = (re, im = 0) => ({ re, im });
export const cadd = (a, b) => C(a.re + b.re, a.im + b.im);
export const csub = (a, b) => C(a.re - b.re, a.im - b.im);
export const cmul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
export const cabs = a => Math.hypot(a.re, a.im);
export const carg = a => Math.atan2(a.im, a.re);
export const cscale = (a, k) => C(a.re * k, a.im * k);
export const cexp = (ang) => C(Math.cos(ang), Math.sin(ang));

export const RPM = 2 * Math.PI / 60; // рад/с на об/мин

/**
 * ДПТ НВ. Из паспорта: kΦ_ном = (Uн − Iн·Rя)/ωн; при другом токе возбуждения
 * kΦ ∝ Iв (без насыщения).
 */
export function dcKphi(m, If) {
  const N = m.nominal;
  const wn = N.speed * RPM;
  return (N.voltage - N.current * m.ra) / wn * (If / N.field);
}

/**
 * Асинхронный двигатель по Т-образной схеме замещения при фазном напряжении
 * u (В), частоте f (Гц) и скорости w (об/мин).
 *   P: {r1, x1, r2, x2, x0, kd} — параметры при 50 Гц, Ом; kd — вытеснение тока
 *      в роторе (r2' растёт с частотой тока ротора: r2'(1 + kd·|s|)), для к.з. ротора;
 *   rExt: добавочное сопротивление в фазе статора, Ом;
 *   r2Ext: добавочное сопротивление ротора, приведённое к статору, Ом;
 *   poles: число пар полюсов.
 * Возвращает {s, w0, I1 (фазор, А), I2 (приведённый ток ротора, А), I0, M (Нм),
 * cosPhi, P1 (Вт, на три фазы), E1 (фазор ЭДС), u}.
 * Знак: w0 со знаком направления поля; M > 0 — по направлению поля.
 */
export function imT(P, { u, f, w, rExt = 0, r2Ext = 0, poles }) {
  const dir = Math.sign(f) || 1;
  const fa = Math.abs(f);
  const w0 = dir * fa * 60 / poles;                // синхронная скорость, об/мин
  let s = (w0 - w) / w0;
  if (Math.abs(s) < 1e-6) s = 1e-6;
  const k = fa / 50;                                // реактивные сопротивления ∝ f
  const kd = P.kd || 0;
  const r2 = P.r2 * (1 + kd * Math.min(1, Math.abs(s))) + r2Ext;
  const x2 = P.x2 * k / (1 + 0.5 * kd * Math.min(1, Math.abs(s)));
  const Z2 = C(r2 / s, x2);
  const Z0 = C(0, P.x0 * k);
  const Zp = cdiv(cmul(Z2, Z0), cadd(Z2, Z0));
  const Z1 = C(P.r1 + rExt, P.x1 * k);
  const Z = cadd(Z1, Zp);
  const U = C(u, 0);
  const I1 = cdiv(U, Z);
  const E1 = csub(U, cmul(I1, Z1));
  const I2 = cdiv(E1, Z2);
  const I0 = cdiv(E1, Z0);
  const wsync = Math.abs(w0) * RPM;
  const M = dir * 3 * cabs(I2) ** 2 * r2 / (s * wsync);
  const cosPhi = cabs(I1) > 1e-9 ? I1.re / cabs(I1) : 1;
  const P1 = 3 * u * I1.re;
  return { s, w0, I1, I2, I0, M, cosPhi, P1, E1, u, f };
}

/**
 * АД от ПЧ с векторным управлением (режимы M и ω): преобразователь держит поток и
 * подбирает скольжение, при котором момент равен требуемому. Ищем s ∈ (0; sк]
 * бисекцией по характеристике при частоте f и напряжении u. Возвращает результат imT.
 */
export function imFromTorque(P, { u, f, w, M, rExt = 0, r2Ext = 0, poles }) {
  const dir = Math.sign(M) || 1;
  const fa = Math.abs(f) || 1;
  const w0 = fa * 60 / poles;
  const at = (s) => imT(P, { u, f: fa, w: w0 * (1 - s), rExt, r2Ext, poles });
  // критическое скольжение — максимум момента
  let sk = 0.05, mk = 0;
  for (let s = 0.01; s <= 1; s *= 1.25) { const m = at(s).M; if (m > mk) { mk = m; sk = s; } }
  const target = Math.min(Math.abs(M), mk * 0.98);
  let lo = 1e-5, hi = sk;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (at(mid).M < target) lo = mid; else hi = mid; }
  const r = at((lo + hi) / 2);
  return { ...r, M: dir * r.M, w0: w0 * (w >= 0 ? 1 : -1), f: fa * (w >= 0 ? 1 : -1) };
}

/**
 * Динамическое торможение АД постоянным током в статоре: эквивалентный
 * переменный ток Iэ создаёт ту же МДС; при относительной скорости ν = w/w0
 * (по формулам (4.13)–(4.15)):
 *   I2' = Iэ·x0 / √((r2'/ν)² + (x0 + x2')²),  M = 3·I2'²·r2'/(ν·ω0).
 * Насыщение: x0 уменьшается при Iэ выше тока холостого хода I0.
 * Возвращает {M (тормозной, ≥ 0, по модулю скорости), I2 (приведённый ток ротора), nuK, Mk}.
 */
export function imBrake(P, { ieq, w, r2Ext = 0, poles, i0 }) {
  const w0 = 50 * 60 / poles;                 // база: синхронная скорость при 50 Гц
  const wsync = w0 * RPM;
  const nu = Math.abs(w) / w0;
  const x0 = P.x0 * (i0 && ieq > i0 ? Math.sqrt(i0 / ieq) : 1);
  const r2 = P.r2 + r2Ext;
  const x2 = P.x2;
  const nuK = r2 / (x0 + x2);
  const Mk = 3 * ieq * ieq * x0 * x0 / (2 * wsync * (x0 + x2));
  if (nu < 1e-6) return { M: 0, I2: 0, nuK, Mk };
  const i2 = ieq * x0 / Math.hypot(r2 / nu, x0 + x2);
  const M = 3 * i2 * i2 * r2 / (nu * wsync);
  return { M, I2: i2, nuK, Mk };
}

/** Момент трения и вентиляции агрегата, Нм: сухое трение (основная часть) + малая вентиляционная. */
export function frictionTorque(w, m0 = 2.5, kv = 0.0003) {
  return m0 * Math.tanh(w / 15) + kv * w;
}
