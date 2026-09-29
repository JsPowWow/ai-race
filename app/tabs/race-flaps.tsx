// «Гонка», табло-флапы рядом с трассой: места, круг, отставание от лидера — буквы перелистываются.
// На широком экране — колонка справа от трассы (строк столько, сколько влезает), на узком —
// полоса над трассой в четыре строки: лидер, кто впереди тебя, ты, кто сзади.
import { mount } from '@reely/dommy';
import { FlapBoard, FLAP_ROW_PX, pickRows, type FlapColumn } from '../components/flap-board.tsx';
import { media, size, throttled } from '../dom-signals.ts';
import { element } from '../dom.ts';
import { race, flaps, type FlapKey } from './race-run.ts';

const COLUMNS: readonly FlapColumn<FlapKey>[] = [
  { key: 'place', title: '№', width: 2, align: 'end' },
  { key: 'name', title: 'Машина', width: 12 },
  { key: 'lap', title: 'Круг', width: 3 },
  { key: 'gap', title: 'Время', width: 6, align: 'end' },
];
/** Сбоку от трассы — только когда трасса и без того широкая; иначе табло над ней. Совпадает с race.css */
const SIDE_QUERY = '(min-width: 1180px), (min-width: 760px) and (max-width: 1000px)';
/** Заголовок табло и строка заголовков колонок — в строках табло */
const HEAD_ROWS = 2;
const PHONE_ROWS = 4;

/** Кто лидирует и где ты — для читалки экрана, не чаще раза в 5 секунд */
function summary(): string {
  const rows = flaps.value;
  const [leader] = rows;
  if (!leader || !(race.running || race.finished)) return '';
  const you = rows.findIndex((r) => r.you);
  const where = you > 0 ? ` Ты — ${you + 1}-й из ${rows.length}.` : '';
  return `${race.finished ? 'Финиш. Первый' : 'Лидер'} — ${leader.cells.name}.${where}`;
}

function RaceFlaps({ host }: { host: HTMLElement }): Node {
  const side = media(SIDE_QUERY);
  const box = size(host);
  const fits = () => (side.value ? Math.max(1, Math.floor(box.value.height / FLAP_ROW_PX) - HEAD_ROWS) : PHONE_ROWS);
  const said = throttled(summary, 5000);
  // трасса — не сигнал, но табло публикуется заново всякий раз, как её строят: читаем flaps, чтобы узнать об этом
  const title = () => (void flaps.value, race.track?.name ?? 'Гонка');
  return (
    <>
      <FlapBoard label="Табло гонки" title={title} columns={COLUMNS} rows={() => pickRows(flaps.value, fits())}
        fill={() => (side.value ? fits() : 0)} />
      <p className="sr-only" aria={{ ariaLive: 'polite' }}>{() => said.value}</p>
    </>
  );
}

const host = element('#raceFlaps');
mount(host, () => <RaceFlaps host={host} />);
