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
  ['accel', 'Газ', 0.005, 0.2, 0.001],
  ['brake', 'Тормоз', 0.01, 0.3, 0.001],
  ['friction', 'Трение', 0, 0.1, 0.001],
  ['coast', 'Торможение двигателем', 0, 0.1, 0.001],
  ['maxSpeed', 'Макс. скорость', 2, 8, 0.1],
  ['grip', 'Сцепление', 0.01, 0.4, 0.001],
  ['minRadius', 'Самый крутой радиус', 20, 120, 5],
  ['steerRate', 'Руль к упору (чем меньше, тем дольше держать)', 0.01, 1, 0.005],
  ['centerRate', 'Возврат руля к середине', 0.01, 1, 0.005],
  ['pivot', 'Точка поворота: 0 — центр, 1 — задняя ось', 0, 1, 0.1],
];

/** Физика, какой она была до подстройки */
const ORIGINAL = Object.fromEntries(KNOBS.map(([key]) => [key, CAR[key]]));
/** Готовые наборы: [подсказка, числа]. А, Б и В подобраны перебором (tools/tune-search.mjs): «водитель за клавиатурой»
 * с реакцией 0,15–0,25 с ни разу не вылетел на трёх трассах и проехал круг быстрее остальных. Названия нарочно без описаний — пробуй вслепую */
const PRESETS = {
  'А': ['Прокатись и скажи, что понравилось.',
    { accel: 0.07, brake: 0.11, friction: 0.03, coast: 0.08, maxSpeed: 4.25, grip: 0.17, minRadius: 45, steerRate: 0.29, centerRate: 0.38, pivot: 1 }],
  'Б': ['Прокатись и скажи, что понравилось.',
    { accel: 0.06, brake: 0.11, friction: 0.025, coast: 0.06, maxSpeed: 5, grip: 0.12, minRadius: 50, steerRate: 0.21, centerRate: 0.38, pivot: 1 }],
  'В': ['Прокатись и скажи, что понравилось.',
    { accel: 0.05, brake: 0.15, friction: 0.02, coast: 0.035, maxSpeed: 5.5, grip: 0.13, minRadius: 55, steerRate: 0.13, centerRate: 0.34, pivot: 1 }],
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
  const preset = PRESETS[name]?.[1];
  const values = preset ?? load('tune', ORIGINAL);
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
