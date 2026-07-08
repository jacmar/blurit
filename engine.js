/*
 * blurit — motore di ricomposizione multi-frame
 *
 * Gira come Web Worker. Riceve una sequenza di frame RGBA e li ricompone
 * in una singola immagine: le zone localmente più nitide di ogni frame
 * "vincono" la fusione, una maschera di fuoco organica decide dove
 * l'immagine resta nitida, e un campo di rumore seedato introduce
 * l'imprevedibilità controllata (stesso seed → stesso risultato).
 *
 * Pipeline:
 *   1. mappa di nitidezza locale per frame (laplaciano lisciato)
 *   2. fusione pesata: peso = nitidezza^sharpPower * (1 + caos*rumore)
 *      con deriva cromatica opzionale (pesi leggermente diversi per canale)
 *   3. maschera di fuoco radiale, deformata dal rumore (bordo organico)
 *   4. versione morbida (box blur separabile x3 ≈ gaussiana) fusa via maschera
 *   5. echi fantasma: frame traslati riproiettati nelle aree fuori fuoco
 *   6. desaturazione + leggera tinta fredda nelle aree morbide
 */

'use strict';

// ---------- utilità deterministiche ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashLattice(ix, iy, seed) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return ((n >>> 0) / 4294967295) * 2 - 1; // [-1, 1]
}

function smooth(t) { return t * t * (3 - 2 * t); }

// Rumore "value noise" a 2 ottave: campo continuo, organico, deterministico.
function makeNoise(seed, cellSize) {
  const inv1 = 1 / Math.max(2, cellSize);
  const inv2 = 1 / Math.max(2, cellSize / 2.3);
  function octave(x, y, inv, s) {
    const gx = x * inv, gy = y * inv;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = smooth(gx - ix), fy = smooth(gy - iy);
    const a = hashLattice(ix, iy, s), b = hashLattice(ix + 1, iy, s);
    const c = hashLattice(ix, iy + 1, s), d = hashLattice(ix + 1, iy + 1, s);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  }
  return function (x, y) {
    return octave(x, y, inv1, seed) * 0.68 + octave(x, y, inv2, seed ^ 0x9E3779B9) * 0.32;
  };
}

// ---------- filtri ----------

// Box blur separabile a somma scorrevole, O(N) per passata.
// 3 passate approssimano bene una gaussiana.
function boxBlurChannel(src, tmp, W, H, radius) {
  const r = Math.max(1, radius | 0);
  const div = 2 * r + 1;
  // orizzontale: src -> tmp
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = sum / div;
      const xAdd = Math.min(W - 1, x + r + 1);
      const xSub = Math.max(0, x - r);
      sum += src[row + xAdd] - src[row + xSub];
    }
  }
  // verticale: tmp -> src
  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      src[y * W + x] = sum / div;
      const yAdd = Math.min(H - 1, y + r + 1);
      const ySub = Math.max(0, y - r);
      sum += tmp[yAdd * W + x] - tmp[ySub * W + x];
    }
  }
}

function gaussianish(channel, W, H, radius, passes) {
  const tmp = new Float32Array(W * H);
  for (let p = 0; p < (passes || 3); p++) boxBlurChannel(channel, tmp, W, H, radius);
}

// Mappa di nitidezza locale: |laplaciano| della luminanza, lisciato e
// normalizzato rispetto alla media del frame (così frame con esposizioni
// diverse restano confrontabili).
function sharpnessMap(rgba, W, H, smoothRadius) {
  const size = W * H;
  const luma = new Float32Array(size);
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    luma[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  const lap = new Float32Array(size);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      lap[i] = Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - W] - luma[i + W]);
    }
  }
  gaussianish(lap, W, H, smoothRadius, 2);
  let mean = 0;
  for (let i = 0; i < size; i++) mean += lap[i];
  mean = mean / size || 1e-6;
  const norm = 1 / (mean * 3);
  for (let i = 0; i < size; i++) {
    const v = lap[i] * norm;
    lap[i] = v > 2 ? 2 : v;
  }
  return lap;
}

// ---------- pipeline principale ----------

