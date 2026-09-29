// «Профиль», гараж: машины плитками на полке. Выбранная — жёлтая: её учат, проверяют и сдают на всех вкладках.
// Под полкой — что делать с выбранной (копия, файл, удалить), её файлы и сколько места занимает весь гараж.
//
// Перед тем как пересесть в другую машину, спрашиваем про неприменённый черновик сборки —
// прямо на месте, где нажали: в плитке или под полкой.
import { signal, untracked, For, Show } from '@reely/dommy';
import { state, sizesOf, emit, on } from '../state.ts';
import type { Profile } from '../state.ts';
import { garage, MAX_CARS, switchCar, newCar, copyCar, deleteCar, exportCar, importCar, chooseFolder, allowFolder, stopFolder } from '../garage.ts';
import { Avatar } from '../components/avatar.tsx';
import { saveFile, safeFileName } from '../download.ts';
import { fromEvents } from '../signals.ts';
import { draft, resets, applyDraft, dropDraft } from './profile-build.tsx';

/** Сводка машины на полке (сама машина целиком лежит в её файлах) */
type Summary = {
  id: string; created: number; profile: Profile; shape: string; generation: number; trained: boolean;
  bytes: { car: number; history: number; runs?: number };
};
/** Гараж, каким его видит полка: см. app/garage.ts */
type Shelf = Omit<typeof garage, 'cars'> & { cars: Summary[] };

/**
 * Что сейчас спрашиваем, или null. at — где спрашиваем (id машины, 'new' — плитка «+ Новая машина»,
 * 'row' — под полкой); kind — 'draft' (черновик не применён) или 'delete' (точно удалить?); run — что сделать после «да».
 */
type Ask = { at: string; kind: 'draft' | 'delete'; run: () => Promise<unknown> };
const ask = signal<Ask | null>(null);
/** Пишем файлы: кнопки заблокированы */
const busy = signal(false);

/** Гараж. Облик, форма и мозг выбранной машины — из state: так имя меняется на полке сразу, пока печатаешь */
const shelf = fromEvents(['garage', 'car', 'save', 'config', 'champion'], () => garage as Shelf);
on('car', () => (ask.value = null));

/** Байты по-человечески: 319 Б, 1,5 КБ, 2,3 МБ, 1,1 ГБ */
function kb(n: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) [n, i] = [n / 1024, i + 1];
  return `${i ? n.toFixed(1).replace('.', ',') : n} ${units[i]}`;
}
const total = (car: Summary) => car.bytes.car + car.bytes.history + (car.bytes.runs ?? 0);
const progress = (car: Summary) => (!car.trained ? 'не обучена' : car.generation ? `поколение ${car.generation}` : 'обучена');
const nameOf = (profile: Profile) => profile.name || 'Без имени';

/** Машины на полке — каждый раз новые объекты: так строки полки узнают, что сводка поменялась */
const cars = () => shelf().cars.map((car): Summary => (car.id === shelf().id
  ? { ...car, profile: { ...state.profile }, shape: sizesOf().join('-'), generation: state.generation, trained: !!state.champion }
  : { ...car }));
const full = () => shelf().cars.length >= MAX_CARS;
/** Выбранная машина на полке */
const selected = () => cars().find((c) => c.id === shelf().id);

// ── действия ──

/** Выполнить действие гаража: кнопки заблокированы, пока пишем файлы; ошибку показываем под полкой */
async function act(run: () => Promise<unknown>): Promise<void> {
  busy.value = true;
  ask.value = null;
  try {
    await run();
  } catch (e) {
    garage.error = `Не получилось: ${(e as Error).message}`;
  } finally {
    busy.value = false;
    emit('garage');
  }
}

/** Действие, после которого сядем в другую машину: сначала спросим про черновик — там, где нажали */
function leave(at: string, run: () => Promise<unknown>): void {
  if (draft.peek()) ask.value = { at, kind: 'draft', run };
  else act(run);
}

