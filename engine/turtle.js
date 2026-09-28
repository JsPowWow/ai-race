// Трассы рисует «черепашка»: идёт вперёд, поворачивает по дуге и оставляет за собой след — центральную линию.
// Каждая трасса — кольцо: черепашка возвращается туда, откуда вышла, и дальше едут следующий круг.
// Замкнуть кольцо руками трудно, поэтому две прямые в программе помечены 'fit': их длину черепашка
// подбирает сама — так, чтобы прийти ровно в начало.
//
// Развилка — остров: дорога расходится на два одинаковых пути и снова сходится. У самой развилки
// пути зеркальные: сенсоры видят одно и то же слева и справа. Какой путь свободен, а на каком
// «медленная зона», решают судьи по ходу гонки (см. freeSide в track.js) — подскажет только знак.
import { mulberry32 } from './utils.js';

const STEP = 7; // шаг точек центральной линии, px
const FORK = { turn: 50, radius: 150 }; // как расходятся пути: дуга туда и дуга обратно — вбок на ≈ 107 px
const BEND = (2 * FORK.turn * Math.PI * FORK.radius) / 180; // длина такого изгиба, ≈ 260 px
const ISLAND = 200; // сколько пути идут рядом, px: здесь и лежит медленная зона
export const ISLAND_LENGTH = 2 * BEND + ISLAND;
export const SIGN_GAP = 100; // знак стоит за столько px до развилки: дальше едешь по памяти
/** Где на острове медленная зона: от начала развилки, px. Только там, где пути уже разошлись и между ними трава */
export const ZONE = { from: BEND - 10, to: BEND + ISLAND + 10 };

/** Черепашка: идёт от (x, y) с направлением h и оставляет за собой точки */
function turtle(x, y, h) {
  const t = {
    x, y, h, s: 0, points: [{ x, y }],
    line(len) { walk(len, 0); },
    arc(deg, r) { walk((Math.abs(deg) * Math.PI * r) / 180, Math.sign(deg) / r); }, // плюс — направо
    bend(dir) { t.arc(dir * FORK.turn, FORK.radius); t.arc(-dir * FORK.turn, FORK.radius); },
    island(dir) { t.bend(dir); t.line(ISLAND); t.bend(-dir); }, // в сторону, рядом, обратно
  };
  function walk(len, turnPerPx) {
    const n = Math.max(1, Math.ceil(len / STEP)), d = len / n;
    for (let i = 0; i < n; i++) {
      t.h += (turnPerPx * d) / 2; // половину поворота до шага, половину после — точно по дуге
      t.x += Math.cos(t.h) * d; t.y += Math.sin(t.h) * d;
      t.h += (turnPerPx * d) / 2;
      t.s += d;
      t.points.push({ x: t.x, y: t.y });
    }
  }
  return t;
}

/** Пройти программу. fit — длины прямых 'fit' по порядку */
function walkProgram(program, fit) {
  const road = turtle(0, 0, 0);
  const forks = [], fits = [];
  for (const [cmd, a, b] of program) {
    if (cmd === 'line') road.line(a);
    else if (cmd === 'fit') { fits.push({ h: road.h }); road.line(fit[fits.length - 1]); }
    else if (cmd === 'arc') road.arc(a, b);
    else if (cmd === 'fork') { forks.push({ x: road.x, y: road.y, h: road.h, s: road.s, dir: a }); road.island(a); }
    else throw new Error(`Непонятная команда трассы: ${cmd}`);
  }
  return { road, forks, fits };
}

/**
 * Нарисовать кольцо по программе — списку команд:
 *   ['line', длина]          прямо
 *   ['fit', длина]           прямо, но длину черепашка подгонит, чтобы кольцо замкнулось (нужно хотя бы две)
 *   ['arc', градусы, радиус] поворот: плюс — направо, минус — налево. Всего за круг — 360° (или 0° у восьмёрки)
 *   ['fork', 1 | -1]         развилка-остров: дорога уходит направо (1) или налево (-1), второй путь — зеркально
 * Возвращает то, что нужно buildTrack: точки кольца (последняя совпадает с первой) и второй путь каждого острова
 * (side — куда от развилки уходит само кольцо, forkS — где развилка). Или null, если кольцо не замыкается (подгоняемые прямые вышли бы короче 30 px).
 */
