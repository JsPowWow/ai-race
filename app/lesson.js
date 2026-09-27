// Карточка урока над вкладкой. Свёрнутость запоминается; на телефоне урок по умолчанию свёрнут.
import { LESSONS } from './lessons.js';
import { load, save } from './storage.js';
import { $ } from './ui.js';

const collapsed = load('lessonCollapsed', {});
const isPhone = () => matchMedia('(max-width: 700px)').matches;

export function renderLesson(tab) {
  const el = $('#lesson');
  const lesson = LESSONS[tab];
  if (!lesson) {
    el.innerHTML = '';
    return;
  }
  const closed = collapsed[tab] ?? isPhone();
  el.innerHTML = `
    <div class="lesson-card${closed ? ' collapsed' : ''}">
      <div class="lesson-big" aria-hidden="true">${lesson.big}</div>
      <div class="lesson-head">
        <span class="lesson-num">${lesson.num}</span>
        <h1 id="lessonTitle">${lesson.title}</h1>
        <button class="lesson-toggle" aria-expanded="${!closed}">${closed ? 'Показать урок' : 'Свернуть'}</button>
      </div>
      <p class="lesson-lead">${lesson.lead}</p>
      <div class="lesson-grid">
        ${lesson.parts.map((part) => `<section><h3>${part.h}</h3>${part.html}</section>`).join('')}
      </div>
    </div>`;
  $('.lesson-toggle', el).addEventListener('click', () => {
    collapsed[tab] = !closed;
    save('lessonCollapsed', collapsed);
    renderLesson(tab);
  });
}
