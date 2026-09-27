// Вкладка «Я учу» (урок 1): ездишь сам — заезды записываются, сеть учится повторять за тобой.
// Здесь же «глаза» (лучи), форма сети и «мозг под микроскопом» — ручная правка весов.
import { TRAINING_TRACKS, getTrainingTrack } from '../../engine/track.js';
import { Car, carReport } from '../../engine/car.js';
import { createBrain, cloneBrain, LIMITS } from '../../engine/brain.js';
import { TRAFFIC_LEVELS, withTraffic } from '../../engine/traffic.js';
import { sampleOf, worthLearning, trainEpoch, agreement, TEACH_THINK } from '../../engine/imitation.js';
import { drawSeries } from '../../engine/netviz.js';
import { state, persist, sizesOf, thinkFn, brainTitle, on } from '../state.js';
import { load, save } from '../storage.js';
import { live } from '../student-code.js';
import { runs, addRun, toggleRun, removeRun, trainingSamples, sampleCount, saveRuns, memoryNote, MAX_SAMPLES } from '../runs.js';
import { setBrain, changeShape, shapeResetsBrain, renderLibrary } from '../library.js';
import { steerWith } from '../manual-drive.js';
import { drawScene, paintCar, trafficOn, setHud, showBanner } from '../stage.js';
import { $, esc, secs, pct, options, setPressed, delegate } from '../ui.js';
import { createNetworkEditor } from './network-editor.js';

const MIN_SAMPLES = 200;
const RESTART_DELAY = 1100;

const learning = { epochs: 20, rate: 0.05, ...load('teach', {}) };

let mode = 'me';      // 'me' — еду я (и записываю), 'brain' — едет текущий мозг
let car = null;
let track = null;
let restartAt = 0;
let recording = null; // идущий заезд: [{ x, y }] — начинается, как только машина тронулась
let trace = null;     // что «горит» в сети на этом кадре
let losses = [];
let training = null;  // { epoch, total, brain, samples, runs } — пока идёт обучение

const editor = createNetworkEditor({
  getTrace: () => (mode === 'brain' ? trace : null),
  onEdit: () => (mode === 'brain' ? resetCar() : setMode('brain')),
});

export const teachTab = {
  enter() {
    resetCar();
    renderShape();
    renderRuns();
    renderTraining();
    renderLibrary();
    editor.render();
  },
  frame(frameNo) {
    if (training) trainStep();
    let traffic = trafficOn(track, car.ticks);
    if (!car.done) {
      if (mode === 'brain') live.think.feedForward.lastTrace = null;
      car.step(track, Infinity, traffic);
      trace = mode === 'brain' ? live.think.feedForward.lastTrace : null;
      if (mode === 'me') record();
      traffic = trafficOn(track, car.ticks);
    } else if (!restartAt) {
      restartAt = performance.now() + RESTART_DELAY;
      finishRun();
    } else if (performance.now() > restartAt) {
      resetCar();
    }
    drawScene(track, { camera: 'follow', follow: car, traffic });
    paintCar(car, { color: mode === 'me' ? state.profile.color : '#ff3d7f', sensors: true, glow: true });
    setHud([
      mode === 'me' ? (recording ? `<b>● запись</b> ${recording.length}` : 'рулишь <b>ты</b>') : 'рулит <b>мозг</b>',
      `скорость <b>${car.speed.toFixed(1)}</b>`,
      `пройдено <b>${pct(carReport(car, track).progressPct)}</b>`,
      `время <b>${secs(car.ticks)}</b>`,
      `лучи <b>${[...car.readings].map((v) => v.toFixed(2)).join(' ')}</b>`,
    ]);
    $('#recBadge').hidden = !recording;
    if (mode === 'brain' && frameNo % 3 === 0) editor.render();
  },
};

// ── машина ──

function resetCar() {
  if (recording && car && !car.done) finishRun({ interrupted: true });
  track = withTraffic(getTrainingTrack(state.drive.trackId), state.drive.traffic);
  const driver = mode === 'brain' && state.champion ? { brain: state.champion, think: thinkFn() } : {};
  car = new Car(track, { ...driver, sensors: state.config.sensors });
  restartAt = 0;
  recording = null;
  trace = null;
  steerWith(mode === 'me' ? car.controls : null, { onTouch: () => setMode('me') });
}

