import { ROW_PITCH, SHELF_SLOTS, SLOT_PITCH, clamp, projectPoint, type ArchiveGeometry, type CaseMeta, type Point, type Shelf } from './archive-model';

const FLOOR_ROOT = '/assets/rhine-audio-archive/floor/deck-dark';
const FLOOR_PARTS = ['front', 'mid', 'back'] as const;
const FLOOR_DISTANCES = ['', '-far'] as const;
const FLOOR_LAYERS = ['shade', 'glow'] as const;

interface SurfaceMeta { res: [number, number]; origin: [number, number] }
export interface ArchiveFloorMeta { floor_z: number; plate: SurfaceMeta; shade: SurfaceMeta; tint?: number; glow?: boolean }
export type FloorSegment = (typeof FLOOR_PARTS)[number];
export type FloorDistance = (typeof FLOOR_DISTANCES)[number];
export type FloorLayer = (typeof FLOOR_LAYERS)[number];
export type FloorSpriteName = `${FloorLayer}-${FloorSegment}${FloorDistance}`;
export interface ArchiveFloorAssets { meta: ArchiveFloorMeta; plate: HTMLImageElement; sprites: Record<FloorSpriteName, HTMLImageElement> }
export interface FloorSceneState { rowPositions: Map<number, number>; shelfOffset: Map<number, number> }
interface FloorSceneOptions { ctx: CanvasRenderingContext2D; assets: ArchiveFloorAssets; cases: CaseMeta; geometry: ArchiveGeometry; shelves: Shelf[]; state: FloorSceneState; selectedShelf: number }
interface FloorRowOptions extends Omit<FloorSceneOptions, 'shelves'> { shelf: Shelf }

