// Вкладка «Учитель» (урок 2): записываем свои заезды и учим сеть повторять за нами.
import { TRAINING_TRACKS, getTrainingTrack } from '../../engine/track.js';
import { Car, carReport } from '../../engine/car.js';
import { createBrain, cloneBrain } from '../../engine/brain.js';
import { TRAFFIC_LEVELS, withTraffic } from '../../engine/traffic.js';
import { sampleOf, worthLearning, trainEpoch, agreement, packSample, unpackSample, TEACH_THINK } from '../../engine/imitation.js';
import { drawSeries } from '../../engine/netviz.js';
import { state, persist, sizesOf, thinkFn, setChampion } from '../state.js';
import { load, save, remove, usedBytes } from '../storage.js';
import { steerWith } from '../manual-drive.js';
import { drawScene, paintCar, trafficOn, setHud, showBanner } from '../stage.js';
import { $, $$, secs, pct, options, setPressed, delegate } from '../ui.js';

const MAX_SAMPLES = 8000;
const DROP_BEFORE_CRASH = 45;   // тиков перед аварией не учим (0,75 с)
const MIN_SAMPLES = 200;
const RESTART_DELAY = 1100;

const settings = { trackId: 'warmup', traffic: 'none', epochs: 30, rate: 0.05, ...load('teach', {}) };
let samples = loadSamples();
let runs = load('teachRuns', 0);

let mode = 'me';      // 'me' — рулю я, 'student' — рулит ученик
let recording = false;
let runStart = 0;     // с какого примера начался текущий заезд
let car = null;
let track = null;
let restartAt = 0;

let student = load('teachStudent', null); // обученная сеть (сохраняется в браузере)
let losses = [];
let training = null;  // { epoch, total } — пока идёт обучение

export const teachTab = {
  enter() {
    saveSamples();
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
  const sample = sampleOf(car);
  if (worthLearning(sample)) samples.push(sample);
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

function setRecording(on, message = null, { quiet = false } = {}) {
  recording = on;
  $('#rec').classList.toggle('on', on);
  if (on && mode !== 'me') setMode('me');
  if (!on) saveSamples();
  renderStats();
  if (message) showBanner(message, 2400);
  else if (!on && !quiet && samples.length >= MIN_SAMPLES) showBanner(`Записано ${samples.length} примеров — жми «Обучить»`, 3000);
}

function loadSamples() {
  const packed = load('teachPacked', []).map(unpackSample);
  const legacy = load('teachSamples', null); // старый формат (массивы чисел) — переносим один раз
  if (legacy) remove('teachSamples');
  const all = [...packed, ...(legacy ?? []).map(([x, y]) => ({ x, y }))];
  return all.filter(worthLearning); // старые записи могли содержать «стою и жду» — выбрасываем
}

function saveSamples() {
  const saved = save('teachPacked', samples.map(packSample));
  save('teachRuns', runs);
  $('#exMemory').textContent = saved
    ? `В памяти браузера: ${(usedBytes() / 1024).toFixed(0)} КБ из примерно 5000.`
    : 'Не хватило места в памяти браузера: примеры живут до перезагрузки. Очисти их или другие данные сайта.';
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

/** Три шага в панели и кнопки: что уже сделано и что дальше */
function renderStats() {
  const enough = samples.length >= MIN_SAMPLES;
  const turns = samples.filter(({ y }) => y[2] || y[3]).length;
  $('#rec').textContent = recording ? `■ Стоп · ${samples.length}` : `● Записать${samples.length ? ` · ${samples.length}` : ''}`;
  $('#teachGo').disabled = !enough || !!training;
  $('#teachGo').textContent = training ? `Учится… ${training.epoch}/${training.total}` : student ? 'Обучить заново' : 'Обучить';
  $('#teachStudent').classList.toggle('off', !student);

  $('#stepRecord').textContent = samples.length
    ? `${samples.length} примеров${enough ? '' : ` — нужно хотя бы ${MIN_SAMPLES}`}, с поворотом ${turns}, заездов ${runs}`
    : 'Нажми «● Записать» и проедь трассу 2–3 раза.';
  $('#stepTrain').textContent = training ? `Учится: эпоха ${training.epoch} из ${training.total}…`
    : student ? `Готов: повторяет за тобой в ${pct(agreement(student, trainSet) * 100)} примеров.`
    : enough ? 'Нажми «Обучить».' : 'Сначала запиши примеры.';
  $('#stepAdopt').textContent = student && !training
    ? 'Нажми «Едет ученик». Понравилось — сделай его своим мозгом, дальше его можно доучить на «Треке».'
    : 'Появится после обучения.';
  $('#teachAdopt').disabled = !student || !!training;
  const current = !enough ? 'record' : !student || training ? 'train' : 'adopt';
  for (const li of $$('#teachSteps li')) {
    const order = ['record', 'train', 'adopt'];
    li.classList.toggle('done', order.indexOf(li.dataset.step) < order.indexOf(current));
    li.classList.toggle('current', li.dataset.step === current);
  }
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

const usableSamples = () => samples.filter(({ x }) => x.length === sizesOf()[0]);
let trainSet = usableSamples();

function startTraining() {
  if (recording) setRecording(false, null, { quiet: true });
  trainSet = usableSamples();
  if (trainSet.length < samples.length) showBanner('Часть примеров записана с другим числом лучей — они пропущены', 2600);
  if (trainSet.length < MIN_SAMPLES) return showBanner(`Нужно хотя бы ${MIN_SAMPLES} примеров с текущими сенсорами — запиши заезд`);
  student = createBrain(sizesOf()); // каждый раз с чистого листа: так честнее сравнивать настройки
  losses = [];
  training = { epoch: 0, total: settings.epochs };
  if (mode === 'student') setMode('me');
  renderStats();
}
$('#teachGo').addEventListener('click', startTraining);

/** Одна эпоха за кадр — видно, как падает ошибка */
function trainStep() {
  losses.push(trainEpoch(student, trainSet, settings.rate));
  training.epoch++;
  if (training.epoch % 5 === 0) renderStats();
  if (training.epoch >= training.total) {
    training = null;
    save('teachStudent', student);
    renderStats();
    setMode('student');
    showBanner('Ученик готов — смотри, как он едет', 2400);
  }
  renderTraining();
}

function renderTraining() {
  setPressed('[data-lr]', (b) => +b.dataset.lr === settings.rate);
  const loss = losses.at(-1);
  $('#lrSummary').textContent = loss === undefined
    ? 'Здесь появится график ошибки: чем ниже, тем точнее ученик повторяет за тобой.'
    : `Эпоха ${losses.length}${training ? ` из ${training.total}` : ''} · ошибка ${loss.toFixed(3)}`;
  drawSeries($('#lossChart'), losses, { label: 'Здесь появится график ошибки' });
}

$('#teachAdopt').addEventListener('click', () => {
  state.config.think = TEACH_THINK;
  persist();
  setChampion(cloneBrain(student), { by: 'teach', generation: 0 });
  showBanner('Ученик стал твоим мозгом: проверь его на «Экзамене» или доучи на «Треке»', 3000);
});

export const redrawLoss = () => drawSeries($('#lossChart'), losses, { label: 'Здесь появится график ошибки' });
