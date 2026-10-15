const COUNTER_DURATION_MS = 460;
const SCRAMBLE_DURATION_MS = 440;
const SCRAMBLE_GLYPHS = '#%&/\\|=+<>01_-';

function digitCell(from: string, to: string, animate: boolean): HTMLSpanElement {
  const cell = document.createElement('span');
  cell.className = 'archive-roll-digit';
  cell.setAttribute('aria-hidden', 'true');
  if (!animate || from === to) { cell.textContent = to; return cell; }
  const oldDigit = document.createElement('span');
  const nextDigit = document.createElement('span');
  oldDigit.className = 'roll-current'; oldDigit.textContent = from;
  nextDigit.className = 'roll-next'; nextDigit.textContent = to;
  cell.append(oldDigit, nextDigit);
  requestAnimationFrame(() => cell.classList.add('is-rolling'));
  return cell;
}

export function rollCounter(element: HTMLElement, value: string): void {
  const previous = element.dataset.rollValue;
  const animate = Boolean(previous && previous !== value && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  const from = (previous || value).padStart(value.length, '0').slice(-value.length);
  element.dataset.rollValue = value;
  element.setAttribute('aria-label', value);
  element.replaceChildren(...[...value].map((digit, index) => digitCell(from[index] || digit, digit, animate)));
  if (!animate) return;
  window.setTimeout(() => {
    if (element.dataset.rollValue !== value) return;
    element.replaceChildren(...[...value].map((digit) => digitCell(digit, digit, false)));
  }, COUNTER_DURATION_MS);
}

function easeOut(value: number): number {
  return value >= 1 ? 1 : 1 - 2 ** (-10 * value);
}

export function scrambleTitle(element: HTMLElement, value: string): void {
  const previous = element.dataset.finalTitle;
  element.dataset.finalTitle = value;
  if (!previous || previous === value || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    element.textContent = value;
    return;
  }
  const chars = [...value];
  const start = performance.now();
  const seed = value.length * 31 + 7;
  const draw = (now: number): void => {
    if (element.dataset.finalTitle !== value) return;
    const progress = Math.min(1, (now - start) / SCRAMBLE_DURATION_MS);
    const resolved = Math.floor(easeOut(progress) * chars.length);
    let random = seed + Math.floor(now / 50);
    element.textContent = chars.map((char, index) => {
      if (index < resolved || char === ' ') return char;
      random = (random * 1103515245 + 12345) & 0x7fffffff;
      return SCRAMBLE_GLYPHS[random % SCRAMBLE_GLYPHS.length] || char;
    }).join('');
    if (progress < 1) requestAnimationFrame(draw);
    else element.textContent = value;
  };
  requestAnimationFrame(draw);
}
