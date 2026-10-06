// Пульт шоу под трассой: этап, старт и пауза, скорость показа, камера и режим трансляции.
import { signal } from '@reely/dommy';
import type { Signal } from '@reely/dommy';
import { stageLabel } from '../../engine/world/rally.ts';
import { calc, STAGE_COUNT } from './calc.ts';
import { stage, phase, speed, camera, watched, play, selectStage } from './stream.ts';
import type { CameraMode } from './stream.ts';
import { listen } from '@reely/dommy-kit';

// ── режим трансляции: только трасса и таблица, на весь экран ──

const broadcast = signal(false);

/** Включить или выключить трансляцию (класс на body прячет всё лишнее, см. app/styles/final.css) */
export function setBroadcast(on: boolean): void {
  if (broadcast.peek() === on) return;
  broadcast.value = on;
  document.body.classList.toggle('broadcast', on);
  if (on) document.documentElement.requestFullscreen?.().catch(() => {}); // не дали на весь экран — просто без него
  else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
// Вышли из полноэкранного режима (Esc браузера) — выходим и из трансляции
listen(document, 'fullscreenchange', () => {
  if (!document.fullscreenElement) setBroadcast(false);
});
listen(document, 'keydown', (e) => {
  if (e.key === 'Escape') setBroadcast(false);
});

// ── кнопки ──

/** Группа кнопок-переключателей: нажата та, чьё значение сейчас выбрано */
function Seg<T extends string | number>({ label, value, options }: { label: string; value: Signal<T>; options: [T, string][] }): Node {
  return (
    <div className="seg" aria={{ role: 'group', ariaLabel: label }}>
      {options.map(([option, text]) => (
        <button aria={{ ariaPressed: () => String(value.value === option) }} onClick={() => (value.value = option)}>{text}</button>
      ))}
    </div>
  );
}

function playText(): string {
  switch (phase.value) {
    case 'counting': return '3… 2… 1…';
    case 'running': return '⏸ Пауза';
    case 'paused': return 'Дальше';
    default: return 'Старт этапа';
  }
}

export function Toolbar(): Node {
  const stages = Array.from({ length: STAGE_COUNT }, (_, i) => i);
  return (
    <>
      <div className="seg" id="fStages" aria={{ role: 'group', ariaLabel: 'Этап' }}>
        {stages.map((i) => (
          <button data-fstage={String(i)} disabled={() => !calc.value} aria={{ ariaPressed: () => String(stage.value === i) }}
            onClick={() => selectStage(i)}>
            {() => `${stageLabel(i)}${watched.value.has(i) ? ' ✓' : ''}`}
          </button>
        ))}
      </div>
      <button className="btn primary" id="fPlay" disabled={() => !calc.value || phase.value === 'counting'} onClick={play}>{playText}</button>
      <Seg label="Скорость показа" value={speed} options={[[1, '×1'], [2, '×2'], [4, '×4']]} />
      <Seg<CameraMode> label="Камера" value={camera} options={[['follow', 'За лидером'], ['fit', 'Вся трасса']]} />
      <button className="btn" id="fBroadcast" aria={{ ariaPressed: () => String(broadcast.value) }} onClick={() => setBroadcast(!broadcast.peek())}>Трансляция</button>
    </>
  );
}
