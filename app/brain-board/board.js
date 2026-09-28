// «Табло мозга»: живая схема сети. Снаружи — одна функция и три метода; внутри — раскладка, подписи,
// «теплота», импульсы, формула нейрона, зум и нажатие на сенсор. Форму мозга (сенсоры, слои, заметки)
// табло узнаёт из самого мозга: она одна на весь курс (engine/brain.js).
import { liveSize } from '../ui.js';
import { inputLabels, OUTPUT_LABELS, NOTES } from '../../engine/brain.js';
import { layout, buttonCenter } from './layout.js';
import { formulaHTML, SMOOTH } from './formula.js';
import { drawFire, readSkin } from './fire-skin.js';

const ATTACK = 0.04, DECAY = 0.3; // секунды: вспыхивает быстро, гаснет чуть медленнее
const MAX_ZOOM = 4;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Подписи табло для мозга этой формы. Рамки: [[обычная, пояснение], [для узкого экрана]] */
function labelsFor(sizes, act) {
  const n = (sizes[0] - 1 - NOTES) / 2;
  /** @type {Record<string, string[][]>} */
  const frames = {
    input: [[`СЕНСОРЫ s1–s${n} и скорость v`, 'пунктир — мгновение назад'], ['СЕНСОРЫ и v', '']],
    notesIn: [['ЗАМЕТКИ m1–m3', 'с прошлого шага'], ['ЗАМЕТКИ', '']],
    buttons: [['ПУЛЬТ', act.outName], ['ПУЛЬТ', '']],
    notesOut: [['ЗАМЕТКИ', 'на следующий шаг'], ['ЗАМЕТКИ', '']],
  };
  sizes.slice(1, -1).forEach((size, k) => { frames[`hidden${k}`] = [[`СЛОЙ · ${size} нейронов`, act.hiddenName], [`СЛОЙ · ${size}`, '']]; });
  return {
    n, inputs: inputLabels(n), outputs: OUTPUT_LABELS, frames,
    loop: ['заметки → на вход следующего шага', '→ на следующий шаг'],
    past: ['было', 'сейчас'], // над первой парой кружков
  };
}

/**
 * @param {{ canvas: HTMLCanvasElement, card: HTMLElement, zoomBar?: HTMLElement | null, brain: object,
 *   act?: typeof SMOOTH, onSensor?: ((i: number, down: boolean) => void) | null }} opts
 *   act — как подписать активации (SMOOTH или ANY_ACT из formula.js)
 *   onSensor — человек зажал (down) или отпустил кружок сенсора i; null — сенсоры не нажимаются
 */
