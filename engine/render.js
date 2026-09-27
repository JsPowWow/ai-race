// Рисование трассы и машин на canvas.
import { CAR } from './car.js';
import { pointAt } from './track.js';

let palette = null;
export function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  palette = {
    grass: v('--grass'), road: v('--road'), roadEdge: v('--road-edge'), kerb: v('--kerb'),
    ink: v('--ink'), muted: v('--muted'), accent: v('--accent'), surface: v('--surface'),
    ray: v('--ray'), rayHit: v('--ray-hit'),
  };
  return palette;
}
export const getPalette = () => palette || readPalette();

/** Подогнать размер canvas под CSS-размер с учётом плотности пикселей */
export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return dpr;
}

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.scale = 1; this.mode = 'fit'; this.ready = false; }
  update(canvas, track, target, dpr) {
    const W = canvas.width, H = canvas.height;
    if (this.mode === 'fit' || !target) {
      const b = track.bbox, pad = 40;
      const s = Math.min(W / (b.maxX - b.minX + pad * 2), H / (b.maxY - b.minY + pad * 2));
      this.scale = s; this.x = (b.minX + b.maxX) / 2; this.y = (b.minY + b.maxY) / 2; this.ready = true;
    } else {
      const s = dpr * (canvas.clientWidth < 520 ? 0.75 : 1.05);
      if (!this.ready || Math.abs(this.scale - s) > 0.5) { this.x = target.x; this.y = target.y; }
      this.scale = s;
      this.x += (target.x - this.x) * 0.15;
      this.y += (target.y - this.y) * 0.15;
      this.ready = true;
    }
  }
  apply(ctx, canvas) {
    ctx.setTransform(this.scale, 0, 0, this.scale, canvas.width / 2 - this.x * this.scale, canvas.height / 2 - this.y * this.scale);
  }
  toWorld(canvas, px, py) {
    return { x: (px - canvas.width / 2) / this.scale + this.x, y: (py - canvas.height / 2) / this.scale + this.y };
  }
}

function polyPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

export function drawTrack(ctx, track, cam) {
  const p = getPalette();
  const { left, right, center } = track;
  // дорога
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = p.road;
  ctx.fill();
  // разметка полос
  const px = 1 / cam.scale;
  ctx.lineWidth = Math.max(2, 1.2 * px);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.setLineDash([22, 26]);
  for (const lane of track.dividers ?? [center]) { polyPath(ctx, lane); ctx.stroke(); }
  // бордюры: красно-белые полосы
  const kw = Math.max(7, 2.5 * px);
  for (const side of [left, right]) {
    ctx.setLineDash([]);
    ctx.lineWidth = kw; ctx.strokeStyle = p.kerb; polyPath(ctx, side); ctx.stroke();
    ctx.setLineDash([14, 14]); ctx.strokeStyle = '#f4f4f0'; ctx.stroke();
  }
  ctx.setLineDash([]);
  // старт и финиш
  const st = pointAt(track, track.startS - CAR.length / 2 - 4);
  line(ctx, st, track.width, '#f4f4f0', 5);
  const fin = pointAt(track, track.finishS);
  checkered(ctx, fin, track.width);
}

function line(ctx, pt, width, color, thick) {
  const nx = -Math.sin(pt.angle), ny = Math.cos(pt.angle);
  ctx.beginPath();
  ctx.moveTo(pt.x - nx * width / 2, pt.y - ny * width / 2);
  ctx.lineTo(pt.x + nx * width / 2, pt.y + ny * width / 2);
  ctx.lineWidth = thick; ctx.strokeStyle = color; ctx.stroke();
}

function checkered(ctx, pt, width) {
  ctx.save();
  ctx.translate(pt.x, pt.y);
  ctx.rotate(pt.angle);
  const sq = 10, rows = 2, cols = Math.round(width / sq);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    ctx.fillStyle = (r + c) % 2 ? '#111' : '#f4f4f0';
    ctx.fillRect(r * sq - sq, -width / 2 + c * (width / cols), sq, width / cols);
  }
  ctx.restore();
}

export function drawCar(ctx, car, { color = '#ffd60a', alpha = 1, sensors = false, label = null, highlight = false, glow = false, cam } = {}) {
  const p = getPalette();
  if (sensors && !car.done) drawSensors(ctx, car);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  const L = CAR.length, W = CAR.width;
  const body = car.status === 'crashed' ? '#8a9095' : color;
  if (highlight) {
    ctx.lineWidth = 3 / (cam?.scale || 1) + 2;
    ctx.strokeStyle = p.accent;
    roundRect(ctx, -L / 2 - 5, -W / 2 - 5, L + 10, W + 10, 8); ctx.stroke();
  }
  ctx.fillStyle = body;
  if (glow && car.status !== 'crashed') { ctx.shadowColor = color; ctx.shadowBlur = 22; }
  roundRect(ctx, -L / 2, -W / 2, L, W, 6); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, L * 0.02, -W / 2 + 4, L * 0.24, W - 8, 3); ctx.fill(); // лобовое
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(-L / 2 + 3, -2, L * 0.4, 4); // полоса
  ctx.restore();
  if (label) {
    ctx.save();
    const s = 1 / (cam?.scale || 1);
    ctx.font = `${Math.round(13 * s)}px "Golos Text", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3 * s; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(label, car.x, car.y - 30 * Math.max(1, s * 0.8));
    ctx.fillStyle = '#fff';
    ctx.fillText(label, car.x, car.y - 30 * Math.max(1, s * 0.8));
    ctx.restore();
  }
}

export function drawSensors(ctx, car, sensors = car.sensors) {
  const p = getPalette();
  const { count, spread, length } = sensors;
  const half = (spread * Math.PI) / 360;
  ctx.lineWidth = 2;
  for (let i = 0; i < count; i++) {
    const a = car.angle + (count === 1 ? 0 : -half + (2 * half * i) / (count - 1));
    const t = car.rayT && car.rayT.length === count ? car.rayT[i] : -1;
    const ex = car.x + Math.cos(a) * length, ey = car.y + Math.sin(a) * length;
    const hx = t < 0 ? ex : car.x + Math.cos(a) * length * t, hy = t < 0 ? ey : car.y + Math.sin(a) * length * t;
    ctx.strokeStyle = p.ray;
    ctx.beginPath(); ctx.moveTo(car.x, car.y); ctx.lineTo(hx, hy); ctx.stroke();
    if (t >= 0) {
      ctx.strokeStyle = p.rayHit;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = p.rayHit;
      ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function clear(ctx, canvas) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = getPalette().grass;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/** Машины трафика: попутные светлые, встречные с жёлтыми фарами */
export function drawTraffic(ctx, traffic) {
  if (!traffic) return;
  const L = CAR.length, W = CAR.width;
  for (const o of traffic) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    ctx.fillStyle = o.oncoming ? '#e9ecef' : '#ced4da';
    roundRect(ctx, -L / 2, -W / 2, L, W, 5); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#343a40'; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, L * 0.02, -W / 2 + 4, L * 0.22, W - 8, 3); ctx.fill();
    ctx.fillStyle = o.oncoming ? '#ffd43b' : '#fa5252'; // фары у встречных, стоп-сигналы у попутных
    const fx = o.oncoming ? L / 2 - 3 : -L / 2 + 1;
    ctx.fillRect(fx, -W / 2 + 2, 3, 5); ctx.fillRect(fx, W / 2 - 7, 3, 5);
    ctx.restore();
  }
}
