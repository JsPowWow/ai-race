// Отсчёт «3 — 2 — 1 — СТАРТ!» поверх трассы. Общий для гонки и финала.
import { $ } from './ui.js';

const STEP_MS = 700;
let startedAt = 0;

export function startCountdown() {
  startedAt = performance.now();
}

export function stopCountdown() {
  startedAt = 0;
  $('#countdown').hidden = true;
}

/** Вызывать каждый кадр. true — прозвучало «СТАРТ!», машины могут ехать. */
export function updateCountdown() {
  if (!startedAt) return false;
  const el = $('#countdown');
  const step = Math.floor((performance.now() - startedAt) / STEP_MS);
  if (step >= 4) {
    stopCountdown();
    return true;
  }
  const text = step < 3 ? String(3 - step) : 'СТАРТ!';
  el.hidden = false;
  el.classList.toggle('go', step >= 3);
  const span = el.firstElementChild;
  if (span.textContent !== text) {
    span.textContent = text;
    span.style.animation = 'none';
    void span.offsetWidth; // перезапуск анимации
    span.style.animation = '';
  }
  return step >= 3;
}
