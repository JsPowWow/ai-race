// Показ записанного этапа: где каждая машина на тике t, кто впереди, и как это нарисовать.
// Сотни машин рисуем попроще (paintPack), десятку лидеров и найденного участника — красиво, с подписями.
import { REC_EVERY, REC_FIELDS } from '../../engine/rally.js';
import { avatarUrl } from '../../engine/car-file.js';
import { UI_FONT } from '../../engine/render.js';
import { paintCar, paintPack, paintScreen, toScreen } from '../stage.js';

const OUT_VISIBLE_TICKS = 90;      // сколько ещё видно машину после схода
const FINISH_VISIBLE_TICKS = 40;   // и после финиша
const LABELS = 3;                  // подписываем первых трёх
const COLORS = { driving: '#ffd60a', finished: '#3ddc84', out: '#5c6370' };

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class StageReplay {
  /** rows — [{ entry, result }] для одного этапа */
  constructor(track, rows) {
    this.track = track;
    this.rows = rows;
    this.length = rows.reduce((max, r) => Math.max(max, r.result.ticks), 0);
  }

  /** Машина на тике tick: { x, y, angle, curve, progress, status, since } (since — тиков после финиша/схода) */
  at({ result }, tick) {
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
    const mix = (k) => traj[a + k] + (traj[b + k] - traj[a + k]) * f;
    const turn = wrapAngle(traj[b + 2] - traj[a + 2]);
    const path = Math.hypot(traj[b] - traj[a], traj[b + 1] - traj[a + 1]);
    return {
      x: mix(0),
      y: mix(1),
      angle: traj[a + 2] + turn * f,
      curve: path > 1 ? turn / path : 0, // в записи руля нет — дугу берём из того, как повернула машина
      progress: mix(3),
      status: tick < ticks ? 'driving' : status,
      since: tick - ticks,
    };
  }

  /** Порядок на тике: сначала финишировавшие (кто раньше), дальше — кто дальше проехал */
  order(tick) {
    const list = [];
    for (const row of this.rows) {
      const car = this.at(row, tick);
      if (car) list.push({ row, car });
    }
    const finishedAt = (x) => (x.car.status === 'finished' ? x.row.result.finishTick : Infinity);
    return list.sort((a, b) => finishedAt(a) - finishedAt(b) || b.car.progress - a.car.progress);
  }
}

/** Сколько на трассе, финишировали, сошли */
export function countStatuses(order) {
  const count = { driving: 0, finished: 0, out: 0 };
  for (const { car } of order) count[car.status === 'driving' ? 'driving' : car.status === 'finished' ? 'finished' : 'out']++;
  return count;
}

// ── рисование ──

const images = new Map();
function avatarImage(svg) {
  if (!svg) return null;
  if (!images.has(svg)) images.set(svg, Object.assign(new Image(), { src: avatarUrl(svg) }));
  const img = images.get(svg);
  return img.complete && img.naturalWidth ? img : null;
}

/**
 * order — результат replay.order(tick); found — участник, которого ищем (или null);
 * showAvatars — рисовать ли аватары; leaders — сколько машин рисовать красиво.
 */
export function drawStage(order, { found = null, showAvatars = true, hiddenAvatars = new Set(), leaders = 10 } = {}) {
  const pack = [];
  const fancy = [];
  order.forEach((item, place) => {
    const { car, row } = item;
    const out = car.status !== 'driving' && car.status !== 'finished';
    const gone = car.status === 'finished' ? car.since > FINISH_VISIBLE_TICKS : out && car.since > OUT_VISIBLE_TICKS;
    if (gone && row.entry !== found) return;
    if (place < leaders || row.entry === found) fancy.push({ ...item, place });
    else pack.push({ x: car.x, y: car.y, angle: car.angle, color: out ? COLORS.out : row.entry.color, alpha: out ? 0.35 * (1 - car.since / OUT_VISIBLE_TICKS) : 0.55 });
  });
  paintPack(pack);
  for (const { car, row } of fancy.reverse()) {
    paintCar({ ...car, done: car.status !== 'driving' }, { color: row.entry.color, highlight: row.entry === found });
  }
  paintScreen((ctx, W, H, dpr) => {
    const placed = []; // подписи не должны налезать друг на друга: следующую поднимаем выше
    for (const { car, row, place } of fancy.sort((a, b) => a.place - b.place)) {
      if (place >= LABELS && row.entry !== found) continue;
      const p = toScreen(car.x, car.y);
      const avatar = showAvatars && !hiddenAvatars.has(row.entry.id) ? avatarImage(row.entry.avatar) : null;
      drawLabel(ctx, p.x, p.y - 30 * dpr, `${place + 1}. ${row.entry.name}`, avatar, dpr, row.entry === found, placed);
    }
  });
}

function drawLabel(ctx, x, y, text, avatar, dpr, strong, placed) {
  ctx.font = `600 ${13 * dpr}px ${UI_FONT}`;
  const size = 22 * dpr, pad = 6 * dpr;
  const w = ctx.measureText(text).width + pad * 2 + (avatar ? size + pad : 0);
  const h = size + pad;
  const left = x - w / 2;
  const hits = (top) => placed.some((r) => left < r.left + r.w && r.left < left + w && top < r.top + h + 2 * dpr && r.top < top + h + 2 * dpr);
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
export function drawProgressStrip(order, { found = null } = {}) {
  paintScreen((ctx, W, H, dpr) => {
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

    const dot = 3 * dpr, step = 3.2 * dpr, rows = Math.floor((height - 20 * dpr) / step);
    const bins = new Map();
    let foundAt = null;
    for (const { car, row } of order) {
      const x = left + (right - left) * car.progress;
      const bin = Math.round(x / (dot + 1));
      const k = bins.get(bin) ?? 0;
      bins.set(bin, k + 1);
      const y = base - (k % rows) * step;
      ctx.fillStyle = COLORS[car.status === 'driving' ? 'driving' : car.status === 'finished' ? 'finished' : 'out'];
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      if (row.entry === found) foundAt = { x, y };
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
