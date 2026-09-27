// ПРОТОТИП «Табло мозга» — выбросить после выбора (ветка prototype/brain-display, не main).
// Вопрос: как показать маленькую сеть, чтобы было понятно и красиво. Все варианты — на одной странице,
// каждый вживую на одном и том же боте. Общее для всех: плавные связи, импульсы по сигналу,
// числа в узлах (без дребезга), выходы — кнопки пульта, формула нейрона при наведении,
// на узком экране — сверху вниз.
import { Car, maxTicksFor } from '../../engine/car.js';
import { getTrainingTrack } from '../../engine/track.js';
import { Camera, drawTrack, drawCar, drawSensors, readPalette } from '../../engine/render.js';
import { parseCarFile } from '../../engine/car-file.js';
import { feedForward, thinkVariants } from '../../student/think.js';
import BOTS from '../../tools/bots.json';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const OUT = ['Газ', 'Тормоз', 'Влево', 'Вправо'];
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SANS = 'Rubik, system-ui, sans-serif';

// ── машина едет, сеть думает ──
const track = getTrainingTrack('warmup');
let bot, driver, car, trace = null;
let paused = false;
function loadBot(name) {
  bot = BOTS.find((b) => b.name === name);
  const f = parseCarFile(bot);
  driver = { brain: f.brain, think: thinkVariants[f.thinkId].think, sensors: f.sensors };
  car = new Car(track, driver);
  pulses.length = 0;
  heat.clear();
  shown = null;
}
function step() {
  if (paused) return;
  if (car.done) car = new Car(track, driver);
  car.step(track, maxTicksFor(track));
  trace = feedForward.lastTrace;
}
const brain = () => driver.brain;

// ── числа без дребезга: знак и две цифры, сглаживание, текст 10 раз в секунду ──
const fmt = (v) => (v < 0 ? '−' : '+') + Math.min(0.99, Math.abs(v)).toFixed(2).replace(/^0/, '');
// веса бывают больше 1 — для них целая цифра видна всегда: «+1.73», «−0.40»
const fmtW = (v) => (v < 0 ? '−' : '+') + Math.min(9.99, Math.abs(v)).toFixed(2);
const round2 = (v) => Math.round(v * 100) / 100;
const pct = (v) => `${String(Math.round(Math.max(0, Math.min(1, v)) * 100)).padStart(3, ' ')}%`;
let shown = null, textTrace = null, lastText = 0;
function smooth(t, dt) {
  if (!trace) return;
  if (!shown || shown.length !== trace.length) shown = trace.map((l) => [...l]);
  const a = 1 - Math.exp(-dt / 0.12);
  trace.forEach((l, k) => l.forEach((v, i) => { shown[k][i] += (v - shown[k][i]) * a; }));
  if (!textTrace || t - lastText > 100) { textTrace = shown.map((l) => [...l]); lastText = t; }
}
const textOf = (k, i) => textTrace?.[k]?.[i] ?? 0;
const actOf = (k, i) => trace?.[k]?.[i] ?? 0;

// ── сигнал по связи: вход × вес, нормированный на самый сильный в слое ──
function signals(k) {
  const L = brain().layers[k];
  const a = trace?.[k] ?? L.weights.map(() => 0);
  let max = 1e-6;
  const s = L.weights.map((row, i) => row.map((w) => { const v = a[i] * w; max = Math.max(max, Math.abs(v)); return v; }));
  return s.map((row) => row.map((v) => v / max));
}
let sigs = [];
let frameDt = 0.016;

// ── импульсы: общие для всех вариантов, рисует каждый по-своему ──
const pulses = [];
function spawnPulses() {
  if (reduceMotion || paused) return;
  sigs.forEach((sig, k) => sig.forEach((row, i) => row.forEach((v, j) => {
    if (Math.abs(v) > 0.5 && Math.random() < Math.abs(v) * 0.012 && pulses.length < 90) pulses.push({ k, i, j, t: 0, v });
  })));
}
function advancePulses(dt) {
  for (const p of pulses) p.t += dt * 1.5;
  for (let n = pulses.length - 1; n >= 0; n--) if (pulses[n].t >= 1) pulses.splice(n, 1);
}

