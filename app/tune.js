// ПРОТОТИП (ветка wip/tune, в main не идёт). Подстройка руля: ползунки меняют физику машины прямо на ходу.
// Нужна, чтобы подобрать «ощущение» ручной езды, прежде чем переобучать под него ботов.
// Меняет только этот браузер: сохраняется у тебя и работает в ветке-прототипе wip/tune.
// Боты и рой учились на обычной физике — с другими числами они могут ездить хуже.
import { CAR, Car, maxCurve } from '../engine/car.js';
import { getTrainingTrack } from '../engine/track.js';
import { load, save } from './storage.js';
import { $ } from './ui.js';

/** Что можно крутить: ключ CAR, подпись, пределы, шаг */
const KNOBS = [
  ['accel', 'Газ', 0.02, 0.2, 0.005],
  ['brake', 'Тормоз', 0.03, 0.3, 0.005],
  ['friction', 'Трение', 0, 0.1, 0.005],
  ['coast', 'Торможение двигателем', 0, 0.1, 0.005],
  ['maxSpeed', 'Макс. скорость', 2, 8, 0.25],
  ['grip', 'Сцепление', 0.02, 0.4, 0.01],
  ['minRadius', 'Самый крутой радиус', 20, 120, 5],
  ['steerRate', 'Руль к упору (чем меньше, тем дольше держать)', 0.02, 1, 0.01],
  ['centerRate', 'Возврат руля к середине', 0.02, 1, 0.01],
  ['pivot', 'Точка поворота: 0 — центр, 1 — задняя ось', 0, 1, 0.1],
];

/** Физика, какой она была до подстройки */
const ORIGINAL = Object.fromEntries(KNOBS.map(([key]) => [key, CAR[key]]));
/** Готовые наборы: с чего начать. Масштаб: машина 44 px ≈ 4,4 м, значит 10 px ≈ 1 м, скорость 1 ≈ 21,6 км/ч */
const REAL = { friction: 0.01, pivot: 1 }; // у всех настоящих: колёса катятся легко, по дуге идёт задняя ось
const PRESETS = {
  'Легковушка': ['Обычная машина: разгоняется не спеша, тормозит втрое сильнее, в поворот — только сбросив скорость (перегрузка до 1,1 g).',
    { ...REAL, accel: 0.04, brake: 0.12, coast: 0.02, maxSpeed: 5, grip: 0.03, minRadius: 55, steerRate: 0.03, centerRate: 0.06 }],
  'Спорткар': ['Быстрая и цепкая (1,8 g): мощный тормоз, руль отзывчивее. Перед крутым поворотом всё равно тормози.',
    { ...REAL, accel: 0.07, brake: 0.2, coast: 0.03, maxSpeed: 6, grip: 0.05, minRadius: 55, steerRate: 0.05, centerRate: 0.1 }],
  'Картинг': ['Маленький и цепкий (2,5 g): скорость ниже, руль острый, почти все повороты — на газу.',
    { ...REAL, friction: 0.02, accel: 0.07, brake: 0.15, coast: 0.05, maxSpeed: 4, grip: 0.07, minRadius: 35, steerRate: 0.1, centerRate: 0.15 }],
  'Машинка на пульте': ['Игрушка на игрушечной трассе: резкая, цепкая, руль почти мгновенный — как в аркадах.',
    { ...REAL, friction: 0.03, accel: 0.1, brake: 0.2, coast: 0.06, maxSpeed: 5, grip: 0.2, minRadius: 40, steerRate: 0.15, centerRate: 0.25 }],
  'Твой + задняя ось': ['Твои числа, но поворачивает как настоящая машина: нос ведёт, хвост идёт следом.',
    { accel: 0.075, brake: 0.1, friction: 0.03, coast: 0.055, maxSpeed: 5, grip: 0.1, minRadius: 50, steerRate: 0.18, centerRate: 0.18, pivot: 1 }],
  'Твой': ['Твои числа как есть: машина крутится вокруг центра.',
    { accel: 0.075, brake: 0.1, friction: 0.03, coast: 0.055, maxSpeed: 5, grip: 0.1, minRadius: 50, steerRate: 0.18, centerRate: 0.18, pivot: 0 }],
  'Как на сайте': ['Физика, как сейчас на сайте: на ней учились боты.', ORIGINAL],
};
let active = '';

const degPerSec = (radPerTick) => Math.round((radPerTick * 60 * 180) / Math.PI);
const kmh = (v) => `${Math.round(v * 21.6)} км/ч`;
const seconds = (ticks) => `${(ticks / 60).toFixed(2).replace('.', ',')} с`;

/** Сколько тиков машина едет с такими кнопками, пока не выполнится условие */
function ticksUntil(controls, from, done) {
  const car = new Car(getTrainingTrack('warmup'));
  car.speed = from;
  Object.assign(car.controls, controls);
  let ticks = 0;
  while (!done(car) && ticks < 2000) { car.move(); ticks++; }
  return ticks;
}

