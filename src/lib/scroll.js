import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { reducedMotion } from './env.js';

gsap.registerPlugin(ScrollTrigger);

let lenis = null;

/** Lenis smooth scrolling driven by GSAP's ticker — native scroll, no hijacking. */
export function initSmoothScroll() {
  if (!reducedMotion) {
    lenis = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 3.2), smoothWheel: true, wheelMultiplier: 0.95 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  // Anchor links
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented) return;
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    scrollToEl(target);
    history.replaceState(null, '', id === '#top' ? location.pathname : id);
  });
  return lenis;
}

export function scrollToEl(el, offset = 0) {
  if (lenis) lenis.scrollTo(el, { offset, duration: 1.4 });
  else el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
}

export function scrollToY(y, immediate = false) {
  if (lenis) lenis.scrollTo(y, { duration: immediate ? 0 : 1.6, immediate });
  else window.scrollTo({ top: y, behavior: immediate || reducedMotion ? 'auto' : 'smooth' });
}

export const stopScroll = () => lenis?.stop();
export const startScroll = () => lenis?.start();
export { gsap, ScrollTrigger };
