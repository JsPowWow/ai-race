// Вид «Огонь в рамках»: один цвет на всё — где идёт сигнал, там разгорается. Рамки подписывают группы.
// Скин только рисует: что горит и насколько, ему даёт glow.ts, где что стоит — layout.ts.
// Рисуется каждый кадр, поэтому цвета заранее разложены по ступеням жара (readSkin), а не собираются в строки на лету.
import { getContrastRatio, mix, withAlpha } from '@reely/colors';
import { cssColor } from '../../engine/render.ts';
import type { Brain } from '../../engine/brain.ts';
import { addCurve, bezierAt, buttonCenterX, NOTE_W } from './layout.ts';
import type { Box, Layout, Point } from './layout.ts';
import type { Glow } from './glow.ts';
import type { Labels } from './labels.ts';

const MONO = '"JetBrains Mono", ui-monospace, monospace';
const SANS = 'Rubik, system-ui, sans-serif';
const HOT = 0.03; // связь теплее — рисуем её поверх дымки своим цветом и толщиной
const STEPS = 100; // ступеней жара в готовых цветах: глазу хватает, а строк — всего сотня

/** Светлая заливка: с чёрным она контрастнее, чем с белым, — значит, писать на ней тёмным */
const isLight = (color: string) => getContrastRatio(color, '#000000') > getContrastRatio(color, '#ffffff');
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
/** Номер ступени жара для t = 0…1 */
const step = (t: number) => Math.round(clamp01(t) * (STEPS - 1));

export type Skin = {
  bg: string; edge: string; ring: string; muted: string; inkDark: string; inkLight: string;
  frame: string; title: string; sub: string; press: string;
  node: string; fire: string[];
  /** готовые цвета по ступеням жара: огонь, горячая связь, лампочка и цифры на ней */
  fireCss: string[]; edgeCss: string[]; lampCss: string[]; lampInk: string[];
};

/** Шкала жара: t = 0 — угли, 1 — самый сильный сигнал */
function heat(fire: string[], t: number): string {
  const x = clamp01(t) * (fire.length - 1);
  const i = Math.min(fire.length - 2, Math.floor(x));
  return mix(fire[i], fire[i + 1], x - i);
}

/** Цвета из токенов --bb-* (app/styles/tokens.css) — перечитываем при смене темы */
export function readSkin(): Skin {
  const c = cssColor;
  const node = c('--bb-node');
  const fire = [0, 1, 2, 3, 4].map((n) => c(`--bb-fire-${n}`));
  const inkDark = c('--bb-ink-dark'), inkLight = c('--bb-ink-light');
  const levels = Array.from({ length: STEPS }, (_, s) => s / (STEPS - 1));
  const lamps = levels.map((h) => mix(node, heat(fire, h), h));
  return {
    bg: c('--bb-bg'), edge: c('--bb-edge'), ring: c('--bb-ring'), muted: c('--bb-muted'), inkDark, inkLight,
    frame: c('--bb-frame'), title: c('--bb-title'), sub: c('--bb-sub'), press: c('--bb-press'),
    node, fire,
    fireCss: levels.map((h) => heat(fire, h)),
    edgeCss: levels.map((h) => withAlpha(heat(fire, h), Math.min(1, 0.25 + h))),
    lampCss: lamps,
    lampInk: lamps.map((fill) => (isLight(fill) ? inkDark : inkLight)), // цвет цифр — по яркости заливки
  };
}

/** Всё, что нужно знать о сети в этот кадр */
export type Scene = {
  lay: Layout; brain: Brain; glow: Glow; labels: Labels;
  /** во сколько раз приближено: тонкие линии и подписи не должны толстеть вместе с зумом */
  zoom: number;
  /** зажатые сенсоры */
  pressed: Iterable<number>;
};

