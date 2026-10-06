// Вкладка «Я учу» (урок 1): ездишь сам — заезды записываются, мозг учится повторять за тобой.
// Панель справа и полоска под трассой — на @reely/dommy (#20): «Мои заезды» и обучение (teach-runs, teach-learn),
// блок «Мозг» с «Историей» и «Мозг под микроскопом» (network-editor). Трасса — холст: машину двигает
// и рисует кадровый цикл (frame), он же учит мозг по эпохе за кадр.
import { mount, signal } from '@reely/dommy';
import type { Track } from '../../engine/track.ts';
import { Car, carReport } from '../../engine/car.ts';
import type { CarStatus } from '../../engine/car.ts';
import { sampleOf, worthLearning } from '../../engine/imitation.ts';
import type { Sample } from '../../engine/imitation.ts';
import type { Trace } from '../../engine/netviz.ts';
import { cssColor } from '../../engine/render.ts';
import { state, thinkFn, on, emit } from '../state.ts';
import { live } from '../student-code.ts';
import { runs, addRun, sampleCount, MAX_SAMPLES, type RunStatus } from '../runs.ts';
import { steerWith } from '../manual-drive.ts';
import { drawScene, drawCockpitScene, setStageLabel, paintCar, trafficOn, setHud, lapText, showBanner } from '../stage.ts';
import { secs, pct } from '../ui.ts';
import { element } from '../dom.ts';
import { BrainLibrary } from '../components/brain-library.tsx';
import { DriveBar } from './teach-toolbar.tsx';
import type { Mode } from './teach-toolbar.tsx';
import { Runs } from './teach-runs.tsx';
import { trainStep, redrawLoss, lessonTrack, duel } from './teach-learn.tsx';
import { createMicroscope } from './network-editor.tsx';
import { Tries } from '../components/tries.tsx';
import { makeGhost, stepGhost, paintGhost, ghostGap, type Ghost } from './teach-ghost.ts';
import { controlNames } from '../variants.ts';
import { ViewSwitch, cockpitOn } from './teach-view.tsx';

/** После финиша или аварии машина постоит столько (мс) — видно, чем кончилось, — и поедет заново */
const RESTART_DELAY = 1100;

const mode = signal<Mode>('me');
let track: Track;
let car: Car;
/** Кто едет рядом полупрозрачным: мозг, пока рулишь ты, или твой лучший заезд, пока рулит мозг */
let ghost: Ghost | null = null;
let restartAt = 0;
let recording: Sample[] | null = null; // идущий заезд — начинается, как только машина тронулась
let trace: Trace | null = null; // что «горит» в сети на этом кадре (когда едет мозг)

const microscope = createMicroscope({
  trace: () => (mode.peek() === 'brain' ? trace : null),
  onEdit: () => (mode.peek() === 'brain' ? resetCar() : setMode('brain')), // поправил вес — смотри, как мозг едет теперь
});

mount(element('#teachView'), () => <ViewSwitch />);
mount(element('#teachToolbar'), () => <DriveBar mode={() => mode.value} onMode={setMode} onRestart={resetCar} />);
mount(element('#teachTries'), () => (
  <Tries source="teach" empty="Научи мозг на своих заездах: новый вариант проедет контрольный заезд против твоего мозга, и будет видно, стал ли он лучше."
    control={() => controlNames(lessonTrack())} duel={duel} />
));
mount(element('#teachPanel'), () => (
  <>
    <h2 className="parts-title">Детали набора</h2>
    <Runs />
    <section className="block library"><BrainLibrary /></section>
    <microscope.View />
  </>
));

export const teachTab = {
  enter() {
    resetCar();
    microscope.render();
  },
  frame(frameNo: number) {
    const learned = trainStep();
    if (learned) {
      if (learned.taken) setMode('brain'); // поехал новый мозг — смотри, как он едет
      showBanner(learned.text, 4200);
    }
    drive();
    if (mode.peek() === 'brain' && frameNo % 3 === 0) microscope.render();
  },
};

export { redrawLoss };
export const renderNetwork = () => microscope.render();

// ── машина ──

