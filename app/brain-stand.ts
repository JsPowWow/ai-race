// Стенд: машина бота на прямом участке «Разминки». Колёса крутятся, дорога бежит, а сама машина
// не уезжает — поэтому можно спокойно зажать сенсор и посмотреть, что сделает мозг.
// Сенсоры видят настоящую «Разминку», а рисуем бесконечную прямую с лесом: она повторяется через PERIOD px,
// и на этом шаге совпадают швы, полоски бордюра и деревья — стыка не видно, а пробег не растёт без конца.
import { Camera, fitCanvas, clear, drawStraight, drawCar, cssColor, getPalette } from '../engine/render.ts';
import { drawDecor } from '../engine/scenery-draw.ts';
import { stripScenery, type Tree, type House } from '../engine/scenery.ts';
import { Car } from '../engine/car.ts';
import { BUTTONS, NOTES } from '../engine/brain.ts';
import type { Brain } from '../engine/brain.ts';
import { getTrainingTrack, pointAt } from '../engine/track.ts';
import { parseCarFile } from '../engine/car-file.ts';
import { thinkVariants, feedForward } from '../student/think.js';
import { liveSize } from './ui.ts';
import { listen } from '@reely/dommy-kit';

const PERIOD = 2400; // через сколько px прямая повторяется: кратно секции (150) и паре блоков бордюра (32)
const HOME = 1150; // место на «Разминке», где стоит машина: длинная прямая напротив старта
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
  const home = pointAt(track, HOME);
  const strip = stripScenery(PERIOD, track.width);
  // копии декора, сдвинутые на пробег: массивы одни на всё время, каждый кадр только меняем x
  const trees: Tree[] = strip.trees.map((t) => ({ ...t })), houses: House[] = strip.houses.map((h) => ({ ...h }));
  let run = 0; // сколько проехали по кругу длиной PERIOD
  /** Машина на рисунке: в своих осях стенда она всегда в (0, 0) и смотрит вправо */
  const view = { x: 0, y: 0, angle: 0 };
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
  const rayAngle = (i: number) => view.angle + car.rays[i].angle;
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
    // сколько проехала вдоль дороги — на столько сдвигаем дорогу, а машину ставим обратно: она стоит на месте
    const along = (car.x - home.x) * Math.cos(home.angle) + (car.y - home.y) * Math.sin(home.angle);
    run = (run + along) % PERIOD;
    car.x = home.x;
    car.y = home.y;
    car.angle = home.angle; // руль виден по колёсам, а сама машина не поворачивает
    return trace;
  }

  function draw(): void {
    if (!ctx) return;
    const dpr = fitCanvas(canvas, size);
    cam.mode = 'follow';
    cam.update(canvas, track, view, dpr * 0.85); // чуть мельче, чем на «Я учу»: дорога с бордюрами целиком по высоте
    clear(ctx, canvas);
    cam.apply(ctx, canvas);
    const half = canvas.width / cam.scale / 2 + 80; // сколько дороги видно от машины в каждую сторону, с запасом
    drawStraight(ctx, run, half, track.width, cam);
    shiftDecor(trees, strip.trees);
    shiftDecor(houses, strip.houses);
    drawDecor(ctx, trees.filter((t) => Math.abs(t.x) < half), houses.filter((h) => Math.abs(h.x) < half), getPalette());
    drawCar(ctx, { ...view, status: car.status, done: car.done, controls: car.controls, steer: car.steer, speed: car.speed, roll: car.roll, rayT: car.rayT, sensors: car.sensors }, { color: file.color, sensors: true, number: 1 });
    // зажатые сенсоры: у конца — красная «стена», в которую он упёрся
    ctx.strokeStyle = cssColor('--kerb');
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const i of pressed) {
      const a = car.rays[i].angle, d = car.rays[i].length * (1 - PRESSED);
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      ctx.beginPath();
      ctx.moveTo(x - Math.sin(a) * 9, y + Math.cos(a) * 9);
      ctx.lineTo(x + Math.sin(a) * 9, y - Math.cos(a) * 9);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  /** Декор на прямой — туда, где он сейчас относительно машины: x от −PERIOD/2 до PERIOD/2 */
  function shiftDecor(out: (Tree | House)[], from: (Tree | House)[]): void {
    for (let i = 0; i < from.length; i++) {
      out[i].x = (((from[i].x - run) % PERIOD) + PERIOD + PERIOD / 2) % PERIOD - PERIOD / 2;
    }
  }

  /** Сенсор вперёд, ближайший к точке холста (или -1, если палец не у сенсора) */
  function sensorAt(e: PointerEvent): number {
    const r = canvas.getBoundingClientRect(), dpr = canvas.width / r.width;
    const w = cam.toWorld(canvas, (e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    const dist = Math.hypot(w.x - view.x, w.y - view.y); // в осях стенда машина в (0, 0)
    if (dist < 20 || dist > car.sensors.length + 20) return -1;
    const a = Math.atan2(w.y - view.y, w.x - view.x);
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
