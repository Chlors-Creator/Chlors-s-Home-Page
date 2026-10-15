import {
  CASE_SCALE, ROW_PITCH, SHELF_SLOTS, SLOT_PITCH, clamp, easeInOut, getArchiveGeometry, projectPoint,
  type ArchiveGeometry, type ArchiveTrack, type CaseMeta, type CaseMotion, type Point, type RailMeta, type Shelf,
} from './archive-model';
import { drawCase, drawInspection, type CaseHit, type InspectionReturnRect } from './archive-case-renderer';

const ROOT = '/assets/rhine-audio-archive';
const PIXEL_RATIO_LIMIT = 2;
const SELECTED_CASE_LIFT = 2.2;
const INSPECTION_LIFT_END = 1;
const ARRAY_ROW_TOP_LIMIT = 30;
const ARRAY_ROW_BOTTOM_LIMIT = 60;
const RAIL_ROW_DEPTH = -0.62;
const CASE_ROW_DEPTH = 0.64;
const INSPECTION_DEPTH_WEIGHT = 0.2;
const BACKGROUND = '#0b0b0b';

export interface ArchiveAssets {
  cases: CaseMeta; rail: RailMeta; clear: HTMLImageElement; frost: HTMLImageElement;
  rails: Record<'front' | 'mid' | 'back', HTMLImageElement>; covers: Map<string, HTMLImageElement>; inspection: HTMLImageElement[];
}
export interface RenderState {
  selected: number; hovered: number; shelfOffset: Map<number, number>; rowPositions: Map<number, number>;
  motion: Map<number, CaseMotion>; inspectionProgress: number;
}
export interface RenderResult {
  width: number; height: number; pixelRatio: number; hits: CaseHit[]; returnRect: InspectionReturnRect | null;
}
interface RailOptions { ctx: CanvasRenderingContext2D; assets: ArchiveAssets; type: 'front' | 'mid' | 'back'; point: Point; scale: number; row: number; alpha: number; tint: number }
interface SceneItem {
  close: number; point: Point; rail?: 'front' | 'mid' | 'back'; track?: ArchiveTrack; motion?: CaseMotion; selected?: boolean;
}
interface SceneOptions {
  ctx: CanvasRenderingContext2D; assets: ArchiveAssets; state: RenderState; geometry: ArchiveGeometry;
  selectedShelf: number; width: number; height: number;
}
interface ShelfDrawOptions extends SceneOptions { shelf: Shelf }

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load archive metadata ${url}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export async function loadArchiveAssets(tracks: ArchiveTrack[]): Promise<ArchiveAssets> {
  const [cases, rail, clear, frost, front, mid, back] = await Promise.all([
    readJson<CaseMeta>(`${ROOT}/case/white/case.json`), readJson<RailMeta>(`${ROOT}/rail/rail.json`),
    loadImage(`${ROOT}/case/white/array-clear.png`), loadImage(`${ROOT}/case/white/array-frost.png`),
    loadImage(`${ROOT}/rail/rail-front.png`), loadImage(`${ROOT}/rail/rail-mid.png`), loadImage(`${ROOT}/rail/rail-back.png`),
  ]);
  const covers = new Map(await Promise.all([...new Set(tracks.map((track) => track.cover))]
    .map(async (url) => [url, await loadImage(url)] as const)));
  return { cases, rail, clear, frost, rails: { front, mid, back }, covers, inspection: [] };
}

function rowAlpha(row: number, count: number): number {
  return Math.round(255 * clamp(1 + row, 0, 1) * clamp((count - row) / 0.8, 0, 1));
}

function rowTint(row: number, selectedRow: number, geometry: ArchiveGeometry): number {
  if (!geometry.wide) return Math.round(clamp(0.38 * clamp(row, 0, 1) + 0.14 * Math.max(0, row), 0, 0.8) * 10) / 10;
  const distance = Math.abs(row - selectedRow);
  return Math.round(clamp(0.32 * Math.min(distance, 1) + 0.24 * distance / Math.max(1, geometry.count - 1), 0, 0.6) * 10) / 10;
}

