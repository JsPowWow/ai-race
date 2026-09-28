// Вид «Огонь в рамках»: один цвет на всё — где идёт сигнал, там разгорается. Рамки подписывают группы.
// Скин только рисует: состояние (теплота, импульсы, зажатые сенсоры) ему даёт board.js.
import { cssColor } from '../../engine/render.js';
import { curve, bezierAt, roundRect, buttonCenter } from './layout.js';
import { fmt, pct } from './formula.js';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SANS = 'Rubik, system-ui, sans-serif';

const rgbOf = (css) => (css.match(/[\d.]+/g) ?? [0, 0, 0]).slice(0, 3).map(Number);
const rgb = ([r, g, b], a = 1) => `rgb(${r} ${g} ${b} / ${a})`;
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const mix = (a, b, t) => a.map((v, n) => Math.round(v + (b[n] - v) * t));

/** Цвета из токенов --bb-* (app/styles/tokens.css) — перечитываем при смене темы */
export function readSkin() {
  const c = (name) => cssColor(name);
  return {
    bg: c('--bb-bg'), edge: c('--bb-edge'), ring: c('--bb-ring'), muted: c('--bb-muted'),
    node: rgbOf(c('--bb-node')), inkDark: c('--bb-ink-dark'), inkLight: c('--bb-ink-light'),
    frame: c('--bb-frame'), title: c('--bb-title'), sub: c('--bb-sub'), press: c('--bb-press'),
    fire: [0, 1, 2, 3, 4].map((n) => rgbOf(c(`--bb-fire-${n}`))),
  };
}

/** Шкала жара: t = 0 — угли, 1 — самый сильный сигнал */
function heatRGB(skin, t) {
  const s = skin.fire, x = Math.max(0, Math.min(1, t)) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(x));
  return mix(s[i], s[i + 1], x - i);
}

/**
 * Нарисовать табло. view — всё, что нужно знать о сети в этот кадр:
 *   lay (раскладка), brain, sigs[k][i][j] (сигнал по связи, −1…1), act(k, i) и text(k, i) (значение и его сглаженная подпись),
 *   heat(key, target) (быстро вспыхивает, медленно гаснет), pulses, pressed (зажатые сенсоры), zoom, labels
 */