function setMode(next) {
  if (next === 'brain' && !state.champion) {
    showBanner('Мозга пока нет: запиши пару заездов и нажми «Обучить» — или поправь веса в «Мозге под микроскопом»', 3200);
    next = 'me';
  }
  mode = next;
  setPressed('#dMe, #dBrain', (b) => b.id === (mode === 'me' ? 'dMe' : 'dBrain'));
  resetCar();
}

$('#dMe').addEventListener('click', () => setMode('me'));
$('#dBrain').addEventListener('click', () => setMode('brain'));
$('#dRestart').addEventListener('click', resetCar);

for (const [select, key, items] of [
  ['#dTrack', 'trackId', TRAINING_TRACKS.map(({ id, name }) => ({ id, title: name }))],
  ['#dTraffic', 'traffic', TRAFFIC_LEVELS],
]) {
  $(select).innerHTML = options(items);
  $(select).value = state.drive[key];
  $(select).addEventListener('change', (e) => {
    state.drive[key] = e.target.value;
    persist();
    resetCar();
  });
}

// ── запись: заезд начинается, когда машина тронулась, и заканчивается финишем или аварией ──

function record() {
  const sample = sampleOf(car);
  if (!worthLearning(sample)) return; // стоишь и ничего не жмёшь — не учим
  recording ??= [];
  recording.push(sample);
  if (sampleCount() + recording.length === MAX_SAMPLES) showBanner('Заездов много: при сохранении самые старые уйдут', 2400);
}

const RESULT_TEXT = { crashed: 'Авария!', stalled: 'Заглох', timeout: 'Время вышло' };

function finishRun({ interrupted = false } = {}) {
  const status = interrupted ? 'stopped' : car.status;
  const saved = recording && addRun(recording, {
    trackName: track.name, traffic: state.drive.traffic, status,
    progressPct: carReport(car, track).progressPct, ticks: car.ticks,
  });
  recording = null;
  if (!interrupted) {
    const head = status === 'finished' ? `Финиш! ${secs(car.finishTick)}.` : RESULT_TEXT[status] ?? '';
    showBanner(saved ? `${head} Заезд записан: ${saved.packed.length} примеров` : head, RESTART_DELAY + 400);
  }
  if (saved) renderRuns();
}

// ── «Мои заезды» ──

const STATUS_LABEL = { finished: 'финиш', crashed: 'авария', stalled: 'заглох', timeout: 'время вышло', stopped: 'прервал' };

function renderRuns() {
  const inputs = sizesOf()[0];
  const { samples, runs: used } = trainingSamples(inputs);
  $('#runsList').innerHTML = runs.length
    ? runs.map((r) => {
      const fits = r.inputs === inputs;
      const res = r.status === 'finished' ? secs(r.ticks) : `${STATUS_LABEL[r.status]}${r.progressPct ? ` ${pct(r.progressPct)}` : ''}`;
      return `
        <li class="${r.on && fits ? '' : 'off'} ${r.status === 'finished' ? 'good' : r.status === 'crashed' ? 'bad' : ''}">
          <input type="checkbox" data-run="${r.id}" ${r.on ? 'checked' : ''} ${fits ? '' : 'disabled'} aria-label="Учить на этом заезде">
          <span>${esc(r.trackName)}<span class="meta"> · ${r.packed.length} прим.${fits ? '' : ` · записан с ${r.inputs - 1} лучами`}</span></span>
          <span class="res">${res}</span>
          <button data-del-run="${r.id}" aria-label="Удалить заезд">×</button>
        </li>`;
    }).join('')
    : '<li class="empty">Пока пусто. Нажми газ — запись начнётся сама.</li>';
  $('#teachGo').disabled = samples.length < MIN_SAMPLES || !!training;
  $('#teachGo').textContent = training ? `Учится… ${training.epoch}/${training.total}` : 'Учить на заездах';
  $('#teachStatus').textContent = training ? ''
    : samples.length < MIN_SAMPLES ? `Нужно хотя бы ${MIN_SAMPLES} примеров в отмеченных заездах (сейчас ${samples.length}) — это пара кругов по «Разминке».`
    : `${used.length} ${used.length === 1 ? 'заезд' : 'заездов'}, ${samples.length} примеров. ${state.champion ? 'Мозг продолжит учиться с того, что уже умеет.' : 'Мозга ещё нет — начнём с нуля.'}`;
  $('#exMemory').textContent = memoryNote(saveRuns());
}

