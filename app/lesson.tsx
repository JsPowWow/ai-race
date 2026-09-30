// Урок над вкладкой — как страница инструкции к набору: крупно один текущий шаг, остальные — кружками.
// Цель — сразу под названием. «Готово» отмечает шаг и открывает следующий. Теория и влияние на гонку — под «Что изучаем».
// Отметки запоминаются в браузере по номерам шагов; сменились шаги (LESSONS_VERSION) — старые отметки забываем.
// Тексты уроков — app/lessons.ts; здесь только вид и отметки. Урок рисуется один раз и дальше обновляется сам.
import { mount, signal } from '@reely/dommy';
import { isPlainObject } from '@reely/basics';
import { LESSONS, LESSONS_VERSION } from './lessons.ts';
import type { LessonTab } from './lessons.ts';
import { stored } from './storage.ts';
import { on } from './state.ts';
import { element } from './dom.ts';
import { Keyed } from '@reely/dommy';
import { TextWithCode } from './components/text-with-code.tsx';

/** Выполненные шаги: { v: 3, teach: [0, 2], … } — версия шагов и номера по вкладкам */
type Done = { v: number } & Partial<Record<LessonTab, number[]>>;

const isLessonTab = (tab: string): tab is LessonTab => Object.hasOwn(LESSONS, tab);

/** Отметки из браузера годятся: та же версия шагов, у вкладок — номера шагов. Нет — начинаем с чистого листа */
const isDone = (saved: unknown): saved is Done =>
  isPlainObject(saved) && saved.v === LESSONS_VERSION &&
  Object.entries(saved).every(([tab, steps]) => tab === 'v' || (isLessonTab(tab) && Array.isArray(steps) && steps.every(Number.isInteger)));

const done = stored<Done>('lessonDone', { v: LESSONS_VERSION }, isDone);
/** Какой шаг открыт на вкладке; если не выбирали — первый невыполненный */
const picked = signal<Partial<Record<LessonTab, number>>>({});
/** Раскрыт ли «Что изучаем и зачем» — помним для каждой вкладки, пока открыта страница */
const moreOpen: Partial<Record<LessonTab, boolean>> = {};
/** Вкладка, над которой сейчас урок (null — на вкладке урока нет) */
const shownTab = signal<LessonTab | null>(null);

const doneSteps = (tab: LessonTab): Set<number> => new Set(done.value[tab]);

function setDone(tab: LessonTab, step: number, isDone: boolean): void {
  const steps = doneSteps(tab);
  if (isDone) steps.add(step);
  else steps.delete(step);
  done.update((now) => ({ ...now, [tab]: [...steps].sort((a, b) => a - b) }));
}

/** Показать шаг step (null — снова «первый невыполненный») */
function pick(tab: LessonTab, step: number | null): void {
  const next = { ...picked.value };
  if (step === null) delete next[tab];
  else next[tab] = step;
  picked.value = next;
}

function stepToShow(tab: LessonTab): number {
  const chosen = picked.value[tab];
  if (chosen !== undefined) return chosen;
  const checked = doneSteps(tab);
  const next = LESSONS[tab].tasks.findIndex((_, i) => !checked.has(i));
  return next === -1 ? LESSONS[tab].tasks.length - 1 : next;
}

/** «Готово»: отметить шаг и показать следующий невыполненный. Ещё раз — снять отметку */
function toggleDone(tab: LessonTab, step: number): void {
  const isDone = doneSteps(tab).has(step);
  setDone(tab, step, !isDone);
  if (!isDone) pick(tab, null);
}

/** Шаг: первое предложение — что сделать (крупно), остальное — пояснение (мельче) */
function splitTask(text: string): { action: string; detail: string } {
  const cut = text.search(/[.!?]\s/);
  if (cut === -1) return { action: text, detail: '' };
  return { action: text.slice(0, cut + 1), detail: text.slice(cut + 1).trim() };
}

