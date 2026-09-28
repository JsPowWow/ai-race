// Лабиринт: трасса с развилками, знаками перед ними и перекрёстком.
// У каждой развилки неверная ветка — петля: она уводит в сторону и возвращает на дорогу перед знаком.
// Свернул не туда — не авария, а круг почёта и вторая попытка: ошибка стоит времени.
// Рисуем «черепашкой»: прямо, дуга, развилка, петля. Начало веток развилки точно зеркальное —
// у самой развилки сенсоры видят одно и то же слева и справа, и куда ехать, подскажет только знак.

const STEP = 7;            // шаг точек центральной линии, px
const FORK = { turn: 40, radius: 260, straight: 80 }; // как расходятся ветки: дуга, прямая, дуга обратно
const DETOUR = { out: 60, radius: 170 };             // петля: чуть прямо, потом разворот наружу
export const SIGN_GAP = 100;      // знак стоит за столько px до развилки: дальше едешь по памяти
export const DETOUR_BACK = 280;   // петля возвращается на дорогу за столько px до развилки — раньше, чем виден знак

/** Черепашка: идёт от (x, y) с направлением h и оставляет за собой точки */
function turtle(x, y, h) {
  const t = {
    x, y, h, s: 0, points: [{ x, y }],
    line(len) { walk(len, 0); },
    arc(deg, r) { walk((Math.abs(deg) * Math.PI * r) / 180, Math.sign(deg) / r); }, // плюс — направо
    fork(dir) { t.arc(dir * FORK.turn, FORK.radius); t.line(FORK.straight); t.arc(-dir * FORK.turn, FORK.radius); },
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

/**
 * Программа лабиринта — список команд:
 *   ['line', длина]          прямо
 *   ['arc', градусы, радиус] поворот: плюс — направо, минус — налево
 *   ['fork', 1 | -1]         развилка: дорога уходит направо (1) или налево (-1), в другую сторону — петля.
 *                            Перед развилкой нужна прямая длиннее DETOUR_BACK: на неё петля и вернётся
 *   ['loop', 1 | -1]         петля на 270° направо или налево: дальше трасса пересекает саму себя
 * Возвращает то, что нужно buildTrack: точки основной дороги, ветки-петли и знаки.
 */
export function drawMaze(program, { gap = SIGN_GAP } = {}) {
  const road = turtle(0, 0, 0);
  const forks = [];
  for (const [cmd, a, b] of program) {
    if (cmd === 'line') road.line(a);
    else if (cmd === 'arc') road.arc(a, b);
    else if (cmd === 'fork') {
      forks.push({ x: road.x, y: road.y, h: road.h, s: road.s, dir: a });
      road.fork(a);
    } else if (cmd === 'loop') road.arc(a * 270, b ?? 230);
    else throw new Error(`Непонятная команда лабиринта: ${cmd}`);
  }
  return {
    points: road.points,
    branches: forks.map((f) => ({ points: detour(f), rejoin: true })),
    signs: forks.map((f) => ({ s: f.s - gap, dir: f.dir })),
  };
}

/**
 * Петля у развилки: зеркально дороге уходит в другую сторону, разворачивается наружу,
 * едет назад и вторым разворотом выходит на дорогу за DETOUR_BACK px до развилки — снова по ходу движения.
 */
function detour(fork) {
  const t = turtle(fork.x, fork.y, fork.h);
  const side = -fork.dir; // петля уходит туда, куда дорога не пошла
  t.fork(side);
  t.line(DETOUR.out);
  t.arc(side * 180, DETOUR.radius);
  // где черепашка сейчас относительно развилки: вдоль дороги и вбок от неё
  const ux = Math.cos(fork.h), uy = Math.sin(fork.h);
  const along = (t.x - fork.x) * ux + (t.y - fork.y) * uy;
  const aside = Math.abs(-(t.x - fork.x) * uy + (t.y - fork.y) * ux);
  t.line(along + DETOUR_BACK);
  t.arc(side * 180, aside / 2); // разворот ровно на ширину петли — выходим на центр дороги
  return t.points;
}
