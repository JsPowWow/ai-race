// Финал, шаг 3: шоу. Показываем посчитанную запись этапа: отсчёт, машины на трассе, HUD, баннер в конце.
// Тик меняется каждый кадр, поэтому он — обычная переменная; таблице раз в BOARD_EVERY кадров
// отдаём порядок машин (boardOrder), а не перестраиваем её на каждый кадр.
import { batch, computed, effect, signal, untracked } from '@reely/dommy';
import { isSuperfinal, stageLabel, trafficSnapshot } from '../../engine/world/rally.ts';
import { getTrainingTrack } from '../../engine/world/track.ts';
import { startCountdown, stopCountdown, updateCountdown } from '../countdown.ts';
import { drawScene, setHud, lapText, showBanner } from '../stage.ts';
import { field, bold } from '../ui.ts';
import { secs } from '../format.ts';
import { StageReplay, countStatuses, drawStage, drawProgressStrip } from './show.ts';
import type { Placed, ReplayRow } from './show.ts';
import { calc } from './calc.ts';
import type { Calc } from './calc.ts';
import { pool, racers } from './works.ts';
import type { FinalEntry } from './entries.ts';
import { flipRows } from '../components/flip-rows.ts';

const BOARD_EVERY = 6; // обновлять таблицу раз в столько кадров

/** Строки таблицы финала (board.tsx) переезжают плавно: порядок меняем только через boardRows.run */
export const boardRows = flipRows();

/** ready — стоим (в начале или после финиша этапа), counting — «3… 2… 1…», running — едут, paused — пауза посреди этапа */
export type Phase = 'ready' | 'counting' | 'running' | 'paused';
export type CameraMode = 'follow' | 'fit';

/** Какой этап показываем (0…STAGES, последний — суперфинал) */
export const stage = signal(0);
export const replay = signal<StageReplay | null>(null);
export const phase = signal<Phase>('ready');
export const speed = signal(1);
export const camera = signal<CameraMode>('follow');
/** Этапы, которые уже досмотрели до конца: после них таблица показывает общий зачёт */
export const watched = signal<ReadonlySet<number>>(new Set());
/** Порядок машин для таблицы — обновляется не каждый кадр */
export const boardOrder = signal<Placed[]>([]);
/** Что ищут в таблице */
export const query = signal('');
/** Тик записи, который сейчас на экране */
let tick = 0;

/** Участник, которого ищут: сначала точный ник, потом часть ника или имени машины */
export const found = computed((): FinalEntry | null => {
  const q = query.value.trim().toLowerCase();
  if (!q) return null;
  const { entries } = pool.value;
  return entries.find((x) => x.author.toLowerCase() === q)
    ?? entries.find((x) => x.author.toLowerCase().includes(q) || x.name.toLowerCase().includes(q))
    ?? null;
});
/** Идёт этап (или стоит на паузе): таблица показывает живой порядок */
export const live = () => phase.value === 'running' || phase.value === 'paused';

// Новый расчёт — смотрим с первого этапа; расчёт сброшен — показывать нечего
effect(() => {
  const done = calc.value;
  untracked(() => {
    watched.value = new Set();
    if (done) selectStage(0, done);
    else {
      stopCountdown();
      replay.value = null;
      phase.value = 'ready';
    }
  });
});

export function selectStage(i: number, done = calc.peek()): void {
  if (!done) return;
  stopCountdown();
  const rows: ReplayRow[] = [];
  for (const entry of done.entries) {
    const result = done.results[i].get(entry.id);
    if (result && !entry.dq) rows.push({ entry, result });
  }
  const next = new StageReplay(done.tracks[i], rows);
  tick = 0;
  boardRows.run(() => batch(() => {
    stage.value = i;
    replay.value = next;
    phase.value = 'ready';
    boardOrder.value = next.order(0);
  }));
}

/** Кнопка «Старт этапа» / «Пауза» / «Дальше» */
export function play(): void {
  const now = replay.peek();
  if (!now) return;
  switch (phase.peek()) {
    case 'running':
      phase.value = 'paused';
      boardOrder.value = now.order(tick);
      break;
    case 'paused':
      phase.value = 'running';
      break;
    case 'ready':
      tick = 0;
      phase.value = 'counting';
      boardOrder.value = now.order(0);
      startCountdown();
      break;
    case 'counting':
      break; // кнопка и так выключена
  }
}

function stageEnded(done: Calc, now: StageReplay): void {
  const i = stage.peek();
  const order = now.order(tick);
  // этап доехал — таблица переходит к общему зачёту: строки переезжают на свои новые места
  boardRows.run(() => batch(() => {
    phase.value = 'ready';
    watched.update((seen) => new Set([...seen, i]));
    boardOrder.value = order;
  }));
  if (isSuperfinal(i)) {
    const winner = done.final[0]?.entry;
    showBanner(winner ? `Победитель финала — ${winner.name} (@${winner.author})!` : 'Финал завершён', 6000);
  } else {
    const leader = order[0]?.row.entry;
    showBanner(leader ? `${stageLabel(i)}: быстрее всех ${leader.name}` : `${stageLabel(i)} завершён`, 4000);
  }
}

/** Кадр шоу: отсчёт, ход записи, рисунок */
export function frame(frameNo: number): void {
  if (updateCountdown() && phase.peek() === 'counting') phase.value = 'running';
  const now = replay.peek();
  const done = calc.peek();
  if (!now || !done) {
    drawWaiting();
    return;
  }
  if (phase.peek() === 'running') {
    tick = Math.min(tick + speed.peek(), now.length);
    if (tick >= now.length) stageEnded(done, now);
    else if (frameNo % BOARD_EVERY === 0) boardRows.run(() => (boardOrder.value = now.order(tick)));
  }
  drawReplay(now);
}

/** До расчёта: пустая разминочная трасса и подсказка, что делать */
function drawWaiting(): void {
  drawScene(getTrainingTrack('warmup'));
  const count = racers.peek().length;
  setHud([bold('Финал курса'), count ? field('участников', count) : 'загрузите работы', calc.peek() ? '' : 'потом — «Посчитать финал»']);
}

function drawReplay(now: StageReplay): void {
  const order = now.order(tick);
  const foundId = found.peek()?.id ?? null;
  // камера — за найденным участником, иначе за первым, кто ещё едет
  const target = order.find((x) => x.row.entry.id === foundId) ?? order.find((x) => x.car.status === 'driving') ?? order[0];
  const { track } = now;
  const follow = target && { x: target.car.x, y: target.car.y, angle: target.car.angle }; // камере нужно только где машина
  drawScene(track, { camera: camera.peek(), follow, traffic: trafficSnapshot(track, tick), tick });
  drawStage(order, { foundId });
  drawProgressStrip(order, { foundId });
  const count = countStatuses(order);
  setHud([
    bold(stageLabel(stage.peek())),
    field('время', secs(tick)),
    target ? lapText(track, track.startS + target.car.progress * (track.finishS - track.startS)) : '',
    field('на трассе', count.driving),
    field('финиш', count.finished),
    field('сошли', count.out),
    speed.peek() > 1 ? `×${speed.peek()}` : '',
  ]);
}
