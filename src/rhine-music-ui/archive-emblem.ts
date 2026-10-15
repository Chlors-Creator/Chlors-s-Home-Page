const RING_RADIUS = 1;
const RING_CENTER_X = 1.42;
const RING_SAMPLE_COUNT = 1440;
const RIBBON_SEGMENT_COUNT = 110;
const RIBBON_WIDTH = 0.34;
const RIBBON_ROTATION_X = 0.32;
const EMBLEM_FPS_MS = 33;
const EMBLEM_COLOR = '#0b0b0b';
const EMBLEM_SCALE = 12.5;

type Point3 = [number, number, number];
interface Segment { ax: number; ay: number; bx: number; by: number; depth: number; facing: number }
interface RotationOptions { point: Point3; turn: number; cosineX: number; sineX: number }

const sampledRing = sampleRing();
const canvas = document.querySelector<HTMLCanvasElement>('#archive-emblem');
const context = canvas?.getContext('2d');
let playing = false;
let emblemTime = 0;
let lastFrameTime = 0;
let timer = 0;

function sampleRing(): Array<[number, number]> {
  const pieces = sampleRingPieces();
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  return Array.from({ length: RING_SAMPLE_COUNT }, (_, index) => sampleRingPoint(pieces, index / RING_SAMPLE_COUNT * total));
}

function sampleRingPoint(pieces: ReturnType<typeof sampleRingPieces>, distance: number): [number, number] {
  let offset = distance;
  let index = 0;
  while (offset > pieces[index]!.length && index < pieces.length - 1) offset -= pieces[index++]!.length;
  const piece = pieces[index]!;
  const amount = offset / piece.length;
  if (piece.kind === 'line') {
    return [piece.start[0] + (piece.end[0] - piece.start[0]) * amount,
      -(piece.start[1] + (piece.end[1] - piece.start[1]) * amount)];
  }
  return [piece.center[0] + RING_RADIUS * Math.cos(piece.begin + piece.sweep * amount),
    -(piece.center[1] + RING_RADIUS * Math.sin(piece.begin + piece.sweep * amount))];
}

function sampleRingPieces(): Array<{
  kind: 'line' | 'arc'; length: number; start: [number, number]; end: [number, number];
  center: [number, number]; begin: number; sweep: number;
}> {
  const angle = Math.asin(RING_RADIUS / RING_CENTER_X);
  const tangent = Math.sqrt(RING_CENTER_X ** 2 - RING_RADIUS ** 2);
  const sweep = Math.PI + 2 * angle;
  return [
    { kind: 'line', start: [0, 0], end: [tangent * Math.cos(angle), tangent * Math.sin(angle)], length: tangent, center: [0, 0], begin: 0, sweep: 0 },
    { kind: 'arc', center: [RING_CENTER_X, 0], begin: Math.PI / 2 + angle, sweep: -sweep, length: RING_RADIUS * sweep, start: [0, 0], end: [0, 0] },
    { kind: 'line', start: [tangent * Math.cos(angle), -tangent * Math.sin(angle)], end: [0, 0], length: tangent, center: [0, 0], begin: 0, sweep: 0 },
    { kind: 'line', start: [0, 0], end: [-tangent * Math.cos(angle), tangent * Math.sin(angle)], length: tangent, center: [0, 0], begin: 0, sweep: 0 },
    { kind: 'arc', center: [-RING_CENTER_X, 0], begin: Math.PI / 2 - angle, sweep, length: RING_RADIUS * sweep, start: [0, 0], end: [0, 0] },
    { kind: 'line', start: [-tangent * Math.cos(angle), -tangent * Math.sin(angle)], end: [0, 0], length: tangent, center: [0, 0], begin: 0, sweep: 0 },
  ];
}

function ringPoint(value: number): Point3 {
  const index = Math.floor((((value / (2 * Math.PI)) % 1 + 1) % 1) * sampledRing.length) % sampledRing.length;
  const point = sampledRing[index]!;
  return [point[0] * 0.67, -point[1] * 0.67, -Math.cos(value) * 0.55];
}

function rotatePoint({ point, turn, cosineX, sineX }: RotationOptions): Point3 {
  const cosineY = Math.cos(turn); const sineY = Math.sin(turn);
  const rotatedX = point[0] * cosineY + point[2] * sineY;
  const rotatedZ = -point[0] * sineY + point[2] * cosineY;
  return [rotatedX, point[1] * cosineX - rotatedZ * sineX, point[1] * sineX + rotatedZ * cosineX];
}

