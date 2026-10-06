// «Профиль», сборка за очки (#19): глаза вперёд и назад, слои мозга, как он думает.
// Сборку меняешь черновиком: машина на трассе и табло мозга сразу показывают, что получится, а в сборку
// всё уходит разом — по «Применить». «Отменить» возвращает как было.
import { signal, For } from '@reely/dommy';
import { rays, rayCount, BACK_SPREAD } from '../../engine/world/car.ts';
import { LIMITS, inputCount, OUTPUTS } from '../../engine/net/brain.ts';
import { BUDGET, PRICES, cost } from '../../engine/course/build.ts';
import { state, sizesOf, on } from '../state.ts';
import { live } from '../student-code.ts';
import { changeShape } from '../library.ts';
import { fromEvents } from '../signals.ts';

export type Shape = typeof state.config;
type SensorKey = 'count' | 'spread' | 'length' | 'back' | 'backLength' | 'backSpread';

/** Варианты мозга из think.js: поправили код — список другой */
const variants = fromEvents(['code'], (): Record<string, { title?: string; hint?: string }> => live.think.thinkVariants ?? {});

/** Сборка машины. Если её варианта мозга больше нет (поправили think.js) — берём «Ступеньку» */
function currentShape(): Shape {
  const all = live.think.thinkVariants ?? {};
  if (!all[state.config.think]) state.config.think = all.step ? 'step' : Object.keys(all)[0];
  return state.config;
}
/** Сборка в машине (вариант мозга на «Учится само» тоже меняют через changeShape — придёт config) */
export const config = fromEvents(['config', 'car', 'code'], currentShape);
/** Обученный мозг (или null) */
export const champion = fromEvents(['champion', 'car', 'reset'], () => state.champion);

// ── черновик ──

/** Черновик сборки (null — черновика нет, на экране то, что в сборке) */
export const draft = signal<Shape | null>(null);
/** Сборка на экране: черновик, а без него — та, что в машине */
export const shown = (): Shape => draft.value ?? config();
/** Почему не получилось поменять (не хватает очков) */
const warning = signal('');

/** Одна и та же сборка? (сенсоры сравниваем по лучам: дальность назад без сенсоров назад ничего не меняет) */
const same = (a: Shape, b: Shape) => JSON.stringify([rays(a.sensors), a.hidden, a.think]) === JSON.stringify([rays(b.sensors), b.hidden, b.think]);

/** Поменять что-то в черновике. Дороже бюджета нельзя; дешевле — можно всегда, даже если сборка уже дороже. false — не вышло */
function edit(next: Shape): boolean {
  const price = cost(next);
  if (price > BUDGET && price > cost(shown())) {
    warning.value = `Не хватает очков: такая сборка стоит ${price}, а есть ${BUDGET}. Сначала откажись от чего-нибудь.`;
    return false;
  }
  warning.value = '';
  draft.value = same(next, state.config) ? null : next;
  return true;
}

/** Черновик обнулит мозг? (другое число входов или слоёв при обученном мозге) */
export const resets = () => !!draft.value && !!champion() && sizesOf(draft.value).join() !== sizesOf(config()).join();

export function applyDraft(): void {
  const next = draft.peek();
  draft.value = null;
  if (next) changeShape(next); // дальше — событие config: машина пересядет на новую сборку
}
export function dropDraft(): void {
  draft.value = null;
  warning.value = '';
}
on('car', dropDraft); // черновик был у прежней машины (гараж уже спросил, что с ним делать)

function draftText(): string {
  if (!champion()) return 'Мозг ещё не обучен — терять нечего. Применишь — учиться он будет уже с этой сборкой.';
  if (resets()) return `Сеть станет ${sizesOf(draft.value ?? config()).join('-')}. Нынешний мозг под неё не подходит — учиться придётся с нуля (он останется в «Истории»).`;
  return 'Форма сети та же: мозг уже едет с новой сборкой — смотри на трассе. Применить?';
}

// ── глаза ──

/** Сенсоры на экране со всеми полями: у сборки без сенсоров назад их нет */
const sensors = () => ({ back: 0, backLength: 80, backSpread: BACK_SPREAD, ...shown().sensors });

