import { getSharedController } from './controller';
import { createLyricsController } from './lyrics-controller';
import { bindPlayerMotion } from './motion';
import { createPlayerView } from './view';
import type { Queue, Track } from './types';

const cleanups = new WeakMap<HTMLElement, () => void>();

function initialize(root: HTMLElement): void {
  if (cleanups.has(root)) return;

  const controller = getSharedController();
  const localTracks: Track[] = JSON.parse(root.dataset.trackManifest || '[]');
  const localQueue: Queue | undefined = localTracks.length ? {
    slug: root.dataset.playlistSlug || '',
    title: root.getAttribute('aria-label')?.replace(/播放器$/, '') || '',
    tracks: localTracks,
    singleTrack: root.dataset.singleTrack === 'true',
  } : undefined;
  const lyricLines = root.querySelector<HTMLOListElement>('[data-lyrics-lines]');
  const emptyLyrics = root.querySelector<HTMLElement>('[data-lyrics-empty]');
  const lyricsController = createLyricsController({ lines: lyricLines, empty: emptyLyrics });
  const view = createPlayerView(root, controller, localTracks, localQueue, lyricsController);
  const unbindView = view.bind();
  const unsubscribe = controller.subscribe(view.render);
  const unbindMotion = bindPlayerMotion(root, view.expand, view.lyrics);

  cleanups.set(root, () => {
    unsubscribe();
    unbindView();
    unbindMotion();
    cleanups.delete(root);
  });
}

function initializeAll(): void {
  document.querySelectorAll<HTMLElement>('[data-music-player]').forEach((root) => {
    if (root.closest('[hidden]')) {
      cleanups.get(root)?.();
      return;
    }
    initialize(root);
  });
}

document.addEventListener('astro:page-load', initializeAll);
document.addEventListener('rhine-music:category-change', initializeAll);
document.addEventListener('astro:before-swap', () => {
  document.querySelectorAll<HTMLElement>('[data-music-player]').forEach((root) => cleanups.get(root)?.());
});
initializeAll();
