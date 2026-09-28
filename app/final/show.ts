// Показ записанного этапа: где каждая машина на тике t, кто впереди, и как это нарисовать.
// Сотни машин рисуем попроще (paintPack), десятку лидеров и найденного участника — красиво, с подписями.
import { REC_EVERY, REC_FIELDS } from '../../engine/rally.ts';
import type { StageResult } from '../../engine/rally.ts';
import { avatarUrl } from '../../engine/car-file.ts';
import { UI_FONT } from '../../engine/render.ts';
import type { PackCar } from '../../engine/render.ts';
import { maxCurve } from '../../engine/car.ts';
import type { Track } from '../../engine/track.ts';
import { paintCar, paintPack, paintScreen, toScreen } from '../stage.js';
import type { FinalEntry } from './entries.ts';

const OUT_VISIBLE_TICKS = 90;      // сколько ещё видно машину после схода
const FINISH_VISIBLE_TICKS = 40;   // и после финиша
const LABELS = 3;                  // подписываем первых трёх
const LEADERS = 10;                // столько машин рисуем красиво
// Поверх трассы всё всегда тёмное (как HUD), поэтому цвета не из темы
const COLORS = { driving: '#ffd60a', finished: '#3ddc84', out: '#5c6370' };

/** Участник этапа и его записанный заезд */
export type ReplayRow = { entry: FinalEntry; result: StageResult };
/** Машина на тике: since — сколько тиков прошло после финиша или схода (пока едет — меньше нуля) */
export type ReplayCar = {
  x: number; y: number; angle: number; steer: number; speed: number; progress: number;
  status: 'driving' | StageResult['status']; since: number;
};
/** Участник на своём месте в заезде */
export type Placed = { row: ReplayRow; car: ReplayCar };
/** Три вида машин для табло и полосы прогресса */
export type Kind = keyof typeof COLORS;

/** Едет, финишировал или сошёл (разбился, заглох, не успел, ошибка) */
export const kindOf = (car: ReplayCar): Kind => (car.status === 'driving' ? 'driving' : car.status === 'finished' ? 'finished' : 'out');

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class StageReplay {
  readonly track: Track;
  readonly rows: ReplayRow[];
  /** Сколько тиков идёт запись: до финиша или схода последней машины */
  readonly length: number;

  constructor(track: Track, rows: ReplayRow[]) {
    this.track = track;
    this.rows = rows;
    this.length = rows.reduce((max, r) => Math.max(max, r.result.ticks), 0);
  }

  /** Машина на тике tick (между записями — плавно посередине) или null, если записи нет */
  at({ result }: ReplayRow, tick: number): ReplayCar | null {
    const { traj, ticks, status } = result;
    const n = traj.length / REC_FIELDS;
    if (!n) return null;
    let i = n - 1, f = 0;
    if (tick < ticks) {
      const p = tick / REC_EVERY;
      i = Math.min(Math.floor(p), n - 1);
      f = Math.min(p - i, 1);
    }
    const a = i * REC_FIELDS, b = Math.min(i + 1, n - 1) * REC_FIELDS;
    const mix = (k: number) => traj[a + k] + (traj[b + k] - traj[a + k]) * f;
    const turn = wrapAngle(traj[b + 2] - traj[a + 2]);
    const path = Math.hypot(traj[b] - traj[a], traj[b + 1] - traj[a + 1]);
    const speed = path / REC_EVERY;
    return {
      x: mix(0),
      y: mix(1),
      angle: traj[a + 2] + turn * f,
      // в записи руля нет — восстановим его из того, как круто повернула машина на своей скорости
      steer: path > 1 ? Math.max(-1, Math.min(1, turn / path / maxCurve(speed))) : 0,
      speed,
      progress: mix(3),
      status: tick < ticks ? 'driving' : status,
      since: tick - ticks,
    };
  }

  /** Порядок на тике: сначала финишировавшие (кто раньше), дальше — кто дальше проехал */
  order(tick: number): Placed[] {
    const list: Placed[] = [];
    for (const row of this.rows) {
      const car = this.at(row, tick);
      if (car) list.push({ row, car });
    }
    const finishedAt = (x: Placed) => (x.car.status === 'finished' ? x.row.result.finishTick ?? Infinity : Infinity);
    return list.sort((a, b) => finishedAt(a) - finishedAt(b) || b.car.progress - a.car.progress);
  }
}

/** Сколько на трассе, финишировали, сошли */
export function countStatuses(order: Placed[]): Record<Kind, number> {
  const count = { driving: 0, finished: 0, out: 0 };
  for (const { car } of order) count[kindOf(car)]++;
  return count;
}

// ── рисование ──

/** Картинки аватаров для холста: грузятся один раз, пока не загрузились — рисуем без них */
const images = new Map<string, HTMLImageElement>();
function avatarImage(svg: string | null): HTMLImageElement | null {
  if (!svg) return null;
  let img = images.get(svg);
  if (!img) images.set(svg, (img = Object.assign(new Image(), { src: avatarUrl(svg) ?? '' })));
  return img.complete && img.naturalWidth ? img : null;
}

