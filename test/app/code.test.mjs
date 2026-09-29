// Вкладка «Код» и уроки без браузера: проверки кода студентов, отступы в редакторе, тексты уроков.
// Нужны app/generated/* (npm run build или npm run dev): проверки берут номер строки ошибки у app/student-code.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTests } from '../../app/tests.ts';
import { indentEdit } from '../../app/indent.ts';
import { LESSONS } from '../../app/lessons.ts';
import * as controls from '../../student/controls.js';
import * as think from '../../student/think.js';
import * as mutate from '../../student/mutate.js';
import * as fitness from '../../student/fitness.js';
import * as crossover from '../../student/crossover.js';

const STUDENT = { controls, think, mutate, fitness, crossover };

test('исходные файлы student/ проходят все обязательные проверки (советы — можно)', () => {
  for (const [id, mod] of Object.entries(STUDENT)) {
    const results = runTests(id, mod);
    assert.ok(results.length > 0, `${id}: нет проверок`);
    const failed = results.filter((r) => r.status === 'fail');
    assert.deepEqual(failed, [], `${id}: исходный файл не проходит проверку`);
  }
});

test('проверки не падают на сломанном коде: объясняют, что не так', () => {
  const [first] = runTests('fitness', {}); // файл без export fitness
  assert.equal(first.status, 'fail');
  assert.match(first.msg, /^ошибка( в строке \d+)?: /);
  const [thrown] = runTests('fitness', { fitness() { throw 'упс'; } }); // бросили не Error
  assert.equal(thrown.msg, 'ошибка: упс');
  const advice = runTests('fitness', { fitness: (car) => car.progress }).find((r) => r.name === 'Быстрее — лучше');
  assert.equal(advice.status, 'advice', 'совет — жёлтый, а не красный');
  assert.deepEqual(runTests('нет-такого', {}), []);
});

test('Tab в редакторе: без выделения — два пробела', () => {
  assert.deepEqual(indentEdit('ab', 1, 1, false), { start: 1, end: 1, text: '  ', selStart: 3, selEnd: 3 });
});

test('Tab на выделении сдвигает строки, а не стирает их', () => {
  const one = indentEdit('a\nbc\nd', 3, 4, false); // выделена «c»
  assert.deepEqual(one, { start: 2, end: 4, text: '  bc', selStart: 5, selEnd: 6 });
  const value = 'if (a) {\nb();\nc();\n}';
  const from = value.indexOf('b'), to = value.indexOf('c') + 3; // выделено «b();⏎c()»
  const edit = indentEdit(value, from, to, false);
  const next = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  assert.equal(next, 'if (a) {\n  b();\n  c();\n}');
  assert.equal(next.slice(edit.selStart, edit.selEnd), '  b();\n  c()', 'выделение осталось на тех же строках');
});

test('Shift+Tab убирает отступ; нечего убирать — ничего не меняет', () => {
  const value = '  a\n b\nc';
  const edit = indentEdit(value, 0, value.length, true);
  assert.equal(value.slice(0, edit.start) + edit.text + value.slice(edit.end), 'a\nb\nc');
  assert.equal(indentEdit('abc', 1, 1, true), null);
});

test('тексты уроков: у каждого кода пара обратных кавычек, HTML не пишем', () => {
  for (const [tab, lesson] of Object.entries(LESSONS)) {
    const texts = [lesson.goal, ...lesson.tasks, lesson.learn.js, lesson.learn.ai, lesson.theory, lesson.impact];
    for (const text of texts) {
      assert.equal((text.match(/`/g) ?? []).length % 2, 0, `${tab}: непарная кавычка в «${text.slice(0, 40)}…»`);
      assert.doesNotMatch(text, /<\/?[a-z]+>/, `${tab}: HTML в тексте урока — его покажут как текст`);
    }
    if (lesson.auto) assert.ok(lesson.auto.length <= lesson.tasks.length, `${tab}: auto для шага, которого нет`);
  }
});
