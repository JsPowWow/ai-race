// «Мозг лидера»: то же табло, что на титульной, только мозг — у машины роя, которая сейчас впереди.
// Табло — холст: его рисует кадр вкладки (showLeaderBrain), а разметка лежит в app/markup.html.
import type { Car } from '../../engine/world/car.ts';
import { state } from '../state.ts';
import { live } from '../student-code.ts';
import { createBrainBoard, type BrainBoard } from '../brain-board/board.ts';
import { SMOOTH, ANY_ACT } from '../brain-board/formula.ts';
import { element } from '../dom.ts';
import { phone } from '../ui.ts';

const IDLE = 'Нажми «Старт» — здесь загорится мозг машины, которая едет впереди.';
const LIVE = 'Горит то, что лидер видит и жмёт прямо сейчас. Пунктир — память.';

const fold = element<HTMLDetailsElement>('.leader-brain');
const hint = element('#leaderHint');
const screen = element('.leader-brain .brain-board');
let board: BrainBoard | null = null;
let boardAt = performance.now();

/**
 * Показать мозг лидера (null — роя нет). Зовётся каждый кадр, поэтому страницу трогает, только если что-то поменялось.
 * running = false — рой на паузе: табло замирает, как стоп-кадр (время для него не идёт, импульсы стоят)
 */
export function showLeaderBrain(lead: Car | null, running = true): void {
  if (!fold.open) return; // табло свёрнуто — не считаем и не рисуем
  if (lead && !lead.lastInputs && board) return; // новое поколение ещё не тронулось: держим прошлый кадр, иначе табло мигнёт и страница прыгнет
  const brain = lead?.brain, inputs = lead?.lastInputs, think = lead?.think;
  const ready = !!(brain && inputs && think);
  const text = ready ? LIVE : IDLE;
  if (hint.textContent !== text) hint.textContent = text;
  screen.hidden = !ready;
  if (!brain || !inputs || !think) return;
  const act = state.config.think === 'smooth' ? SMOOTH : ANY_ACT;
  board ??= createBrainBoard({ canvas: element<HTMLCanvasElement>('#leaderBoard'), card: element('#leaderFormula'), zoomBar: element<HTMLElement>('.leader-brain .zoom'), brain, act });
  board.setBrain(brain, act);
  // пересчитать ход мысли лидера на его последних входах: think студента запишет его в lastTrace
  const feed = live.think.feedForward;
  feed.lastTrace = null;
  think(inputs, brain);
  const trace = feed.lastTrace as number[][] | null; // TypeScript не знает, что вызов выше его поменял
  const now = performance.now();
  if (trace) board.frame(trace, [], running ? (now - boardAt) / 1000 : 0);
  boardAt = now;
}

/** Сменилась тема или размер — табло перечитывает цвета */
export const redrawLeaderBrain = (): void => board?.readColors();

// на телефоне табло большое: свёрнуто, чтобы график и настройки были ближе к кнопкам
if (phone.value) fold.open = false;
