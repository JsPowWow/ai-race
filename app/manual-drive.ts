// Ручное управление: клавиатура, кнопки и джойстик на экране (app/joystick.ts) → функция студента handleKey().
// Вкладка, где сейчас можно рулить руками, отдаёт сюда controls своей машины.
import { live } from './student-code.ts';
import { showBanner } from './stage.ts';
import { $$, isTyping } from './ui.ts';
import type { Controls } from '../engine/world/car.ts';
import { listen } from '@reely/dommy-kit';
import { messageOf } from '@reely/basics';

let target: Controls | null = null; // пульт машины, которой рулят руками
let onPadTouch: (() => void) | null = null;

/** controls — чем рулить; onTouch — что сделать, если нажали кнопку на экране, а руками пока не рулят */
export function steerWith(controls: Controls | null, { onTouch = null }: { onTouch?: (() => void) | null } = {}): void {
  target = controls;
  onPadTouch = onTouch;
}

/** Нажать или отпустить клавишу — как будто на клавиатуре. true — handleKey() её взял */
export function press(key: string, down: boolean): boolean {
  if (!target) return false;
  try {
    return !!live.controls.handleKey(key, down, target);
  } catch (e) {
    showBanner(`Ошибка в handleKey(): ${messageOf(e)}`, 3000);
    return false;
  }
}

listen(window, 'keydown', (e) => {
  if (isTyping(e.target)) return;
  const handled = e.repeat ? !!target && e.key.startsWith('Arrow') : press(e.key, true);
  if (handled) e.preventDefault();
});
listen(window, 'keyup', (e) => {
  if (!isTyping(e.target)) press(e.key, false);
});
listen(window, 'blur', () => {
  if (target) Object.assign(target, { gas: 0, brake: 0, left: 0, right: 0 }); // отпустили окно — отпустили и кнопки
});

/** Тронули пульт или джойстик на экране: если руками пока не рулят — вкладка пересадит тебя за руль */
export function touchPad(): void {
  if (!target) onPadTouch?.();
}

for (const button of $$('.pad button')) {
  const key = button.dataset.key ?? '';
  const release = () => {
    button.classList.remove('on');
    press(key, false);
  };
  listen(button, 'pointerdown', (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    button.classList.add('on');
    touchPad();
    press(key, true);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) listen(button, type, release);
}
