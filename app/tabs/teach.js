// Вкладка «Учитель» (урок 2): записываем свои заезды и учим сеть повторять за нами.
import { TRAINING_TRACKS, getTrainingTrack } from '../../engine/track.js';
import { Car, carReport } from '../../engine/car.js';
import { createBrain, cloneBrain } from '../../engine/brain.js';
import { TRAFFIC_LEVELS, withTraffic } from '../../engine/traffic.js';
import { sampleOf, trainEpoch, agreement, TEACH_THINK } from '../../engine/imitation.js';
import { drawSeries } from '../../engine/netviz.js';
import { state, persist, sizesOf, thinkFn, setChampion } from '../state.js';
import { load, save } from '../storage.js';
import { steerWith } from '../manual-drive.js';
import { drawScene, paintCar, trafficOn, setHud, showBanner } from '../stage.js';
import { $, secs, pct, options, setPressed, delegate } from '../ui.js';

const MAX_SAMPLES = 8000;
const DROP_BEFORE_CRASH = 45;   // тиков перед аварией не учим (0,75 с)
const MIN_SAMPLES = 200;
const RESTART_DELAY = 1100;

const settings = { trackId: 'warmup', traffic: 'none', epochs: 30, rate: 0.05, ...load('teach', {}) };
let samples = load('teachSamples', []).map(([x, y]) => ({ x, y }));
let runs = load('teachRuns', 0);

let mode = 'me';      // 'me' — рулю я, 'student' — рулит ученик
let recording = false;
let runStart = 0;     // с какого примера начался текущий заезд
let car = null;
let track = null;
let restartAt = 0;

let student = null;   // обученная сеть
let losses = [];
let training = null;  // { epoch, total } — пока идёт обучение

export const teachTab = {
  enter() {
    resetCar();
    renderStats();
    renderTraining();
  },
  frame() {
    if (training) trainStep();
    const traffic = trafficOn(track, car.ticks);
    if (!car.done) {
      car.step(track, Infinity, traffic);
      if (recording && mode === 'me') record();
    } else if (!restartAt) {
      restartAt = performance.now() + RESTART_DELAY;
      finishRun();
    } else if (performance.now() > restartAt) {
      resetCar();
    }
    drawScene(track, { camera: 'follow', follow: car, traffic: trafficOn(track, car.ticks) });
    paintCar(car, { color: mode === 'me' ? state.profile.color : '#ff3d7f', sensors: true, glow: true });
    setHud([
      mode === 'me' ? 'рулишь <b>ты</b>' : 'рулит <b>ученик</b>',
      `скорость <b>${car.speed.toFixed(1)}</b>`,
      `пройдено <b>${pct(carReport(car, track).progressPct)}</b>`,
      `время <b>${secs(car.ticks)}</b>`,
    ]);
    $('#recBadge').hidden = !(recording && mode === 'me');
  },
};

// ── заезд ──

function resetCar() {
  track = withTraffic(getTrainingTrack(settings.trackId), settings.traffic);
  const driver = mode === 'student' && student ? { brain: student, think: thinkFn(TEACH_THINK) } : {};
  car = new Car(track, { ...driver, sensors: state.config.sensors });
  restartAt = 0;
  runStart = samples.length;
  steerWith(mode === 'me' ? car.controls : null, { onTouch: () => setMode('me') });
}

function setMode(next) {
  if (next === 'student' && !student) {
    showBanner('Сначала обучи ученика на своих примерах');
    next = 'me';
  }
  mode = next;
  setPressed('#teachMe, #teachStudent', (b) => b.id === (mode === 'me' ? 'teachMe' : 'teachStudent'));
  resetCar();
}

function record() {
  if (samples.length >= MAX_SAMPLES) return setRecording(false, 'Хватит: записано максимум примеров');
  samples.push(sampleOf(car));
  if (car.ticks % 30 === 0) renderStats();
}

function finishRun() {
  const text = car.status === 'finished' ? `Финиш! ${secs(car.finishTick)}` : car.status === 'crashed' ? 'Авария!' : 'Заглох';
  showBanner(text, RESTART_DELAY);
  if (!(recording && mode === 'me')) return;
  if (car.status === 'crashed') samples.splice(Math.max(runStart, samples.length - DROP_BEFORE_CRASH));
  if (samples.length > runStart) runs++;
  saveSamples();
  renderStats();
}

