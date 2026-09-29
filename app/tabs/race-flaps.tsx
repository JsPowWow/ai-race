// «Гонка», табло-флапы у трассы: места, круг, отставание от лидера — буквы перелистываются.
import { mount } from '@reely/dommy';
import { pickRows, type FlapColumn } from '../components/flap-board.tsx';
import { StageFlaps } from '../components/stage-flaps.tsx';
import { element } from '../dom.ts';
import { race, flaps, type FlapKey } from './race-run.ts';

const COLUMNS: readonly FlapColumn<FlapKey>[] = [
  { key: 'place', title: '№', width: 2, align: 'end' },
  { key: 'name', title: 'Машина', width: 12 },
  { key: 'lap', title: 'Круг', width: 3 },
  { key: 'gap', title: 'Время', width: 6, align: 'end' },
];

/** Кто лидирует и где ты — для читалки экрана */
function summary(): string {
  const rows = flaps.value;
  const [leader] = rows;
  if (!leader || !(race.running || race.finished)) return '';
  const you = rows.findIndex((r) => r.you);
  const where = you > 0 ? ` Ты — ${you + 1}-й из ${rows.length}.` : '';
  return `${race.finished ? 'Финиш. Первый' : 'Лидер'} — ${leader.cells.name}.${where}`;
}

// трасса — не сигнал, но табло публикуется заново всякий раз, как её строят: читаем flaps, чтобы узнать об этом
const title = () => (void flaps.value, race.track?.name ?? 'Гонка');

const host = element('#raceFlaps');
mount(host, () => (
  <StageFlaps host={host} label="Табло гонки" title={title} columns={COLUMNS}
    rows={(max) => pickRows(flaps.value, max)} summary={summary} />
));