export type StageLook = {
  /** id участника, которого ищем (или null) */
  foundId?: string | null;
  /** Рисовать ли аватары вообще и чьи скрыть */
  showAvatars?: boolean;
  hiddenAvatars?: ReadonlySet<string>;
};

/** Машины этапа: order — результат replay.order(tick) */
export function drawStage(order: Placed[], { foundId = null, showAvatars = true, hiddenAvatars = new Set() }: StageLook = {}): void {
  const pack: PackCar[] = [];
  const fancy: (Placed & { place: number })[] = [];
  order.forEach((item, place) => {
    const { car, row } = item;
    const found = row.entry.id === foundId;
    const out = kindOf(car) === 'out';
    const gone = car.status === 'finished' ? car.since > FINISH_VISIBLE_TICKS : out && car.since > OUT_VISIBLE_TICKS;
    if (gone && !found) return;
    if (place < LEADERS || found) fancy.push({ ...item, place });
    else pack.push({ x: car.x, y: car.y, angle: car.angle, color: out ? COLORS.out : row.entry.color, alpha: out ? 0.35 * (1 - car.since / OUT_VISIBLE_TICKS) : 0.55 });
  });
  paintPack(pack);
  // лидеры — поверх остальных: первый рисуется последним
  for (const { car, row } of [...fancy].reverse()) {
    paintCar({ ...car, done: car.status !== 'driving' }, { color: row.entry.color, highlight: row.entry.id === foundId });
  }
  paintScreen((ctx: CanvasRenderingContext2D, _W: number, _H: number, dpr: number) => {
    const placed: Box[] = []; // подписи не должны налезать друг на друга: следующую поднимаем выше
    for (const { car, row, place } of fancy) {
      const found = row.entry.id === foundId;
      if (place >= LABELS && !found) continue;
      const p = toScreen(car.x, car.y);
      const avatar = showAvatars && !hiddenAvatars.has(row.entry.id) ? avatarImage(row.entry.avatar) : null;
      drawLabel(ctx, { x: p.x, y: p.y - 30 * dpr, text: `${place + 1}. ${row.entry.name}`, avatar, dpr, strong: found }, placed);
    }
  });
}

/** Место, которое уже заняла подпись */
type Box = { left: number; top: number; w: number };
type Label = { x: number; y: number; text: string; avatar: HTMLImageElement | null; dpr: number; strong: boolean };

function drawLabel(ctx: CanvasRenderingContext2D, { x, y, text, avatar, dpr, strong }: Label, placed: Box[]): void {
  ctx.font = `600 ${13 * dpr}px ${UI_FONT}`;
  const size = 22 * dpr, pad = 6 * dpr;
  const w = ctx.measureText(text).width + pad * 2 + (avatar ? size + pad : 0);
  const h = size + pad;
  const left = x - w / 2;
  const hits = (top: number) => placed.some((r) => left < r.left + r.w && r.left < left + w && top < r.top + h + 2 * dpr && r.top < top + h + 2 * dpr);
  while (hits(y - h / 2)) y -= h + 2 * dpr;
  const top = y - h / 2;
  placed.push({ left, top, w });
  ctx.fillStyle = strong ? 'rgba(255, 214, 10, 0.92)' : 'rgba(10, 12, 16, 0.78)';
  ctx.fillRect(left, top, w, h);
  let tx = left + pad;
  if (avatar) {
    ctx.drawImage(avatar, tx, top + pad / 2, size, size);
    tx += size + pad;
  }
  ctx.fillStyle = strong ? '#111' : '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, tx, y);
}

/** Полоса прогресса внизу: каждый участник — точка на пути от старта до финиша */
export function drawProgressStrip(order: Placed[], { foundId = null }: { foundId?: string | null } = {}): void {
  paintScreen((ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number) => {
    const margin = 12 * dpr, height = 58 * dpr;
    const left = margin + 44 * dpr, right = W - margin - 44 * dpr;
    const base = H - margin - 12 * dpr;
    ctx.fillStyle = 'rgba(10, 12, 16, 0.78)';
    ctx.fillRect(margin, H - margin - height, W - margin * 2, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(left, base + 3 * dpr, right - left, 2 * dpr);

    ctx.font = `700 ${10 * dpr}px ${UI_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.textAlign = 'right';
    ctx.fillText('СТАРТ', left - 8 * dpr, base);
    ctx.textAlign = 'left';
    ctx.fillText('ФИНИШ', right + 8 * dpr, base);

    // точки в одном месте складываем столбиком, а не друг на друга
    const dot = 3 * dpr, step = 3.2 * dpr, rows = Math.max(1, Math.floor((height - 20 * dpr) / step));
    const bins = new Map<number, number>();
    let foundAt: { x: number; y: number } | null = null;
    for (const { car, row } of order) {
      const x = left + (right - left) * car.progress;
      const bin = Math.round(x / (dot + 1));
      const k = bins.get(bin) ?? 0;
      bins.set(bin, k + 1);
      const y = base - (k % rows) * step;
      ctx.fillStyle = COLORS[kindOf(car)];
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      if (row.entry.id === foundId) foundAt = { x, y };
    }
    if (foundAt) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(foundAt.x, foundAt.y, 6 * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}