function renderComposite(frames, W, H, params, report) {
  const N = frames.length;
  const size = W * H;
  const minWH = Math.min(W, H);
  const seed = params.seed >>> 0;

  const sharpPower = params.sharpPower;
  const chaos = params.chaos;
  const chroma = params.chroma;
  const noiseCell = minWH * (0.05 + 0.28 * params.noiseScale);

  // --- 1+2: fusione pesata sulla nitidezza, streaming frame per frame ---
  const numR = new Float32Array(size);
  const numG = new Float32Array(size);
  const numB = new Float32Array(size);
  const denR = new Float32Array(size);
  const denG = new Float32Array(size);
  const denB = new Float32Array(size);

  const smoothRadius = Math.max(2, Math.round(minWH / 72));

  for (let f = 0; f < N; f++) {
    report('fusione', f / N);
    const rgba = frames[f];
    // Con un solo frame la mappa di nitidezza è inutile: peso uniforme.
    const sharp = N > 1 ? sharpnessMap(rgba, W, H, smoothRadius) : null;
    const nW = makeNoise(seed + f * 7919, noiseCell);
    const nR = chroma > 0 ? makeNoise(seed + f * 7919 + 101, noiseCell * 0.8) : null;
    const nB = chroma > 0 ? makeNoise(seed + f * 7919 + 202, noiseCell * 0.8) : null;

    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const p = i * 4;
        let w = sharp ? Math.pow(1e-4 + sharp[i], sharpPower) : 1;
        if (chaos > 0) {
          const m = 1 + chaos * 1.3 * nW(x, y);
          w *= m > 0.02 ? m : 0.02;
        }
        let wr = w, wg = w, wb = w;
        if (chroma > 0) {
          const cr = 1 + chroma * 0.7 * nR(x, y);
          const cb = 1 + chroma * 0.7 * nB(x, y);
          wr = w * (cr > 0.05 ? cr : 0.05);
          wb = w * (cb > 0.05 ? cb : 0.05);
        }
        numR[i] += wr * rgba[p];
        numG[i] += wg * rgba[p + 1];
        numB[i] += wb * rgba[p + 2];
        denR[i] += wr; denG[i] += wg; denB[i] += wb;
      }
    }
  }

  const baseR = numR, baseG = numG, baseB = numB; // riuso in place
  for (let i = 0; i < size; i++) {
    baseR[i] /= denR[i];
    baseG[i] /= denG[i];
    baseB[i] /= denB[i];
  }

  // --- 3: maschera di fuoco organica ---
  report('maschera', 0);
  const mask = new Float32Array(size);
  const fx = params.focusX * W;
  const fy = params.focusY * H;
  const R0 = Math.max(8, params.focusSize * 0.55 * minWH);
  const edge = Math.max(6, params.focusEdge * R0 * 1.1);
  const warp = 0.12 + 0.38 * chaos;
  const nMask = makeNoise(seed ^ 0x51ED270B, noiseCell * 1.4);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const dx = x - fx, dy = y - fy;
      let d = Math.sqrt(dx * dx + dy * dy);
      d *= 1 + warp * nMask(x, y);
      // 1 dentro il fuoco, 0 fuori, transizione smoothstep larga `edge`
      let t = (d - (R0 - edge)) / (2 * edge);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      mask[row + x] = 1 - smooth(t);
    }
  }

  // --- 4: versione morbida e fusione via maschera ---
  let outR = baseR, outG = baseG, outB = baseB;
  if (params.softness > 0.01) {
    report('morbidezza', 0);
    const radius = Math.max(1, Math.round(params.softness * minWH / 26));
    const softR = baseR.slice(), softG = baseG.slice(), softB = baseB.slice();
    gaussianish(softR, W, H, radius, 3);
    report('morbidezza', 0.4);
    gaussianish(softG, W, H, radius, 3);
    report('morbidezza', 0.7);
    gaussianish(softB, W, H, radius, 3);
    for (let i = 0; i < size; i++) {
      const m = mask[i];
      softR[i] += (baseR[i] - softR[i]) * m;
      softG[i] += (baseG[i] - softG[i]) * m;
      softB[i] += (baseB[i] - softB[i]) * m;
    }
    outR = softR; outG = softG; outB = softB;
  }

  // --- 5: echi fantasma nelle aree fuori fuoco ---
  if (params.ghost > 0.01) {
    report('fantasmi', 0);
    const rng = mulberry32(seed ^ 0xBADC0FFE);
    const echoes = N > 1 ? [0, N - 1] : [0];
    const alphaBase = params.ghost * (N > 1 ? 0.4 : 0.3);
    for (const f of echoes) {
      const rgba = frames[f];
      const mag = (0.006 + 0.028 * params.ghost) * minWH;
      const ox = Math.round((rng() * 2 - 1) * mag);
      const oy = Math.round((rng() * 2 - 1) * mag);
      for (let y = 0; y < H; y++) {
        const sy = Math.min(H - 1, Math.max(0, y + oy));
        const row = y * W, srow = sy * W;
        for (let x = 0; x < W; x++) {
          const i = row + x;
          const a = alphaBase * (1 - mask[i]);
          if (a <= 0.003) continue;
          const sx = Math.min(W - 1, Math.max(0, x + ox));
          const sp = (srow + sx) * 4;
          outR[i] += (rgba[sp] - outR[i]) * a;
          outG[i] += (rgba[sp + 1] - outG[i]) * a;
          outB[i] += (rgba[sp + 2] - outB[i]) * a;
        }
      }
    }
  }

  // --- 6: desaturazione e tinta fredda nelle aree morbide ---
  const desat = params.desat;
  report('finitura', 0);
  const out = new Uint8ClampedArray(size * 4);
  for (let i = 0, p = 0; i < size; i++, p += 4) {
    let r = outR[i], g = outG[i], b = outB[i];
    if (desat > 0.01) {
      const amount = desat * (1 - mask[i]) * 0.85;
      if (amount > 0.003) {
        const gray = (r + g + b) / 3;
        r += (gray - r) * amount;
        g += (gray - g) * amount;
        b += (gray - b) * amount;
        b *= 1 + amount * 0.12; // leggera deriva fredda
      }
    }
    out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = 255;
  }
  return out;
}

// ---------- protocollo worker ----------

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.type !== 'process') return;
  const { jobId, width, height, params } = msg;
  const frames = msg.frames.map(buf => new Uint8ClampedArray(buf));
  try {
    const report = (stage, frac) =>
      self.postMessage({ type: 'progress', jobId, stage, frac });
    const pixels = renderComposite(frames, width, height, params, report);
    self.postMessage(
      { type: 'result', jobId, width, height, pixels: pixels.buffer },
      [pixels.buffer]
    );
  } catch (err) {
    self.postMessage({ type: 'error', jobId, message: String(err && err.message || err) });
  }
};
