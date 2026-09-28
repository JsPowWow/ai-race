// Опыт для задачи #4 «Память в сети»: помогает ли память и не хитрит ли сеть на «Я учу».
// Запуск: node tools/memory-experiment.mjs   (несколько минут)
//
// Память = прошлые показания сенсоров + свои 4 нажатия прошлого тика — ещё входы сети.
// Сравниваем мозг без памяти и с памятью:
//   А. Рой (как боты): поколения, мутации, фитнес — пройденное расстояние.
//   Б. Обучение на примерах (как «Я учу»): учитель ездит, сеть учится повторять.
//      Подозрение (copycat): с памятью сеть выучит «жми то же, что в прошлый тик» —
//      совпадение с учителем высокое, а сама не поедет.
import { getTrainingTrack, generateTrack } from '../engine/track.js';
import { withTraffic } from '../engine/traffic.js';
import { Car, CAR, carReport, maxTicksFor } from '../engine/car.js';
import { createBrain, cloneBrain, OUTPUTS } from '../engine/brain.js';
import { trainEpoch, agreement, worthLearning } from '../engine/imitation.js';
import { mulberry32 } from '../engine/utils.js';
import { thinkVariants } from '../student/think.js';
import { mutate } from '../student/mutate.js';

const SENSORS = { count: 7, spread: 120, length: 180 };
const HIDDEN = [8];
const smooth = thinkVariants.smooth.think;

/** Мозг с памятью или без: сколько входов и как их собрать */
const plain = { name: 'без памяти', inputs: SENSORS.count + 1, driver: () => smooth };
/** Память только о своих нажатиях: «я только что жал газ и влево» */
const buttons = {
  name: 'помнит нажатия',
  inputs: SENSORS.count + 1 + OUTPUTS,
  driver: () => {
    let prevOut = new Array(OUTPUTS).fill(0);
    return (inputs, brain) => {
      const out = smooth([...inputs, ...prevOut], brain);
      prevOut = out.map((v) => (v > 0.5 ? 1 : 0));
      return out;
    };
  },
};
const memory = {
  name: 'помнит нажатия и сенсоры',
  inputs: SENSORS.count + 1 + SENSORS.count + OUTPUTS,
  // у каждой машины своя память: прошлые сенсоры и прошлые нажатия, на старте — нули
  driver: () => {
    let prevSensors = new Array(SENSORS.count).fill(0), prevOut = new Array(OUTPUTS).fill(0);
    return (inputs, brain) => {
      const out = smooth([...inputs, ...prevSensors, ...prevOut], brain);
      prevSensors = inputs.slice(0, SENSORS.count);
      prevOut = out.map((v) => (v > 0.5 ? 1 : 0)); // помним, какие кнопки были нажаты
      return out;
    };
  },
};

function drive(track, brain, kind) {
  const car = new Car(track, { brain, think: kind.driver(), sensors: SENSORS });
  const max = maxTicksFor(track);
  while (!car.done) car.step(track, max);
  return carReport(car, track);
}

const training = (id) => withTraffic(getTrainingTrack(id), 'same');
const random = (seed) => withTraffic(generateTrack(seed), 'same');
/** Проверка — трассы, которых мозг не видел */
const EXAM = ['экзамен-1', 'экзамен-2', 'экзамен-3', 'экзамен-4', 'экзамен-5', 'финал', '42'].map(random);
const examScore = (brain, kind) => {
  const r = EXAM.map((t) => drive(t, brain, kind));
  return { pct: r.reduce((s, x) => s + x.progressPct, 0) / r.length, finished: r.filter((x) => x.finished).length };
};

/** Детерминированный Math.random на время опыта: оба варианта получают одинаковую «удачу» */
function withSeed(seed, fn) {
  const saved = Math.random;
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = saved; }
}

// ── А. Рой ──
function swarm(kind, seed) {
  return withSeed(seed, () => {
    const sizes = [kind.inputs, ...HIDDEN, OUTPUTS];
    let parent = null;
    for (let gen = 0; gen < 40; gen++) {
      const tracks = [training('snake'), training('hairpin'), random(`mem-${seed}-${gen}`)];
      let best = null, bestScore = -Infinity;
      for (let i = 0; i < 50; i++) {
        const brain = parent ? cloneBrain(parent) : createBrain(sizes);
        if (parent && i > 0) mutate(brain, 0.1);
        const score = tracks.reduce((s, t) => s + drive(t, brain, kind).progress, 0);
        if (score > bestScore) [best, bestScore] = [brain, score];
      }
      parent = best;
    }
    return parent;
  });
}

