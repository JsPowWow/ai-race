// Титульная страница: о чём курс, живое демо бота, «потрогай мозг» (стенд + табло), дорожка уроков.
import { Camera, fitCanvas, clear, drawTrack, drawTraffic, drawCar } from '../../engine/render.js';
import { createStand } from '../brain-stand.js';
import { createBrainBoard } from '../brain-board/board.js';
import { inputLabels, OUTPUT_LABELS, NOTES } from '../../engine/brain.js';
import { withTraffic, trafficAt } from '../../engine/traffic.js';
import { Car, maxTicksFor } from '../../engine/car.js';
import { fromCarFile } from '../car-file.js';
import { seedTrack } from '../tracks.js';
import { BOTS } from '../generated/bots.js';
import { $, liveSize } from '../ui.js';

const DEMO_SEED = 'витрина';
const DEMO_SPEED = 3; // тиков за кадр
const toretto = BOTS.find((b) => b.name === 'Торетто') ?? BOTS[0];
const demoBot = fromCarFile(toretto);

const canvas = $('#introCanvas');
const canvasSize = liveSize(canvas);
const ctx = canvas.getContext('2d');
const cam = new Camera();
const track = withTraffic(seedTrack(DEMO_SEED), 'all');
let car = null;
let pauseUntil = 0;

// «Потрогай мозг»: стенд и табло одного бота, зажатый сенсор общий
const stand = createStand($('#standCanvas'), toretto);
const board = createBrainBoard({
  canvas: $('#brainBoard'), card: $('#brainFormula'), zoomBar: $('.brain-board .zoom'), brain: stand.brain, sensorCount: stand.sensorCount,
  notes: NOTES,
  labels: {
    inputs: inputLabels(stand.sensorCount),
    outputs: OUTPUT_LABELS,
    // [обычная подпись, короткая — для узкого экрана]
    frames: {
      input: [[`СЕНСОРЫ s1–s${stand.sensorCount} и скорость v`, 'пунктир — мгновение назад'], ['СЕНСОРЫ и v', '']],
      notesIn: [['ЗАМЕТКИ m1–m3', 'с прошлого шага'], ['ЗАМЕТКИ', '']],
      hidden: [[`СЛОЙ · ${toretto.layers[1]} нейронов`, 'tanh(2z)'], [`СЛОЙ · ${toretto.layers[1]}`, '']],
      buttons: [['ПУЛЬТ', 'σ(3z)'], ['ПУЛЬТ', '']],
      notesOut: [['ЗАМЕТКИ', 'на следующий шаг'], ['ЗАМЕТКИ', '']],
    },
    loop: ['заметки → на вход следующего шага', '→ на следующий шаг'],
    past: ['было', 'сейчас'], // подписи над первой парой кружков
  },
  onSensor: (i, down) => stand.press(i, down),
});
let lastFrame = performance.now();

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
    drawCar(ctx, car, { color: demoBot.color, sensors: true, cam });

    const now = performance.now();
    const trace = stand.tick();
    stand.draw();
    board.frame(trace, stand.pressed, (now - lastFrame) / 1000);
    lastFrame = now;
  },
};

/** Настоящий фрагмент файла с весами того же бота, что на стенде */
function renderBrain() {
  const numbers = toretto.brain.layers.reduce((n, l) => n + l.biases.length + l.weights.flat().length, 0);
  $('#brainCount').textContent = `${numbers} ${plural(numbers, 'число', 'числа', 'чисел')}`;
  $('#brainSize').textContent = `${(JSON.stringify(toretto).length / 1024).toFixed(1).replace('.', ',')} КБ`;
  $('#brainJson').textContent = preview(toretto);
}

/** После смены темы: табло берёт цвета из токенов */
export const redrawIntro = () => board.readColors();

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
