import { INSPECT_ZOOM, clamp, type ArchiveTrack, type CaseMeta, type CaseMotion, type Point } from './archive-model';
import type { ArchiveAssets } from './archive-renderer';

const INSPECTION_TITLE = 'INSPECTION';
const RETURN_LABEL = '←  RETURN TO ARCHIVE';
const RETURN_BUTTON_HEIGHT = 26;
const INSPECTION_TEXT_GAP = 16;
const INSPECTION_FIT_MARGIN = 190;

interface QuadOptions { ctx: CanvasRenderingContext2D; image: HTMLImageElement; quad: number[][]; x: number; y: number; scale: number; alpha?: number }
interface SpineOptions { ctx: CanvasRenderingContext2D; quad: number[][]; x: number; y: number; scale: number; index: number }
interface TitleStripOptions { ctx: CanvasRenderingContext2D; meta: CaseMeta; screen: Point; scale: number; title: string; alpha: number }
interface SelectedPlateOptions { ctx: CanvasRenderingContext2D; meta: CaseMeta; x: number; y: number; scale: number; index: number }
interface OutlineOptions { ctx: CanvasRenderingContext2D; polygon: Point[]; alpha: number }
interface CaseOptions {
  ctx: CanvasRenderingContext2D; assets: ArchiveAssets; track: ArchiveTrack; screen: Point; scale: number;
  motion: CaseMotion; selected: boolean; active: boolean; hovered: boolean; alpha: number; tint: number; inspectionProgress: number;
}
interface InspectionOptions {
  ctx: CanvasRenderingContext2D; assets: ArchiveAssets; track: ArchiveTrack; from: Point; width: number;
  height: number; progress: number; scale: number;
}
export interface InspectionReturnRect { left: number; top: number; width: number; height: number }
export interface CaseHit { index: number; polygon: Point[] }

