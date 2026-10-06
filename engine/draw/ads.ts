// Реклама вдоль трассы: что напечатано на щитах и нарисовано на глухих торцах многоэтажек.
// Один рисунок на оба вида: вызывающий уже повернул холст так, что (0, 0) — левый верхний угол картинки,
// x — вправо вдоль щита или стены, y — вниз, а размер — w × h в пикселях трассы.
// Печать плоская, как наклейка из набора: заливки без градиентов и теней.
import { adAt, type Ad, type BoardSize, type Prop } from '../world/scenery.ts';
import { UI_FONT, type Palette } from './render.ts';

type Ctx = CanvasRenderingContext2D;

const MONO_FONT = '"JetBrains Mono", ui-monospace, monospace';
/** Цвета чужих марок — их собственные: от темы сайта они не зависят, как настоящий логотип на щите */
const BRAND = {
  rsInk: '#000000', rs: '#ffb749',   // RS School: чёрный круг, янтарные буквы
  reely: '#2c3e50', reely2: '#4fd1c5', // reely: тёмно-синий и бирюзовый
  dommy: '#3494e6', dommy2: '#ec6ead', // dommy: скобки синие, косая — розовая
  npm: '#cb3837', screen: '#1d1f24', screenInk: '#e9edf1',
  paper: '#f3f4f6', white: '#ffffff',
};

/** Поле и краска печати: у каждой марки свои, как на настоящих щитах; AI Race — тёмный пластик набора */
function inks(ad: Ad, p: Palette): { field: string; ink: string } {
  switch (ad) {
    case 'ai-race': return { field: p.bill, ink: p.billInk };
    case 'rs-school': return { field: BRAND.rs, ink: BRAND.rsInk };
    case 'signals': return { field: BRAND.reely, ink: BRAND.white };
    case 'npm': return { field: BRAND.screen, ink: BRAND.screenInk };
    default: return { field: BRAND.paper, ink: BRAND.reely };
  }
}

type Board = Extract<Prop, { kind: 'billboard' }>;

/**
 * Реклама на щите в тик tick. Живой щит меняет марку, как табло на гонках: старая уезжает вниз, новая заходит сверху.
 * moving = false (человек просит поменьше движения) — марка сменяется сразу, без езды
 */
export function paintBoard(ctx: Ctx, o: Board, w: number, h: number, p: Palette, tick: number, moving: boolean): void {
  const { now, next, slide } = adAt(o, tick);
  if (slide === 0 || !moving) { paintAd(ctx, slide < 0.5 ? now : next, o.size, w, h, p); return; }
  const y = h * slide * slide * (3 - 2 * slide); // плавно трогается и плавно встаёт
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.translate(0, y); paintAd(ctx, now, o.size, w, h, p);
  ctx.translate(0, -h); paintAd(ctx, next, o.size, w, h, p);
  ctx.fillStyle = 'rgb(0 0 0 / 0.35)'; ctx.fillRect(0, h - 0.8, w, 0.8); // щель между листами
  ctx.restore();
}

/** Реклама на щите любого размера: низкий баннер — свой рисунок, щиты побольше — общий */
export function paintAd(ctx: Ctx, ad: Ad, size: BoardSize, w: number, h: number, p: Palette): void {
  if (size === 'banner') paintBannerAd(ctx, ad, w, h, p);
  else paintBoardAd(ctx, ad, w, h, p);
}

/**
 * Баннер вдоль бордюра: низкая полоса, на ней марка повторяется — как на ограждении настоящей трассы:
 * с какого места ни глянь, имя видно целиком. Длинное имя (npm) — одно на всю полосу
 */
