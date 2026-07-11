---
name: blurit
description: Ricompone una sequenza di foto (2-10 scatti simili, es. raffica) in una singola immagine con fuoco selettivo e imprevedibilità controllata dal seed - effetto ispirato alle Live Photo di iPhone ma governabile. Usare quando l'utente vuole fondere/ricomporre più foto, creare effetti di fuoco selettivo, sfocatura artistica, effetti fantasma/pittorici da una raffica, o rigenerare un risultato da un seed noto.
---

# blurit — ricomposizione fotografica da CLI

Fonde una sequenza di scatti in una singola immagine: le zone localmente più
nitide di ogni frame "vincono", un'area di fuoco resta nitida, il resto
diventa morbido/instabile. L'imprevedibilità è governata da un seed:
**stesso seed + stessi parametri = risultato identico al pixel**.

## Preparazione (una tantum)

Il CLI usa `sharp` per leggere/scrivere le immagini:

```bash
cd <root del progetto blurit> && npm install
```

Se `npm install` di sharp fallisce (piattaforma senza binari precompilati),
riferiscilo all'utente: non ci sono alternative incluse.

## Uso

```bash
node cli.js [opzioni] foto1.jpg foto2.jpg ...
```

I frame vanno passati in ordine di scatto quando noto. Formati: tutto ciò
che sharp legge (JPEG, PNG, WebP, TIFF, AVIF; HEIC dipende dalla build).
L'orientamento EXIF viene applicato automaticamente.

| Opzione | Significato | Default |
|---|---|---|
| `--mode` | `pulita` `selettiva` `fantasmatica` `pittorica` `caos` | `selettiva` |
| `--seed <n>` | seed intero riproducibile | casuale |
| `--variants <n>` | n varianti con seed diversi (la prima usa `--seed`) | 1 |
| `--focus <x,y>` | punto di fuoco normalizzato 0–1 (origine in alto a sinistra) | `0.5,0.5` |
| `--max-side <px>` | lato lungo massimo dell'output | 4096 |
| `--out <path>` | file di output (o directory) | `./blurit-<mode>-s<seed>.jpg` |
| `--set k=v` | sovrascrive un parametro del preset, ripetibile | — |
| `--quality` | qualità JPEG 1–100 | 92 |

Su stdout escono solo i percorsi dei file generati (uno per riga); il
progresso va su stderr.

## Modalità e parametri

Le modalità sono preset dei 9 parametri del motore (vedi `presets.js`):

- **pulita** — fusione fedele, casualità minima
- **selettiva** — area a fuoco netta, resto morbido
- **fantasmatica** — echi, desaturazione, instabilità onirica
- **pittorica** — caos alto e deriva cromatica, texture da pennellata
- **caos** — massima imprevedibilità, sempre riproducibile via seed

Parametri regolabili con `--set` (tutti 0–1 salvo indicazione):

- `focusSize` dimensione area a fuoco · `focusEdge` sfumatura del bordo
- `softness` sfocatura fuori fuoco · `chaos` rumore che modula la fusione
- `ghost` echi dei frame traslati · `desat` desaturazione aree morbide
- `sharpPower` (0–3) quanto la nitidezza locale domina la fusione
- `noiseScale` scala della trama del rumore · `chroma` deriva cromatica

## Come tradurre le richieste dell'utente

- "più fantasmatico" → `--set ghost=0.8` (o modalità `fantasmatica`)
- "fuoco sul viso in alto a sinistra" → `--focus 0.3,0.3`
- "area a fuoco più stretta" → `--set focusSize=0.25`
- "più pulito/fedele" → modalità `pulita` o `--set chaos=0.05`
- "fammene vedere un po'" → `--variants 4`, mostra i risultati e i loro seed
- "rifai quello di prima ma più morbido" → stesso `--seed`, cambia solo `--set softness=…`

Riporta SEMPRE all'utente il seed di ogni risultato che gli mostri: è la
chiave per riprodurlo e raffinarlo. Il seed è anche nel nome file
(`blurit-<mode>-s<seed>.jpg`).

## Esempi

```bash
# raffica → immagine fantasmatica riproducibile
node cli.js --mode fantasmatica --seed 4242 raffica/*.jpg

# 4 proposte pittoriche, fuoco decentrato, caos alzato
node cli.js --mode pittorica --variants 4 --focus 0.35,0.6 --set chaos=0.8 a.jpg b.jpg c.jpg

# batch: una ricomposizione per ogni sottocartella di raffiche
for d in raffiche/*/; do node cli.js --mode selettiva --out risultati/ "$d"*.jpg; done
```

## Note

- 2–10 frame (oltre 10 vengono ignorati); funziona anche con 1 solo frame
  (niente fusione, solo fuoco/morbidezza/echi)
- Frame con inquadrature molto diverse producono ghosting pesante: è parte
  dell'estetica, ma avvisa l'utente se i risultati sembrano "sbagliati"
- Il motore è deterministico ma CPU-bound: a 4096px con 10 frame servono
  decine di secondi; per esplorare usa `--max-side 1280`, poi rigenera in HD
  solo il seed scelto
