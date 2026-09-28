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
// ── настоящие машины ──
// Масштаб: 10 px ≈ 1 м (наша машина 44 px ≈ 4,4 м), 60 тиков ≈ 1 с.
// Разгон 0–100, скорость, тормозной путь и радиус разворота — из характеристик и тестов; сцепление в поворотах
// у обычных шин 0,75–0,85 g. Где цифры не нашлись, взяты типичные для такой машины (отмечены «≈»).
const CARS = {
  'Toyota Corolla': { from: '1.8 гибрид (E210): 0–100 за 10,9 с, 180 км/ч, тормозной путь со 100 — 35,2 м (ADAC), радиус разворота 5,4 м, сцепление ≈ 0,85 g',
    zeroTo100: 10.9, top: 180, brake100: 35.2, g: 0.85, radius: 5.4 },
  'Nissan Qashqai': { from: '1.3 DIG-T 140 (J12): 0–100 за 10,2 с, 196 км/ч, тормозной путь ≈ 36 м, радиус разворота ≈ 5,5 м, высокий кроссовер — сцепление ≈ 0,8 g',
    zeroTo100: 10.2, top: 196, brake100: 36, g: 0.8, radius: 5.5 },
  'Daihatsu Cuore': { from: '1.0 (L276): 0–100 за 11 с, 160 км/ч, узкие шины — тормозной путь ≈ 40 м и сцепление ≈ 0,75 g, крошечная — радиус разворота ≈ 4,4 м',
    zeroTo100: 11, top: 160, brake100: 40, g: 0.75, radius: 4.4 },
};
/** Во сколько раз ускорить время: трассы у нас короткие, повороты крутые (радиус ~16 м) — в реальном времени разгон тянется долго */
let time = 1;
const round = (v) => Math.round(v * 10000) / 10000;

/** Физика настоящей машины: m/s² → px/тик², при ускоренном в k раз времени скорости ×k, ускорения ×k² */
function fromReal(car, k) {
  const acc = (ms2) => round(((ms2 * 10) / 3600) * k * k);
  const kmhToTick = (kmh) => (kmh / 3.6) * 10 / 60;
  const friction = acc(0.2); // качение и воздух: машина катится долго
  return {
    accel: round(acc(100 / 3.6 / car.zeroTo100) + friction), // средний разгон 0–100 плюс то, что съедает трение
    brake: acc((100 / 3.6) ** 2 / (2 * car.brake100)),
    friction,
    coast: acc(0.8),                                              // торможение двигателем ≈ 0,08 g
    maxSpeed: round(Math.min(6, kmhToTick(car.top) * k)),         // быстрее 6 (≈ 130 км/ч) трассам не нужно
    grip: acc(car.g * 9.8),
    minRadius: Math.round(car.radius * 10),
    // Баранка настоящей машины доходит до упора ≈ за 0,8 с, но её крутят плавно. Стрелки — «вкл/выкл»:
    // с таким медленным рулём машину раскачивает и выносит. Поэтому руль быстрее: до упора 0,33 с, обратно 0,17 с
    steerRate: 0.05,
    centerRate: 0.1,
    pivot: 1,
  };
}

/** Готовые наборы: [подсказка, числа] (числа настоящих машин считаются с учётом ускорения времени) */
const PRESETS = {
  ...Object.fromEntries(Object.entries(CARS).map(([name, car]) => [name, [car.from, () => fromReal(car, time)]])),
  'Машинка на пульте': ['Игрушка на игрушечной трассе: резкая, цепкая, руль почти мгновенный — как в аркадах.',
    { friction: 0.03, accel: 0.1, brake: 0.2, coast: 0.06, maxSpeed: 5, grip: 0.2, minRadius: 40, steerRate: 0.15, centerRate: 0.25, pivot: 1 }],
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
  const values = typeof preset === 'function' ? preset() : preset ?? load('tune', ORIGINAL);
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
      <div class="tune-presets" role="group" aria-label="Время для настоящих машин">Время
        ${[1, 1.5, 2].map((k) => `<button type="button" data-time="${k}" aria-pressed="${k === time}">×${String(k).replace('.', ',')}</button>`).join('')}</div>
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
  const speedUp = /** @type {HTMLElement | null} */ (target.closest('[data-time]'));
  if (speedUp) {
    time = +speedUp.dataset.time;
    apply(typeof PRESETS[active]?.[1] === 'function' ? active : 'Toyota Corolla');
  }
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
