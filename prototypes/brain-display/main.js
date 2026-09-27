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
    if (Math.abs(v) > 0.3 && Math.random() < Math.abs(v) * 0.04 && pulses.length < 400) pulses.push({ k, i, j, t: 0, v });
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
  const start = vertical ? 64 : 120, end = vertical ? 78 : 160; // место под подписи входов и кнопки выходов
  const maxN = Math.max(...sizes);
  const gap = Math.min(52, (across - 28) / maxN);
  const r = Math.max(10, Math.min(17, gap * 0.38));
  const pos = sizes.map((n, k) => {
    const a = start + ((along - start - end) * k) / (sizes.length - 1);
    const g = vertical && k === sizes.length - 1 ? (across - 24) / n : gap;
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
/** Кнопки пульта: горят, когда мозг их «жмёт». */
function outputs(ctx, lay, style) {
  const last = lay.sizes.length - 1;
  lay.pos[last].forEach(([x, y], i) => {
    const w = lay.vertical ? Math.min(84, (lay.W - 24) / 4 - 8) : 128, h = 32;
    const cx = lay.vertical ? x : x + w / 2 - 6, cy = lay.vertical ? y + 26 : y;
    const hv = warm(`${style.key}-out-${i}`, actOf(last, i));
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fillStyle = style.off; ctx.fill();
    ctx.fillStyle = style.on(i, hv); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = style.ring; ctx.stroke();
    ctx.fillStyle = hv > 0.55 ? style.inkOn(i) : style.ink; ctx.textBaseline = 'middle';
    if (lay.vertical) {
      ctx.font = `600 12px ${SANS}`; ctx.textAlign = 'center'; ctx.fillText(OUT[i], cx, cy - 6);
      ctx.font = `500 11px ${MONO}`; ctx.fillText(pct(textOf(last, i)), cx, cy + 8);
    } else {
      ctx.font = `600 13px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText(OUT[i], cx - w / 2 + 14, cy + 1);
      ctx.font = `500 12px ${MONO}`; ctx.textAlign = 'right'; ctx.fillText(pct(textOf(last, i)), cx + w / 2 - 12, cy + 1);
    }
  });
}
function drawPulses(ctx, lay, colorOf, size = 2) {
  ctx.lineCap = 'round';
  for (const p of pulses) {
    const a = lay.pos[p.k]?.[p.i], b = lay.pos[p.k + 1]?.[p.j];
    if (!a || !b) continue;
    const [x, y] = bezierAt(a, b, p.t, lay.vertical), [tx, ty] = bezierAt(a, b, Math.max(0, p.t - 0.07), lay.vertical);
    const c = colorOf(p);
    ctx.globalAlpha = Math.min(1, 1.6 - p.t); // к концу пути гаснет — сигнал «влился» в нейрон
    ctx.strokeStyle = c; ctx.lineWidth = size;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.lineCap = 'butt';
}
/** Лампочка: число внутри, ободок, засечка порога (сверху; на телефоне — слева) */
function lampNode(ctx, lay, key, k, i, s) {
  const [x, y] = lay.pos[k][i];
  const a = actOf(k, i);
  const h = warm(`${key}-n-${k}-${i}`, Math.min(1, Math.abs(a)));
  ctx.beginPath(); ctx.arc(x, y, lay.r, 0, Math.PI * 2);
  ctx.fillStyle = s.base; ctx.fill();
  ctx.fillStyle = s.fill(h, a); ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = s.ring; ctx.stroke();
  if (k > 0 && s.biasColor) {
    const b = brain().layers[k - 1].biases[i];
    const len = Math.min(1, Math.abs(b)) * Math.PI * 0.8 + 0.25;
    const mid = lay.vertical ? Math.PI : -Math.PI / 2;
    ctx.beginPath(); ctx.arc(x, y, lay.r + 3.5, mid - len / 2, mid + len / 2);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = s.biasColor(b); ctx.stroke(); ctx.lineCap = 'butt';
  }
  ctx.fillStyle = h > 0.6 ? s.inkOn : s.ink;
  ctx.font = `600 ${Math.round(lay.r * 0.68)}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(fmt(textOf(k, i)), x, y + 0.5);
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
const padColor = (i, h) => (i === 0 ? `rgb(209 31 40 / ${h})` : i === 1 ? `rgb(128 127 131 / ${h})` : `rgb(31 95 224 / ${h})`);

// ── варианты ──
const VARIANTS = [
  {
    key: 'two', name: 'Два цвета',
    about: 'Цвет — знак веса: красный толкает к действию, синий мешает. Все связи в дымке; те, по которым сейчас идёт сигнал, проступают лентой — чем сильнее, тем толще.',
    legend: [['#ff5a60', 'вес «+»'], ['#6f9bff', 'вес «−»'], ['#ffd23f', 'нейрон горит · засечка — порог']],
    bg: '#0f0f11',
    draw(ctx, lay) {
      brain().layers.forEach((L, k) => {
        L.weights.forEach((row, i) => row.forEach((w, j) => {
          ctx.globalAlpha = 0.09; ctx.lineWidth = 0.8; ctx.strokeStyle = w >= 0 ? '#ff5a60' : '#6f9bff';
          curve(ctx, lay.pos[k][i], lay.pos[k + 1][j], lay.vertical); ctx.stroke();
        }));
        const strong = [];
        sigs[k].forEach((row, i) => row.forEach((v, j) => {
          const h = warm(`two-e-${k}-${i}-${j}`, Math.abs(v) > 0.18 ? Math.abs(v) : 0);
          if (h > 0.05) strong.push({ i, j, v, h });
        }));
        strong.sort((a, b) => a.h - b.h);
        ctx.lineCap = 'round';
        for (const e of strong) {
          ctx.globalAlpha = 0.25 + 0.6 * e.h; ctx.lineWidth = 1 + 7 * e.h; ctx.strokeStyle = e.v >= 0 ? '#ff5a60' : '#6f9bff';
          curve(ctx, lay.pos[k][e.i], lay.pos[k + 1][e.j], lay.vertical); ctx.stroke();
        }
        ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
      });
      drawPulses(ctx, lay, () => '#ffffff');
      inputLabels(ctx, lay, '#9d9c98');
      eachHidden(lay, (k, i) => lampNode(ctx, lay, 'two', k, i, {
        base: '#1c1c1f', ring: '#3a393d', ink: '#e9e8e4', inkOn: '#1a1405',
        fill: (h, a) => (a >= 0 ? `rgb(255 210 63 / ${h})` : `rgb(111 155 255 / ${h})`),
        biasColor: (b) => (b >= 0 ? '#ff5a60' : '#6f9bff'),
      }));
      outputs(ctx, lay, { key: 'two', off: '#1c1c1f', ring: '#3a393d', ink: '#e9e8e4', inkOn: () => '#ffffff', on: padColor });
    },
  },
  {
    key: 'fire', name: 'Огонь',
    about: 'Один цвет на всё. Связь и нейрон разгораются, когда через них идёт сигнал: вспыхивают быстро, гаснут медленно — видно, какой путь сейчас решает. Знак веса — в формуле.',
    legend: [['#8c1c10', 'слабый сигнал'], ['#e04e0c', 'сильнее'], ['#ffeec4', 'сильнейший']],
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
      eachHidden(lay, (k, i) => lampNode(ctx, lay, 'fire', k, i, { base: '#181412', ring: '#3a322c', ink: '#efe6db', inkOn: '#1f0e04', fill: (h) => fire(h, h) }));
      outputs(ctx, lay, { key: 'fire', off: '#181412', ring: '#3a322c', ink: '#efe6db', inkOn: () => '#1f0e04', on: (i, h) => fire(h, h) });
    },
  },
  {
    key: 'chalk', name: 'Мел',
    about: 'Строгий монохром: сила сигнала — только яркость и толщина. Цвет остаётся одному месту — кнопкам пульта, куда в итоге всё приходит.',
    legend: [['#4a4a4f', 'связь в покое'], ['#f4f4f2', 'идёт сигнал'], ['#d11f28', 'мозг жмёт газ']],
    bg: '#111113',
    draw(ctx, lay) {
      brain().layers.forEach((L, k) => {
        L.weights.forEach((row, i) => row.forEach((w, j) => {
          const h = warm(`chalk-e-${k}-${i}-${j}`, Math.abs(sigs[k][i][j]) ** 1.3);
          ctx.globalAlpha = 0.12 + 0.8 * h; ctx.lineWidth = 0.6 + 2.4 * h; ctx.strokeStyle = '#f4f4f2';
          curve(ctx, lay.pos[k][i], lay.pos[k + 1][j], lay.vertical); ctx.stroke();
        }));
        ctx.globalAlpha = 1;
      });
      drawPulses(ctx, lay, () => '#ffffff', 1.6);
      inputLabels(ctx, lay, '#8e8d89');
      eachHidden(lay, (k, i) => lampNode(ctx, lay, 'chalk', k, i, {
        base: '#1b1b1e', ring: '#47464b', ink: '#d9d8d4', inkOn: '#111113', fill: (h) => `rgb(244 244 242 / ${h * 0.95})`, biasColor: () => '#8e8d89',
      }));
      outputs(ctx, lay, { key: 'chalk', off: '#1b1b1e', ring: '#47464b', ink: '#d9d8d4', inkOn: () => '#ffffff', on: padColor });
    },
  },
  {
    key: 'stars', name: 'Созвездие',
    about: 'Нейроны — светящиеся точки, связи — тонкие волоски. Всё тихое, пока не пройдёт сигнал: тогда путь теплеет и светится. Числа — рядом с точками.',
    legend: [['#7d8497', 'тишина'], ['#ffd9a8', 'идёт сигнал']],
    bg: '#0b0c10',
    draw(ctx, lay) {
      brain().layers.forEach((L, k) => {
        L.weights.forEach((row, i) => row.forEach((w, j) => {
          const h = warm(`stars-e-${k}-${i}-${j}`, Math.abs(sigs[k][i][j]) ** 1.5);
          ctx.globalAlpha = 0.07 + 0.75 * h; ctx.lineWidth = 0.5 + 1.5 * h;
          ctx.strokeStyle = h > 0.06 ? '#ffd9a8' : '#b8c0d8';
          curve(ctx, lay.pos[k][i], lay.pos[k + 1][j], lay.vertical); ctx.stroke();
        }));
        ctx.globalAlpha = 1;
      });
      drawPulses(ctx, lay, () => '#fff6e6', 1.6);
      inputLabels(ctx, lay, '#7d8497');
      eachHidden(lay, (k, i) => {
        const [x, y] = lay.pos[k][i];
        const h = warm(`stars-n-${k}-${i}`, Math.min(1, Math.abs(actOf(k, i))));
        ctx.save();
        ctx.shadowColor = `rgb(255 196 120 / ${0.85 * h})`; ctx.shadowBlur = 4 + 16 * h;
        ctx.beginPath(); ctx.arc(x, y, 3 + 3.5 * h, 0, Math.PI * 2);
        ctx.fillStyle = h > 0.12 ? `rgb(255 ${Math.round(214 + 34 * h)} ${Math.round(168 + 80 * h)})` : '#7d8497'; ctx.fill();
        ctx.restore();
        // число — на тёмной плашке, отодвинуто от связей: вправо (на телефоне — вниз)
        const tx = lay.vertical ? x : x + 12, ty = lay.vertical ? y + 16 : y;
        ctx.font = `500 11px ${MONO}`; ctx.textAlign = lay.vertical ? 'center' : 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgb(11 12 16 / 0.9)'; roundRect(ctx, lay.vertical ? tx - 17 : tx - 3, ty - 8, 34, 16, 4); ctx.fill();
        ctx.fillStyle = h > 0.3 ? '#fbf3e6' : '#6f7588'; ctx.fillText(fmt(textOf(k, i)), tx, ty);
      });
      outputs(ctx, lay, { key: 'stars', off: '#141620', ring: '#2d3142', ink: '#b8c0d8', inkOn: () => '#1a1206', on: (i, h) => `rgb(255 214 168 / ${h})` });
    },
  },
];

// ── формула нейрона ──
function formulaHTML(lay, k, i) {
  const L = brain().layers[k - 1];
  const a = trace[k - 1];
  const terms = a.map((ai, n) => ({ ai, w: L.weights[n][i] })).filter((t) => Math.abs(t.ai * t.w) > 0.02)
    .sort((x, y) => Math.abs(y.ai * y.w) - Math.abs(x.ai * x.w));
  const top = terms.slice(0, 4);
  const sum = a.reduce((s, ai, n) => s + ai * L.weights[n][i], 0);
  const b = L.biases[i], z = sum - b;
  const out = k === lay.sizes.length - 1;
  const rows = top.map((t) => `<span>${fmt(t.ai)} × ${fmt(t.w)} = ${fmt(t.ai * t.w)}</span>`).join('');
  const more = terms.length > top.length ? `<span class="more">и ещё ${terms.length - top.length} слабых</span>` : '';
  return `<b>${out ? OUT[i] : `Нейрон ${i + 1} · слой ${k}`}</b>${rows}${more}
    <span class="sep">сумма ${fmt(sum)} − порог ${fmt(b)} = <em>${fmt(z)}</em></span>
    <span>${out ? `σ(3 × ${fmt(z)})` : `tanh(2 × ${fmt(z)})`} = <em>${fmt(trace[k][i])}</em></span>`;
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
  b.canvas.addEventListener('pointerleave', () => { b.mouse = null; b.card.hidden = true; });
  return b;
});
function drawBoard(b, t) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const vertical = b.canvas.clientWidth < 640;
  b.canvas.style.height = vertical ? '580px' : '470px';
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
    if (k > 0 && Math.hypot(b.mouse[0] - x, b.mouse[1] - y) < lay.r + 12) hit = { k, i, x, y };
  }));
  if (!hit) { b.card.hidden = true; return; }
  b.card.innerHTML = formulaHTML(lay, hit.k, hit.i);
  b.card.hidden = false;
  const cw = b.card.offsetWidth, ch = b.card.offsetHeight;
  b.card.style.left = `${Math.max(8, Math.min(hit.x - cw / 2, W - cw - 8))}px`;
  b.card.style.top = `${hit.y + 22 + ch > H ? hit.y - ch - 22 : hit.y + 22}px`;
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
requestAnimationFrame(frame);
