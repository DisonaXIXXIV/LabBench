// Несинусоидальные токи на входе выпрямителей — для осциллографа и приборов.
//
// Форма тока фазы A задаётся таблицей на один период сети. Таблица нормирована
// так, что её первая гармоника — √2·sin(x) (действующее значение 1, фаза 0),
// поэтому в сигнале она участвует как обычная синусоидальная составляющая
// {rms, ph} — мгновенное значение rms·W(θ + ph), — а сдвиг на ±120° для фаз B, C
// и на 180° для обратного направления через измеритель остаются верными
// (в симметричной системе ток фазы B — ток фазы A, сдвинутый на треть периода).
// kf — отношение полного действующего значения к действующему значению
// первой гармоники (для амперметров и ваттметра: коэффициент мощности
// с учётом искажения = cos φ₁ / kf).
//
// Опорное напряжение: u_A = √2·U·sin θ, u_B = √2·U·sin(θ − 120°), u_C = √2·U·sin(θ + 120°).

const N = 512;
const TAU = 2 * Math.PI;
const UPH = 220;
const W50 = TAU * 50;

/**
 * Нормирует таблицу тока фазы A (T[j] при θ = 2πj/N):
 * {wave, i1 (действующее значение первой гармоники), ph (её фаза, рад), kf}.
 */
function normalize(T) {
  let a = 0, b = 0, sq = 0;
  for (let j = 0; j < N; j++) {
    const th = TAU * j / N;
    a += T[j] * Math.sin(th); b += T[j] * Math.cos(th); sq += T[j] * T[j];
  }
  a *= 2 / N; b *= 2 / N;
  const amp = Math.hypot(a, b);
  if (amp < 1e-12) return null;
  const ph = Math.atan2(b, a);
  const wave = new Float32Array(N);
  const k = Math.SQRT2 / amp;
  for (let j = 0; j < N; j++) {
    // W(x) = T(x − ph)·√2/amp: первая гармоника W — √2·sin(x)
    const x = ((j / N - ph / TAU) % 1 + 1) % 1 * N;
    const j0 = Math.floor(x), fr = x - j0;
    wave[j] = k * (T[j0 % N] * (1 - fr) + T[(j0 + 1) % N] * fr);
  }
  const i1 = amp / Math.SQRT2;
  return { wave, i1, ph, kf: Math.sqrt(sq / N) / i1 };
}

/** Мгновенное значение нормированной формы при угле x (рад). */
export function waveAt(wave, x) {
  const p = ((x / TAU) % 1 + 1) % 1 * N;
  const j0 = Math.floor(p), fr = p - j0;
  return wave[j0 % N] * (1 - fr) + wave[(j0 + 1) % N] * fr;
}

// ---------- вход ПЧ: диодный мост с ёмкостным фильтром ----------

/**
 * Установившийся ток фазы A диодного моста ПЧ при мощности звена P (Вт):
 * сеть 3×380 В с индуктивностью L на фазу (сеть, кабель, входной дроссель),
 * дроссель звена Ldc, ёмкость звена C; нагрузка звена — постоянная мощность.
 * Коммутация диодов считается мгновенной: ток моста переходит на пару фаз
 * с наибольшим линейным напряжением.
 */
function simulateDiodeBridge(P, { L, C, Ldc, R }, udc0) {
  const steps = 2000;
  const dt = 1 / 50 / steps;
  const Leff = 2 * L + Ldc;
  const um = Math.SQRT2 * UPH;
  const UD = 1.6; // падение на двух диодах, В
  let udc = udc0 ?? Math.SQRT2 * 380 * 0.97, il = 0;
  const T = new Float64Array(N);
  let prevMean = 0;
  for (let per = 0; per < 60; per++) {
    let mean = 0;
    const last = per >= 8;
    if (last) T.fill(0);
    for (let s = 0; s < steps; s++) {
      const th = TAU * s / steps;
      const u = [um * Math.sin(th), um * Math.sin(th - TAU / 3), um * Math.sin(th + TAU / 3)];
      let hi = 0, lo = 0;
      for (let k = 1; k < 3; k++) { if (u[k] > u[hi]) hi = k; if (u[k] < u[lo]) lo = k; }
      il += (u[hi] - u[lo] - UD - R * il - udc) / Leff * dt;
      if (il < 0) il = 0;
      udc += (il - P / Math.max(udc, 50)) / C * dt;
      mean += udc / steps;
      if (last) {
        const iA = hi === 0 ? il : lo === 0 ? -il : 0;
        T[Math.floor(s * N / steps)] += iA * N / steps;
      }
    }
    if (last && Math.abs(mean - prevMean) < 0.02) break;
    prevMean = mean;
  }
  return { T, udc: prevMean };
}

