// Панель «Учится само» справа: рецепт, поколение, как идёт обучение (график), мозг с «Историей» и рекорды роя.
import { For, Show } from '@reely/dommy';
import { cloneBrain, checkBrain } from '../../engine/net/brain.ts';
import { drawChart } from '../../engine/draw/netviz.ts';
import { sizesOf } from '../state.ts';
import { setBrain } from '../library.ts';
import { showBanner } from '../stage.ts';
import { secs, pct } from '../format.ts';
import { BrainLibrary } from '../components/brain-library.tsx';
import { train, setTrain } from './train-settings.ts';
import { results, pickedCars, clearPicked, errorText, currentSwarm, trackForGeneration } from './train-swarm.ts';
import { MILESTONES, moments, startReplay, stopReplay, currentReplay, type Latest } from './train-timeline.ts';
import type { HallEntry, HistoryEntry } from '../state.ts';
import { Recipe } from './train-recipe.tsx';
import { Rivals } from './train-rivals.tsx';
import { element } from '../dom.ts';

// ── поколение ──

type SliderProps = { id: string; label: string; min: number; max: number; step: number; value: () => number; format: (v: number) => string; set: (v: number) => void };

function Slider({ id, label, min, max, step, value, format, set }: SliderProps): Node {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input type="range" id={id} min={String(min)} max={String(max)} step={String(step)} value={() => String(value())}
        onInput={(e) => set(+e.currentTarget.value)} />
      <output id={`${id}Out`}>{() => format(value())}</output>
    </div>
  );
}

function pickedText(): string {
  if (train().parents === 1) return 'Выбрана машина вручную: она станет родителем следующего поколения.';
  const n = pickedCars().length;
  return `Выбрано вручную: ${n} из 2. ${n === 2 ? 'Эти двое станут родителями.' : 'Второго родителя возьмём лучшего по фитнесу — или щёлкни ещё одну машину.'}`;
}

function Generation(): Node {
  return (
    <section className="block">
      <h2>Поколение</h2>
      <Slider id="tPop" label="Машин" min={10} max={300} step={10} value={() => train().population} format={String}
        set={(v) => setTrain('population', v)} />
      <Slider id="tRate" label="Сила мутации" min={0} max={0.5} step={0.01} value={() => train().rate} format={(v) => v.toFixed(2)}
        set={(v) => setTrain('rate', v)} />
      <p className="hint">Сила мутации — сколько чисел у детей меняется (у «Лёгкого шума» — насколько сильно).</p>
      <div className="pending" id="pickedBar" hidden={() => !pickedCars().length}>
        <p id="pickedText">{pickedText}</p>
        <button className="btn small" id="pickedCancel" onClick={clearPicked}>Отменить выбор</button>
      </div>
      <div className="error" id="tError" hidden={() => !errorText()}>{errorText}</div>
    </section>
  );
}

// ── обучение: цифры и график ──

let chart: HTMLCanvasElement | null = null;
let drawnHistory: HistoryEntry[] | null = null;

/** Нарисовать график, если пришли новые поколения (force — всё равно: сменились размер или тема). Зовёт кадр вкладки */
export function drawSwarmChart(force = false): void {
  const { history } = results();
  if (!chart || (!force && history === drawnHistory)) return; // в турбо поколений бывает несколько за кадр — рисуем раз
  drawnHistory = history;
  drawChart(chart, history);
}

function Learning(): Node {
  const last = () => results().history.at(-1);
  const best = () => {
    const entry = last();
    if (!entry) return '—';
    return entry.finished ? `финиш за ${secs(entry.ticks)}` : `${pct(entry.progressPct)} трассы`;
  };
  // сколько машин ехало в том поколении, а не сколько стоит на ползунке сейчас
  const finishers = () => {
    const entry = last();
    return entry ? `${entry.finishers} из ${entry.population ?? train().population}` : '—';
  };
  return (
    <section className="block">
      <h2>Обучение</h2>
      <dl className="stats">
        <div><dt>Лучший</dt><dd id="stBest">{best}</dd></div>
        <div><dt>Доехали</dt><dd id="stFin">{finishers}</dd></div>
      </dl>
      <canvas id="chart" className="chart" aria={{ ariaLabel: 'График фитнеса по поколениям' }} elementRef={(canvas) => (chart = canvas)} />
      <p className="legend" id="chartLegend" hidden={() => !results().history.length}>
        <span className="sw line" />лучший фитнес <span className="sw dash" />середина роя <span className="sw dot" />лучший доехал
      </p>
      <p className="hint">Одна точка — одно поколение. Линия ползёт вверх — рой учится. Ровная — рою нечему учиться при таком фитнесе.</p>
    </section>
  );
}