export function drawRing(program) {
  const turn = program.reduce((sum, [cmd, deg]) => sum + (cmd === 'arc' ? deg : 0), 0);
  const extra = ((turn % 360) + 360) % 360;
  if (Math.min(extra, 360 - extra) > 1e-6) throw new Error(`Кольцо должно поворачивать на 360°, а поворачивает на ${turn}°`);
  const base = program.filter(([cmd]) => cmd === 'fit').map(([, len]) => len);
  const first = walkProgram(program, base);
  const fit = closeRing(first.road, first.fits, base);
  if (!fit) return null;
  const { road, forks } = walkProgram(program, fit);
  road.points[road.points.length - 1] = { ...road.points[0] }; // замыкаем точно, без погрешности
  return landscape({
    points: road.points,
    branches: forks.map((f) => ({ points: secondPath(f), side: f.dir, forkS: f.s })),
  });
}

/** Экран шире, чем выше: высокое кольцо кладём набок, чтобы оно заняло экран крупнее */
function landscape(ring) {
  const xs = ring.points.map((p) => p.x), ys = ring.points.map((p) => p.y);
  if (Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys)) return ring;
  const turn = (points) => points.map(({ x, y }) => ({ x: -y, y: x })); // поворот на 90° по часовой: право и лево не меняются
  return { points: turn(ring.points), branches: ring.branches.map((b) => ({ ...b, points: turn(b.points) })) };
}

/**
 * Подобрать длины прямых 'fit', чтобы черепашка пришла в начало.
 * От длины прямой направление дальше не зависит — только положение: удлинили прямую на Δ, конец сдвинулся на Δ вдоль неё.
 * Берём две прямые, которые смотрят в самые разные стороны, и решаем систему из двух уравнений.
 */
function closeRing(road, fits, base) {
  let best = null;
  for (let i = 0; i < fits.length; i++) {
    for (let j = i + 1; j < fits.length; j++) {
      const det = Math.sin(fits[j].h - fits[i].h);
      if (!best || Math.abs(det) > Math.abs(best.det)) best = { i, j, det };
    }
  }
  if (!best || Math.abs(best.det) < 0.3) return null;
  const { i, j, det } = best;
  const ex = -road.x, ey = -road.y; // куда надо сдвинуть конец
  const ui = [Math.cos(fits[i].h), Math.sin(fits[i].h)], uj = [Math.cos(fits[j].h), Math.sin(fits[j].h)];
  const di = (ex * uj[1] - ey * uj[0]) / det; // правило Крамера
  const dj = (ui[0] * ey - ui[1] * ex) / det;
  const fit = base.slice();
  fit[i] += di; fit[j] += dj;
  return fit[i] >= 30 && fit[j] >= 30 ? fit : null;
}

/** Второй путь острова: зеркально дороге уходит в другую сторону и возвращается к ней */
function secondPath(fork) {
  const t = turtle(fork.x, fork.y, fork.h);
  t.island(-fork.dir);
  return t.points;
}

// ── Случайное кольцо ──────────────────────────────────────────
// Генератор ставит несколько вершин вокруг овала и скругляет углы дугами — выходит «скруглённый многоугольник».
// Такое кольцо замыкается само. На самой длинной стороне — развилка, на другой — старт.
// Куда крутится кольцо, сколько у него углов и где какой — решает seed.

const CORNER = [160, 260];   // радиусы поворотов, px
const SIZE = 1300;           // примерный периметр многоугольника до того, как на нём поместится остров, px
const SIGN_STRAIGHT = 200;   // прямая перед развилкой: на ней стоит знак
const AFTER_FORK = 20;       // и чуть-чуть прямо после острова

