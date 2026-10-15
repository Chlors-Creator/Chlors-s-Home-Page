import type { PlaybackMode } from '../playback-state';

export interface Track {
  title: string;
  artist: string;
  src: string;
  cover: string;
  duration: number;
  lyricsSrc: string | null;
}

export interface Queue {
  slug: string;
  title: string;
  tracks: Track[];
  singleTrack?: boolean;
}

export interface PlayerController {
  queue: Queue | null;
  current: number;
  mode: PlaybackMode;
  audio: HTMLAudioElement | null;
  subscribe(listener: () => void): () => void;
  notify(): void;
  playQueue(queue: Queue, index: number): void;
  toggle(fallback?: Queue): void;
  previous(): void;
  next(adjacent?: boolean): void;
  cycleMode(): void;
  setVolume(value: number): void;
  seek(ratio: number): void;
}
