// Вкладка «Гараж» (урок 1): катаемся сами, настраиваем сенсоры и слои, смотрим в сеть.
import { TRAINING_TRACKS, getTrainingTrack } from '../../engine/track.js';
import { Car, carReport } from '../../engine/car.js';
import { LIMITS } from '../../engine/brain.js';
import { TRAFFIC_LEVELS, withTraffic } from '../../engine/traffic.js';
import { state, persist, sizesOf, sameSizes, thinkFn, on, resetProgress } from '../state.js';
import { live } from '../student-code.js';
import { drawScene, paintCar, trafficOn, setHud, showBanner } from '../stage.js';
import { $, $$, secs, pct, options, setPressed, delegate, isTyping } from '../ui.js';
import { createNetworkEditor } from './network-editor.js';

const RESTART_DELAY = 1100;

let draft = structuredClone(state.config); // архитектура, которую сейчас собирают
let mode = 'manual';                        // 'manual' — рулю сам, 'auto' — рулит мозг
let car = null;
let track = null;
let restartAt = 0;
let trace = null;                           // что «горит» в сети на этом кадре

const editor = createNetworkEditor({
  getDraft: () => draft,
  getTrace: () => (mode === 'auto' ? trace : null),
  onEdit: () => (mode === 'auto' ? resetCar() : setMode('auto')),
});

export const garageTab = {
  enter() {
    resetCar();
    renderLayers();
    renderThink();
    editor.render();
  },
  frame(frameNo) {
    let traffic = trafficOn(track, car.ticks);
    if (!car.done) {
      if (mode === 'auto') live.think.feedForward.lastTrace = null;
      car.step(track, Infinity, traffic);
      trace = mode === 'auto' ? live.think.feedForward.lastTrace : null;
      traffic = trafficOn(track, car.ticks);
    } else if (!restartAt) {
      restartAt = performance.now() + RESTART_DELAY;
      showBanner(finishText(car), RESTART_DELAY);
    } else if (performance.now() > restartAt) {
      resetCar();
    }

    drawScene(track, { camera: 'follow', follow: car, traffic });
    paintCar(car, { color: state.profile.color, sensors: true, glow: true });
    setHud([
      `скорость <b>${car.speed.toFixed(1)}</b>`,
      `пройдено <b>${pct(carReport(car, track).progressPct)}</b>`,
      `время <b>${secs(car.ticks)}</b>`,
      `сенсоры <b>${[...car.readings].map((v) => v.toFixed(2)).join(' ')}</b>`,
    ]);
    if (mode === 'auto' && frameNo % 3 === 0) editor.render();
  },
};

const finishText = (c) =>
  c.status === 'finished' ? `Финиш! ${secs(c.finishTick)}`
  : c.status === 'crashed' ? (c.crashedInto === 'car' ? 'Авария!' : 'Бордюр!')
  : 'Заглох';

// ── машина ──

function resetCar() {
  track = withTraffic(getTrainingTrack(state.garage.trackId), state.garage.traffic);
  const driver = mode === 'auto' ? { brain: state.champion, think: thinkFn(draft.think) } : {};
  car = new Car(track, { ...driver, sensors: draft.sensors });
  restartAt = 0;
  trace = null;
}

function setMode(next) {
  if (next === 'auto' && !state.champion) {
    showBanner('Сначала обучи мозг на вкладке «Трек»');
    next = 'manual';
  }
  if (next === 'auto' && !sameSizes(draft, state.config)) {
    showBanner('Архитектура изменена — примени её или отмени');
    next = 'manual';
  }
  mode = next;
  setPressed('#gManual, #gAuto', (b) => b.id === (mode === 'manual' ? 'gManual' : 'gAuto'));
  resetCar();
}

$('#gManual').addEventListener('click', () => setMode('manual'));
$('#gAuto').addEventListener('click', () => setMode('auto'));
$('#gRestart').addEventListener('click', resetCar);

for (const [select, key, items] of [
  ['#gTrack', 'trackId', TRAINING_TRACKS.map(({ id, name }) => ({ id, title: name }))],
  ['#gTraffic', 'traffic', TRAFFIC_LEVELS],
]) {
  $(select).innerHTML = options(items);
  $(select).value = state.garage[key];
  $(select).addEventListener('change', (e) => {
    state.garage[key] = e.target.value;
    persist();
    resetCar();
  });
}

// ── клавиатура и кнопки на экране → handleKey() студента ──

function press(key, down) {
  if (state.tab !== 'garage' || mode !== 'manual' || !car) return false;
  try {
    return !!live.controls.handleKey(key, down, car.controls);
  } catch (e) {
    showBanner(`Ошибка в handleKey(): ${e.message}`, 3000);
    return false;
  }
}

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  const handled = e.repeat ? state.tab === 'garage' && mode === 'manual' && e.key.startsWith('Arrow') : press(e.key, true);
  if (handled) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (!isTyping(e.target)) press(e.key, false);
});
window.addEventListener('blur', () => car && Object.assign(car.controls, { gas: 0, brake: 0, left: 0, right: 0 }));