// ── Б. Обучение на примерах ──
/**
 * Учитель, похожий на человека с клавиатурой: кнопки нажаты целиком (0 или 1) и держатся несколько тиков.
 * Газ, пока впереди свободно; руль — в сторону, где больше места.
 */
function teacherDriver() {
  let hold = { left: 0, right: 0, until: 0 }, tick = 0;
  return (inputs) => {
    tick++;
    const s = inputs.slice(0, SENSORS.count), mid = Math.floor(SENSORS.count / 2);
    const leftRoom = s.slice(0, mid).reduce((a, v) => a + v, 0), rightRoom = s.slice(mid + 1).reduce((a, v) => a + v, 0);
    if (tick >= hold.until) {
      const d = rightRoom - leftRoom; // больше «видно стену» справа — рулим влево
      hold = { left: d > 0.15 ? 1 : 0, right: d < -0.15 ? 1 : 0, until: tick + 6 };
    }
    const front = s[mid], speed = inputs[SENSORS.count];
    const brake = front > 0.6 && speed > 0.5 ? 1 : 0;
    return [brake ? 0 : 1, brake, hold.left, hold.right];
  };
}

function collectExamples(kind) {
  const samples = [];
  for (const id of ['warmup', 'snake', 'hairpin']) {
    const track = training(id);
    const teach = teacherDriver();
    let prevSensors = new Array(SENSORS.count).fill(0), prevOut = new Array(OUTPUTS).fill(0);
    const car = new Car(track, { brain: {}, think: (inputs) => teach(inputs), sensors: SENSORS });
    const max = maxTicksFor(track);
    while (!car.done) {
      car.step(track, max);
      const x = kind === memory ? [...car.lastInputs, ...prevSensors, ...prevOut] : kind === buttons ? [...car.lastInputs, ...prevOut] : car.lastInputs;
      const y = car.lastOutputs.map((v) => (v > 0.5 ? 1 : 0));
      if (worthLearning({ x, y })) samples.push({ x, y });
      prevSensors = car.lastInputs.slice(0, SENSORS.count); prevOut = y;
    }
    console.log(`  учитель на «${track.name}»: ${car.status}, ${Math.round(carReport(car, track).progressPct)}%`);
  }
  return samples;
}

function imitate(kind, seed) {
  const samples = collectExamples(kind);
  return withSeed(seed, () => {
    const brain = createBrain([kind.inputs, ...HIDDEN, OUTPUTS]);
    for (let e = 0; e < 40; e++) trainEpoch(brain, samples, 0.1);
    return { brain, agree: agreement(brain, samples), samples: samples.length };
  });
}

/** Доля примеров, где учитель жмёт ровно то же, что тиком раньше — столько «списывает» copycat бесплатно */
function sameAsBefore(samples) {
  let same = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i].y.every((v, j) => v === samples[i - 1].y[j])) same++;
  return same / samples.length;
}

const pctText = (r) => `${r.pct.toFixed(0)}% пути в среднем, финиш ${r.finished} из ${EXAM.length}`;

console.log('А. Рой: 40 поколений × 50 машин, три трассы на поколение. Проверка — 7 незнакомых трасс.');
for (const seed of [1, 2]) {
  for (const kind of [plain, buttons, memory]) console.log(`  опыт ${seed}, ${kind.name}: ${pctText(examScore(swarm(kind, seed), kind))}`);
}

console.log('\nБ. Обучение на примерах (учитель с «клавиатурой»), 40 эпох.');
for (const kind of [plain, buttons, memory]) {
  const { brain, agree, samples } = imitate(kind, 7);
  console.log(`  ${kind.name}: примеров ${samples}, совпадение с учителем ${(agree * 100).toFixed(0)}%, на незнакомых: ${pctText(examScore(brain, kind))}`);
}
console.log(`  учитель жмёт то же, что тиком раньше, в ${(sameAsBefore(collectExamples(plain)) * 100).toFixed(0)}% примеров`);
console.log(`  (сам учитель на незнакомых: ${pctText((() => {
  const r = EXAM.map((t) => { const car = new Car(t, { brain: {}, think: teacherDriver(), sensors: SENSORS }); const m = maxTicksFor(t); while (!car.done) car.step(t, m); return carReport(car, t); });
  return { pct: r.reduce((s, x) => s + x.progressPct, 0) / r.length, finished: r.filter((x) => x.finished).length };
})())})`);
void CAR;
