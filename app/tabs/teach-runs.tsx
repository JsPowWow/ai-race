// «Я учу», блок «Мои заезды»: записанные заезды выбранной машины, галочка «учить на этом»
// и кнопка «Учить на заездах». Что такое заезд и где он лежит — app/runs.js; здесь только вид.
import { untracked, For, Show } from '@reely/dommy';
import { sensorsOf } from '../../engine/brain.ts';
import type { CarStatus } from '../../engine/car.ts';
import { state, sizesOf } from '../state.js';
import { runs, toggleRun, removeRun } from '../runs.js';
import { secs, pct } from '../ui.js';
import { fromEvents } from '../signals.ts';
import { MIN_SAMPLES, lesson, epoch, stopped, canLearn, thinkSwitch, startTraining, LearnBox } from './teach-learn.tsx';
import { plural } from './teach-words.ts';

/** Записанный заезд (см. app/runs.js). 'stopped' — прервал сам: «Заново», сменил трассу */
type Run = {
  id: string; trackName: string; status: Exclude<CarStatus, 'driving'> | 'stopped';
  progressPct: number; ticks: number; inputs: number; packed: string[]; on: boolean;
};
/** Заезд в списке. fits — записан с теми же глазами, что сейчас: на других учить нельзя, у сети другие входы */
type Row = Run & { fits: boolean };

/**
 * Заезды выбранной машины — каждый раз новые объекты строк: так строки узнают, что их отметили.
 * runs.js шлёт 'save', когда заезды поменялись; 'car' — пересели (у машины свои заезды); 'config' — другие глаза.
 */
const rows = fromEvents(['save', 'car', 'config'], (): Row[] => {
  const inputs = sizesOf()[0];
  return (runs as Run[]).map((run) => ({ ...run, fits: run.inputs === inputs }));
});
/** Сколько сенсоров у машины сейчас (заезд с другим числом не подходит) */
const sensorsNow = () => sensorsOf(sizesOf()[0]);
const trained = fromEvents(['champion', 'reset', 'car'], () => !!state.champion);
const carName = fromEvents(['save', 'car'], () => state.profile.name || 'Без имени');

/** На чём будем учить: отмеченные заезды, которые подходят к сети */
const used = () => rows().filter((run) => run.on && run.fits);
const sampleTotal = () => used().reduce((n, run) => n + run.packed.length, 0);
/** Заезды с другими глазами — на них сейчас не учим, и об этом надо сказать */
const strangers = () => rows().filter((run) => !run.fits).length;

const STATUS_LABEL: Record<Run['status'], string> = { finished: 'финиш', crashed: 'авария', stalled: 'заглох', timeout: 'время вышло', stopped: 'прервал' };

function result(run: Run): string {
  if (run.status === 'finished') return secs(run.ticks);
  return `${STATUS_LABEL[run.status]}${run.progressPct ? ` ${pct(run.progressPct)}` : ''}`;
}

function meta(row: Row): string {
  const examples = ` · ${row.packed.length} прим.`;
  if (row.fits) return examples;
  const was = sensorsOf(row.inputs);
  return `${examples} · записан с ${was} ${plural(was, 'сенсором', 'сенсорами', 'сенсорами')}, а сейчас их ${sensorsNow()} — не учим`;
}

function rowClass(row: Row): string {
  const off = row.on && row.fits ? '' : 'off';
  const mood = row.status === 'finished' ? 'good' : row.status === 'crashed' ? 'bad' : '';
  return [off, mood].filter(Boolean).join(' ');
}

function RunRow({ run }: { run: () => Row }): Node {
  const id = untracked(run).id; // id — ключ строки, у неё он не меняется
  return (
    <li className={() => rowClass(run())}>
      {/* заезд с другими глазами не отмечен, даже если галочка стояла: на нём сейчас не учим */}
      <input type="checkbox" checked={() => run().on && run().fits} disabled={() => !run().fits}
        aria={{ ariaLabel: 'Учить на этом заезде' }} onChange={() => toggleRun(id)} />
      <span>{() => run().trackName}<span className="meta">{() => meta(run())}</span></span>
      <span className="res">{() => result(run())}</span>
      <button aria={{ ariaLabel: 'Удалить заезд' }} onClick={() => removeRun(id)}>×</button>
    </li>
  );
}

/** Что под кнопкой «Учить на заездах»: чего не хватает или на чём будем учить */
function status(): string {
  if (lesson.value) return '';
  if (stopped.value) return stopped.value;
  const samples = sampleTotal();
  if (samples < MIN_SAMPLES) return `Нужно хотя бы ${MIN_SAMPLES} примеров в отмеченных заездах (сейчас ${samples}) — это пара заездов по «Разминке».`;
  const count = used().length;
  return `${count} ${plural(count, 'заезд', 'заезда', 'заездов')}, ${samples} примеров. ${trained() ? 'Мозг продолжит учиться с того, что уже умеет.' : 'Мозга ещё нет — начнём с нуля.'}`;
}

export function Runs(): Node {
  const others = () => {
    const n = strangers();
    return `${n} ${plural(n, 'заезд записан', 'заезда записаны', 'заездов записаны')} с другими глазами машины: у сети другие входы, на них сейчас не учим. Вернёшь прежние сенсоры в «Профиле» — пригодятся снова.`;
  };
  return (
    <section className="block">
      <h2>Мои заезды</h2>
      <p className="hint" id="runsHint">Просто езди: заезд записывается сам — от старта до финиша или аварии. Каждый тик — пример «что видят сенсоры → что ты нажал».</p>
      <ol className="runs" id="runsList">
        <For each={rows} by={(run) => run.id}>{(run) => <RunRow run={run} />}</For>
        <Show when={() => !rows().length}>{() => <li className="empty">Пока пусто. Нажми газ — запись начнётся сама.</li>}</Show>
      </ol>
      <p className="note" id="runsOthers" hidden={() => !strangers()}>{others}</p>
      <button className="btn primary" id="teachGo" disabled={() => !!lesson.value || sampleTotal() < MIN_SAMPLES || !canLearn()}
        onClick={startTraining}>
        {() => (lesson.value ? `Учится… ${epoch()}/${lesson.value.total}` : 'Учить на заездах')}
      </button>
      <p className="note" id="teachStatus" aria={{ role: 'status' }}>{status}</p>
      <p className="note" id="teachThink" hidden={() => !thinkSwitch()}>{thinkSwitch}</p>
      <LearnBox />
      <p className="hint" id="exMemory">{() => `Это заезды машины «${carName()}»: у каждой машины гаража свои. Выбрать другую — в «Профиле».`}</p>
    </section>
  );
}