/** Числа, по которым видно, как едет машина с этой физикой */
function feel() {
  const v = CAR.maxSpeed;
  const best = Math.min(v, Math.sqrt(CAR.grip * CAR.minRadius)); // на этой скорости машина поворачивает быстрее всего
  const corner = Math.min(v, Math.sqrt(CAR.grip * 160)); // самый крутой поворот трасс — радиус около 160 px
  return [
    ['макс. скорость', kmh(v)],
    ['поворот на полной скорости', `${degPerSec(v * maxCurve(v))}°/с`],
    [`быстрее всего (на ${kmh(best)})`, `${degPerSec(best * maxCurve(best))}°/с`],
    ['радиус на полной скорости', `${Math.round(1 / maxCurve(v))} px`],
    ['крутой поворот трассы — не быстрее', kmh(corner)],
    ['сцепление', `${((CAR.grip * 3600) / 10 / 9.8).toFixed(1).replace('.', ',')} g`],
    ['разгон с места', seconds(ticksUntil({ gas: 1 }, 0, (c) => c.speed >= v - 2 * CAR.friction))],
    ['без газа: с полной до ¾', seconds(ticksUntil({}, v, (c) => c.speed <= v * 0.75))],
    ['тормоз: с полной до 0', seconds(ticksUntil({ brake: 1 }, v, (c) => c.speed <= 0))],
    ['руль до упора', seconds(Math.ceil(1 / CAR.steerRate))],
    ['руль обратно', seconds(Math.ceil(1 / CAR.centerRate))],
  ];
}

function apply(name) {
  active = name;
  const values = PRESETS[name]?.[1] ?? load('tune', ORIGINAL);
  for (const [key] of KNOBS) CAR[key] = values[key] ?? ORIGINAL[key];
  save('tune', Object.fromEntries(KNOBS.map(([key]) => [key, CAR[key]])));
  render();
}

const box = document.createElement('aside');
box.className = 'tune';
box.setAttribute('aria-label', 'Подстройка руля');

function render() {
  box.innerHTML = `
    <details${matchMedia('(max-width: 700px)').matches ? '' : ' open'}>
      <summary>Подстройка руля</summary>
      <p class="tune-note">Рули на «Я учу»: щёлкни по трассе, потом стрелки. Числа — только в этом браузере, боты учились на обычной физике.</p>
      <div class="tune-presets">${Object.keys(PRESETS).map((name) => `<button type="button" data-preset="${name}" aria-pressed="${name === active}">${name}</button>`).join('')}</div>
      ${active ? `<p class="tune-hint">${PRESETS[active][0]}</p>` : ''}
      ${KNOBS.map(([key, title, min, max, step]) => `
        <label class="tune-knob"><span>${title}</span>
          <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${CAR[key]}">
          <output>${CAR[key]}</output>
        </label>`).join('')}
      <dl class="tune-feel">${feel().map(([what, value]) => `<dt>${what}</dt><dd>${value}</dd>`).join('')}</dl>
      <button type="button" class="tune-copy">Скопировать числа</button>
    </details>`;
}

box.addEventListener('input', (e) => {
  const input = /** @type {HTMLInputElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('input[data-key]'));
  if (!input) return;
  CAR[input.dataset.key] = +input.value;
  input.nextElementSibling.textContent = input.value;
  if (active) { active = ''; box.querySelector('.tune-hint')?.remove(); box.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false'); }
  save('tune', Object.fromEntries(KNOBS.map(([key]) => [key, CAR[key]])));
  box.querySelector('.tune-feel').innerHTML = feel().map(([what, value]) => `<dt>${what}</dt><dd>${value}</dd>`).join('');
});
// отпустил ползунок — стрелки снова рулят машиной, а не ползунком
box.addEventListener('change', (e) => /** @type {HTMLElement} */ (e.target).blur());
box.addEventListener('click', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  const preset = /** @type {HTMLElement | null} */ (target.closest('[data-preset]'));
  if (preset) apply(preset.dataset.preset);
  target.blur(); // стрелки — машине, а не кнопке
  const copy = target.closest('.tune-copy');
  if (copy) {
    const text = KNOBS.map(([key]) => `${key}: ${CAR[key]}`).join(', ');
    navigator.clipboard?.writeText(text).then(() => { copy.textContent = 'Скопировано'; }, () => { copy.textContent = text; });
  }
});

export function mountTune() {
  apply('');
  document.body.append(box);
  // рулить руками можно только на «Я учу» — сразу туда
  if (document.body.dataset.tab !== 'teach') /** @type {HTMLElement} */ (document.querySelector('.tabs button[data-tab="teach"]'))?.click();
  // страница может быть в рамке (iframe): клавиши доходят до неё, только когда она в фокусе
  $('#viewport')?.addEventListener('pointerdown', () => {
    /** @type {HTMLElement} */ (document.activeElement)?.blur?.();
    window.focus();
  });
}
