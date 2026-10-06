// «Учится само», соперники: боты и чужие машины едут рядом с роем — видно, догнал ли их рой.
// В отборе они не участвуют: родители — только из роя (engine/evolution.ts, rivals).
// Список не сохраняем: соперники — на один вечер, а localStorage маленький.
import { signal, For, Show } from '@reely/dommy';
import type { Rival } from '../../engine/evolution.ts';
import { fromCarFile } from '../car-file.ts';
import { CAR_COLORS } from '../state.ts';
import { BOTS } from '../generated/bots.js';
import { CarDot } from '../components/car-dot.tsx';
import { messageOf } from '@reely/basics';

/** Соперник на странице: кто он и как выглядит; сам заезд — в rival */
export type RivalEntry = { id: string; name: string; color: string; rival: Rival };

/** Соперники по порядку. Меняем только целиком (новым списком) */
export const rivals = signal<readonly RivalEntry[]>([]);
/** Что не получилось при последней загрузке — по строке на файл */
const errors = signal<readonly string[]>([]);

/** Кто это: по объекту соперника из роя находим его имя и цвет (рой держит тех, с кем начал поколение) */
const known = new WeakMap<Rival, RivalEntry>();
export const rivalInfo = (rival: Rival): RivalEntry | undefined => known.get(rival);

let lastFileId = 0;

/** Сделать соперника из файла машины. Свой код think на этой вкладке не запускаем — только на «Гонке», после «Разрешить» */
function toRival(file: unknown, id: string): RivalEntry {
  const car = fromCarFile(file, CAR_COLORS[(rivals.peek().length + 1) % CAR_COLORS.length]);
  if (!car.think) throw new Error(`${car.name}: у машины свой код think — такую пускаем только на «Гонке», после проверки`);
  const entry: RivalEntry = { id, name: car.name, color: car.color, rival: { brain: car.brain, think: car.think, sensors: car.sensors } };
  known.set(entry.rival, entry);
  return entry;
}


/** Бот в соперниках — снять, нет — добавить */
function toggleBot(index: number, on: boolean): void {
  const id = `bot-${index}`;
  const rest = rivals.peek().filter((r) => r.id !== id);
  try {
    rivals.value = on ? [...rest, toRival(BOTS[index], id)] : rest;
    errors.value = [];
  } catch (e) {
    errors.value = [messageOf(e)];
  }
}

/** Файлы машин — все сразу; плохие не добавятся, но и хорошим не помешают */
async function addFiles(files: FileList | null): Promise<void> {
  const list = [...(files ?? [])];
  const texts = await Promise.all(list.map((f) => f.text()));
  const added: RivalEntry[] = [];
  const failed: string[] = [];
  texts.forEach((text, i) => {
    try {
      added.push(toRival(JSON.parse(text), `file-${++lastFileId}`));
    } catch (e) {
      failed.push(`${list[i].name}: ${messageOf(e)}`);
    }
  });
  rivals.update((list) => [...list, ...added]);
  errors.value = failed;
}

const remove = (id: string) => rivals.update((list) => list.filter((r) => r.id !== id));

export function Rivals(): Node {
  const files = () => rivals.value.filter((r) => r.id.startsWith('file-'));
  return (
    <section className="block">
      <h2>Соперники</h2>
      <p className="hint">Едут рядом с роем, но родителями не становятся: так видно, догнал ли рой ботов.</p>
      <div className="row" aria={{ role: 'group', ariaLabel: 'Боты-соперники' }}>
        {BOTS.map((bot, i) => (
          <label className="check">
            <input type="checkbox" checked={() => rivals.value.some((r) => r.id === `bot-${i}`)} onChange={(e) => toggleBot(i, e.currentTarget.checked)} />
            {bot.name}
          </label>
        ))}
      </div>
      <ul className="entrants" id="tRivals">
        <For each={files} by={(r) => r.id}>
          {(rival) => (
            <li>
              <CarDot look={rival} />
              <span>{() => rival().name}</span>
              <span />
              <button className="remove" aria={{ ariaLabel: () => `Убрать ${rival().name}` }} onClick={() => remove(rival().id)}>×</button>
            </li>
          )}
        </For>
      </ul>
      <label className="btn small file">
        Загрузить .json
        <input type="file" id="tRivalFiles" accept=".json,application/json" multiple onChange={(e) => {
          addFiles(e.currentTarget.files);
          e.currentTarget.value = ''; // тот же файл ещё раз — снова событие change
        }} />
      </label>
      <Show when={() => errors.value.length > 0}>
        {() => <div className="error entrants-error" aria={{ role: 'alert' }}>{() => errors.value.join('\n')}</div>}
      </Show>
    </section>
  );
}