/** Программа кольца из генератора случайных чисел rng */
function randomProgram(rng) {
  const count = 4 + Math.floor(rng() * 3);
  const way = rng() < 0.5 ? 1 : -1; // по часовой (направо) или против
  const corners = Array.from({ length: count }, (_, k) => {
    const a = (way * 2 * Math.PI * (k + 0.6 * (rng() - 0.5))) / count;
    const r = 0.75 + rng() * 0.5; // вершины — не ровно на овале: так бывают и повороты «назад»
    return { x: 1.5 * r * Math.cos(a), y: r * Math.sin(a), radius: CORNER[0] + rng() * (CORNER[1] - CORNER[0]), turn: 0, cut: 0 };
  });
  // на сколько поворачиваем в каждой вершине и сколько дуга «съедает» от соседних сторон
  const sides = corners.map((c, i) => {
    const next = corners[(i + 1) % count];
    return { len: Math.hypot(next.x - c.x, next.y - c.y), h: Math.atan2(next.y - c.y, next.x - c.x) };
  });
  corners.forEach((c, i) => {
    const before = sides[(i - 1 + count) % count].h, after = sides[i].h;
    c.turn = Math.atan2(Math.sin(after - before), Math.cos(after - before));
    c.cut = c.radius * Math.tan(Math.abs(c.turn) / 2);
  });
  const island = sides.reduce((best, sd, i) => (sd.len > sides[best].len ? i : best), 0);
  const start = sides.reduce((best, sd, i) => (i !== island && (best < 0 || sd.len > sides[best].len) ? i : best), -1);
  const perimeter = sides.reduce((sum, sd) => sum + sd.len, 0);
  const straight = (i) => Math.max(40, (sides[i].len * SIZE) / perimeter - corners[i].cut - corners[(i + 1) % count].cut);
  // черепашка стартует с середины стартовой стороны. Сторона с островом — какой нужно длины,
  // а остальные прямые 'fit' черепашка потом растянет, чтобы кольцо замкнулось
  const program = [];
  for (let k = 0; k < count; k++) {
    const i = (start + k) % count;
    if (k === 0) program.push(['fit', straight(i) / 2]);
    else if (i === island) program.push(['line', SIGN_STRAIGHT + rng() * 150], ['fork', rng() < 0.5 ? -1 : 1], ['line', AFTER_FORK + rng() * 150]);
    else program.push(['fit', straight(i)]);
    const c = corners[(i + 1) % count];
    program.push(['arc', (c.turn * 180) / Math.PI, c.radius]);
  }
  program.push(['fit', straight(start) / 2]);
  return program;
}

/**
 * Не тесно ли: два участка кольца, далёкие по пути, не ближе двух ширин — между ними бордюры и трава.
 * Второй путь острова касается дороги только у своей развилки.
 */
function crowded({ points, branches }, width) {
  const main = withS(points).filter((_, i) => i % 3 === 0);
  const lap = main.at(-1).s;
  const apart = (a, b) => Math.min(Math.abs(a - b), lap - Math.abs(a - b)); // расстояние по кольцу
  const close = (a, b, gap) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < gap * gap;
  const sparse = main.filter((_, i) => i % 3 === 0);
  for (const p of sparse) {
    for (const q of sparse) if (q.s < p.s && apart(p.s, q.s) > 600 && close(p, q, 2.2 * width)) return true;
  }
  for (const { points: path, forkS } of branches) {
    for (const p of path.filter((_, i) => i % 3 === 0)) {
      for (const q of main) if (close(p, q, width + 40) && (q.s < forkS - 260 || q.s > forkS + ISLAND_LENGTH + 260)) return true;
    }
  }
  return false;
}

/** Точки с расстоянием s от начала */
function withS(points) {
  let s = 0;
  return points.map((p, i) => {
    if (i) s += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
    return { ...p, s };
  });
}

/** Случайное кольцо по числу seed: пробуем программы, пока не выйдет просторное */
export function randomRing(seed, width) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const drawn = drawRing(randomProgram(mulberry32(seed + attempt * 7919)));
    if (drawn && !crowded(drawn, width)) return drawn;
  }
  throw new Error('Не удалось сгенерировать трассу');
}
