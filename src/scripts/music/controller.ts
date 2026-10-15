import Amplitude from 'amplitudejs';
import { nextIndex, nextMode, type PlaybackMode } from '../playback-state';
import type { PlayerController, Queue } from './types';

export const MODE_LABELS: Record<PlaybackMode, string> = {
  list: '列表循环',
  shuffle: '随机播放',
  sequence: '顺序播放',
  single: '单曲循环',
};

declare global {
  interface Window {
    __chlorsMusicPlayer?: PlayerController;
  }
}

function readMode(): PlaybackMode {
  const value = localStorage.getItem('music-playback-mode');
  return value === 'shuffle' || value === 'sequence' || value === 'single' ? value : 'list';
}

export function createController(): PlayerController {
  const listeners = new Set<() => void>();
  let ended = false;
  let detachAudio: (() => void) | null = null;
  let announcedPlayback = false;
  const setPlaybackState = (playing: boolean) => {
    if (announcedPlayback === playing) return;
    announcedPlayback = playing;
    document.dispatchEvent(
      new CustomEvent('rhine-music:playback-state', { detail: { playing } }),
    );
  };

  const controller: PlayerController = {
    queue: null,
    current: 0,
    mode: readMode(),
    audio: null,

    subscribe(listener) {
      listeners.add(listener);
      listener();
      return () => listeners.delete(listener);
    },

    notify() {
      listeners.forEach((listener) => listener());
    },

    playQueue(queue, index) {
      const queueChanged = controller.queue?.slug !== queue.slug;
      controller.queue = queue;
      controller.current = Math.min(Math.max(index, 0), Math.max(0, queue.tracks.length - 1));
      ended = false;

      if (queueChanged || !controller.audio) {
        if (controller.audio) {
          detachAudio?.();
          detachAudio = null;
          Amplitude.stop();
          controller.audio.pause();
          controller.audio = null;
        }
        const savedVolume = Number(localStorage.getItem('music-volume') ?? 0.8);
        Amplitude.init({
          songs: queue.tracks.map((track) => ({
            name: track.title,
            artist: track.artist,
            url: track.src,
            cover_art_url: track.cover,
          })),
          volume: Math.min(1, Math.max(0, Number.isFinite(savedVolume) ? savedVolume : 0.8)) * 100,
          continue_next: false,
          callbacks: {
            stop: () => {
              if (!ended) return;
              ended = false;
              if (controller.queue?.singleTrack) {
                controller.notify();
                return;
              }
              const next = nextIndex({
                mode: controller.mode,
                current: controller.current,
                length: controller.queue?.tracks.length || 0,
              });
              if (next !== null && controller.queue) controller.playQueue(controller.queue, next);
              controller.notify();
            },
          },
        });

        controller.audio = Amplitude.getAudio();
        const audio = controller.audio;
        const events = ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked'];
        const onStart = () => {
          setPlaybackState(true);
          controller.notify();
        };
        const onError = () => {
          setPlaybackState(false);
          controller.notify();
        };
        const onEnded = () => {
          ended = true;
          const next = nextIndex({
            mode: controller.mode,
            current: controller.current,
            length: controller.queue?.tracks.length || 0,
          });
          if (controller.queue?.singleTrack || next === null)
            setPlaybackState(false);
          controller.notify();
        };
        events.forEach((event) => audio.addEventListener(event, controller.notify));
        audio.addEventListener('play', onStart);
        audio.addEventListener('playing', onStart);
        audio.addEventListener('error', onError);
        audio.addEventListener('ended', onEnded);
        detachAudio = () => {
          events.forEach((event) => audio.removeEventListener(event, controller.notify));
          audio.removeEventListener('play', onStart);
          audio.removeEventListener('playing', onStart);
          audio.removeEventListener('error', onError);
          audio.removeEventListener('ended', onEnded);
        };
      }

      setPlaybackState(true);
      Amplitude.playSongAtIndex(controller.current);
      controller.notify();
    },

    toggle(fallback) {
      if (fallback?.tracks.length && controller.queue?.slug !== fallback.slug) {
        controller.playQueue(fallback, 0);
        return;
      }
      if (!controller.audio) return;
      const shouldPlay = controller.audio.paused || controller.audio.ended;
      if (shouldPlay) Amplitude.play();
      else Amplitude.pause();
      setPlaybackState(shouldPlay);
      controller.notify();
    },

    stop() {
      if (!controller.audio) return;
      Amplitude.pause();
      controller.audio.currentTime = 0;
      setPlaybackState(false);
      controller.notify();
    },

    previous() {
      if (controller.queue?.tracks.length) {
        controller.playQueue(
          controller.queue,
          (controller.current - 1 + controller.queue.tracks.length) % controller.queue.tracks.length,
        );
      }
    },

    next(adjacent = false) {
      if (!controller.queue?.tracks.length) return;
      const next = adjacent
        ? (controller.current + 1) % controller.queue.tracks.length
        : nextIndex({ mode: controller.mode, current: controller.current, length: controller.queue.tracks.length });
      if (next !== null) controller.playQueue(controller.queue, next);
    },

    cycleMode() {
      controller.mode = nextMode(controller.mode);
      localStorage.setItem('music-playback-mode', controller.mode);
      controller.notify();
    },

    setVolume(value) {
      Amplitude.setVolume(value * 100);
      localStorage.setItem('music-volume', String(value));
      controller.notify();
    },

    seek(ratio) {
      if (controller.audio) Amplitude.setSongPlayedPercentage(Math.min(1, Math.max(0, ratio)) * 100);
    },
  };

  return controller;
}

export function getSharedController(): PlayerController {
  return window.__chlorsMusicPlayer ||= createController();
}
