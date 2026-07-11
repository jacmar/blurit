/* blurit — preset delle modalità, condivisi tra la web app (app.js)
 * e il CLI/skill (cli.js). Ogni modalità è un set completo di parametri
 * del motore; dopo averla scelta, ogni parametro resta regolabile. */

'use strict';

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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MODES };
}
