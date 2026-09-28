// Холст с трассой: камера, отрисовка сцены, подсказки поверх (HUD, баннер).
import { Camera, fitCanvas, clear, drawTrack, drawTraffic, drawCar, drawSensors, drawPack } from '../engine/render.js';
import { trafficAt } from '../engine/traffic.js';
import { lapOf } from '../engine/track.js';
import { clamp } from '../engine/utils.js';
import { $, liveSize } from './ui.js';

export const canvas = $('#stage');
const ctx = canvas.getContext('2d');
const canvasSize = liveSize(canvas);
const cam = new Camera();
let dpr = 1;

export function beginFrame() {
  dpr = fitCanvas(canvas, canvasSize);
}

/** Положение машин трафика на тике tick (или null, если трафика нет) */
export const trafficOn = (track, tick) => (track.traffic ? trafficAt(track, track.traffic, tick) : null);

// На телефоне «вся трасса» — холст по пропорциям трассы: иначе длинная трасса — тонкая полоска среди пустоты
const viewport = $('#viewport');
const phone = matchMedia('(max-width: 700px)');
let viewportRatio = '';
function fitViewport(track, camera) {
  const b = track.bbox;
  const ratio = camera === 'fit' && phone.matches ? clamp((b.maxX - b.minX + 80) / (b.maxY - b.minY + 80), 0.9, 2.2).toFixed(2) : '';
  if (ratio !== viewportRatio) viewport.style.aspectRatio = viewportRatio = ratio;
}

/** Трасса и трафик на тике tick. camera: 'fit' — вся трасса, 'follow' — за машиной follow */
export function drawScene(track, { camera = 'fit', follow = null, traffic = null, tick = 0 } = {}) {
  fitViewport(track, camera);
  cam.mode = camera;
  cam.update(canvas, track, follow, dpr);
  clear(ctx, canvas);
  cam.apply(ctx, canvas);
  drawTrack(ctx, track, cam, tick);
  drawTraffic(ctx, traffic);
}

export const paintCar = (car, options = {}) => drawCar(ctx, car, { ...options, cam });
export const paintSensors = (car) => drawSensors(ctx, car);
export const paintPack = (cars) => drawPack(ctx, cars);

/** Рисовать поверх трассы в пикселях экрана: draw(ctx, ширина, высота, dpr) */
export function paintScreen(draw) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  draw(ctx, canvas.width, canvas.height, dpr);
  ctx.restore();
}

/** Точка трассы → пиксели экрана (для подписей поверх) */
export const toScreen = (x, y) => ({ x: (x - cam.x) * cam.scale + canvas.width / 2, y: (y - cam.y) * cam.scale + canvas.height / 2 });

/** Машина под пальцем или курсором (или null) */
export function carAt(event, cars, radiusPx = 28) {
  const rect = canvas.getBoundingClientRect();
  const p = cam.toWorld(canvas, (event.clientX - rect.left) * dpr, (event.clientY - rect.top) * dpr);
  let best = null;
  let bestDist = (radiusPx * dpr) / cam.scale;
  for (const car of cars) {
    const d = Math.hypot(car.x - p.x, car.y - p.y);
    if (d < bestDist) [best, bestDist] = [car, d];
  }
  return best;
}

// ── HUD и баннер ──

/** «круг 2/3» для табло: какой круг едет машина, доехавшая до s */
export const lapText = (track, s) => `круг <b>${lapOf(track, s)}</b>/${track.laps}`;

const hud = $('#hud');
const HUD_EVERY_MS = 100; // цифры меняются 10 раз в секунду — их успеваешь прочитать, и они не дребезжат
let hudAt = 0, hudCount = 0;
export function setHud(items) {
  const now = performance.now();
  if (items.length === hudCount && now - hudAt < HUD_EVERY_MS) return; // набор полей тот же — ждём следующего «тика» табло
  const html = items.map((item) => `<span>${item}</span>`).join('');
  if (hud.innerHTML !== html) hud.innerHTML = html;
  hudAt = now;
  hudCount = items.length;
}

const banner = $('#banner');
let bannerTimer = 0;
export function showBanner(text, ms = 1800) {
  banner.textContent = text;
  banner.hidden = false;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(hideBanner, ms);
}
export function hideBanner() {
  banner.hidden = true;
}
