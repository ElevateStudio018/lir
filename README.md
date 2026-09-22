# LIR Bygg & Anläggning — webbplats

Premium, scroll-regisserad webbplats för ett svenskt bygg- och anläggningsföretag.

```bash
npm install
npm run dev      # utveckling
npm run build    # produktion → dist/
npm run preview  # förhandsgranska bygget
```

## Struktur

| Fil | Innehåll |
| --- | --- |
| `index.html` | Startsidan — elva kapitel från hero till footer |
| `projekt.html` | Projektsida (`?p=<slug>`), fylls från `src/data/projects.js` |
| `src/three/process3d.js` | Den scrollstyrda 3D-byggprocessen (Three.js) inkl. ritningsövergången |
| `src/three/material.js` | Betong-makro → fasad → byggnad (en filtrerad fragment-shader) |
| `src/three/timeline.js` | Gemensam tidslinje för 3D-scen och UI |
| `src/lib/*` | Smooth scroll (Lenis + GSAP), reveals, header, flikar, övergångar, modaler |
| `src/styles/*` | Designsystem (tokens, typografi, knappar) och kapitelstilar |

## Designsystem

- **Typografi:** Geist Variable + Geist Mono (självhostade via Fontsource).
- **Färger:** `#F4F3EF` off-white · `#0B1113` nästan svart · `#161B1D` · `#A6AA9E` sten · accent `#C8663A` (bränd koppar, används sparsamt).
- **Grid:** 12 kolumner, max 1560 px, sidomarginal `clamp(20px, 5.4vw, 88px)`.
- **Rörelse:** `cubic-bezier(0.22, 1, 0.36, 1)`; UI 0.5–1.1 s; scrollscener styrs av scroll-progress och reverserar exakt.

## Prestanda & tillgänglighet

- 3D-scenen och betongshadern laddas först när läsaren närmar sig sektionen (dynamisk import), och renderar bara när de syns.
- Adaptiv upplösning (DPR) i 3D-scenen; förenklad scen på mobil (inga skuggor, färre träd/personer).
- Fallback till bildsekvens om WebGL saknas. `prefers-reduced-motion` stänger av smooth scroll, parallax och dämpning.
- Semantisk HTML, tangentbordsnavigering (flikar med piltangenter, fokusfälla i dialoger), alt-texter.

## Bilder

Alla fotografier kommer från [Pexels](https://www.pexels.com) och används under
[Pexels-licensen](https://www.pexels.com/license/) (fri kommersiell användning, ingen attribution krävs).
Bilderna hämtas responsivt från Pexels CDN (`srcset` genereras av ett litet Vite-plugin i `vite.config.js`)
och färggraderas enhetligt i CSS (`.ph`) så att de upplevs som en och samma kampanj.
Foto-ID:n finns samlade i `src/data/images.js`.

Byggnaden i processen och betongfasaden är procedurellt genererade — inga AI-genererade bilder används.
