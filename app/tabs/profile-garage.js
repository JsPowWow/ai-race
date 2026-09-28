// «Профиль», гараж: машины плитками на полке. Выбранная — жёлтая: её учат, проверяют и сдают на всех вкладках.
// Под полкой — что делать с выбранной (копия, файл, удалить), её файлы и сколько места занимает весь гараж.
//
// Перед тем как пересесть в другую машину, спрашиваем про неприменённый черновик сборки —
// прямо на месте, где нажали: в плитке или под полкой. Черновик живёт в profile.js, сюда он приходит через guard.
import { state, sizesOf, on } from '../state.js';
import { garage, MAX_CARS, switchCar, newCar, copyCar, deleteCar, exportCar, importCar, isFull, chooseFolder, allowFolder, stopFolder } from '../garage.js';
import { shapeResetsBrain } from '../library.js';
import { saveFile, safeFileName } from '../download.js';
import { $, esc, avatarTag, delegate, showError } from '../ui.js';

/** Черновик сборки из profile.js: pending() — черновик или null, apply() — применить, drop() — выбросить */
let guard = { pending: () => null, apply() {}, drop() {} };

/**
 * Что сейчас спрашиваем. null — ничего. Иначе { at, kind, run }:
 * at — где спрашиваем (id машины, 'new' — плитка «+ Новая машина», 'row' — под полкой);
 * kind — 'draft' (черновик не применён) или 'delete' (точно удалить?); run — что сделать после «да».
 */
let ask = null;
let busy = false;

/** Байты по-человечески: 319 Б, 1,5 КБ, 2,3 МБ, 1,1 ГБ */
function kb(n) {
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) [n, i] = [n / 1024, i + 1];
  return `${i ? n.toFixed(1).replace('.', ',') : n} ${units[i]}`;
}
const total = (car) => car.bytes.car + car.bytes.history + (car.bytes.runs ?? 0);

/** Сводка машины для плитки. У выбранной облик и мозг — прямо из state: так имя меняется на полке сразу, пока печатаешь */
function view(car) {
  if (car.id !== garage.id) return car;
  return { ...car, profile: state.profile, shape: sizesOf().join('-'), generation: state.generation, trained: !!state.champion };
}

const progress = (car) => (!car.trained ? 'не обучена' : car.generation ? `поколение ${car.generation}` : 'обучена');

function draftQuestion() {
  const resets = shapeResetsBrain(guard.pending());
  return `<p>Сборка не применена. ${resets ? 'Применишь — мозг начнёт с нуля (прежний останется в «Истории»).' : 'Применить её перед тем, как пересесть?'}</p>
    <div class="row">
      <button class="btn small ${resets ? 'danger' : 'primary'}" data-ask="apply">Применить</button>
      <button class="btn small" data-ask="drop">Выбросить</button>
      <button class="btn small" data-ask="stay">Остаться</button>
    </div>`;
}

/** Полоска размера: мозг и сборка | «История» | мои заезды — пустые части не рисуем */
const segments = ({ bytes: b }) => [['', b.car], ['h', b.history], ['r', b.runs ?? 0]]
  .filter(([, n]) => n > 2) // «[]» — пустой файл
  .map(([kind, n]) => `<i class="${kind}" style="flex:${n}"></i>`).join('');

function tile(car, biggest) {
  const c = view(car);
  if (ask?.at === car.id) return `<div class="g-tile g-ask pending" role="group" aria-label="Пересесть в «${esc(c.profile.name || 'Без имени')}»">${draftQuestion()}</div>`;
  const size = total(car);
  return `<button class="g-tile" data-car="${esc(car.id)}" aria-pressed="${car.id === garage.id}" ${busy ? 'disabled' : ''}>
    <span class="g-name">${avatarTag(c.profile)}<b>${esc(c.profile.name || 'Без имени')}</b></span>
    <span class="g-meta"><span class="g-shape">${esc(c.shape)}</span> ${progress(c)}</span>
    <span class="g-bar" style="--w:${Math.max(4, (size / biggest) * 100)}%" aria-hidden="true">${segments(car)}</span>
    <span class="g-size">${kb(size)}</span>
  </button>`;
}