delegate('#runsList', 'change', '[data-run]', (box) => {
  toggleRun(box.dataset.run);
  renderRuns();
});
delegate('#runsList', 'click', '[data-del-run]', (b) => {
  removeRun(b.dataset.delRun);
  renderRuns();
});

// ── обучение на заездах ──

$('#epochs').value = learning.epochs;
$('#epochsOut').textContent = learning.epochs;
$('#epochs').addEventListener('input', (e) => {
  learning.epochs = +e.target.value;
  $('#epochsOut').textContent = learning.epochs;
  save('teach', learning);
});
delegate('[data-panel="teach"]', 'click', '[data-lr]', (b) => {
  learning.rate = +b.dataset.lr;
  save('teach', learning);
  renderTraining();
});

$('#teachGo').addEventListener('click', () => {
  const { samples, runs: used } = trainingSamples(sizesOf()[0]);
  if (samples.length < MIN_SAMPLES) return;
  // учёба всегда продолжается с текущего мозга; нет мозга — начинаем со случайных весов
  training = {
    epoch: 0, total: learning.epochs, samples, runs: used.length,
    fresh: !state.champion,
    brain: state.champion ? cloneBrain(state.champion) : createBrain(sizesOf()),
    before: brainTitle(),
  };
  losses = [];
  $('.learn-box').open = true;
  renderRuns();
});

/** Одна эпоха за кадр — видно, как падает ошибка */
function trainStep() {
  losses.push(trainEpoch(training.brain, training.samples, learning.rate));
  training.epoch++;
  renderTraining();
  if (training.epoch % 5 === 0) renderRuns();
  if (training.epoch < training.total) return;
  const { brain, samples, runs: count, fresh, before } = training;
  training = null;
  const match = pct(agreement(brain, samples) * 100);
  const base = before.replace(/ \+ твои заезды.*$/, '');
  setBrain(brain, {
    config: { ...state.config, think: TEACH_THINK },
    by: 'teach',
    generation: fresh ? 0 : state.generation,
    note: fresh ? `обучен на ${count} ${count === 1 ? 'заезде' : 'заездах'}` : `${base} + твои заезды`,
  });
  setMode('brain');
  renderRuns();
  showBanner(`Мозг повторяет тебя в ${match} примеров и едет сам. Прежний — в «Истории»`, 3200);
}

function renderTraining() {
  setPressed('[data-lr]', (b) => +b.dataset.lr === learning.rate);
  const loss = losses.at(-1);
  $('#lrSummary').textContent = loss === undefined
    ? 'Здесь появится график ошибки: чем ниже, тем точнее мозг повторяет за тобой.'
    : `Эпоха ${losses.length}${training ? ` из ${training.total}` : ''} · ошибка ${loss.toFixed(3)}`;
  redrawLoss();
}

export const redrawLoss = () => drawSeries($('#lossChart'), losses, { label: 'Здесь появится график ошибки' });

// ── глаза: лучи ──

const SENSOR_SLIDERS = [
  ['#sCount', 'count', (v) => `${v}`],
  ['#sSpread', 'spread', (v) => `${v}°`],
  ['#sLength', 'length', (v) => `${v} px`],
];

for (const [id, key, format] of SENSOR_SLIDERS) {
  $(id).addEventListener('input', (e) => {
    const value = +e.target.value;
    $(`${id}Out`).textContent = format(value);
    const shape = pendingShape ?? state.config;
    askShape({ ...shape, sensors: { ...shape.sensors, [key]: value } });
  });
}

