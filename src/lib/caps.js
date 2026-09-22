import { IMG, px, pxSet } from '../data/images.js';
import { scrollToEl } from './scroll.js';

const CAPS = {
  projektledning: {
    img: IMG.blueprintTeam,
    caption: 'Projektledning · Tidigt skede',
    desc: 'En ansvarig projektledare från första skiss till slutbesiktning. Tid, ekonomi och kvalitet styrs från ett och samma ställe.',
    metrics: [['140+', 'Projektledare'], ['±2 %', 'Snittavvikelse budget'], ['96 %', 'Levererat i tid']],
  },
  byggledning: {
    img: IMG.engineerTablet,
    caption: 'Byggledning · Egen personal',
    desc: 'Erfarna platschefer och arbetsledare med egen personal i alla nyckelroller. Beslut fattas där arbetet utförs.',
    metrics: [['60+', 'Platschefer'], ['0,9', 'Olycksfallsfrekvens'], ['24/7', 'Platsberedskap']],
  },
  projekteringsledning: {
    img: IMG.blueprint,
    caption: 'Projektering · BIM-samordning',
    desc: 'Arkitekter, konstruktörer och installatörer samordnas i en gemensam BIM-modell — så att problemen löses på ritningen, inte på plats.',
    metrics: [['100 %', 'Projekt i BIM'], ['−30 %', 'Färre ändrings-PM'], ['LOD 400', 'Detaljeringsnivå']],
  },
  entreprenad: {
    img: IMG.towerCrane,
    caption: 'Entreprenad · Totalentreprenad',
    desc: 'Total-, utförande- och samverkansentreprenader för bostäder, skolor, kontor och industri. Upp till 1,5 miljarder kronor per projekt.',
    metrics: [['4,2 mdkr', 'Omsättning 2025'], ['38', 'Pågående projekt'], ['AAA', 'Kreditbetyg']],
  },
  anlaggning: {
    img: IMG.excavator,
    caption: 'Anläggning · Mark & infrastruktur',
    desc: 'Mark, väg, bro, VA och ledningsarbeten. Egen maskinpark och egna massahanteringsytor i hela regionen.',
    metrics: [['310', 'Egna maskiner'], ['1,2 Mt', 'Massor återanvända'], ['74 %', 'Fossilfri drift']],
  },
  renovering: {
    img: IMG.scaffold,
    caption: 'Renovering · Boende kvar',
    desc: 'Stambyten, fasadrenoveringar och ombyggnader i bebodda hus. Vi planerar för de som bor där — varje dag.',
    metrics: [['9 800', 'Lägenheter renoverade'], ['4,6/5', 'Boendenöjdhet'], ['−55 %', 'Energi efter åtgärd']],
  },
};

export function initCaps() {
  const tabs = [...document.querySelectorAll('[data-cap-key]')];
  const panel = document.querySelector('[data-caps-panel]');
  const media = document.querySelector('[data-caps-media]');
  const desc = document.querySelector('[data-caps-desc]');
  const metrics = document.querySelector('[data-caps-metrics]');
  if (!tabs.length) return { select() {} };

  // Pre-build all images (lazy) so switching is instant after first load.
  const imgs = {};
  const cap = document.createElement('figcaption');
  cap.className = 'mono';
  Object.entries(CAPS).forEach(([key, c], i) => {
    const im = document.createElement('img');
    im.className = 'ph';
    im.alt = c.caption;
    im.loading = 'lazy';
    im.decoding = 'async';
    im.sizes = '(min-width: 900px) 55vw, 100vw';
    im.srcset = pxSet(c.img, 11 / 16);
    im.src = px(c.img, 1600, 1100);
    if (i === 0) im.classList.add('is-active');
    media.appendChild(im);
    imgs[key] = im;
  });
  media.appendChild(cap);

  let current = null;
  function select(key, focus = false) {
    if (key === current || !CAPS[key]) return;
    const c = CAPS[key];
    const prev = current && imgs[current];
    current = key;
    tabs.forEach((t) => {
      const on = t.dataset.capKey === key;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      if (on) {
        panel.setAttribute('aria-labelledby', t.id);
        if (focus) t.focus();
      }
    });
    Object.values(imgs).forEach((im) => im.classList.remove('is-leaving'));
    if (prev) {
      prev.classList.remove('is-active');
      prev.classList.add('is-leaving');
    }
    imgs[key].classList.add('is-active');
    cap.textContent = c.caption;
    desc.textContent = c.desc;
    metrics.innerHTML = c.metrics.map(([v, l]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`).join('');
    [desc, metrics].forEach((el) => {
      el.classList.remove('caps__swap');
      void el.offsetWidth;
      el.classList.add('caps__swap');
    });
  }

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t.dataset.capKey));
    t.addEventListener('mouseenter', () => window.matchMedia('(hover: hover)').matches && select(t.dataset.capKey));
    t.addEventListener('keydown', (e) => {
      const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        select(tabs[e.key === 'Home' ? 0 : tabs.length - 1].dataset.capKey, true);
      } else if (dir) {
        e.preventDefault();
        select(tabs[(i + dir + tabs.length) % tabs.length].dataset.capKey, true);
      }
    });
  });
  select('projektledning');

  // Service cards deep-link into the matching capability
  document.querySelectorAll('[data-cap]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      select(a.dataset.cap);
      scrollToEl(document.querySelector('#kompetens'));
    }),
  );
  return { select };
}
