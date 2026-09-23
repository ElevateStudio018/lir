import '@fontsource-variable/geist';
import '@fontsource/geist-mono/400.css';
import './styles/base.css';
import './styles/sections.css';
import './styles/legal.css';

import { initSmoothScroll, ScrollTrigger } from './lib/scroll.js';
import { initHeader } from './lib/header.js';

document.documentElement.classList.add('js');

initSmoothScroll();
initHeader();

document.fonts?.ready.then(() => ScrollTrigger.refresh());
