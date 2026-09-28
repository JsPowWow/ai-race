// «Мозг под микроскопом» на вкладке «Я учу»: подсветка работы нейронов и ручная правка весов.
// Схема — холст (рисует render(), в том числе из кадрового цикла), подписи и ползунок — компонент dommy.
import { signal } from '@reely/dommy';
import { createBrain, OUTPUT_LABELS, inputLabel } from '../../engine/brain.ts';
import type { Brain } from '../../engine/brain.ts';
import { drawNetwork, hitNetwork } from '../../engine/netviz.ts';
import type { NetLayout, NetPick, Trace } from '../../engine/netviz.ts';
import { mulberry32 } from '../../engine/utils.ts';
import { state, sizesOf, setChampion } from '../state.ts';
import { remember } from '../library.ts';

/** Где курсор или палец на экране */
type Spot = { clientX: number; clientY: number };

type MicroscopeOptions = {
  /** Что «горит» в сети прямо сейчас (или null — мозг не едет) */
  trace: () => Trace | null;
  /** Вес поправили руками — мозг стал другим */
  onEdit: () => void;
};

/** Блок «Мозг под микроскопом»: View — сам блок, render() — перерисовать схему, reset() — забыть выбор (другая форма сети) */
export function createMicroscope({ trace, onEdit }: MicroscopeOptions) {
  let net: HTMLCanvasElement | null = null;
  let slider: HTMLInputElement | null = null;
  let preview: Brain | null = null; // случайная сеть, пока своего мозга нет
  let layout: NetLayout | null = null;
  let picked: NetPick | null = null; // что выбрали щелчком
  let hovered: NetPick | null = null; // что под курсором
  // на телефоне «микроскоп» свёрнут: панель и так длинная
  const open = signal(!matchMedia('(max-width: 700px)').matches);
  const canPick = signal(false);
  const note = signal('');
  // выбранный вес: значение (null — ничего не выбрано), имя и что он значит
  const value = signal<number | null>(null);
  const title = signal('');
  const explain = signal('');

  /** Какой мозг показываем: текущий, а пока его нет — случайный (его тоже можно править) */
  function shownBrain(): Brain {
    if (state.champion) return state.champion;
    preview ??= createBrain(sizesOf(), mulberry32(7));
    return preview;
  }

  function render(): void {
    const brain = shownBrain();
    const now = trace();
    if (net && open.peek()) layout = drawNetwork(net, brain, now, picked, hovered); // свёрнутый — не рисуем
    note.value = noteText(now);
    const weight = picked && read(brain, picked);
    value.value = weight ?? null;
    if (picked && weight !== null) {
      const about = describe(brain, picked, weight, now);
      title.value = about.title;
      explain.value = about.explain;
    }
  }

  // ── правка ──

  /** Первая правка после обучения: сперва отложим мозг целым в «Историю», чтобы можно было вернуть.
   *  Дальше мозг уже «поправлен руками» — следующие правки той же серии в «Историю» не кладём */
  function beforeEdit(): void {
    if (state.champion && !state.handEdited) remember();
  }

  /** Правка руками превращает показанную сеть в «мой мозг» */
  function commit(brain: Brain): void {
    setChampion(brain, { by: 'editor', handEdited: true });
    if (brain === preview) preview = null;
    onEdit();
    render();
  }

  function setWeight(next: number): void {
    if (!picked) return;
    const brain = shownBrain();
    beforeEdit();
    write(brain, picked, next);
    commit(brain);
  }

  function zeroAll(): void {
    const brain = shownBrain();
    beforeEdit();
    for (const layer of brain.layers) {
      layer.biases.fill(0);
      for (const row of layer.weights) row.fill(0);
    }
    commit(brain);
  }

  function randomAll(): void {
    const brain = shownBrain();
    beforeEdit();
    const fresh = createBrain(sizesOf());
    brain.layers.forEach((layer, k) => Object.assign(layer, fresh.layers[k]));
    commit(brain);
  }

  // ── мышь и палец на схеме ──

  /** Что на схеме под курсором (в CSS-пикселях холста) */
  function hitAt(e: Spot): NetPick | null {
    if (!net) return null;
    const rect = net.getBoundingClientRect();
    return hitNetwork(layout, shownBrain(), e.clientX - rect.left, e.clientY - rect.top);
  }

  function hover(e: Spot | null): void {
    const hit = e && hitAt(e);
    canPick.value = !!hit;
    if (JSON.stringify(hit) === JSON.stringify(hovered)) return;
    hovered = hit;
    render();
  }

  function pick(e: Spot): void {
    picked = hitAt(e);
    render();
    if (picked) slider?.focus({ preventScroll: true });
  }

  function View(): Node {
    return (
      <details className="block fold" open={open} onToggle={(e) => {
        open.value = e.currentTarget.open;
        if (open.value) render(); // пока был свёрнут, схему не рисовали
      }}>
        <summary><h2>Мозг под микроскопом</h2></summary>
        <canvas id="netCanvas" className={() => (canPick.value ? 'net can-pick' : 'net')}
          aria={{ ariaLabel: 'Схема нейросети: щёлкни связь или нейрон, чтобы поменять вес' }}
          elementRef={(el) => (net = el)}
          onPointermove={hover} onPointerleave={() => hover(null)} onClick={pick} />
        <p className="legend"><span className="sw pos" />положительный вес <span className="sw neg" />отрицательный <span className="sw act" />нейрон сработал</p>
        <div className="wedit" id="wEdit">
          <p id="wLabel" className="hint" hidden={() => value.value !== null}>Щёлкни связь или нейрон на схеме, чтобы поменять вес руками. Попробуй: удали скрытый слой, нажми «Все веса в ноль», опусти порог «Газа» ниже нуля — и научи машину отворачивать от бордюров.</p>
          <div className="field" id="wRow" hidden={() => value.value === null}>
            <label htmlFor="wVal" id="wName">{title}</label>
            {/* значение приходит сюда после каждой правки — то же, что уже на ползунке, так что тянуть его не мешает */}
            <input type="range" id="wVal" min="-1" max="1" step="0.01" value={() => String(value.value ?? 0)}
              elementRef={(el) => (slider = el)} onInput={(e) => setWeight(+e.currentTarget.value)} />
            <output id="wValOut">{() => fixed(value.value ?? 0)}</output>
          </div>
          <p className="hint" id="wExplain" hidden={() => value.value === null}>{explain}</p>
          <div className="row">
            <button className="btn small" id="wZero" onClick={zeroAll}>Все веса в ноль</button>
            <button className="btn small" id="wRandom" onClick={randomAll}>Случайные веса</button>
          </div>
        </div>
        <p className="hint" id="netNote">{note}</p>
      </details>
    );
  }

  return {
    View,
    render,
    /** Форма сети поменялась — старая схема и выбор больше не годятся */
    reset(): void {
      preview = null;
      picked = hovered = null;
    },
  };
}

