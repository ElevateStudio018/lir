import { ScrollTrigger } from './scroll.js';
import { hasWebGL, isMobile } from './env.js';
import { ease, sub } from '../three/timeline.js';

const fmt = (h) => (h < 1 ? `${Math.round(h * 1000)} mm` : `${h.toFixed(h < 10 ? 1 : 0).replace('.', ',')} m`);

export function initMaterial() {
  const section = document.querySelector('[data-material]');
  if (!section) return;
  const canvas = section.querySelector('[data-material-canvas]');
  const a = section.querySelector('[data-material-a]');
  const b = section.querySelector('[data-material-b]');
  const scale = section.querySelector('[data-material-scale]');
  let scene = null;
  let visible = false;
  let zoom = 0;

  if (!hasWebGL()) section.classList.add('no-webgl');
  else {
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        try {
          const { createMaterialScene } = await import('../three/material.js');
          scene = createMaterialScene(canvas, { mobile: isMobile() });
          if (!scene) throw new Error('no context');
          scene.setProgress(zoom);
          if (visible) scene.start();
        } catch (err) {
          console.warn('[material] fallback', err);
          section.classList.add('no-webgl');
        }
      },
      { rootMargin: '120% 0px' },
    );
    io.observe(section);
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (scene) visible ? scene.start() : scene.stop();
    }).observe(section);
    window.addEventListener('resize', () => scene?.resize());
  }

  const ui = (p) => {
    zoom = ease.inOut(sub(p, 0.04, 0.96));
    scene?.setProgress(zoom);
    const h = Math.exp(Math.log(0.055) + (Math.log(64) - Math.log(0.055)) * zoom);
    const kind = h < 0.5 ? 'Detalj · Betong' : h < 6 ? 'Element · Fog & fönster' : h < 24 ? 'Fasad' : 'Byggnad';
    scale.textContent = `${kind} — bildhöjd ${fmt(h)}`;
    const ka = sub(p, 0.02, 0.12) * (1 - sub(p, 0.45, 0.55));
    const kb = sub(p, 0.55, 0.68);
    a.style.opacity = Math.max(ka, kb * 0.35).toFixed(3);
    a.style.transform = `translateY(${((1 - sub(p, 0.02, 0.14)) * 40).toFixed(1)}px)`;
    b.style.opacity = kb.toFixed(3);
    b.style.transform = `translateY(${((1 - kb) * 40).toFixed(1)}px)`;
  };
  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (s) => ui(s.progress),
    onRefresh: (s) => ui(s.progress),
  });
  ui(0);
}
