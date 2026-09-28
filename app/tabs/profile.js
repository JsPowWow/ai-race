// Вкладка «Профиль»: облик машины и сборка за очки (#19) — глаза вперёд и назад, слои мозга, как он думает.
// Сборку меняешь черновиком: машина на трассе и табло мозга сразу показывают, что получится, а в сборку
// всё уходит разом — по «Применить». «Отменить» возвращает как было.
import { getTrainingTrack } from '../../engine/track.js';
import { Car, rayCount, rays, BACK_SPREAD } from '../../engine/car.js';
import { LIMITS, inputCount, OUTPUTS, checkBrain, createBrain } from '../../engine/brain.js';
import { BUDGET, PRICES, cost } from '../../engine/build.js';
import { withTraffic } from '../../engine/traffic.js';
import { state, sizesOf, thinkFn, on } from '../state.js';
import { live } from '../student-code.js';
import { changeShape, shapeResetsBrain } from '../library.js';
import { drawScene, paintCar, trafficOn, setHud } from '../stage.js';
import { createBrainBoard } from '../brain-board/board.js';
import { SMOOTH, ANY_ACT } from '../brain-board/formula.js';
import { $, options, delegate } from '../ui.js';
import { renderLook } from './profile-look.js';

const track = withTraffic(getTrainingTrack('warmup'), 'all');
let car = null;

/** Черновик сборки (null — черновика нет, на экране то, что в сборке) */
let draft = null;
const shown = () => draft ?? state.config;

export const profileTab = {
  enter() {
    renderLook();
    renderShape();
    resetCar();
  },
  frame() {
    if (car.done) resetCar();
    car.step(track, Infinity, trafficOn(track, car.ticks));
    drawScene(track, { camera: 'follow', follow: car, traffic: trafficOn(track, car.ticks), tick: car.ticks });
    paintCar(car, { color: state.profile.color, sensors: true, number: 1 });
    showBrain();
    const readings = [...car.readings].map((v) => v.toFixed(2));
    const front = car.sensors.count;
    setHud([
      car.brain ? `едет <b class="word">мозг</b>${draft ? ' · черновик' : ''}` : state.champion ? 'черновик: мозг не подходит — стоит' : 'мозг не обучен — машина стоит',
      `вперёд <b>${readings.slice(0, front).join(' ')}</b>`,
      ...(readings.length > front ? [`назад <b>${readings.slice(front).join(' ')}</b>`] : []),
    ]);
  },
};

/** Обученный мозг, если он подходит к сборке на экране, иначе null */
const fittingBrain = () => (state.champion && !checkBrain(state.champion, sizesOf(shown())) ? state.champion : null);

/** Машина со сборкой на экране: ездит обученный мозг, если он к ней подходит, иначе стоит с новыми сенсорами */
function resetCar() {
  const brain = fittingBrain();
  car = new Car(track, { sensors: shown().sensors, ...(brain ? { brain, think: thinkFn(shown().think) } : {}) });
}

// ── черновик ──

/** Одна и та же сборка? (сенсоры сравниваем по лучам: дальность назад без сенсоров назад ничего не меняет) */
const same = (a, b) => JSON.stringify([rays(a.sensors), a.hidden, a.think]) === JSON.stringify([rays(b.sensors), b.hidden, b.think]);

/** Поменять что-то в черновике. Дороже бюджета нельзя; дешевле — можно всегда, даже если сборка уже дороже */
function edit(next) {
  const price = cost(next);
  const tooDear = price > BUDGET && price > cost(shown());
  $('#bMsg').hidden = !tooDear;
  if (tooDear) {
    $('#bMsg').textContent = `Не хватает очков: такая сборка стоит ${price}, а есть ${BUDGET}. Сначала откажись от чего-нибудь.`;
    return;
  }
  draft = same(next, state.config) ? null : next;
  resetCar();
  renderShape();
}

function renderDraftBar() {
  const bar = $('#draftBar');
  bar.hidden = !draft;
  if (!draft) return;
  const resets = shapeResetsBrain(draft);
  bar.classList.toggle('danger', resets);
  $('#draftText').textContent = resets
    ? `Сеть станет ${sizesOf(draft).join('-')}. Нынешний мозг под неё не подходит — учиться придётся с нуля (он останется в «Истории»).`
    : 'Форма сети та же: мозг уже едет с новой сборкой — смотри на трассе. Применить?';
  $('#draftApply').classList.toggle('danger', resets);
  $('#draftApply').classList.toggle('primary', !resets);
}

$('#draftApply').addEventListener('click', () => {
  const next = draft;
  draft = null;
  if (next) changeShape(next); // дальше — событие config: перерисуем и пересадим машину
});
$('#draftCancel').addEventListener('click', () => {
  draft = null;
  $('#bMsg').hidden = true;
  renderShape();
  resetCar();
});

// ── табло мозга: какая сеть получится с этой сборкой и что она думает прямо сейчас ──

const BRAIN_TRAINED = 'Горит то, что мозг видит и жмёт прямо сейчас. Меняешь сенсоры или слои — табло меняется сразу.';
const BRAIN_EMPTY = 'Так выглядит сеть с этой сборкой. Мозг под неё ещё не обучен: все связи — нули, горят только входы. Научи его на «Я учу» или «Учится само».';
const emptyBrains = new Map(); // форма → пустой мозг (чтобы не создавать каждый кадр)
let board = null, boardAt = performance.now();

