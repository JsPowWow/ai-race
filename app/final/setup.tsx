// Панель финала, шаги 1 и 2: работы участников (файлы, ключ, замечания, аватары) и секретная фраза с расчётом.
// Эти секции прячутся в режиме трансляции (класс setup, см. app/styles/final.css).
import { For, Show } from '@reely/dommy';
import type { ReelyNode } from '@reely/dommy';
import { avatarUrl } from '../../engine/car-file.ts';
import { readFileList } from './entries.ts';
import type { FinalEntry } from './entries.ts';
import {
  pool, allowed, racers, avatarsOn, hiddenAvatars, keyNote, newKeysNote,
  loadFiles, chooseKey, makeNewKeys, toggleAllowed, toggleAvatar,
} from './works.ts';
import { calc, computing, progress, computeNote, secret, compute, troubles } from './calc.ts';

/** Выбрали файлы в <input type="file">: читаем и очищаем поле — тот же выбор ещё раз снова даст change */
function pick(input: HTMLInputElement, use: (files: FileList) => void): void {
  const { files } = input;
  if (files?.length) use(files);
  input.value = '';
}

/** Раскрывающийся список замечаний: заголовок, пояснение и строки */
function Notes<T>(props: { title: () => string; hint?: string; warn?: boolean; open?: boolean; items: () => T[]; by: (item: T) => string; children: (item: () => T) => ReelyNode }): Node {
  return (
    <details className="notes" open={props.open ?? false}>
      <summary className={props.warn ? 'warn' : ''}>{props.title}</summary>
      {props.hint ? <p className="hint">{props.hint}</p> : null}
      <ul>
        <For each={props.items} by={props.by}>{(item) => <li>{props.children(item)}</li>}</For>
      </ul>
    </details>
  );
}

const Who = ({ entry }: { entry: () => FinalEntry }): Node => <b>{() => entry().author}</b>;

/** Что нашлось в папке: запечатанные, замечания, одинаковые и похожие мозги, чужие файлы */
function Findings(): Node {
  const p = () => pool.value;
  return (
    <div id="fNotes">
      <Show when={() => p().sealed || p().entries.length}>
        {() => (
          <p className="hint">
            {() => `Запечатанных файлов: ${p().sealed}, открыто: ${p().opened}`}
            <Show when={() => p().locked}>{() => <> · <b className="warn">{() => `ждут секретный ключ: ${p().locked}`}</b></>}</Show>
            {() => `. Незапечатанных работ: ${p().entries.filter((e) => !e.sealed).length}.`}
          </p>
        )}
      </Show>
      <Show when={() => p().problems.length}>
        {() => (
          <Notes title={() => `Замечания: ${p().problems.length}`} items={() => p().problems} by={(x) => `${x.path}|${x.message}`}>
            {(x) => <><code>{() => x().path}</code> — {() => x().message}</>}
          </Notes>
        )}
      </Show>
      <Show when={() => p().twins.length}>
        {() => (
          <Notes title={() => `Одинаковый мозг: групп ${p().twins.length}`} items={() => p().twins} by={(group) => group[0].id}
            hint="Одинаковые файлы едут одинаково и делят место. Обычно это скопированный или несданный «по умолчанию» мозг.">
            {(group) => () => `${group().length} × ${group().map((e) => e.author).join(', ')}`}
          </Notes>
        )}
      </Show>
      <Show when={() => p().foreign.length}>
        {() => (
          <Notes title={() => `Чужой файл? ${p().foreign.length}`} warn open items={() => p().foreign} by={(e) => e.id}
            hint="Логин внутри печати не совпадает с автором работы. Это кража чужого файла или опечатка в логине. Такие работы не едут, пока вы их не допустите.">
            {(entry) => (
              <>
                <Who entry={entry} /> сдал файл, запечатанный для <b>{() => entry().claimed}</b>
                <button className="btn small" data-allow={entry().id} onClick={() => toggleAllowed(entry().id)}>
                  {() => (allowed.value.has(entry().id) ? 'Снять допуск' : 'Допустить')}
                </button>
              </>
            )}
          </Notes>
        )}
      </Show>
      <Show when={() => p().similar.length}>
        {() => (
          <Notes title={() => `Похожие мозги: пар ${p().similar.length}`} items={() => p().similar.slice(0, 100)} by={(pair) => `${pair.a.id}~${pair.b.id}`}
            hint="Веса почти совпадают (сходство выше 97%): похоже, один файл скопировали и чуть-чуть поправили. Независимо обученные сети так не совпадают.">
            {(pair) => () => `${pair().a.author} ~ ${pair().b.author} — ${Math.floor(pair().similarity * 1000) / 10}%`}
          </Notes>
        )}
      </Show>
      <Show when={() => p().skipped}>
        {() => <p className="hint">{() => `Пропущено файлов, не похожих на машину: ${p().skipped}.`}</p>}
      </Show>
    </div>
  );
}

