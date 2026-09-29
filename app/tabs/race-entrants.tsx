// «Гонка», участники: боты, мой чемпион, чужие файлы и гибриды. Добавить, убрать, проверить чужой код, скрестить двоих.
// Список участников — сигнал: заезд (race-run.ts) сам готовится заново, когда он меняется.
import { signal, untracked, For, Show } from '@reely/dommy';
import type { Think } from '../../engine/car.ts';
import { state, thinkVariant, emit, CAR_COLORS } from '../state.ts';
import { toCarFile, fromCarFile, approveCode, type Entrant as CarEntrant } from '../car-file.ts';
import { BOTS } from '../generated/bots.js';
import { showBanner, onTrackDrop } from '../stage.ts';
import { Avatar } from '../components/avatar.tsx';
import { Review } from './race-review.tsx';
import { canCross, childFile, crossNote } from './race-cross.ts';

/** Откуда участник */
export type Source = 'bot' | 'mine' | 'file' | 'cross';
const SOURCE_LABEL: Record<Source, string> = { bot: 'бот', mine: 'мой', file: 'файл', cross: 'гибрид' };

/**
 * Участник гонки: проверенный файл машины (file — он же, как пришёл) и чем он думает.
 * think — null, пока свой код участника не разрешили: такая машина не едет.
 */
export type Entrant = CarEntrant & { id: number; source: Source };

let lastId = 0;

/** Проверить файл и сделать из него участника. Бросает Error с понятным текстом */
function makeEntrant(file: unknown, source: Source, fallbackColor: string): Entrant {
  return { ...fromCarFile(file, fallbackColor), id: ++lastId, source };
}

/** Все участники по порядку. Меняем только целиком (новым списком): так страница и заезд узнают о перемене */
export const entrants = signal<readonly Entrant[]>(BOTS.map((file) => makeEntrant(file, 'bot', CAR_COLORS[0])));
/** Отмеченные для скрещивания (id, не больше двух; первый — мама) */
const picks = signal<readonly number[]>([]);
/** Чей код сейчас читаем (id) */
const reviewingId = signal<number | null>(null);
/** Что не получилось при последнем добавлении — по строке на файл */
const errors = signal<readonly string[]>([]);

const byId = (id: number | null) => entrants.value.find((e) => e.id === id);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── добавить и убрать ──

/**
 * Добавить участника. Возвращает текст ошибки или null.
 * inheritThink — готовый think: гибрид берёт его у мамы, её код уже разрешили.
 */
function add(file: unknown, source: Source, inheritThink: Think | null = null): string | null {
  try {
    const now = untracked(entrants);
    const entrant = makeEntrant(file, source, CAR_COLORS[now.length % CAR_COLORS.length]);
    if (inheritThink) entrant.think = inheritThink;
    else if (entrant.code && source === 'mine') approveCode(entrant); // свой код — свой браузер
    const others = source === 'mine' ? now.filter((e) => e.source !== 'mine') : now; // мой чемпион — один, свежий
    entrants.value = [...others, entrant];
    return null;
  } catch (e) {
    return messageOf(e);
  }
}

/** Добавить из текста JSON; where — откуда текст (имя файла), чтобы было понятно, какой из файлов плохой */
function addFromText(text: string, where = ''): string | null {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch (e) {
    return `${where ? `${where}: ` : ''}Не получилось прочитать JSON: ${messageOf(e)}`;
  }
  return add(file, 'file');
}

/** Файлы участников — все сразу и по порядку; ошибки — по каждому плохому файлу, хорошие всё равно добавятся */
async function addFiles(files: FileList | null): Promise<void> {
  const list = [...(files ?? [])];
  const texts = await Promise.all(list.map((f) => f.text()));
  showErrors(texts.map((text, i) => addFromText(text, list[i].name)));
}

/** Показать ошибки последнего действия (null — это действие удалось) */
function showErrors(list: (string | null)[]): void {
  errors.value = list.filter((x): x is string => !!x);
}

function addMine(): void {
  const file = toCarFile();
  if (!file) return showBanner('Сначала обучи мозг: на «Я учу» или «Учится само»');
  showErrors([add(file, 'mine')]);
  emit('did', 'race:mine');
}

function remove(id: number): void {
  entrants.value = entrants.peek().filter((e) => e.id !== id);
  picks.value = picks.peek().filter((x) => x !== id);
}

// ── проверка чужого кода: машина едет только после «Разрешить» ──

function allow(entrant: Entrant): void {
  reviewingId.value = null;
  try {
    const approved = { ...entrant };
    approveCode(approved);
    entrants.value = entrants.peek().map((e) => (e.id === entrant.id ? approved : e));
    showErrors([]);
  } catch (e) {
    showErrors([`${entrant.name}: ${messageOf(e)}`]);
  }
}

