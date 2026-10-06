// Джойстик на сенсорном экране (#25): один большой палец рулит всем — вверх газ, вниз тормоз, вбок руль,
// по диагонали — газ с поворотом. Стик появляется там, куда поставил палец, и возвращается в середину, когда отпустил.
// Он не рулит машиной сам: наклон превращается в те же стрелки, что на клавиатуре, — их ловит handleKey() студента.
// Виден только при пальце вместо мыши (pointer: coarse), иначе — кнопки пульта (стили — app/styles/teach.css).
import { listen } from '@reely/dommy-kit';
import { element } from './dom.ts';
import { press, touchPad } from './manual-drive.ts';

/** Наклон дальше этой доли радиуса — клавиша нажата: в середине — мёртвая зона, чтобы дрожь пальца не рулила */
const DEAD = 0.32;
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
type Key = typeof KEYS[number];
/** Засечка на основании, которая горит при этой стрелке */
const MARK: Record<Key, string> = { ArrowUp: 'is-gas', ArrowDown: 'is-brake', ArrowLeft: 'is-left', ArrowRight: 'is-right' };

/** Какие стрелки «нажаты» при наклоне (dx, dy) от центра стика радиусом r (y экрана — вниз) */
function stickKeys(dx: number, dy: number, r: number): Set<Key> {
  const on = new Set<Key>();
  if (dy < -DEAD * r) on.add('ArrowUp');
  if (dy > DEAD * r) on.add('ArrowDown');
  if (dx < -DEAD * r) on.add('ArrowLeft');
  if (dx > DEAD * r) on.add('ArrowRight');
  return on;
}

const zone = element('#stick');
const base = element('#stickBase');
const knob = element('#stickKnob');
let finger: number | null = null; // какой палец держит стик: второй палец не перехватывает
let held = new Set<Key>();

/** Отжать то, что отпустили, и нажать новое — в handleKey() только перемены, как у клавиатуры */
function hold(next: Set<Key>): void {
  for (const key of held) if (!next.has(key)) press(key, false);
  for (const key of next) if (!held.has(key)) press(key, true);
  held = next;
  for (const key of KEYS) base.classList.toggle(MARK[key], held.has(key)); // засечки по краю горят, как кнопки пульта
}

/** Поставить основание стика под палец — но не дальше края полосы, чтобы его было видно целиком */
function placeBase(x: number, y: number): void {
  const box = zone.getBoundingClientRect(), r = base.offsetWidth / 2;
  const cx = Math.max(r, Math.min(box.width - r, x - box.left));
  const cy = Math.max(r * 0.6, Math.min(box.height - r * 0.6, y - box.top));
  base.style.left = `${cx}px`; base.style.top = `${cy}px`;
}

function moveKnob(x: number, y: number): void {
  const box = base.getBoundingClientRect(), r = box.width / 2;
  let dx = x - (box.left + r), dy = y - (box.top + r);
  const d = Math.hypot(dx, dy), reach = r * 0.62; // дальше края основания ручка не уходит
  if (d > reach) { dx *= reach / d; dy *= reach / d; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  hold(stickKeys(dx, dy, reach));
}

function release(): void {
  finger = null;
  zone.classList.remove('on');
  knob.style.transform = '';
  base.style.left = ''; base.style.top = ''; // основание — обратно на место по умолчанию
  hold(new Set());
}

listen(zone, 'pointerdown', (e) => {
  if (finger !== null) return;
  e.preventDefault();
  finger = e.pointerId;
  zone.setPointerCapture(e.pointerId);
  zone.classList.add('on');
  touchPad();
  placeBase(e.clientX, e.clientY);
  moveKnob(e.clientX, e.clientY);
});
listen(zone, 'pointermove', (e) => {
  if (e.pointerId === finger) moveKnob(e.clientX, e.clientY);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  listen(zone, type, (e) => { if (e.pointerId === finger) release(); });
}
