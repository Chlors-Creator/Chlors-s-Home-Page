import { ROW_PITCH, SLOT_PITCH, clamp, projectPoint, type Point, type Shelf } from './archive-model';
import type { ArchiveAssets, RenderState } from './archive-renderer';

interface FloorOptions {
  assets: ArchiveAssets; shelves: Shelf[]; state: RenderState; origin: Point; width: number; k: number; scaleX: number; scaleY: number;
}
interface ShelfShadowOptions extends FloorOptions { shelf: Shelf; row: number; scroll: number; alpha: number; far: boolean }

export function drawArchiveFloor(ctx: CanvasRenderingContext2D, options: FloorOptions): void {
  const { assets, origin, k } = options;
  const { plate } = assets.floor;
  ctx.drawImage(assets.plate, origin.x - plate.origin[0] * k, origin.y - plate.origin[1] * k,
    plate.res[0] * k, plate.res[1] * k);
  drawShelfShadows(ctx, options);
}

function drawShelfShadows(ctx: CanvasRenderingContext2D, options: FloorOptions): void {
  const { shelves, state } = options;
  for (const shelf of shelves) {
    const row = state.rowPositions.get(shelf.index) ?? shelf.index;
    if (row < -1 || row > 4) continue;
    const scroll = state.shelfOffset.get(shelf.index) ?? 0;
    const alpha = clamp(1 + row, 0, 1) * clamp((4 - row) / 0.8, 0, 1);
    drawShelfShadow(ctx, { ...options, shelf, row, scroll, alpha, far: false });
    const farAlpha = alpha * clamp(1 - row, 0, 1);
    if (farAlpha > 0) drawShelfShadow(ctx, { ...options, shelf, row, scroll, alpha: farAlpha, far: true });
  }
  ctx.globalAlpha = 1;
}

function drawShelfShadow(ctx: CanvasRenderingContext2D, options: ShelfShadowOptions): void {
  const { assets, shelf, row, scroll, alpha, far, origin, k, width, scaleX, scaleY } = options;
  const shade = assets.floor.shade;
  const rowX = -row * ROW_PITCH;
  const images = far ? assets.farShades : assets.shades;
  drawShelfEnds(ctx, { assets, shelf, origin, width, k, rowX, scroll, alpha, scaleX, scaleY, images });
  stretchShelfShade(ctx, { assets, image: images.mid, shelf, origin, k, rowX, scroll, alpha, scaleX, scaleY });
}

interface ShelfEndOptions {
  assets: ArchiveAssets; shelf: Shelf; origin: Point; width: number; k: number; rowX: number; scroll: number;
  alpha: number; scaleX: number; scaleY: number; images: ArchiveAssets['shades'];
}

function drawShelfEnds(ctx: CanvasRenderingContext2D, options: ShelfEndOptions): void {
  const { assets, shelf, origin, width, k, rowX, scroll, alpha, scaleX, scaleY, images } = options;
  const shade = assets.floor.shade;
  for (const slot of [-1, shelf.tracks.length]) {
    const point = projectPoint({ meta: assets.cases, origin, k, x: rowX, y: (slot - scroll) * SLOT_PITCH, z: 0, rowScaleX: scaleX, rowScaleY: scaleY });
    const image = images[slot < 0 ? 'front' : 'back'];
    const x = point.x - shade.origin[0] * k;
    if (x > width || x + shade.res[0] * k < 0) continue;
    ctx.globalAlpha = alpha;
    ctx.drawImage(image, x, point.y - shade.origin[1] * k, shade.res[0] * k, shade.res[1] * k);
  }
  ctx.globalAlpha = 1;
}

interface StretchedShadeOptions {
  assets: ArchiveAssets; image: HTMLImageElement; shelf: Shelf; origin: Point; k: number; rowX: number; scroll: number;
  alpha: number; scaleX: number; scaleY: number;
}

function stretchShelfShade(ctx: CanvasRenderingContext2D, options: StretchedShadeOptions): void {
  const { assets, image, shelf, origin, k, rowX, scroll, alpha, scaleX, scaleY } = options;
  const { cases: meta, floor } = assets;
  const count = shelf.tracks.length;
  if (!count) return;
  const [ax, ay] = [meta.axes.x, meta.axes.y];
  const determinant = ax[0] * ay[1] - ay[0] * ax[1];
  const factor = (count - 1) / determinant;
  const matrix = [1 - factor * ay[0] * ax[1], factor * ay[0] * ax[0], -factor * ay[1] * ax[1], 1 + factor * ay[1] * ax[0]];
  const center = projectPoint({ meta, origin, k, x: rowX, y: ((count - 1) / 2 - scroll) * SLOT_PITCH, z: 0, rowScaleX: scaleX, rowScaleY: scaleY });
  const z = -floor.floor_z;
  const zx = z * meta.axes.z[0] - floor.shade.origin[0];
  const zy = z * meta.axes.z[1] - floor.shade.origin[1];
  const x = center.x + k * (matrix[0]! * zx + matrix[1]! * zy - z * meta.axes.z[0]);
  const y = center.y + k * (matrix[2]! * zx + matrix[3]! * zy - z * meta.axes.z[1]);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.transform(k * matrix[0]!, k * matrix[2]!, k * matrix[1]!, k * matrix[3]!, x, y);
  ctx.drawImage(image, 0, 0, floor.shade.res[0], floor.shade.res[1]);
  ctx.restore();
}
