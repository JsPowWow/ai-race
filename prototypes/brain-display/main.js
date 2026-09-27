// ПРОТОТИП «Табло мозга» — выбросить после выбора варианта (ветка prototype/brain-display, не main).
// Вопрос: как показать маленькую сеть, чтобы было понятно и красиво — числа в узлах, импульсы по связям,
// дымка неактивных связей. Три варианта: #A слева направо, #B сверху вниз, #C поток сильных сигналов.
// Настоящий движок и настоящие боты: сеть «думает» прямо сейчас, пока машина едет по «Разминке».
import { Car, maxTicksFor } from '../../engine/car.js';
import { getTrainingTrack } from '../../engine/track.js';
import { Camera, drawTrack, drawCar, drawSensors, readPalette } from '../../engine/render.js';
import { parseCarFile } from '../../engine/car-file.js';
import { feedForward, thinkVariants } from '../../student/think.js';
import BOTS from '../../tools/bots.json';

const C = {
  panel: '#101012', ink: '#f4f4f2', muted: '#8e8d89', line: '#2f2e31',
  pos: '#ff5a60', neg: '#5b8cff', lamp: '#ffd23f', action: '#d11f28', off: '#1d1d20',
};
const OUT = [
  { id: 'gas', label: 'Газ', color: C.action },
  { id: 'brake', label: 'Тормоз', color: '#8e8d89' },
  { id: 'left', label: '←', color: C.lamp },
  { id: 'right', label: '→', color: C.lamp },
];
const VARIANTS = { A: 'Слева направо', B: 'Сверху вниз', C: 'Поток сильных сигналов' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── машина едет, сеть думает ──
const track = getTrainingTrack('warmup');
let bot = BOTS.find((b) => b.name === 'Сквозняк');
let driver, car, trace = null;
function loadBot(name) {
  bot = BOTS.find((b) => b.name === name);
  const f = parseCarFile(bot);
  driver = { brain: f.brain, think: thinkVariants[f.thinkId].think, sensors: f.sensors };
  car = new Car(track, driver);
  pulses.length = 0;
}
let paused = false;
function step() {
  if (paused) return;
  for (let s = 0; s < 1; s++) {
    if (car.done) car = new Car(track, driver);
    car.step(track, maxTicksFor(track));
  }
  trace = feedForward.lastTrace;
}

// ── общее: числа, цвета, импульсы ──
// Числа не прыгают: всегда знак и две цифры (+.73 / −.20) — одна ширина в моноширинном шрифте
const fmt = (v) => (v < 0 ? '−' : '+') + Math.min(0.99, Math.abs(v)).toFixed(2).replace(/^0/, '');

// Сглаживание и редкое обновление текста: лампочки реагируют сразу, а цифры меняются
// 10 раз в секунду и плавно догоняют настоящее значение — их успеваешь прочитать
let shown = null;          // сглаженные значения для цифр
let textTrace = null;      // то, что сейчас написано (обновляется раз в 100 мс)
let lastText = 0;
function smoothTrace(t, dt) {
  if (!trace) return;
  if (!shown || shown.length !== trace.length || shown.some((l, k) => l.length !== trace[k].length)) shown = trace.map((l) => [...l]);
  const a = 1 - Math.exp(-dt / 0.12);
  trace.forEach((l, k) => l.forEach((v, i) => { shown[k][i] += (v - shown[k][i]) * a; }));
  if (!textTrace || t - lastText > 100) { textTrace = shown.map((l) => [...l]); lastText = t; }
}
const textOf = (k, i) => textTrace?.[k]?.[i] ?? 0;
const brainOf = () => driver.brain;
/** сигнал по связи i→j слоя k: вход × вес, нормированный на самый сильный в слое */
function signals(k) {
  const L = brainOf().layers[k];
  const a = trace?.[k] ?? L.weights.map(() => 0);
  let max = 1e-6;
  const s = L.weights.map((row, i) => row.map((w, j) => { const v = a[i] * w; max = Math.max(max, Math.abs(v)); return v; }));
  return s.map((row) => row.map((v) => v / max));
}
const pulses = [];
function spawnPulses(k, sig) {
  if (reduceMotion || paused) return;
  sig.forEach((row, i) => row.forEach((v, j) => {
    if (Math.abs(v) > 0.25 && Math.random() < Math.abs(v) * 0.05 && pulses.length < 500) pulses.push({ k, i, j, t: 0, v });
  }));
}
function advancePulses(dt) { for (const p of pulses) p.t += dt * 1.6; for (let n = pulses.length - 1; n >= 0; n--) if (pulses[n].t >= 1) pulses.splice(n, 1); }
function bezier(a, b, t, vertical) {
  // плавная S-кривая: выходит горизонтально (или вертикально) из узла и так же входит
  const [x1, y1] = a, [x2, y2] = b;
  const m = 0.5;
  const p1 = vertical ? [x1, y1 + (y2 - y1) * m] : [x1 + (x2 - x1) * m, y1];
  const p2 = vertical ? [x2, y2 - (y2 - y1) * m] : [x2 - (x2 - x1) * m, y2];
  const u = 1 - t;
  return [u * u * u * x1 + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * x2,
    u * u * u * y1 + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * y2];
}
function curve(ctx, a, b, vertical) {
  const [x1, y1] = a, [x2, y2] = b;
  ctx.beginPath(); ctx.moveTo(x1, y1);
  if (vertical) ctx.bezierCurveTo(x1, (y1 + y2) / 2, x2, (y1 + y2) / 2, x2, y2);
  else ctx.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2);
}