function drawRail(options: RailOptions): void {
  const { ctx, assets, type, point, scale, row, alpha, tint } = options;
  const { rail } = assets;
  const x = point.x - rail.origin[0] * scale; const y = point.y - rail.origin[1] * scale;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.filter = tint ? `saturate(${1 - tint}) brightness(${1 - tint * 0.48})` : 'none';
  ctx.drawImage(assets.rails[type], x, y, rail.res[0] * scale, rail.res[1] * scale);
  ctx.restore();
  if (type === 'front' && tint < 0.5) drawRailLabel({ ctx, meta: rail, x, y, scale, row });
}

interface RailLabelOptions { ctx: CanvasRenderingContext2D; meta: RailMeta; x: number; y: number; scale: number; row: number }

function drawRailLabel({ ctx, meta, x, y, scale, row }: RailLabelOptions): void {
  const [a, b, , d] = meta.label;
  if (!a || !b || !d) throw new Error('Archive rail label quad is incomplete.');
  ctx.save();
  ctx.transform((b[0]! - a[0]!) * scale / 100, (b[1]! - a[1]!) * scale / 100,
    (d[0]! - a[0]!) * scale / 20, (d[1]! - a[1]!) * scale / 20, x + a[0]! * scale, y + a[1]! * scale);
  ctx.fillStyle = '#1b1c18'; ctx.font = '600 12px "Archive Mono", monospace';
  ctx.fillText(`ROW ${String(row + 1).padStart(2, '0')}`, 6, 14);
  ctx.restore();
}

function makeShelfItems(options: ShelfDrawOptions): SceneItem[] {
  const { assets, shelf, state, geometry } = options;
  const row = state.rowPositions.get(shelf.index) ?? shelf.index - geometry.start;
  const scroll = state.shelfOffset.get(shelf.index) ?? 0;
  const rowX = -row * ROW_PITCH;
  const items = makeRailItems({ ...options, row, rowX, scroll });
  shelf.tracks.forEach((track, slot) => {
    const motion = state.motion.get(track.globalIndex);
    if (!motion) throw new Error(`Archive motion state is missing for item ${track.globalIndex}.`);
    const selected = track.globalIndex === state.selected;
    const slotY = (slot - scroll) * SLOT_PITCH + motion.gap.x;
    const lift = motion.lift.x + (selected ? selectedCaseLift(state.inspectionProgress) : 0);
    const point = projectPoint({ meta: assets.cases, origin: geometry.origin, k: geometry.k,
      x: rowX, y: slotY, z: lift, rowScaleX: geometry.scaleX, rowScaleY: geometry.scaleY });
    items.push({ close: RAIL_ROW_DEPTH * slotY + CASE_ROW_DEPTH * lift * INSPECTION_DEPTH_WEIGHT, track, motion, selected, point });
  });
  return items.sort((left, right) => left.close - right.close);
}

interface RailItemsOptions extends ShelfDrawOptions { row: number; rowX: number; scroll: number }

function makeRailItems(options: RailItemsOptions): SceneItem[] {
  const { assets, shelf, state, geometry, row, rowX, scroll } = options;
  const items: SceneItem[] = [];
  for (let slot = -1; slot <= shelf.tracks.length; slot++) {
    const y = (slot - scroll) * SLOT_PITCH;
    if (y < -ARRAY_ROW_TOP_LIMIT || y > ARRAY_ROW_BOTTOM_LIMIT) continue;
    const point = projectPoint({ meta: assets.cases, origin: geometry.origin, k: geometry.k,
      x: rowX, y, z: 0, rowScaleX: geometry.scaleX, rowScaleY: geometry.scaleY });
    items.push({ close: RAIL_ROW_DEPTH * y, rail: slot < 0 ? 'front' : slot >= shelf.tracks.length ? 'back' : 'mid', point });
  }
  return items;
}