function answer(choice: 'apply' | 'drop' | 'stay' | 'yes'): void {
  const now = ask.peek();
  if (!now) return;
  if (choice === 'stay') {
    ask.value = null;
    // фокус — туда, где спросили: плитка вернулась на место
    const back = now.at === 'row' ? (now.kind === 'delete' ? '#gDelete' : '#gCopy')
      : now.at === 'new' ? '#gShelf [data-new]' : `#gShelf [data-car="${CSS.escape(now.at)}"]`;
    document.querySelector<HTMLElement>(back)?.focus();
    return;
  }
  if (choice === 'apply') applyDraft();
  if (choice === 'drop') dropDraft();
  act(now.run);
}

async function exportToFile(): Promise<void> {
  const { name, text } = await exportCar();
  await saveFile(`${safeFileName(name)}.garage.json`, text);
}

async function importFromFile(input: HTMLInputElement): Promise<void> {
  const [file] = input.files ?? [];
  input.value = ''; // тот же файл ещё раз — снова событие change
  if (!file) return;
  const text = await file.text();
  leave('row', () => importCar(text));
}

/** Вопрос появился — фокус на его кнопку (когда элемент уже на странице) */
const focusSoon = (el: HTMLElement) => queueMicrotask(() => el.focus());

// ── плитки ──

function DraftQuestion(): Node {
  return (
    <>
      <p>Сборка не применена. {() => (resets() ? 'Применишь — мозг начнёт с нуля (прежний останется в «Истории»).' : 'Применить её перед тем, как пересесть?')}</p>
      <div className="row">
        <button className={() => `btn small ${resets() ? 'danger' : 'primary'}`} data-ask="apply" elementRef={focusSoon} onClick={() => answer('apply')}>Применить</button>
        <button className="btn small" data-ask="drop" onClick={() => answer('drop')}>Выбросить</button>
        <button className="btn small" data-ask="stay" onClick={() => answer('stay')}>Остаться</button>
      </div>
    </>
  );
}

function DeleteQuestion(): Node {
  return (
    <>
      <p>Удалить «{() => nameOf(selected()?.profile ?? state.profile)}» вместе с мозгом и «Историей»? Вернуть будет нельзя.</p>
      <div className="row">
        <button className="btn small danger" data-ask="yes" onClick={() => answer('yes')}>Да, удалить</button>
        {/* по умолчанию — безопасное «Нет» */}
        <button className="btn small" data-ask="stay" elementRef={focusSoon} onClick={() => answer('stay')}>Нет</button>
      </div>
    </>
  );
}

/** Части полоски размера: мозг и сборка | «История» | мои заезды */
const PARTS = [['', 'car'], ['h', 'history'], ['r', 'runs']] as const;

function Tile({ car, biggest }: { car: () => Summary; biggest: () => number }): Node {
  const id = untracked(car).id; // id — ключ строки, у неё он не меняется
  const part = (key: (typeof PARTS)[number][1]) => car().bytes[key] ?? 0;
  return (
    <Show when={() => ask.value?.at === id}
      fallback={() => (
        <button className="g-tile" data-car={id} disabled={busy}
          aria={{ ariaPressed: () => String(id === shelf().id) }}
          onClick={() => id !== garage.id && leave(id, () => switchCar(id))}>
          <span className="g-name"><Avatar look={() => car().profile} /><b>{() => nameOf(car().profile)}</b></span>
          <span className="g-meta"><span className="g-shape">{() => car().shape}</span> {() => progress(car())}</span>
          <span className="g-bar" aria={{ ariaHidden: 'true' }} styles={{ '--w': () => `${Math.max(4, (total(car()) / biggest()) * 100)}%` }}>
            {/* «[]» — пустой файл: такие части не рисуем */}
            {PARTS.map(([kind, key]) => <i className={kind} hidden={() => part(key) <= 2} styles={{ flex: () => String(part(key)) }} />)}
          </span>
          <span className="g-size">{() => kb(total(car()))}</span>
        </button>
      )}>
      {() => (
        <div className="g-tile g-ask pending" aria={{ role: 'group', ariaLabel: `Пересесть в «${nameOf(untracked(car).profile)}»` }}>
          <DraftQuestion />
        </div>
      )}
    </Show>
  );
}