function drawImageQuad({ ctx, image, quad, x, y, scale, alpha = 1 }: QuadOptions): void {
  const [a, b, , d] = quad;
  if (!a || !b || !d) throw new Error('Archive case quad is incomplete.');
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.transform((b[0]! - a[0]!) * scale / image.width, (b[1]! - a[1]!) * scale / image.width,
    (d[0]! - a[0]!) * scale / image.height, (d[1]! - a[1]!) * scale / image.height,
    x + a[0]! * scale, y + a[1]! * scale);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

function drawSpine({ ctx, quad, x, y, scale, index }: SpineOptions): void {
  const [a, b, , d] = quad;
  if (!a || !b || !d) throw new Error('Archive spine-label quad is incomplete.');
  ctx.save();
  ctx.transform((b[0]! - a[0]!) * scale / 100, (b[1]! - a[1]!) * scale / 100,
    (d[0]! - a[0]!) * scale / 60, (d[1]! - a[1]!) * scale / 60, x + a[0]! * scale, y + a[1]! * scale);
  ctx.fillStyle = '#1b1c18';
  ctx.font = '600 15px "Archive Mono", monospace';
  ctx.fillText('ARC', 8, 18);
  ctx.font = '500 22px "Archive Mono", monospace';
  ctx.fillText(String(index + 1).padStart(4, '0'), 8, 50);
  ctx.restore();
}

function casePolygon(meta: CaseMeta, topLeft: Point, scale: number): Point[] {
  const at = (x: number, y: number, z: number): Point => ({
    x: topLeft.x + (meta.array.origin[0] + x * meta.axes.x[0] + y * meta.axes.y[0] + z * meta.axes.z[0]) * scale,
    y: topLeft.y + (meta.array.origin[1] + x * meta.axes.x[1] + y * meta.axes.y[1] + z * meta.axes.z[1]) * scale,
  });
  return [at(-2, -0.23, 0), at(2, -0.23, 0), at(2, -0.23, 3.5), at(2, 0.23, 3.5), at(-2, 0.23, 3.5), at(-2, -0.23, 3.5)];
}

function drawTitleStrip({ ctx, meta, screen, scale, title, alpha }: TitleStripOptions): void {
  const [ax, ay, az] = [meta.axes.x, meta.axes.y, meta.axes.z];
  const at = (x: number, y: number): Point => ({
    x: screen.x + (x * ax[0] + y * ay[0] + 3.5 * az[0]) * scale,
    y: screen.y + (x * ax[1] + y * ay[1] + 3.5 * az[1]) * scale,
  });
  const p0 = at(-1.8, 0.15); const p1 = at(1.1, 0.15); const p3 = at(-1.8, -0.15);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.transform((p1.x - p0.x) / 290, (p1.y - p0.y) / 290, (p3.x - p0.x) / 30, (p3.y - p0.y) / 30, p0.x, p0.y);
  ctx.fillStyle = '#e9e6dd'; ctx.fillRect(0, 0, 290, 30);
  ctx.fillStyle = '#ff7a01'; ctx.fillRect(0, 0, 4, 30);
  ctx.fillStyle = '#1b1c18'; ctx.font = '600 17px "Archive Mono", monospace'; ctx.textBaseline = 'middle';
  ctx.fillText(title.toUpperCase(), 12, 15, 270);
  ctx.restore();
}

function drawSelectedPlate({ ctx, meta, x, y, scale, index }: SelectedPlateOptions): void {
  const point = meta.array.cover[1]!;
  const x1 = x + point[0]! * scale + 4; const y1 = y + point[1]! * scale - 4;
  const labelX = x1 + 26; const labelY = y1 - 30;
  const text = `ARC-${String(index + 1).padStart(4, '0')}`;
  ctx.strokeStyle = '#f2f0ea'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(labelX, labelY); ctx.lineTo(labelX + 60, labelY); ctx.stroke();
  ctx.font = '600 9px "Archive Mono", monospace';
  ctx.fillStyle = '#f2f0ea'; ctx.fillRect(labelX + 60, labelY - 9, ctx.measureText(text).width + 16, 18);
  ctx.fillStyle = '#0b0b0b'; ctx.fillText(text, labelX + 68, labelY + 3);
  meta.array.cover.forEach(([px, py]) => ctx.fillRect(x + px! * scale - 3, y + py! * scale - 3, 6, 6));
}

export function drawCase(options: CaseOptions): CaseHit {
  const { ctx, assets, track, screen, scale, motion, selected, active, hovered, alpha, tint, inspectionProgress } = options;
  const { cases: meta } = assets;
  const x = screen.x - meta.array.origin[0] * scale; const y = screen.y - meta.array.origin[1] * scale;
  const size = meta.array_res[0] * scale; const cover = assets.covers.get(track.cover);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.filter = tint ? `saturate(${1 - tint}) brightness(${1 - tint * 0.48})` : 'none';
  if (cover) {
    drawImageQuad({ ctx, image: cover, quad: meta.array.cover, x, y, scale, alpha: 1 - motion.clear.x });
    if (selected && motion.clear.x > 0.01) drawImageQuad({ ctx, image: cover, quad: meta.array.cover, x, y, scale, alpha: motion.clear.x });
  }
  ctx.globalAlpha = alpha * (1 - clamp(motion.clear.x, 0, 1));
  ctx.drawImage(assets.frost, x, y, size, size);
  ctx.globalAlpha = alpha * clamp(motion.clear.x, 0, 1);
  ctx.drawImage(assets.clear, x, y, size, size);
  ctx.restore();
  if (tint < 0.5) drawTitleStrip({ ctx, meta, screen, scale, title: track.title, alpha: alpha * (1 - tint) });
  if (active && tint === 0) drawSpine({ ctx, quad: meta.array.label, x, y, scale, index: track.globalIndex });
  if (selected && motion.clear.x > 0.6 && inspectionProgress === 0)
    drawSelectedPlate({ ctx, meta, x, y, scale, index: track.globalIndex });
  const polygon = casePolygon(meta, { x, y }, scale);
  if (hovered) drawOutline({ ctx, polygon, alpha });
  return { index: track.globalIndex, polygon };
}

function drawOutline({ ctx, polygon, alpha }: OutlineOptions): void {
  const first = polygon[0];
  if (!first) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = '#ff7a01'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(first.x, first.y);
  polygon.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath(); ctx.stroke(); ctx.restore();
}

export function drawInspection(options: InspectionOptions): InspectionReturnRect | null {
  const { ctx, assets, track, from, width, height, progress, scale } = options;
  const e = easeInspection(progress - 1);
  ctx.fillStyle = `rgba(11,11,11,${0.82 * e})`; ctx.fillRect(0, 0, width, height);
  if (!assets.inspection.length) return null;
  const frameData = inspectionFrame({ meta: assets.cases, images: assets.inspection, progress: e, arrayScale: scale, width, height });
  const center = { x: from.x + (width * 0.49 - from.x) * e, y: from.y + (height * 0.5 - from.y) * e };
  const x = center.x - frameData.current.center[0] * frameData.scale;
  const y = center.y - frameData.current.center[1] * frameData.scale;
  const cover = assets.covers.get(track.cover);
  drawInspectionArtwork({ ctx, assets, track, cover, frameData, x, y });
  return drawInspectionLabels({ ctx, track, frameData, x, y, e });
}

interface InspectionFrameData { current: CaseMeta['inspect'][number]; next: CaseMeta['inspect'][number]; index: number; blend: number; scale: number; cover: number[][]; label: number[][] }
interface InspectionFrameOptions { meta: CaseMeta; images: HTMLImageElement[]; progress: number; arrayScale: number; width: number; height: number }

function inspectionFrame({ meta, images, progress, arrayScale, width, height }: InspectionFrameOptions): InspectionFrameData {
  const lastFrame = meta.inspect.at(-1);
  if (!lastFrame) throw new Error('Archive inspection metadata is empty.');
  const lastCrop = lastFrame.crop;
  const fit = Math.min(width * 0.9 / lastCrop[2]!, (height - INSPECTION_FIT_MARGIN) / lastCrop[3]!);
  const initialScale = arrayScale * meta.array_ppu / meta.inspect_ppu;
  const endScale = Math.max(initialScale, Math.min(initialScale * INSPECT_ZOOM, fit));
  const at = progress * (images.length - 1);
  const index = Math.min(images.length - 2, Math.floor(at));
  const current = meta.inspect[index]; const next = meta.inspect[index + 1];
  if (!current || !next) throw new Error(`Archive inspection metadata is missing frame ${index}.`);
  const blend = clamp(at - index, 0, 1);
  const scale = initialScale + (endScale - initialScale) * progress;
  return { current, next, index, blend, scale, cover: interpolateQuad(current.cover, next.cover, blend), label: interpolateQuad(current.label, next.label, blend) };
}

function interpolateQuad(from: number[][], to: number[][], progress: number): number[][] {
  return from.map((point, index) => [
    point[0]! + (to[index]![0]! - point[0]!) * progress,
    point[1]! + (to[index]![1]! - point[1]!) * progress,
  ]);
}

interface InspectionArtworkOptions {
  ctx: CanvasRenderingContext2D; assets: ArchiveAssets; track: ArchiveTrack; cover: HTMLImageElement | undefined;
  frameData: InspectionFrameData; x: number; y: number;
}

function drawInspectionArtwork(options: InspectionArtworkOptions): void {
  const { ctx, assets, track, cover, frameData, x, y } = options;
  const { current, next, index, blend, scale } = frameData;
  if (cover) drawImageQuad({ ctx, image: cover, quad: frameData.cover, x, y, scale });
  else fillCoverWell({ ctx, quad: frameData.cover, x, y, scale });
  drawFrame({ ctx, image: assets.inspection[index]!, crop: current.crop, x, y, scale, alpha: 1 });
  drawFrame({ ctx, image: assets.inspection[index + 1]!, crop: next.crop, x, y, scale, alpha: blend });
  drawSpine({ ctx, quad: frameData.label, x, y, scale, index: track.globalIndex });
}

function fillCoverWell(options: { ctx: CanvasRenderingContext2D; quad: number[][]; x: number; y: number; scale: number }): void {
  const { ctx, quad, x, y, scale } = options;
  const [first, ...rest] = quad;
  if (!first) throw new Error('Inspection cover geometry is empty.');
  ctx.save(); ctx.fillStyle = '#898983'; ctx.beginPath();
  ctx.moveTo(x + first[0]! * scale, y + first[1]! * scale);
  rest.forEach(([px, py]) => ctx.lineTo(x + px! * scale, y + py! * scale));
  ctx.closePath(); ctx.fill(); ctx.restore();
}

interface InspectionLabelOptions {
  ctx: CanvasRenderingContext2D; track: ArchiveTrack; frameData: InspectionFrameData; x: number; y: number; e: number;
}

function drawInspectionLabels(options: InspectionLabelOptions): InspectionReturnRect | null {
  const { ctx, track, frameData, x, y, e } = options;
  if (e <= 0.85) return null;
  const alpha = (e - 0.85) / 0.15;
  const quad = frameData.cover;
  drawInspectCorners({ ctx, quad, x, y, scale: frameData.scale, alpha });
  if (alpha <= 0.5) return null;
  const crop = frameData.next.crop;
  const left = x + crop[0]! * frameData.scale;
  const top = y + crop[1]! * frameData.scale;
  const bottom = y + (crop[1]! + crop[3]!) * frameData.scale;
  drawInspectionCaptions({ ctx, track, left, top });
  return inspectionReturnRect({ ctx, left, bottom });
}

interface InspectCornerOptions { ctx: CanvasRenderingContext2D; quad: number[][]; x: number; y: number; scale: number; alpha: number }

function drawInspectCorners({ ctx, quad, x, y, scale, alpha }: InspectCornerOptions): void {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#ff7a01';
  quad.forEach(([px, py]) => ctx.fillRect(x + px! * scale - 3, y + py! * scale - 3, 6, 6));
  ctx.restore();
}

interface InspectionCaptionOptions { ctx: CanvasRenderingContext2D; track: ArchiveTrack; left: number; top: number }

function drawInspectionCaptions({ ctx, track, left, top }: InspectionCaptionOptions): void {
  const captionY = top - 16;
  ctx.fillStyle = '#f2f0ea'; ctx.font = '600 10px "Archive Mono", monospace';
  ctx.fillText(`${INSPECTION_TITLE} · ARC-${String(track.globalIndex + 1).padStart(4, '0')}`, left, captionY - 12);
  ctx.fillStyle = '#8c8b88'; ctx.font = '500 9px "Archive Mono", monospace';
  ctx.fillText(`AUDIO · ${track.folderTitle.toUpperCase()}`, left, captionY);
}

function inspectionReturnRect({ ctx, left, bottom }: { ctx: CanvasRenderingContext2D; left: number; bottom: number }): InspectionReturnRect {
  ctx.font = '600 11px "Archive Mono", monospace';
  const width = ctx.measureText(RETURN_LABEL).width + 22;
  return { left, top: bottom + INSPECTION_TEXT_GAP, width, height: RETURN_BUTTON_HEIGHT };
}

interface DrawFrameOptions { ctx: CanvasRenderingContext2D; image: HTMLImageElement; crop: number[]; x: number; y: number; scale: number; alpha: number }

function drawFrame({ ctx, image, crop, x, y, scale, alpha }: DrawFrameOptions): void {
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.drawImage(image, 0, 0, image.width, image.height,
    x + crop[0]! * scale, y + crop[1]! * scale, crop[2]! * scale, crop[3]! * scale);
  ctx.restore();
}

function easeInspection(value: number): number {
  const x = clamp(value, 0, 1);
  return x < 0.5 ? 4 * x ** 3 : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
