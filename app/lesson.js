// Карточка урока над вкладкой: цель, задание с галочками, что изучаем, теория и влияние на гонку.
// Свёрнутость и галочки запоминаются в браузере; на телефоне урок по умолчанию свёрнут.
import { LESSONS } from './lessons.js';
import { load, save } from './storage.js';
import { $, delegate } from './ui.js';

const collapsed = load('lessonCollapsed', {});
const done = load('lessonDone', {}); // { garage: [0, 2], … } — номера выполненных шагов
const isPhone = () => matchMedia('(max-width: 700px)').matches;
let currentTab = null;

export function renderLesson(tab) {
  currentTab = tab;
  const el = $('#lesson');
  const lesson = LESSONS[tab];
  if (!lesson) {
    el.innerHTML = '';
    return;
  }
  const closed = collapsed[tab] ?? isPhone();
  const checked = new Set(done[tab] ?? []);
  el.innerHTML = `
    <div class="lesson-card${closed ? ' collapsed' : ''}">
      <div class="lesson-big" aria-hidden="true">${lesson.big}</div>
      <div class="lesson-head">
        <span class="lesson-num">${lesson.num}</span>
        <h1 id="lessonTitle">${lesson.title}</h1>
        <span class="lesson-progress">${checked.size}/${lesson.tasks.length}</span>
        <button class="lesson-toggle" data-toggle aria-expanded="${!closed}">${closed ? 'Показать урок' : 'Свернуть'}</button>
      </div>
      <p class="lesson-goal"><b>Цель</b>${lesson.goal}</p>
      <div class="lesson-grid">
        <section class="lesson-tasks">
          <h3>Задание</h3>
          <ol>
            ${lesson.tasks.map((task, i) => `
              <li><label><input type="checkbox" data-task="${i}" ${checked.has(i) ? 'checked' : ''}><span>${task}</span></label></li>`).join('')}
          </ol>
        </section>
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
          <h3>Как это влияет</h3>
          <p>${lesson.impact}</p>
        </section>
      </div>
    </div>`;
}

delegate('#lesson', 'click', '[data-toggle]', (button) => {
  collapsed[currentTab] = button.getAttribute('aria-expanded') === 'true';
  save('lessonCollapsed', collapsed);
  renderLesson(currentTab);
});

delegate('#lesson', 'change', '[data-task]', () => {
  done[currentTab] = [...document.querySelectorAll('#lesson [data-task]:checked')].map((box) => +box.dataset.task);
  save('lessonDone', done);
  $('.lesson-progress').textContent = `${done[currentTab].length}/${LESSONS[currentTab].tasks.length}`;
});
