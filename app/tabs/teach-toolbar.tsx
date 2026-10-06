// «Я учу», полоска под трассой: кто рулит, «Заново», трасса и машины на ней.
// Трасса и машины — общие для всех машин гаража (state.drive), поэтому помним их в localStorage.
import { TRAINING_TRACKS } from '../../engine/world/track.ts';
import { TRAFFIC_LEVELS, type TrafficLevel } from '../../engine/world/traffic.ts';
import { state, persist } from '../state.ts';

/** Кто рулит: 'me' — ты (заезд записывается), 'brain' — текущий мозг */
export type Mode = 'me' | 'brain';

type Choice = { id: string; title: string };
const TRACKS: Choice[] = TRAINING_TRACKS.map(({ id, name }) => ({ id, title: name }));

type DriveBarProps = {
  mode: () => Mode;
  onMode: (next: Mode) => void;
  /** Начать заезд заново (и когда поменяли трассу или машины) */
  onRestart: () => void;
};

export function DriveBar({ mode, onMode, onRestart }: DriveBarProps): Node {
  /** Выпадающий список настройки заезда: выбрали — запомнили и поехали заново */
  const select = (id: string, key: 'trackId' | 'traffic', items: Choice[]) => (
    <select id={id} onChange={(e) => {
      const value = e.currentTarget.value; // одно из items ниже
      if (key === 'traffic') state.drive.traffic = value as TrafficLevel;
      else state.drive.trackId = value;
      persist();
      onRestart();
    }}>
      {items.map((item) => <option value={item.id} selected={item.id === state.drive[key]}>{item.title}</option>)}
    </select>
  );
  const seat = (who: Mode, id: string, label: string) => (
    <button id={id} aria={{ ariaPressed: () => String(mode() === who) }} onClick={() => onMode(who)}>{label}</button>
  );
  return (
    <>
      <div className="seg" aria={{ role: 'group', ariaLabel: 'Кто рулит' }}>
        {seat('me', 'dMe', 'Еду я')}
        {seat('brain', 'dBrain', 'Едет мозг')}
      </div>
      <button className="btn" id="dRestart" onClick={onRestart}>Заново</button>
      <label className="inline">Трасса {select('dTrack', 'trackId', TRACKS)}</label>
      <label className="inline">Машины {select('dTraffic', 'traffic', TRAFFIC_LEVELS)}</label>
    </>
  );
}