/** Узел-лампочка: число внутри, яркость — сила срабатывания, засечка на ободке — порог */
function lamp(ctx, x, y, r, act, bias, text = act) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = C.off; ctx.fill();
  if (act !== null) {
    ctx.globalAlpha = Math.min(1, Math.abs(act));
    ctx.fillStyle = act >= 0 ? C.lamp : C.neg; ctx.fill(); ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#3a393d'; ctx.stroke();
  if (bias !== null) { // засечка порога: сверху, длина ~ |порог|, цвет — знак
    const len = Math.min(1, Math.abs(bias)) * Math.PI * 0.9;
    ctx.beginPath(); ctx.arc(x, y, r + 3, -Math.PI / 2 - len / 2, -Math.PI / 2 + len / 2);
    ctx.lineWidth = 2.5; ctx.strokeStyle = bias >= 0 ? C.pos : C.neg; ctx.stroke();
  }
  if (act !== null && r >= 11) {
    ctx.fillStyle = Math.abs(act) > 0.55 ? '#141414' : C.ink;
    ctx.font = `600 ${Math.round(r * 0.72)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fmt(text), x, y + 1);
  }
}
/** Кнопка пульта на выходе: горит, когда мозг её «жмёт» */
function outButton(ctx, x, y, w, h, o, v, text = v) {
  const on = v > 0.5;
  ctx.fillStyle = on ? o.color : C.off;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  ctx.globalAlpha = on ? 0 : Math.min(1, v * 1.6) * 0.5; ctx.fillStyle = o.color; ctx.fill(); ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5; ctx.strokeStyle = on ? o.color : '#3a393d'; ctx.stroke();
  ctx.fillStyle = on && o.id !== 'left' && o.id !== 'right' ? '#fff' : on ? '#141414' : C.ink;
  ctx.font = `600 13px Rubik, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(o.label, x - 14, y + 1);
  ctx.font = '600 12px "JetBrains Mono", monospace';
  ctx.fillText(`${String(Math.round(text * 100)).padStart(3, '\u2007')}%`, x + w / 2 - 24, y + 1);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const inputLabel = (i, n) => (i === n - 1 ? 'скорость' : `луч ${i + 1}`);

// ── раскладки: где стоит каждый узел ──
function layout(W, H, vertical) {
  const sizes = [brainOf().layers[0].weights.length, ...brainOf().layers.map((l) => l.biases.length)];
  const along = vertical ? H : W, across = vertical ? W : H;
  const pad0 = vertical ? 70 : 110, pad1 = vertical ? 60 : 120;
  const maxN = Math.max(...sizes);
  const r = Math.max(8, Math.min(18, (across - 40) / maxN / 2.5));
  const pos = sizes.map((n, k) => {
    const a = pad0 + ((along - pad0 - pad1) * k) / (sizes.length - 1);
    const gap = Math.min((across - 40) / n, r * 3.2);
    return Array.from({ length: n }, (_, i) => {
      const b = across / 2 + (i - (n - 1) / 2) * gap;
      return vertical ? [b, a] : [a, b];
    });
  });
  return { sizes, pos, r };
}

// ── A и B: все связи, дымка, импульсы ──
function drawGraph(ctx, W, H, vertical) {
  const lay = layout(W, H, vertical);
  const brain = brainOf();
  brain.layers.forEach((L, k) => {
    const sig = signals(k);
    let wmax = 1e-6; L.weights.forEach((row) => row.forEach((w) => { wmax = Math.max(wmax, Math.abs(w)); }));
    // сначала дымка (слабые), потом чёткие (сильные) — сильные лежат сверху
    const edges = [];
    L.weights.forEach((row, i) => row.forEach((w, j) => edges.push({ i, j, w, s: Math.abs(sig[i][j]) })));
    edges.sort((a, b) => a.s - b.s);
    for (const e of edges) {
      ctx.globalAlpha = 0.05 + 0.85 * e.s ** 1.5;
      ctx.lineWidth = 0.6 + 2.6 * (Math.abs(e.w) / wmax) * (0.35 + 0.65 * e.s);
      ctx.strokeStyle = e.w >= 0 ? C.pos : C.neg;
      curve(ctx, lay.pos[k][e.i], lay.pos[k + 1][e.j], vertical); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    spawnPulses(k, sig);
  });
  // импульсы: яркая точка с коротким хвостом
  for (const p of pulses) {
    const a = lay.pos[p.k]?.[p.i], b = lay.pos[p.k + 1]?.[p.j];
    if (!a || !b) continue;
    const [x, y] = bezier(a, b, p.t, vertical), [tx, ty] = bezier(a, b, Math.max(0, p.t - 0.08), vertical);
    ctx.strokeStyle = p.v >= 0 ? C.pos : C.neg; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // узлы
  lay.sizes.forEach((n, k) => {
    const last = k === lay.sizes.length - 1;
    for (let i = 0; i < n; i++) {
      const [x, y] = lay.pos[k][i];
      const act = trace?.[k]?.[i] ?? null;
      if (last) { vertical ? outButton(ctx, x, y + 6, Math.min(86, W / 4.6), 34, OUT[i], act ?? 0, textOf(k, i)) : outButton(ctx, x + 36, y, 116, 30, OUT[i], act ?? 0, textOf(k, i)); continue; }
      lamp(ctx, x, y, lay.r, act, k > 0 ? brain.layers[k - 1].biases[i] : null, textOf(k, i));
      if (k === 0) {
        ctx.fillStyle = C.muted; ctx.font = '12px Rubik, sans-serif'; ctx.textBaseline = 'middle';
        if (vertical) { ctx.textAlign = 'center'; ctx.fillText(i === n - 1 ? 'v' : `${i + 1}`, x, y - lay.r - 12); }
        else { ctx.textAlign = 'right'; ctx.fillText(inputLabel(i, n), x - lay.r - 8, y); }
      }
    }
  });
  if (vertical) drawRayFan(ctx, W / 2, 6); // веер лучей над входами
  return lay;
}
/** В варианте B над входами — машина и её лучи вверх: длинный луч — пусто, короткий — препятствие близко */
function drawRayFan(ctx, cx, cy) {
  const n = car.readings.length;
  ctx.save(); ctx.translate(cx, cy + 16);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 - 0.9 + (1.8 * i) / Math.max(1, n - 1);
    const len = 8 + 22 * (1 - car.readings[i]);
    ctx.strokeStyle = car.readings[i] > 0 ? C.lamp : 'rgb(255 210 63 / 0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); ctx.stroke();
  }
  ctx.fillStyle = C.lamp; roundRect(ctx, -6, -4, 12, 16, 4); ctx.fill();
  ctx.restore();
}

// ── C: только сильные сигналы, лентами; нейроны — столбики ──
function drawFlow(ctx, W, H) {
  const lay = layout(W, H, false);
  const brain = brainOf();
  brain.layers.forEach((L, k) => {
    const sig = signals(k);
    const strong = [];
    sig.forEach((row, i) => row.forEach((v, j) => { if (Math.abs(v) > 0.2) strong.push({ i, j, v }); }));
    strong.sort((a, b) => Math.abs(a.v) - Math.abs(b.v));
    for (const e of strong) {
      ctx.globalAlpha = 0.25 + 0.6 * Math.abs(e.v);
      ctx.lineWidth = 1 + 12 * Math.abs(e.v);
      ctx.strokeStyle = e.v >= 0 ? C.pos : C.neg;
      ctx.lineCap = 'round';
      curve(ctx, lay.pos[k][e.i], lay.pos[k + 1][e.j], false); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
  lay.sizes.forEach((n, k) => {
    const last = k === lay.sizes.length - 1;
    for (let i = 0; i < n; i++) {
      const [x, y] = lay.pos[k][i];
      const act = trace?.[k]?.[i] ?? 0;
      if (last) { outButton(ctx, x + 36, y, 116, 30, OUT[i], act, textOf(k, i)); continue; }
      const h = lay.r * 2, w = 10;
      ctx.fillStyle = C.off; roundRect(ctx, x - w / 2, y - h / 2, w, h, 3); ctx.fill();
      const fh = h * Math.min(1, Math.abs(act));
      ctx.fillStyle = act >= 0 ? C.lamp : C.neg; roundRect(ctx, x - w / 2, y + h / 2 - fh, w, Math.max(1, fh), 3); ctx.fill();
      ctx.fillStyle = C.ink; ctx.font = '600 11px "JetBrains Mono", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(fmt(textOf(k, i)), x + 9, y);
      if (k === 0) { ctx.fillStyle = C.muted; ctx.font = '12px Rubik, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(inputLabel(i, n), x - 10, y); }
    }
  });
  return lay;
}

// ── формула нейрона под курсором ──
const card = document.getElementById('formula');
function showFormula(lay, mx, my) {
  let hit = null;
  lay.pos.forEach((col, k) => col.forEach(([x, y], i) => { if (k > 0 && Math.hypot(mx - x, my - y) < lay.r + 10) hit = { k, i, x, y }; }));
  if (!hit || !trace) { card.hidden = true; return; }
  const L = brainOf().layers[hit.k - 1];
  const a = trace[hit.k - 1];
  const terms = a.map((ai, i) => ({ ai, w: L.weights[i][hit.i] })).filter((t) => Math.abs(t.ai * t.w) > 0.02);
  const sum = a.reduce((s, ai, i) => s + ai * L.weights[i][hit.i], 0);
  const b = L.biases[hit.i], z = sum - b;
  const isOut = hit.k === lay.sizes.length - 1;
  const f = isOut ? `σ(3·${fmt(z)})` : `tanh(2·${fmt(z)})`;
  card.innerHTML = `<b>${isOut ? OUT[hit.i].label : `Нейрон ${hit.i + 1}, слой ${hit.k}`}</b>
    <span>${terms.map((t) => `${fmt(t.ai)}·${fmt(t.w)}`).join(' + ') || '0'}</span>
    <span>− порог ${fmt(b)} = <b>${fmt(z)}</b></span>
    <span>${f} = <b>${fmt(trace[hit.k][hit.i])}</b></span>`;
  card.style.left = `${Math.min(hit.x + 16, canvas.clientWidth - 260)}px`;
  card.style.top = `${hit.y + 16}px`;
  card.hidden = false;
}

// ── трасса-мини сверху ──
const mini = document.getElementById('mini');
const miniCam = new Camera();
function drawMini() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = mini.clientWidth * dpr, h = mini.clientHeight * dpr;
  if (mini.width !== w) { mini.width = w; mini.height = h; }
  const ctx = mini.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#141415'; ctx.fillRect(0, 0, w, h);
  miniCam.mode = 'follow'; miniCam.update(mini, track, car, dpr * 0.6);
  miniCam.apply(ctx, mini);
  drawTrack(ctx, track, miniCam); drawSensors(ctx, car); drawCar(ctx, car, { color: bot.color, number: 1, cam: miniCam });
}

// ── кадр ──
const canvas = document.getElementById('net');
let variant = VARIANTS[location.hash.slice(1)] ? location.hash.slice(1) : 'A';
let mouse = null, lastT = performance.now(), lastFormula = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
  step(); smoothTrace(t, dt); advancePulses(dt); drawMini();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const vertical = variant === 'B';
  canvas.style.height = vertical ? '620px' : '460px';
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const lay = variant === 'C' ? drawFlow(ctx, W, H) : drawGraph(ctx, W, H, vertical);
  if (mouse && t - lastFormula > 100) { showFormula(lay, mouse[0], mouse[1]); lastFormula = t; }
  requestAnimationFrame(frame);
}

// ── управление ──
canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mouse = [e.clientX - r.left, e.clientY - r.top]; });
canvas.addEventListener('pointerleave', () => { mouse = null; card.hidden = true; });
function setVariant(v) {
  variant = v; pulses.length = 0;
  try { history.replaceState(null, '', `#${v}`); } catch { /* превью */ }
  document.getElementById('vLabel').textContent = `${v} — ${VARIANTS[v]}`;
}
const keys = Object.keys(VARIANTS);
const shift = (d) => setVariant(keys[(keys.indexOf(variant) + d + keys.length) % keys.length]);
document.getElementById('vPrev').onclick = () => shift(-1);
document.getElementById('vNext').onclick = () => shift(1);
addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VARIANTS[v] && v !== variant) setVariant(v); });
addEventListener('keydown', (e) => { if (e.target.closest('input, textarea, select')) return; if (e.key === 'ArrowLeft') shift(-1); if (e.key === 'ArrowRight') shift(1); });
document.getElementById('pause').onclick = (e) => { paused = !paused; e.currentTarget.textContent = paused ? 'Ехать' : 'Пауза'; e.currentTarget.setAttribute('aria-pressed', String(paused)); };
const botSel = document.getElementById('bot');
botSel.innerHTML = BOTS.filter((b) => b.think !== 'step').map((b) => `<option>${b.name}</option>`).join('');
botSel.onchange = () => loadBot(botSel.value);

readPalette();
loadBot('Сквозняк');
setVariant(variant);
requestAnimationFrame(frame);
