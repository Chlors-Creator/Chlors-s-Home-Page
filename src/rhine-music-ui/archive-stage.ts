import {
  buildShelves, caseTarget, clamp, createSpring, getArchiveGeometry, indexShelfTracks,
  isInsidePolygon, stepSpring, type ArchiveTrack, type CaseMotion, type Spring,
} from './archive-model';
import { drawArchiveScene, loadArchiveAssets, loadArchiveCovers, loadInspectionFrames, type ArchiveAssets, type RenderResult, type RenderState } from './archive-renderer';

const FRAME_LIMIT_SECONDS = 0.05;
const ROW_FREQUENCY = 9;
const ACTIVE_CASE_FREQUENCY = 13;
const IDLE_CASE_FREQUENCY = 7;
const CLEAR_FREQUENCY = 8;
const GAP_FREQUENCY = 11;
const INSPECT_LIFT_SECONDS = 0.32;
const INSPECT_TURN_SECONDS = 0.72;
const SLOTS_VISIBLE_FALLBACK = 6;
const ARRAY_SPRITE_VISIBLE_FRACTION = 0.7;
const ARRAY_TOP_CLEARANCE = 84;
const MAX_VISIBLE_SLOT_SEARCH = 400;
const SPRITE_TOP_MARGIN_FACTOR = 0.05;
const SCROLL_SELECTION_LEAD = 4;

interface ArchiveManifest extends HTMLElement { dataset: DOMStringMap & { archiveManifest?: string } }
interface SelectionDetail { globalIndex: number }
interface StageState {
  selected: number; hovered: number; inspectionProgress: number; inspectionTarget: number;
  rowPositions: Map<number, Spring>; shelfOffset: Map<number, Spring>; shelfSelection: Map<number, number>;
  motion: Map<number, CaseMotion>;
}

const page = document.querySelector<HTMLElement>('#audio-archive-page');
if (!page) throw new Error('Audio archive page root was not found.');
const gallery = page.querySelector<ArchiveManifest>('#archive-gallery');
const canvas = page.querySelector<HTMLCanvasElement>('#archive-canvas');
const returnButton = page.querySelector<HTMLButtonElement>('#inspection-return');
if (!gallery || !canvas) throw new Error('Audio archive stage markup is incomplete.');
const tracks = JSON.parse(gallery.dataset.archiveManifest || '[]') as ArchiveTrack[];
const shelves = buildShelves(tracks);
const trackLocations = indexShelfTracks(shelves);
const initialSelection = Number(gallery.dataset.initialSelection);
const initialLocation = trackLocations.get(initialSelection);
if (!Number.isInteger(initialSelection) || !initialLocation) throw new Error('Music archive initial selection is invalid.');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Audio archive canvas context is unavailable.');

let assets: ArchiveAssets | null = null;
let lastRender: RenderResult = { width: 0, height: 0, pixelRatio: 1, hits: [], returnRect: null };
let lastFrameTime = 0;
let isRunning = false;
let inspectionLoading: Promise<void> | null = null;
const initialMotion = new Map<number, CaseMotion>();
const state: StageState = {
  selected: initialSelection, hovered: -1, inspectionProgress: 0, inspectionTarget: 0,
  rowPositions: new Map(), shelfOffset: new Map(), shelfSelection: new Map([[initialLocation.shelf, initialLocation.slot]]), motion: initialMotion,
};

function selectedLocation() {
  const location = trackLocations.get(state.selected);
  if (!location) throw new Error(`Archive selection has no shelf: ${state.selected}`);
  return location;
}
function selectedShelf(): number { return selectedLocation().shelf; }
function selectedSlot(): number { return selectedLocation().slot; }

function setSelection(index: number, publish = false): void {
  if (!Number.isInteger(index) || index < 0 || index >= tracks.length) throw new Error(`Archive selection is outside the library: ${index}`);
  state.selected = index;
  state.shelfSelection.set(selectedShelf(), selectedSlot());
  updateRowTargets();
  scheduleFrame();
  if (publish) document.dispatchEvent(new CustomEvent<SelectionDetail>('rhine-archive:select', { detail: { globalIndex: index } }));
}

function visibleSlots(width: number, height: number): number {
  if (!assets) return SLOTS_VISIBLE_FALLBACK;
  const geometry = getArchiveGeometry({ width, height, meta: assets.cases, shelfCount: shelves.length, selectedShelf: selectedShelf() });
  const { k, origin } = geometry;
  const sprite = assets.cases.array_res[0] * k;
  const { array: meta, axes } = assets.cases;
  let count = 0;
  for (; count < MAX_VISIBLE_SLOT_SEARCH; count++) {
    const x = origin.x + count * axes.y[0] * k - meta.origin[0] * k;
    const y = origin.y + count * axes.y[1] * k - meta.origin[1] * k;
    if (x + sprite * ARRAY_SPRITE_VISIBLE_FRACTION > width || y < ARRAY_TOP_CLEARANCE - sprite * SPRITE_TOP_MARGIN_FACTOR) break;
  }
  return Math.max(SLOTS_VISIBLE_FALLBACK, count);
}

