// «Экзамен», таблица итогов: трасса, итог, время. Щёлкнул строку — на трассе повтор этого заезда.
import { signal, For, Show } from '@reely/dommy';
import { state, on, emit } from '../state.ts';
import { showBanner } from '../stage.ts';
import { secs, pct } from '../ui.ts';
import { runExam, verdict, KNOWN_COUNT, UNKNOWN_COUNT } from './exam-run.ts';
import type { ExamResult } from './exam-run.ts';

/** Итоги последней проверки (пусто — ещё не проверяли этот мозг) */
export const results = signal<readonly ExamResult[]>([]);
/** Какой заезд показываем на трассе (номер строки) или null */
export const selected = signal<number | null>(null);

/** «Проверить чемпиона»: все трассы сразу, на трассе — первый провал (или первая, если провалов нет) */
export function check(): void {
  if (!state.champion) return showBanner('Сначала обучи мозг: на «Я учу» или «Учится само»');
  const list = runExam();
  results.value = list;
  selected.value = Math.max(0, list.findIndex((r) => r.status !== 'finished'));
  emit('did', 'exam');
}

// Мозг поменялся — прежние итоги уже не про него
on('champion', () => {
  results.value = [];
  selected.value = null;
});

/** Итог словами и его цвет */
function statusOf(result: ExamResult): { text: string; className: string } {
  if (result.status === 'finished') return { text: 'доехал', className: 'st-ok' };
  if (result.status === 'crashed') return { text: `${result.into === 'car' ? 'авария' : 'бордюр'} на ${pct(result.pct)}`, className: 'st-bad' };
  return { text: `заглох на ${pct(result.pct)}`, className: 'st-meh' };
}

/** Строку можно выбрать и с клавиатуры: Tab до неё, потом Enter или пробел */
function showOnEnter(e: KeyboardEvent, index: number): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault(); // пробел иначе прокрутит страницу
  selected.value = index;
}

export function Results(): Node {
  // строки — каждый раз новые объекты: так строка узнаёт, что после новой проверки у неё другой итог
  const rows = () => results.value.map((result, index) => ({ result, index }));
  return (
    <section className="block">
      <h2>Результаты</h2>
      <div className="table-wrap">
        <table className="results" id="examTable">
          <thead><tr><th>Трасса</th><th>Итог</th><th className="num">Время</th></tr></thead>
          <tbody>
            <For each={rows} by={(row) => row.index}>
              {(row) => {
                const result = () => row().result;
                return (
                  <tr className={() => (selected.value === row().index ? 'sel' : null)} tabIndex={0}
                    onClick={() => (selected.value = row().index)} onKeyDown={(e) => showOnEnter(e, row().index)}>
                    <td>{() => result().title}</td>
                    <td><span className={() => statusOf(result()).className}>{() => statusOf(result()).text}</span></td>
                    <td className="num">{() => (result().status === 'finished' ? secs(result().ticks) : '—')}</td>
                  </tr>
                );
              }}
            </For>
            <Show when={() => !results.value.length}>
              {() => (
                <tr className="empty">
                  <td colSpan={3}>Нажми «Проверить чемпиона»: он проедет {KNOWN_COUNT} знакомые и {UNKNOWN_COUNT} незнакомые трассы. Как на гонке — с попутными и встречными машинами.</td>
                </tr>
              )}
            </Show>
          </tbody>
        </table>
      </div>
      <p className="verdict" id="examVerdict">{() => (results.value.length ? verdict(results.value) : '')}</p>
    </section>
  );
}
