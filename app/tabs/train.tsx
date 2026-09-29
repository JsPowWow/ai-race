// Вкладка «Учится само» (урок 2): рой и эволюция — поколения, отбор, мутация, кроссовер.
// Кнопки, «Рой сейчас» и панель справа — компоненты @reely/dommy (#20): обновляются сами от сигналов роя.
// Трасса и «Мозг лидера» — холсты: их рисует кадр вкладки (frame). Сам рой — train-swarm.ts, он учится и в фоне.
import { mount } from '@reely/dommy';
import { Car } from '../../engine/car.ts';
import type { Track } from '../../engine/track.ts';
import { state } from '../state.ts';
import { canvas, drawScene, paintCar, trafficOn, carAt, setHud, lapText } from '../stage.ts';
import { esc, secs } from '../ui.ts';
import { element } from '../dom.ts';
import { train } from './train-settings.ts';
import { currentSwarm, currentTrack, pickedCars, togglePick, results, trackForGeneration, isYours, isRunning } from './train-swarm.ts';
import { TrainToolbar, SwarmNow } from './train-controls.tsx';
import { TrainPanel, drawSwarmChart } from './train-panel.tsx';
import { showLeaderBrain } from './train-leader.ts';
import { updateTrainFlaps } from './train-flaps.tsx';
import { rivalInfo } from './train-rivals.tsx';
import { listen } from '@reely/dommy/kit';
import { Tries } from '../components/tries.tsx';
import { controlNames } from '../variants.ts';

export { isRunning as isTraining, updateTraining } from './train-swarm.ts';
export { redrawLeaderBrain } from './train-leader.ts';

mount(element('.toolbar[data-for="train"]'), () => <TrainToolbar />);
mount(element('#swarmNow'), () => <SwarmNow />);
mount(element('#trainPanel'), () => <TrainPanel />);
mount(element('#trainTries'), () => (
  <Tries source="train" empty="Нажми «Старт»: после каждого поколения лучший роя едет контрольный заезд против твоего мозга."
    control={() => controlNames(trackForGeneration(0))} />
));

/** Как подписать твою машину: имя из «Профиля» или просто «Ты» */
const yourName = (): string => state.profile.name.trim() || 'Ты';

/** Лидер: живые важнее разбившихся, дальше — кто дальше уехал */
const leaderOf = (cars: readonly Car[]): Car | null =>
  cars.reduce<Car | null>((lead, c) => {
    if (!lead) return c;
    if (c.done !== lead.done) return c.done ? lead : c;
    return c.bestS > lead.bestS ? c : lead;
  }, null);

/** Трасса и машина до старта. Кэш по настройкам: строить трассу и машину заново каждый кадр незачем */
let idle: { key: string; track: Track; car: Car } | null = null;
function idleScene(): { track: Track; car: Car } {
  const key = JSON.stringify([train().trackId, train().seed, train().traffic, results().generation, state.config.sensors]);
  if (idle?.key !== key) {
    const track = trackForGeneration(results().generation);
    idle = { key, track, car: new Car(track, { sensors: state.config.sensors }) };
  }
  return idle;
}

function drawIdle(): void {
  const { track, car } = idleScene();
  drawScene(track, { traffic: trafficOn(track, 0) });
  paintCar(car, { color: state.profile.color });
  setHud([`<b>${esc(track.name)}</b>`, state.champion ? `продолжим с поколения ${results().generation}` : 'нажми «Старт»']);
  showLeaderBrain(null);
  updateTrainFlaps(null, null, results().generation);
}

export const trainTab = {
  enter(): void {
    drawSwarmChart(true); // пока вкладка была скрыта, холст графика мог поменять размер
  },
  frame(): void {
    drawSwarmChart();
    const evo = currentSwarm(), track = currentTrack();
    if (!evo || !track) return drawIdle();
    const color = state.profile.color;
    const picked = pickedCars();
    const lead = leaderOf(evo.cars);
    drawScene(track, { camera: train().camera, follow: lead, traffic: evo.traffic ?? trafficOn(track, 0), tick: evo.tick });
    // лучший прошлого поколения едет без изменений — хорошее не теряется; на трассе он с номером 1
    const elite = evo.parent ? evo.cars[0] : null;
    for (const car of evo.cars) {
      if (car !== lead && car !== elite && !picked.includes(car)) paintCar(car, { color, alpha: car.done ? 0.18 : 0.35, ghost: true });
    }
    if (elite && elite !== lead && !picked.includes(elite)) paintCar(elite, { color, alpha: elite.done ? 0.4 : 0.8, number: 1 });
    // твой мозг и соперники — своим цветом и с именем: в отбор они не идут, просто едут рядом
    evo.rivalCars.forEach((car, i) => {
      const rival = evo.rivals[i];
      const info = rival && (isYours(rival) ? { color, name: yourName() } : rivalInfo(rival));
      paintCar(car, { color: info?.color ?? color, alpha: car.status === 'crashed' ? 0.5 : 1, label: info?.name ?? null });
    });
    for (const car of picked) if (car !== lead) paintCar(car, { color, highlight: true });
    if (lead) paintCar(lead, { color, sensors: true, highlight: picked.includes(lead), number: lead === elite ? 1 : null });
    showLeaderBrain(lead, isRunning());
    updateTrainFlaps(evo, lead, results().generation);
    setHud([
      `поколение <b>${results().generation + 1}</b>`,
      `едут <b>${evo.cars.filter((c) => !c.done).length}</b>/${evo.cars.length}`,
      `доехали <b>${evo.cars.filter((c) => c.status === 'finished').length}</b>`,
      `время <b>${secs(evo.tick)}</b>`,
      lead ? lapText(track, lead.bestS) : '',
      `<b>${esc(track.name)}</b>`,
    ].filter(Boolean));
  },
};

// Щелчок по машине на трассе — выбрать её в родители следующего поколения
listen(canvas, 'click', (e: MouseEvent) => {
  const evo = currentSwarm();
  if (state.tab !== 'train' || !evo) return;
  const car: Car | null = carAt(e, evo.cars);
  if (car) togglePick(car);
});