/** Шаг машины и кадр трассы */
function drive(): void {
  let traffic = trafficOn(track, car.ticks);
  // рулишь сам — машина ждёт на старте, пока не нажмёшь что-нибудь: иначе заглохнет, пока тянешься к клавишам
  const c = car.controls;
  const waiting = mode.peek() === 'me' && car.ticks === 0 && !(c.gas || c.brake || c.left || c.right);
  if (car.done) {
    if (!restartAt) {
      restartAt = performance.now() + RESTART_DELAY;
      finishRun();
    } else if (performance.now() > restartAt) resetCar();
  } else if (!waiting) {
    const byBrain = mode.peek() === 'brain';
    if (byBrain) live.think.feedForward.lastTrace = null;
    car.step(track, Infinity, traffic);
    trace = byBrain ? (live.think.feedForward.lastTrace ?? null) : null;
    stepGhost(ghost, track, traffic, car); // с тем же трафиком, что видела твоя машина на этом тике
    if (!byBrain) record();
    traffic = trafficOn(track, car.ticks);
  }
  const me = mode.peek() === 'me';
  const color = me ? state.profile.color : cssColor('--brain'); // едет мозг — машина синяя, цвета мозга
  if (cockpitOn()) {
    drawCockpitScene(track, {
      me: { car, color }, traffic, tick: car.ticks,
      ghost: ghost && { car: ghost.car, color: ghost.color(), alpha: 0.4, label: ghost.label },
    });
    setStageLabel('Трасса, вид из машины');
  } else {
    drawScene(track, { camera: 'follow', follow: car, traffic, tick: car.ticks });
    paintGhost(ghost);
    paintCar(car, { color, sensors: true, number: 1 });
  }
  setHud([
    me ? (recording ? `<b class="rec">запись</b> ${recording.length}` : 'рулишь <b class="word">ты</b>') : 'рулит <b class="word">мозг</b>',
    `скорость <b>${car.speed.toFixed(1)}</b>`,
    lapText(track, car.bestS),
    `пройдено <b>${pct(carReport(car, track).progressPct)}</b>`,
    `время <b>${secs(car.ticks)}</b>`,
    ghostGap(ghost),
  ].filter(Boolean));
}

/** Машина на старт. Недоеханный заезд записываем как «прервал» */
function resetCar(): void {
  if (recording && car && !car.done) finishRun({ interrupted: true });
  track = lessonTrack();
  const byBrain = mode.peek() === 'brain' && state.champion;
  car = new Car(track, { ...(byBrain ? { brain: state.champion, think: thinkFn() } : {}), sensors: state.config.sensors });
  ghost = makeGhost(track, mode.peek() === 'brain');
  restartAt = 0;
  recording = null;
  trace = null;
  steerWith(mode.peek() === 'me' ? car.controls : null, { onTouch: () => setMode('me') }); // тронул пульт — рулишь ты
}

function setMode(next: Mode): void {
  if (next === 'brain' && !state.champion) {
    showBanner('Мозга пока нет: запиши пару заездов и нажми «Учить на заездах» — или поправь веса в «Мозге под микроскопом»', 3200);
    next = 'me';
  }
  mode.value = next;
  // на другой вкладке машину не трогаем: там рулить руками нельзя (steerWith), а вернёмся — enter() поставит её заново
  if (state.tab === 'teach') resetCar();
}

// ── запись: заезд начинается, когда машина тронулась, и заканчивается финишем или аварией ──

function record(): void {
  const sample = sampleOf(car);
  if (!worthLearning(sample)) return; // стоишь и ничего не жмёшь — не учим
  recording ??= [];
  recording.push(sample);
  if (sampleCount() + recording.length === MAX_SAMPLES) showBanner('Заездов много: при сохранении самые старые уйдут', 2400);
}

const RESULT_TEXT: Partial<Record<CarStatus, string>> = { crashed: 'Авария!', stalled: 'Заглох', timeout: 'Время вышло' };

function finishRun({ interrupted = false } = {}): void {
  const status: RunStatus = interrupted || car.status === 'driving' ? 'stopped' : car.status;
  const saved = recording && addRun(recording, {
    trackName: track.name, traffic: state.drive.traffic, status,
    progressPct: carReport(car, track).progressPct, ticks: car.ticks,
  });
  recording = null;
  if (saved && runs.filter((r) => r.status === 'finished').length >= 2) emit('did', 'runs'); // 2 чистых заезда — шаг 1 урока
  if (interrupted) return;
  const head = car.status === 'finished' ? `Финиш! ${secs(car.finishTick ?? car.ticks)}.` : RESULT_TEXT[car.status] ?? '';
  showBanner(saved ? `${head} Заезд записан: ${saved.packed.length} примеров` : head, RESTART_DELAY + 400);
}

// ── реакция на перемены ──

on('config', () => {
  microscope.reset();
  if (state.tab !== 'teach') return;
  resetCar(); // другие глаза — другая машина
  microscope.render();
});
on('champion', ({ by }: { by: string }) => {
  if (state.tab !== 'teach' || by === 'editor') return;
  if (mode.peek() === 'brain') resetCar(); // поехал новый мозг
  microscope.render();
});
// Пересели в другую машину: недоеханный заезд был записан прежней — новой он не пригодится
on('car', () => (recording = null));
on('reset', () => {
  microscope.reset();
  if (mode.peek() === 'brain') setMode('me');
});
