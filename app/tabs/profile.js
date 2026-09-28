// Вкладка «Профиль»: сборка машины за очки (#19) — глаза вперёд и назад, слои мозга, как он думает.
// На трассе текущий мозг ездит по кругу со встречными: видно, куда смотрят сенсоры и что они видят.
import { getTrainingTrack } from '../../engine/track.js';
import { Car, rayCount } from '../../engine/car.js';
import { LIMITS, inputCount, OUTPUTS, checkBrain } from '../../engine/brain.js';
import { BUDGET, PRICES, cost } from '../../engine/build.js';
import { withTraffic } from '../../engine/traffic.js';
import { state, persist, sizesOf, thinkFn, on } from '../state.js';
import { live } from '../student-code.js';
import { changeShape, shapeResetsBrain } from '../library.js';
import { drawScene, paintCar, trafficOn, setHud } from '../stage.js';
import { $, options, delegate } from '../ui.js';

const track = withTraffic(getTrainingTrack('warmup'), 'all');
let car = null;

export const profileTab = {
  enter() {
    renderShape();
    resetCar();
  },
  frame() {
    if (car.done) resetCar();
    car.step(track, Infinity, trafficOn(track, car.ticks));
    drawScene(track, { camera: 'follow', follow: car, traffic: trafficOn(track, car.ticks), tick: car.ticks });
    paintCar(car, { color: state.profile.color, sensors: true, number: 1 });
    setHud([
      car.brain ? 'едет <b class="word">мозг</b>' : 'мозг не обучен — машина стоит',
      `сенсоры <b>${[...car.readings].map((v) => v.toFixed(2)).join(' ')}</b>`,
    ]);
  },
};

/** Машина с текущей сборкой: ездит текущий мозг, если он к ней подходит */
function resetCar() {
  const fits = state.champion && !checkBrain(state.champion, sizesOf());
  car = new Car(track, { sensors: state.config.sensors, ...(fits ? { brain: state.champion, think: thinkFn() } : {}) });
}

// ── очки ──

/** Что стоит сколько — для людей */
const PRICE_LIST = [
  [PRICES.sensor, 'сенсор вперёд'],
  [PRICES.reach, '+10 px дальности вперёд (сверх 80)'],
  [PRICES.back, 'сенсор назад'],
  [PRICES.backReach, '+10 px дальности назад (сверх 40)'],
  [PRICES.neuron, 'нейрон'],
  [PRICES.layer, 'второй и третий скрытый слой'],
];
$('#bPrices').innerHTML = PRICE_LIST.map(([price, what]) => `<li><b>${price}</b> ${what}</li>`).join('');
$('#bBudget').textContent = String(BUDGET);

/** Сенсоры назад без дальности бессмысленны: включили первый — дадим короткие */
const withBackDefaults = (sensors) => (sensors.back ? { backLength: 80, ...sensors } : sensors);

// ── глаза ──

/** @type {[selector: string, key: 'count' | 'spread' | 'length' | 'back' | 'backLength', format: (v: number) => string][]} */
const SENSOR_SLIDERS = [
  ['#sCount', 'count', (v) => `${v}`],
  ['#sSpread', 'spread', (v) => `${v}°`],
  ['#sLength', 'length', (v) => `${v} px`],
  ['#sBack', 'back', (v) => (v ? `${v}` : 'нет')],
  ['#sBackLength', 'backLength', (v) => `${v} px`],
];

for (const [id, key] of SENSOR_SLIDERS) {
  $(id).addEventListener('input', (e) => {
    const shape = pendingShape ?? state.config;
    askShape({ ...shape, sensors: withBackDefaults({ ...shape.sensors, [key]: +e.target.value }) });
    renderShape();
  });
}

/** Другая форма сети не подходит к обученному мозгу — спросим, прежде чем начинать с нуля */
let pendingShape = null;
function askShape(config) {
  const price = cost(config);
  const tooDear = price > BUDGET && price > cost(pendingShape ?? state.config); // дешевле — можно всегда, даже если сборка уже дороже бюджета
  $('#bMsg').hidden = !tooDear;
  if (tooDear) {
    $('#bMsg').textContent = `Не хватает очков: такая сборка стоит ${price}, а есть ${BUDGET}. Сначала откажись от чего-нибудь.`;
    return;
  }
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
  renderShape();
});
$('#shapeNo').addEventListener('click', () => {
  $('#shapeConfirm').hidden = true;
  pendingShape = null;
  renderShape();
});

// ── мозг: слои и как думает ──

function renderShape() {
  const shape = pendingShape ?? state.config;
  const sensors = { back: 0, backLength: 80, ...shape.sensors };
  for (const [id, key, format] of SENSOR_SLIDERS) {
    $(id).value = String(sensors[key]);
    $(`${id}Out`).textContent = format(sensors[key]);
  }
  $('#sBackLength').disabled = !sensors.back;

  const spent = cost(shape);
  $('#bSpent').textContent = String(spent);
  $('#bLeft').textContent = spent < BUDGET ? `· свободно ${BUDGET - spent}` : '· всё потрачено';
  $('#bBar').style.width = `${Math.min(100, (spent / BUDGET) * 100)}%`;

  const hidden = shape.hidden.map((n, i) => `
    <span class="arrow" aria-hidden="true">→</span>
    <span class="layer">Слой ${i + 1}
      <button data-act="minus" data-i="${i}" aria-label="Меньше нейронов в слое ${i + 1}">−</button><b>${n}</b>
      <button data-act="plus" data-i="${i}" aria-label="Больше нейронов в слое ${i + 1}">+</button>
      <button data-act="del" data-i="${i}" aria-label="Удалить слой ${i + 1}">×</button>
    </span>`).join('');
  $('#layersEditor').innerHTML = `
    <span class="layer fixed" title="сенсоры сейчас, скорость, сенсоры мгновение назад, знак, заметки">Входы <b>${inputCount(rayCount(shape.sensors))}</b></span>${hidden}
    <span class="arrow" aria-hidden="true">→</span><span class="layer fixed" title="4 кнопки пульта и заметки">Выходы <b>${OUTPUTS}</b></span>`;
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
  askShape({ ...shape, hidden: [...shape.hidden, 2] });
  renderShape();
});

$('#thinkSelect').addEventListener('change', (e) => {
  state.config.think = e.target.value;
  persist();
  renderShape();
  resetCar();
});

// ── реакция на перемены ──

on('config', () => {
  if (state.tab !== 'profile') return;
  renderShape();
  resetCar();
});
on('champion', () => state.tab === 'profile' && resetCar());
on('code', (file) => file === 'think' && state.tab === 'profile' && renderShape());
