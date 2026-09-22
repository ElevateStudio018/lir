import { ScrollTrigger } from './scroll.js';

/** Header adapts to the chapter underneath it, hides on scroll-down, returns on scroll-up. */
export function initHeader() {
  const header = document.querySelector('[data-header]');
  if (!header) return;
  const sections = [...document.querySelectorAll('[data-theme]')].filter((s) => s !== header);
  // Scroll-spy only for in-page anchors (the project page links back to the home page instead).
  const links = [...document.querySelectorAll('.nav__link')].filter((a) => a.getAttribute('href').startsWith('#'));
  const navTargets = links.map((a) => document.querySelector(a.getAttribute('href')));
  let lastY = window.scrollY;
  let ticking = false;

  function update() {
    ticking = false;
    const y = window.scrollY;
    const probe = 40;
    let theme = 'dark';
    for (const s of sections) {
      const r = s.getBoundingClientRect();
      if (r.top <= probe && r.bottom > probe) {
        theme = s.dataset.theme;
        break;
      }
    }
    header.classList.toggle('is-light', theme === 'light');
    header.classList.toggle('is-scrolled', y > 40);
    const menuOpen = document.body.classList.contains('menu-open');
    const goingDown = y > lastY + 4;
    const goingUp = y < lastY - 4;
    if (!menuOpen && goingDown && y > window.innerHeight * 0.8) header.classList.add('is-hidden');
    else if (goingUp || y < 80) header.classList.remove('is-hidden');
    lastY = y;

    // Active navigation
    if (!links.length) return;
    let active = 0;
    navTargets.forEach((t, i) => {
      if (t.getBoundingClientRect().top <= window.innerHeight * 0.4) active = i;
    });
    links.forEach((a, i) => a.classList.toggle('is-active', i === active));
  }

  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  ScrollTrigger.addEventListener('refresh', update);
  update();
}