function newTile() {
  if (ask?.at === 'new') return `<div class="g-tile g-ask pending" role="group" aria-label="Новая машина">${draftQuestion()}</div>`;
  return `<button class="g-tile g-new" data-new ${busy || isFull() ? 'disabled' : ''}>${isFull() ? `Полка полна: ${MAX_CARS} машин` : '+ Новая машина'}</button>`;
}

function meter() {
  const used = garage.cars.reduce((sum, car) => sum + total(car), 0);
  const limit = garage.quota ? ` · браузер даёт сайту до ${kb(garage.quota)}` : '';
  const share = garage.quota ? Math.min(100, Math.max(1, (garage.usage / garage.quota) * 100)) : 0;
  const copied = garage.disk.state === 'on';
  const where = garage.kind === 'local'
    ? `Гараж лежит в памяти браузера (localStorage): места там мало, около 5 МБ.${copied ? '' : ' Важные машины сохраняй в файл.'}`
    : garage.safe
      ? 'Защищено от удаления: браузер не сотрёт гараж сам — только если ты очистишь данные сайта.'
      : `Если на диске кончится место, браузер может стереть гараж.${copied ? '' : ' Важные машины сохраняй в файл.'}`;
  return `<p>Занято <b>${kb(used)}</b><span class="note">${limit}</span></p>
    ${garage.quota ? `<span class="g-track" aria-hidden="true"><i style="inline-size:${share}%"></i></span>` : ''}
    <p class="note ${garage.safe && garage.kind !== 'local' ? 'g-safe' : ''}">${where}</p>`;
}

/** Копия в папке на диске: только в Chrome и Edge — там, где браузер умеет давать сайту папку */
function renderDisk() {
  const { supported, state: now, name, note } = garage.disk;
  const box = $('#gDisk');
  box.hidden = !supported;
  if (!supported) return;
  const off = busy ? 'disabled' : '';
  const folderName = `<b>${esc(name)}</b>`;
  box.innerHTML = {
    off: `<p class="note">Можно держать копию гаража в обычной папке на диске: её не сотрёт очистка браузера. Потеряются машины — выбери эту папку снова, и они вернутся из неё на полку.</p>
      <div class="row"><button class="btn small" data-disk="choose" ${off}>Хранить копию в папке на диске</button></div>`,
    ask: `<p class="note">Копия гаража — в папке ${folderName}. Браузер спрашивает, можно ли снова в неё писать.</p>
      <div class="row"><button class="btn small primary" data-disk="allow" ${off}>Разрешить</button><button class="btn small" data-disk="stop" ${off}>Перестать копировать</button></div>`,
    on: `<p class="note g-safe">Копия — в папке ${folderName} на диске: каждая машина там папкой <code>cars/…</code>, её не сотрёт очистка браузера.</p>
      <div class="row"><button class="btn small" data-disk="stop" ${off}>Перестать копировать</button></div>`,
  }[now] + (note ? `<p class="error">${esc(note)}</p>` : '');
}

function renderActions() {
  const current = garage.cars.find((c) => c.id === garage.id);
  const confirm = ask?.at === 'row';
  $('#gActions').hidden = confirm;
  $('#gConfirm').hidden = !confirm;
  if (confirm) {
    $('#gConfirm').innerHTML = ask.kind === 'delete'
      ? `<p>Удалить «${esc(state.profile.name || 'Без имени')}» вместе с мозгом и «Историей»? Вернуть будет нельзя.</p>
        <div class="row"><button class="btn small danger" data-ask="yes">Да, удалить</button><button class="btn small" data-ask="stay">Нет</button></div>`
      : draftQuestion();
  }
  for (const b of $('#gActions').querySelectorAll('button, input')) b.disabled = busy;
  $('#gCopy').disabled ||= isFull();
  $('#gImport').disabled ||= isFull();
  $('#gImport').parentElement.classList.toggle('off', busy || isFull());
  $('#gDelete').disabled ||= garage.cars.length <= 1;
  $('#gDelete').title = garage.cars.length <= 1 ? 'Последнюю машину удалить нельзя' : '';
  $('#gFiles').innerHTML = current
    ? Object.entries({ 'car.json': current.bytes.car, 'history.json': current.bytes.history, 'runs.json': current.bytes.runs ?? 0 })
      .map(([name, size]) => `<li><code>cars/${esc(current.id)}/${name}</code><span>${kb(size)}</span></li>`).join('')
    : '';
}