/** Поменять один ползунок. Сенсоры назад без дальности бессмысленны: включили первый — дадим короткие */
function setSensor(key: SensorKey, value: number): boolean {
  const shape = shown();
  const next = { ...shape.sensors, [key]: value };
  return edit({ ...shape, sensors: next.back ? { backLength: 80, backSpread: BACK_SPREAD, ...next } : next });
}

type SliderProps = { id: string; label: string; sensor: SensorKey; min: number; max: number; step: number; format: (v: number) => string; off?: () => boolean };

function Slider({ id, label, sensor, min, max, step, format, off }: SliderProps): Node {
  const value = () => sensors()[sensor];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input type="range" id={id} min={String(min)} max={String(max)} step={String(step)}
        value={() => String(value())} disabled={off ?? false}
        onInput={(e) => {
          // не хватило очков — ползунок возвращается туда, где был
          if (!setSensor(sensor, +e.currentTarget.value)) e.currentTarget.value = String(value());
        }} />
      <output id={`${id}Out`}>{() => format(value())}</output>
    </div>
  );
}

// ── мозг: слои и как думает ──

function setLayer(i: number, change: 'minus' | 'plus' | 'del'): void {
  const shape = shown();
  const hidden = [...shape.hidden];
  if (change === 'plus') hidden[i] = Math.min(LIMITS.neuronsMax, hidden[i] + 1);
  if (change === 'minus') hidden[i] = Math.max(LIMITS.neuronsMin, hidden[i] - 1);
  if (change === 'del') hidden.splice(i, 1);
  edit({ ...shape, hidden });
}

function Layers(): Node {
  const layers = () => shown().hidden.map((neurons, i) => ({ neurons, i }));
  return (
    <div className="layers" id="layersEditor">
      <span className="layer fixed" title="сенсоры сейчас, скорость, сенсоры мгновение назад, знак, заметки">
        Входы <b>{() => inputCount(rayCount(shown().sensors))}</b>
      </span>
      <For each={layers} by={(layer) => layer.i}>
        {(layer) => {
          const n = () => layer().i + 1;
          return (
            <>
              <span className="arrow" aria={{ ariaHidden: 'true' }}>→</span>
              <span className="layer">
                Слой {n}
                <button aria={{ ariaLabel: () => `Меньше нейронов в слое ${n()}` }} onClick={() => setLayer(layer().i, 'minus')}>−</button>
                <b>{() => layer().neurons}</b>
                <button aria={{ ariaLabel: () => `Больше нейронов в слое ${n()}` }} onClick={() => setLayer(layer().i, 'plus')}>+</button>
                <button aria={{ ariaLabel: () => `Удалить слой ${n()}` }} onClick={() => setLayer(layer().i, 'del')}>×</button>
              </span>
            </>
          );
        }}
      </For>
      <span className="arrow" aria={{ ariaHidden: 'true' }}>→</span>
      <span className="layer fixed" title="4 кнопки пульта и заметки">Выходы <b>{OUTPUTS}</b></span>
    </div>
  );
}

function Brain(): Node {
  const full = () => shown().hidden.length >= LIMITS.hiddenLayersMax;
  const layerPrice = PRICES.layer + LIMITS.neuronsMin * PRICES.neuron;
  /** Вариант на экране: у черновика может быть вариант, которого уже нет в think.js */
  const think = () => (shown().think in variants() ? shown().think : config().think);
  return (
    <section className="block">
      <h2>Мозг</h2>
      <Layers />
      <button className="btn small" id="addLayer" disabled={full}
        title={() => (full() ? `Больше ${LIMITS.hiddenLayersMax} слоёв не бывает` : `Новый слой из ${LIMITS.neuronsMin} нейронов: ${layerPrice} очков`)}
        onClick={() => edit({ ...shown(), hidden: [...shown().hidden, LIMITS.neuronsMin] })}>
        + Скрытый слой
      </button>
      <div className="field wide">
        <label htmlFor="thinkSelect">Как думает</label>
        <select id="thinkSelect" aria={{ ariaLabel: 'Вариант мозга' }} onChange={(e) => edit({ ...shown(), think: e.currentTarget.value })}>
          <For each={() => Object.entries(variants())} by={([id]) => id}>
            {(variant) => (
              <option value={variant()[0]} selected={() => variant()[0] === think()}>{() => variant()[1].title || variant()[0]}</option>
            )}
          </For>
        </select>
      </div>
      <p className="hint" id="thinkHint">{() => variants()[think()]?.hint ?? ''}</p>
    </section>
  );
}