function ribbonSegments(time: number, width: number, height: number): Segment[] {
  const turn = 0.5 * Math.sin(time * 0.2);
  const cosineX = Math.cos(RIBBON_ROTATION_X); const sineX = Math.sin(RIBBON_ROTATION_X);
  return Array.from({ length: RIBBON_SEGMENT_COUNT }, (_, index) => createSegment({ index, time, width, height, turn, cosineX, sineX }));
}

interface SegmentOptions { index: number; time: number; width: number; height: number; turn: number; cosineX: number; sineX: number }

function createSegment(options: SegmentOptions): Segment {
  const { index, time, width, height, turn, cosineX, sineX } = options;
  const unit = index / RIBBON_SEGMENT_COUNT * 2 * Math.PI;
  const center = ringPoint(unit); const before = ringPoint(unit - 0.02); const after = ringPoint(unit + 0.02);
  const tangent = normalize3([after[0] - before[0], after[1] - before[1], after[2] - before[2]]);
  const basis = ribbonBasis(tangent, unit, time);
  const a = rotatePoint({ point: add3(center, scale3(basis.width, RIBBON_WIDTH)), turn, cosineX, sineX });
  const b = rotatePoint({ point: add3(center, scale3(basis.width, -RIBBON_WIDTH)), turn, cosineX, sineX });
  const normal = rotatePoint({ point: basis.normal, turn, cosineX, sineX });
  return { ax: width / 2 + a[0] * EMBLEM_SCALE, ay: height / 2 - a[1] * EMBLEM_SCALE,
    bx: width / 2 + b[0] * EMBLEM_SCALE, by: height / 2 - b[1] * EMBLEM_SCALE,
    depth: (a[2] + b[2]) / 2, facing: Math.abs(normal[2]) };
}

function ribbonBasis(tangent: Point3, unit: number, time: number): { width: Point3; normal: Point3 } {
  let bx = tangent[1]; let by = -tangent[0];
  const length = Math.hypot(bx, by) || 1;
  bx /= length; by /= length;
  const nx = by * tangent[2]; const ny = -bx * tangent[2]; const nz = bx * tangent[1] - by * tangent[0];
  const angle = unit * 1.5 + time * 0.32;
  const cosine = Math.cos(angle); const sine = Math.sin(angle);
  const width: Point3 = [bx * cosine + nx * sine, by * cosine + ny * sine, nz * sine];
  return { width, normal: cross3(tangent, width) };
}

function normalize3(value: Point3): Point3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!length) throw new Error('Archive emblem contains a zero-length tangent.');
  return [value[0] / length, value[1] / length, value[2] / length];
}

function add3(left: Point3, right: Point3): Point3 { return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]; }
function scale3(point: Point3, factor: number): Point3 { return [point[0] * factor, point[1] * factor, point[2] * factor]; }
function cross3(left: Point3, right: Point3): Point3 {
  return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
}

function draw(time: number): void {
  if (!canvas || !context) return;
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(bounds.width * pixelRatio); canvas.height = Math.round(bounds.height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  const segments = ribbonSegments(time, bounds.width, bounds.height).sort((a, b) => b.depth - a.depth);
  segments.forEach((segment) => drawSegment(segment));
}

function drawSegment(segment: Segment): void {
  if (!context) return;
  context.beginPath(); context.moveTo(segment.ax, segment.ay); context.lineTo(segment.bx, segment.by);
  context.lineWidth = 0.9; context.strokeStyle = EMBLEM_COLOR;
  context.globalAlpha = 0.3 + 0.7 * segment.facing ** 0.7; context.stroke(); context.globalAlpha = 1;
}

function startAnimation(): void {
  if (timer) return;
  lastFrameTime = performance.now();
  timer = window.setInterval(() => {
    const now = performance.now();
    emblemTime += (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    draw(emblemTime);
  }, EMBLEM_FPS_MS);
}

function stopAnimation(): void {
  if (!timer) return;
  window.clearInterval(timer); timer = 0;
  draw(emblemTime);
}

document.addEventListener('rhine-music:playback-state', (event) => {
  playing = Boolean((event as CustomEvent<{ playing: boolean }>).detail.playing);
  if (playing) startAnimation(); else stopAnimation();
});

draw(0);

