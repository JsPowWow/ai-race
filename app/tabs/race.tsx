// Вкладка «Гонка» (урок 5): участники, секретная трасса, отсчёт, таблица и номинации.
// Панель и кнопки под трассой — на @reely/dommy (#20); трассу с машинами рисует кадровый цикл (frame).
//   race-entrants.tsx — участники: добавить, убрать, проверить чужой код, скрестить
//   race-run.ts       — сам заезд;  race-results.ts — места и номинации;  race-board.tsx — таблица
//   race-flaps.tsx    — табло-флапы рядом с трассой
import { mount } from '@reely/dommy';
import { TRAFFIC_LEVELS, type TrafficLevel } from '../../engine/world/traffic.ts';
import { state, persist } from '../state.ts';
import { drawScene, paintCar, paintSensors, trafficOn, setHud } from '../stage.ts';
import { field } from '../ui.ts';
import { secs } from '../format.ts';
import { element } from '../dom.ts';
import { Seg, Select, type Choice } from '../components/controls.tsx';
import { Entrants } from './race-entrants.tsx';
import { Board } from './race-board.tsx';
import './race-flaps.tsx';
import { race, prepare, start, tickRace, speed, started } from './race-run.ts';
import { standings } from './race-results.ts';

const SPEEDS: Choice<number>[] = [1, 2, 4, 8].map((x) => ({ id: x, title: `×${x}` }));

function FinalLink(): Node {
  return (
    <section className="block final-link">
      <h2>Финал курса</h2>
      <p className="hint">Здесь — гонка на несколько машин. Для общего финала на сотни участников (этапы, суперфинал, живая таблица, стрим) есть отдельный режим.</p>
      {/* data-open ловит app/main.ts: финал грузится, только когда его открыли */}
      <button className="btn small" data-open="final">Открыть финал</button>
    </section>
  );
}

/** Seed и трафик помним между визитами; поменяли — все на старт заново */
function SecretTrack(): Node {
  const change = (key: 'seed' | 'traffic', value: string) => {
    if (key === 'traffic') state.race.traffic = value as TrafficLevel; // одно из TRAFFIC_LEVELS
    else state.race.seed = value.trim();
    persist();
    prepare();
  };
  return (
    <section className="block">
      <h2>Секретная трасса</h2>
      <div className="field">
        <label htmlFor="rSeed">Seed</label>
        <input type="text" id="rSeed" maxLength={80} value={state.race.seed} onChange={(e) => change('seed', e.currentTarget.value)} />
      </div>
      <div className="field wide">
        <label htmlFor="rTraffic">Машины</label>
        <Select id="rTraffic" items={TRAFFIC_LEVELS} value={() => state.race.traffic} pick={(id) => change('traffic', id)} />
      </div>
      <p className="hint">Один и тот же seed даёт одну и ту же трассу на любом компьютере. Объявите его в час X.</p>
    </section>
  );
}

function Toolbar(): Node {
  return (
    <>
      <button className="btn primary" id="rStart" onClick={start}>{() => (started.value ? 'Заново' : 'Старт гонки')}</button>
      <Seg label="Скорость гонки" items={SPEEDS} value={speed} pick={(x) => (speed.value = x)} />
      <span className="note">Время считается в тиках: 60 тиков = 1 секунда, от мощности ноутбука не зависит</span>
    </>
  );
}

mount(element('#racePanel'), () => (
  <>
    <FinalLink />
    <SecretTrack />
    <Entrants />
    <Board />
  </>
));
mount(element('#raceToolbar'), Toolbar);

export const raceTab = {
  enter(): void {
    if (!race.running && !race.finished) prepare();
  },
  frame(frameNo: number): void {
    tickRace(frameNo);
    const { track } = race;
    if (!track) return;
    drawScene(track, { traffic: trafficOn(track, race.tick), tick: race.tick });
    const [leader] = standings(race.cars);
    for (const { entrant, car } of race.cars) {
      const isLeader = leader?.car === car;
      paintCar(car, { color: entrant.color, alpha: car.status === 'crashed' ? 0.5 : 1, label: isLeader ? entrant.name : null });
    }
    if (leader && !leader.car.done) paintSensors(leader.car);
    // места, круги и отставания — на табло-флапах; над трассой — только время и что сейчас происходит
    setHud([
      field('время', secs(race.tick)),
      race.running ? `×${speed.peek()}` : race.finished ? 'финиш' : 'ждём старта',
    ]);
  },
};