function paintBannerAd(ctx: Ctx, ad: Ad, w: number, h: number, p: Palette): void {
  const { field, ink } = ad === 'npm' ? { field: BRAND.screen, ink: BRAND.screenInk } : inks(ad, p);
  ctx.fillStyle = field; ctx.fillRect(0, 0, w, h);
  const [title] = words(ad);
  const cells = title.length > 10 ? 1 : Math.max(1, Math.floor(w / (h * 4.2)));
  const cw = w / cells, s = h * 0.62, gap = h * 0.3;
  const family = ad === 'npm' ? MONO_FONT : UI_FONT;
  for (let c = 0; c < cells; c++) {
    ctx.font = `700 ${h * 0.52}px ${family}`;
    const text = Math.min(ctx.measureText(title).width, cw - s - gap - h * 0.6);
    const x0 = c * cw + (cw - s - gap - text) / 2;
    mark(ctx, ad, x0, (h - s) / 2, s, p);
    ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    fitText(ctx, title, x0 + s + gap, h / 2 + h * 0.03, text, h * 0.52, 700, family);
    if (c > 0) { // тонкий разделитель между повторами
      ctx.globalAlpha *= 0.25; ctx.fillRect(c * cw - 0.3, h * 0.2, 0.6, h * 0.6); ctx.globalAlpha /= 0.25;
    }
  }
}

/** Щит: значок слева, надпись справа */
function paintBoardAd(ctx: Ctx, ad: Ad, w: number, h: number, p: Palette): void {
  if (ad === 'npm') { terminal(ctx, w, h); return; }
  const { field, ink } = inks(ad, p);
  ctx.fillStyle = field; ctx.fillRect(0, 0, w, h);
  const s = h * 0.62; // значок — квадрат с полями
  mark(ctx, ad, h * 0.2, (h - s) / 2, s, p);
  const [title, sub] = words(ad);
  const x = h * 0.2 + s + h * 0.18, room = w - x - h * 0.2;
  ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  fitText(ctx, title, x, sub ? h * 0.42 : h / 2, room, h * 0.38, 700, UI_FONT);
  if (sub) { ctx.globalAlpha *= 0.7; fitText(ctx, sub, x, h * 0.74, room, h * 0.2, 500, UI_FONT); ctx.globalAlpha /= 0.7; }
}

/** Роспись на торце дома: поле марки во всю стену, большой значок сверху, имя под ним — стена высокая и узкая */
export function paintMuralAd(ctx: Ctx, ad: Ad, w: number, h: number, p: Palette): void {
  const { field, ink } = inks(ad, p);
  ctx.fillStyle = field; ctx.fillRect(0, 0, w, h);
  const s = Math.min(w * 0.72, h * 0.6), top = Math.min(h * 0.16, w * 0.3);
  mark(ctx, ad, (w - s) / 2, top, s, p);
  const [title] = words(ad);
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  fitText(ctx, title, w / 2, top + s + w * 0.2, w * 0.86, w * 0.22, 800, UI_FONT);
}

/** Надпись рядом со значком: имя и строчка под ним */
function words(ad: Ad): [string, string?] {
  switch (ad) {
    case 'ai-race': return ['AI Race', 'учи свою машину'];
    case 'rs-school': return ['RS School', 'курсы JavaScript'];
    case 'reely': return ['reely', 'маленькие пакеты'];
    case 'dommy': return ['dommy', '@reely/dommy'];
    case 'signals': return ['signals', '@reely/signals'];
    case 'npm': return ['npm i @reely/dommy'];
  }
}