export function createBrainBoard({ canvas, card, zoomBar = null, brain, act = SMOOTH, onSensor = null }) {
  const ctx = canvas.getContext('2d');
  const size = liveSize(canvas);
  const sizesOf = (b) => [b.layers[0].weights.length, ...b.layers.map((l) => l.biases.length)];
  let sizes = sizesOf(brain), labels = labelsFor(sizes, act);
  let skin = readSkin();
  let trace = null, shown = null, text = null, lastText = 0, lastFormula = 0;
  let lay = null, mouse = null, visible = true;
  const heatMap = new Map();
  const pulseList = [];
  const view = { s: 1, x: 0, y: 0 };
  let dt = 1 / 60;

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);

  /** «Теплота» связи или нейрона: к цели быстро вверх, медленно вниз */
  const heat = (key, target) => {
    const h = heatMap.get(key) ?? 0;
    const v = h + (target - h) * (1 - Math.exp(-dt / (target > h ? ATTACK : DECAY)));
    heatMap.set(key, v);
    return v;
  };

  /** Сигнал по связи: вход × вес, нормированный на самый сильный в слое (−1…1) */
  const signals = () => brain.layers.map((L, k) => {
    let max = 1e-6;
    const s = L.weights.map((row, i) => row.map((w) => { const v = trace[k][i] * w; max = Math.max(max, Math.abs(v)); return v; }));
    return s.map((row) => row.map((v) => v / max));
  });

  function updatePulses(sigs) {
    if (!reduceMotion.matches) {
      sigs.forEach((sig, k) => sig.forEach((row, i) => row.forEach((v, j) => {
        if (Math.abs(v) > 0.5 && Math.random() < Math.abs(v) * 0.012 && pulseList.length < 90) pulseList.push({ k, i, j, t: 0, v });
      })));
    }
    for (const p of pulseList) p.t += dt * 1.5;
    for (let n = pulseList.length - 1; n >= 0; n--) if (pulseList[n].t >= 1) pulseList.splice(n, 1);
  }

  /** Числа без дребезга: сглаживаем значения, а текст обновляем 10 раз в секунду */
  function smooth(now) {
    if (!shown) shown = trace.map((l) => [...l]);
    const a = 1 - Math.exp(-dt / 0.12);
    trace.forEach((l, k) => l.forEach((v, i) => { shown[k][i] += (v - shown[k][i]) * a; }));
    if (!text || now - lastText > 100) { text = shown.map((l) => [...l]); lastText = now; }
  }

  // ── указатель: формула при наведении, зажатие сенсора, зум ──
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toBoard = ([mx, my]) => [(mx - view.x) / view.s, (my - view.y) / view.s];
  const sensorAt = (m) => {
    if (!lay) return -1;
    const [x, y] = toBoard(m);
    // нажимаются только сенсоры «сейчас»: скорость, прошлое и заметки мозг считает сам
    return lay.pos[0].findIndex(([px, py], n) => n < labels.n && Math.hypot(x - px, y - py) < lay.r + 6);
  };
  function zoomAt(factor, cx, cy) {
    const s = Math.max(1, Math.min(MAX_ZOOM, view.s * factor));
    view.x = cx - ((cx - view.x) * s) / view.s; view.y = cy - ((cy - view.y) * s) / view.s; view.s = s;
    view.x = Math.min(0, Math.max(size.width - size.width * s, view.x));
    view.y = Math.min(0, Math.max(size.height - size.height * s, view.y));
    canvas.style.touchAction = s > 1 ? 'none' : 'pan-y'; // приближено — палец двигает схему, а не страницу
    zoomBar?.querySelector('[data-z=reset]')?.toggleAttribute('hidden', s === 1);
    zoomBar?.querySelector('[data-z=out]')?.toggleAttribute('disabled', s === 1); // дальше отдалять некуда
    lastFormula = 0;
  }
  const touches = new Map();
  let drag = null, pinch = null, holding = null;
  canvas.style.touchAction = 'pan-y';
  canvas.addEventListener('pointerdown', (e) => {
    const m = local(e);
    const i = onSensor ? sensorAt(m) : -1;
    if (i >= 0) { // держишь кружок сенсора — он «видит» стену, пока не отпустишь
      holding = { id: e.pointerId, i }; onSensor(i, true); canvas.setPointerCapture(e.pointerId); return;
    }
    mouse = m; lastFormula = 0; // на телефоне наведения нет — нейрон выбирается касанием
    touches.set(e.pointerId, m);
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s }; drag = null;
    } else if (view.s > 1) { drag = { at: m, x: view.x, y: view.y }; canvas.setPointerCapture(e.pointerId); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const m = local(e);
    mouse = m;
    canvas.style.cursor = onSensor && sensorAt(m) >= 0 ? 'pointer' : 'crosshair';
    if (touches.has(e.pointerId)) touches.set(e.pointerId, m);
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      zoomAt((pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1])) / pinch.d / view.s, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    } else if (drag) {
      view.x = drag.x + m[0] - drag.at[0]; view.y = drag.y + m[1] - drag.at[1]; zoomAt(1, 0, 0);
    }
  });
  const up = (e) => {
    if (holding?.id === e.pointerId) { onSensor(holding.i, false); holding = null; return; }
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!touches.size) drag = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { mouse = null; card.hidden = true; } });
  // колесо зумит только с Ctrl/⌘ — иначе страница перестанет прокручиваться
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.002), ...local(e));
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => zoomAt(view.s > 1 ? 1 / view.s : 2, ...local(e)));
  zoomBar?.addEventListener('click', (e) => {
    const z = /** @type {HTMLElement} */ (e.target).closest('button')?.dataset.z;
    const [cx, cy] = [size.width / 2, size.height / 2];
    if (z === 'in') zoomAt(1.5, cx, cy);
    if (z === 'out') zoomAt(1 / 1.5, cx, cy);
    if (z === 'reset') zoomAt(1 / view.s, cx, cy);
  });

  /** Формула нейрона под указателем: сбоку, если влезает между слоями, иначе — под или над ним */
  function placeFormula(now) {
    if (!mouse || now - lastFormula < 100) return;
    lastFormula = now;
    const [mx, my] = toBoard(mouse);
    /** @type {{ k: number, i: number, x: number, y: number } | null} */
    let hit = null;
    lay.pos.forEach((col, k) => col.forEach(([x, y], i) => {
      if (k === 0) return;
      const out = k === sizes.length - 1;
      const note = out && i >= lay.buttons;
      const [cx, cy, rad] = !out ? [x, y, lay.r + 12] : note ? [x + 24, y, 30] : [...buttonCenter(lay, [x, y]), lay.button.w / 2];
      if (Math.hypot(mx - cx, my - cy) < rad) hit = { k, i, x, y };
    }));
    if (!hit) { card.hidden = true; return; }
    card.innerHTML = formulaHTML(brain, trace, hit.k, hit.i, { inputNames: labels.inputs, outNames: labels.outputs, act });
    card.hidden = false;
    const cw = card.offsetWidth, ch = card.offsetHeight, W = size.width, H = size.height;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const sx = (x) => x * view.s + view.x;
    const hx = sx(hit.x), hy = hit.y * view.s + view.y, hr = lay.r * view.s;
    let left = null;
    const out = hit.k === sizes.length - 1;
    const room = out ? hx - 6 * view.s - (sx(lay.pos[hit.k - 1][0][0]) + hr) : sx(lay.pos[hit.k + 1][0][0]) - 6 * view.s - (hx + hr);
    if (room >= cw + 28) left = out ? hx - 6 * view.s - cw - 14 : hx + hr + 14;
    if (left !== null) {
      card.style.left = `${left}px`;
      card.style.top = `${clamp(hy - ch / 2, 8, H - ch - 8)}px`;
    } else {
      card.style.left = `${clamp(hx - cw / 2, 8, W - cw - 8)}px`;
      card.style.top = `${hy + hr + 12 + ch > H ? hy - hr - ch - 12 : hy + hr + 12}px`;
    }
  }

  return {
    /** Кадр: trace — значения всех слоёв на этом тике, pressed — зажатые сенсоры, dtSec — сколько прошло */
    frame(nextTrace, pressed, dtSec) {
      trace = nextTrace;
      dt = Math.min(0.05, dtSec);
      if (!visible || !trace || size.width === 0) return;
      const now = performance.now();
      smooth(now);
      const sigs = signals();
      updatePulses(sigs);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = size.width, H = size.height;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = skin.bg; ctx.fillRect(0, 0, W, H);
      ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y); // зум — одной матрицей
      lay = layout(sizes, labels.n, NOTES, W, H);
      drawFire(ctx, {
        lay, brain, sigs, heat, labels, zoom: view.s, pressed, pulses: pulseList,
        act: (k, i) => trace[k][i], text: (k, i) => text[k][i],
      }, skin);
      placeFormula(now);
    },
    /** После смены темы: перечитать цвета */
    readColors() { skin = readSkin(); },
    /** Показать другой мозг (лидер роя сменился). Новая форма — всё «остывает» и считается заново */
    setBrain(next, nextAct = act) {
      const nextSizes = sizesOf(next);
      if (nextSizes.join() !== sizes.join() || nextAct !== act) {
        sizes = nextSizes; act = nextAct; labels = labelsFor(sizes, act);
        heatMap.clear(); pulseList.length = 0; shown = null; text = null; card.hidden = true;
      }
      brain = next;
    },
  };
}