function showBrain() {
  if (!$('.profile-brain').open || !car.lastInputs) return; // свёрнуто или машина ещё не посмотрела вокруг
  const sizes = sizesOf(shown());
  const key = sizes.join('-');
  if (!emptyBrains.has(key)) emptyBrains.set(key, createBrain(sizes, () => 0.5)); // 0.5 → все веса 0
  const brain = fittingBrain() ?? emptyBrains.get(key);
  const hint = brain === state.champion ? BRAIN_TRAINED : BRAIN_EMPTY;
  if ($('#profileBrainHint').textContent !== hint) $('#profileBrainHint').textContent = hint;
  const act = shown().think === 'smooth' ? SMOOTH : ANY_ACT;
  board ??= createBrainBoard({ canvas: $('#profileBoard'), card: $('#profileFormula'), zoomBar: $('.profile-brain .zoom'), brain, act });
  board.setBrain(brain, act);
  live.think.feedForward.lastTrace = null;
  thinkFn(shown().think)(car.lastInputs, brain);
  const trace = live.think.feedForward.lastTrace;
  const now = performance.now();
  if (trace) board.frame(trace.map((l) => [...l]), [], (now - boardAt) / 1000);
  boardAt = now;
}

export const redrawProfileBrain = () => board?.readColors();
if (matchMedia('(max-width: 700px)').matches) $('.profile-brain').open = false;

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
const withBackDefaults = (sensors) => (sensors.back ? { backLength: 80, backSpread: BACK_SPREAD, ...sensors } : sensors);

// ── глаза ──

/** @type {[selector: string, key: 'count' | 'spread' | 'length' | 'back' | 'backLength' | 'backSpread', format: (v: number) => string][]} */
const SENSOR_SLIDERS = [
  ['#sCount', 'count', (v) => `${v}`],
  ['#sSpread', 'spread', (v) => `${v}°`],
  ['#sLength', 'length', (v) => `${v} px`],
  ['#sBack', 'back', (v) => (v ? `${v}` : 'нет')],
  ['#sBackLength', 'backLength', (v) => `${v} px`],
  ['#sBackSpread', 'backSpread', (v) => `${v}°`],
];

for (const [id, key] of SENSOR_SLIDERS) {
  $(id).addEventListener('input', (e) => {
    const shape = shown();
    edit({ ...shape, sensors: withBackDefaults({ ...shape.sensors, [key]: +e.target.value }) });
  });
}

// ── мозг: слои и как думает ──

function renderShape() {
  const shape = shown();
  const sensors = { back: 0, backLength: 80, backSpread: BACK_SPREAD, ...shape.sensors };
  for (const [id, key, format] of SENSOR_SLIDERS) {
    $(id).value = String(sensors[key]);
    $(`${id}Out`).textContent = format(sensors[key]);
  }
  $('#sBackLength').disabled = $('#sBackSpread').disabled = !sensors.back;

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
  const layerPrice = PRICES.layer + LIMITS.neuronsMin * PRICES.neuron;
  $('#addLayer').disabled = shape.hidden.length >= LIMITS.hiddenLayersMax;
  $('#addLayer').title = shape.hidden.length >= LIMITS.hiddenLayersMax
    ? `Больше ${LIMITS.hiddenLayersMax} слоёв не бывает`
    : `Новый слой из ${LIMITS.neuronsMin} нейронов: ${layerPrice} очков`;

  const variants = live.think.thinkVariants ?? {};
  if (!variants[state.config.think]) state.config.think = variants.step ? 'step' : Object.keys(variants)[0];
  $('#thinkSelect').innerHTML = options(Object.entries(variants).map(([id, v]) => ({ id, title: v.title || id })));
  $('#thinkSelect').value = shape.think in variants ? shape.think : state.config.think;
  $('#thinkHint').textContent = variants[$('#thinkSelect').value]?.hint ?? '';

  renderDraftBar();
}

delegate('#layersEditor', 'click', 'button', (button) => {
  const i = +button.dataset.i;
  const shape = shown();
  const hidden = [...shape.hidden];
  if (button.dataset.act === 'plus') hidden[i] = Math.min(LIMITS.neuronsMax, hidden[i] + 1);
  if (button.dataset.act === 'minus') hidden[i] = Math.max(LIMITS.neuronsMin, hidden[i] - 1);
  if (button.dataset.act === 'del') hidden.splice(i, 1);
  edit({ ...shape, hidden });
});
$('#addLayer').addEventListener('click', () => {
  const shape = shown();
  edit({ ...shape, hidden: [...shape.hidden, LIMITS.neuronsMin] });
});
$('#thinkSelect').addEventListener('change', (e) => edit({ ...shown(), think: e.target.value }));

// ── реакция на перемены ──

on('config', () => {
  if (state.tab !== 'profile') return;
  renderShape();
  resetCar();
});
on('champion', () => state.tab === 'profile' && resetCar());
on('code', (file) => file === 'think' && state.tab === 'profile' && renderShape());
