// Вид «Огонь в рамках»: один цвет на всё — где идёт сигнал, там разгорается. Рамки подписывают слои.
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
  frames(ctx, view, skin, 'box');
  edges(ctx, view, skin);
  pulses(ctx, view, skin);
  frames(ctx, view, skin, 'text'); // подписи — поверх нитей, чтобы их не перечёркивало
  inputLabels(ctx, view, skin);
  for (let k = 0; k < lay.sizes.length - 1; k++) for (let i = 0; i < lay.sizes[k]; i++) lamp(ctx, view, skin, k, i);
  buttons(ctx, view, skin);
  for (const i of view.pressed) { // зажатый сенсор — жёлтое кольцо «нажато»
    const [x, y] = lay.pos[0][i];
    ctx.beginPath(); ctx.arc(x, y, lay.r + 5, 0, Math.PI * 2);
    ctx.lineWidth = 2.5 / view.zoom; ctx.strokeStyle = skin.press; ctx.stroke();
  }
}

function edges(ctx, { lay, brain, sigs, heat }, skin) {
  brain.layers.forEach((L, k) => {
    const hot = [];
    ctx.lineWidth = 0.7; ctx.strokeStyle = skin.edge;
    L.weights.forEach((row, i) => row.forEach((_, j) => {
      const h = heat(`e${k}-${i}-${j}`, Math.abs(sigs[k][i][j]) ** 1.4);
      curve(ctx, lay.pos[k][i], lay.pos[k + 1][j], lay.vertical); ctx.stroke(); // дымка: все связи тонко
      if (h > 0.03) hot.push({ i, j, h });
    }));
    hot.sort((a, b) => a.h - b.h); // самые горячие — сверху
    ctx.lineCap = 'round';
    for (const e of hot) {
      ctx.lineWidth = 0.9 + 3.2 * e.h; ctx.strokeStyle = rgb(heatRGB(skin, e.h), Math.min(1, 0.25 + e.h));
      curve(ctx, lay.pos[k][e.i], lay.pos[k + 1][e.j], lay.vertical); ctx.stroke();
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
      const [x, y] = bezierAt(a, b, t, lay.vertical);
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
  ctx.font = `600 ${Math.min(12, Math.floor((2 * lay.r - 8) / 2.3))}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(fmt(text(k, i)), x, y + 1);
}

/** Кнопки пульта: ярче — сильнее жмёт; полоска снизу — точная шкала; победитель пары светится */
function buttons(ctx, { lay, act, text, heat, labels }, skin) {
  const last = lay.sizes.length - 1;
  const p = lay.pos[last].map((_, i) => heat(`o${i}`, act(last, i)));
  const wins = (i) => p[i] - p[i ^ 1] > 0.08; // газ/тормоз, влево/вправо: машина слушает разницу
  const { w, h } = lay.button, two = lay.vertical || lay.narrow;
  lay.pos[last].forEach((pt, i) => {
    const [cx, cy] = buttonCenter(lay, pt);
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
  });
}

/** Подписи входов: s1…s7 и v — коротко, чтобы влезало и на телефоне */
function inputLabels(ctx, { lay, labels }, skin) {
  ctx.fillStyle = skin.muted; ctx.font = `500 12px ${MONO}`; ctx.textBaseline = 'middle';
  lay.pos[0].forEach(([x, y], i) => {
    if (lay.vertical) { ctx.textAlign = 'center'; ctx.fillText(labels.inputs[i], x, y - lay.r - 14); }
    else { ctx.textAlign = 'right'; ctx.fillText(labels.inputs[i], x - lay.r - 8, y); }
  });
}

/** Рамки слоёв, как у лабораторного стенда: что за слой, сколько нейронов, какая функция */
function frames(ctx, { lay, zoom, labels }, skin, part) {
  const last = lay.sizes.length - 1;
  const padA = lay.r + 8, padB = lay.r + (lay.vertical ? 24 : 8); // поперёк слоя и вдоль
  const [px, py] = lay.vertical ? [padA, padB] : [padB, padA];
  lay.pos.forEach((col, k) => {
    const xs = col.map((q) => q[0]), ys = col.map((q) => q[1]);
    let x0 = Math.min(...xs) - px, y0 = Math.min(...ys) - py, x1 = Math.max(...xs) + px, y1 = Math.max(...ys) + py;
    if (k === last) { // рамка выходов обнимает кнопки пульта
      if (lay.vertical) { x0 = 6; x1 = lay.W - 6; y0 = Math.min(...ys) - 8; y1 = Math.max(...ys) + 52; }
      else { x0 = Math.min(...xs) - 14; x1 = Math.min(...xs) - 6 + lay.button.w + 8; y0 = Math.min(...ys) - 28; y1 = Math.max(...ys) + 28; }
    }
    if (part === 'box') {
      ctx.lineWidth = 1 / zoom; ctx.strokeStyle = skin.frame; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      return;
    }
    const [t1, t2] = labels.layers[Math.min(k, 2)][lay.narrow ? 1 : 0];
    const right = !lay.vertical && k === last;
    const tx = right ? x1 : x0;
    ctx.font = `600 ${10.5 * Math.min(1, 1 / Math.sqrt(zoom)) + 0.5}px ${MONO}`; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = right ? 'right' : 'left';
    const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 6;
    ctx.fillStyle = skin.bg; roundRect(ctx, right ? tx - w + 3 : tx - 3, y0 - 29, w, 27, 4); ctx.fill(); // подложка
    ctx.fillStyle = skin.title; ctx.fillText(t1, tx, y0 - 17);
    ctx.fillStyle = skin.sub; ctx.fillText(t2, tx, y0 - 5);
  });
}