export function renderGarage() {
  if (!garage.ready) {
    $('#gShelf').innerHTML = '<p class="note">Открываю гараж…</p>';
    return;
  }
  const focused = /** @type {HTMLElement | null} */ (document.activeElement?.closest?.('#gShelf [data-car], #gShelf [data-new]'));
  const biggest = Math.max(1, ...garage.cars.map(total));
  $('#gShelf').innerHTML = garage.cars.map((car) => tile(car, biggest)).join('') + newTile();
  $('#gShelf').setAttribute('aria-busy', String(busy));
  $('#gMeter').innerHTML = meter();
  renderDisk();
  renderActions();
  showError('#gError', garage.error);
  // Перерисовали полку — вернуть фокус на ту же плитку (или на первую кнопку вопроса)
  const again = ask && ask.at !== 'row' ? $('#gShelf .g-ask button')
    : focused && $(focused.dataset.new !== undefined ? '#gShelf [data-new]' : `#gShelf [data-car="${CSS.escape(focused.dataset.car)}"]`);
  if (again && document.activeElement !== again) again.focus();
}

/** Выполнить действие гаража: кнопки заблокированы, пока пишем файлы; ошибку показываем под полкой */
async function act(run) {
  busy = true;
  ask = null;
  showError('#gError', '');
  renderGarage();
  try {
    await run();
  } catch (e) {
    garage.error = `Не получилось: ${e.message}`;
  } finally {
    busy = false;
    renderGarage();
  }
}

/** Действие, после которого сядем в другую машину: сначала спросим про черновик — там, где нажали */
function leave(at, run) {
  if (guard.pending()) {
    ask = { at, kind: 'draft', run };
    renderGarage();
    if (at === 'row') $('#gConfirm button')?.focus();
  } else {
    act(run);
  }
}

function answer(choice) {
  const { run, at, kind } = ask;
  if (choice === 'stay') {
    ask = null;
    renderGarage();
    (at === 'row' ? $(kind === 'delete' ? '#gDelete' : '#gCopy') : $(at === 'new' ? '#gShelf [data-new]' : `#gShelf [data-car="${CSS.escape(at)}"]`))?.focus();
    return;
  }
  if (choice === 'apply') guard.apply();
  if (choice === 'drop') guard.drop();
  act(run);
}

delegate('#gShelf', 'click', '[data-car]', (b) => b.dataset.car !== garage.id && leave(b.dataset.car, () => switchCar(b.dataset.car)));
delegate('#gShelf', 'click', '[data-new]', () => leave('new', newCar));
delegate('#gShelf', 'click', '[data-ask]', (b) => answer(b.dataset.ask));
delegate('#gConfirm', 'click', '[data-ask]', (b) => answer(b.dataset.ask));
$('#gCopy').addEventListener('click', () => leave('row', copyCar));
$('#gDelete').addEventListener('click', () => {
  ask = { at: 'row', kind: 'delete', run: () => deleteCar(garage.id) };
  renderGarage();
  $('#gConfirm [data-ask="stay"]').focus(); // по умолчанию — безопасное «Нет»
});
$('#gExport').addEventListener('click', () => act(async () => {
  const { name, text } = await exportCar();
  await saveFile(`${safeFileName(name)}.garage.json`, text);
}));
$('#gImport').addEventListener('change', async (e) => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  leave('row', () => importCar(text));
});

delegate('#gDisk', 'click', '[data-disk]', (b) => act({ choose: chooseFolder, allow: allowFolder, stop: stopFolder }[b.dataset.disk]));

/** profile.js сообщает, как узнать про черновик и что с ним сделать */
export function guardDraft(next) {
  guard = next;
}

for (const event of ['garage', 'car', 'save']) {
  on(event, () => {
    if (event === 'car') ask = null;
    if (state.tab === 'profile' && !busy) renderGarage();
  });
}