// ── машина времени ──

function TimeMachine(): Node {
  // results() — чтобы перечитать снимки в конце поколения; лучший роя сейчас — у самого роя
  const latest = (): Latest => {
    void results();
    const evo = currentSwarm();
    return evo?.parent ? { gen: evo.generation, brain: evo.parent } : null;
  };
  const list = () => moments(results().timeline, latest());
  const toggle = () => {
    if (currentReplay()) return stopReplay();
    startReplay(trackForGeneration(0), latest());
    element('.stage').scrollIntoView({ block: 'start' }); // панель длинная: заезд — на трассе, её надо видеть
  };
  return (
    <section className="block" id="timeMachine">
      <h2>Машина времени</h2>
      <p className="hint">
        Лучшие роя из разных поколений едут вместе по трассе урока — видно, как рой учился.
        Рой запоминает поколения {MILESTONES.slice(0, 4).join(', ')}, {MILESTONES[4]}…
      </p>
      <Show when={() => list().length > 0} fallback={() => <p className="hint" id="tMomentsEmpty">Нажми «Старт»: первое поколение роя запомнится само.</p>}>
        {() => (
          <ol className="moments" aria={{ ariaLabel: 'Запомненные поколения' }}>
            <For each={list} by={(m) => (m.now ? 'now' : m.gen)}>
              {(m) => <li data-now={() => String(m().now)}>{() => (m().now ? `сейчас · ${m().gen}` : String(m().gen))}</li>}
            </For>
          </ol>
        )}
      </Show>
      <button className="btn" id="tTimeMachine" disabled={() => !currentReplay() && list().length < 2} onClick={toggle}>
        {() => (currentReplay() ? 'Вернуться к рою' : 'Показать заезд')}
      </button>
    </section>
  );
}

// ── рекорды роя ──

function takeRecord(record: HallEntry): void {
  if (checkBrain(record.brain, sizesOf())) return showBanner('Этот мозг от другой архитектуры сети');
  setBrain(cloneBrain(record.brain), { by: 'hall', generation: record.gen });
  showBanner(`Текущий мозг — рекорд поколения ${record.gen}. Прежний — в «Истории»`, 2800);
}

function HallRow({ record }: { record: () => HallEntry }): Node {
  return (
    <li>
      <span>
        <span className="meta">пок. {() => record().gen}</span> · {() => record().trackName} ·{' '}
        <span className="meta">{() => (record().finished ? secs(record().ticks) : pct(record().progressPct))}</span>
      </span>
      <button className="btn small" onClick={() => takeRecord(record())}>Взять</button>
    </li>
  );
}

function Hall(): Node {
  // у рекорда нет своего id: строка — место в списке, а что в ней, строка перечитает сама
  const rows = () => results().hall.map((record, place) => ({ record, place }));
  return (
    <section className="block">
      <h2>Рекорды роя</h2>
      <ol className="hall" id="hall">
        <Show when={() => rows().length > 0} fallback={() => <li className="empty">Здесь появятся рекорды: лучший результат на каждой трассе.</li>}>
          {() => <For each={rows} by={(row) => row.place}>{(row) => <HallRow record={() => row().record} />}</For>}
        </Show>
      </ol>
    </section>
  );
}

/** Панель целиком */
export function TrainPanel(): Node {
  return (
    <>
      <Recipe />
      <Generation />
      <Rivals />
      <Learning />
      <TimeMachine />
      <section className="block library"><BrainLibrary /></section>
      <Hall />
    </>
  );
}