function setRecording(on, message) {
  recording = on;
  $('#rec').textContent = on ? '■ Стоп' : '● Записывать';
  $('#rec').classList.toggle('on', on);
  if (on && mode !== 'me') setMode('me');
  if (!on) saveSamples();
  if (message) showBanner(message, 2400);
}

function saveSamples() {
  const round = (v) => Math.round(v * 1000) / 1000;
  save('teachSamples', samples.map(({ x, y }) => [x.map(round), y]));
  save('teachRuns', runs);
}

$('#rec').addEventListener('click', () => setRecording(!recording));
$('#teachMe').addEventListener('click', () => setMode('me'));
$('#teachStudent').addEventListener('click', () => setMode('student'));
$('#teachRestart').addEventListener('click', resetCar);
$('#exClear').addEventListener('click', () => {
  samples = [];
  runs = 0;
  saveSamples();
  resetCar();
  renderStats();
});

for (const [select, key, items] of [
  ['#teachTrack', 'trackId', TRAINING_TRACKS.map(({ id, name }) => ({ id, title: name }))],
  ['#teachTraffic', 'traffic', TRAFFIC_LEVELS],
]) {
  $(select).innerHTML = options(items);
  $(select).value = settings[key];
  $(select).addEventListener('change', (e) => {
    settings[key] = e.target.value;
    save('teach', settings);
    resetCar();
  });
}

function renderStats() {
  $('#exCount').textContent = samples.length;
  $('#exTurns').textContent = samples.filter(({ y }) => y[2] || y[3]).length;
  $('#exRuns').textContent = runs;
  $('#teachTrain').disabled = samples.length < MIN_SAMPLES || !!training;
}

// ── обучение ──

$('#epochs').value = settings.epochs;
$('#epochsOut').textContent = settings.epochs;
$('#epochs').addEventListener('input', (e) => {
  settings.epochs = +e.target.value;
  $('#epochsOut').textContent = settings.epochs;
  save('teach', settings);
});
delegate('[data-panel="teach"]', 'click', '[data-lr]', (b) => {
  settings.rate = +b.dataset.lr;
  save('teach', settings);
  renderTraining();
});

let trainSet = [];

$('#teachTrain').addEventListener('click', () => {
  const inputs = sizesOf()[0];
  trainSet = samples.filter(({ x }) => x.length === inputs);
  if (trainSet.length < samples.length) showBanner('Часть примеров записана с другим числом лучей — они пропущены', 2600);
  if (trainSet.length < MIN_SAMPLES) return showBanner(`Нужно хотя бы ${MIN_SAMPLES} примеров с текущими сенсорами — запиши заезд`);
  student = createBrain(sizesOf()); // каждый раз с чистого листа: так честнее сравнивать настройки
  losses = [];
  training = { epoch: 0, total: settings.epochs };
  if (mode === 'student') setMode('me');
  renderStats();
});

/** Одна эпоха за кадр — видно, как падает ошибка */
function trainStep() {
  losses.push(trainEpoch(student, trainSet, settings.rate));
  training.epoch++;
  if (training.epoch >= training.total) {
    training = null;
    renderStats();
    setMode('student');
    showBanner('Ученик готов — смотри, как он едет', 2400);
  }
  renderTraining();
}

function renderTraining() {
  setPressed('[data-lr]', (b) => +b.dataset.lr === settings.rate);
  const loss = losses.at(-1);
  $('#lrEpoch').textContent = losses.length ? `${losses.length}/${training?.total ?? losses.length}` : '—';
  $('#lrLoss').textContent = loss === undefined ? '—' : loss.toFixed(3);
  $('#lrMatch').textContent = student && !training ? pct(agreement(student, trainSet) * 100) : '—';
  $('#teachAdopt').disabled = !student || !!training;
  drawSeries($('#lossChart'), losses, { label: 'Здесь появится график ошибки' });
}

$('#teachAdopt').addEventListener('click', () => {
  state.config.think = TEACH_THINK;
  persist();
  setChampion(cloneBrain(student), { by: 'teach', generation: 0 });
  showBanner('Ученик стал твоим мозгом: проверь его на «Экзамене» или доучи на «Треке»', 3000);
});

export const redrawLoss = () => drawSeries($('#lossChart'), losses, { label: 'Здесь появится график ошибки' });