/** Аватары перед стримом: щелчок прячет картинку на трансляции */
function Gallery(): Node {
  const withAvatar = () => pool.value.entries.filter((e) => e.avatar);
  return (
    <details id="fGalleryBox" hidden={() => !withAvatar().length}>
      <summary>Аватары — проверить перед стримом</summary>
      <p className="hint">Щёлкни картинку, чтобы скрыть её на трансляции.</p>
      <div className="gallery" id="fGallery">
        <For each={withAvatar} by={(e) => e.id}>
          {(entry) => {
            const id = entry().id; // id — ключ строки, у неё он не меняется
            const hidden = () => hiddenAvatars.value.has(id);
            return (
              <button data-av={id} className={() => (hidden() ? 'off' : '')} title={() => entry().author} onClick={() => toggleAvatar(id)}>
                {/* картинка через <img>: скрипты из SVG так не выполняются */}
                <img className="avatar" src={() => avatarUrl(entry().avatar) ?? ''} alt="" loading="lazy" />
                <span>{() => entry().author}</span>
              </button>
            );
          }}
        </For>
      </div>
    </details>
  );
}

function Works(): Node {
  return (
    <section className="block setup">
      <h2>1 · Работы</h2>
      <div className="row">
        <label className="btn small file">Открыть папку
          <input type="file" id="fFolder" webkitdirectory multiple onChange={(e) => pick(e.currentTarget, (files) => loadFiles(readFileList(files)))} />
        </label>
        <label className="btn small file">Файлы .json
          <input type="file" id="fFiles" accept=".json,application/json" multiple onChange={(e) => pick(e.currentTarget, (files) => loadFiles(readFileList(files)))} />
        </label>
        <label className="btn small file">🔑 Секретный ключ
          <input type="file" id="fKey" accept=".json,application/json" onChange={(e) => pick(e.currentTarget, ([file]) => chooseKey(file))} />
        </label>
      </div>
      <p className={() => (keyNote.value.error ? 'note error' : 'note')} id="fKeyNote" aria={{ role: 'status' }}>{() => keyNote.value.text}</p>
      <p className="hint">Папка с работами: после <code>tools/collect-entries.mjs</code> или <code>gh classroom clone</code> — «ник/car.sealed.json». Можно перетащить её прямо на трассу. Запечатанные работы откроются, когда выберете секретный ключ курса.</p>
      <dl className="stats">
        <div><dt>Участников</dt><dd id="fCount">{() => racers().length}</dd></div>
        <div><dt>Свой код</dt><dd id="fCode">{() => pool.value.entries.filter((e) => e.code).length}</dd></div>
        <div><dt>Одинаковых</dt><dd id="fTwins">{() => pool.value.twins.reduce((n, g) => n + g.length, 0)}</dd></div>
      </dl>
      <Findings />
      <label className="check">
        <input type="checkbox" id="fAvatars" checked={avatarsOn} onChange={(e) => (avatarsOn.value = e.currentTarget.checked)} /> Показывать аватары
      </label>
      <details className="notes">
        <summary>Ключи курса</summary>
        <p className="hint">Студенты запечатывают файл для сдачи открытым ключом курса из <code>course-key.json</code> в репозитории. Открыть его можно только секретным ключом — он хранится у кураторов, в репозиторий его не кладут. Секретный ключ используется только здесь, в браузере, и никуда не отправляется.</p>
        <p className="hint">Новые ключи нужны, только если секретный потерялся или утёк. После этого замените <code>course-key.json</code>, пересоберите сайт (<code>npm run build</code>), а студенты пересдают работы.</p>
        <button className="btn small" id="fNewKeys" onClick={makeNewKeys}>Создать новые ключи курса</button>
        <p className="note" id="fNewKeysNote" aria={{ role: 'status' }}>{newKeysNote}</p>
      </details>
      <Gallery />
    </section>
  );
}

/** Кто снят и у кого ошибка в коде — после расчёта */
function Troubles(): Node {
  const found = () => (calc.value ? troubles(calc.value) : { hung: [], broken: [] });
  const list = (title: string, items: () => { entry: FinalEntry; why: string }[]) => (
    <Show when={() => items().length}>
      {() => (
        <Notes title={() => `${title}: ${items().length}`} items={items} by={(x) => x.entry.id}>
          {(x) => <><Who entry={() => x().entry} /> — {() => x().why}</>}
        </Notes>
      )}
    </Show>
  );
  return (
    <div id="fDq">
      {list('Сняты (код завис)', () => found().hung)}
      {list('Ошибка в коде (едут со штрафом)', () => found().broken)}
    </div>
  );
}

function Secret(): Node {
  return (
    <section className="block setup">
      <h2>2 · Секретная фраза</h2>
      <div className="field wide">
        <label htmlFor="fSecret">Фраза</label>
        <input type="text" id="fSecret" maxLength={60} placeholder="Придумайте и никому не говорите" autocomplete="off"
          value={secret} onInput={(e) => (secret.value = e.currentTarget.value)} />
      </div>
      <p className="hint">Из неё получаются трассы трёх этапов и суперфинала. Объявите фразу после гонки — любой сможет перепроверить свой результат.</p>
      <button className="btn primary" id="fCompute" disabled={() => !racers().length || !!computing.value} onClick={compute}>Посчитать финал</button>
      <progress id="fProgress" max={1} value={() => progress.value ?? 0} hidden={() => progress.value === null} />
      <p className="note" id="fComputeNote" aria={{ role: 'status' }}>{computeNote}</p>
      <Troubles />
    </section>
  );
}

/** Шаги 1 и 2 панели финала */
export function Setup(): Node {
  return (
    <>
      <Works />
      <Secret />
    </>
  );
}

