import { gsap } from './scroll.js';
import { reducedMotion } from './env.js';

/**
 * Shared-element style transition: the card image expands to fill the viewport,
 * then the project page opens with the very same image as its hero.
 */
export function initProjectTransitions() {
  const layer = document.querySelector('[data-ptrans]');
  const links = document.querySelectorAll('[data-project-link]');
  if (!layer) return;

  // Warm the cache on intent.
  links.forEach((a) =>
    a.addEventListener(
      'pointerenter',
      () => {
        const l = document.createElement('link');
        l.rel = 'prefetch';
        l.href = a.href;
        document.head.appendChild(l);
      },
      { once: true },
    ),
  );

  links.forEach((a) =>
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || reducedMotion) return;
      const img = a.querySelector('img');
      if (!img) return;
      e.preventDefault();
      const r = img.getBoundingClientRect();
      layer.innerHTML = '';
      const clone = new Image();
      clone.src = img.currentSrc || img.src;
      clone.className = 'ph';
      clone.alt = '';
      layer.appendChild(clone);
      Object.assign(layer.style, { display: 'block', top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
      try {
        sessionStorage.setItem('lir:ptrans', JSON.stringify({ src: clone.src, t: Date.now() }));
      } catch {}
      gsap
        .timeline({ onComplete: () => (window.location.href = a.href) })
        .to('main, .header', { opacity: 0.25, duration: 0.6, ease: 'power2.out' }, 0)
        .to(layer, { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight, duration: 0.95, ease: 'expo.inOut' }, 0)
        .fromTo(clone, { scale: 1.035 }, { scale: 1, duration: 0.95, ease: 'expo.inOut' }, 0);
    }),
  );

  // Coming back via bfcache — restore the page.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    layer.style.display = 'none';
    gsap.set('main, .header', { opacity: 1 });
  });
}