/** Значок марки в квадрате (x, y, s) */
function mark(ctx: Ctx, ad: Ad, x: number, y: number, s: number, p: Palette): void {
  const c = s / 2;
  ctx.save();
  ctx.translate(x, y);
  switch (ad) {
    case 'ai-race': { // клетчатый флаг 3 × 3 — как черта старта
      const k = s / 3;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        ctx.fillStyle = (i + j) % 2 ? p.checkLight : p.checkDark;
        ctx.fillRect(i * k, j * k, k, k);
      }
      break;
    }
    case 'rs-school': { // как у школы: чёрный круг и янтарные «RS»
      ctx.fillStyle = BRAND.rsInk; ctx.beginPath(); ctx.arc(c, c, c, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = BRAND.rs; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `800 ${s * 0.44}px ${UI_FONT}`; ctx.fillText('RS', c, c + s * 0.02);
      break;
    }
    case 'reely': { // катушка: скруглённая рамка и бирюзовая сердцевина
      ctx.fillStyle = BRAND.reely; ctx.beginPath(); ctx.roundRect(0, 0, s, s, s * 0.28); ctx.fill();
      ctx.fillStyle = BRAND.paper; ctx.beginPath(); ctx.roundRect(s * 0.22, s * 0.22, s * 0.56, s * 0.56, s * 0.16); ctx.fill();
      ctx.fillStyle = BRAND.reely2; ctx.beginPath(); ctx.roundRect(s * 0.34, s * 0.34, s * 0.32, s * 0.32, s * 0.1); ctx.fill();
      break;
    }
    case 'dommy': { // </> — разметка страницы
      ctx.lineWidth = s * 0.12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = BRAND.dommy; ctx.beginPath();
      ctx.moveTo(s * 0.3, s * 0.2); ctx.lineTo(s * 0.06, c); ctx.lineTo(s * 0.3, s * 0.8);
      ctx.moveTo(s * 0.7, s * 0.2); ctx.lineTo(s * 0.94, c); ctx.lineTo(s * 0.7, s * 0.8);
      ctx.stroke();
      ctx.strokeStyle = BRAND.dommy2; ctx.beginPath(); ctx.moveTo(s * 0.58, s * 0.16); ctx.lineTo(s * 0.42, s * 0.84); ctx.stroke();
      break;
    }
    case 'signals': { // три узла, связанные линиями: сигнал бежит по графу
      const nodes = [[0.2, 0.75], [0.5, 0.25], [0.8, 0.75]] as const;
      ctx.strokeStyle = BRAND.white; ctx.lineWidth = s * 0.08; ctx.beginPath(); // на тёмно-синем поле — белым
      ctx.moveTo(nodes[0][0] * s, nodes[0][1] * s); ctx.lineTo(nodes[1][0] * s, nodes[1][1] * s); ctx.lineTo(nodes[2][0] * s, nodes[2][1] * s);
      ctx.stroke();
      nodes.forEach(([u, v], i) => {
        ctx.fillStyle = i === 1 ? BRAND.reely2 : BRAND.white;
        ctx.beginPath(); ctx.arc(u * s, v * s, s * 0.16, 0, Math.PI * 2); ctx.fill();
      });
      break;
    }
    case 'npm': {
      ctx.fillStyle = BRAND.npm; ctx.fillRect(0, s * 0.2, s, s * 0.6);
      break;
    }
  }
  ctx.restore();
}

/** Щит-«терминал»: тёмный экран, красная плашка npm и команда установки */
function terminal(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = BRAND.screen; ctx.fillRect(0, 0, w, h);
  const tag = h * 0.9;
  ctx.fillStyle = BRAND.npm; ctx.fillRect(h * 0.2, h * 0.28, tag, h * 0.44);
  ctx.fillStyle = BRAND.screenInk; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  fitText(ctx, 'npm', h * 0.2 + tag / 2, h / 2, tag * 0.86, h * 0.3, 700, MONO_FONT);
  ctx.textAlign = 'left';
  const x = h * 0.2 + tag + h * 0.22;
  fitText(ctx, 'i @reely/dommy', x, h / 2, w - x - h * 0.15, h * 0.3, 500, MONO_FONT);
}

/** Текст не шире room: шрифт уменьшается, пока не влезет (на узком щите длинное имя не вылезет за край) */
function fitText(ctx: Ctx, text: string, x: number, y: number, room: number, size: number, weight: number, family: string): void {
  ctx.font = `${weight} ${size}px ${family}`;
  const wide = ctx.measureText(text).width;
  if (wide > room) ctx.font = `${weight} ${(size * room) / wide}px ${family}`;
  ctx.fillText(text, x, y);
}
