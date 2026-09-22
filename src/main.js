import '@fontsource-variable/geist';
import '@fontsource/geist-mono/400.css';
import './styles/base.css';
import './styles/sections.css';

import { initSmoothScroll, ScrollTrigger } from './lib/scroll.js';
import { heroIntro, scrollMotion, counters } from './lib/motion.js';
import { initHeader } from './lib/header.js';
import { initMenu, initDrawer, initFilm, initCursor } from './lib/ui.js';
import { initCaps } from './lib/caps.js';
import { initProcess } from './lib/process.js';
import { initMaterial } from './lib/material.js';
import { initProjectTransitions } from './lib/transition.js';

document.documentElement.classList.add('js');
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

initSmoothScroll();
heroIntro();
scrollMotion();
counters();
initHeader();
initMenu();
initDrawer();
initFilm();
initCursor();
initCaps();
initProcess();
initMaterial();
initProjectTransitions();

// Fonts and late images shift layout — keep every trigger accurate.
document.fonts?.ready.then(() => ScrollTrigger.refresh());
window.addEventListener('load', () => ScrollTrigger.refresh());
