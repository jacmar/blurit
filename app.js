/* blurit — interfaccia: gestione sequenza, anteprima con punto di fuoco,
 * preset delle modalità, dialogo con il motore (engine.js in Web Worker). */

'use strict';

// ---------- costanti ----------

const PREVIEW_MAX = 1280;   // lato lungo dell'anteprima
const EXPORT_MAX = 4096;    // lato lungo dell'export HD
const MAX_FRAMES = 10;

const MODES = {
    pulita: {
        label: 'Pulita',
        params: { focusSize: 0.55, focusEdge: 0.45, softness: 0.15, chaos: 0.10, ghost: 0.05, desat: 0, sharpPower: 2.2, noiseScale: 0.35, chroma: 0 },
    },
    selettiva: {
        label: 'Selettiva',
        params: { focusSize: 0.42, focusEdge: 0.5, softness: 0.55, chaos: 0.2, ghost: 0.1, desat: 0.1, sharpPower: 1.5, noiseScale: 0.4, chroma: 0 },
    },
    fantasmatica: {
        label: 'Fantasmatica',
        params: { focusSize: 0.45, focusEdge: 0.65, softness: 0.45, chaos: 0.35, ghost: 0.7, desat: 0.45, sharpPower: 1.0, noiseScale: 0.45, chroma: 0.1 },
    },
    pittorica: {
        label: 'Pittorica',
        params: { focusSize: 0.5, focusEdge: 0.6, softness: 0.4, chaos: 0.65, ghost: 0.2, desat: 0.05, sharpPower: 1.2, noiseScale: 0.7, chroma: 0.55 },
    },
    caos: {
        label: 'Caos controllato',
        params: { focusSize: 0.45, focusEdge: 0.55, softness: 0.5, chaos: 0.9, ghost: 0.4, desat: 0.2, sharpPower: 1.0, noiseScale: 0.55, chroma: 0.3 },
    },
};

const PARAM_IDS = ['focusSize', 'focusEdge', 'softness', 'chaos', 'ghost', 'desat', 'sharpPower', 'noiseScale', 'chroma'];

// ---------- stato ----------

const state = {
    files: [],
    bitmaps: [],            // ImageBitmap alla risoluzione originale
    preview: null,          // { frames: ImageData[], width, height }
    focusX: 0.5,
    focusY: 0.5,
    mode: 'selettiva',
};

// ---------- elementi ----------

const $ = id => document.getElementById(id);
const fileInput = $('fileInput');
const dropZone = $('dropZone');
const thumbs = $('thumbs');
const composeCard = $('composeCard');
const resultsCard = $('resultsCard');
const previewCanvas = $('previewCanvas');
const previewCtx = previewCanvas.getContext('2d');
const modesBox = $('modes');
const seedInput = $('seedInput');
const progressBox = $('progressBox');
const progressBar = $('progressBar');
const progressLabel = $('progressLabel');
const generateButton = $('generateButton');
const variantsButton = $('variantsButton');
const results = $('results');

// ---------- worker ----------

const worker = new Worker('engine.js');
let jobCounter = 0;
const jobs = new Map(); // jobId -> { resolve, reject, onProgress }

worker.onmessage = e => {
    const msg = e.data;
    const job = jobs.get(msg.jobId);
    if (!job) return;
    if (msg.type === 'progress') {
        job.onProgress && job.onProgress(msg.stage, msg.frac);
    } else if (msg.type === 'result') {
        jobs.delete(msg.jobId);
        job.resolve(new ImageData(new Uint8ClampedArray(msg.pixels), msg.width, msg.height));
    } else if (msg.type === 'error') {
        jobs.delete(msg.jobId);
        job.reject(new Error(msg.message));
    }
};

function runJob(frames, width, height, params, onProgress) {
    return new Promise((resolve, reject) => {
        const jobId = ++jobCounter;
        jobs.set(jobId, { resolve, reject, onProgress });
        // copia i buffer: i frame master restano riutilizzabili per i job successivi
        const buffers = frames.map(f => f.data.buffer.slice(0));
        worker.postMessage({ type: 'process', jobId, width, height, frames: buffers, params }, buffers);
    });
}

// ---------- parametri e modalità ----------

function setParams(p) {
    for (const id of PARAM_IDS) {
        if (p[id] === undefined) continue;
        $('p-' + id).value = p[id];
        $('v-' + id).textContent = Number(p[id]).toFixed(2);
    }
}

function getParams() {
    const p = {};
    for (const id of PARAM_IDS) p[id] = parseFloat($('p-' + id).value);
    p.focusX = state.focusX;
    p.focusY = state.focusY;
    p.seed = currentSeed();
    return p;
}

function currentSeed() {
    let s = parseInt(seedInput.value, 10);
    if (!Number.isFinite(s) || s < 1) {
        s = newSeed();
        seedInput.value = s;
    }
    return s;
}

function newSeed() { return 1 + Math.floor(Math.random() * 999999998); }

function selectMode(name) {
    state.mode = name;
    setParams(MODES[name].params);
    for (const chip of modesBox.children) {
        chip.classList.toggle('active', chip.dataset.mode === name);
    }
    drawPreview();
}

