// Вкладка «Финал» (для кураторов): работы участников → расчёт в Web Worker → шоу этап за этапом → итоги.
//
// Расчёт и показ разделены. Сначала все заезды считаются заранее (несколько секунд),
// потом на стриме показывается запись — плавно, с любой скоростью и без сюрпризов.
// Этот модуль и всё в app/final/ грузятся лениво: app/main.js импортирует его, только когда финал открыли.
//
//   app/final/works.ts  — шаг 1: файлы, ключ курса, допуск чужих файлов, аватары
//   app/final/calc.ts   — шаг 2: расчёт (pool.ts → Web Worker worker.ts → job.ts)
//   app/final/stream.ts — шаг 3: шоу, запись на холсте (show.ts)
//   setup.tsx, board.tsx, toolbar.tsx — как это выглядит; export.ts — итоги в файлы
import { mount } from '@reely/dommy';
import { state } from '../state.ts';
import { element } from '../dom.ts';
import { readDrop } from '../final/entries.ts';
import { loadFiles } from '../final/works.ts';
import { frame } from '../final/stream.ts';
import { Setup } from '../final/setup.tsx';
import { Standings } from '../final/board.tsx';
import { Toolbar, setBroadcast } from '../final/toolbar.tsx';

mount(element('#finalPanel'), () => (
  <>
    <Setup />
    <Standings />
  </>
));
mount(element('.toolbar[data-for="final"]'), () => <Toolbar />);

// Папку с работами можно перетащить прямо на трассу
const viewport = element('#viewport');
const onFinal = (e: DragEvent) => {
  if (state.tab !== 'final') return false;
  e.preventDefault(); // иначе браузер откроет файл сам
  return true;
};
viewport.addEventListener('dragover', (e) => {
  if (onFinal(e)) viewport.classList.add('drop');
});
viewport.addEventListener('dragleave', () => viewport.classList.remove('drop'));
viewport.addEventListener('drop', (e) => {
  if (!onFinal(e)) return;
  viewport.classList.remove('drop');
  if (e.dataTransfer) loadFiles(readDrop(e.dataTransfer));
});

export const finalTab = {
  enter() {
    // панель и пульт обновляются сами (сигналы), а трассу рисует frame
  },
  frame,
};

/** Уходим с вкладки — выходим из трансляции */
export function leaveFinal(): void {
  setBroadcast(false);
}
