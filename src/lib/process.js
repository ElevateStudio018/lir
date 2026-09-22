import { ScrollTrigger, scrollToY } from './scroll.js';
import { T, sub, stageIndexAt, stageAnchor } from '../three/timeline.js';
import { hasWebGL, isMobile, reducedMotion } from './env.js';

/**
 * Controller for the pinned process chapter. The heavy three.js scene is only
 * imported when the reader approaches the section; UI text is plain DOM.
 */
export function initProcess() {
  const section = document.querySelector('[data-process]');
  if (!section) return;
  const canvas = section.querySelector('[data-process-canvas]');
  const labels = section.querySelector('[data-process-labels]');
  const intro = section.querySelector('[data-process-intro]');
  const stages = [...section.querySelectorAll('[data-stage]')];
  const railBtns = [...section.querySelectorAll('[data-goto-stage]')];
  const bar = section.querySelector('[data-process-bar]');
  const count = section.querySelector('[data-process-count]');
  const annot = section.querySelector('[data-process-annot]');
  const rail = section.querySelector('.process__rail');
  const final = section.querySelector('[data-process-final]');
  const finalLines = final.querySelectorAll('.process__final-line, .btn');
  const frame = section.querySelector('[data-process-frame]');
  const frameLabel = section.querySelector('[data-process-frame-label]');
  const vignette = section.querySelector('.process__vignette');
  const dim = section.querySelector('[data-process-dim]');
  const fallback = [...section.querySelectorAll('[data-process-fallback] img')];

  let scene = null;
  let visible = false;
  let progress = 0;
  let activeStage = -2;
  const webgl = hasWebGL();
  if (!webgl) section.classList.add('no-webgl');

  // ---------- Lazy-load the 3D scene ----------
  if (webgl) {
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        try {
          const { createProcessScene } = await import('../three/process3d.js');
          scene = createProcessScene(canvas, { mobile: isMobile(), reduced: reducedMotion });
          scene.setLabels(labels);
          scene.jump(progress);
          if (visible) scene.start();
          requestAnimationFrame(() => canvas.classList.add('is-ready'));
        } catch (err) {
          console.warn('[process] WebGL scene unavailable, using image sequence.', err);
          section.classList.add('no-webgl');
        }
      },
      { rootMargin: '150% 0px' },
    );
    io.observe(section);

    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (!scene) return;
      visible ? scene.start() : scene.stop();
    }).observe(section);

    window.addEventListener('resize', () => scene?.resize());
    if (!reducedMotion) {
      section.addEventListener('pointermove', (e) => {
        scene?.setPointer((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
      });
    }
  }

  // ---------- UI synchronisation ----------
  const set = (el, prop, v) => {
    if (el.style[prop] !== v) el.style[prop] = v;
  };
  const frameText = (b) =>
    b < 0.12 ? 'Frame 06 · Stillbild' : b < 0.45 ? 'Kantdetektering' : b < 0.6 ? 'Linjeritning' : 'Ritning A-40.1 · Skala 1:200';

  function ui(t) {
    const introK = 1 - sub(t, 0.012, 0.042);
    set(intro, 'opacity', introK.toFixed(3));
    set(intro, 'visibility', introK <= 0.001 ? 'hidden' : 'visible');
    set(intro, 'transform', `translateY(calc(-50% - ${((1 - introK) * 40).toFixed(1)}px))`);
    if (isMobile()) set(intro, 'transform', `translateY(${(-(1 - introK) * 40).toFixed(1)}px)`);

    let s = stageIndexAt(t);
    if (t >= T.final[0]) s = -1;
    if (s !== activeStage) {
      activeStage = s;
      stages.forEach((el, i) => el.classList.toggle('is-active', i === s));
      railBtns.forEach((b, i) => {
        b.classList.toggle('is-active', i === s);
        b.setAttribute('aria-current', i === s ? 'step' : 'false');
      });
      if (s >= 0) count.textContent = String(s + 1).padStart(2, '0');
      fallback.forEach((im, i) => im.classList.toggle('is-active', i === Math.max(0, s)));
    }

    set(bar, 'transform', `scaleY(${sub(t, T.idea[0], T.result[1]).toFixed(4)})`);
    const chrome = (sub(t, 0.02, 0.05) * (1 - sub(t, T.final[0], T.final[0] + 0.02))).toFixed(3);
    set(annot, 'opacity', chrome);
    set(rail, 'opacity', chrome);
    set(rail, 'visibility', chrome > 0 ? 'visible' : 'hidden');

    const fk = sub(t, T.final[0], T.final[0] + 0.02) * (1 - sub(t, T.final[1] - 0.012, T.final[1] + 0.004));
    set(final, 'opacity', fk.toFixed(3));
    set(dim, 'opacity', fk.toFixed(3));
    set(final, 'visibility', fk > 0.001 ? 'visible' : 'hidden');
    finalLines.forEach((l, i) => {
      const k = sub(t, T.final[0] + i * 0.008, T.final[0] + 0.03 + i * 0.008);
      set(l, 'transform', `translateY(${((1 - k) * 36).toFixed(1)}px)`);
      set(l, 'opacity', k.toFixed(3));
    });

    const b = sub(t, T.blueprint[0], T.blueprint[1]);
    const fr = sub(b, 0.0, 0.06) * (1 - sub(b, 0.7, 0.8));
    set(frame, 'opacity', fr.toFixed(3));
    frameLabel.textContent = frameText(b);
    set(vignette, 'opacity', (1 - sub(b, 0.1, 0.4)).toFixed(3));
  }

  ScrollTrigger.create({
    trigger: section,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => {
      progress = self.progress;
      scene?.setProgress(progress);
      ui(progress);
    },
    onRefresh: (self) => {
      progress = self.progress;
      ui(progress);
    },
  });
  ui(0);

  // Rail → jump to stage
  railBtns.forEach((btn) =>
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.gotoStage);
      const top = section.getBoundingClientRect().top + window.scrollY;
      const span = section.offsetHeight - window.innerHeight;
      scrollToY(top + span * stageAnchor(i));
    }),
  );
}