const FC_DEFAULT = { L: 0.5e-3, C: 680e-6, Ldc: 0, R: 0.2 };
const fcCache = new Map();
const fcUdc = new Map(); // последнее установившееся напряжение звена — начальное условие для соседней ступени

/**
 * Ток входа ПЧ при мощности P, Вт (> 0): {wave, i1, ph, kf} — i1 и ph уже для
 * этой мощности. Формы считаются по ступеням мощности (через 4 %) и кэшируются;
 * внутри ступени ток масштабируется пропорционально мощности.
 */
export function fcInputWave(P, params) {
  const p = { ...FC_DEFAULT, ...params };
  const step = Math.max(0, Math.round(Math.log(Math.max(P, 5) / 5) / Math.log(1.04)));
  const pk = `${p.L}|${p.C}|${p.Ldc}|${p.R}`;
  const key = `${pk}|${step}`;
  let base = fcCache.get(key);
  if (!base) {
    const Pb = 5 * 1.04 ** step;
    const sim = simulateDiodeBridge(Pb, p, fcUdc.get(pk));
    fcUdc.set(pk, sim.udc);
    base = { ...normalize(sim.T), P: Pb, udc: sim.udc };
    if (fcCache.size > 500) fcCache.clear();
    fcCache.set(key, base);
  }
  return { ...base, i1: base.i1 * P / base.P };
}

// ---------- вход ТП: шестипульсный тиристорный мост ----------

const TP_UD0 = 3 * Math.SQRT2 / Math.PI * 380; // выпрямленное напряжение при α = 0, В
const tpCache = new Map();

/**
 * Ток входа ТП при выпрямленном токе Id (А) и напряжении Ud (В):
 * {wave, i1, ph, kf, alpha, mu}. Сглаженный ток якоря — прямоугольные
 * блоки по 120° со сдвигом на угол управления α и наклонными фронтами
 * на угле коммутации μ (индуктивность сети — X на фазу, Ом):
 *   Ud = Ud0·cos α − 3·X·Id/π,   cos α − cos(α + μ) = 2·X·Id / (√2·Uл).
 */
export function tpInputWave(Id, Ud, X = 0.18) {
  const id = Math.abs(Id);
  const cosA = Math.max(-0.99, Math.min(1, (Math.abs(Ud) + 3 * X * id / Math.PI) / TP_UD0));
  const alpha = Math.acos(cosA);
  const dc = 2 * X * id / (Math.SQRT2 * 380);
  const mu = Math.max(0, Math.acos(Math.max(-1, cosA - dc)) - alpha);
  const key = `${Math.round(alpha * 720)}|${Math.round(mu * 2880)}`;
  let base = tpCache.get(key);
  if (!base) {
    const a = Math.round(alpha * 720) / 720, m = Math.round(mu * 2880) / 2880;
    const T = new Float64Array(N);
    // ток фазы A (в долях Id): «+» блок — тиристор анодной группы фазы A,
    // естественная коммутация на θ = 30°, «−» блок — на θ = 210°
    const rise = (x) => (m < 1e-6 ? (x >= 0 ? 1 : 0) : x <= 0 ? 0 : x >= m ? 1 : (Math.cos(a) - Math.cos(a + x)) / (Math.cos(a) - Math.cos(a + m)));
    const block = (x) => rise(x) - rise(x - TAU / 3); // x — угол от начала коммутации на эту фазу
    const wrap = (x) => ((x % TAU) + TAU) % TAU;
    for (let j = 0; j < N; j++) {
      const th = TAU * j / N;
      T[j] = block(wrap(th - Math.PI / 6 - a)) - block(wrap(th - 7 * Math.PI / 6 - a));
    }
    base = normalize(T);
    if (tpCache.size > 2000) tpCache.clear();
    tpCache.set(key, base);
  }
  return { ...base, i1: base.i1 * id, alpha, mu };
}