async function readMeta(): Promise<ArchiveFloorMeta> {
  const response = await fetch(`${FLOOR_ROOT}/floor.json`);
  if (!response.ok) throw new Error(`Unable to load archive floor metadata: ${response.status}`);
  const contentType = response.headers.get('content-type') ?? 'unknown content type';
  if (!contentType.includes('json')) {
    throw new Error(`Archive floor metadata ${FLOOR_ROOT}/floor.json returned ${contentType} (HTTP ${response.status}); expected JSON.`);
  }
  return response.json() as Promise<ArchiveFloorMeta>;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

async function loadFloorSprites(meta: ArchiveFloorMeta): Promise<Record<FloorSpriteName, HTMLImageElement>> {
  const layers: readonly FloorLayer[] = meta.glow === false ? ['shade'] : FLOOR_LAYERS;
  const names = layers.flatMap((layer) => FLOOR_PARTS.flatMap((part) => FLOOR_DISTANCES.map((distance) => `${layer}-${part}${distance}` as FloorSpriteName)));
  const loaded = await Promise.all(names.map(async (name) => [name, await loadImage(`${FLOOR_ROOT}/${name}.png`)] as const));
  return Object.fromEntries(loaded) as Record<FloorSpriteName, HTMLImageElement>;
}

export async function loadArchiveFloor(): Promise<ArchiveFloorAssets> {
  const meta = await readMeta();
  const [plate, sprites] = await Promise.all([
    loadImage(`${FLOOR_ROOT}/plate.jpg`), loadFloorSprites(meta),
  ]);
  return { meta, plate, sprites };
}

export function drawArchiveFloor(options: FloorSceneOptions): void {
  const { ctx, assets, cases, geometry, shelves, state, selectedShelf } = options;
  drawPlate(ctx, assets, geometry);
  for (const shelf of shelves) {
    const rowOptions = { ctx, assets, cases, geometry, shelf, state, selectedShelf };
    drawShelfShade(rowOptions, 'shade');
    if (assets.meta.glow !== false) drawShelfShade(rowOptions, 'glow');
  }
}

function drawPlate(ctx: CanvasRenderingContext2D, assets: ArchiveFloorAssets, geometry: ArchiveGeometry): void {
  const { origin, k } = geometry;
  const { res, origin: plateOrigin } = assets.meta.plate;
  ctx.drawImage(assets.plate, origin.x - plateOrigin[0] * k, origin.y - plateOrigin[1] * k, res[0] * k, res[1] * k);
}

function drawShelfShade(options: FloorRowOptions, layer: FloorLayer): void {
  const { ctx, assets, cases, geometry, shelf, state, selectedShelf } = options;
  const row = state.rowPositions.get(shelf.index) ?? shelf.index - geometry.start;
  if (row < -1 || row > geometry.count) return;
  const tint = rowTint(row, selectedShelf - geometry.start, geometry, assets.meta.tint ?? 1);
  const baseAlpha = Math.round(rowAlpha(row, geometry.count) * (1 - tint));
  if (baseAlpha <= 0) return;
  const scroll = state.shelfOffset.get(shelf.index) ?? 0;
  for (const distance of FLOOR_DISTANCES) {
    const alpha = Math.round(baseAlpha * (distance ? clamp(1 - row, 0, 1) : 1));
    if (alpha <= 0) continue;
    drawShelfEnds({ ...options, row, scroll, layer, distance, alpha });
    drawShelfMiddle({ ...options, row, scroll, layer, distance, alpha });
  }
}

interface FloorPieceOptions extends FloorRowOptions { row: number; scroll: number; layer: FloorLayer; distance: FloorDistance; alpha: number }

function drawShelfEnds(options: FloorPieceOptions): void {
  const { ctx, assets, cases, geometry, row, scroll, layer, distance, alpha } = options;
  for (const end of ['front', 'back'] as const) {
    const slot = end === 'front' ? -1 : SHELF_SLOTS;
    const point = rowPoint(cases, geometry, row, (slot - scroll) * SLOT_PITCH);
    drawFloorSprite(ctx, assets, `${layer}-${end}${distance}`, point, geometry.k, alpha);
  }
}

function drawShelfMiddle(options: FloorPieceOptions): void {
  const { ctx, assets, cases, geometry, row, scroll, layer, distance, alpha } = options;
  const { axes } = cases;
  const determinant = axes.x[0] * axes.y[1] - axes.y[0] * axes.x[1];
  const stretch = (SHELF_SLOTS - 1) / determinant;
  const a = 1 - stretch * axes.y[0] * axes.x[1];
  const b = -stretch * axes.y[1] * axes.x[1];
  const c = stretch * axes.y[0] * axes.x[0];
  const d = 1 + stretch * axes.y[1] * axes.x[0];
  const center = rowPoint(cases, geometry, row, ((SHELF_SLOTS - 1) / 2 - scroll) * SLOT_PITCH);
  const { res, origin } = assets.meta.shade;
  const z = -assets.meta.floor_z;
  const shiftX = z * axes.z[0] - origin[0];
  const shiftY = z * axes.z[1] - origin[1];
  const x = center.x + geometry.k * (a * shiftX + c * shiftY - z * axes.z[0]);
  const y = center.y + geometry.k * (b * shiftX + d * shiftY - z * axes.z[1]);
  const image = assets.sprites[`${layer}-mid${distance}`];
  ctx.save();
  ctx.globalAlpha = alpha / 255;
  ctx.transform(geometry.k * a, geometry.k * b, geometry.k * c, geometry.k * d, x, y);
  ctx.drawImage(image, 0, 0, res[0], res[1], 0, 0, image.width, image.height);
  ctx.restore();
}

function rowPoint(cases: CaseMeta, geometry: ArchiveGeometry, row: number, slot: number): Point {
  return projectPoint({ meta: cases, origin: geometry.origin, k: geometry.k, x: -row * ROW_PITCH,
    y: slot, z: 0, rowScaleX: geometry.scaleX, rowScaleY: geometry.scaleY });
}

function drawFloorSprite(ctx: CanvasRenderingContext2D, assets: ArchiveFloorAssets, name: FloorSpriteName, point: Point, scale: number, alpha: number): void {
  const { res, origin } = assets.meta.shade;
  const image = assets.sprites[name];
  ctx.save();
  ctx.globalAlpha = alpha / 255;
  ctx.drawImage(image, point.x - origin[0] * scale, point.y - origin[1] * scale, res[0] * scale, res[1] * scale);
  ctx.restore();
}

function rowAlpha(row: number, count: number): number {
  return Math.round(255 * clamp(1 + row, 0, 1) * clamp((count - row) / 0.8, 0, 1));
}

function rowTint(row: number, selectedRow: number, geometry: ArchiveGeometry, tint: number): number {
  if (!geometry.wide) return Math.round(clamp(0.38 * clamp(row, 0, 1) + 0.14 * Math.max(0, row), 0, 0.8) * tint * 10) / 10;
  const distance = Math.abs(row - selectedRow);
  return Math.round(clamp(0.32 * Math.min(distance, 1) + 0.24 * distance / Math.max(1, geometry.count - 1), 0, 0.6) * tint * 10) / 10;
}