/** Текущий шаг крупно. Кнопка «Готово» остаётся той же при смене шага — фокус с клавиатуры не теряется */
function Step({ tab }: { tab: LessonTab }): Node {
  const step = () => stepToShow(tab);
  const task = () => splitTask(LESSONS[tab].tasks[step()]);
  const isDone = () => doneSteps(tab).has(step());
  return (
    <div className={() => (isDone() ? 'lesson-step is-done' : 'lesson-step')}>
      <span className="step-num" aria={{ ariaHidden: 'true' }}>{() => step() + 1}</span>
      <p className="step-text">
        <span className="step-action"><TextWithCode text={() => task().action} /></span>
        {' '}
        <span className="step-detail" hidden={() => !task().detail}><TextWithCode text={() => task().detail} /></span>
      </p>
      <button type="button" className="btn step-done" aria={{ ariaPressed: () => String(isDone()) }}
        onClick={() => toggleDone(tab, step())}>
        {() => (isDone() ? 'Сделано' : 'Готово')}
      </button>
    </div>
  );
}

function LessonCard({ tab }: { tab: LessonTab }): Node {
  const lesson = LESSONS[tab];
  const isDone = (i: number) => doneSteps(tab).has(i);
  return (
    <div className="lesson-card">
      <div className="lesson-head">
        <h1 id="lessonTitle">{lesson.title}</h1>
        <ol className="lesson-dots" aria={{ ariaLabel: 'Шаги урока' }}>
          {lesson.tasks.map((_, i) => (
            <li>
              <button type="button" className={() => (isDone(i) ? 'done' : null)}
                aria={{ ariaLabel: () => `Шаг ${i + 1}${isDone(i) ? ' — сделано' : ''}`, ariaCurrent: () => (i === stepToShow(tab) ? 'step' : null) }}
                onClick={() => pick(tab, i)}>
                {i + 1}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <p className="lesson-goal"><b>Цель:</b> <TextWithCode text={lesson.goal} /></p>
      <Step tab={tab} />
      <details className="lesson-more" open={moreOpen[tab] ?? false} onToggle={(e) => (moreOpen[tab] = e.currentTarget.open)}>
        <summary>Что изучаем и зачем</summary>
        <div className="lesson-more-body">
          <section>
            <h3>Что изучаем</h3>
            <p><span className="tag js">JS</span><TextWithCode text={lesson.learn.js} /></p>
            <p><span className="tag ai">ИИ</span><TextWithCode text={lesson.learn.ai} /></p>
          </section>
          <section>
            <h3>Простыми словами</h3>
            <p><TextWithCode text={lesson.theory} /></p>
          </section>
          <section>
            <h3>Как это влияет на гонку</h3>
            <p><TextWithCode text={lesson.impact} /></p>
          </section>
        </div>
      </details>
    </div>
  );
}

// Сменилась вкладка — урок строится заново; внутри одной вкладки обновляются только шаги и отметки
mount(element('#lesson'), () => <Keyed value={() => shownTab.value}>{(tab) => (tab ? <LessonCard tab={tab} /> : null)}</Keyed>);

/** Показать урок вкладки tab (у вкладки без урока — ничего) */
export function renderLesson(tab: string): void {
  shownTab.value = isLessonTab(tab) ? tab : null;
}

// Шаг отмечается сам, когда ученик сделал то, что в нём сказано (lessons.ts → auto). Снять отметку можно кнопкой.
function did(what: string): void {
  for (const [tab, lesson] of Object.entries(LESSONS)) {
    if (!isLessonTab(tab) || !('auto' in lesson)) continue;
    lesson.auto.forEach((action, step) => {
      if (action !== what || doneSteps(tab).has(step)) return;
      setDone(tab, step, true);
      if (picked.value[tab] === step) pick(tab, null); // смотрел этот шаг — покажем следующий
    });
  }
}
on('did', did);
on('champion', ({ by }: { by: string }) => did(`champion:${by}`));
