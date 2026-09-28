// Блок «Мозг»: какой мозг сейчас, «Сбросить мозг» и его «История». Одинаковый на «Я учу» и «Учится само».
// Что делают кнопки — в app/library.js; здесь только вид.
import { signal, For, Show } from '@reely/dommy';
import { state, sizesOf, thinkVariant, brainTitle } from './state.js';
import { HISTORY_MAX, resetBrain, restoreVersion, togglePin, removeVersion } from './library.js';
import { fromEvents } from './signals.ts';

/** Версия мозга в «Истории» (см. remember() в app/library.js) */
type Version = { id: string; at: string; config: typeof state.config; brainNote: string; pinned: boolean };

/** Текущий мозг и «История»: перечитываем, когда меняется мозг, форма или сама история */
const brain = fromEvents(['champion', 'config', 'library', 'car', 'reset'], () => ({
  trained: !!state.champion,
  title: brainTitle(),
  config: state.config,
  // каждый раз новые объекты: так строки списка узнают, что версию закрепили
  versions: (state.versions as Version[]).map((v) => ({ ...v })),
}));
/** «История» раскрыта — помним и между вкладками */
const historyOpen = signal(false);

const shapeOf = (config: typeof state.config) => `${sizesOf(config).join('-')} · ${thinkVariant(config.think)?.title ?? config.think}`;
const when = (iso: string) => new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Значок «закрепить»: звезда; у закреплённой версии закрашена (стили — app/styles/teach.css) */
const PinIcon = (): Node => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  </svg>
);

function VersionRow({ version }: { version: () => Version }): Node {
  const pinLabel = () => (version().pinned ? 'Открепить' : 'Закрепить навсегда');
  return (
    <li className={() => (version().pinned ? 'pinned' : '')}>
      <button className="pin" title={pinLabel} aria={{ ariaLabel: pinLabel, ariaPressed: () => String(version().pinned) }}
        onClick={() => togglePin(version().id)}>
        <PinIcon />
      </button>
      <span className="lib-name">
        <b>{() => version().brainNote || 'мозг'}</b>
        <span className="meta">{() => `${shapeOf(version().config)} · ${when(version().at)}`}</span>
      </span>
      <button className="btn small" onClick={() => restoreVersion(version().id)}>Вернуть</button>
      <button className="lib-del" aria={{ ariaLabel: 'Удалить версию' }} onClick={() => removeVersion(version().id)}>×</button>
    </li>
  );
}

/** Содержимое блока — кладётся в <section className="block library"> */
export function BrainLibrary(): Node {
  const confirming = signal(false); // у каждого блока свой вопрос «точно сбросить?»
  const count = () => brain().versions.length;
  return (
    <>
      <h2>Мозг</h2>
      <p className="lib-current">
        <Show when={() => brain().trained}
          fallback={() => <span className="meta">{() => `Мозга пока нет — начнём с нуля (${shapeOf(brain().config)}).`}</span>}>
          {() => (
            <>
              <b>{() => brain().title}</b>
              <span className="meta">{() => shapeOf(brain().config)}</span>
            </>
          )}
        </Show>
      </p>
      <Show when={confirming}
        fallback={() => (
          <div className="row">
            <button className="btn small" disabled={() => !brain().trained} onClick={() => (confirming.value = true)}>Сбросить мозг</button>
          </div>
        )}>
        {() => (
          <div className="pending">
            <p>Мозг начнётся с нуля: веса станут случайными. Нынешний останется в «Истории».</p>
            <div className="row">
              <button className="btn small danger" onClick={() => {
                confirming.value = false;
                resetBrain();
              }}>Сбросить</button>
              <button className="btn small" onClick={() => (confirming.value = false)}>Отмена</button>
            </div>
          </div>
        )}
      </Show>
      <details className="history" hidden={() => !count()} open={historyOpen}
        onToggle={(e) => (historyOpen.value = e.currentTarget.open)}>
        <summary>{() => `История · ${count()}`}</summary>
        <p className="hint">Перед каждым обучением, стартом роя, ручной правкой и сбросом мозг сохраняется сам. Звёздочка — закрепить версию навсегда, остальные хранятся {HISTORY_MAX} последних.</p>
        <ol className="lib-list">
          <For each={() => brain().versions} by={(v) => v.id}>{(version) => <VersionRow version={version} />}</For>
        </ol>
      </details>
    </>
  );
}
