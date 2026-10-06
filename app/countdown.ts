// Отсчёт «3 — 2 — 1 — СТАРТ!» поверх трассы. Общий для гонки и финала.
// Вместе с цифрами гаснут пять огней на табло у черты: последний гаснет ровно на «СТАРТ!».
import { element } from './dom.ts';
import { setStartLights } from '../engine/draw/scenery-draw.ts';

const STEP_MS = 700;
let startedAt = 0;
const box = element('#countdown');

export function startCountdown(): void {
  startedAt = performance.now();
  setStartLights(5);
}

export function stopCountdown(): void {
  startedAt = 0;
  box.hidden = true;
  setStartLights(0);
}

/** Вызывать каждый кадр. true — прозвучало «СТАРТ!», машины могут ехать. */
export function updateCountdown(): boolean {
  if (!startedAt) return false;
  const passed = performance.now() - startedAt;
  const step = Math.floor(passed / STEP_MS);
  setStartLights(5 - Math.floor(passed / ((3 * STEP_MS) / 5))); // за «3 — 2 — 1» гаснут все пять
  if (step >= 4) {
    stopCountdown();
    return true;
  }
  const text = step < 3 ? String(3 - step) : 'СТАРТ!';
  box.hidden = false;
  box.classList.toggle('go', step >= 3);
  const span = box.firstElementChild;
  if (span instanceof HTMLElement && span.textContent !== text) {
    span.textContent = text;
    span.style.animation = 'none';
    void span.offsetWidth; // перезапуск анимации
    span.style.animation = '';
  }
  return step >= 3;
}
