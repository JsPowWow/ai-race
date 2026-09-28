// Стенд: машина бота на прямом участке «Разминки». Колёса крутятся, дорога бежит, а сама машина
// не уезжает — поэтому можно спокойно зажать сенсор и посмотреть, что сделает мозг.
import { Camera, fitCanvas, clear, drawTrack, drawCar, cssColor } from '../engine/render.js';
import { Car } from '../engine/car.js';
import { BUTTONS, NOTES } from '../engine/brain.js';
import { getTrainingTrack, pointAt } from '../engine/track.js';
import { parseCarFile } from '../engine/car-file.js';
import { thinkVariants, feedForward } from '../student/think.js';
import { liveSize } from './ui.js';

const SECTION = 150; // шаг швов игрушечной трассы: перескок на секцию назад незаметен
const LOOP_FROM = 330; // участок «Разминки» от 330 до 480 — прямой, стартовая линия за кадром
const PRESSED = 0.75; // зажатый сенсор «видит» стену прямо перед машиной (0.9 спряталась бы под капотом)

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} file файл бота (tools/bots.json)
 */
export function createStand(canvas, file) {
  const bot = parseCarFile(file);
  // берём исходный вариант «думания», а не правки ученика: демо на титульной работает всегда
  const think = thinkVariants[bot.thinkId].think;
  const track = getTrainingTrack('warmup');
  const home = pointAt(track, LOOP_FROM);
  const car = new Car(track, { brain: bot.brain, think: null, sensors: bot.sensors });
  const cam = new Camera();
  const size = liveSize(canvas);
  const ctx = canvas.getContext('2d');
  const pressed = new Set();
  let trace = null;
  car.x = home.x; car.y = home.y; car.angle = home.angle;

  /** Один тик: сенсоры → мозг → педали. Скорость меняется по-настоящему, а место — нет */
  function tick() {
    car.sense(track, null);
    for (const i of pressed) { car.readings[i] = PRESSED; car.rayT[i] = 1 - PRESSED; }
    const inputs = car.inputs(); // сейчас, скорость, мгновение назад, знак, заметки — как в настоящем заезде
    car.before = car.readings.slice();
    const out = think(inputs, bot.brain);
    trace = feedForward.lastTrace.map((l) => [...l]);
    const [gas, brake, left, right] = out;
    Object.assign(car.controls, { gas, brake, left, right });
    car.notes = out.slice(BUTTONS.length, BUTTONS.length + NOTES);
    car.move();
    car.angle = home.angle; // руль виден по колёсам, а сама машина не поворачивает
    const along = (car.x - home.x) * Math.cos(home.angle) + (car.y - home.y) * Math.sin(home.angle);
    const back = along > SECTION ? SECTION : along < 0 ? -SECTION : 0;
    car.x = home.x + (along - back) * Math.cos(home.angle); car.y = home.y + (along - back) * Math.sin(home.angle);
    cam.x -= back * Math.cos(home.angle); cam.y -= back * Math.sin(home.angle); // камера перескакивает вместе с машиной
    return trace;
  }

  function draw() {
    const dpr = fitCanvas(canvas, size);
    cam.mode = 'follow';
    cam.update(canvas, track, car, dpr * 0.85); // чуть мельче, чем на «Я учу»: дорога с бордюрами целиком по высоте
    clear(ctx, canvas);
    cam.apply(ctx, canvas);
    drawTrack(ctx, track, cam);
    drawCar(ctx, car, { color: file.color, sensors: true, cam, number: 1 });
    // зажатые сенсоры: у конца — красная «стена», в которую он упёрся
    ctx.strokeStyle = cssColor('--kerb'); ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (const i of pressed) {
      const a = rayAngle(i), d = car.sensors.length * (1 - PRESSED);
      const x = car.x + Math.cos(a) * d, y = car.y + Math.sin(a) * d;
      ctx.beginPath(); ctx.moveTo(x - Math.sin(a) * 9, y + Math.cos(a) * 9); ctx.lineTo(x + Math.sin(a) * 9, y - Math.cos(a) * 9); ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  const rayAngle = (i) => {
    const { count, spread } = car.sensors, half = (spread * Math.PI) / 360;
    return car.angle + (count === 1 ? 0 : -half + (2 * half * i) / (count - 1));
  };

  // сенсор можно зажать и прямо на стенде: ближайший к пальцу
  let holding = null;
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect(), dpr = canvas.width / r.width;
    const w = cam.toWorld(canvas, (e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    const dist = Math.hypot(w.x - car.x, w.y - car.y);
    if (dist < 20 || dist > car.sensors.length + 20) return;
    const a = Math.atan2(w.y - car.y, w.x - car.x);
    let best = -1, bestD = 0.2; // не дальше ~11° от сенсора
    for (let i = 0; i < car.sensors.count; i++) {
      const d = Math.abs(Math.atan2(Math.sin(a - rayAngle(i)), Math.cos(a - rayAngle(i))));
      if (d < bestD) { best = i; bestD = d; }
    }
    if (best < 0) return;
    holding = { id: e.pointerId, i: best }; pressed.add(best); canvas.setPointerCapture(e.pointerId);
  });
  const up = (e) => { if (holding?.id === e.pointerId) { pressed.delete(holding.i); holding = null; } };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  return {
    brain: bot.brain,
    sensorCount: bot.sensors.count,
    pressed,
    /** Зажать (down) или отпустить сенсор i — например, с табло мозга */
    press(i, down) { if (down) pressed.add(i); else pressed.delete(i); },
    tick,
    draw,
  };
}
