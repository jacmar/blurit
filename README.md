# blurit

**Ricomposizione fotografica selettiva, semi-casuale, governabile.**

blurit prende una sequenza di foto (2–10 scatti simili, per esempio una raffica)
e le ricompone in una singola immagine finale, ispirandosi all'effetto
"semi-imprevedibile" che a volte emerge dalle Live Photo di iPhone: alcuni
elementi restano nitidi, altri diventano morbidi o instabili, e ogni tanto
saltano fuori risultati interessanti.

A differenza del processo automatico del telefono, qui l'imprevedibilità è
**controllabile**: ogni risultato è governato da un *seed* — lo stesso seed
rigenera esattamente la stessa immagine — e da parametri regolabili. E si
lavora su foto ad alta definizione, con pieno controllo su colori e qualità.

Non è un filtro blur: è un motore di ricomposizione.

## Come funziona il motore

Il motore (`engine.js`, un Web Worker) elabora la sequenza così:

1. **Mappa di nitidezza locale** per ogni frame (laplaciano della luminanza,
   lisciato): dice quali zone di quale frame sono più a fuoco.
2. **Fusione pesata**: ogni pixel del risultato è la media dei frame pesata
   sulla nitidezza locale — le zone più nitide "vincono". Un campo di rumore
   deterministico (seedato) modula i pesi: è il parametro **Caos**, l'anima
   semi-casuale del processo. La **Deriva cromatica** applica pesi leggermente
   diversi per canale colore, con effetto pittorico.
3. **Maschera di fuoco organica**: un'area radiale attorno al punto di fuoco
   scelto dall'utente, con il bordo deformato dal rumore (non un cerchio
   perfetto, un contorno vivo).
4. **Morbidezza**: fuori dalla maschera l'immagine sfuma verso una versione
   sfocata (blur gaussiano approssimato, separabile, O(N)).
5. **Echi fantasma**: frame traslati riproiettati a bassa opacità nelle aree
   fuori fuoco — l'effetto "ricomposizione instabile" delle Live Photo.
6. **Finitura**: desaturazione e leggera tinta fredda nelle aree morbide.

Tutto gira **in locale nel browser**, niente upload: le foto non lasciano mai
il dispositivo.

## Modalità

| Modalità | Carattere |
|---|---|
| **Pulita** | fusione fedele, nitidezza dominante, casualità minima |
| **Selettiva** | area a fuoco netta, resto morbido |
| **Fantasmatica** | echi, desaturazione, instabilità onirica |
| **Pittorica** | caos alto e deriva cromatica, texture da pennellata |
| **Caos controllato** | massima imprevedibilità, sempre riproducibile via seed |

Ogni modalità è un preset dei parametri: dopo averla scelta si può regolare
tutto a mano. «Genera 4 varianti» esplora seed diversi; «Riusa seed» riporta
nei controlli i parametri esatti di un risultato; «HD» rielabora alla
risoluzione originale (fino a 4096px di lato) con lo stesso seed.

## Struttura

```
index.html    interfaccia (markup + stile)
app.js        logica UI: sequenza, punto di fuoco, preset, dialogo col worker
engine.js     motore di ricomposizione (Web Worker)
sw.js         service worker (PWA offline)
manifest.json manifest PWA
icons/        icone
```

Nessuna dipendenza esterna: basta un hosting statico (funziona anche su
GitHub Pages, i percorsi sono relativi).

## Roadmap

- [ ] **Allineamento automatico dei frame** (registrazione globale) prima
      della fusione, per raffiche a mano libera più spinte
- [ ] Maschera di fuoco disegnabile a mano (pennello) oltre a quella radiale
- [ ] Import diretto di video brevi / Live Photo con estrazione frame
- [ ] Cronologia dei seed preferiti
- [ ] **Fase 2 — integrazione**: valutare un plugin o un passaggio di export
      verso Affinity / Canva, una volta consolidato il prototipo standalone