// ── «теплота»: вспыхивает быстро, гаснет медленно ──
const ATTACK = 0.04, DECAY = 0.5; // секунды
const heat = new Map();
function warm(key, target) {
  const h = heat.get(key) ?? 0;
  const v = h + (target - h) * (1 - Math.exp(-frameDt / (target > h ? ATTACK : DECAY)));
  heat.set(key, v);
  return v;
}

// ── геометрия: раскладка слоёв и плавные кривые ──
function layout(W, H, vertical) {
  const sizes = [brain().layers[0].weights.length, ...brain().layers.map((l) => l.biases.length)];
  const along = vertical ? H : W, across = vertical ? W : H;
  const start = vertical ? 64 : 120, end = vertical ? 58 : 170; // место под подписи входов и кнопки выходов
  const maxN = Math.max(...sizes);
  const gap = Math.min(52, (across - 28) / maxN);
  const r = Math.max(10, Math.min(20, gap * 0.42));
  const pos = sizes.map((n, k) => {
    const a = start + ((along - start - end) * k) / (sizes.length - 1);
    const last = k === sizes.length - 1;
    const g = !last ? gap : vertical ? (across - 24) / n : Math.min(88, (across - 60) / n); // кнопкам пульта — свой шаг, пошире
    return Array.from({ length: n }, (_, i) => {
      const b = across / 2 + (i - (n - 1) / 2) * g;
      return vertical ? [b, a] : [a, b];
    });
  });
  return { sizes, pos, r, vertical, W, H };
}
function curve(ctx, [x1, y1], [x2, y2], vertical) {
  ctx.beginPath(); ctx.moveTo(x1, y1);
  if (vertical) ctx.bezierCurveTo(x1, (y1 + y2) / 2, x2, (y1 + y2) / 2, x2, y2);
  else ctx.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2);
}
function bezierAt([x1, y1], [x2, y2], t, vertical) {
  const [c1, c2] = vertical ? [[x1, (y1 + y2) / 2], [x2, (y1 + y2) / 2]] : [[(x1 + x2) / 2, y1], [(x1 + x2) / 2, y2]];
  const u = 1 - t;
  return [u ** 3 * x1 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * x2,
    u ** 3 * y1 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * y2];
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ── общие детали: подписи входов, кнопки выходов, импульсы, лампочки ──
function inputLabels(ctx, lay, color) {
  const n = lay.sizes[0];
  ctx.fillStyle = color; ctx.font = `500 12px ${SANS}`; ctx.textBaseline = 'middle';
  lay.pos[0].forEach(([x, y], i) => {
    const speed = i === n - 1;
    if (lay.vertical) { ctx.textAlign = 'center'; ctx.fillText(speed ? 'v' : String(i + 1), x, y - lay.r - 14); }
    else { ctx.textAlign = 'right'; ctx.fillText(speed ? 'скорость' : `луч ${i + 1}`, x - lay.r - 10, y); }
  });
  if (lay.vertical) { ctx.textAlign = 'left'; ctx.font = `500 11px ${SANS}`; ctx.fillText('лучи 1–7 и скорость v', 12, 14); }
}
/** Кнопки пульта: чем сильнее мозг жмёт, тем ярче кнопка; полоска снизу — точная шкала.
 *  В каждой паре (газ/тормоз, влево/вправо) победитель светится — машина слушает разницу. */
function outputs(ctx, lay, style) {
  const last = lay.sizes.length - 1;
  const p = [0, 1, 2, 3].map((i) => warm(`${style.key}-out-${i}`, actOf(last, i)));
  const wins = (i) => p[i] - p[i ^ 1] > 0.08;
  const off = hexRGB(style.off);
  lay.pos[last].forEach(([x, y], i) => {
    const w = lay.vertical ? (lay.W - 24) / 4 - 6 : 132, h = lay.vertical ? 40 : 36;
    const cx = lay.vertical ? x : x + w / 2 - 6, cy = lay.vertical ? y + 24 : y;
    const x0 = cx - w / 2, y0 = cy - h / 2, rr = lay.vertical ? 12 : h / 2;
    const c = style.on(i, p[i]);
    const a = Math.max(0, Math.min(1, p[i])) ** 2; // квадрат разводит 70 % и 90 % заметнее
    const bg = off.map((v, n) => Math.round(v + (c[n] - v) * a));
    const rgb = (arr, al = 1) => `rgb(${arr.join(' ')} / ${al})`;
    ctx.save();
    if (wins(i)) { ctx.shadowColor = style.glow ? style.glow(i) : rgb(c, 0.7); ctx.shadowBlur = 14; }
    roundRect(ctx, x0, y0, w, h, rr); ctx.fillStyle = rgb(bg); ctx.fill();
    ctx.restore();
    ctx.save(); roundRect(ctx, x0, y0, w, h, rr); ctx.clip();
    ctx.fillStyle = lum(bg) > 0.45 ? 'rgb(0 0 0 / 0.35)' : rgb(c, 0.9);
    ctx.fillRect(x0, y0 + h - 4, w * Math.max(0, Math.min(1, p[i])), 4); // шкала
    ctx.restore();
    roundRect(ctx, x0, y0, w, h, rr); ctx.lineWidth = wins(i) ? 1.5 : 1; ctx.strokeStyle = wins(i) ? rgb(c) : style.ring; ctx.stroke();
    ctx.fillStyle = lum(bg) > 0.45 ? style.inkOn(i) : style.ink; ctx.textBaseline = 'middle';
    if (lay.vertical) {
      ctx.font = `600 11.5px ${SANS}`; ctx.textAlign = 'center'; ctx.fillText(OUT[i], cx, cy - 8);
      ctx.font = `500 11px ${MONO}`; ctx.fillText(pct(textOf(last, i)).trim(), cx, cy + 8);
    } else {
      ctx.font = `600 13px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText(OUT[i], x0 + 14, cy);
      ctx.font = `500 12px ${MONO}`; ctx.textAlign = 'right'; ctx.fillText(pct(textOf(last, i)), x0 + w - 12, cy);
    }
  });
}
function drawPulses(ctx, lay, colorOf, size = 2, from = lay.pos) {
  for (const p of pulses) {
    const a = from[p.k]?.[p.i], b = lay.pos[p.k + 1]?.[p.j];
    if (!a || !b) continue;
    ctx.fillStyle = colorOf(p);
    // хвост — несколько точек по самой кривой, а не прямая: не срезает изгиб
    for (let n = 0; n < 4; n++) {
      const t = p.t - n * 0.03;
      if (t < 0) break;
      const [x, y] = bezierAt(a, b, t, lay.vertical);
      ctx.globalAlpha = Math.min(1, 1.6 - p.t) * (1 - n * 0.24); // к концу пути гаснет — сигнал «влился» в нейрон
      ctx.beginPath(); ctx.arc(x, y, size * (1 - n * 0.18), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
const hexRGB = (hex) => [1, 3, 5].map((n) => parseInt(hex.slice(n, n + 2), 16));
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
/** Лампочка: число внутри, ободок, засечка порога сверху (длина — сила порога). */
function lampNode(ctx, lay, key, k, i, s) {
  const [x, y] = lay.pos[k][i];
  const a = actOf(k, i);
  const h = warm(`${key}-n-${k}-${i}`, Math.min(1, Math.abs(a)));
  const [c, al] = s.fill(h, a); // цвет [r,g,b] и прозрачность заливки
  const base = hexRGB(s.base);
  const mix = base.map((v, n) => Math.round(v + (c[n] - v) * al));
  ctx.beginPath(); ctx.arc(x, y, lay.r, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${mix.join(' ')})`; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = s.ring; ctx.stroke();
  if (k > 0 && s.biasColor) {
    const b = brain().layers[k - 1].biases[i];
    const len = Math.min(1, Math.abs(b)) * Math.PI * 0.8 + 0.25;
    ctx.beginPath(); ctx.arc(x, y, lay.r - 0.5, -Math.PI / 2 - len / 2, -Math.PI / 2 + len / 2);
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = s.biasColor(b); ctx.stroke(); ctx.lineCap = 'butt';
  }
  ctx.fillStyle = lum(mix) > 0.45 ? s.inkOn : s.ink; // тёмные цифры — только на светлой заливке
  ctx.font = `600 ${Math.min(12, Math.floor((2 * lay.r - 9) / 2.4))}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(fmt(textOf(k, i)), x, y + 1);
}
function eachHidden(lay, fn) {
  for (let k = 0; k < lay.sizes.length - 1; k++) for (let i = 0; i < lay.sizes[k]; i++) fn(k, i);
}

// ── огненная шкала: угли → красный → оранжевый → жёлтый → почти белый ──
const FIRE = [[46, 14, 8], [140, 28, 16], [224, 78, 12], [255, 168, 24], [255, 238, 196]];
function fire(t, a = 1) {
  t = Math.max(0, Math.min(1, t)) * (FIRE.length - 1);
  const i = Math.min(FIRE.length - 2, Math.floor(t)), f = t - i;
  const c = FIRE[i].map((v, n) => Math.round(v + (FIRE[i + 1][n] - v) * f));
  return `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;
}
function fireRGB(t) {
  t = Math.max(0, Math.min(1, t)) * (FIRE.length - 1);
  const i = Math.min(FIRE.length - 2, Math.floor(t)), f = t - i;
  return FIRE[i].map((v, n) => Math.round(v + (FIRE[i + 1][n] - v) * f));
}
const padColor = (i) => (i === 0 ? [209, 31, 40] : i === 1 ? [128, 127, 131] : [31, 95, 224]); // цвета кнопок пульта набора

// ── варианты ──
const VARIANTS = [
  {
    key: 'two', name: 'Два цвета',
    about: 'Красный — вес толкает, синий — мешает. Лента проступает из дымки там, где сигнал идёт сейчас.',
    legend: [['#ff5a60', 'вес «+»'], ['#6f9bff', 'вес «−»'], ['#ffd23f', 'нейрон: жёлтый «+», голубой «−»'], ['#e9e8e4', 'засечка на ободке — порог']],
    bg: '#0f0f11',
    draw(ctx, lay) {
      brain().layers.forEach((L, k) => {
        L.weights.forEach((row, i) => row.forEach((w, j) => {
          ctx.globalAlpha = 0.09; ctx.lineWidth = 0.8; ctx.strokeStyle = w >= 0 ? '#ff5a60' : '#6f9bff';
          curve(ctx, lay.pos[k][i], lay.pos[k + 1][j], lay.vertical); ctx.stroke();
        }));
        const strong = [];
        sigs[k].forEach((row, i) => row.forEach((v, j) => {
          const h = warm(`two-e-${k}-${i}-${j}`, Math.abs(v) > 0.35 ? Math.abs(v) ** 1.5 : 0);
          if (h > 0.05) strong.push({ i, j, v, h });
        }));
        strong.sort((a, b) => a.h - b.h);
        ctx.lineCap = 'round';
        for (const e of strong) {
          ctx.globalAlpha = 0.15 + 0.75 * e.h; ctx.lineWidth = 0.8 + 4 * e.h; ctx.strokeStyle = e.v >= 0 ? '#ff5a60' : '#6f9bff';
          curve(ctx, lay.pos[k][e.i], lay.pos[k + 1][e.j], lay.vertical); ctx.stroke();
        }
        ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
      });
      drawPulses(ctx, lay, (p) => (p.v >= 0 ? '#ffd0d2' : '#d6e2ff'));
      inputLabels(ctx, lay, '#9d9c98');
      eachHidden(lay, (k, i) => lampNode(ctx, lay, 'two', k, i, {
        base: '#1c1c1f', ring: '#3a393d', ink: '#e9e8e4', inkOn: '#1a1405',
        fill: (h, a) => [a >= 0 ? [255, 210, 63] : [111, 155, 255], h],
        biasColor: (b) => (b >= 0 ? '#ff5a60' : '#6f9bff'),
      }));
      outputs(ctx, lay, { key: 'two', off: '#1c1c1f', ring: '#3a393d', ink: '#e9e8e4', inkOn: () => '#141414', on: () => [244, 244, 242] });
    },
  },
  {
    key: 'fire', name: 'Огонь',
    about: 'Один цвет на всё: где идёт сигнал, там разгорается. Вспыхивает быстро, гаснет медленно.',
    legend: [['#8c1c10', 'слабый сигнал'], ['#e04e0c', 'сильнее'], ['#ffeec4', 'сильнейший'], ['#5a4a3e', 'знак веса — в формуле']],
    bg: '#0e0c0b',
    draw(ctx, lay) {
      brain().layers.forEach((L, k) => {
        const hot = [];
        L.weights.forEach((row, i) => row.forEach((w, j) => {
          const h = warm(`fire-e-${k}-${i}-${j}`, Math.abs(sigs[k][i][j]) ** 1.4);
          ctx.lineWidth = 0.7; ctx.strokeStyle = '#27221e';
          curve(ctx, lay.pos[k][i], lay.pos[k + 1][j], lay.vertical); ctx.stroke();
          if (h > 0.03) hot.push({ i, j, h });
        }));
        hot.sort((a, b) => a.h - b.h);
        ctx.lineCap = 'round';
        for (const e of hot) {
          ctx.lineWidth = 0.9 + 3.2 * e.h; ctx.strokeStyle = fire(e.h, Math.min(1, 0.25 + e.h));
          curve(ctx, lay.pos[k][e.i], lay.pos[k + 1][e.j], lay.vertical); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      });
      drawPulses(ctx, lay, (p) => fire(0.8 + 0.2 * Math.abs(p.v)));
      inputLabels(ctx, lay, '#9a8f86');
      eachHidden(lay, (k, i) => lampNode(ctx, lay, 'fire', k, i, { base: '#181412', ring: '#3a322c', ink: '#efe6db', inkOn: '#1f0e04', fill: (h) => [fireRGB(h), h] }));
      outputs(ctx, lay, { key: 'fire', off: '#181412', ring: '#3a322c', ink: '#efe6db', inkOn: () => '#1f0e04', on: (i, p) => fireRGB(0.35 + 0.65 * p), glow: () => fire(1, 0.6) });
    },
  },
  {
    key: 'chalk', name: 'Мел',
    about: 'Строгий монохром: сила сигнала — только яркость и толщина. Цвет есть только у кнопок пульта.',
    legend: [['#4a4a4f', 'связь в покое'], ['#f4f4f2', 'идёт сигнал'], ['#8e8d89', 'засечка на ободке — порог'], ['#d11f28', 'цвет — только у кнопок пульта']],
    bg: '#111113',
    draw(ctx, lay) {
      brain().layers.forEach((L, k) => {
        L.weights.forEach((row, i) => row.forEach((w, j) => {
          const h = warm(`chalk-e-${k}-${i}-${j}`, Math.abs(sigs[k][i][j]) ** 1.3);
          ctx.globalAlpha = 0.05 + 0.9 * h; ctx.lineWidth = 0.5 + 3.2 * h; ctx.strokeStyle = '#f4f4f2';
          curve(ctx, lay.pos[k][i], lay.pos[k + 1][j], lay.vertical); ctx.stroke();
        }));
        ctx.globalAlpha = 1;
      });
      drawPulses(ctx, lay, () => '#ffffff', 1.6);
      inputLabels(ctx, lay, '#8e8d89');
      eachHidden(lay, (k, i) => lampNode(ctx, lay, 'chalk', k, i, {
        base: '#1b1b1e', ring: '#47464b', ink: '#d9d8d4', inkOn: '#111113', fill: (h) => [[244, 244, 242], h * 0.95], biasColor: () => '#8e8d89',
      }));
      outputs(ctx, lay, { key: 'chalk', off: '#1b1b1e', ring: '#47464b', ink: '#f4f4f2', inkOn: () => '#111113', on: padColor });
    },
  },
  {
    key: 'stars', name: 'Созвездие',
    about: 'Нейроны — звёзды, связи — тонкие волоски. Где проходит сигнал, путь светится холодным светом.',
    legend: [['#4b5266', 'тишина'], ['#cfe0ff', 'идёт сигнал'], ['#ffffff', 'выход — звезда: крупнее, значит сильнее жмёт']],
    bg: '#0a0c12',
    draw(ctx, lay) {
      // связи выходят из-за плашки с числом, а не из самой точки — число не перечёркнуто
      const from = lay.pos.map((col) => col.map(([x, y]) => (lay.vertical ? [x, y + 26] : [x + 50, y])));
      brain().layers.forEach((L, k) => {
        L.weights.forEach((row, i) => row.forEach((w, j) => {
          const h = warm(`stars-e-${k}-${i}-${j}`, Math.abs(sigs[k][i][j]) ** 1.5);
          ctx.globalAlpha = 0.07 + 0.75 * h; ctx.lineWidth = 0.5 + 1.5 * h;
          ctx.strokeStyle = h > 0.06 ? '#cfe0ff' : '#8a93ad';
          curve(ctx, from[k][i], lay.pos[k + 1][j], lay.vertical); ctx.stroke();
        }));
        ctx.globalAlpha = 1;
      });
      drawPulses(ctx, lay, () => '#eef4ff', 1.6, from);
      inputLabels(ctx, lay, '#6f7892');
      const star = (x, y, h, r) => {
        ctx.save();
        ctx.shadowColor = `rgb(150 190 255 / ${0.85 * h})`; ctx.shadowBlur = 4 + 16 * h;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = h > 0.12 ? `rgb(${Math.round(200 + 55 * h)} ${Math.round(220 + 35 * h)} 255)` : '#4b5266'; ctx.fill();
        ctx.restore();
      };
      eachHidden(lay, (k, i) => {
        const [x, y] = lay.pos[k][i];
        const h = warm(`stars-n-${k}-${i}`, Math.min(1, Math.abs(actOf(k, i))));
        star(x, y, h, 3 + 3.5 * h);
        const tx = lay.vertical ? x : x + 12, ty = lay.vertical ? y + 16 : y;
        ctx.font = `500 11px ${MONO}`; ctx.textAlign = lay.vertical ? 'center' : 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = h > 0.12 ? '#eef4ff' : '#5d6680'; ctx.fillText(fmt(textOf(k, i)), tx, ty);
      });
      // выходы — самые крупные звёзды: размер = насколько мозг жмёт кнопку
      const last = lay.sizes.length - 1;
      lay.pos[last].forEach(([x, y], i) => {
        const pv = warm(`stars-out-${i}`, actOf(last, i));
        star(x, y, pv, 5 + 7 * pv);
        ctx.fillStyle = pv > 0.12 ? '#eef4ff' : '#6f7892'; ctx.textBaseline = 'middle';
        if (lay.vertical) {
          ctx.textAlign = 'center';
          ctx.font = `600 11.5px ${SANS}`; ctx.fillText(OUT[i], x, y + 24);
          ctx.font = `500 11px ${MONO}`; ctx.fillText(pct(textOf(last, i)).trim(), x, y + 39);
        } else {
          ctx.textAlign = 'left';
          ctx.font = `600 13px ${SANS}`; ctx.fillText(OUT[i], x + 22, y - 8);
          ctx.font = `500 12px ${MONO}`; ctx.fillText(pct(textOf(last, i)).trim(), x + 22, y + 9);
        }
      });
    },
  },
];

// ── формула нейрона: те же числа, что в узлах, и считается «в столбик» без расхождений ──
const slow = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'слабый' : 'слабых');
function sourceName(k, n) {
  if (k > 0) return `н${n + 1}`;
  return n === brain().layers[0].weights.length - 1 ? 'скор.' : `луч ${n + 1}`;
}
function formulaHTML(lay, k, i) {
  const L = brain().layers[k - 1];
  const a = trace[k - 1];
  const terms = a.map((ai, n) => ({ n, ai: round2(ai), w: round2(L.weights[n][i]) }))
    .map((t) => ({ ...t, p: round2(t.ai * t.w) }))
    .sort((x, y) => Math.abs(y.p) - Math.abs(x.p));
  const shownTerms = terms.filter((t) => Math.abs(t.p) >= 0.01);
  const top = shownTerms.slice(0, 4);
  const rest = shownTerms.length - top.length;
  const sum = round2(terms.reduce((s, t) => s + t.p, 0));
  const b = round2(L.biases[i]), z = round2(sum - b);
  const out = k === lay.sizes.length - 1;
  const act = out ? 1 / (1 + Math.exp(-3 * z)) : Math.tanh(2 * z);
  const name = (t) => `<span class="src">${sourceName(k - 1, t.n).padEnd(6, ' ')}</span>`;
  const rows = top.map((t) => `<span>${name(t)}${fmt(t.ai)} × ${fmtW(t.w)} = ${fmtW(t.p)}</span>`).join('');
  const more = rest > 0 ? `<span class="more">и ещё ${rest} ${slow(rest)}</span>` : '';
  const bias = b < 0 ? `(${fmtW(b)})` : fmtW(b);
  return `<b>${out ? `Кнопка «${OUT[i]}»` : `Нейрон ${i + 1} · слой ${k}`}</b>${rows}${more}
    <span class="sep">сумма ${fmtW(sum)} − порог ${bias} = <em>${fmtW(z)}</em></span>
    <span>${out ? `σ(3 × ${fmtW(z)})` : `tanh(2 × ${fmtW(z)})`} = <em>${out ? pct(act).trim() : fmt(act)}</em></span>`;
}

// ── мини-трасса ──
const mini = document.getElementById('mini');
const miniCam = new Camera();
function drawMini() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(mini.clientWidth * dpr), h = Math.round(mini.clientHeight * dpr);
  if (mini.width !== w || mini.height !== h) { mini.width = w; mini.height = h; }
  const ctx = mini.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#141415'; ctx.fillRect(0, 0, w, h);
  miniCam.mode = 'follow'; miniCam.update(mini, track, car, dpr * 0.6); miniCam.apply(ctx, mini);
  drawTrack(ctx, track, miniCam); drawSensors(ctx, car); drawCar(ctx, car, { color: bot.color, number: 1, cam: miniCam });
}

// ── доски: по одной на вариант ──
const gallery = document.getElementById('gallery');
gallery.innerHTML = VARIANTS.map((v) => `
  <section class="variant" id="board-${v.key}">
    <header><h2><span>${VARIANTS.indexOf(v) + 1}</span>${v.name}</h2><p>${v.about}</p></header>
    <div class="board"><canvas aria-label="Схема сети — вариант «${v.name}»"></canvas><div class="formula" hidden></div></div>
    <p class="legend">${v.legend.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('')}</p>
  </section>`).join('');
const boards = VARIANTS.map((v) => {
  const el = document.getElementById(`board-${v.key}`);
  const b = { v, canvas: el.querySelector('canvas'), card: el.querySelector('.formula'), mouse: null, lastFormula: 0 };
  b.canvas.addEventListener('pointermove', (e) => { const r = b.canvas.getBoundingClientRect(); b.mouse = [e.clientX - r.left, e.clientY - r.top]; });
  b.canvas.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'mouse') return; b.mouse = null; b.card.hidden = true; });
  // на телефоне наведения нет — нейрон выбирается касанием
  b.canvas.addEventListener('pointerdown', (e) => { const r = b.canvas.getBoundingClientRect(); b.mouse = [e.clientX - r.left, e.clientY - r.top]; b.lastFormula = 0; });
  return b;
});
function drawBoard(b, t) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const vertical = b.canvas.clientWidth < 640;
  b.canvas.style.height = vertical ? '540px' : '470px';
  const W = b.canvas.clientWidth, H = b.canvas.clientHeight;
  if (b.canvas.width !== Math.round(W * dpr) || b.canvas.height !== Math.round(H * dpr)) { b.canvas.width = Math.round(W * dpr); b.canvas.height = Math.round(H * dpr); }
  const ctx = b.canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = b.v.bg; ctx.fillRect(0, 0, W, H);
  const lay = layout(W, H, vertical);
  b.v.draw(ctx, lay);
  if (!b.mouse || !trace || t - b.lastFormula < 100) return;
  b.lastFormula = t;
  let hit = null;
  lay.pos.forEach((col, k) => col.forEach(([x, y], i) => {
    if (k === 0) return;
    // у выходов цель — вся кнопка, а не точка, где сходятся связи
    const [cx, cy, rad] = k < lay.sizes.length - 1 ? [x, y, lay.r + 12] : lay.vertical ? [x, y + 24, 30] : [x + 60, y, 66];
    if (Math.hypot(b.mouse[0] - cx, b.mouse[1] - cy) < rad) hit = { k, i, x, y };
  }));
  if (!hit) { b.card.hidden = true; return; }
  b.card.innerHTML = formulaHTML(lay, hit.k, hit.i);
  b.card.hidden = false;
  const cw = b.card.offsetWidth, ch = b.card.offsetHeight;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  if (lay.vertical) { // на телефоне — под нейроном или над ним, во всю ширину
    b.card.style.left = `${clamp(hit.x - cw / 2, 8, W - cw - 8)}px`;
    b.card.style.top = `${hit.y + 28 + ch > H ? hit.y - ch - 28 : hit.y + 28}px`;
  } else { // на десктопе — сбоку, в пустом промежутке между слоями, соседей не закрывает
    const outLayer = hit.k === lay.sizes.length - 1;
    b.card.style.left = `${outLayer ? hit.x - cw - lay.r - 18 : hit.x + lay.r + 18}px`;
    b.card.style.top = `${clamp(hit.y - ch / 2, 8, H - ch - 8)}px`;
  }
}

let lastT = performance.now();
function frame(t) {
  frameDt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
  step();
  sigs = brain().layers.map((_, k) => signals(k));
  smooth(t, frameDt); spawnPulses(); advancePulses(frameDt);
  drawMini();
  for (const b of boards) {
    const r = b.canvas.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) drawBoard(b, t); // рисуем только видимые доски
  }
  requestAnimationFrame(frame);
}

document.getElementById('pause').onclick = (e) => {
  paused = !paused;
  e.currentTarget.textContent = paused ? 'Поехали' : 'Пауза';
  e.currentTarget.setAttribute('aria-pressed', String(paused));
};
const botSel = document.getElementById('bot');
botSel.innerHTML = BOTS.filter((b) => b.think !== 'step').map((b) => `<option>${b.name}</option>`).join('');
botSel.onchange = () => loadBot(botSel.value);

readPalette();
loadBot('Сквозняк');
// холст рисует текст сразу — ждём свои шрифты, иначе первые кадры будут запасным шрифтом
Promise.all([document.fonts.load(`600 12px ${MONO}`), document.fonts.load(`600 12px ${SANS}`)])
  .finally(() => requestAnimationFrame(frame));