function updateRowTargets(): void {
  const active = selectedShelf();
  const rect = canvas.getBoundingClientRect();
  const geometry = assets ? getArchiveGeometry({ width: rect.width, height: rect.height, meta: assets.cases,
    shelfCount: shelves.length, selectedShelf: active }) : { start: active };
  const slots = visibleSlots(rect.width, rect.height);
  for (const shelf of shelves) {
    let row = state.rowPositions.get(shelf.index);
    if (!row) { row = createSpring(shelf.index - geometry.start, ROW_FREQUENCY); state.rowPositions.set(shelf.index, row); }
    row.target = shelf.index - geometry.start;
    let scroll = state.shelfOffset.get(shelf.index);
    const selection = state.shelfSelection.get(shelf.index) ?? 0;
    const scrollTarget = clamp(selection - SCROLL_SELECTION_LEAD, 0, Math.max(0, shelf.tracks.length - slots));
    if (!scroll) { scroll = createSpring(scrollTarget, ROW_FREQUENCY); state.shelfOffset.set(shelf.index, scroll); }
    scroll.target = scrollTarget;
    const selectedInShelf = shelf.index === active ? selectedSlot() : selection;
    shelf.tracks.forEach((track, slot) => {
      const hoverLocation = trackLocations.get(state.hovered);
      const hoveredSlot = hoverLocation?.shelf === shelf.index ? hoverLocation.slot : -1;
      const target = caseTarget({ slot, selectedSlot: selectedInShelf, active: shelf.index === active, hoverSlot: hoveredSlot });
      let motion = state.motion.get(track.globalIndex);
      if (!motion) {
        motion = { lift: createSpring(target.lift, shelf.index === active ? ACTIVE_CASE_FREQUENCY : IDLE_CASE_FREQUENCY),
          clear: createSpring(target.clear, CLEAR_FREQUENCY), gap: createSpring(target.gap, GAP_FREQUENCY) };
        state.motion.set(track.globalIndex, motion);
      }
      motion.lift.frequency = shelf.index === active ? ACTIVE_CASE_FREQUENCY : IDLE_CASE_FREQUENCY;
      motion.lift.target = target.lift;
      motion.clear.target = target.clear;
      motion.gap.target = target.gap;
    });
  }
}

function render(elapsed: number): boolean {
  if (!assets) return false;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const backingWidth = Math.round(width * pixelRatio);
  const backingHeight = Math.round(height * pixelRatio);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
    updateRowTargets();
  }
  let moving = false;
  state.rowPositions.forEach((spring) => { moving = stepSpring(spring, elapsed) || moving; });
  state.shelfOffset.forEach((spring) => { moving = stepSpring(spring, elapsed) || moving; });
  state.motion.forEach((motion) => {
    moving = stepSpring(motion.lift, elapsed) || moving;
    moving = stepSpring(motion.clear, elapsed) || moving;
    moving = stepSpring(motion.gap, elapsed) || moving;
  });
  moving = stepInspection(elapsed) || moving;
  const scene: RenderState = {
    selected: state.selected, hovered: state.hovered,
    shelfOffset: new Map([...state.shelfOffset].map(([key, value]) => [key, value.x])),
    rowPositions: new Map([...state.rowPositions].map(([key, value]) => [key, value.x])),
    motion: state.motion, inspectionProgress: state.inspectionProgress,
  };
  lastRender = drawArchiveScene(ctx, { width, height, tracks, shelves, assets, state: scene });
  updateInspectionButton();
  return moving;
}

function stepInspection(elapsed: number): boolean {
  const target = state.inspectionTarget > 0 && assets?.inspection.length ? 2 : state.inspectionTarget > 0 ? 1 : 0;
  if (state.inspectionProgress === target) return false;
  const direction = Math.sign(target - state.inspectionProgress);
  const lifting = direction > 0 ? state.inspectionProgress < 1 : state.inspectionProgress <= 1;
  const duration = lifting ? INSPECT_LIFT_SECONDS : INSPECT_TURN_SECONDS;
  const next = state.inspectionProgress + direction * elapsed / duration;
  state.inspectionProgress = direction > 0 ? Math.min(next, target) : Math.max(next, target);
  return true;
}

