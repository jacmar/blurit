#!/usr/bin/env node
/*
 * blurit CLI — ricomposizione multi-frame da riga di comando.
 * Stesso motore della web app (engine.js), decodifica/codifica via sharp.
 *
 * Uso:
 *   node cli.js [opzioni] foto1.jpg foto2.jpg ...
 *
 * Opzioni:
 *   --mode <nome>         pulita | selettiva | fantasmatica | pittorica | caos   (default: selettiva)
 *   --seed <n>            seed intero; lo stesso seed rigenera lo stesso risultato (default: casuale)
 *   --variants <n>        genera n varianti con seed diversi (default: 1)
 *   --focus <x,y>         punto di fuoco normalizzato 0-1 (default: 0.5,0.5)
 *   --max-side <px>       lato lungo massimo dell'output (default: 4096)
 *   --out <path>          file di output, o directory se termina con /  (default: ./blurit-<mode>-s<seed>.jpg)
 *   --set chiave=valore   sovrascrive un parametro del preset; ripetibile.
 *                         chiavi: focusSize focusEdge softness chaos ghost desat sharpPower noiseScale chroma
 *   --quality <1-100>     qualità JPEG (default: 92)
 *
 * Esempi:
 *   node cli.js --mode fantasmatica --seed 4242 raffica/*.jpg
 *   node cli.js --mode pittorica --variants 4 --focus 0.3,0.6 --set chaos=0.8 a.jpg b.jpg c.jpg
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { renderComposite } = require('./engine.js');
const { MODES } = require('./presets.js');

function fail(msg) {
  process.stderr.write('errore: ' + msg + '\n');
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    mode: 'selettiva', seed: null, variants: 1,
    focus: [0.5, 0.5], maxSide: 4096, out: null, quality: 92,
    set: {}, files: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`manca il valore per ${a}`);
      return argv[++i];
    };
    if (a === '--mode') opts.mode = next();
    else if (a === '--seed') opts.seed = parseInt(next(), 10);
    else if (a === '--variants') opts.variants = Math.max(1, parseInt(next(), 10) || 1);
    else if (a === '--focus') {
      const [x, y] = next().split(',').map(Number);
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) fail('--focus richiede due numeri 0-1 separati da virgola, es. 0.5,0.4');
      opts.focus = [x, y];
    }
    else if (a === '--max-side') opts.maxSide = Math.max(256, parseInt(next(), 10) || 4096);
    else if (a === '--out') opts.out = next();
    else if (a === '--quality') opts.quality = Math.min(100, Math.max(1, parseInt(next(), 10) || 92));
    else if (a === '--set') {
      const kv = next();
      const eq = kv.indexOf('=');
      if (eq < 1) fail('--set richiede chiave=valore');
      opts.set[kv.slice(0, eq)] = parseFloat(kv.slice(eq + 1));
    }
    else if (a === '--help' || a === '-h') {
      process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\s?/, '') + '\n');
      process.exit(0);
    }
    else if (a.startsWith('--')) fail(`opzione sconosciuta: ${a}`);
    else opts.files.push(a);
  }
  return opts;
}

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    fail('manca il modulo "sharp": esegui `npm install` nella directory del progetto');
  }

  const opts = parseArgs(process.argv.slice(2));
  if (!opts.files.length) fail('nessuna immagine indicata (usa --help per la sintassi)');
  if (!MODES[opts.mode]) fail(`modalità sconosciuta "${opts.mode}" (disponibili: ${Object.keys(MODES).join(', ')})`);
  for (const f of opts.files) if (!fs.existsSync(f)) fail(`file non trovato: ${f}`);
  if (opts.files.length > 10) {
    process.stderr.write(`nota: ${opts.files.length} immagini, uso le prime 10\n`);
    opts.files = opts.files.slice(0, 10);
  }

  const params = Object.assign({}, MODES[opts.mode].params);
  for (const [k, v] of Object.entries(opts.set)) {
    if (!(k in params)) fail(`parametro sconosciuto in --set: ${k} (disponibili: ${Object.keys(params).join(', ')})`);
    if (!Number.isFinite(v)) fail(`valore non numerico per --set ${k}`);
    params[k] = v;
  }
  params.focusX = opts.focus[0];
  params.focusY = opts.focus[1];

  // dimensioni comuni dal primo frame (riempimento cover per gli altri)
  const meta0 = await sharp(opts.files[0]).rotate().metadata();
  let W = meta0.width, H = meta0.height;
  // .rotate() applica l'orientamento EXIF: le dimensioni si scambiano per orientamenti 5-8
  if (meta0.orientation >= 5) { const t = W; W = H; H = t; }
  if (Math.max(W, H) > opts.maxSide) {
    const k = opts.maxSide / Math.max(W, H);
    W = Math.round(W * k); H = Math.round(H * k);
  }

  process.stderr.write(`blurit · ${opts.files.length} frame · ${W}x${H} · modalità ${opts.mode}\n`);

  const frames = [];
  for (let i = 0; i < opts.files.length; i++) {
    process.stderr.write(`  decodifica ${i + 1}/${opts.files.length}: ${path.basename(opts.files[i])}\n`);
    const { data } = await sharp(opts.files[i])
      .rotate()
      .resize(W, H, { fit: 'cover' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    frames.push(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length));
  }

  const baseSeed = Number.isFinite(opts.seed) && opts.seed > 0
    ? opts.seed
    : 1 + Math.floor(Math.random() * 999999998);

  const written = [];
  for (let v = 0; v < opts.variants; v++) {
    const seed = v === 0 ? baseSeed : 1 + Math.floor(Math.random() * 999999998);
    const p = Object.assign({}, params, { seed });
    let lastStage = '';
    const pixels = renderComposite(frames, W, H, p, stage => {
      if (stage !== lastStage) { process.stderr.write(`  [seed ${seed}] ${stage}…\n`); lastStage = stage; }
    });

    let outPath;
    if (opts.out && opts.variants === 1) {
      outPath = opts.out.endsWith('/') || (fs.existsSync(opts.out) && fs.statSync(opts.out).isDirectory())
        ? path.join(opts.out, `blurit-${opts.mode}-s${seed}.jpg`)
        : opts.out;
    } else {
      const dir = opts.out || '.';
      outPath = path.join(dir, `blurit-${opts.mode}-s${seed}.jpg`);
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    await sharp(Buffer.from(pixels.buffer), { raw: { width: W, height: H, channels: 4 } })
      .jpeg({ quality: opts.quality })
      .toFile(outPath);
    written.push(outPath);
    process.stderr.write(`  scritto ${outPath}\n`);
  }

  // su stdout solo i percorsi dei file generati, uno per riga (facile da leggere per script)
  process.stdout.write(written.join('\n') + '\n');
}

main().catch(e => fail(e.message));
