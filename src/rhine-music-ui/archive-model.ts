export const SHELF_SLOTS = 20;
export const CASE_SCALE = 0.54;
export const SLOT_PITCH = 1;
export const ROW_PITCH = 4.7;
export const INFO_WIDTH = 456;
export const INSPECT_LIFT_SECONDS = 0.32;
export const INSPECT_TURN_SECONDS = 0.72;
export const INSPECT_ZOOM = 2.05;

export interface Point { x: number; y: number }
export interface Quad { points: Point[] }
export interface ArchiveTrack {
  title: string; artist: string; src: string; cover: string; duration: number; durationLabel: string;
  lyricsSrc: string | null; globalIndex: number; folderIndex: number; folderPath: string; folderTitle: string;
  trackIndex: number; folderTrackCount: number;
}
export interface Shelf { index: number; tracks: ArchiveTrack[] }
export interface Spring { x: number; velocity: number; target: number; frequency: number }
export interface CaseMeta {
  axes: { x: [number, number]; y: [number, number]; z: [number, number] };
  array: { cover: number[][]; label: number[][]; origin: [number, number]; center: [number, number] };
  array_res: [number, number]; array_ppu: number; inspect: InspectMeta[]; inspect_res: [number, number]; inspect_ppu: number;
}
export interface InspectMeta { cover: number[][]; label: number[][]; center: [number, number]; crop: [number, number, number, number] }
export interface RailMeta { res: [number, number]; ppu: number; pitch: number; origin: [number, number]; label: number[][] }
export interface CaseMotion { lift: Spring; clear: Spring; gap: Spring }
export interface CaseTarget { lift: number; clear: number; gap: number }
export interface Projection { meta: CaseMeta; origin: Point; k: number; x: number; y: number; z: number; rowScaleX?: number; rowScaleY?: number }
export interface CaseTargetInput { slot: number; selectedSlot: number; active: boolean; hoverSlot: number }
export interface ArchiveGeometryInput { width: number; height: number; meta: CaseMeta; shelfCount: number; selectedShelf: number }
export interface ArchiveGeometry { k: number; origin: Point; wide: boolean; count: number; scaleX: number; scaleY: number; start: number }

const ARRAY_REFERENCE_WIDTH = 936;
const ARRAY_REFERENCE_HEIGHT = 731;
const ARRAY_ORIGIN_X_RATIO = 0.37;
const ARRAY_ORIGIN_Y_OFFSET = 87;
const WIDE_VIEW_RATIO = 2;
const WIDE_VIEW_PADDING = 48;
const WIDE_VIEW_MIN_SHELVES = 4;
const WIDE_VIEW_MAX_SHELVES = 24;
const INSPECTION_LIFT_MARGIN = 2.6;
const RACK_BOTTOM_CLEARANCE = 92;

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export const easeInOut = (value: number): number => value < 0.5 ? 4 * value ** 3 : 1 - Math.pow(-2 * value + 2, 3) / 2;
export const createSpring = (value: number, frequency: number): Spring => ({ x: value, velocity: 0, target: value, frequency });

export function stepSpring(spring: Spring, elapsed: number): boolean {
  const acceleration = spring.frequency ** 2 * (spring.target - spring.x) - 2 * spring.frequency * spring.velocity;
  spring.velocity += acceleration * elapsed;
  spring.x += spring.velocity * elapsed;
  if (Math.abs(spring.target - spring.x) < 0.01 && Math.abs(spring.velocity) < 0.05) {
    spring.x = spring.target;
    spring.velocity = 0;
    return false;
  }
  return true;
}

export function buildShelves(tracks: ArchiveTrack[]): Shelf[] {
  const shelves: Shelf[] = [];
  for (let start = 0; start < tracks.length; start += SHELF_SLOTS) {
    shelves.push({ index: shelves.length, tracks: tracks.slice(start, start + SHELF_SLOTS) });
  }
  return shelves;
}

export function caseTarget({ slot, selectedSlot, active, hoverSlot }: CaseTargetInput): CaseTarget {
  const distance = slot - selectedSlot;
  const bell = Math.exp(-(distance ** 2) / 4.5) - 0.32 * Math.exp(-(distance ** 2) / 18);
  const hoverLift = active && hoverSlot >= 0 ? 0.5 * Math.exp(-((slot - hoverSlot) ** 2) / 2.2) : 0;
  const selected = active && slot === selectedSlot;
  return {
    lift: (active ? 1.1 : 0.65) * bell + hoverLift + (selected ? 1.35 : 0),
    clear: selected ? 1 : 0,
    gap: active ? (slot > selectedSlot ? 0.55 : slot < selectedSlot ? -0.25 : 0) : 0,
  };
}

export function projectPoint({ meta, origin, k, x, y, z, rowScaleX = 1, rowScaleY = 1 }: Projection): Point {
  const { axes } = meta;
  return {
    x: origin.x + (x * axes.x[0] * rowScaleX + y * axes.y[0] + z * axes.z[0]) * k,
    y: origin.y + (x * axes.x[1] * rowScaleY + y * axes.y[1] + z * axes.z[1]) * k,
  };
}

export function getArchiveGeometry({ width, height, meta, shelfCount, selectedShelf }: ArchiveGeometryInput): ArchiveGeometry {
  const zoom = clamp(Math.min(width / ARRAY_REFERENCE_WIDTH, height / ARRAY_REFERENCE_HEIGHT), 1, 1.6);
  const k = CASE_SCALE * zoom;
  const origin = { x: Math.round(width * ARRAY_ORIGIN_X_RATIO), y: height - ARRAY_ORIGIN_Y_OFFSET };
  const wide = width > height * WIDE_VIEW_RATIO;
  if (!wide) return { k, origin, wide, count: WIDE_VIEW_MIN_SHELVES, scaleX: 1, scaleY: 1, start: selectedShelf };

  const along = (SHELF_SLOTS - 1) * SLOT_PITCH;
  const span = (along * meta.axes.y[0] + meta.array_res[0]) * k;
  const pitch = ROW_PITCH * meta.axes.x[0] * k;
  const capacity = clamp(Math.floor((width - WIDE_VIEW_PADDING * 2 - span) / pitch) + 1,
    WIDE_VIEW_MIN_SHELVES, WIDE_VIEW_MAX_SHELVES);
  const count = Math.max(1, Math.min(shelfCount || 1, capacity));
  const usable = Math.min(width - WIDE_VIEW_PADDING * 2, span + (count - 1) * pitch);
  const fillWidth = shelfCount >= capacity ? width - WIDE_VIEW_PADDING * 2 : usable;
  const rowStep = count > 1 ? (fillWidth - span) / (count - 1) : pitch;
  const shelfSpan = along * meta.axes.y[0] + meta.array_res[0] - meta.array.origin[0];
  origin.x = Math.round((width + fillWidth) / 2 - shelfSpan * k);
  const coverTop = Math.min(...meta.array.cover.map((point) => point[1]!));
  const rise = (-along * meta.axes.y[1] + meta.array.origin[1] - coverTop
    + INSPECTION_LIFT_MARGIN * Math.abs(meta.axes.z[1])) * k;
  const room = Math.max(0, origin.y - RACK_BOTTOM_CLEARANCE - rise);
  const verticalStep = Math.min(ROW_PITCH * meta.axes.x[1] * k, room / Math.max(1, count - 1));
  const start = Math.min(selectedShelf, Math.max(0, shelfCount - count));
  return { k, origin, wide, count, scaleX: Math.max(0.1, rowStep / pitch),
    scaleY: verticalStep / (ROW_PITCH * meta.axes.x[1] * k), start };
}

export function isInsidePolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
