// «Табло мозга»: живая схема сети. Снаружи — одна функция и три метода; внутри — раскладка (layout.ts),
// подписи (labels.ts), «теплота» и импульсы (glow.ts), рисунок (fire-skin.ts), формула нейрона (formula-card.tsx),
// зум и нажатие на сенсор. Форму мозга (сенсоры, слои, заметки) табло узнаёт из самого мозга:
// она одна на весь курс (engine/net/brain.ts).
import { effect, mount, signal } from '@reely/dommy';
import { brainSizes, NOTES } from '../../engine/net/brain.ts';
import type { Brain } from '../../engine/net/brain.ts';
import { liveSize, calm } from '../ui.ts';
import { layout, neuronAt, sensorAt } from './layout.ts';
import type { Layout } from './layout.ts';
import { labelsFor } from './labels.ts';
import { neuronFormula, SMOOTH } from './formula.ts';
import type { Act, Formula } from './formula.ts';
import { createGlow, stepGlow } from './glow.ts';
import type { Trace } from './glow.ts';
import { drawFire, readSkin } from './fire-skin.ts';
import { FormulaCard } from './formula-card.tsx';
import { ZoomButtons } from './zoom-buttons.tsx';
import type { ZoomStep } from './zoom-buttons.tsx';
import { listen } from '@reely/dommy-kit';

const MAX_ZOOM = 4;
const FORMULA_MS = 100; // формула под указателем обновляется 10 раз в секунду, как числа у узлов

type Spot = [x: number, y: number];

export type BrainBoardOptions = {
  canvas: HTMLCanvasElement;
  /** пустой контейнер для формулы нейрона (.formula поверх холста) */
  card: HTMLElement;
  /** контейнер .zoom для кнопок масштаба; нет — масштаб только жестами, колесом с Ctrl и двойным щелчком */
  zoomBar?: HTMLElement | null;
  brain: Brain;
  /** как подписать активации: SMOOTH или ANY_ACT из formula.ts */
  act?: Act;
  /** человек зажал (down) или отпустил кружок сенсора i; null — сенсоры не нажимаются */
  onSensor?: ((i: number, down: boolean) => void) | null;
};

export type BrainBoard = {
  /**
   * Кадр: trace — значения всех слоёв на этом тике (читается только во время вызова — копировать не нужно),
   * pressed — зажатые сенсоры, dtSec — сколько секунд прошло с прошлого кадра
   */
  frame(trace: Trace, pressed: Iterable<number>, dtSec: number): void;
  /** После смены темы: перечитать цвета */
  readColors(): void;
  /** Показать другой мозг (лидер роя сменился). Новая форма — всё «остывает» и считается заново */
  setBrain(next: Brain, nextAct?: Act): void;
};

