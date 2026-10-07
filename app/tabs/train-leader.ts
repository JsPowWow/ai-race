// «Мозг лидера»: то же табло, что на титульной, только мозг — у машины роя, которая сейчас впереди.
// Табло — холст: его рисует кадр вкладки (showLeaderBrain), а разметка лежит в app/markup.html.
import type { Car } from '../../engine/world/car.ts';
import { state } from '../state.ts';
import { liveBrain } from '../brain-board/live.ts';
import { element } from '../dom.ts';

const IDLE = 'Нажми «Старт» — здесь загорится мозг машины, которая едет впереди.';
const LIVE = 'Горит то, что лидер видит и жмёт прямо сейчас. Пунктир — память.';

const board = liveBrain({ fold: '.leader-brain', canvas: '#leaderBoard', card: '#leaderFormula' });
const hint = element('#leaderHint');
const screen = element('.leader-brain .brain-board');
let shown = false; // табло уже что-то показало

/**
 * Показать мозг лидера (null — роя нет). Зовётся каждый кадр, поэтому страницу трогает, только если что-то поменялось.
 * running = false — рой на паузе: табло замирает, как стоп-кадр (время для него не идёт, импульсы стоят)
 */
export function showLeaderBrain(lead: Car | null, running = true): void {
  if (!board.isOpen()) return;
  if (lead && !lead.lastInputs && shown) return; // новое поколение ещё не тронулось: держим прошлый кадр, иначе табло мигнёт и страница прыгнет
  const brain = lead?.brain, inputs = lead?.lastInputs, think = lead?.think;
  const ready = !!(brain && inputs && think);
  const text = ready ? LIVE : IDLE;
  if (hint.textContent !== text) hint.textContent = text;
  screen.hidden = !ready;
  if (!brain || !inputs || !think) return;
  board.show({ brain, inputs, think, thinkId: state.config.think }, running);
  shown = true;
}

/** Сменилась тема или размер — табло перечитывает цвета */
export const redrawLeaderBrain = (): void => board.readColors();
