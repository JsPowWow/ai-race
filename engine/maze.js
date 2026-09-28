// Лабиринт: трасса с развилками (одна ветка — тупик), знаками перед ними и перекрёстком.
// Рисуем «черепашкой»: прямо, дуга, развилка, петля. Так ветки развилки выходят точно зеркальными —
// у самой развилки сенсоры видят одно и то же слева и справа, и куда ехать, подскажет только знак.

const STEP = 7;            // шаг точек центральной линии, px
const FORK = { turn: 40, radius: 260, straight: 80 }; // как расходятся ветки: дуга, прямая, дуга обратно
const DEAD_END = 520;      // длина тупика, px: конец не видно сенсорами, пока не заедешь
export const SIGN_GAP = 100; // знак стоит за столько px до развилки: дальше едешь по памяти

/**
 * Программа лабиринта — список команд:
 *   ['line', длина]          прямо
 *   ['arc', градусы, радиус] поворот: плюс — направо, минус — налево
 *   ['fork', 1 | -1]         развилка: основная дорога уходит направо (1) или налево (-1), в другую сторону — тупик
 *   ['loop', 1 | -1]         петля на 270° направо или налево: дальше трасса пересекает саму себя
 * Возвращает то, что нужно buildTrack: точки основной дороги, ветки-тупики и знаки.
 */
export function drawMaze(program, { gap = SIGN_GAP } = {}) {
  let x = 0, y = 0, h = 0, s = 0;
  const points = [{ x, y }];
  const forks = [];
  const walk = (len, turnPerPx) => {
    const n = Math.max(1, Math.ceil(len / STEP)), d = len / n;
    for (let i = 0; i < n; i++) {
      h += (turnPerPx * d) / 2; // половину поворота до шага, половину после — точно по дуге
      x += Math.cos(h) * d; y += Math.sin(h) * d;
      h += (turnPerPx * d) / 2;
      s += d;
      points.push({ x, y });
    }
  };
  const line = (len) => walk(len, 0);
  const arc = (deg, r) => walk((Math.abs(deg) * Math.PI * r) / 180, Math.sign(deg) / r);

  for (const [cmd, a, b] of program) {
    if (cmd === 'line') line(a);
    else if (cmd === 'arc') arc(a, b);
    else if (cmd === 'fork') {
      forks.push({ from: points.length - 1, x, y, h, s, dir: a });
      arc(a * FORK.turn, FORK.radius);
      line(FORK.straight);
      arc(-a * FORK.turn, FORK.radius);
    } else if (cmd === 'loop') arc(a * 270, b ?? 230);
    else throw new Error(`Непонятная команда лабиринта: ${cmd}`);
  }

  const branches = forks.map((f) => ({ points: mirrorAhead(points, f, DEAD_END) }));
  const signs = forks.map((f) => ({ s: f.s - gap, dir: f.dir }));
  return { points, branches, signs };
}

/** Тупик — зеркальная копия основной дороги сразу после развилки: отражаем её относительно направления въезда */
function mirrorAhead(points, fork, length) {
  const ux = Math.cos(fork.h), uy = Math.sin(fork.h);
  const out = [];
  let walked = 0;
  for (let i = fork.from; i < points.length && walked <= length; i++) {
    if (i > fork.from) walked += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const dx = points[i].x - fork.x, dy = points[i].y - fork.y;
    const along = dx * ux + dy * uy, side = -dx * uy + dy * ux;
    out.push({ x: fork.x + along * ux + side * uy, y: fork.y + along * uy - side * ux }); // side → −side
  }
  return out;
}