for (const [name, def] of Object.entries(MODES)) {
    const chip = document.createElement('button');
    chip.className = 'mode-chip';
    chip.dataset.mode = name;
    chip.textContent = def.label;
    chip.addEventListener('click', () => selectMode(name));
    modesBox.appendChild(chip);
}

for (const id of PARAM_IDS) {
    $('p-' + id).addEventListener('input', function () {
        $('v-' + id).textContent = Number(this.value).toFixed(2);
        state.mode = 'personale';
        for (const chip of modesBox.children) chip.classList.remove('active');
        if (id === 'focusSize' || id === 'focusEdge') drawPreview();
    });
}

$('diceButton').addEventListener('click', () => { seedInput.value = newSeed(); });

// ---------- selezione sequenza ----------

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', e => {
    if (e.target.files.length) loadFiles(e.target.files);
});

async function loadFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/')).slice(0, MAX_FRAMES);
    if (!files.length) return;
    state.files = files;

    thumbs.innerHTML = '';
    for (const bmp of state.bitmaps) bmp.close();

    try {
        state.bitmaps = await Promise.all(files.map(f => createImageBitmap(f)));
    } catch (err) {
        alert('Impossibile leggere una delle immagini: ' + err.message);
        return;
    }

    files.forEach((file, i) => {
        const div = document.createElement('div');
        div.className = 'thumb';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        img.alt = file.name;
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = i + 1;
        div.append(img, n);
        thumbs.appendChild(div);
    });

    state.preview = rasterize(state.bitmaps, PREVIEW_MAX);
    state.focusX = 0.5;
    state.focusY = 0.5;

    composeCard.classList.remove('hidden');
    selectMode(state.mode in MODES ? state.mode : 'selettiva');
    if (!seedInput.value) seedInput.value = newSeed();
    drawPreview();
    composeCard.scrollIntoView({ behavior: 'smooth' });
}

// Rasterizza tutti i frame alla stessa dimensione (dal primo frame),
// con riempimento tipo "cover" per tollerare piccole differenze di formato.
function rasterize(bitmaps, maxSide) {
    const first = bitmaps[0];
    let W = first.width, H = first.height;
    if (Math.max(W, H) > maxSide) {
        const k = maxSide / Math.max(W, H);
        W = Math.round(W * k);
        H = Math.round(H * k);
    }
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const frames = bitmaps.map(bmp => {
        const k = Math.max(W / bmp.width, H / bmp.height);
        const dw = bmp.width * k, dh = bmp.height * k;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
        return ctx.getImageData(0, 0, W, H);
    });
    return { frames, width: W, height: H };
}

// ---------- anteprima con punto di fuoco ----------

let previewBg = null; // canvas con il primo frame già disegnato

function drawPreview() {
    if (!state.preview) return;
    const { width: W, height: H, frames } = state.preview;
    if (!previewBg || previewBg.width !== W || previewBg.height !== H || previewBg._src !== frames[0]) {
        previewBg = document.createElement('canvas');
        previewBg.width = W; previewBg.height = H;
        previewBg.getContext('2d').putImageData(frames[0], 0, 0);
        previewBg._src = frames[0];
    }
    previewCanvas.width = W;
    previewCanvas.height = H;
    previewCtx.drawImage(previewBg, 0, 0);

    // marcatore del fuoco: cerchio esterno (raggio come nel motore) + croce
    const minWH = Math.min(W, H);
    const R = Math.max(8, parseFloat($('p-focusSize').value) * 0.55 * minWH);
    const edge = Math.max(6, parseFloat($('p-focusEdge').value) * R * 1.1);
    const cx = state.focusX * W, cy = state.focusY * H;

    previewCtx.save();
    previewCtx.strokeStyle = 'rgba(255,255,255,0.9)';
    previewCtx.lineWidth = Math.max(1.5, minWH / 400);
    previewCtx.setLineDash([8, 7]);
    previewCtx.beginPath();
    previewCtx.arc(cx, cy, R, 0, Math.PI * 2);
    previewCtx.stroke();
    previewCtx.setLineDash([3, 6]);
    previewCtx.strokeStyle = 'rgba(232,84,47,0.85)';
    previewCtx.beginPath();
    previewCtx.arc(cx, cy, R + edge, 0, Math.PI * 2);
    previewCtx.stroke();
    previewCtx.setLineDash([]);
    previewCtx.strokeStyle = 'rgba(255,255,255,0.95)';
    previewCtx.beginPath();
    previewCtx.moveTo(cx - 12, cy); previewCtx.lineTo(cx + 12, cy);
    previewCtx.moveTo(cx, cy - 12); previewCtx.lineTo(cx, cy + 12);
    previewCtx.stroke();
    previewCtx.restore();
}

function pointerToFocus(e) {
    const rect = previewCanvas.getBoundingClientRect();
    state.focusX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    state.focusY = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    drawPreview();
}