function reject(entrant: Entrant): void {
  reviewingId.value = null;
  remove(entrant.id);
}

// ── скрещивание ──

const picked = () => picks.value.map(byId).filter((e): e is Entrant => !!e);

function togglePick(id: number, on: boolean): void {
  const rest = picks.peek().filter((x) => x !== id);
  picks.value = on ? [...rest, id].slice(-2) : rest; // третья галочка снимает самую первую
}

function cross(): void {
  const [mom, dad] = untracked(picked);
  if (!mom || !dad || !canCross(mom, dad)) return;
  let file: object;
  try {
    file = childFile(mom, dad);
  } catch (e) {
    return showErrors([`Ошибка в crossover(): ${messageOf(e)}`]);
  }
  picks.value = [];
  showErrors([add(file, 'cross', mom.think)]);
}

// ── перетащить файлы на трассу ──

onTrackDrop(() => state.tab === 'race', (data) => addFiles(data.files));

// ── вид ──

const describe = (e: Entrant) => `${SOURCE_LABEL[e.source]} · ${thinkVariant(e.thinkId)?.title ?? e.thinkId} · ${e.sizes.join('-')}`;

function EntrantRow({ entrant }: { entrant: () => Entrant }): Node {
  const id = untracked(entrant).id; // id — ключ строки, у неё он не меняется
  const name = () => entrant().name;
  return (
    <li>
      <Avatar look={entrant} />
      <span>
        {name} <span className="kind">{() => describe(entrant())}</span>
        <Show when={() => !entrant().think}>
          {() => <button className="btn small review-btn" onClick={() => (reviewingId.value = id)}>Свой код — проверить</button>}
        </Show>
      </span>
      <input type="checkbox" checked={() => picks.value.includes(id)} aria={{ ariaLabel: () => `Выбрать ${name()} для скрещивания` }}
        onChange={(e) => togglePick(id, e.currentTarget.checked)} />
      <button className="remove" aria={{ ariaLabel: () => `Убрать ${name()}` }} onClick={() => remove(id)}>×</button>
    </li>
  );
}

function PasteJson(): Node {
  const text = signal('');
  const addPasted = () => {
    if (!text.value.trim()) return;
    showErrors([addFromText(text.value.trim())]);
    text.value = '';
  };
  return (
    <details>
      <summary>Вставить JSON текстом</summary>
      <textarea id="rPaste" rows={5} placeholder='{"format":"ai-race/car@3", ...}' aria={{ ariaLabel: 'JSON участника' }}
        value={text} onInput={(e) => (text.value = e.currentTarget.value)} />
      <button className="btn small" id="rPasteAdd" onClick={addPasted}>Добавить</button>
    </details>
  );
}

export function Entrants(): Node {
  const crossable = () => {
    const [mom, dad] = picked();
    return !!mom && !!dad && canCross(mom, dad);
  };
  // чей код читаем — списком из одного: у нового участника и окно новое, прокрученное к нему
  const reviewing = () => {
    const entrant = byId(reviewingId.value);
    return entrant && !entrant.think && entrant.code ? [{ ...entrant, code: entrant.code }] : [];
  };
  return (
    <section className="block">
      <h2>Участники</h2>
      <ul className="entrants" id="rList">
        <For each={entrants} by={(e) => e.id}>{(entrant) => <EntrantRow entrant={entrant} />}</For>
        <Show when={() => !entrants.value.length}>{() => <li className="kind">Нет участников</li>}</Show>
      </ul>
      <div className="row">
        <button className="btn small" id="rAddMine" onClick={addMine}>+ Мой чемпион</button>
        <label className="btn small file">
          Загрузить .json
          <input type="file" id="rFiles" accept=".json,application/json" multiple onChange={(e) => {
            addFiles(e.currentTarget.files);
            e.currentTarget.value = ''; // тот же файл ещё раз — снова событие change
          }} />
        </label>
        <button className="btn small" id="rCross" disabled={() => !crossable()} onClick={cross}>Скрестить</button>
      </div>
      <p className="hint" id="rCrossNote">{() => crossNote(picked()[0], picked()[1])}</p>
      <For each={reviewing} by={(e) => e.id}>
        {(entrant) => {
          const shown = untracked(entrant);
          return <Review entrant={shown} onAllow={() => allow(shown)} onReject={() => reject(shown)} />;
        }}
      </For>
      <PasteJson />
      <p className="hint">Файлы можно перетащить прямо на трассу.</p>
      <div className="error entrants-error" id="rError" aria={{ role: 'alert' }} hidden={() => !errors.value.length}>{() => errors.value.join('\n')}</div>
    </section>
  );
}
