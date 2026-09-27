// Схема нейросети в Гараже: подсветка работы нейронов и ручная правка весов.
import { createBrain, OUTPUT_LABELS } from '../../engine/brain.js';
import { drawNetwork, hitNetwork } from '../../engine/netviz.js';
import { mulberry32 } from '../../engine/utils.js';
import { state, sizesOf, sameSizes, setChampion } from '../state.js';
import { showBanner } from '../stage.js';
import { $ } from '../ui.js';

/**
 * getDraft()  — архитектура, которую сейчас собирают в Гараже
 * getTrace()  — что «горит» в сети прямо сейчас (или null)
 * onEdit()    — вызывается после ручной правки веса
 */
export function createNetworkEditor({ getDraft, getTrace, onEdit }) {
  const canvas = $('#netCanvas');
  let preview = null; // случайная сеть, пока своего мозга нет
  let layout = null;
  let selected = null;
  let hovered = null;

  /** Какой мозг показываем и можно ли его править */
  function current() {
    const draft = getDraft();
    const applied = sameSizes(draft, state.config);
    if (applied && state.champion) return { brain: state.champion, editable: true };
    preview ??= createBrain(sizesOf(draft), mulberry32(7));
    return { brain: preview, editable: applied };
  }

  function render() {
    const { brain, editable } = current();
    layout = drawNetwork(canvas, brain, getTrace(), editable ? selected : null, editable ? hovered : null);
    $('#netNote').textContent = note(editable);
    $('#wZero').disabled = $('#wRandom').disabled = !editable;
    renderSlider(brain, editable ? selected : null);
  }

  function note(editable) {
    if (!editable) return 'Архитектура изменена: примени её, чтобы править веса.';
    if (!state.champion) return 'Пока мозга нет — это случайные веса. Поменяй любой вес, и он станет твоим мозгом. Или обучи его на вкладке «Трек».';
    if (state.handEdited) return 'Мозг поправлен руками. На «Треке» эволюция продолжит с него.';
    return getTrace() ? 'Мозг чемпиона. Кружки загораются, когда нейрон срабатывает.' : 'Мозг чемпиона. Включи «Рулит мозг», чтобы увидеть, как он думает.';
  }

  function renderSlider(brain, sel) {
    const value = sel ? read(brain, sel) : null;
    $('#wRow').hidden = $('#wExplain').hidden = value === null;
    $('#wLabel').hidden = value !== null;
    if (value === null) return;
    const { title, explain } = describe(brain, sel, value, getTrace());
    $('#wName').textContent = title;
    $('#wExplain').textContent = explain;
    if (document.activeElement !== $('#wVal')) $('#wVal').value = value;
    $('#wValOut').textContent = fixed(value);
  }

  /** Правка руками превращает показанную сеть в «мой мозг» */
  function commit(brain) {
    setChampion(brain, { by: 'editor', handEdited: true });
    if (brain === preview) preview = null;
    onEdit();
    render();
  }

  // ── события ──

  const pointer = (e) => {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  canvas.addEventListener('pointermove', (e) => {
    const { brain, editable } = current();
    const hit = editable ? hitNetwork(layout, brain, ...pointer(e)) : null;
    canvas.classList.toggle('can-pick', !!hit);
    if (JSON.stringify(hit) !== JSON.stringify(hovered)) {
      hovered = hit;
      render();
    }
  });
  canvas.addEventListener('pointerleave', () => {
    hovered = null;
    render();
  });
  canvas.addEventListener('click', (e) => {
    const { brain, editable } = current();
    if (!editable) return;
    selected = hitNetwork(layout, brain, ...pointer(e));
    render();
    if (selected) $('#wVal').focus({ preventScroll: true });
  });

  $('#wVal').addEventListener('input', (e) => {
    const { brain, editable } = current();
    if (!editable || !selected) return;
    write(brain, selected, +e.target.value);
    commit(brain);
  });

  $('#wZero').addEventListener('click', () => {
    const { brain } = current();
    warnTrainedLost();
    for (const layer of brain.layers) {
      layer.biases.fill(0);
      for (const row of layer.weights) row.fill(0);
    }
    commit(brain);
  });

  $('#wRandom').addEventListener('click', () => {
    const { brain } = current();
    warnTrainedLost();
    const fresh = createBrain(sizesOf());
    brain.layers.forEach((layer, k) => Object.assign(layer, fresh.layers[k]));
    commit(brain);
  });

  return {
    render,
    /** Архитектура поменялась — старая схема и выбор больше не годятся */
    reset() {
      preview = null;
      selected = hovered = null;
    },
  };
}

// ── чтение и описание весов ──

const fixed = (x) => (Math.round(x * 100) / 100).toFixed(2);

function read(brain, sel) {
  const layer = brain.layers[sel.k];
  if (!layer) return null;
  return (sel.type === 'w' ? layer.weights[sel.i]?.[sel.j] : layer.biases[sel.j]) ?? null;
}

function write(brain, sel, value) {
  if (sel.type === 'w') brain.layers[sel.k].weights[sel.i][sel.j] = value;
  else brain.layers[sel.k].biases[sel.j] = value;
}

/** Имя нейрона: с1…сN и «скорость» на входе, н1.2 внутри, «Газ»… на выходе */
function nodeName(brain, level, index) {
  if (level === 0) return index === brain.layers[0].weights.length - 1 ? 'скорость' : `с${index + 1}`;
  if (level === brain.layers.length) return OUTPUT_LABELS[index];
  return `н${level}.${index + 1}`;
}

function describe(brain, sel, value, trace) {
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

function warnTrainedLost() {
  if (state.generation > 0 && !state.handEdited) showBanner('Обученный мозг остался в «Зале чемпионов» на вкладке «Трек»', 2600);
}