function noteText(trace: Trace | null): string {
  if (!state.champion) return 'Пока мозга нет — это случайные веса. Поменяй любой вес, и он станет твоим мозгом. Или обучи его на своих заездах.';
  if (state.handEdited) return 'Мозг поправлен руками. Рой на «Учится само» продолжит с него.';
  return trace ? 'Текущий мозг. Кружки загораются, когда нейрон срабатывает.' : 'Текущий мозг. Включи «Едет мозг», чтобы увидеть, как он думает.';
}

// ── чтение и описание весов ──

const fixed = (x: number) => (Math.round(x * 100) / 100).toFixed(2);

/** Вес связи или порог нейрона (null — такого больше нет: форма сети поменялась) */
function read(brain: Brain, sel: NetPick): number | null {
  const layer = brain.layers[sel.k];
  if (!layer) return null;
  return (sel.type === 'w' ? layer.weights[sel.i]?.[sel.j] : layer.biases[sel.j]) ?? null;
}

function write(brain: Brain, sel: NetPick, value: number): void {
  if (sel.type === 'w') brain.layers[sel.k].weights[sel.i][sel.j] = value;
  else brain.layers[sel.k].biases[sel.j] = value;
}

/** Имя нейрона: s1…sN, v, s1′…sN′, зн, m1…m3 на входе, н1.2 внутри, «Газ»… и заметки на выходе */
function nodeName(brain: Brain, level: number, index: number): string {
  if (level === 0) return inputLabel(brain.layers[0].weights.length, index);
  if (level === brain.layers.length) return OUTPUT_LABELS[index];
  return `н${level}.${index + 1}`;
}

function describe(brain: Brain, sel: NetPick, value: number, trace: Trace | null): { title: string; explain: string } {
  const to = nodeName(brain, sel.k + 1, sel.j);
  if (sel.type === 'b') {
    return {
      title: `Порог «${to}»`,
      explain: `«${to}» срабатывает, когда сумма входящих сигналов больше ${fixed(value)}. `
        + (value < 0 ? 'Порог ниже нуля: нейрон срабатывает даже в тишине.' : 'Чем выше порог, тем труднее нейрону сработать.'),
    };
  }
  const from = nodeName(brain, sel.k, sel.i);
  const input = trace?.[sel.k]?.[sel.i];
  const now = input === undefined ? '' : ` Сейчас: ${fixed(input)} × ${fixed(value)} = ${fixed(input * value)}.`;
  const meaning = Math.abs(value) < 0.05
    ? `Связи почти нет: «${from}» не влияет на «${to}».`
    : value > 0
      ? `Чем сильнее сигнал «${from}», тем сильнее он толкает «${to}» сработать.`
      : `Сигнал «${from}» мешает «${to}» сработать.`;
  return { title: `Связь ${from} → ${to}`, explain: meaning + now };
}
