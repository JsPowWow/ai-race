// «Учится само» у трассы: кнопки роя под ней и «Рой сейчас» — одно поколение в трёх шагах и что делать дальше.
import { effect } from '@reely/dommy';
import { TRAINING_TRACKS } from '../../engine/world/track.ts';
import { TRAFFIC_LEVELS } from '../../engine/world/traffic.ts';
import type { TrafficLevel } from '../../engine/world/traffic.ts';
import { Seg, Select } from '../components/controls.tsx';
import type { Choice } from '../components/controls.tsx';
import { train, setTrain } from './train-settings.ts';
import type { Camera, Speed } from './train-settings.ts';
import {
  isRunning, isStarted, toggleRunning, endGeneration, setTrackSetting, results, currentTrack, leaderSlowdowns, generationsShown,
} from './train-swarm.ts';
import { swarmAdvice } from './train-advice.ts';

const SPEEDS: Choice<Speed>[] = [
  { id: '1', title: '×1' }, { id: '4', title: '×4' }, { id: '16', title: '×16' }, { id: 'turbo', title: 'Турбо' },
];
const CAMERAS: Choice<Camera>[] = [{ id: 'fit', title: 'Вся трасса' }, { id: 'follow', title: 'За лидером' }];
const TRACKS: Choice[] = [
  ...TRAINING_TRACKS.map(({ id, name }) => ({ id, title: name })),
  { id: 'seed', title: 'По кодовому слову' },
  { id: 'mix', title: 'Микс: каждый раз новая' },
];

/** Кнопки под трассой: старт и пауза, скорость, трасса, машины, камера */
export function TrainToolbar(): Node {
  return (
    <>
      <button className="btn primary" id="tToggle" onClick={toggleRunning}>
        {() => (isRunning() ? 'Пауза' : isStarted() ? 'Продолжить' : 'Старт')}
      </button>
      <button className="btn small" id="tEndGen" title="Не ждать, пока доедут все: оценить машины сейчас"
        disabled={() => !isStarted()} onClick={endGeneration}>Закончить поколение</button>
      <Seg label="Скорость" items={SPEEDS} value={() => train().speed} pick={(speed) => setTrain('speed', speed)} />
      <label className="inline">Трасса{' '}
        <Select id="tTrack" items={TRACKS} value={() => train().trackId} pick={(id) => setTrackSetting('trackId', id)} />
      </label>
      <label className="inline" id="tSeedRow" hidden={() => train().trackId !== 'seed'}>Кодовое слово{' '}
        <input type="text" id="tSeed" maxLength={40} value={() => train().seed}
          onChange={(e) => {
            const seed = e.currentTarget.value.trim() || 'тренировка';
            e.currentTarget.value = seed; // пустое поле — вернуть слово по умолчанию, даже если оно и было
            setTrackSetting('seed', seed);
          }} />
      </label>
      <label className="inline" title="На гонке будут попутные и встречные. Если рой не учится, начни без машин, потом включи их">Машины{' '}
        <Select id="tTraffic" items={TRAFFIC_LEVELS} value={() => train().traffic} pick={(id) => setTrackSetting('traffic', id as TrafficLevel)} />
      </label>
      <Seg label="Камера" items={CAMERAS} value={() => train().camera} pick={(camera) => setTrain('camera', camera)} />
    </>
  );
}

/** Шаги поколения. Идёт заезд — горит первый; поколение кончилось на глазах — на миг вспыхивают отбор и мутация */
const PHASES = [
  { phase: 'drive', title: () => `Едут ${train().population} машин`, text: 'мозги у всех чуть разные' },
  { phase: 'pick', title: () => 'Отбор', text: 'лучшие 10% по фитнесу — родители' },
  { phase: 'mutate', title: () => 'Дети', text: 'нейроны от родителей и немного мутации' },
];

/** Перезапустить CSS-анимацию вспышки: снять класс, дать браузеру это заметить, поставить снова */
function flash(li: HTMLElement): void {
  li.classList.remove('flash');
  void li.offsetWidth;
  li.classList.add('flash');
}

/** «Рой сейчас»: содержимое секции над «Мозгом лидера» */
export function SwarmNow(): Node {
  const flashing: HTMLElement[] = [];
  effect(() => {
    if (generationsShown()) flashing.forEach(flash);
  });
  const advice = () => swarmAdvice({
    started: isStarted(),
    running: isRunning(),
    trained: results().trained,
    history: results().history,
    track: currentTrack(),
    slowdowns: leaderSlowdowns(),
    timeBonus: train().ownFitness || train().parts.includes('finish'),
  });
  return (
    <>
      <ol className="swarm-cycle" aria={{ ariaLabel: 'Как учится рой: одно поколение' }}>
        {PHASES.map(({ phase, title, text }, i) => (
          <li className={() => (phase === 'drive' && isRunning() ? 'on' : '')}
            elementRef={(li) => phase !== 'drive' && flashing.push(li)}>
            <span className="n">{i + 1}</span>
            <span><b>{title}</b>{text}</span>
          </li>
        ))}
      </ol>
      <p className="swarm-say" id="swarmSay" aria={{ role: 'status' }}>{advice}</p>
    </>
  );
}