export function drawFire(ctx, view, skin) {
  const { lay } = view;
  const boxes = frameBoxes(lay);
  for (const b of boxes) { ctx.lineWidth = 1 / view.zoom; ctx.strokeStyle = skin.frame; ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
  noteLoop(ctx, view, skin, boxes);
  edges(ctx, view, skin);
  pulses(ctx, view, skin);
  frameTitles(ctx, view, skin, boxes); // подписи — поверх нитей, чтобы их не перечёркивало
  inputLabels(ctx, view, skin);
  const n = lay.n, last = lay.sizes.length - 1;
  lay.pos[0].forEach((_, i) => (i > n && i <= 2 * n ? ghostLamp(ctx, view, skin, i) : lamp(ctx, view, skin, 0, i)));
  for (let k = 1; k < last; k++) for (let i = 0; i < lay.sizes[k]; i++) lamp(ctx, view, skin, k, i);
  buttons(ctx, view, skin);
  notePills(ctx, view, skin);
  for (const i of view.pressed) { // зажатый сенсор — жёлтое кольцо «нажато»
    const [x, y] = lay.pos[0][i];
    ctx.beginPath(); ctx.arc(x, y, lay.r + 5, 0, Math.PI * 2);
    ctx.lineWidth = 2.5 / view.zoom; ctx.strokeStyle = skin.press; ctx.stroke();
  }
}

function edges(ctx, { lay, brain, sigs, heat }, skin) {
  brain.layers.forEach((L, k) => {
    const hot = [];
    ctx.lineWidth = 0.6; ctx.strokeStyle = skin.edge;
    L.weights.forEach((row, i) => row.forEach((w, j) => {
      if (w === 0) return; // молчащая связь (например, ещё не нужная заметка) — её просто нет
      const h = heat(`e${k}-${i}-${j}`, Math.abs(sigs[k][i][j]) ** 1.4);
      curve(ctx, lay.pos[k][i], lay.pos[k + 1][j]); ctx.stroke(); // дымка: все связи тонко
      if (h > 0.03) hot.push({ i, j, h });
    }));
    hot.sort((a, b) => a.h - b.h); // самые горячие — сверху
    ctx.lineCap = 'round';
    for (const e of hot) {
      ctx.lineWidth = 0.9 + 3 * e.h; ctx.strokeStyle = rgb(heatRGB(skin, e.h), Math.min(1, 0.25 + e.h));
      curve(ctx, lay.pos[k][e.i], lay.pos[k + 1][e.j]); ctx.stroke();
    }
    ctx.lineCap = 'butt';
  });
}

/** Импульсы бегут по сильным связям; хвост — точки по самой кривой, а не прямая хорда */
function pulses(ctx, { lay, pulses: list }, skin) {
  for (const p of list) {
    const a = lay.pos[p.k]?.[p.i], b = lay.pos[p.k + 1]?.[p.j];
    if (!a || !b) continue;
    ctx.fillStyle = rgb(heatRGB(skin, 0.8 + 0.2 * Math.abs(p.v)));
    for (let n = 0; n < 4; n++) {
      const t = p.t - n * 0.03;
      if (t < 0) break;
      const [x, y] = bezierAt(a, b, t);
      ctx.globalAlpha = Math.min(1, 1.6 - p.t) * (1 - n * 0.24); // у нейрона сигнал «вливается» и гаснет
      ctx.beginPath(); ctx.arc(x, y, 2 * (1 - n * 0.18), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** Лампочка нейрона: заливка по силе сигнала, число внутри, цвет цифр — по яркости заливки */
function lamp(ctx, { lay, act, text, heat }, skin, k, i) {
  const [x, y] = lay.pos[k][i];
  const h = heat(`n${k}-${i}`, Math.min(1, Math.abs(act(k, i))));
  const fill = mix(skin.node, heatRGB(skin, h), h);
  ctx.beginPath(); ctx.arc(x, y, lay.r, 0, Math.PI * 2);
  ctx.fillStyle = rgb(fill); ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = skin.ring; ctx.stroke();
  ctx.fillStyle = lum(fill) > 0.45 ? skin.inkDark : skin.inkLight;
  ctx.font = `600 ${Math.min(12, Math.floor((2 * lay.r - 7) / 2.3))}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(fmt(text(k, i)), x, y + 1);
}

/** «Мгновение назад» — маленький кружок без числа рядом с сенсором: видно, стало ярче или тусклее */
function ghostLamp(ctx, { lay, act, heat, zoom }, skin, i) {
  const [x, y] = lay.pos[0][i];
  const h = heat(`n0-${i}`, Math.min(1, Math.abs(act(0, i))));
  ctx.beginPath(); ctx.arc(x, y, lay.rGhost, 0, Math.PI * 2);
  ctx.fillStyle = rgb(mix(skin.node, heatRGB(skin, h), h)); ctx.fill();
  ctx.setLineDash([2 / zoom, 2 / zoom]); ctx.lineWidth = 1; ctx.strokeStyle = skin.ring; ctx.stroke(); ctx.setLineDash([]);
}

/** Кнопки пульта: ярче — сильнее жмёт; полоска снизу — точная шкала; победитель пары светится */
function buttons(ctx, { lay, act, text, heat, labels }, skin) {
  const last = lay.sizes.length - 1;
  const p = Array.from({ length: lay.buttons }, (_, i) => heat(`o${i}`, act(last, i)));
  const wins = (i) => p[i] - p[i ^ 1] > 0.08; // газ/тормоз, влево/вправо: машина слушает разницу
  const { w, h } = lay.button, two = lay.narrow;
  for (let i = 0; i < lay.buttons; i++) {
    const [cx, cy] = buttonCenter(lay, lay.pos[last][i]);
    const x0 = cx - w / 2, y0 = cy - h / 2, rr = two ? 12 : h / 2;
    const v = Math.max(0, Math.min(1, p[i]));
    const color = heatRGB(skin, 0.35 + 0.65 * v);
    const bg = mix(skin.node, color, v ** 2); // квадрат разводит 70 % и 90 % заметнее
    ctx.save();
    if (wins(i)) { ctx.shadowColor = rgb(heatRGB(skin, 1), 0.6); ctx.shadowBlur = 14; }
    roundRect(ctx, x0, y0, w, h, rr); ctx.fillStyle = rgb(bg); ctx.fill();
    ctx.restore();
    ctx.save(); roundRect(ctx, x0, y0, w, h, rr); ctx.clip();
    ctx.fillStyle = lum(bg) > 0.45 ? 'rgb(0 0 0 / 0.35)' : rgb(color, 0.9);
    ctx.fillRect(x0, y0 + h - 4, w * v, 4);
    ctx.restore();
    roundRect(ctx, x0, y0, w, h, rr); ctx.lineWidth = wins(i) ? 1.5 : 1; ctx.strokeStyle = wins(i) ? rgb(color) : skin.ring; ctx.stroke();
    ctx.fillStyle = lum(bg) > 0.45 ? skin.inkDark : skin.inkLight; ctx.textBaseline = 'middle';
    const value = pct(text(last, i));
    if (two) {
      ctx.textAlign = 'center';
      ctx.font = `600 11.5px ${SANS}`; ctx.fillText(labels.outputs[i], cx, cy - 8);
      ctx.font = `500 11px ${MONO}`; ctx.fillText(value.trim(), cx, cy + 8);
    } else {
      ctx.font = `600 13px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText(labels.outputs[i], x0 + 14, cy);
      ctx.font = `500 12px ${MONO}`; ctx.textAlign = 'right'; ctx.fillText(value, x0 + w - 12, cy);
    }
  }
}

/** Заметки на выходе — маленькие плашки «m1 +.42»: это не кнопки, а то, что мозг запишет себе на следующий шаг */
function notePills(ctx, { lay, act, text, heat, labels }, skin) {
  const last = lay.sizes.length - 1;
  for (let j = 0; j < lay.notes; j++) {
    const i = lay.buttons + j;
    const [x, y] = lay.pos[last][i];
    const h = heat(`o${i}`, act(last, i));
    const bg = mix(skin.node, heatRGB(skin, h), h);
    const w = 60, hh = 22, x0 = x - 6;
    roundRect(ctx, x0, y - hh / 2, w, hh, 6); ctx.fillStyle = rgb(bg); ctx.fill();
    ctx.setLineDash([3, 2]); ctx.lineWidth = 1; ctx.strokeStyle = skin.ring; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = lum(bg) > 0.45 ? skin.inkDark : skin.inkLight; ctx.font = `500 11px ${MONO}`; ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.fillText(labels.outputs[i], x0 + 7, y);
    ctx.textAlign = 'right'; ctx.fillText(fmt(text(last, i)), x0 + w - 7, y);
  }
}

/** Подписи входов: s1…sn слева от пары кружков, v и m1…m3 — слева от своего кружка */
function inputLabels(ctx, { lay, labels }, skin) {
  const n = lay.n;
  ctx.fillStyle = skin.muted; ctx.font = `500 12px ${MONO}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  lay.pos[0].forEach(([x, y], i) => {
    if (i > n && i <= 2 * n) return; // у «мгновения назад» своей подписи нет: это тот же сенсор
    const left = i < n ? x - (lay.r + 8 + lay.rGhost * 2) - 6 : x - lay.r - 8;
    ctx.fillText(labels.inputs[i], left, y);
  });
}

/** Рамки групп: вход (сенсоры сейчас и мгновение назад, скорость), заметки на входе, слой, пульт, заметки на выходе */
function frameBoxes(lay) {
  const n = lay.n, last = lay.sizes.length - 1, pad = lay.r + 7;
  const box = (pts, id, extra = {}) => {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { id, x0: Math.min(...xs) - pad - (extra.left ?? 0), y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad + (extra.right ?? 0), y1: Math.max(...ys) + pad };
  };
  const inPts = lay.pos[0];
  const boxes = [
    box(inPts.slice(0, n + 1), 'input', { left: lay.rGhost * 2 + 2 }),
    box(inPts.slice(2 * n + 1), 'notesIn'),
    ...lay.pos.slice(1, last).map((col, k) => box(col, `hidden${k}`)),
  ];
  const outs = lay.pos[last];
  const bx = outs[0][0];
  const b = box(outs.slice(0, lay.buttons), 'buttons');
  boxes.push({ ...b, x0: bx - 14, x1: bx - 6 + lay.button.w + 8, y0: outs[0][1] - lay.button.h / 2 - 9, y1: outs[lay.buttons - 1][1] + lay.button.h / 2 + 9 });
  const ny = outs.slice(lay.buttons).map((p) => p[1]);
  boxes.push({ id: 'notesOut', x0: bx - 14, x1: bx - 6 + 60 + 8, y0: Math.min(...ny) - 18, y1: Math.max(...ny) + 18 });
  return boxes;
}

function frameTitles(ctx, { lay, zoom, labels }, skin, boxes) {
  ctx.font = `600 ${10.5 * Math.min(1, 1 / Math.sqrt(zoom)) + 0.5}px ${MONO}`; ctx.textBaseline = 'alphabetic';
  for (const b of boxes) {
    const t = labels.frames[b.id.startsWith('hidden') ? 'hidden' : b.id];
    if (!t) continue;
    const [t1, t2] = lay.narrow ? t[1] : t[0];
    const right = b.id === 'buttons' || b.id === 'notesOut';
    const tx = right ? b.x1 : b.x0;
    ctx.textAlign = right ? 'right' : 'left';
    const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2 ?? '').width) + 6;
    const rows = t2 ? 27 : 15;
    ctx.fillStyle = skin.bg; roundRect(ctx, right ? tx - w + 3 : tx - 3, b.y0 - rows - 2, w, rows, 4); ctx.fill(); // подложка
    ctx.fillStyle = skin.title; ctx.fillText(t1, tx, b.y0 - (t2 ? 17 : 5));
    if (t2) { ctx.fillStyle = skin.sub; ctx.fillText(t2, tx, b.y0 - 5); }
  }
}

/** Петля заметок: с выхода обратно на вход — «что записал сейчас, прочитаешь на следующем шаге» */
function noteLoop(ctx, { lay, zoom, labels }, skin, boxes) {
  const from = boxes.find((b) => b.id === 'notesOut'), to = boxes.find((b) => b.id === 'notesIn');
  const y = lay.H - lay.bottom / 2 - 4;
  ctx.strokeStyle = skin.frame; ctx.lineWidth = 1.5 / zoom; ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.beginPath();
  ctx.moveTo((from.x0 + from.x1) / 2, from.y1);
  ctx.lineTo((from.x0 + from.x1) / 2, y); ctx.lineTo((to.x0 + to.x1) / 2, y); ctx.lineTo((to.x0 + to.x1) / 2, to.y1 + 4);
  ctx.stroke(); ctx.setLineDash([]);
  const ax = (to.x0 + to.x1) / 2, ay = to.y1 + 4; // стрелка вверх — к заметкам на входе
  ctx.fillStyle = skin.frame; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - 5, ay + 8); ctx.lineTo(ax + 5, ay + 8); ctx.fill();
  if (labels.loop) {
    ctx.font = `500 11px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tx = (from.x0 + to.x1) / 2, w = ctx.measureText(labels.loop).width + 10;
    ctx.fillStyle = skin.bg; ctx.fillRect(tx - w / 2, y - 8, w, 16);
    ctx.fillStyle = skin.sub; ctx.fillText(labels.loop, tx, y);
  }
}