/** Нарисовать табло целиком */
export function drawFire(ctx: CanvasRenderingContext2D, scene: Scene, skin: Skin): void {
  const { lay, zoom } = scene;
  ctx.lineWidth = 1 / zoom; ctx.strokeStyle = skin.frame;
  for (const b of lay.boxes) ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  noteLoop(ctx, scene, skin);
  edges(ctx, scene, skin);
  pulses(ctx, scene, skin);
  frameTitles(ctx, scene, skin); // подписи — поверх нитей, чтобы их не перечёркивало
  inputLabels(ctx, scene, skin);
  lamps(ctx, scene, skin);
  buttons(ctx, scene, skin);
  notePills(ctx, scene, skin);
  ctx.lineWidth = 2.5 / zoom; ctx.strokeStyle = skin.press;
  for (const i of scene.pressed) { // зажатый сенсор — жёлтое кольцо «нажато»
    const [x, y] = lay.pos[0][i];
    ctx.beginPath(); ctx.arc(x, y, lay.r + 5, 0, Math.PI * 2); ctx.stroke();
  }
}

/** «Мгновение назад» — входы s1′…sn′: у них маленький кружок без числа, а связи — пунктиром */
const isPast = (lay: Layout, k: number, i: number) => k === 0 && i > lay.n && i <= 2 * lay.n;

const hotEdges: number[] = []; // переиспользуем между кадрами

/**
 * Связи: дымка — все тонко и одним путём, горячие — поверх, толще и ярче.
 * От «мгновения назад» — пунктиром: пунктир на табло — это память.
 */
function edges(ctx: CanvasRenderingContext2D, { lay, brain, glow, zoom }: Scene, skin: Skin): void {
  const dash = [4 / zoom, 3 / zoom];
  brain.layers.forEach((layer, k) => {
    const cols = lay.sizes[k + 1], heat = glow.edgeHeat[k], from = lay.pos[k], to = lay.pos[k + 1];
    /** Дымка: все связи одного вида — одним путём и одним stroke(), а не сотнями */
    const haze = (past: boolean) => {
      ctx.setLineDash(past ? dash : []);
      ctx.beginPath();
      layer.weights.forEach((row, i) => {
        if (isPast(lay, k, i) !== past) return;
        for (let j = 0; j < cols; j++) if (row[j] !== 0) addCurve(ctx, from[i], to[j]); // нулевая связь (ещё не нужная заметка) — её просто нет
      });
      ctx.stroke();
    };
    ctx.lineWidth = 0.6; ctx.strokeStyle = skin.edge;
    haze(false);
    if (k === 0) haze(true);
    hotEdges.length = 0;
    for (let e = 0; e < heat.length; e++) if (heat[e] > HOT) hotEdges.push(e);
    hotEdges.sort((a, b) => heat[a] - heat[b]); // самые горячие — сверху
    for (const e of hotEdges) {
      const i = Math.floor(e / cols), h = heat[e], past = isPast(lay, k, i);
      ctx.setLineDash(past ? dash : []);
      ctx.lineCap = past ? 'butt' : 'round';
      ctx.lineWidth = 0.9 + 3 * h; ctx.strokeStyle = skin.edgeCss[step(h)];
      ctx.beginPath(); addCurve(ctx, from[i], to[e % cols]); ctx.stroke();
    }
    ctx.lineCap = 'butt'; ctx.setLineDash([]);
  });
}

const dot: Point = [0, 0];