/** Другая форма сети не подходит к обученному мозгу — спросим, прежде чем начинать с нуля */
let pendingShape = null;
function askShape(config) {
  if (!shapeResetsBrain(config)) {
    pendingShape = null;
    $('#shapeConfirm').hidden = true;
    return changeShape(config);
  }
  pendingShape = config;
  $('#shapeConfirmText').textContent = `Сеть станет ${sizesOf(config).join('-')}. Нынешний мозг под неё не подходит — учиться придётся с нуля (он останется в «Истории»).`;
  $('#shapeConfirm').hidden = false;
  $('#shapeConfirm').scrollIntoView({ block: 'nearest' });
}
$('#shapeYes').addEventListener('click', () => {
  $('#shapeConfirm').hidden = true;
  if (pendingShape) changeShape(pendingShape);
  pendingShape = null;
});
$('#shapeNo').addEventListener('click', () => {
  $('#shapeConfirm').hidden = true;
  pendingShape = null;
  renderShape();
});

// ── сеть: слои и вариант мозга ──

function renderShape() {
  const shape = pendingShape ?? state.config;
  for (const [id, key, format] of SENSOR_SLIDERS) {
    $(id).value = shape.sensors[key];
    $(`${id}Out`).textContent = format(shape.sensors[key]);
  }
  const hidden = shape.hidden.map((n, i) => `
    <span class="arrow" aria-hidden="true">→</span>
    <span class="layer">Слой ${i + 1}
      <button data-act="minus" data-i="${i}" aria-label="Меньше нейронов в слое ${i + 1}">−</button><b>${n}</b>
      <button data-act="plus" data-i="${i}" aria-label="Больше нейронов в слое ${i + 1}">+</button>
      <button data-act="del" data-i="${i}" aria-label="Удалить слой ${i + 1}">×</button>
    </span>`).join('');
  $('#layersEditor').innerHTML = `
    <span class="layer fixed">Входы <b>${shape.sensors.count + 1}</b></span>${hidden}
    <span class="arrow" aria-hidden="true">→</span><span class="layer fixed">Выходы <b>4</b></span>`;
  $('#addLayer').disabled = shape.hidden.length >= LIMITS.hiddenLayersMax;

  const variants = live.think.thinkVariants ?? {};
  if (!variants[state.config.think]) state.config.think = variants.step ? 'step' : Object.keys(variants)[0];
  $('#thinkSelect').innerHTML = options(Object.entries(variants).map(([id, v]) => ({ id, title: v.title || id })));
  $('#thinkSelect').value = state.config.think;
  $('#thinkHint').textContent = variants[state.config.think]?.hint ?? '';
}

delegate('#layersEditor', 'click', 'button', (button) => {
  const i = +button.dataset.i;
  const shape = pendingShape ?? state.config;
  const hidden = [...shape.hidden];
  if (button.dataset.act === 'plus') hidden[i] = Math.min(LIMITS.neuronsMax, hidden[i] + 1);
  if (button.dataset.act === 'minus') hidden[i] = Math.max(LIMITS.neuronsMin, hidden[i] - 1);
  if (button.dataset.act === 'del') hidden.splice(i, 1);
  askShape({ ...shape, hidden });
  renderShape();
});
$('#addLayer').addEventListener('click', () => {
  const shape = pendingShape ?? state.config;
  askShape({ ...shape, hidden: [...shape.hidden, 6] });
  renderShape();
});

$('#thinkSelect').addEventListener('change', (e) => {
  state.config.think = e.target.value;
  persist();
  renderShape();
  if (mode === 'brain') resetCar();
});

// ── реакция на перемены ──

on('config', () => {
  editor.reset();
  if (state.tab !== 'teach') return;
  renderShape();
  renderRuns();
  resetCar();
  editor.render();
});
on('champion', ({ by }) => {
  if (state.tab !== 'teach' || by === 'editor') return;
  renderRuns();
  if (mode === 'brain') resetCar();
  editor.render();
});
on('reset', () => {
  editor.reset();
  if (mode === 'brain') setMode('me');
});
on('code', (file) => {
  if (file === 'think' && state.tab === 'teach') renderShape();
});

export const renderNetwork = () => editor.render();

// на телефоне «микроскоп» свёрнут: панель и так длинная
if (matchMedia('(max-width: 700px)').matches) $('#netCanvas').closest('details').open = false;