function NewTile(): Node {
  return (
    <Show when={() => ask.value?.at === 'new'}
      fallback={() => (
        <button className="g-tile g-new" data-new="" disabled={() => busy.value || full()} onClick={() => leave('new', newCar)}>
          {() => (full() ? `Полка полна: ${MAX_CARS} машин` : '+ Новая машина')}
        </button>
      )}>
      {() => <div className="g-tile g-ask pending" aria={{ role: 'group', ariaLabel: 'Новая машина' }}><DraftQuestion /></div>}
    </Show>
  );
}

// ── под полкой ──

function Files(): Node {
  const files = () => {
    const car = selected();
    if (!car) return [];
    return Object.entries({ 'car.json': car.bytes.car, 'history.json': car.bytes.history, 'runs.json': car.bytes.runs ?? 0 })
      .map(([name, size]) => ({ path: `cars/${car.id}/${name}`, size }));
  };
  return (
    <details className="g-files-box">
      <summary>Файлы машины</summary>
      <ul className="g-files" id="gFiles">
        <For each={files} by={(file) => file.path}>
          {(file) => <li><code>{() => file().path}</code><span>{() => kb(file().size)}</span></li>}
        </For>
      </ul>
    </details>
  );
}

function Meter(): Node {
  const used = () => shelf().cars.reduce((sum, car) => sum + total(car), 0);
  const share = () => Math.min(100, Math.max(1, (shelf().usage / shelf().quota) * 100));
  const copied = () => shelf().disk.state === 'on';
  const safe = () => shelf().safe && shelf().kind !== 'local';
  const where = () => {
    const g = shelf();
    if (g.kind === 'local') return `Гараж лежит в памяти браузера (localStorage): места там мало, около 5 МБ.${copied() ? '' : ' Важные машины сохраняй в файл.'}`;
    if (g.safe) return 'Защищено от удаления: браузер не сотрёт гараж сам — только если ты очистишь данные сайта.';
    return `Если на диске кончится место, браузер может стереть гараж.${copied() ? '' : ' Важные машины сохраняй в файл.'}`;
  };
  return (
    <div className="g-meter" id="gMeter">
      <p>Занято <b>{() => kb(used())}</b><span className="note">{() => (shelf().quota ? ` · браузер даёт сайту до ${kb(shelf().quota)}` : '')}</span></p>
      <Show when={() => shelf().quota}>
        {() => <span className="g-track" aria={{ ariaHidden: 'true' }}><i styles={{ inlineSize: () => `${share()}%` }} /></span>}
      </Show>
      <p className={() => (safe() ? 'note g-safe' : 'note')}>{where}</p>
    </div>
  );
}

