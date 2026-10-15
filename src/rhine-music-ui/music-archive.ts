import '../scripts/music/index.ts';
import { getSharedController } from '../scripts/music/controller';
import type { Queue, Track } from '../scripts/music/types';
import { SHELF_SLOTS, createSpring, stepSpring, type Spring } from './archive-model';
import './archive-stage';

interface ArchiveTrack extends Track {
  durationLabel: string; globalIndex: number; folderIndex: number; folderPath: string; folderTitle: string;
  trackIndex: number; folderTrackCount: number;
}
interface SelectionDetail { globalIndex: number }

const CLOCK_INTERVAL_MS = 1000;
const INDEX_OFFSET = 1;
const TWO_DIGIT_WIDTH = 2;
const FOUR_DIGIT_WIDTH = 4;
const RULER_IDLE_HEIGHT = 10;
const RULER_SELECTED_HEIGHT = 30;
const RULER_HOVER_HEIGHT = 12;
const RULER_HOVER_RADIUS = 1.5;
const RULER_SPRING_FREQUENCY = 18;
const RULER_FRAME_LIMIT_SECONDS = 0.05;
interface RulerMotion { tick: HTMLButtonElement; spring: Spring }
const required = <T extends Element>(root: ParentNode, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Audio archive element not found: ${selector}`);
  return element;
};
const readIndex = (element: HTMLElement): number => {
  const index = Number(element.dataset.globalIndex);
  if (!Number.isInteger(index)) throw new Error('Audio archive item has an invalid global index.');
  return index;
};

const page = required<HTMLElement>(document, '#audio-archive-page');
const gallery = required<HTMLElement>(page, '#archive-gallery');
const playerSlot = required<HTMLElement>(page, '#music-player-slot');
const controller = getSharedController();
const tracks = JSON.parse(gallery.dataset.archiveManifest || '[]') as ArchiveTrack[];
const folderTracks = new Map<string, ArchiveTrack[]>();
tracks.forEach((track) => folderTracks.set(track.folderPath, [...(folderTracks.get(track.folderPath) ?? []), track]));
const queueForFolder = (folderPath: string): Queue => {
  const list = folderTracks.get(folderPath);
  if (!list?.length) throw new Error(`No tracks registered for public/music/${folderPath}`);
  return { slug: folderPath, title: list[0]!.folderTitle, tracks: list.map(toPlayerTrack) };
};
const allTracksQueue: Queue = { slug: 'audio-archive-all', title: 'Audio Archive', tracks: tracks.map(toPlayerTrack) };
let selection = tracks[0]?.globalIndex ?? 0;
let activeFolderPath = '';
const shelfSelections = new Map<number, number>();
const rulerMotions = new Map<number, RulerMotion>();
let currentRulerShelf = -1;
let hoveredRulerIndex = -1;
let rulerAnimationFrame = 0;
let lastRulerFrame = 0;

function toPlayerTrack(track: ArchiveTrack): Track {
  return { title: track.title, artist: track.artist, src: track.src, cover: track.cover, duration: track.duration, lyricsSrc: track.lyricsSrc };
}

function updateRuler(index: number): void {
  const ruler = required<HTMLElement>(page, '[data-ruler]');
  const shelf = Math.floor(index / SHELF_SLOTS);
  const first = shelf * SHELF_SLOTS;
  if (shelf !== currentRulerShelf) {
    currentRulerShelf = shelf;
    hoveredRulerIndex = -1;
    rulerMotions.clear();
    ruler.replaceChildren(...tracks.slice(first, first + SHELF_SLOTS).map((track) => createRulerTick(track, index)));
  }
  rulerMotions.forEach(({ tick, spring }, trackIndex) => {
    const selected = trackIndex === index;
    tick.setAttribute('aria-current', String(selected));
    spring.target = selected ? RULER_SELECTED_HEIGHT : RULER_IDLE_HEIGHT;
  });
  updateRulerHoverTargets();
}

function updateFolderLabel(track: ArchiveTrack): void {
  const shelf = Math.floor(track.globalIndex / SHELF_SLOTS);
  const first = shelf * SHELF_SLOTS;
  const shelfTracks = tracks.slice(first, first + SHELF_SLOTS);
  const folderNames = [...new Set(shelfTracks.map((item) => item.folderTitle))];
  required<HTMLElement>(page, '[data-folder-name]').textContent = folderNames.join(' · ');
  required<HTMLElement>(page, '[data-shelf-number]').textContent = String(shelf + INDEX_OFFSET).padStart(TWO_DIGIT_WIDTH, '0');
  required<HTMLElement>(page, '[data-shelf-track-count]').textContent = String(shelfTracks.length).padStart(TWO_DIGIT_WIDTH, '0');
  shelfSelections.set(shelf, track.globalIndex);
}

function updateDetail(track: ArchiveTrack): void {
  const panels = [...page.querySelectorAll<HTMLElement>('[data-detail-folder]')];
  panels.forEach((panel) => { panel.hidden = Number(panel.dataset.detailFolder) !== track.folderIndex; });
  const panel = panels.find((item) => Number(item.dataset.detailFolder) === track.folderIndex);
  if (!panel) throw new Error(`Audio archive details missing for folder ${track.folderIndex + 1}`);
  required<HTMLElement>(panel, '[data-current-title]').textContent = track.title;
  required<HTMLElement>(panel, '[data-current-artist]').textContent = track.artist;
  required<HTMLElement>(panel, '[data-current-meta]').textContent = `${track.folderTitle.toUpperCase()} / ${track.durationLabel}`;
  required<HTMLElement>(panel, '[data-track-number]').textContent = String(track.globalIndex + INDEX_OFFSET).padStart(FOUR_DIGIT_WIDTH, '0');
  required<HTMLElement>(panel, '[data-profile-code]').textContent = `ARC-${String(track.globalIndex + INDEX_OFFSET).padStart(FOUR_DIGIT_WIDTH, '0')}`;
  panel.querySelectorAll<HTMLElement>('[data-detail-track]').forEach((item) => {
    required<HTMLButtonElement>(item, 'button').setAttribute('aria-pressed', String(readIndex(item) === track.globalIndex));
  });
  required<HTMLImageElement>(page, '#transport-cover').src = track.cover;
  updateFolderLabel(track);
  const localIndex = track.globalIndex % SHELF_SLOTS;
  required<HTMLElement>(page, '[data-selected-number]').textContent = String(localIndex + INDEX_OFFSET).padStart(TWO_DIGIT_WIDTH, '0');
  updateRuler(track.globalIndex);
}

function activatePlayer(folderPath: string): void {
  if (folderPath === activeFolderPath) return;
  const wrappers = [...playerSlot.querySelectorAll<HTMLElement>('[data-music-category]')];
  const next = wrappers.find((item) => item.dataset.musicCategory === folderPath);
  if (!next) throw new Error(`Player component not found for public/music/${folderPath}`);
  wrappers.forEach((item) => { item.hidden = item !== next; });
  activeFolderPath = folderPath;
  document.dispatchEvent(new Event('rhine-music:category-change'));
}

function selectTrack(index: number, syncCanvas: boolean): ArchiveTrack {
  const track = tracks[index];
  if (!track) throw new Error(`Music track index is outside the archive: ${index}`);
  selection = index;
  activatePlayer(track.folderPath);
  updateDetail(track);
  page.querySelectorAll<HTMLButtonElement>('[data-grid-track]').forEach((button) => {
    button.setAttribute('aria-pressed', String(readIndex(button) === index));
  });
  if (syncCanvas) document.dispatchEvent(new CustomEvent<SelectionDetail>('rhine-archive:sync-selection', { detail: { globalIndex: index } }));
  return track;
}

function playTrack(index: number): void {
  const track = selectTrack(index, true);
  controller.playQueue(queueForFolder(track.folderPath), track.trackIndex);
}

function createRulerTick(track: ArchiveTrack, selectedIndex: number): HTMLButtonElement {
  const tick = document.createElement('button');
  tick.type = 'button'; tick.className = 'ruler-tick';
  tick.dataset.globalIndex = String(track.globalIndex);
  tick.dataset.shelfSlot = String(track.globalIndex % SHELF_SLOTS);
  tick.setAttribute('aria-label', `${track.title} / ${track.artist}`);
  tick.setAttribute('aria-current', String(track.globalIndex === selectedIndex));
  const selected = track.globalIndex === selectedIndex;
  const height = selected ? RULER_SELECTED_HEIGHT : RULER_IDLE_HEIGHT;
  const spring = createSpring(height, RULER_SPRING_FREQUENCY);
  tick.style.height = `${height}px`;
  rulerMotions.set(track.globalIndex, { tick, spring });
  tick.addEventListener('click', () => selectTrack(track.globalIndex, true));
  tick.addEventListener('pointerenter', () => { hoveredRulerIndex = track.globalIndex; updateRulerHoverTargets(); });
  tick.addEventListener('pointerleave', () => { hoveredRulerIndex = -1; updateRulerHoverTargets(); });
  return tick;
}

function updateRulerHoverTargets(): void {
  const hoverSlot = hoveredRulerIndex < 0 ? -1 : hoveredRulerIndex % SHELF_SLOTS;
  rulerMotions.forEach(({ tick, spring }, trackIndex) => {
    const distance = Number(tick.dataset.shelfSlot) - hoverSlot;
    const hoverHeight = hoverSlot < 0 ? RULER_IDLE_HEIGHT
      : RULER_IDLE_HEIGHT + RULER_HOVER_HEIGHT * Math.exp(-(distance ** 2) / RULER_HOVER_RADIUS);
    const selectedHeight = trackIndex === selection ? RULER_SELECTED_HEIGHT : RULER_IDLE_HEIGHT;
    spring.target = Math.max(hoverHeight, selectedHeight);
  });
  scheduleRulerAnimation();
}

function scheduleRulerAnimation(): void {
  if (rulerAnimationFrame) return;
  lastRulerFrame = performance.now();
  rulerAnimationFrame = requestAnimationFrame(animateRuler);
}

function animateRuler(now: number): void {
  const elapsed = Math.min(RULER_FRAME_LIMIT_SECONDS, (now - lastRulerFrame) / 1000);
  lastRulerFrame = now;
  let moving = false;
  rulerMotions.forEach(({ tick, spring }) => {
    moving = stepSpring(spring, elapsed) || moving;
    tick.style.height = `${spring.x}px`;
  });
  rulerAnimationFrame = moving ? requestAnimationFrame(animateRuler) : 0;
}

function bindArchiveSelection(): void {
  document.addEventListener('rhine-archive:select', (event) => {
    const detail = (event as CustomEvent<SelectionDetail>).detail;
    selectTrack(detail.globalIndex, false);
  });
  page.querySelectorAll<HTMLElement>('[data-detail-track]').forEach((item) => {
    required<HTMLButtonElement>(item, 'button').addEventListener('click', () => playTrack(readIndex(item)));
  });
  page.querySelectorAll<HTMLButtonElement>('[data-grid-track]').forEach((button) => {
    button.addEventListener('click', () => selectTrack(readIndex(button), true));
  });
}

function bindNavigation(): void {
  page.querySelectorAll<HTMLButtonElement>('[data-track-step]').forEach((button) => {
    button.addEventListener('click', () => {
      const delta = Number(button.dataset.trackStep);
      const shelf = Math.floor(selection / SHELF_SLOTS);
      const start = shelf * SHELF_SLOTS;
      const end = Math.min(tracks.length - 1, start + SHELF_SLOTS - INDEX_OFFSET);
      selectTrack(Math.min(end, Math.max(start, selection + delta)), true);
    });
  });
  page.querySelectorAll<HTMLButtonElement>('[data-shelf-step]').forEach((button) => {
    button.addEventListener('click', () => {
      const shelf = Math.floor(selection / SHELF_SLOTS) + Number(button.dataset.shelfStep);
      const firstTrack = shelfSelections.get(shelf) ?? shelf * SHELF_SLOTS;
      selectTrack(Math.min(tracks.length - 1, Math.max(0, firstTrack)), true);
    });
  });
  page.querySelector<HTMLButtonElement>('[data-play-track]')?.addEventListener('click', () => playTrack(selection));
  page.querySelector<HTMLButtonElement>('[data-play-folder]')?.addEventListener('click', () => {
    const track = tracks[selection];
    if (!track) throw new Error('The selected archive track is missing.');
    const firstTrack = folderTracks.get(track.folderPath)?.[0];
    if (!firstTrack) throw new Error(`No tracks registered for public/music/${track.folderPath}`);
    playTrack(firstTrack.globalIndex);
  });
  document.addEventListener('rhine-archive:play', (event) => playTrack((event as CustomEvent<SelectionDetail>).detail.globalIndex));
}

function setLayout(layout: string): void {
  gallery.dataset.layout = layout;
  page.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((button) => {
    const active = button.dataset.layout === layout;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function bindLayout(): void {
  page.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((button) => {
    button.addEventListener('click', () => setLayout(button.dataset.layout || 'array'));
  });
}

function findTrack(query: string): ArchiveTrack | undefined {
  const term = query.trim().toLocaleLowerCase();
  return tracks.find((track) => `${track.title} ${track.artist} ${track.folderTitle}`.toLocaleLowerCase().includes(term));
}

function bindSearch(): void {
  required<HTMLInputElement>(page, '#archive-search').addEventListener('input', (event) => {
    const query = (event.currentTarget as HTMLInputElement).value;
    if (query.trim()) {
      const match = findTrack(query);
      if (match) selectTrack(match.globalIndex, true);
    }
  });
}

function updateClock(): void {
  const now = new Date();
  required<HTMLElement>(page, '#archive-clock').textContent = now.toLocaleTimeString('en-GB', { hour12: false });
  required<HTMLElement>(page, '#archive-date').textContent = now.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).toUpperCase();
}

function bindTheme(): void {
  const setTheme = (theme: string) => {
    if (theme !== 'dark' && theme !== 'light') throw new Error(`Unsupported archive theme: ${theme}`);
    document.documentElement.dataset.archiveTheme = theme;
    page.querySelectorAll<HTMLButtonElement>('[data-theme-shortcut]').forEach((button) => {
      const active = button.dataset.themeValue === theme;
      button.classList.toggle('selected', active);
    });
  };
  required<HTMLButtonElement>(page, '[data-theme-toggle]').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.archiveTheme === 'dark' ? 'light' : 'dark');
  });
  page.querySelectorAll<HTMLButtonElement>('[data-theme-shortcut]').forEach((button) => {
    button.addEventListener('click', () => setTheme(button.dataset.themeValue || 'dark'));
  });
}

function bindFooterControls(): void {
  const order = required<HTMLButtonElement>(page, '[data-order-button]');
  order.addEventListener('click', () => { controller.cycleMode(); order.textContent = controller.mode.toUpperCase(); });
  required<HTMLButtonElement>(page, '[data-shuffle-all]').addEventListener('click', () => {
    while (controller.mode !== 'shuffle') controller.cycleMode();
    controller.playQueue(allTracksQueue, Math.floor(Math.random() * allTracksQueue.tracks.length));
  });
}

bindArchiveSelection();
bindNavigation();
bindLayout();
bindSearch();
bindTheme();
bindFooterControls();
updateClock();
window.setInterval(updateClock, CLOCK_INTERVAL_MS);
selectTrack(selection, true);