let dragging = false;
previewCanvas.addEventListener('pointerdown', e => {
    dragging = true;
    previewCanvas.setPointerCapture(e.pointerId);
    pointerToFocus(e);
});
previewCanvas.addEventListener('pointermove', e => { if (dragging) pointerToFocus(e); });
previewCanvas.addEventListener('pointerup', () => { dragging = false; });

// ---------- generazione ----------

const STAGE_LABELS = {
    fusione: 'Fusione dei frame',
    maschera: 'Costruzione della maschera di fuoco',
    morbidezza: 'Aree morbide',
    fantasmi: 'Echi fantasma',
    finitura: 'Finitura',
};

function setBusy(busy) {
    generateButton.disabled = busy;
    variantsButton.disabled = busy;
    progressBox.classList.toggle('hidden', !busy);
}

function showProgress(prefix, stage, frac) {
    const stages = Object.keys(STAGE_LABELS);
    const idx = Math.max(0, stages.indexOf(stage));
    const pct = ((idx + frac) / stages.length) * 100;
    progressBar.style.width = pct.toFixed(0) + '%';
    progressLabel.textContent = prefix + (STAGE_LABELS[stage] || stage) + '…';
}

async function generate(count) {
    if (!state.preview) return;
    setBusy(true);
    const baseParams = getParams();
    try {
        for (let k = 0; k < count; k++) {
            const params = Object.assign({}, baseParams, {
                seed: count > 1 ? (k === 0 ? baseParams.seed : newSeed()) : baseParams.seed,
            });
            const prefix = count > 1 ? `Variante ${k + 1}/${count} · ` : '';
            const imageData = await runJob(
                state.preview.frames, state.preview.width, state.preview.height, params,
                (stage, frac) => showProgress(prefix, stage, frac)
            );
            addResult(imageData, params);
        }
    } catch (err) {
        alert('Errore durante l\'elaborazione: ' + err.message);
    } finally {
        setBusy(false);
    }
}

generateButton.addEventListener('click', () => generate(1));
variantsButton.addEventListener('click', () => generate(4));

$('resetButton').addEventListener('click', () => {
    composeCard.classList.add('hidden');
    resultsCard.classList.add('hidden');
    results.innerHTML = '';
    thumbs.innerHTML = '';
    for (const bmp of state.bitmaps) bmp.close();
    state.files = [];
    state.bitmaps = [];
    state.preview = null;
    previewBg = null;
    fileInput.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------- risultati ----------

function fileBaseName() {
    const name = state.files[0] ? state.files[0].name : 'blurit';
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
}

function resultName(params, hd) {
    return `${fileBaseName()}-${state.mode}-s${params.seed}${hd ? '-hd' : ''}.jpg`;
}

function addResult(imageData, params) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);

    const box = document.createElement('div');
    box.className = 'result';

    const img = document.createElement('img');
    canvas.toBlob(blob => { img.src = URL.createObjectURL(blob); }, 'image/jpeg', 0.92);
    img.alt = 'Risultato';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${MODES[state.mode] ? MODES[state.mode].label : 'Personale'} · seed ${params.seed}`;

    const row = document.createElement('div');
    row.className = 'row';

    const save = document.createElement('button');
    save.className = 'save';
    save.textContent = 'Salva';
    save.addEventListener('click', () => {
        canvas.toBlob(blob => downloadBlob(blob, resultName(params, false)), 'image/jpeg', 0.92);
    });

    const hd = document.createElement('button');
    hd.className = 'hd';
    hd.textContent = 'HD';
    hd.title = 'Rielabora alla risoluzione originale con lo stesso seed';
    hd.addEventListener('click', () => exportHD(params, hd));

    const reuse = document.createElement('button');
    reuse.className = 'reuse';
    reuse.textContent = 'Riusa seed';
    reuse.title = 'Riporta questo seed e questi parametri nei controlli';
    reuse.addEventListener('click', () => {
        seedInput.value = params.seed;
        setParams(params);
        state.focusX = params.focusX;
        state.focusY = params.focusY;
        drawPreview();
        composeCard.scrollIntoView({ behavior: 'smooth' });
    });

    row.append(save, hd, reuse);
    box.append(img, meta, row);
    results.prepend(box);
    resultsCard.classList.remove('hidden');
}

async function exportHD(params, button) {
    if (!state.bitmaps.length) return;
    const original = button.textContent;
    button.disabled = true;
    setBusy(true);
    try {
        const full = rasterize(state.bitmaps, EXPORT_MAX);
        const imageData = await runJob(
            full.frames, full.width, full.height, params,
            (stage, frac) => showProgress('Export HD · ', stage, frac)
        );
        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        canvas.getContext('2d').putImageData(imageData, 0, 0);
        canvas.toBlob(blob => downloadBlob(blob, resultName(params, true)), 'image/jpeg', 0.95);
    } catch (err) {
        alert('Errore durante l\'export HD: ' + err.message);
    } finally {
        button.disabled = false;
        button.textContent = original;
        setBusy(false);
    }
}

function downloadBlob(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 30000);
}

// ---------- avvio ----------

seedInput.value = newSeed();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.log('Service worker non registrato:', err);
        });
    });
}
