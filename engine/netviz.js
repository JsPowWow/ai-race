// Картинка нейросети: слои слева направо, цвет связи — знак веса, яркость — сила.
import { OUTPUT_LABELS } from './brain.js';

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/**
 * selected: { type: 'w', k, i, j } — связь i → j в слое k, или { type: 'b', k, j } — порог нейрона j.
 * hover: то же самое для подсветки под курсором.
 * Возвращает раскладку { xs, ys, r } — по ней страница понимает, куда щёлкнули.
 */
export function drawNetwork(canvas, brain, trace = null, selected = null, hover = null) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!brain) return null;

  const pos = css('--pos'), neg = css('--neg'), ink = css('--ink'), muted = css('--muted'), surface = css('--surface'), line = css('--line');
  const sizes = [brain.layers[0].weights.length, ...brain.layers.map((l) => l.biases.length)];
  const padL = 34, padR = 64, padY = 14;
  const maxN = Math.max(...sizes);
  const r = Math.max(4, Math.min(10, (ch - padY * 2) / maxN / 2.6));
  const xs = sizes.map((_, k) => padL + ((cw - padL - padR) * k) / (sizes.length - 1));
  const ys = sizes.map((n) => Array.from({ length: n }, (_, i) => (n === 1 ? ch / 2 : padY + r + ((ch - 2 * padY - 2 * r) * i) / (n - 1))));

  // связи
  brain.layers.forEach((layer, k) => {
    for (let i = 0; i < layer.weights.length; i++) {
      for (let j = 0; j < layer.weights[i].length; j++) {
        const w = layer.weights[i][j];
        ctx.globalAlpha = Math.min(1, Math.abs(w)) * 0.8 + 0.12;
        ctx.strokeStyle = w >= 0 ? pos : neg;
        ctx.lineWidth = 0.6 + Math.abs(w) * 1.6;
        ctx.beginPath();
        ctx.moveTo(xs[k], ys[k][i]);
        ctx.lineTo(xs[k + 1], ys[k + 1][j]);
        ctx.stroke();
      }
    }
  });
  ctx.globalAlpha = 1;

  // выбранная связь и связь под курсором
  const accent = css('--accent-strong');
  for (const [sel, width] of [[hover, 5], [selected, 7]]) {
    if (!sel || sel.type !== 'w' || !brain.layers[sel.k]) continue;
    const { k, i, j } = sel;
    if (ys[k][i] === undefined || ys[k + 1][j] === undefined) continue;
    ctx.globalAlpha = sel === selected ? 1 : 0.5;
    ctx.strokeStyle = accent;
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(xs[k], ys[k][i]); ctx.lineTo(xs[k + 1], ys[k + 1][j]); ctx.stroke();
    const w = brain.layers[k].weights[i][j];
    ctx.globalAlpha = 1;
    ctx.strokeStyle = w >= 0 ? pos : neg;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // нейроны
  ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  sizes.forEach((n, k) => {
    for (let i = 0; i < n; i++) {
      const x = xs[k], y = ys[k][i];
      const act = trace && trace[k] ? trace[k][i] : null;
      const bias = k > 0 ? brain.layers[k - 1].biases[i] : null;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = surface;
      ctx.fill();
      if (act !== null && Number.isFinite(act)) {
        ctx.globalAlpha = Math.min(1, Math.abs(act));
        ctx.fillStyle = act >= 0 ? css('--accent') : neg;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = bias === null ? line : bias >= 0 ? pos : neg;
      ctx.stroke();
      const isSel = (sel) => sel && sel.type === 'b' && sel.k === k - 1 && sel.j === i;
      if (isSel(selected) || isSel(hover)) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = accent;
        ctx.lineWidth = isSel(selected) ? 3 : 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = muted;
      if (k === 0) {
        ctx.textAlign = 'right';
        ctx.fillText(i === n - 1 ? 'v' : `с${i + 1}`, x - r - 5, y);
      }
      if (k === sizes.length - 1) {
        ctx.textAlign = 'left';
        ctx.fillStyle = act !== null && act > 0.5 ? ink : muted;
        ctx.fillText(OUTPUT_LABELS[i] ?? `в${i + 1}`, x + r + 6, y);
      }
    }
  });
  return { xs, ys, r };
}

/** Что под курсором: нейрон (порог) или связь (вес). x, y — в CSS-пикселях холста. */
export function hitNetwork(layout, brain, x, y) {
  if (!layout || !brain) return null;
  const { xs, ys, r } = layout;
  // сначала нейроны скрытых и выходного слоёв (у входов порога нет)
  for (let k = 1; k < ys.length; k++) {
    for (let i = 0; i < ys[k].length; i++) {
      if (Math.hypot(x - xs[k], y - ys[k][i]) <= r + 4) return { type: 'b', k: k - 1, j: i };
    }
  }
  // потом ближайшая связь
  let best = null, bd = 6;
  for (let k = 0; k < brain.layers.length; k++) {
    if (x < xs[k] - 2 || x > xs[k + 1] + 2) continue;
    for (let i = 0; i < ys[k].length; i++) {
      for (let j = 0; j < ys[k + 1].length; j++) {
        const d = distToSegment(x, y, xs[k], ys[k][i], xs[k + 1], ys[k + 1][j]);
        if (d < bd) { bd = d; best = { type: 'w', k, i, j }; }
      }
    }
  }
  return best;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/** График обучения: лучший и медианный фитнес по поколениям */
export function drawChart(canvas, history) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const muted = css('--muted'), line = css('--line'), accent = css('--accent'), good = css('--good');
  ctx.font = '11px "JetBrains Mono", ui-monospace, monospace';
  const padL = 44, padR = 10, padT = 10, padB = 20;
  const W = cw - padL - padR, H = ch - padT - padB;
  if (!history.length) {
    ctx.fillStyle = muted;
    ctx.textAlign = 'center';
    ctx.fillText('График появится после первого поколения', cw / 2, ch / 2);
    return;
  }
  const vals = history.flatMap((h) => [h.best, h.median]).filter(Number.isFinite);
  const max = niceMax(Math.max(1, ...vals));
  const n = history.length;
  const x = (i) => padL + (n === 1 ? W / 2 : (W * i) / (n - 1));
  const y = (v) => padT + H - (H * Math.max(0, v)) / max;

  ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4, yy = y(v);
    ctx.globalAlpha = k === 0 ? 1 : 0.5;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(cw - padR, yy); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(short(v), padL - 6, yy);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const step = Math.max(1, Math.ceil(n / 6));
  for (let i = 0; i < n; i += step) ctx.fillText(String(history[i].gen), x(i), padT + H + 5);

  const series = (key, color, width, dash) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
    ctx.beginPath();
    history.forEach((h, i) => { const v = Number.isFinite(h[key]) ? h[key] : 0; i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)); });
    ctx.stroke(); ctx.setLineDash([]);
  };
  series('median', muted, 1.5, [4, 4]);
  series('best', accent, 2.5, []);
  // отметки финишей
  history.forEach((h, i) => {
    if (!h.finished) return;
    ctx.fillStyle = good;
    ctx.beginPath(); ctx.arc(x(i), y(h.best), 3.5, 0, Math.PI * 2); ctx.fill();
  });
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
function short(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e4) return Math.round(v / 1e3) + 'k';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(Math.round(v));
}
