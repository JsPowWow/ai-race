// «Я учу», полоска под трассой: кто рулит, «Заново», трасса и машины на ней.
// Трасса и машины — общие для всех машин гаража (state.drive), поэтому помним их в localStorage.
import { TRAINING_TRACKS } from '../../engine/world/track.ts';
import { TRAFFIC_LEVELS, type TrafficLevel } from '../../engine/world/traffic.ts';
import { state, persist } from '../state.ts';
import { Seg, Select, type Choice } from '../components/controls.tsx';

/** Кто рулит: 'me' — ты (заезд записывается), 'brain' — текущий мозг */
export type Mode = 'me' | 'brain';

const SEATS: Choice<Mode>[] = [{ id: 'me', title: 'Еду я' }, { id: 'brain', title: 'Едет мозг' }];
const TRACKS: Choice[] = TRAINING_TRACKS.map(({ id, name }) => ({ id, title: name }));

type DriveBarProps = {
  mode: () => Mode;
  onMode: (next: Mode) => void;
  /** Начать заезд заново (и когда поменяли трассу или машины) */
  onRestart: () => void;
};

export function DriveBar({ mode, onMode, onRestart }: DriveBarProps): Node {
  /** Выпадающий список настройки заезда: выбрали — запомнили и поехали заново */
  const select = (id: string, key: 'trackId' | 'traffic', items: readonly Choice[]) => (
    <Select id={id} items={items} value={() => state.drive[key]} pick={(value) => {
      if (key === 'traffic') state.drive.traffic = value as TrafficLevel; // одно из items
      else state.drive.trackId = value;
      persist();
      onRestart();
    }} />
  );
  return (
    <>
      <Seg<Mode> label="Кто рулит" items={SEATS} value={mode} pick={onMode} />
      <button className="btn" id="dRestart" onClick={onRestart}>Заново</button>
      <label className="inline">Трасса {select('dTrack', 'trackId', TRACKS)}</label>
      <label className="inline">Машины {select('dTraffic', 'traffic', TRAFFIC_LEVELS)}</label>
    </>
  );
}