/** Копия в папке на диске: только в Chrome и Edge — там, где браузер умеет давать сайту папку */
function Disk(): Node {
  const disk = () => shelf().disk;
  const is = (now: string) => () => disk().state === now;
  const folder = () => <b>{() => disk().name}</b>;
  const button = (kind: 'choose' | 'allow' | 'stop', label: string, primary = false) => (
    <button className={primary ? 'btn small primary' : 'btn small'} data-disk={kind} disabled={busy}
      onClick={() => act({ choose: chooseFolder, allow: allowFolder, stop: stopFolder }[kind])}>{label}</button>
  );
  return (
    <div className="g-disk" id="gDisk" hidden={() => !disk().supported}>
      <Show when={is('off')}>
        {() => (
          <>
            <p className="note">Можно держать копию гаража в обычной папке на диске: её не сотрёт очистка браузера. Потеряются машины — выбери эту папку снова, и они вернутся из неё на полку.</p>
            <div className="row">{button('choose', 'Хранить копию в папке на диске')}</div>
          </>
        )}
      </Show>
      <Show when={is('ask')}>
        {() => (
          <>
            <p className="note">Копия гаража — в папке {folder()}. Браузер спрашивает, можно ли снова в неё писать.</p>
            <div className="row">{button('allow', 'Разрешить', true)}{button('stop', 'Перестать копировать')}</div>
          </>
        )}
      </Show>
      <Show when={is('on')}>
        {() => (
          <>
            <p className="note g-safe">Копия — в папке {folder()} на диске: каждая машина там папкой <code>cars/…</code>, её не сотрёт очистка браузера.</p>
            <div className="row">{button('stop', 'Перестать копировать')}</div>
          </>
        )}
      </Show>
      <Show when={() => disk().note}>{() => <p className="error">{() => disk().note}</p>}</Show>
    </div>
  );
}

export function Garage(): Node {
  const biggest = () => Math.max(1, ...shelf().cars.map(total));
  const asksRow = (kind: Ask['kind']) => () => ask.value?.at === 'row' && ask.value.kind === kind;
  return (
    <section className="block garage" aria={{ ariaLabelledby: 'gTitle' }}>
      <h2 id="gTitle">Гараж</h2>
      <p className="hint">У каждой машины свой облик, сборка, мозг, «История» и заезды. Учишь, проверяешь и сдаёшь ту, что выбрана, — она жёлтая.</p>
      <div className="g-shelf" id="gShelf" aria={{ role: 'group', ariaLabel: 'Машины гаража', ariaBusy: () => String(busy.value) }}>
        <Show when={() => shelf().ready} fallback={() => <p className="note">Открываю гараж…</p>}>
          {() => (
            <>
              <For each={cars} by={(car) => car.id}>{(car) => <Tile car={car} biggest={biggest} />}</For>
              <NewTile />
            </>
          )}
        </Show>
      </div>
      <p className="g-legend" aria={{ ariaHidden: 'true' }}>
        <span><i />мозг и сборка</span><span><i className="h" />«История»</span><span><i className="r" />мои заезды</span>
      </p>
      <div className="row g-actions" id="gActions" hidden={() => ask.value?.at === 'row'}>
        <button className="btn small" id="gCopy" disabled={() => busy.value || full()} onClick={() => leave('row', copyCar)}>Скопировать</button>
        <button className="btn small" id="gExport" disabled={busy} onClick={() => act(exportToFile)}>Сохранить в файл</button>
        <label className={() => (busy.value || full() ? 'btn small file off' : 'btn small file')}>
          Открыть из файла
          <input type="file" id="gImport" accept=".json,application/json" disabled={() => busy.value || full()} onChange={(e) => importFromFile(e.currentTarget)} />
        </label>
        <button className="btn small danger" id="gDelete" disabled={() => busy.value || shelf().cars.length <= 1}
          title={() => (shelf().cars.length <= 1 ? 'Последнюю машину удалить нельзя' : '')}
          onClick={() => (ask.value = { at: 'row', kind: 'delete', run: () => deleteCar(garage.id) })}>Удалить</button>
      </div>
      <div className="pending g-confirm" id="gConfirm" aria={{ role: 'group', ariaLabel: 'Подтверди' }} hidden={() => ask.value?.at !== 'row'}>
        <Show when={asksRow('delete')}>{() => <DeleteQuestion />}</Show>
        <Show when={asksRow('draft')}>{() => <DraftQuestion />}</Show>
      </div>
      <p className="error" id="gError" aria={{ role: 'alert' }} hidden={() => !shelf().error}>{() => shelf().error}</p>
      <Files />
      <Meter />
      <Disk />
    </section>
  );
}
