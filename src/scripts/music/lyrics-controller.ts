import { findActiveLyricIndex, parseLrc, type LyricLine } from '../lrc';

interface LyricsElements {
  lines: HTMLOListElement | null;
  empty: HTMLElement | null;
}

export interface LyricsController {
  load(src: string | null | undefined): Promise<void>;
  sync(time: number): void;
}

export function createLyricsController({ lines, empty }: LyricsElements): LyricsController {
  const cache = new Map<string, LyricLine[]>();
  let currentLyrics: LyricLine[] = [];
  let activeLyric = -1;
  let loadedLyricsSrc: string | null | undefined;
  let requestVersion = 0;

  const render = () => {
    if (!lines || !empty) return;
    empty.hidden = currentLyrics.length > 0;
    lines.innerHTML = '';
    currentLyrics.forEach((line, index) => {
      const item = document.createElement('li');
      item.textContent = line.text;
      item.toggleAttribute('data-active', index === activeLyric);
      lines.append(item);
    });
  };

  const load = async (src: string | null | undefined) => {
    if (src === loadedLyricsSrc) return;
    loadedLyricsSrc = src;
    currentLyrics = [];
    activeLyric = -1;
    const request = ++requestVersion;

    if (src) {
      try {
        const cached = cache.get(src);
        const text = cached
          ? null
          : await fetch(src).then((response) => response.ok ? response.text() : Promise.reject(new Error('lyrics')));
        if (request !== requestVersion) return;
        currentLyrics = cached || parseLrc(text || '');
        if (!cached) cache.set(src, currentLyrics);
      } catch {
        // Missing lyrics use the instrumental fallback.
      }
    }
    render();
  };

  const sync = (time: number) => {
    if (!currentLyrics.length) return;
    const nextLyric = findActiveLyricIndex(currentLyrics, time);
    if (nextLyric === activeLyric) return;
    activeLyric = nextLyric;
    render();
    lines?.querySelector('[data-active]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return { load, sync };
}
