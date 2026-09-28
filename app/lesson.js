// Урок над вкладкой — как страница инструкции к набору: крупно один текущий шаг, остальные — кружками.
// Цель — сразу под названием. «Готово» отмечает шаг и открывает следующий. Теория и влияние на гонку — под «Что изучаем».
// Отметки запоминаются в браузере по номерам шагов; сменились шаги (LESSONS_VERSION) — старые отметки забываем.
import { LESSONS, LESSONS_VERSION } from './lessons.js';
import { load, save } from './storage.js';
import { on } from './state.js';
import { $, delegate } from './ui.js';

/** @type {Record<string, any>} { v: 2, teach: [0, 2], … } — версия шагов и номера выполненных */
const saved = load('lessonDone', {});
const done = saved.v === LESSONS_VERSION ? saved : { v: LESSONS_VERSION };
const picked = {}; // какой шаг открыт на вкладке; если не выбирали — первый невыполненный
const moreOpen = {}; // раскрыт ли «Зачем этот урок»
let currentTab = null;

const doneSet = (tab) => new Set(done[tab] ?? []);

/** Шаг: первое предложение — что сделать (крупно), остальное — пояснение (мельче) */
function splitTask(text) {
  const cut = text.search(/[.!?]\s/);
  if (cut === -1) return { action: text, detail: '' };
  return { action: text.slice(0, cut + 1), detail: text.slice(cut + 1).trim() };
}

function stepToShow(tab, lesson) {
  if (picked[tab] !== undefined) return picked[tab];
  const checked = doneSet(tab);
  const next = lesson.tasks.findIndex((_, i) => !checked.has(i));
  return next === -1 ? lesson.tasks.length - 1 : next;
}

export function renderLesson(tab) {
  currentTab = tab;
  const el = $('#lesson');
  const lesson = LESSONS[tab];
  if (!lesson) {
    el.innerHTML = '';
    return;
  }
  const checked = doneSet(tab);
  const step = stepToShow(tab, lesson);
  const isDone = checked.has(step);
  const { action, detail } = splitTask(lesson.tasks[step]);
  el.innerHTML = `
    <div class="lesson-card">
      <div class="lesson-head">
        <div class="lesson-title">
          <h1 id="lessonTitle">${lesson.title}</h1>
          <p class="lesson-goal"><b>Цель:</b> ${lesson.goal}</p>
        </div>
        <ol class="lesson-dots" aria-label="Шаги урока">
          ${lesson.tasks.map((_, i) => `
            <li><button type="button" data-step="${i}" class="${checked.has(i) ? 'done' : ''}"
              aria-label="Шаг ${i + 1}${checked.has(i) ? ' — сделано' : ''}"${i === step ? ' aria-current="step"' : ''}>${i + 1}</button></li>`).join('')}
        </ol>
      </div>
      <div class="lesson-step${isDone ? ' is-done' : ''}">
        <span class="step-num" aria-hidden="true">${step + 1}</span>
        <p class="step-text"><span class="step-action">${action}</span>${detail ? ` <span class="step-detail">${detail}</span>` : ''}</p>
        <button type="button" class="btn step-done" data-done="${step}" aria-pressed="${isDone}">${isDone ? 'Сделано' : 'Готово'}</button>
      </div>
      <details class="lesson-more"${moreOpen[tab] ? ' open' : ''}>
        <summary>Что изучаем и зачем</summary>
        <div class="lesson-more-body">
          <section>
            <h3>Что изучаем</h3>
            <p><span class="tag js">JS</span>${lesson.learn.js}</p>
            <p><span class="tag ai">ИИ</span>${lesson.learn.ai}</p>
          </section>
          <section>
            <h3>Простыми словами</h3>
            <p>${lesson.theory}</p>
          </section>
          <section>
            <h3>Как это влияет на гонку</h3>
            <p>${lesson.impact}</p>
          </section>
        </div>
      </details>
    </div>`;
}

delegate('#lesson', 'click', '[data-step]', (button) => {
  picked[currentTab] = Number(button.dataset.step);
  renderLesson(currentTab);
});

delegate('#lesson', 'click', '[data-done]', (button) => {
  const step = Number(button.dataset.done);
  const checked = doneSet(currentTab);
  if (checked.has(step)) {
    checked.delete(step);
  } else {
    checked.add(step);
    delete picked[currentTab]; // сделал — показываем следующий невыполненный шаг
  }
  done[currentTab] = [...checked].sort((a, b) => a - b);
  save('lessonDone', done);
  renderLesson(currentTab);
});

// Шаг отмечается сам, когда ученик сделал то, что в нём сказано (lessons.js → auto). Снять отметку можно кнопкой.
function did(what) {
  let changed = false;
  for (const [tab, lesson] of Object.entries(LESSONS)) {
    lesson.auto?.forEach((a, step) => {
      const checked = doneSet(tab);
      if (a !== what || checked.has(step)) return;
      done[tab] = [...checked.add(step)].sort((x, y) => x - y);
      if (picked[tab] === step) delete picked[tab];
      changed = true;
    });
  }
  if (!changed) return;
  save('lessonDone', done);
  if (currentTab) renderLesson(currentTab);
}
on('did', did);
on('champion', ({ by }) => did(`champion:${by}`));

// toggle у <details> не всплывает — ловим его на пути вниз (capture)
$('#lesson').addEventListener('toggle', (e) => {
  if (e.target.matches('.lesson-more')) moreOpen[currentTab] = e.target.open;
}, true);
