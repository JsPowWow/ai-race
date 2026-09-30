// Холст с трассой: камера, отрисовка сцены, подсказки поверх (HUD, баннер).
import { Camera, fitCanvas, clear, drawTrack, drawTraffic, drawCar, drawSensors, drawPack, type CarView, type CarLook, type PackCar } from '../engine/render.ts';
import { trafficAt, type TrafficSpot } from '../engine/traffic.ts';
import { lapOf, type Track } from '../engine/track.ts';
import type { Point } from '../engine/turtle.ts';
import { clamp } from '../engine/utils.ts';
import { liveSize } from './ui.ts';
import { element } from './dom.ts';
import { listen } from '@reely/dommy-kit';

export const canvas = element<HTMLCanvasElement>('#stage');
const ctx = context2d(canvas);
const canvasSize = liveSize(canvas);
const cam = new Camera();
let dpr = 1;

function context2d(el: HTMLCanvasElement): CanvasRenderingContext2D {
  const found = el.getContext('2d');
  if (!found) throw new Error('холст трассы не рисует 2D');
  return found;
}

export function beginFrame(): void {
  dpr = fitCanvas(canvas, canvasSize);
}

/** Положение машин трафика на тике tick (или null, если трафика нет) */
export const trafficOn = (track: Track, tick: number): TrafficSpot[] | null => (track.traffic ? trafficAt(track, track.traffic, tick) : null);

// На телефоне «вся трасса» — холст по пропорциям трассы: иначе длинная трасса — тонкая полоска среди пустоты
const viewport = element('#viewport');
const phone = matchMedia('(max-width: 700px)');
let viewportRatio = '';
function fitViewport(track: Track, camera: string): void {
  const b = track.bbox;
  const ratio = camera === 'fit' && phone.matches ? clamp((b.maxX - b.minX + 80) / (b.maxY - b.minY + 80), 0.9, 2.2).toFixed(2) : '';
  if (ratio !== viewportRatio) viewport.style.aspectRatio = viewportRatio = ratio;
}

/**
 * Файлы, брошенные на трассу. active() — наша ли сейчас вкладка: трасса одна на все вкладки.
 * Пока файл несут над трассой — пунктирная рамка. Перешёл на кнопку пульта поверх трассы —
 * это всё ещё трасса: рамка не гаснет и не мигает.
 */
export function onTrackDrop(active: () => boolean, drop: (data: DataTransfer) => void): void {
  listen(viewport, 'dragover', (e) => {
    if (!active()) return;
    e.preventDefault(); // иначе браузер не даст бросить файл сюда
    viewport.classList.add('drop');
  });
  listen(viewport, 'dragleave', (e) => {
    if (!viewport.contains(e.relatedTarget as Node | null)) viewport.classList.remove('drop');
  });
  listen(viewport, 'drop', (e) => {
    if (!active() || !e.dataTransfer) return;
    e.preventDefault();
    viewport.classList.remove('drop');
    drop(e.dataTransfer);
  });
}

/** Что показать на трассе: камера ('fit' — вся трасса, 'follow' — за машиной follow), трафик и тик */
export type SceneView = { camera?: string; follow?: CarView | null; traffic?: TrafficSpot[] | null; tick?: number };

/** Трасса и трафик на тике tick */
export function drawScene(track: Track, { camera = 'fit', follow = null, traffic = null, tick = 0 }: SceneView = {}): void {
  fitViewport(track, camera);
  cam.mode = camera;
  cam.update(canvas, track, follow, dpr);
  clear(ctx, canvas);
  cam.apply(ctx, canvas);
  drawTrack(ctx, track, cam, tick);
  drawTraffic(ctx, traffic);
}

export const paintCar = (car: CarView, options: CarLook = {}): void => drawCar(ctx, car, { ...options, cam });
export const paintSensors = (car: CarView): void => drawSensors(ctx, car);
export const paintPack = (cars: PackCar[]): void => drawPack(ctx, cars);

/** Рисовать поверх трассы в пикселях экрана: draw(ctx, ширина, высота, dpr) */
export function paintScreen(draw: (ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) => void): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  draw(ctx, canvas.width, canvas.height, dpr);
  ctx.restore();
}

/** Точка трассы → пиксели экрана (для подписей поверх) */
export const toScreen = (x: number, y: number): Point => ({ x: (x - cam.x) * cam.scale + canvas.width / 2, y: (y - cam.y) * cam.scale + canvas.height / 2 });

/** Машина под пальцем или курсором (или null) */
export function carAt<C extends Point>(event: { clientX: number; clientY: number }, cars: readonly C[], radiusPx = 28): C | null {
  const rect = canvas.getBoundingClientRect();
  const p = cam.toWorld(canvas, (event.clientX - rect.left) * dpr, (event.clientY - rect.top) * dpr);
  let best: C | null = null;
  let bestDist = (radiusPx * dpr) / cam.scale;
  for (const car of cars) {
    const d = Math.hypot(car.x - p.x, car.y - p.y);
    if (d < bestDist) [best, bestDist] = [car, d];
  }
  return best;
}

// ── HUD и баннер ──

/** «круг 2/3» для табло: какой круг едет машина, доехавшая до s */
export const lapText = (track: Track, s: number): string => `круг <b>${lapOf(track, s)}</b>/${track.laps}`;

const hud = element('#hud');
const HUD_EVERY_MS = 100; // цифры меняются 10 раз в секунду — их успеваешь прочитать, и они не дребезжат
let hudAt = 0, hudCount = 0;
/** Строки табло поверх трассы. Это HTML: пользовательский текст — только через esc() */
export function setHud(items: string[]): void {
  const now = performance.now();
  if (items.length === hudCount && now - hudAt < HUD_EVERY_MS) return; // набор полей тот же — ждём следующего «тика» табло
  const html = items.map((item) => `<span>${item}</span>`).join('');
  if (hud.innerHTML !== html) hud.innerHTML = html;
  hudAt = now;
  hudCount = items.length;
}

const banner = element('#banner');
let bannerTimer = 0;
export function showBanner(text: string, ms = 1800): void {
  banner.textContent = text;
  banner.hidden = false;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(hideBanner, ms);
}
export function hideBanner(): void {
  banner.hidden = true;
}
