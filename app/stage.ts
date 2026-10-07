// Холст с трассой: камера, отрисовка сцены, подсказки поверх (HUD, баннер).
import { Camera, fitCanvas, clear, drawTrack } from '../engine/draw/render.ts';
import { drawTraffic, drawCar, drawSensors, drawPack, type CarView, type CarLook, type PackCar } from '../engine/draw/car-draw.ts';
import { TILT } from '../engine/core/tilt.ts';
import { Chase, viewOf, CHASE } from '../engine/draw/cockpit/camera.ts';
import { drawCockpit, type CockpitScene } from '../engine/draw/cockpit/scene.ts';
import { setSceneryMotion } from '../engine/draw/scenery-draw.ts';
import { trafficAt, type TrafficSpot } from '../engine/world/traffic.ts';
import { lapOf, type Track } from '../engine/world/track.ts';
import type { Point } from '../engine/world/turtle.ts';
import { clamp } from '../engine/core/utils.ts';
import { liveSize, calm, phone } from './ui.ts';
import { element } from './dom.ts';
import { effect } from '@reely/dommy';
import { listen } from '@reely/dommy-kit';

export const canvas = element<HTMLCanvasElement>('#stage');
const ctx = context2d(canvas);
const canvasSize = liveSize(canvas);
const cam = new Camera();
let dpr = 1;

// Ветряк у трассы крутится, только если человек не просил в системе меньше движения
effect(() => setSceneryMotion(!calm.value));

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
let viewportRatio = '';
function fitViewport(track: Track, camera: string): void {
  const b = track.bbox;
  const ratio = camera === 'fit' && phone.value ? clamp((b.maxX - b.minX + 80) / ((b.maxY - b.minY + 80) * TILT), 0.9, 2.2).toFixed(2) : ''; // пол сжат наклоном
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
  setStageLabel('Трасса');
  cam.mode = camera;
  cam.update(canvas, track, follow, dpr);
  clear(ctx, canvas);
  cam.apply(ctx, canvas);
  drawTrack(ctx, track, cam, tick);
  drawTraffic(ctx, traffic);
}

const chase = new Chase();
/** Откуда смотреть на заезд: сверху, камерой за машиной, — или из машины (#25) */
export type RideView = 'top' | 'cockpit';

/**
 * Кадр заезда за одной машиной: scene.me с сенсорами и номером, полупрозрачный призрак, трафик.
 * Одна сцена — оба вида. Из машины всё высокое (машины, деревья) рисуется одним списком по глубине:
 * в перспективе дерево может стоять перед машиной, поэтому машины вкладка поверх не дорисовывает
 */
export function drawRide(track: Track, scene: CockpitScene, view: RideView = 'top'): void {
  const { me, ghost, traffic = null, tick = 0 } = scene;
  if (view === 'cockpit') {
    fitViewport(track, 'follow');
    setStageLabel('Трасса, вид из машины');
    chase.follow(me.car, calm.value ? CHASE.calm : CHASE.smooth); // меньше движения — камера поворачивает мягче
    drawCockpit(ctx, track, viewOf(chase, canvas), { ...scene, dpr });
    return;
  }
  drawScene(track, { camera: 'follow', follow: me.car, traffic, tick });
  if (ghost) paintCar(ghost.car, { color: ghost.color, alpha: ghost.alpha, label: ghost.label });
  paintCar(me.car, { color: me.color, sensors: true, number: 1 });
}

/** Подпись холста для читалки экрана: какой вид сейчас */
export function setStageLabel(text: string): void {
  if (canvas.getAttribute('aria-label') !== text) canvas.setAttribute('aria-label', text);
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
export const toScreen = (x: number, y: number): Point => cam.toScreen(canvas, x, y);

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
/**
 * Короткая надпись поверх трассы. head — первое слово крупным акцентом («Авария!», «Финиш!»).
 * Встаёт сразу под табло (--below): на полосе «Я учу» она не закрывает ни машину, ни дорогу впереди
 */
export function showBanner(text: string, ms = 1800, head = ''): void {
  banner.replaceChildren(...(head ? [Object.assign(document.createElement('b'), { textContent: head }), ' '] : []), text);
  banner.style.setProperty('--below', `${hud.offsetTop + hud.offsetHeight + 8}px`);
  banner.hidden = false;
  clearTimeout(bannerTimer);
  if (ms) bannerTimer = setTimeout(hideBanner, ms);
}
export function hideBanner(): void {
  banner.hidden = true;
}
