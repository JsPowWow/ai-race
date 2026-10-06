// Титульная страница: о чём курс, живое демо бота, «потрогай мозг» (стенд + табло), дорожка уроков.
// Почти вся страница — статичный текст в app/markup.html: его удобно читать и править как документ.
// Здесь — то, что живёт: демо-заезд, стенд с табло мозга и фрагмент настоящего файла бота (он строится из данных бота).
import { mount } from '@reely/dommy';
import { Camera, fitCanvas, clear, drawTrack } from '../../engine/draw/render.ts';
import { drawTraffic, drawCar } from '../../engine/draw/car-draw.ts';
import { withTraffic, trafficAt } from '../../engine/world/traffic.ts';
import { Car, maxTicksFor } from '../../engine/world/car.ts';
import { parseCarFile } from '../../engine/course/car-file.ts';
import { thinkVariants } from '../../student/think.js';
import { createStand } from '../brain-stand.ts';
import { createBrainBoard } from '../brain-board/board.js';
import { seedTrack } from '../tracks.ts';
import { BOTS } from '../generated/bots.js';
import { liveSize } from '../ui.ts';
import { element } from '../dom.ts';

const DEMO_SEED = 'витрина';
const DEMO_SPEED = 3; // тиков за кадр
const PAUSE_AFTER_FINISH = 1200; // мс: доехал — постоял, поехал снова

type BotFile = (typeof BOTS)[number];
const toretto: BotFile = BOTS.find((b) => b.name === 'Торетто') ?? BOTS[0];
// Демо едет на исходном think.js, а не на правках ученика: титульная работает, даже если код на «Коде» сломан
const bot = parseCarFile(toretto);
const demoDriver = { brain: bot.brain, sensors: bot.sensors, think: thinkVariants[bot.thinkId as keyof typeof thinkVariants].think };

// ── демо: бот едет по трассе, которую видит впервые ──

const canvas = element<HTMLCanvasElement>('#introCanvas');
const canvasSize = liveSize(canvas);
const ctx = canvas.getContext('2d');
const cam = new Camera();
cam.mode = 'fit';
const track = withTraffic(seedTrack(DEMO_SEED), 'all');
let car = new Car(track, demoDriver);
let pauseUntil = 0;

function drawDemo(): void {
  if (!car.done) {
    for (let k = 0; k < DEMO_SPEED && !car.done; k++) car.step(track, maxTicksFor(track), trafficAt(track, track.traffic, car.ticks));
  } else {
    pauseUntil ||= performance.now() + PAUSE_AFTER_FINISH;
    if (performance.now() > pauseUntil) {
      car = new Car(track, demoDriver);
      pauseUntil = 0;
    }
  }
  if (!ctx) return;
  const dpr = fitCanvas(canvas, canvasSize);
  cam.update(canvas, track, null, dpr);
  clear(ctx, canvas);
  cam.apply(ctx, canvas);
  drawTrack(ctx, track, cam);
  drawTraffic(ctx, trafficAt(track, track.traffic, car.ticks));
  drawCar(ctx, car, { color: toretto.color, sensors: true, cam });
}

// ── «Потрогай мозг»: стенд и табло одного бота, зажатый сенсор общий ──

const stand = createStand(element<HTMLCanvasElement>('#standCanvas'), toretto);
const board = createBrainBoard({
  canvas: element<HTMLCanvasElement>('#brainBoard'), card: element('#brainFormula'), zoomBar: element<HTMLElement>('.intro-brain .zoom'), brain: stand.brain,
  onSensor: (i: number, down: boolean) => stand.press(i, down),
});
let lastFrame = performance.now();

function drawBrain(): void {
  const now = performance.now();
  const trace = stand.tick();
  stand.draw();
  board.frame(trace, stand.pressed, (now - lastFrame) / 1000);
  lastFrame = now;
}

// ── файл мозга: настоящий фрагмент файла с весами того же бота, что на стенде ──

const round = (x: number) => Math.round(x * 100) / 100;
const short = (list: number[], n = 3) => `[${list.slice(0, n).map(round).join(', ')}, …]`;

/** Начало файла бота, как его видно в редакторе: всё, кроме тысяч весов */
function preview(file: BotFile): string {
  const [first] = file.brain.layers;
  return [
    '{',
    `  "format": "${file.format}",`,
    `  "name": "${file.name}",`,
    `  "sensors": { "count": ${file.sensors.count}, "spread": ${file.sensors.spread}, "length": ${file.sensors.length} },`,
    `  "think": "${file.think}",`,
    `  "layers": [${file.layers.join(', ')}],`,
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

/** 1 число, 2 числа, 5 чисел */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function BrainFile({ file }: { file: BotFile }): Node {
  const numbers = file.brain.layers.reduce((n, l) => n + l.biases.length + l.weights.flat().length, 0);
  const size = `${(JSON.stringify(file).length / 1024).toFixed(1).replace('.', ',')} КБ`;
  return (
    <>
      <p>Весь «мозг» машины — это маленький файл: <b>{size}</b>, в нём <b>{`${numbers} ${plural(numbers, 'число', 'числа', 'чисел')}`}</b>. Обучение — это поиск правильных чисел. Этот файл вы и приносите на гонку.</p>
      <pre tabIndex={0} aria={{ ariaLabel: 'Фрагмент файла с весами' }}>{preview(file)}</pre>
    </>
  );
}

mount(element('#brainFile'), () => <BrainFile file={toretto} />);

export const introTab = {
  enter() {
    car = new Car(track, demoDriver); // каждый раз смотрим заезд с начала
    pauseUntil = 0;
    lastFrame = performance.now(); // табло не «догоняет» время, пока вкладка была закрыта
  },
  frame() {
    drawDemo();
    drawBrain();
  },
};

/** После смены темы: табло берёт цвета из токенов */
export const redrawIntro = () => board.readColors();
