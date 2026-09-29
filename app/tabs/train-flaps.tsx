// «Учится само», табло-флапы у трассы: не весь рой (сто одинаковых машин), а лучший в этом поколении,
// № 1 прошлого поколения — это ты — и соперники. Новое поколение — табло перещёлкивается заново.
import { mount, signal } from '@reely/dommy';
import { carReport, type Car } from '../../engine/car.ts';
import type { Evolution } from '../../engine/evolution.ts';
import { lapOf, type Track } from '../../engine/track.ts';
import { pickRows, type FlapColumn, type FlapRow } from '../components/flap-board.tsx';
import { StageFlaps } from '../components/stage-flaps.tsx';
import { state } from '../state.ts';
import { element } from '../dom.ts';
import { rivalInfo } from './train-rivals.tsx';

type Key = 'place' | 'name' | 'lap' | 'result';
const COLUMNS: readonly FlapColumn<Key>[] = [
  { key: 'place', title: '№', width: 2, align: 'end' },
  { key: 'name', title: 'Машина', width: 12 },
  { key: 'lap', title: 'Круг', width: 3 },
  { key: 'result', title: 'Итог', width: 6, align: 'end' },
];
/** Три раза в секунду: флапы успевают долистаться */
const EVERY_FRAMES = 20;

const rows = signal<readonly FlapRow<Key>[]>([]);
const title = signal('Рой');

/** Машина на табло: кто это и что писать */
type Shown = { id: string; car: Car; name: string; color: string; avatar?: string | null; you?: boolean };

const short = (ticks: number) => (ticks / 60).toFixed(1).replace('.', ',');

function resultOf(car: Car, track: Track): string {
  if (car.status === 'finished') return short(car.finishTick ?? car.ticks);
  if (car.status === 'crashed') return car.crashedInto === 'car' ? 'АВАРИЯ' : 'БОРДЮР';
  if (car.status !== 'driving') return 'СОШЁЛ';
  return `${Math.floor(carReport(car, track).progressPct)}%`;
}

/** Сначала доехавшие (кто быстрее), потом — кто дальше уехал */
const ahead = (a: Car, b: Car) => {
  const fa = a.status === 'finished', fb = b.status === 'finished';
  if (fa !== fb) return fa ? -1 : 1;
  return fa ? (a.finishTick ?? 0) - (b.finishTick ?? 0) : b.bestS - a.bestS;
};

let frames = 0;
/** Зовёт кадр вкладки: lead — лидер роя сейчас */
export function updateTrainFlaps(evo: Evolution | null, lead: Car | null, generation: number): void {
  if (frames++ % EVERY_FRAMES) return;
  if (!evo) {
    rows.value = [];
    title.value = 'Рой';
    return;
  }
  const { track } = evo;
  const me = state.profile;
  const elite = evo.parent ? evo.cars[0] : null; // № 1 прошлого поколения едет без изменений
  const shown: Shown[] = [];
  if (elite) shown.push({ id: 'elite', car: elite, name: me.name.trim() || 'Ты', color: me.color, avatar: me.avatar, you: true });
  if (lead && lead !== elite) shown.push({ id: 'lead', car: lead, name: 'Лучший роя', color: me.color });
  evo.rivalCars.forEach((car, i) => {
    const info = evo.rivals[i] && rivalInfo(evo.rivals[i]);
    shown.push({ id: `rival-${info?.id ?? i}`, car, name: info?.name ?? 'Соперник', color: info?.color ?? me.color, avatar: info?.avatar });
  });
  shown.sort((a, b) => ahead(a.car, b.car));
  title.value = `Поколение ${generation + 1}`;
  rows.value = shown.map(({ id, car, name, color, avatar, you }, i) => ({
    id, color, avatar, you, rank: i + 1,
    cells: {
      place: String(i + 1),
      name,
      lap: car.status === 'finished' ? 'ФИН' : `${lapOf(track, car.bestS)}/${track.laps}`,
      result: resultOf(car, track),
    },
  }));
}

/** Где ты среди соперников — для читалки экрана */
function summary(): string {
  const list = rows.value;
  const you = list.findIndex((r) => r.you);
  if (you < 0 || list.length < 2) return '';
  return `${title.value}. Ты — ${you + 1}-й из ${list.length}.`;
}

const host = element('#trainFlaps');
mount(host, () => (
  <StageFlaps host={host} label="Табло роя" title={() => title.value} columns={COLUMNS}
    rows={(max) => pickRows(rows.value, max)} summary={summary} />
));