for (const button of $$('.pad button')) {
  const key = button.dataset.key;
  const release = () => {
    button.classList.remove('on');
    press(key, false);
  };
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    button.setPointerCapture?.(e.pointerId);
    button.classList.add('on');
    if (mode !== 'manual') setMode('manual');
    press(key, true);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
}

// ── сенсоры ──

const SENSOR_SLIDERS = [
  ['#sCount', 'count', (v) => `${v}`],
  ['#sSpread', 'spread', (v) => `${v}°`],
  ['#sLength', 'length', (v) => `${v} px`],
];

function syncSensorSliders() {
  for (const [id, key, format] of SENSOR_SLIDERS) {
    $(id).value = draft.sensors[key];
    $(`${id}Out`).textContent = format(draft.sensors[key]);
  }
}

for (const [id, key, format] of SENSOR_SLIDERS) {
  $(id).addEventListener('input', (e) => {
    const value = +e.target.value;
    draft.sensors[key] = value;
    $(`${id}Out`).textContent = format(value);
    if (key !== 'count') { // угол и дальность не меняют размер сети — применяем сразу
      state.config.sensors[key] = value;
      persist();
    }
    onDraftChange();
  });
}
syncSensorSliders();

// ── слои ──

function renderLayers() {
  const hidden = draft.hidden.map((n, i) => `
    <span class="arrow" aria-hidden="true">→</span>
    <span class="layer">Слой ${i + 1}
      <button data-act="minus" data-i="${i}" aria-label="Меньше нейронов в слое ${i + 1}">−</button><b>${n}</b>
      <button data-act="plus" data-i="${i}" aria-label="Больше нейронов в слое ${i + 1}">+</button>
      <button data-act="del" data-i="${i}" aria-label="Удалить слой ${i + 1}">×</button>
    </span>`).join('');
  $('#layersEditor').innerHTML = `
    <span class="layer fixed">Входы <b>${draft.sensors.count + 1}</b></span>${hidden}
    <span class="arrow" aria-hidden="true">→</span><span class="layer fixed">Выходы <b>4</b></span>`;
  $('#addLayer').disabled = draft.hidden.length >= LIMITS.hiddenLayersMax;
}

delegate('#layersEditor', 'click', 'button', (button) => {
  const i = +button.dataset.i;
  const actions = {
    plus: () => (draft.hidden[i] = Math.min(LIMITS.neuronsMax, draft.hidden[i] + 1)),
    minus: () => (draft.hidden[i] = Math.max(LIMITS.neuronsMin, draft.hidden[i] - 1)),
    del: () => draft.hidden.splice(i, 1),
  };
  actions[button.dataset.act]();
  onDraftChange();
});

$('#addLayer').addEventListener('click', () => {
  draft.hidden.push(6);
  onDraftChange();
});

/** Черновик архитектуры изменился: применить сразу или спросить, если пропадёт обученный мозг */
function onDraftChange() {
  renderLayers();
  const changed = !sameSizes(draft, state.config);
  if (changed && !state.champion) applyDraft();
  else {
    $('#pending').hidden = !changed;
    if (changed) {
      $('#pendingText').textContent = `Сеть станет ${sizesOf(draft).join(' → ')}. Обученный мозг (поколение ${state.generation}) под неё не подходит и будет сброшен.`;
      if (mode === 'auto') setMode('manual');
    }
  }
  if (car.sensors.count !== draft.sensors.count) resetCar();
  else Object.assign(car.sensors, draft.sensors);
  editor.reset();
  editor.render();
}

function applyDraft() {
  const resized = !sameSizes(draft, state.config);
  state.config = structuredClone(draft);
  persist();
  $('#pending').hidden = true;
  if (resized) resetProgress();
  renderLayers();
  editor.render();
}

$('#pendingApply').addEventListener('click', applyDraft);
$('#pendingCancel').addEventListener('click', () => {
  draft = structuredClone(state.config);
  syncSensorSliders();
  onDraftChange();
});

// ── как думает ──

function renderThink() {
  const variants = live.think.thinkVariants ?? {};
  if (!variants[state.config.think]) state.config.think = variants.step ? 'step' : Object.keys(variants)[0];
  $('#thinkSelect').innerHTML = options(Object.entries(variants).map(([id, v]) => ({ id, title: v.title || id })));
  $('#thinkSelect').value = draft.think = state.config.think;
  $('#thinkHint').textContent = variants[state.config.think]?.hint ?? '';
}

$('#thinkSelect').addEventListener('change', (e) => {
  state.config.think = e.target.value;
  persist();
  renderThink();
  if (mode === 'auto') resetCar();
});

// ── реакция на другие вкладки ──

on('champion', ({ by }) => {
  if (by !== 'editor' && state.tab === 'garage') editor.render();
});
on('reset', () => {
  editor.reset();
  if (mode === 'auto') setMode('manual');
});
on('code', (file) => {
  if (file === 'think') renderThink();
});

export const renderNetwork = () => editor.render();
