// Ручное управление: клавиатура и кнопки на экране → функция студента handleKey().
// Вкладка, где сейчас можно рулить руками, отдаёт сюда controls своей машины.
import { live } from './student-code.ts';
import { showBanner } from './stage.ts';
import { $$, isTyping } from './ui.ts';
import type { Controls } from '../engine/car.ts';

let target: Controls | null = null; // пульт машины, которой рулят руками
let onPadTouch: (() => void) | null = null;

/** controls — чем рулить; onTouch — что сделать, если нажали кнопку на экране, а руками пока не рулят */
export function steerWith(controls: Controls | null, { onTouch = null }: { onTouch?: (() => void) | null } = {}): void {
  target = controls;
  onPadTouch = onTouch;
}

function press(key: string, down: boolean): boolean {
  if (!target) return false;
  try {
    return !!live.controls.handleKey(key, down, target);
  } catch (e) {
    showBanner(`Ошибка в handleKey(): ${e instanceof Error ? e.message : String(e)}`, 3000);
    return false;
  }
}

window.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) return;
  const handled = e.repeat ? !!target && e.key.startsWith('Arrow') : press(e.key, true);
  if (handled) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  if (!isTyping(e.target)) press(e.key, false);
});
window.addEventListener('blur', () => {
  if (target) Object.assign(target, { gas: 0, brake: 0, left: 0, right: 0 }); // отпустили окно — отпустили и кнопки
});

for (const button of $$('.pad button')) {
  const key = button.dataset.key ?? '';
  const release = () => {
    button.classList.remove('on');
    press(key, false);
  };
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    button.classList.add('on');
    if (!target) onPadTouch?.();
    press(key, true);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
}
