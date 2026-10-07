// «Я учу»: кнопка на трассе «Вид из машины» (#25). Нажал (или клавиша V) — камера садится позади машины;
// нажал ещё раз — снова вид сверху. Выбор помнит браузер. Рулить и учить можно в обоих видах — это только картинка.
// Рядом — выключатель звука мотора (в обоих видах): браузер разрешает звук лишь после нажатия, поэтому — кнопкой.
import { signal } from '@reely/dommy';
import { listen } from '@reely/dommy-kit';
import { stored } from '../storage.ts';
import { state } from '../state.ts';
import { isTyping, calm } from '../ui.ts';
import { showBanner } from '../stage.ts';
import { wakeSound } from '../engine-sound.ts';

const isOn = (saved: unknown): saved is boolean => typeof saved === 'boolean';
const cockpit = stored('cockpit', false, isOn);
const sound = stored('sound', false, isOn);

/** Включён ли вид из машины */
export const cockpitOn = (): boolean => cockpit.peek();
/** Звучит ли мотор */
export const soundOn = (): boolean => sound.peek();

function toggleSound(): void {
  sound.update((on) => !on);
  if (sound.peek()) wakeSound();
}

const warned = signal(false); // подсказку про укачивание показываем один раз

export function toggleCockpit(): void {
  cockpit.update((on) => !on);
  if (cockpit.peek() && calm.value && !warned.peek()) {
    warned.value = true;
    showBanner('Если укачивает — нажми «Вид из машины» ещё раз или V: вернётся вид сверху', 3600);
  }
}

// V — как в гоночных играх. Только на «Я учу» и не когда печатаешь в поле
listen(window, 'keydown', (e) => {
  if (e.code !== 'KeyV' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || state.tab !== 'teach' || isTyping(e.target)) return;
  e.preventDefault();
  toggleCockpit();
});
// Звук включили в прошлый раз — после перезагрузки браузер снова ждёт касания: первое нажатие его и будит
for (const type of ['pointerdown', 'keydown'] as const) listen(window, type, () => { if (soundOn()) wakeSound(); });

/** Кнопка в углу трассы: тёмный пластик, как табло; нажата — значит, смотришь из машины */
export function ViewSwitch(): Node {
  return (
    <button className="view-btn" id="dView" title="Вид из машины (V)"
      aria={{ ariaLabel: 'Вид из машины', ariaPressed: () => String(cockpit.value) }} onClick={toggleCockpit}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 16v-4l2.5-5h11l2.5 5v4z" /><path d="M8 11h8" /><path d="M6 16v2.5M18 16v2.5" />
      </svg>
      <span>Вид из машины</span>
    </button>
  );
}

/** Выключатель звука мотора — и сверху, и из машины */
export function SoundSwitch(): Node {
  return (
    <button className="view-btn" id="dSound" title="Звук мотора"
      aria={{ ariaLabel: 'Звук мотора', ariaPressed: () => String(sound.value) }} onClick={toggleSound}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
        <path d={() => (sound.value ? 'M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11' : 'M16 9.5l5 5M21 9.5l-5 5')} />
      </svg>
      <span>Звук</span>
    </button>
  );
}
