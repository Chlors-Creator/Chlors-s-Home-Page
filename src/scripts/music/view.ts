import { MODE_LABELS } from './controller';
import type { LyricsController } from './lyrics-controller';
import type { PlayerController, Queue, Track } from './types';

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  return `${minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : minutes}:${String(total % 60).padStart(2, '0')}`;
}

interface PlayerView {
  render(): void;
  bind(): () => void;
  expand: HTMLButtonElement | null;
  lyrics: HTMLElement | null;
}

export function createPlayerView(
  root: HTMLElement,
  controller: PlayerController,
  localTracks: Track[],
  localQueue: Queue | undefined,
  lyricsController: LyricsController,
): PlayerView {
  const query = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const playPause = query<HTMLButtonElement>('[data-play-pause]');
  const playIcon = playPause?.querySelector<SVGElement>('[data-play-icon]');
  const pauseIcon = playPause?.querySelector<SVGElement>('[data-pause-icon]');
  const modeButton = query<HTMLButtonElement>('[data-mode-button]');
  const volume = query<HTMLInputElement>('[data-volume]');
  const progress = query<HTMLElement>('[data-progress]');
  const fill = query<HTMLElement>('[data-progress-fill]');
  const thumb = query<HTMLElement>('[data-progress-thumb]');
  const elapsed = query<HTMLElement>('[data-elapsed]');
  const duration = query<HTMLElement>('[data-duration]');
  const title = query<HTMLElement>('[data-player-title]');
  const artist = query<HTMLElement>('[data-player-artist]');
  const rows = [...root.querySelectorAll<HTMLElement>('[data-track-index]')];
  const expand = query<HTMLButtonElement>('[data-expand-player]');
  const lyrics = query<HTMLElement>('[data-lyrics]');
  const singleTrackPlayer = root.dataset.singleTrack === 'true';

  const render = () => {
    const queueMatchesPlayer = controller.queue?.slug === localQueue?.slug;
    const audio = singleTrackPlayer && !queueMatchesPlayer
      ? null
      : controller.audio;
    const track = singleTrackPlayer && !queueMatchesPlayer
      ? localTracks[0]
      : controller.queue?.tracks[controller.current] || localTracks[0];
    const played = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const total = audio && Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : track?.duration || 0;
    const isPlaying = Boolean(audio && !audio.paused && !audio.ended && !audio.error);

    playIcon?.toggleAttribute('hidden', isPlaying);
    pauseIcon?.toggleAttribute('hidden', !isPlaying);
    if (playPause) {
      playPause.disabled = !track && !localQueue;
      playPause.setAttribute('aria-label', isPlaying ? '暂停' : '播放');
      playPause.title = isPlaying ? '暂停' : '播放';
    }
    if (title) title.textContent = track?.title || localTracks[0]?.title || '暂无正在播放';
    if (artist) artist.textContent = track?.artist || localTracks[0]?.artist || '—';
    if (elapsed) elapsed.textContent = formatTime(played);
    if (duration) duration.textContent = formatTime(total);

    const percent = total ? Math.min(100, Math.max(0, played / total * 100)) : 0;
    if (fill) fill.style.width = `${percent}%`;
    if (thumb) thumb.style.left = `${percent}%`;
    if (progress) {
      progress.setAttribute('aria-valuemax', String(total));
      progress.setAttribute('aria-valuenow', String(played));
    }
    if (volume) volume.value = String(Number(localStorage.getItem('music-volume') ?? 0.8));
    if (modeButton) {
      modeButton.querySelectorAll<SVGElement>('[data-mode-icon]').forEach((icon) => {
        icon.toggleAttribute('hidden', icon.dataset.modeIcon !== controller.mode);
      });
      modeButton.setAttribute('aria-label', `播放模式：${MODE_LABELS[controller.mode]}`);
      modeButton.title = MODE_LABELS[controller.mode];
      modeButton.disabled = (!track && !localQueue) || (singleTrackPlayer && localQueue?.tracks.length === 1);
    }
    root.querySelectorAll<HTMLButtonElement>('[data-prev], [data-next], [data-stop]').forEach((button) => { button.disabled = !track || (singleTrackPlayer && localQueue?.tracks.length === 1); });
    if (volume) volume.disabled = !track && !localQueue;
    rows.forEach((row) => row.toggleAttribute('data-active', queueMatchesPlayer && Number(row.dataset.localTrackIndex ?? row.dataset.trackIndex) === controller.current));

    void lyricsController.load(track?.lyricsSrc);
    lyricsController.sync(played);
  };

  const onProgress = (event: Event) => {
    const rect = progress?.getBoundingClientRect();
    const audio = controller.audio;
    const total = audio?.duration || 0;
    if (!rect || !audio || !total) return;

    let ratio: number;
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      ratio = audio.currentTime / total + (event.key === 'ArrowRight' ? 0.05 : -0.05);
    } else {
      ratio = ((event as MouseEvent).clientX - rect.left) / rect.width;
    }
    controller.seek(ratio);
    render();
  };

  const bind = () => {
    const listeners: Array<[EventTarget | null, string, EventListener]> = [
      [playPause, 'click', () => controller.toggle(localQueue)],
      [modeButton, 'click', () => controller.cycleMode()],
      [volume, 'input', () => controller.setVolume(Number(volume?.value || 0))],
      [progress, 'click', onProgress],
      [progress, 'keydown', onProgress],
      [query('[data-prev]'), 'click', () => controller.previous()],
      [query('[data-next]'), 'click', () => controller.next(root.dataset.homePlayer === 'true')],
      [query('[data-stop]'), 'click', () => controller.stop()],
    ];
    rows.forEach((row) => listeners.push([
      row.querySelector('button'),
      'click',
      () => localQueue && controller.playQueue(localQueue, Number(row.dataset.localTrackIndex ?? row.dataset.trackIndex)),
    ]));
    listeners.forEach(([element, event, handler]) => element?.addEventListener(event, handler));

    return () => {
      listeners.forEach(([element, event, handler]) => element?.removeEventListener(event, handler));
    };
  };

  return { render, bind, expand, lyrics };
}
