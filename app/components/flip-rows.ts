// Плавная перестановка строк: обогнал — строка переезжает на новое место, а не прыгает.
// Порядок меняет логика (заезд, шоу финала), а список рисует вид. flip() из kit должен замерить строки
// ДО перемены — поэтому логика проводит запись через run(), а вид отдаёт список через attach.
import { flip } from '@reely/dommy-kit';

export type FlipRows = {
  /** Вид: elementRef={rows.attach} у списка, чьи строки переставляются */
  attach: (list: Element) => void;
  /** Логика: поменять порядок (записать сигнал) — строки, что сдвинулись, доедут до новых мест */
  run: (change: () => void) => void;
};

export function flipRows(): FlipRows {
  let list: Element | null = null;
  return {
    attach: (el) => {
      list = el;
    },
    // списка ещё нет на странице (или он спрятан) — просто меняем, анимировать нечего
    run: (change) => (list?.isConnected && list.getClientRects().length ? flip(list, change) : change()),
  };
}
