// Отсчёт «3 — 2 — 1 — СТАРТ!» поверх трассы. Общий для гонки и финала.
import { element } from './dom.ts';

const STEP_MS = 700;
let startedAt = 0;
const box = element('#countdown');

export function startCountdown(): void {
  startedAt = performance.now();
}

export function stopCountdown(): void {
  startedAt = 0;
  box.hidden = true;
}

/** Вызывать каждый кадр. true — прозвучало «СТАРТ!», машины могут ехать. */
export function updateCountdown(): boolean {
  if (!startedAt) return false;
  const step = Math.floor((performance.now() - startedAt) / STEP_MS);
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
