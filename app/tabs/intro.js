// Титульная страница: о чём курс, живое демо бота, как устроен «мозг», дорожка уроков.
import { Camera, fitCanvas, clear, drawTrack, drawTraffic, drawCar } from '../../engine/render.js';
import { drawNetwork } from '../../engine/netviz.js';
import { withTraffic, trafficAt } from '../../engine/traffic.js';
import { Car, maxTicksFor } from '../../engine/car.js';
import { fromCarFile } from '../car-file.js';
import { seedTrack } from '../tracks.js';
import { BOTS } from '../generated/bots.js';
import { $, liveSize } from '../ui.js';

const DEMO_SEED = 'витрина';
const DEMO_SPEED = 3; // тиков за кадр
const demoBot = fromCarFile(BOTS.find((b) => b.name === 'Сквозняк') ?? BOTS[0]);
const smallBot = BOTS.reduce((a, b) => (JSON.stringify(a).length <= JSON.stringify(b).length ? a : b));

const canvas = $('#introCanvas');
const canvasSize = liveSize(canvas);
const ctx = canvas.getContext('2d');
const cam = new Camera();
const track = withTraffic(seedTrack(DEMO_SEED), 'all');
let car = null;
let pauseUntil = 0;

export const introTab = {
  enter() {
    car = new Car(track, demoBot);
    renderBrain();
  },
  frame() {
    const dpr = fitCanvas(canvas, canvasSize);
    if (!car.done) {
      for (let k = 0; k < DEMO_SPEED && !car.done; k++) car.step(track, maxTicksFor(track), trafficAt(track, track.traffic, car.ticks));
    } else {
      pauseUntil ||= performance.now() + 1200;
      if (performance.now() > pauseUntil) {
        car = new Car(track, demoBot);
        pauseUntil = 0;
      }
    }
    cam.mode = 'fit';
    cam.update(canvas, track, null, dpr);
    clear(ctx, canvas);
    cam.apply(ctx, canvas);
    drawTrack(ctx, track, cam);
    drawTraffic(ctx, trafficAt(track, track.traffic, car.ticks));
    drawCar(ctx, car, { color: demoBot.color, sensors: true, glow: true, cam });
  },
};

/** Схема сети и настоящий фрагмент файла с весами */
function renderBrain() {
  drawNetwork($('#introNet'), smallBot.brain);
  const numbers = smallBot.brain.layers.reduce((n, l) => n + l.biases.length + l.weights.flat().length, 0);
  $('#brainCount').textContent = `${numbers} ${plural(numbers, 'число', 'числа', 'чисел')}`;
  $('#brainSize').textContent = `${(JSON.stringify(smallBot).length / 1024).toFixed(1).replace('.', ',')} КБ`;
  $('#brainJson').textContent = preview(smallBot);
}

export const redrawIntro = () => drawNetwork($('#introNet'), smallBot.brain);

const round = (x) => Math.round(x * 100) / 100;
const short = (list, n = 3) => `[${list.slice(0, n).map(round).join(', ')}, …]`;

function preview(bot) {
  const [first] = bot.brain.layers;
  return [
    '{',
    `  "name": "${bot.name}",`,
    `  "sensors": { "count": ${bot.sensors.count}, "spread": ${bot.sensors.spread}, "length": ${bot.sensors.length} },`,
    `  "layers": [${bot.layers.join(', ')}],`,
    '  "brain": { "layers": [',
    '    {',
    `      "weights": [${short(first.weights[0])}, ${short(first.weights[1])}, …],`,
    `      "biases": ${short(first.biases)}`,
    '    },',
    '    …',
    '  ] }',
    '}',
  ].join('\n');
}

function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
