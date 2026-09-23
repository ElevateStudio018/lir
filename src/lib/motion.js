import { gsap, ScrollTrigger } from './scroll.js';
import { splitLines } from './split.js';
import { reducedMotion } from './env.js';

/** Hero opening sequence: image settle → headline lines → body → CTA. */
export function heroIntro() {
  const media = document.querySelector('[data-hero-media]');
  const lines = document.querySelectorAll('[data-hero-line]');
  const fades = document.querySelectorAll('[data-hero-fade]');
  const cta = document.querySelector('[data-hero-cta]');
  const header = document.querySelector('[data-header]');
  if (reducedMotion) {
    document.body.classList.remove('is-loading');
    return;
  }

  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.fromTo(media, { scale: 1.04 }, { scale: 1, duration: 1.8, ease: 'power2.out' }, 0)
    .fromTo(lines, { yPercent: 105 }, { yPercent: 0, duration: 1.1, stagger: 0.09 }, 0.2)
    .fromTo(fades, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.9, stagger: 0.06 }, 0.6)
    .fromTo(cta, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.9 }, 0.8)
    .fromTo(header, { yPercent: -100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1, clearProps: 'transform,opacity' }, 0.35);
  document.body.classList.remove('is-loading');
}

/**
 * Split-heading and fade-up reveals — the two patterns every page shares
 * (`[data-split]` headings, `[data-reveal]` copy). Safe to call on pages
 * that don't have the homepage's other sections, since it only ever
 * touches these two generic markers.
 */
export function genericReveals() {
  // Split headings → masked line reveals
  document.querySelectorAll('[data-split]').forEach((el) => {
    const lines = splitLines(el);
    if (reducedMotion) return;
    gsap.set(lines, { yPercent: 105, y: 0 });
    gsap.to(lines, {
      yPercent: 0,
      y: 0,
      duration: 1.1,
      ease: 'expo.out',
      stagger: 0.08,
      scrollTrigger: { trigger: el, start: 'top 86%', once: true },
    });
  });

  if (reducedMotion) return;

  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 90%',
    once: true,
    onEnter: (els) =>
      gsap.to(els, { opacity: 1, y: 0, duration: 1, ease: 'expo.out', stagger: 0.08, overwrite: true }),
  });
}

export function scrollMotion() {
  genericReveals();
  if (reducedMotion) return;

  // Hero: background 0.9× scroll speed, foreground exits a touch faster
  const hero = document.querySelector('.hero');
  gsap.to('[data-hero-media]', {
    yPercent: 10,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  });
  gsap.to('.hero__inner, .hero__meta', {
    y: -80,
    opacity: 0.1,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  });

  // Generic image parallax
  document.querySelectorAll('[data-parallax]').forEach((el) => {
    const amt = parseFloat(el.dataset.parallax) || 0.1;
    gsap.fromTo(
      el,
      { yPercent: -amt * 60 },
      {
        yPercent: amt * 60,
        ease: 'none',
        scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true },
      },
    );
  });

  // Services: staggered depth — each column drifts at its own speed
  gsap.utils.toArray('.service').forEach((el, i) => {
    gsap.fromTo(
      el,
      { y: 40 + i * 50 },
      { y: -20 - i * 30, ease: 'none', scrollTrigger: { trigger: '.services', start: 'top bottom', end: 'bottom top', scrub: true } },
    );
  });

  // Image curtain reveals
  gsap.utils.toArray('.service__media, .pcard, .about__media, .sustain__media').forEach((el) => {
    gsap.fromTo(
      el,
      { clipPath: 'inset(12% 0% 0% 0%)' },
      {
        clipPath: 'inset(0% 0% 0% 0%)',
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'top 45%', scrub: true },
      },
    );
  });

  // Numbers: the row travels horizontally as you pass
  const mm = gsap.matchMedia();
  mm.add('(min-width: 901px)', () => {
    // Subtle lateral drift — the row glides past like a horizontal band
    gsap.fromTo(
      '.numbers__row',
      { x: () => window.innerWidth * 0.06 },
      {
        x: () => -window.innerWidth * 0.03,
        ease: 'none',
        scrollTrigger: { trigger: '.numbers', start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true },
      },
    );
    gsap.utils.toArray('.num').forEach((el, i) =>
      gsap.fromTo(el, { opacity: 0, y: 40 }, {
        opacity: 1,
        y: 0,
        duration: 1.2,
        delay: i * 0.08,
        ease: 'expo.out',
        scrollTrigger: { trigger: '.numbers__row', start: 'top 85%', once: true },
      }),
    );
  });

  // Human: headline scales very slightly into place
  gsap.fromTo('.human__title', { scale: 1.06, transformOrigin: 'left bottom' }, {
    scale: 1,
    ease: 'none',
    scrollTrigger: { trigger: '.human', start: 'top bottom', end: 'bottom bottom', scrub: true },
  });

  // CTA image settles as it arrives
  gsap.fromTo('[data-cta-media]', { scale: 1.14 }, {
    scale: 1,
    ease: 'none',
    scrollTrigger: { trigger: '.cta', start: 'top bottom', end: 'bottom bottom', scrub: true },
  });

  // Footer statement slides in from both sides
  gsap.fromTo('.footer__statement span:first-child', { xPercent: -8 }, {
    xPercent: 0,
    ease: 'none',
    scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'top 30%', scrub: true },
  });
  gsap.fromTo('.footer__statement span:last-child', { xPercent: 8 }, {
    xPercent: 0,
    ease: 'none',
    scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'top 30%', scrub: true },
  });
}

/** Count-up on viewport entry. Swedish number formatting (thin space thousands). */
export function counters() {
  const fmt = (n, el) => (el.dataset.format === 'space' ? Math.round(n).toLocaleString('sv-SE') : String(Math.round(n)));
  document.querySelectorAll('[data-count]').forEach((el) => {
    const to = parseFloat(el.dataset.count);
    if (reducedMotion) {
      el.textContent = fmt(to, el);
      return;
    }
    const o = { v: 0 };
    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      once: true,
      onEnter: () =>
        gsap.to(o, {
          v: to,
          duration: 2.2,
          ease: 'expo.out',
          onUpdate: () => (el.textContent = fmt(o.v, el)),
        }),
    });
  });
}
