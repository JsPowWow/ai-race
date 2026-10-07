// Живое табло мозга в свёрнутом блоке <details>: «Мозг лидера» роя и табло «Профиля».
// Каждый кадр вкладка отдаёт мозг и то, что машина видит, а табло пересчитывает ход мысли и рисует его.
import type { Brain } from '../../engine/net/brain.ts';
import type { Think } from '../../engine/world/car.ts';
import { live } from '../student-code.ts';
import { element } from '../dom.ts';
import { phone } from '../ui.ts';
import { createBrainBoard, type BrainBoard } from './board.ts';
import { SMOOTH, ANY_ACT } from './formula.ts';

/** Что показать: мозг, его входы и как он думает (thinkId — вариант из think.js: от него зависит подпись выходов) */
export type Thought = { brain: Brain; inputs: number[]; think: Think; thinkId: string };

export type LiveBrain = {
  /** Блок раскрыт? Свёрнутое табло не считаем и не рисуем */
  isOpen(): boolean;
  /** Кадр табло. running = false — пауза: импульсы стоят, как на стоп-кадре */
  show(thought: Thought, running?: boolean): void;
  /** Сменилась тема или размер — перечитать цвета */
  readColors(): void;
};

/** fold — селектор блока <details>; внутри — холст canvas, карточка формулы card и кнопки .zoom */
export function liveBrain({ fold, canvas, card }: { fold: string; canvas: string; card: string }): LiveBrain {
  const details = element<HTMLDetailsElement>(fold);
  // на телефоне табло большое: свёрнуто, чтобы кнопки и настройки были ближе
  if (phone.value) details.open = false;
  let board: BrainBoard | null = null;
  let at = performance.now();
  return {
    isOpen: () => details.open,
    show({ brain, inputs, think, thinkId }, running = true) {
      const act = thinkId === 'smooth' ? SMOOTH : ANY_ACT;
      board ??= createBrainBoard({ canvas: element<HTMLCanvasElement>(canvas), card: element(card), zoomBar: element<HTMLElement>(`${fold} .zoom`), brain, act });
      board.setBrain(brain, act);
      // пересчитать ход мысли на этих входах: feedForward из think.js запишет, что посчитал каждый слой
      const feed = live.think.feedForward;
      feed.lastTrace = null;
      think(inputs, brain);
      const trace = feed.lastTrace as number[][] | null; // TypeScript не знает, что вызов выше его поменял
      const now = performance.now();
      if (trace) board.frame(trace, [], running ? (now - at) / 1000 : 0);
      at = now;
    },
    readColors: () => board?.readColors(),
  };
}