export function createBrainBoard({ canvas, card, zoomBar = null, brain, act = SMOOTH, onSensor = null }: BrainBoardOptions): BrainBoard {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('холст табло не рисует 2D');
  const size: { width: number; height: number } = liveSize(canvas);
  let sizes = brainSizes(brain), labels = labelsFor(sizes, act), glow = createGlow(sizes);
  let skin = readSkin();
  let lastLayout: Layout | null = null;
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);

  /** Раскладка пересчитывается, только когда поменялись размер холста или форма мозга */
  const layoutFor = (W: number, H: number): Layout =>
    lastLayout?.W === W && lastLayout.H === H ? lastLayout : (lastLayout = layout(sizes, labels.n, NOTES, W, H));

  // ── формула нейрона под указателем ──
  const formula = signal<Formula | null>(null);
  mount(card, () => FormulaCard({ formula })); // компонент — обычная функция: табло обходится без JSX
  effect(() => { card.hidden = !formula.value; });
  let mouse: Spot | null = null, formulaAt = -Infinity;

  // ── масштаб: вся схема рисуется через одну матрицу (s — во сколько раз, x, y — сдвиг) ──
  const view = { s: 1, x: 0, y: 0 };
  const zoom = signal(1);
  /** Приблизить в factor раз вокруг точки (cx, cy) холста; схема не уезжает за края */
  function zoomAt(factor: number, cx: number, cy: number): void {
    const s = Math.max(1, Math.min(MAX_ZOOM, view.s * factor));
    view.x = cx - ((cx - view.x) * s) / view.s; view.y = cy - ((cy - view.y) * s) / view.s; view.s = s;
    view.x = Math.min(0, Math.max(size.width - size.width * s, view.x));
    view.y = Math.min(0, Math.max(size.height - size.height * s, view.y));
    canvas.style.touchAction = s > 1 ? 'none' : 'pan-y'; // приближено — палец двигает схему, а не страницу
    zoom.value = s;
    formulaAt = -Infinity; // карточка переезжает вслед за нейроном
  }
  if (zoomBar) {
    const factor: Record<ZoomStep, () => number> = { in: () => 1.5, out: () => 1 / 1.5, reset: () => 1 / view.s };
    zoomBar.replaceChildren(); // кнопки рисует табло: старая разметка с готовыми кнопками тоже подойдёт
    mount(zoomBar, () => ZoomButtons({ zoom, max: MAX_ZOOM, onZoom: (how) => zoomAt(factor[how](), size.width / 2, size.height / 2) }));
  }

  listenPointer();

  /** Указатель: формула при наведении (на телефоне — касанием), зажатие сенсора, перетаскивание, щипок, колесо с Ctrl */
  function listenPointer(): void {
    const local = (e: MouseEvent): Spot => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const sensorUnder = ([mx, my]: Spot) => (onSensor && lastLayout ? sensorAt(lastLayout, (mx - view.x) / view.s, (my - view.y) / view.s) : -1);
    const touches = new Map<number, Spot>();
    let drag: { at: Spot; x: number; y: number } | null = null;
    let pinch: { d: number; s: number } | null = null;
    let holding: { id: number; i: number } | null = null;
    /** Два пальца: расстояние между ними и середина */
    const spread = () => {
      const [a, b] = [...touches.values()];
      return { d: Math.hypot(a[0] - b[0], a[1] - b[1]), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 };
    };

    canvas.style.touchAction = 'pan-y';
    listen(canvas, 'pointerdown', (e) => {
      const m = local(e);
      const i = sensorUnder(m);
      if (onSensor && i >= 0) { // держишь кружок сенсора — он «видит» стену, пока не отпустишь
        holding = { id: e.pointerId, i }; onSensor(i, true); canvas.setPointerCapture(e.pointerId); return;
      }
      mouse = m; formulaAt = -Infinity; // на телефоне наведения нет — нейрон выбирается касанием, и формула — сразу
      touches.set(e.pointerId, m);
      if (touches.size === 2) { pinch = { d: spread().d, s: view.s }; drag = null; }
      else if (view.s > 1) { drag = { at: m, x: view.x, y: view.y }; canvas.setPointerCapture(e.pointerId); }
    });
    listen(canvas, 'pointermove', (e) => {
      const m = local(e);
      mouse = m;
      canvas.style.cursor = sensorUnder(m) >= 0 ? 'pointer' : 'crosshair';
      if (touches.has(e.pointerId)) touches.set(e.pointerId, m);
      if (pinch && touches.size === 2) {
        const { d, cx, cy } = spread();
        zoomAt((pinch.s * d) / pinch.d / view.s, cx, cy);
      } else if (drag) {
        view.x = drag.x + m[0] - drag.at[0]; view.y = drag.y + m[1] - drag.at[1];
        zoomAt(1, 0, 0); // масштаб тот же — только не выпустить схему за края
      }
    });
    const up = (e: PointerEvent) => {
      if (holding?.id === e.pointerId) { onSensor?.(holding.i, false); holding = null; return; }
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      if (!touches.size) drag = null;
    };
    listen(canvas, 'pointerup', up);
    listen(canvas, 'pointercancel', up);
    listen(canvas, 'lostpointercapture', up); // палец увёл другой элемент — тоже отпустили
    listen(canvas, 'pointerleave', (e) => { if (e.pointerType === 'mouse') { mouse = null; formula.value = null; } });
    // колесо зумит только с Ctrl/⌘ — иначе страница перестанет прокручиваться
    listen(canvas, 'wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.002), ...local(e));
    }, { passive: false });
    listen(canvas, 'dblclick', (e) => zoomAt(view.s > 1 ? 1 / view.s : 2, ...local(e)));
  }

  /** Формула нейрона под указателем: сбоку, если влезает между слоями, иначе — под или над ним */
  function showFormula(now: number, trace: Trace, lay: Layout): void {
    if (!mouse || now - formulaAt < FORMULA_MS) return;
    formulaAt = now;
    const hit = neuronAt(lay, (mouse[0] - view.x) / view.s, (mouse[1] - view.y) / view.s);
    formula.value = hit && neuronFormula(brain, trace, hit.k, hit.i, { inputNames: labels.inputs, outNames: labels.outputs, act });
    if (!hit) return;
    // в карточке уже новый текст (dommy обновляет сразу) — можно мерить
    const cw = card.offsetWidth, ch = card.offsetHeight, W = size.width, H = size.height;
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const toScreen = (x: number) => x * view.s + view.x;
    const [nx, ny] = lay.pos[hit.k][hit.i];
    const hx = toScreen(nx), hy = ny * view.s + view.y, hr = lay.r * view.s;
    const out = hit.k === lay.pos.length - 1;
    // место между нейроном и соседним слоем: у выходов — слева, у скрытых — справа
    const room = out ? hx - 6 * view.s - (toScreen(lay.pos[hit.k - 1][0][0]) + hr) : toScreen(lay.pos[hit.k + 1][0][0]) - 6 * view.s - (hx + hr);
    if (room >= cw + 28) {
      card.style.left = `${out ? hx - 6 * view.s - cw - 14 : hx + hr + 14}px`;
      card.style.top = `${clamp(hy - ch / 2, 8, H - ch - 8)}px`;
    } else {
      card.style.left = `${clamp(hx - cw / 2, 8, W - cw - 8)}px`;
      card.style.top = `${hy + hr + 12 + ch > H ? hy - hr - ch - 12 : hy + hr + 12}px`;
    }
  }

  return {
    frame(trace, pressed, dtSec) {
      const W = size.width, H = size.height;
      if (!visible || W === 0 || trace.length !== sizes.length) return; // не видно — не рисуем; trace другой формы — не от этого мозга
      const now = performance.now();
      stepGlow(glow, brain, trace, Math.min(0.05, dtSec), now, !calm.value);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = skin.bg; ctx.fillRect(0, 0, W, H);
      ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y); // зум — одной матрицей
      const lay = layoutFor(W, H);
      drawFire(ctx, { lay, brain, glow, labels, zoom: view.s, pressed }, skin);
      showFormula(now, trace, lay);
    },
    readColors() { skin = readSkin(); },
    setBrain(next, nextAct = act) {
      // зовут каждый кадр, а форма меняется редко: сначала дешёвая проверка, без новых массивов
      if (nextAct !== act || !hasShape(next, sizes)) {
        sizes = brainSizes(next); act = nextAct; labels = labelsFor(sizes, act);
        glow = createGlow(sizes); lastLayout = null; formula.value = null;
      }
      brain = next;
    },
  };
}

/** У мозга слои таких размеров? */
function hasShape(brain: Brain, sizes: readonly number[]): boolean {
  const { layers } = brain;
  if (layers.length !== sizes.length - 1 || layers[0].weights.length !== sizes[0]) return false;
  for (let k = 0; k < layers.length; k++) if (layers[k].biases.length !== sizes[k + 1]) return false;
  return true;
}