function drawShelf(options: ShelfDrawOptions): CaseHit[] {
  const { ctx, assets, shelf, state, geometry, selectedShelf } = options;
  const row = state.rowPositions.get(shelf.index) ?? shelf.index - geometry.start;
  if (row < -1 || row > geometry.count) return [];
  const active = shelf.index === selectedShelf;
  const tint = rowTint(row, selectedShelf - geometry.start, geometry);
  const alpha = rowAlpha(row, geometry.count) / 255;
  const hits: CaseHit[] = [];
  for (const item of makeShelfItems(options)) {
    if (item.rail) {
      drawRail({ ctx, assets, type: item.rail, point: item.point, scale: geometry.k, row: shelf.index, alpha, tint });
      continue;
    }
    const track = item.track!; const motion = item.motion!;
    if (item.selected && state.inspectionProgress > INSPECTION_LIFT_END) continue;
    const hit = drawCase({ ctx, assets, track, screen: item.point, scale: geometry.k, motion,
      selected: Boolean(item.selected), active, hovered: track.globalIndex === state.hovered,
      alpha, tint: active ? 0 : tint, inspectionProgress: state.inspectionProgress });
    if (active) hits.push(hit);
  }
  return hits;
}

function selectedCaseLift(progress: number): number {
  return progress < INSPECTION_LIFT_END ? SELECTED_CASE_LIFT * easeInOut(progress) : SELECTED_CASE_LIFT;
}

function drawInspectionAtSelection(options: ShelfDrawOptions & { width: number; height: number }): InspectionReturnRect | null {
  const { ctx, assets, shelf, state, geometry, width, height } = options;
  if (state.inspectionProgress <= INSPECTION_LIFT_END) return null;
  const slot = state.selected % SHELF_SLOTS;
  const scroll = state.shelfOffset.get(shelf.index) ?? 0;
  const row = state.rowPositions.get(shelf.index) ?? shelf.index - geometry.start;
  const point = projectPoint({ meta: assets.cases, origin: geometry.origin, k: geometry.k,
    x: -row * ROW_PITCH, y: (slot - scroll) * SLOT_PITCH, z: 0,
    rowScaleX: geometry.scaleX, rowScaleY: geometry.scaleY });
  const from = { x: point.x + (assets.cases.array.center[0] - assets.cases.array.origin[0]) * geometry.k,
    y: point.y + (assets.cases.array.center[1] - assets.cases.array.origin[1]) * geometry.k };
  const track = shelf.tracks[slot];
  if (!track) throw new Error(`Selected track is missing from shelf ${shelf.index + 1}.`);
  return drawInspection({ ctx, assets, track, from, width, height, progress: state.inspectionProgress, scale: geometry.k });
}

export function drawArchiveScene(
  ctx: CanvasRenderingContext2D,
  options: { width: number; height: number; tracks: ArchiveTrack[]; shelves: Shelf[]; assets: ArchiveAssets; state: RenderState },
): RenderResult {
  const { width, height, tracks, shelves, assets, state } = options;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_LIMIT);
  const selectedShelf = Math.floor(state.selected / SHELF_SLOTS);
  const geometry = getArchiveGeometry({ width, height, meta: assets.cases, shelfCount: shelves.length, selectedShelf });
  const selected = tracks[state.selected];
  if (!selected) throw new Error(`Archive selection is outside the library: ${state.selected}`);
  ctx.save(); ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.fillStyle = BACKGROUND; ctx.fillRect(0, 0, width, height);
  const hits = drawShelves({ ctx, assets, shelves, state, geometry, selectedShelf, width, height });
  const activeShelf = shelves[selectedShelf];
  const returnRect = activeShelf ? drawInspectionAtSelection({ ctx, assets, shelf: activeShelf, state, geometry, width, height }) : null;
  ctx.restore();
  return { width, height, pixelRatio, hits, returnRect };
}

function drawShelves(options: SceneOptions & { shelves: Shelf[] }): CaseHit[] {
  const { shelves, state } = options;
  const ordered = [...shelves].sort((left, right) => {
    const leftRow = state.rowPositions.get(left.index) ?? left.index - options.geometry.start;
    const rightRow = state.rowPositions.get(right.index) ?? right.index - options.geometry.start;
    return rightRow - leftRow;
  });
  return ordered.flatMap((shelf) => drawShelf({ ...options, shelf }));
}

export async function loadInspectionFrames(count: number): Promise<HTMLImageElement[]> {
  return Promise.all(Array.from({ length: count }, (_, index) => loadImage(`${ROOT}/case/white/inspect-${String(index).padStart(2, '0')}.png`)));
}
