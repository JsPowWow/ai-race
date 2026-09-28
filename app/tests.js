// Проверки кода студентов. advice: true — это совет (жёлтый), а не ошибка (красный).
import { createBrain, cloneBrain, brainSizes } from '../engine/brain.js';
import { errorLine } from './student-code.js';

class Fail extends Error {}
const expect = (cond, msg) => { if (!cond) throw new Fail(msg); };
const blank = () => ({ gas: 0, brake: 0, left: 0, right: 0 });
const report = (o) => ({ progress: 3000, trackLength: 9000, progressPct: 33.3, finished: false, crashed: true, hitCar: false, stalled: false, ticks: 1500, avgSpeed: 2, topSpeed: 4, wiggle: 20, ...o });
const flat = (b) => b.layers.flatMap((l) => [...l.biases, ...l.weights.flat()]);

const TESTS = {
  controls: [
    { name: '↑ — газ: нажали 1, отпустили 0', run(m) {
      const c = blank(); m.handleKey('ArrowUp', true, c); expect(c.gas === 1, `после нажатия gas = ${c.gas}`);
      m.handleKey('ArrowUp', false, c); expect(c.gas === 0, `после отпускания gas = ${c.gas}`);
    } },
    { name: '↓ — тормоз', run(m) { const c = blank(); m.handleKey('ArrowDown', true, c); expect(c.brake === 1, `brake = ${c.brake}`); } },
    { name: '← и → — руль', run(m) {
      const c = blank(); m.handleKey('ArrowLeft', true, c); m.handleKey('ArrowRight', true, c);
      expect(c.left === 1 && c.right === 1, `left = ${c.left}, right = ${c.right}`);
    } },
    { name: 'Чужая клавиша ничего не меняет', run(m) {
      const c = blank(); m.handleKey('q', true, c); expect(JSON.stringify(c) === JSON.stringify(blank()), 'поменялось управление');
    } },
    { name: 'WASD тоже работают', advice: true, run(m) {
      const c = blank(); m.handleKey('w', true, c); m.handleKey('a', true, c);
      expect(c.gas === 1 && c.left === 1, 'W и A не сработали');
      const d = blank(); m.handleKey('W', true, d); expect(d.gas === 1, 'с Caps Lock (W) не работает');
    } },
    { name: 'Пробел — ручник', advice: true, run(m) {
      const c = blank(); m.handleKey('ArrowUp', true, c); m.handleKey(' ', true, c);
      expect(c.gas === 0 && c.brake === 1, `gas = ${c.gas}, brake = ${c.brake}`);
    } },
  ],

  think: [
    { name: 'Каждый вариант отвечает числом на каждый выход, от 0 до 1', run(m) {
      const brain = createBrain([6, 6, 4], seeded(1));
      for (const [id, v] of Object.entries(m.thinkVariants)) {
        for (let k = 0; k < 20; k++) {
          const out = v.think(randInputs(k), brain);
          expect(Array.isArray(out) && out.length === 4, `${id}: ответ не из 4 чисел (у этой проверочной сети 4 выхода)`);
          expect(out.every((x) => Number.isFinite(x) && x >= 0 && x <= 1), `${id}: число вне 0..1 (${out.map((x) => +x.toFixed?.(2)).join(', ')})`);
        }
      }
    } },
    { name: 'Одинаковый вход — одинаковый ответ', run(m) {
      const brain = createBrain([6, 8, 4], seeded(2));
      for (const [id, v] of Object.entries(m.thinkVariants)) {
        const a = JSON.stringify(v.think(randInputs(3), brain)), b = JSON.stringify(v.think(randInputs(3), brain));
        expect(a === b, `${id}: ответы разные — гонка будет нечестной`);
      }
    } },
    { name: 'Не меняет мозг', run(m) {
      const brain = createBrain([6, 6, 4], seeded(3)); const before = JSON.stringify(brain);
      for (const v of Object.values(m.thinkVariants)) v.think(randInputs(1), brain);
      expect(JSON.stringify(brain) === before, 'think() поменял веса');
    } },
    { name: 'Быстрый: 1000 решений меньше чем за 50 мс', run(m) {
      const brain = createBrain([16, 16, 16, 16, 4], seeded(4));
      for (const [id, v] of Object.entries(m.thinkVariants)) {
        const t0 = performance.now();
        for (let k = 0; k < 1000; k++) v.think(randInputs(k, 16), brain);
        const dt = performance.now() - t0;
        expect(dt < 50, `${id}: ${dt.toFixed(0)} мс`);
      }
    } },
    { name: '«Мой вариант» отличается от «Ступеньки»', advice: true, run(m) {
      const brain = createBrain([6, 6, 4], seeded(5));
      let same = true;
      for (let k = 0; k < 30 && same; k++) {
        same = JSON.stringify(m.thinkVariants.mine.think(randInputs(k), brain)) === JSON.stringify(m.thinkVariants.step.think(randInputs(k), brain));
      }
      expect(!same, 'пока это копия «Ступеньки» — придумай своё');
    } },
  ],

  mutate: [
    { name: 'rate = 0 — мозг не меняется', run(m) {
      const b = createBrain([6, 6, 4], seeded(6)); const before = JSON.stringify(b);
      m.mutate(b, 0); expect(JSON.stringify(b) === before, 'при rate = 0 числа поменялись');
    } },
    { name: 'rate = 0.5 — что-то меняется', run(m) {
      const b = createBrain([6, 6, 4], seeded(7)); const before = JSON.stringify(b);
      m.mutate(b, 0.5); expect(JSON.stringify(b) !== before, 'ничего не поменялось');
    } },
    { name: 'Форма мозга та же, все числа — числа', run(m) {
      const b = createBrain([6, 8, 5, 4], seeded(8)); m.mutate(b, 0.3);
      expect(JSON.stringify(brainSizes(b)) === JSON.stringify([6, 8, 5, 4]), `размеры стали ${brainSizes(b).join('-')}`);
      expect(flat(b).every(Number.isFinite), 'появились NaN или Infinity');
    } },
    { name: 'Малый rate — малые изменения', advice: true, run(m) {
      const a = createBrain([6, 6, 4], seeded(9)); const b = cloneBrain(a); m.mutate(b, 0.05);
      const d = Math.max(...flat(a).map((x, i) => Math.abs(x - flat(b)[i])));
      expect(d <= 0.3, `при rate 0.05 число сдвинулось на ${d.toFixed(2)}`);
    } },
    { name: 'Точечные мутации: меняется не всё', advice: true, run(m) {
      const a = createBrain([6, 6, 4], seeded(10)); const b = cloneBrain(a); m.mutate(b, 0.1);
      const fa = flat(a), fb = flat(b); const changed = fa.filter((x, i) => x !== fb[i]).length;
      expect(changed < fa.length * 0.6, `поменялось ${changed} из ${fa.length} чисел`);
    } },
  ],

  fitness: [
    { name: 'Возвращает число', run(m) { const v = m.fitness(report()); expect(Number.isFinite(v), `вернула ${v}`); } },
    { name: 'Дальше — лучше', run(m) {
      expect(m.fitness(report({ progress: 6000, progressPct: 66.7 })) > m.fitness(report({ progress: 3000 })), 'проехавшая 6000 px не лучше проехавшей 3000 px');
    } },
    { name: 'Финиш лучше, чем авария перед финишем', run(m) {
      const fin = report({ progress: 9000, progressPct: 100, finished: true, crashed: false, ticks: 3000 });
      const crash = report({ progress: 8990, progressPct: 99.9, ticks: 2990 });
      expect(m.fitness(fin) > m.fitness(crash), 'авария у финиша оценена не хуже финиша');
    } },
    { name: 'Быстрее — лучше', advice: true, run(m) {
      const fast = report({ progress: 9000, progressPct: 100, finished: true, crashed: false, ticks: 2700 });
      const slow = report({ progress: 9000, progressPct: 100, finished: true, crashed: false, ticks: 4000 });
      expect(m.fitness(fast) > m.fitness(slow), 'быстрая и медленная машины оценены одинаково — на гонке это проигрыш');
    } },
    { name: 'Не хвалит за вилянье', advice: true, run(m) {
      const calm = report({ wiggle: 10 }), wild = report({ wiggle: 400 });
      expect(m.fitness(calm) > m.fitness(wild), 'виляющая машина оценена не хуже спокойной');
    } },
  ],
  crossover: [
    { name: 'Ребёнок той же формы', run(m) {
      const a = createBrain([6, 8, 5, 4], seeded(11)), b = createBrain([6, 8, 5, 4], seeded(12));
      const c = m.crossover(a, b);
      expect(c && Array.isArray(c.layers), 'вернула не мозг (нет layers)');
      expect(JSON.stringify(brainSizes(c)) === '[6,8,5,4]', `размеры стали ${brainSizes(c).join('-')}`);
      expect(flat(c).every(Number.isFinite), 'появились NaN или Infinity');
    } },
    { name: 'Родители не меняются', run(m) {
      const a = createBrain([6, 6, 4], seeded(13)), b = createBrain([6, 6, 4], seeded(14));
      const sa = JSON.stringify(a), sb = JSON.stringify(b);
      const c = m.crossover(a, b);
      expect(JSON.stringify(a) === sa && JSON.stringify(b) === sb, 'мама или папа поменялись');
      c.layers[0].weights[0][0] = 99; c.layers[0].biases[0] = 99;
      expect(a.layers[0].weights[0][0] !== 99 && a.layers[0].biases[0] !== 99 && b.layers[0].weights[0][0] !== 99, 'ребёнок делит массивы с родителем — нужна копия');
    } },
    { name: 'Мозг × он же = он же', run(m) {
      const a = createBrain([6, 6, 4], seeded(15));
      const c = m.crossover(a, cloneBrain(a));
      const fa = flat(a), fc = flat(c);
      expect(fa.every((x, i) => Math.abs(x - fc[i]) < 1e-9), 'от двух одинаковых родителей получился другой мозг');
    } },
    { name: 'Берёт от обоих родителей', advice: true, run(m) {
      const a = createBrain([6, 6, 4], seeded(16)), b = createBrain([6, 6, 4], seeded(17));
      const c = flat(m.crossover(a, b)), fa = flat(a), fb = flat(b);
      expect(c.some((x, i) => x !== fa[i]) && c.some((x, i) => x !== fb[i]), 'ребёнок — копия одного из родителей');
    } },
    { name: 'Целыми нейронами', advice: true, run(m) {
      const a = createBrain([6, 6, 4], seeded(18)), b = createBrain([6, 6, 4], seeded(19));
      const c = m.crossover(a, b);
      c.layers.forEach((l, k) => l.biases.forEach((bias, j) => {
        const col = [bias, ...l.weights.map((r) => r[j])];
        const fromA = [a.layers[k].biases[j], ...a.layers[k].weights.map((r) => r[j])];
        const fromB = [b.layers[k].biases[j], ...b.layers[k].weights.map((r) => r[j])];
        const same = (x, y) => x.every((v, i) => v === y[i]);
        expect(same(col, fromA) || same(col, fromB), `нейрон ${j + 1} слоя ${k + 1} собран из кусков двух родителей`);
      }));
    } },
  ],
};

export function runTests(id, mod) {
  return (TESTS[id] || []).map((t) => {
    try {
      t.run(mod);
      return { name: t.name, status: 'pass' };
    } catch (e) {
      const line = e instanceof Fail ? null : errorLine(e);
      const msg = e instanceof Fail ? e.message : `ошибка${line ? ` в строке ${line}` : ''}: ${e.message}`;
      return { name: t.name, status: t.advice && e instanceof Fail ? 'advice' : 'fail', msg };
    }
  });
}

function seeded(s) {
  let a = s * 9973;
  return () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
}
function randInputs(k, n = 6) {
  return Array.from({ length: n }, (_, i) => ((Math.sin(k * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1);
}
