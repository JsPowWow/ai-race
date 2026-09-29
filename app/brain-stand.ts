// Стенд: машина бота на прямом участке «Разминки». Колёса крутятся, дорога бежит, а сама машина
// не уезжает — поэтому можно спокойно зажать сенсор и посмотреть, что сделает мозг.
import { Camera, fitCanvas, clear, drawTrack, drawCar, cssColor } from '../engine/render.ts';
import { Car } from '../engine/car.ts';
import { BUTTONS, NOTES } from '../engine/brain.ts';
import type { Brain } from '../engine/brain.ts';
import { getTrainingTrack, pointAt } from '../engine/track.ts';
import { parseCarFile } from '../engine/car-file.ts';
import { thinkVariants, feedForward } from '../student/think.js';
import { liveSize } from './ui.ts';
import { listen } from '@reely/dommy/kit';

const SECTION = 150; // шаг швов игрушечной трассы: перескок на секцию назад незаметен
const LOOP_FROM = 1100; // участок «Разминки» от 1100 до 1250 — длинная прямая напротив старта, черта за кадром
const PRESSED = 0.75; // зажатый сенсор «видит» стену прямо перед машиной (0.9 спряталась бы под капотом)
const PICK_ANGLE = 0.2; // палец ловит сенсор, если промахнулся не больше чем на ~11°

/** Стенд с ботом: tick() — один шаг мозга, draw() — кадр, press() — зажать сенсор снаружи (с табло) */
export type Stand = {
  brain: Brain;
  /** Номера зажатых сенсоров — общие со стендом и табло */
  pressed: Set<number>;
  press(i: number, down: boolean): void;
  /** Один тик: сенсоры → мозг → педали. Возвращает, что горело в каждом слое сети */
  tick(): number[][];
  draw(): void;
};

/**
 * @param canvas холст стенда
 * @param file файл бота (tools/bots.json): цвет берём из него
 */
export function createStand(canvas: HTMLCanvasElement, file: { color: string }): Stand {
  const bot = parseCarFile(file);
  // берём исходный вариант «думания», а не правки ученика: демо на титульной работает всегда
  const think = thinkVariants[bot.thinkId as keyof typeof thinkVariants].think;
  const track = getTrainingTrack('warmup');
  const home = pointAt(track, LOOP_FROM);
  const car = new Car(track, { brain: bot.brain, think: null, sensors: bot.sensors });
  const cam = new Camera();
  const size = liveSize(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('холст стенда без 2d');
  const pressed = new Set<number>();
  car.x = home.x;
  car.y = home.y;
  car.angle = home.angle;

  /** Куда смотрит сенсор i (угол в мире) и где у него конец. Лучи те же, что у машины: car.rays */
  const rayAngle = (i: number) => car.angle + car.rays[i].angle;
  const frontCount = car.sensors.count; // зажимаются только сенсоры вперёд: их видно на табло кружками s1…

  function tick(): number[][] {
    car.sense(track, null);
    for (const i of pressed) {
      car.readings[i] = PRESSED;
      car.rayT[i] = 1 - PRESSED;
    }
    const inputs = car.inputs(); // сейчас, скорость, мгновение назад, знак, заметки — как в настоящем заезде
    car.before = car.readings.slice();
    const out = think(inputs, bot.brain);
    const trace: number[][] = (feedForward.lastTrace ?? []).map((layer: number[]) => [...layer]);
    const [gas, brake, left, right] = out;
    Object.assign(car.controls, { gas, brake, left, right });
    car.notes = out.slice(BUTTONS.length, BUTTONS.length + NOTES);
    car.move();
    car.angle = home.angle; // руль виден по колёсам, а сама машина не поворачивает
    // уехала на секцию вперёд (или назад) — переносим её и камеру обратно: шов дороги не заметен
    const along = (car.x - home.x) * Math.cos(home.angle) + (car.y - home.y) * Math.sin(home.angle);
    const back = along > SECTION ? SECTION : along < 0 ? -SECTION : 0;
    car.x = home.x + (along - back) * Math.cos(home.angle);
    car.y = home.y + (along - back) * Math.sin(home.angle);
    cam.x -= back * Math.cos(home.angle);
    cam.y -= back * Math.sin(home.angle);
    return trace;
  }

  function draw(): void {
    if (!ctx) return;
    const dpr = fitCanvas(canvas, size);
    cam.mode = 'follow';
    cam.update(canvas, track, car, dpr * 0.85); // чуть мельче, чем на «Я учу»: дорога с бордюрами целиком по высоте
    clear(ctx, canvas);
    cam.apply(ctx, canvas);
    drawTrack(ctx, track, cam);
    drawCar(ctx, car, { color: file.color, sensors: true, cam, number: 1 });
    // зажатые сенсоры: у конца — красная «стена», в которую он упёрся
    ctx.strokeStyle = cssColor('--kerb');
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const i of pressed) {
      const a = rayAngle(i), d = car.rays[i].length * (1 - PRESSED);
      const x = car.x + Math.cos(a) * d, y = car.y + Math.sin(a) * d;
      ctx.beginPath();
      ctx.moveTo(x - Math.sin(a) * 9, y + Math.cos(a) * 9);
      ctx.lineTo(x + Math.sin(a) * 9, y - Math.cos(a) * 9);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  /** Сенсор вперёд, ближайший к точке холста (или -1, если палец не у сенсора) */
  function sensorAt(e: PointerEvent): number {
    const r = canvas.getBoundingClientRect(), dpr = canvas.width / r.width;
    const w = cam.toWorld(canvas, (e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    const dist = Math.hypot(w.x - car.x, w.y - car.y);
    if (dist < 20 || dist > car.sensors.length + 20) return -1;
    const a = Math.atan2(w.y - car.y, w.x - car.x);
    let best = -1, bestMiss = PICK_ANGLE;
    for (let i = 0; i < frontCount; i++) {
      const miss = Math.abs(Math.atan2(Math.sin(a - rayAngle(i)), Math.cos(a - rayAngle(i))));
      if (miss < bestMiss) {
        best = i;
        bestMiss = miss;
      }
    }
    return best;
  }

  // сенсор можно зажать и прямо на стенде: ближайший к пальцу
  let holding: { id: number; i: number } | null = null;
  listen(canvas, 'pointerdown', (e) => {
    const i = sensorAt(e);
    if (i < 0) return;
    holding = { id: e.pointerId, i };
    pressed.add(i);
    canvas.setPointerCapture(e.pointerId);
  });
  const release = (e: PointerEvent) => {
    if (holding?.id !== e.pointerId) return;
    pressed.delete(holding.i);
    holding = null;
  };
  listen(canvas, 'pointerup', release);
  listen(canvas, 'pointercancel', release);

  return {
    brain: bot.brain,
    pressed,
    press(i, down) {
      if (down) pressed.add(i);
      else pressed.delete(i);
    },
    tick,
    draw,
  };
}