function tick(now: number): void {
  const elapsed = Math.min(FRAME_LIMIT_SECONDS, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  let moving: boolean;
  try {
    moving = render(elapsed);
  } catch (error: unknown) {
    isRunning = false;
    reportRenderError(error);
    throw error;
  }
  returnButton?.toggleAttribute('hidden', state.inspectionProgress < 1.85);
  if (moving) requestAnimationFrame(tick);
  else isRunning = false;
}

function scheduleFrame(): void {
  if (isRunning) return;
  isRunning = true;
  lastFrameTime = performance.now();
  requestAnimationFrame(tick);
}

async function openInspection(): Promise<void> {
  if (!assets) return;
  state.inspectionTarget = 2;
  if (!inspectionLoading) {
    inspectionLoading = loadInspectionFrames(assets.cases.inspect.length).then((images) => {
      if (!assets) throw new Error('Archive assets were released while inspection frames loaded.');
      assets.inspection = images;
      inspectionLoading = null;
      scheduleFrame();
    });
  }
  scheduleFrame();
}

function closeInspection(): void { state.inspectionTarget = 0; scheduleFrame(); }

function updateInspectionButton(): void {
  if (!returnButton) return;
  const rect = lastRender.returnRect;
  if (!rect) { returnButton.hidden = true; return; }
  returnButton.style.left = `${rect.left}px`;
  returnButton.style.top = `${rect.top}px`;
  returnButton.style.width = `${rect.width}px`;
  returnButton.style.height = `${rect.height}px`;
  returnButton.hidden = false;
}

function pointerPoint(event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function hitAt(point: { x: number; y: number }): number {
  for (let index = lastRender.hits.length - 1; index >= 0; index--) {
    const hit = lastRender.hits[index]!;
    if (isInsidePolygon(point, hit.polygon)) return hit.index;
  }
  return -1;
}

function bindPointer(): void {
  canvas.addEventListener('pointermove', (event) => {
    const hovered = hitAt(pointerPoint(event));
    if (hovered !== state.hovered) { state.hovered = hovered; updateRowTargets(); scheduleFrame(); }
    canvas.style.cursor = hovered >= 0 ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', () => {
    if (state.hovered >= 0) { state.hovered = -1; updateRowTargets(); scheduleFrame(); }
  });
  canvas.addEventListener('click', (event) => {
    if (state.inspectionProgress > 0) return;
    const index = hitAt(pointerPoint(event));
    if (index < 0) return;
    if (index === state.selected) { void openInspection(); return; }
    setSelection(index, true);
  });
  returnButton?.addEventListener('click', closeInspection);
}

function bindKeyboard(): void {
  canvas.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.inspectionProgress > 0) { closeInspection(); event.preventDefault(); return; }
    if (event.key === 'Enter' && state.inspectionProgress === 0) { void openInspection(); event.preventDefault(); return; }
    if (event.key === ' ' && state.inspectionProgress === 0) {
      document.dispatchEvent(new CustomEvent<SelectionDetail>('rhine-archive:play', { detail: { globalIndex: state.selected } }));
      event.preventDefault(); return;
    }
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (step && state.inspectionProgress === 0) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const shelf = shelves[selectedShelf()]!;
        const nextSlot = clamp(selectedSlot() + step, 0, shelf.tracks.length - 1);
        setSelection(shelf.tracks[nextSlot]!.globalIndex, true);
      } else {
        const shelfStep = event.key === 'ArrowLeft' ? 1 : -1;
        const nextShelfIndex = clamp(selectedShelf() + shelfStep, 0, shelves.length - 1);
        const nextShelf = shelves[nextShelfIndex]!;
        const nextSlot = Math.min(selectedSlot(), nextShelf.tracks.length - 1);
        setSelection(nextShelf.tracks[nextSlot]!.globalIndex, true);
      }
      event.preventDefault();
    }
  });
}

function moveSelectedTrack(delta: number): void {
  const shelf = shelves[selectedShelf()];
  if (!shelf) throw new Error(`Archive shelf is missing: ${selectedShelf()}`);
  const nextSlot = clamp(selectedSlot() + delta, 0, shelf.tracks.length - 1);
  const track = shelf.tracks[nextSlot];
  if (!track) throw new Error(`Archive track is missing from slot ${nextSlot + 1}.`);
  setSelection(track.globalIndex, true);
}

function bindWheel(): void {
  canvas.addEventListener('wheel', (event) => {
    if (state.inspectionProgress > 0) return;
    moveSelectedTrack(event.deltaY > 0 ? 1 : -1);
    event.preventDefault();
  }, { passive: false });
}

function bindExternalSelection(): void {
  document.addEventListener('rhine-archive:sync-selection', (event) => {
    const detail = (event as CustomEvent<SelectionDetail>).detail;
    setSelection(detail.globalIndex);
  });
}

async function start(): Promise<void> {
  assets = await loadArchiveAssets();
  updateRowTargets();
  bindPointer(); bindKeyboard(); bindWheel(); bindExternalSelection();
  const observer = new ResizeObserver(() => { updateRowTargets(); scheduleFrame(); });
  observer.observe(canvas);
  scheduleFrame();
  void loadArchiveCovers(tracks, assets, scheduleFrame).catch((error: unknown) => {
    reportRenderError(error);
    throw error;
  });
}

void start().catch((error: unknown) => {
  reportRenderError(error);
});

function reportRenderError(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error('Audio archive rendering failed.', error);
  const panel = page.querySelector<HTMLOutputElement>('#archive-render-error');
  if (!panel) throw new Error(`Audio archive renderer failed: ${message}`);
  panel.textContent = `档案渲染错误\n${message}`;
  panel.hidden = false;
}