/** Импульсы бегут по сильным связям; хвост — точки по самой кривой, а не прямая хорда */
function pulses(ctx: CanvasRenderingContext2D, { lay, glow }: Scene, skin: Skin): void {
  for (const p of glow.pulses) {
    const a = lay.pos[p.k][p.i], b = lay.pos[p.k + 1][p.j];
    ctx.fillStyle = skin.fireCss[step(0.8 + 0.2 * Math.abs(p.v))];
    for (let n = 0; n < 4; n++) {
      const t = p.t - n * 0.03;
      if (t < 0) break;
      const [x, y] = bezierAt(a, b, t, dot);
      ctx.globalAlpha = Math.min(1, 1.6 - p.t) * (1 - n * 0.24); // у нейрона сигнал «вливается» и гаснет
      ctx.beginPath(); ctx.arc(x, y, 2 * (1 - n * 0.18), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** Лампочки входов и скрытых слоёв: заливка по силе сигнала, число внутри; у «мгновения назад» — маленький кружок без числа */
function lamps(ctx: CanvasRenderingContext2D, { lay, glow, zoom }: Scene, skin: Skin): void {
  ctx.font = `600 ${Math.min(12, Math.floor((2 * lay.r - 7) / 2.3))}px ${MONO}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let k = 0; k < lay.pos.length - 1; k++) {
    lay.pos[k].forEach(([x, y], i) => {
      const s = step(glow.nodeHeat[k][i]);
      ctx.beginPath(); ctx.fillStyle = skin.lampCss[s];
      if (isPast(lay, k, i)) { // видно, стало ли ярче или тусклее, чем сейчас
        ctx.arc(x, y, lay.rGhost, 0, Math.PI * 2); ctx.fill();
        ctx.setLineDash([2 / zoom, 2 / zoom]); ctx.lineWidth = 1.2; ctx.strokeStyle = skin.muted; ctx.stroke(); ctx.setLineDash([]);
        return;
      }
      ctx.arc(x, y, lay.r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = skin.ring; ctx.stroke();
      ctx.fillStyle = skin.lampInk[s];
      ctx.fillText(glow.readout[k][i], x, y + 1);
    });
  }
}

/** Кнопки пульта: ярче — сильнее жмёт; полоска снизу — точная шкала; победитель пары светится */
function buttons(ctx: CanvasRenderingContext2D, { lay, glow, labels }: Scene, skin: Skin): void {
  const last = lay.pos.length - 1, press = glow.nodeHeat[last];
  const wins = (i: number) => press[i] - press[i ^ 1] > 0.08; // газ/тормоз, влево/вправо: машина слушает разницу
  const { w, h } = lay.button, narrow = lay.narrow;
  const rr = narrow ? 12 : h / 2;
  for (let i = 0; i < lay.buttons; i++) {
    const [px, cy] = lay.pos[last][i], cx = buttonCenterX(lay, px);
    const x0 = cx - w / 2, y0 = cy - h / 2;
    const v = clamp01(press[i]), won = wins(i);
    const color = heat(skin.fire, 0.35 + 0.65 * v);
    const bg = mix(skin.node, color, v ** 2); // квадрат разводит 70 % и 90 % заметнее
    const light = isLight(bg);
    ctx.save();
    if (won) { ctx.shadowColor = withAlpha(heat(skin.fire, 1), 0.6); ctx.shadowBlur = 14; }
    ctx.beginPath(); ctx.roundRect(x0, y0, w, h, rr); ctx.fillStyle = bg; ctx.fill();
    ctx.restore();
    ctx.save(); ctx.clip(); // тот же контур: полоска-шкала не вылезает за скругления
    ctx.fillStyle = light ? 'rgb(0 0 0 / 0.35)' : withAlpha(color, 0.9);
    ctx.fillRect(x0, y0 + h - 4, w * v, 4);
    ctx.restore();
    ctx.lineWidth = won ? 1.5 : 1; ctx.strokeStyle = won ? color : skin.ring; ctx.stroke();
    ctx.fillStyle = light ? skin.inkDark : skin.inkLight; ctx.textBaseline = 'middle';
    const value = glow.readout[last][i];
    if (narrow) {
      ctx.textAlign = 'center';
      ctx.font = `600 11.5px ${SANS}`; ctx.fillText(labels.outputs[i], cx, cy - 8);
      ctx.font = `500 11px ${MONO}`; ctx.fillText(value, cx, cy + 8);
    } else {
      ctx.font = `600 13px ${SANS}`; ctx.textAlign = 'left'; ctx.fillText(labels.outputs[i], x0 + 14, cy);
      ctx.font = `500 12px ${MONO}`; ctx.textAlign = 'right'; ctx.fillText(value, x0 + w - 12, cy);
    }
  }
}

/** Заметки на выходе — маленькие плашки «m1 +.42»: это не кнопки, а то, что мозг запишет себе на следующий шаг */
function notePills(ctx: CanvasRenderingContext2D, { lay, glow, labels }: Scene, skin: Skin): void {
  const last = lay.pos.length - 1, hh = 22;
  ctx.font = `500 12px ${MONO}`; ctx.textBaseline = 'middle'; ctx.lineWidth = 1; ctx.strokeStyle = skin.ring;
  for (let i = lay.buttons; i < lay.pos[last].length; i++) {
    const [x, y] = lay.pos[last][i], x0 = x - 6;
    const s = step(glow.nodeHeat[last][i]);
    ctx.beginPath(); ctx.roundRect(x0, y - hh / 2, NOTE_W, hh, 6); ctx.fillStyle = skin.lampCss[s]; ctx.fill();
    ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = skin.lampInk[s];
    ctx.textAlign = 'left'; ctx.fillText(labels.outputs[i], x0 + 7, y);
    ctx.textAlign = 'right'; ctx.fillText(glow.readout[last][i], x0 + NOTE_W - 7, y);
  }
}

/** Подписи входов — одним столбцом слева от рамок; над первой парой кружков — «было» и «сейчас» */
function inputLabels(ctx: CanvasRenderingContext2D, { lay, labels }: Scene, skin: Skin): void {
  ctx.fillStyle = skin.muted; ctx.font = `500 12px ${MONO}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  lay.pos[0].forEach(([, y], i) => {
    if (!isPast(lay, 0, i)) ctx.fillText(labels.inputs[i], lay.inLeft - 6, y); // у «мгновения назад» своей подписи нет: это тот же сенсор
  });
  const [x, y] = lay.pos[0][0], hy = y - lay.r - 10;
  ctx.fillText(labels.past[0], x - lay.ghost + lay.rGhost - 1, hy);
  ctx.textAlign = 'center'; ctx.fillText(labels.past[1], x, hy);
}

/** Заголовки рамок: у пульта и заметок на выходе — по правому краю, у остальных — по левому */
function frameTitles(ctx: CanvasRenderingContext2D, { lay, zoom, labels }: Scene, skin: Skin): void {
  ctx.font = `600 ${12 * Math.min(1, 1 / Math.sqrt(zoom))}px ${MONO}`; ctx.textBaseline = 'alphabetic';
  for (const b of lay.boxes) {
    const t = labels.frames[b.id];
    if (!t) continue;
    const [t1, t2] = lay.narrow ? [t.narrow, ''] : t.wide;
    const right = b.id === 'buttons' || b.id === 'notesOut';
    const tx = right ? b.x1 : b.x0;
    ctx.textAlign = right ? 'right' : 'left';
    const w = Math.max(ctx.measureText(t1).width, ctx.measureText(t2).width) + 6;
    const rows = t2 ? 29 : 16;
    ctx.fillStyle = skin.bg; ctx.beginPath(); ctx.roundRect(right ? tx - w + 3 : tx - 3, b.y0 - rows - 2, w, rows, 4); ctx.fill(); // подложка
    ctx.fillStyle = skin.title; ctx.fillText(t1, tx, b.y0 - (t2 ? 18 : 5));
    if (t2) { ctx.fillStyle = skin.sub; ctx.fillText(t2, tx, b.y0 - 5); }
  }
}

/**
 * Петля заметок: с выхода обратно на вход — «что записал сейчас, прочитаешь на следующем шаге».
 * Это главная новая мысль табло, поэтому петля яркая, а подпись — под линией и не шире неё.
 */
function noteLoop(ctx: CanvasRenderingContext2D, { lay, zoom, labels }: Scene, skin: Skin): void {
  const from: Box = lay.notesOut, to: Box = lay.notesIn;
  const y = lay.H - lay.bottom / 2 - 6;
  const fx = (from.x0 + from.x1) / 2, ax = (to.x0 + to.x1) / 2, ay = to.y1 + 4;
  ctx.strokeStyle = skin.title; ctx.lineWidth = 2 / zoom; ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.beginPath();
  ctx.moveTo(fx, from.y1); ctx.lineTo(fx, y); ctx.lineTo(ax, y); ctx.lineTo(ax, ay + 6);
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = skin.title; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - 5, ay + 8); ctx.lineTo(ax + 5, ay + 8); ctx.fill(); // стрелка вверх
  ctx.font = `500 12px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = skin.sub; ctx.fillText(lay.narrow ? labels.loop.narrow : labels.loop.wide, (fx + ax) / 2, y + 5, fx - ax - 16);
}
