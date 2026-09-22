/** Splits a heading on <br> into masked lines for editorial reveals. */
export function splitLines(el) {
  if (el.dataset.splitDone) return el.querySelectorAll('.mask > span');
  const parts = el.innerHTML.split(/<br\s*\/?>/i);
  el.innerHTML = parts.map((p) => `<span class="mask"><span>${p.trim()}</span></span>`).join('');
  el.dataset.splitDone = '1';
  return el.querySelectorAll('.mask > span');
}