// ── очки ──

/** Что стоит сколько — для людей */
const PRICE_LIST: [number, string][] = [
  [PRICES.sensor, 'сенсор вперёд'],
  [PRICES.reach, '+10 px дальности вперёд (сверх 80)'],
  [PRICES.back, 'сенсор назад'],
  [PRICES.backReach, '+10 px дальности назад (сверх 40)'],
  [PRICES.neuron, 'нейрон'],
  [PRICES.layer, 'второй и третий скрытый слой'],
];

function Budget(): Node {
  const spent = () => cost(shown());
  return (
    <section className="block build">
      <h2>Сборка</h2>
      <p className="budget">
        <b id="bSpent">{spent}</b> из <span id="bBudget">{BUDGET}</span> очков{' '}
        <span className="note" id="bLeft">{() => (spent() < BUDGET ? `· свободно ${BUDGET - spent()}` : '· всё потрачено')}</span>
      </p>
      <div className="budget-bar" aria={{ ariaHidden: 'true' }}>
        <span id="bBar" styles={{ width: () => `${Math.min(100, (spent() / BUDGET) * 100)}%` }} />
      </div>
      <p className="hint">Очки у всех одни. Больше глаз — дальше видно, больше нейронов — умнее, но рою дольше учиться. Всё сразу не купить: выбирай под трассу.</p>
      <p className="error" id="bMsg" aria={{ role: 'status' }} hidden={() => !warning.value}>{warning}</p>
    </section>
  );
}

/** Сборка целиком: очки, глаза, мозг, цены и черновик — секции панели «Профиля» */
export function Build(): Node {
  const noBack = () => !sensors().back;
  return (
    <>
      <Budget />
      <section className="block">
        <h2>Глаза вперёд</h2>
        <Slider id="sCount" label="Сенсоров" sensor="count" min={LIMITS.sensorsMin} max={LIMITS.sensorsMax} step={1} format={(v) => `${v}`} />
        <Slider id="sSpread" label="Угол обзора" sensor="spread" min={30} max={180} step={10} format={(v) => `${v}°`} />
        <Slider id="sLength" label="Дальность" sensor="length" min={80} max={260} step={10} format={(v) => `${v} px`} />
        <p className="hint">Широкий веер видит бока, узкий — дальше по центру. Угол бесплатный.</p>
      </section>
      <section className="block">
        <h2>Глаза назад</h2>
        <Slider id="sBack" label="Сенсоров" sensor="back" min={0} max={LIMITS.backMax} step={1} format={(v) => (v ? `${v}` : 'нет')} />
        <Slider id="sBackLength" label="Дальность" sensor="backLength" min={40} max={200} step={10} format={(v) => `${v} px`} off={noBack} />
        <Slider id="sBackSpread" label="Угол обзора" sensor="backSpread" min={10} max={180} step={10} format={(v) => `${v}°`} off={noBack} />
        <p className="hint">Видят тех, кто догоняет, — на кольце обгоняют и тебя. Узкий веер смотрит прямо назад, широкий — ещё и на соседние полосы. Угол бесплатный.</p>
      </section>
      <Brain />
      <section className="block">
        <h2>Цены</h2>
        <ul className="prices" id="bPrices">
          {PRICE_LIST.map(([price, what]) => <li><b>{price}</b> {what}</li>)}
        </ul>
      </section>
      <div className="pending draft" id="draftBar" hidden={() => !draft.value}>
        <p id="draftText" aria={{ role: 'status' }}>{draftText}</p>
        <div className="row">
          <button className={() => `btn small ${resets() ? 'danger' : 'primary'}`} id="draftApply" onClick={applyDraft}>Применить</button>
          <button className="btn small" id="draftCancel" onClick={dropDraft}>Отменить</button>
        </div>
      </div>
    </>
  );
}
