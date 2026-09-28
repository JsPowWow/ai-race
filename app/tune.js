// ПРОТОТИП (ветка wip/tune, в main не идёт). // Подстройка руля (ветка-прототип wip/tune): ползунки меняют физику машины прямо на ходу.
// Нужна, чтобы подобрать «ощущение» ручной езды, прежде чем переобучать под него ботов.
// Меняет только этот браузер: сохраняется у тебя и работает в ветке-прототипе wip/tune.
// Боты и рой учились на обычной физике — с другими числами они могут ездить хуже.
import { CAR, Car, maxCurve } from '../engine/car.js';
import { getTrainingTrack } from '../engine/track.js';
import { load, save } from './storage.js';

/** Что можно крутить: ключ CAR, подпись, пределы, шаг */
const KNOBS = [
  ['accel', 'Газ', 0.02, 0.2, 0.005],
  ['brake', 'Тормоз', 0.03, 0.3, 0.005],
  ['friction', 'Трение', 0, 0.1, 0.005],
  ['coast', 'Торможение двигателем', 0, 0.1, 0.005],
  ['maxSpeed', 'Макс. скорость', 2, 8, 0.25],
  ['grip', 'Сцепление', 0.02, 0.4, 0.01],
  ['minRadius', 'Самый крутой радиус', 20, 120, 5],
  ['steerRate', 'Скорость руля', 0.04, 1, 0.02],
];

/** Физика, какой она была до подстройки */
const ORIGINAL = Object.fromEntries(KNOBS.map(([key]) => [key, CAR[key]]));
/** Готовые наборы: с чего начать */
const PRESETS = {
  'Как сейчас': ORIGINAL,
  'Бодрее': { ...ORIGINAL, grip: 0.1, coast: 0.03 },
  'Аркада': { ...ORIGINAL, grip: 0.2, coast: 0.04, minRadius: 40, steerRate: 0.2 },
};

const degPerSec = (radPerTick) => Math.round((radPerTick * 60 * 180) / Math.PI);
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
  return [
    ['поворот на полной скорости', `${degPerSec(v * maxCurve(v))}°/с`],
    [`быстрее всего (на ${best.toFixed(1)})`, `${degPerSec(best * maxCurve(best))}°/с`],
    ['радиус на полной скорости', `${Math.round(1 / maxCurve(v))} px`],
    ['разгон с места', seconds(ticksUntil({ gas: 1 }, 0, (c) => c.speed >= v - 2 * CAR.friction))],
    ['без газа: с полной до ¾', seconds(ticksUntil({}, v, (c) => c.speed <= v * 0.75))],
    ['тормоз: с полной до 0', seconds(ticksUntil({ brake: 1 }, v, (c) => c.speed <= 0))],
  ];
}

function apply(values) {
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
      <p class="tune-note">Только в этом браузере. Боты учились на обычной физике.</p>
      <div class="tune-presets">${Object.keys(PRESETS).map((name) => `<button type="button" data-preset="${name}">${name}</button>`).join('')}</div>
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
  save('tune', Object.fromEntries(KNOBS.map(([key]) => [key, CAR[key]])));
  box.querySelector('.tune-feel').innerHTML = feel().map(([what, value]) => `<dt>${what}</dt><dd>${value}</dd>`).join('');
});
// отпустил ползунок — стрелки снова рулят машиной, а не ползунком
box.addEventListener('change', (e) => /** @type {HTMLElement} */ (e.target).blur());
box.addEventListener('click', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  const preset = /** @type {HTMLElement | null} */ (target.closest('[data-preset]'));
  if (preset) apply(PRESETS[preset.dataset.preset]);
  const copy = target.closest('.tune-copy');
  if (copy) {
    const text = KNOBS.map(([key]) => `${key}: ${CAR[key]}`).join(', ');
    navigator.clipboard?.writeText(text).then(() => { copy.textContent = 'Скопировано'; }, () => { copy.textContent = text; });
  }
});

export function mountTune() {
  apply(load('tune', ORIGINAL));
  document.body.append(box);
}
