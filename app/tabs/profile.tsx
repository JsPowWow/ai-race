// Вкладка «Профиль»: гараж, облик машины и сборка за очки (#19).
// Панель справа — на @reely/dommy (#20): каждая часть сама обновляется от событий. Трасса и табло мозга —
// холсты: их рисует кадровый цикл (frame), а машина пересаживается, как только поменялись сборка на экране или мозг.
import { effect, mount } from '@reely/dommy';
import { getTrainingTrack } from '../../engine/world/track.ts';
import { Car } from '../../engine/world/car.ts';
import { checkBrain, createBrain } from '../../engine/net/brain.ts';
import type { Brain } from '../../engine/net/brain.ts';
import { withTraffic } from '../../engine/world/traffic.ts';
import { state, sizesOf, thinkFn } from '../state.ts';
import { live } from '../student-code.ts';
import { drawRide, trafficOn, setHud } from '../stage.ts';
import { createBrainBoard, type BrainBoard } from '../brain-board/board.ts';
import { SMOOTH, ANY_ACT } from '../brain-board/formula.ts';
import { element } from '../dom.ts';
import { Garage } from './profile-garage.tsx';
import { Look } from './profile-look.tsx';
import { Build, draft, shown, champion } from './profile-build.tsx';

mount(element('#profilePanel'), () => (
  <>
    <Garage />
    <Look />
    <Build />
  </>
));

const track = withTraffic(getTrainingTrack('warmup'), 'all');

/** Обученный мозг, если он подходит к сборке на экране, иначе null */
function fittingBrain(): Brain | null {
  const brain: Brain | null = champion();
  return brain && !checkBrain(brain, sizesOf(shown())) ? brain : null;
}

/** Машина со сборкой на экране: ездит обученный мозг, если он к ней подходит, иначе стоит с новыми сенсорами */
const newCar = (): Car => {
  const brain = fittingBrain();
  return new Car(track, { sensors: shown().sensors, ...(brain ? { brain, think: thinkFn(shown().think) } : {}) });
};
let car: Car;
effect(() => {
  car = newCar(); // поменяли сборку (или черновик) или мозг — пересаживаемся
});

export const profileTab = {
  enter() {
    car = newCar();
  },
  frame() {
    if (car.done) car = newCar();
    car.step(track, Infinity, trafficOn(track, car.ticks));
    drawRide(track, { me: { car, color: state.profile.color }, traffic: trafficOn(track, car.ticks), tick: car.ticks });
    showBrain();
    const readings = car.readings.map((v) => v.toFixed(2));
    const front = car.sensors.count;
    setHud([
      car.brain ? `едет <b class="word">мозг</b>${draft.peek() ? ' · черновик' : ''}` : state.champion ? 'черновик: мозг не подходит — стоит' : 'мозг не обучен — машина стоит',
      `вперёд <b>${readings.slice(0, front).join(' ')}</b>`,
      ...(readings.length > front ? [`назад <b>${readings.slice(front).join(' ')}</b>`] : []),
    ]);
  },
};

// ── табло мозга: какая сеть получится с этой сборкой и что она думает прямо сейчас ──

const BRAIN_TRAINED = 'Горит то, что мозг видит и жмёт прямо сейчас. Меняешь сенсоры или слои — табло меняется сразу.';
const BRAIN_EMPTY = 'Так выглядит сеть с этой сборкой. Мозг под неё ещё не обучен: все связи — нули, горят только входы. Научи его на «Я учу» или «Учится само».';
const fold = element<HTMLDetailsElement>('.profile-brain');
const hint = element('#profileBrainHint');
const emptyBrains = new Map<string, Brain>(); // форма → пустой мозг (чтобы не создавать каждый кадр)
let board: BrainBoard | null = null;
let boardAt = performance.now();

function showBrain(): void {
  if (!fold.open || !car.lastInputs) return; // свёрнуто или машина ещё не посмотрела вокруг
  const sizes = sizesOf(shown());
  const key = sizes.join('-');
  let empty = emptyBrains.get(key);
  if (!empty) emptyBrains.set(key, (empty = createBrain(sizes, () => 0.5))); // 0.5 → все веса 0
  const brain = fittingBrain() ?? empty;
  const text = brain === state.champion ? BRAIN_TRAINED : BRAIN_EMPTY;
  if (hint.textContent !== text) hint.textContent = text;
  const act = shown().think === 'smooth' ? SMOOTH : ANY_ACT;
  board ??= createBrainBoard({ canvas: element<HTMLCanvasElement>('#profileBoard'), card: element('#profileFormula'), zoomBar: element<HTMLElement>('.profile-brain .zoom'), brain, act });
  board.setBrain(brain, act);
  const feed = live.think.feedForward;
  feed.lastTrace = null;
  thinkFn(shown().think)(car.lastInputs, brain); // feedForward запишет, что посчитал каждый слой
  const trace = feed.lastTrace as number[][] | null; // TypeScript не знает, что вызов выше его поменял
  const now = performance.now();
  if (trace) board.frame(trace, [], (now - boardAt) / 1000);
  boardAt = now;
}

export const redrawProfileBrain = () => board?.readColors();
if (matchMedia('(max-width: 700px)').matches) fold.open = false;
