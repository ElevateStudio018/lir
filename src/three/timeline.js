// Shared scroll timeline for the process chapter (no three.js import — used by UI too).
// t ∈ [0, 1] is the scroll progress through the pinned section.
export const T = {
  intro: [0.0, 0.04],
  idea: [0.04, 0.13],
  plan: [0.13, 0.26],
  ground: [0.26, 0.4],
  frame: [0.4, 0.58],
  facade: [0.58, 0.72],
  result: [0.72, 0.8],
  final: [0.8, 0.865],
  blueprint: [0.865, 1.0],
};

export const STAGE_KEYS = ['idea', 'plan', 'ground', 'frame', 'facade', 'result'];

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const range = (t, [a, b]) => clamp01((t - a) / (b - a));
export const sub = (p, a, b) => clamp01((p - a) / (b - a));
export const lerp = (a, b, k) => a + (b - a) * k;

export const ease = {
  inOut: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  out: (x) => 1 - Math.pow(1 - x, 3),
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  in: (x) => x * x * x,
  smooth: (x) => x * x * (3 - 2 * x),
  // Settles with a gentle overshoot — gives heavy elements physical weight.
  outBack: (x) => {
    const c1 = 1.2;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  },
};

export function stageIndexAt(t) {
  if (t < T.idea[0]) return -1;
  for (let i = 0; i < STAGE_KEYS.length; i++) {
    if (t < T[STAGE_KEYS[i]][1]) return i;
  }
  return t < T.final[0] ? 5 : 6;
}

/** Scroll progress at the visual centre of a stage — used by the rail navigation. */
export const stageAnchor = (i) => {
  const [a, b] = T[STAGE_KEYS[i]];
  return a + (b - a) * 0.55;
};
