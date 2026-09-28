// Вкладка «Учится само» (урок 2): рой и эволюция — поколения, отбор, мутация, кроссовер.
import { TRAINING_TRACKS, getTrainingTrack, forksPassed, withCoins } from '../../engine/track.ts';
import { Car } from '../../engine/car.ts';
import { cloneBrain, checkBrain } from '../../engine/brain.ts';
import { Evolution } from '../../engine/evolution.ts';
import { FITNESS_PARTS, MUTATIONS, crossover, fitnessOf } from '../../engine/recipes.ts';
import { TRAFFIC_LEVELS, withTraffic } from '../../engine/traffic.ts';
import { drawChart } from '../../engine/netviz.ts';
import { createBrainBoard } from '../brain-board/board.js';
import { SMOOTH, ANY_ACT } from '../brain-board/formula.js';
import { state, persist, persistSoon, sizesOf, thinkFn, setChampion, on, emit } from '../state.js';
import { setBrain, remember, renderLibrary } from '../library.js';
import { live, errorLine } from '../student-code.js';
import { seedTrack } from '../tracks.js';
import { canvas, drawScene, paintCar, trafficOn, carAt, setHud, lapText, showBanner } from '../stage.js';
import { $, $$, esc, secs, pct, options, setPressed, delegate, showError } from '../ui.js';

const TURBO_BUDGET_MS = 22;
const HALL_SIZE = 8;

let evo = null;       // идущая эволюция (null — ещё не запускали)
let running = false;
let track = null;     // трасса текущего поколения
let picked = [];      // машины, выбранные щелчком в родители
let leader = { slowdowns: 0 }; // лидер прошлого поколения: сколько раз заехал в медленную зону на развилке

export const isTraining = () => running;

// «Мозг лидера»: то же табло, что на титульной, только мозг — у машины, которая сейчас впереди
const LEADER_IDLE = 'Нажми «Старт» — здесь загорится мозг машины, которая едет впереди.';
const LEADER_HINT = 'Горит то, что лидер видит и жмёт прямо сейчас. Пунктир — память.';
let board = null, boardAt = performance.now();
function showLeaderBrain(lead) {
  if (!$('.leader-brain').open) return; // табло свёрнуто — не считаем и не рисуем
  if (lead && !lead.lastInputs && board) return; // новое поколение ещё не тронулось: держим прошлый кадр, иначе табло мигнёт и страница прыгнет
  const ready = Boolean(lead?.brain && lead.lastInputs);
  const hint = ready ? LEADER_HINT : LEADER_IDLE;
  if ($('#leaderHint').textContent !== hint) $('#leaderHint').textContent = hint; // каждый кадр — только если поменялось
  $('.leader-brain .brain-board').hidden = !ready;
  if (!ready) return;
  const act = state.config.think === 'smooth' ? SMOOTH : ANY_ACT;
  board ??= createBrainBoard({ canvas: $('#leaderBoard'), card: $('#leaderFormula'), zoomBar: $('.leader-brain .zoom'), brain: lead.brain, act });
  board.setBrain(lead.brain, act);
  live.think.feedForward.lastTrace = null;
  lead.think(lead.lastInputs, lead.brain); // пересчитать ход мысли лидера на его последних входах
  const trace = live.think.feedForward.lastTrace;
  const now = performance.now();
  if (trace) board.frame(trace.map((l) => [...l]), [], (now - boardAt) / 1000);
  boardAt = now;
}
export const redrawLeaderBrain = () => board?.readColors();
// на телефоне табло большое: свёрнуто, чтобы график и настройки были ближе к кнопкам
if (matchMedia('(max-width: 700px)').matches) $('.leader-brain').open = false;

export const trainTab = {
  enter() {
    renderPanel();
    renderLibrary();
  },
  frame() {
    if (!evo) return drawIdle();
    const lead = leaderOf(evo.cars);
    drawScene(track, { camera: state.train.camera, follow: lead, traffic: evo.traffic ?? trafficOn(track, 0), tick: evo.tick });
    const elite = evo.parent ? evo.cars[0] : null; // лучший прошлого поколения: едет без изменений — хорошее не теряется
    for (const car of evo.cars) {
      if (car !== lead && car !== elite && !picked.includes(car)) paintCar(car, { color: state.profile.color, alpha: car.done ? 0.18 : 0.35, ghost: true });
    }
    if (elite && elite !== lead && !picked.includes(elite)) paintCar(elite, { color: state.profile.color, alpha: elite.done ? 0.4 : 0.8, number: 1 });
    for (const car of picked) if (car !== lead) paintCar(car, { color: state.profile.color, highlight: true });
    if (lead) paintCar(lead, { color: state.profile.color, sensors: true, highlight: picked.includes(lead), number: lead === elite ? 1 : null });
    showLeaderBrain(lead);
    setHud([
      `поколение <b>${state.generation + 1}</b>`,
      `едут <b>${evo.cars.filter((c) => !c.done).length}</b>/${evo.cars.length}`,
      `доехали <b>${evo.cars.filter((c) => c.status === 'finished').length}</b>`,
      `время <b>${secs(evo.tick)}</b>`,
      lead ? lapText(track, lead.bestS) : '',
      `<b>${esc(track.name)}</b>`,
    ].filter(Boolean));
  },
};

/** Обучение идёт в фоне на любой вкладке */
export function updateTraining() {
  if (!running) return;
  const turbo = state.train.speed === 'turbo';
  const started = performance.now();
  for (let n = turbo ? Infinity : +state.train.speed; n > 0 && performance.now() - started < TURBO_BUDGET_MS; n--) {
    if (evo.step() > 0) continue;
    endGeneration();
    if (!turbo) break;
  }
}

function drawIdle() {
  const idleTrack = trackForGeneration(state.generation);
  drawScene(idleTrack, { traffic: trafficOn(idleTrack, 0) });
  paintCar(new Car(idleTrack, { sensors: state.config.sensors }), { color: state.profile.color });
  setHud([`<b>${esc(idleTrack.name)}</b>`, state.champion ? `продолжим с поколения ${state.generation}` : 'нажми «Старт»']);
  showLeaderBrain(null);
}

const leaderOf = (cars) =>
  cars.reduce((lead, c) => {
    if (!lead) return c;
    if (c.done !== lead.done) return c.done ? lead : c; // живые важнее разбившихся
    return c.bestS > lead.bestS ? c : lead;
  }, null);

// ── поколения ──

function trackForGeneration(gen) {
  const { trackId, seed, traffic } = state.train;
  let base;
  if (trackId === 'seed') base = seedTrack(seed || 'тренировка');
  else if (trackId === 'mix') base = gen % 5 < 3 ? getTrainingTrack(TRAINING_TRACKS[gen % 5].id) : seedTrack(`микс-${gen}`);
  else base = getTrainingTrack(trackId);
  return withCoins(withTraffic(base, traffic), gen); // у каждого поколения судьи бросают монетку по-своему
}

/** Фитнес: из галочек — или «Мой вариант», функция fitness из student/fitness.js */
const chosenFitness = () => (state.train.ownFitness ? live.fitness.fitness : fitnessOf(state.train.parts));
const mutationOf = (id) => (MUTATIONS[id] ?? MUTATIONS.spot).mutate;

/** Рецепт и настройки — с каждого нового поколения */
const settings = () => ({
  sizes: sizesOf(),
  sensors: { ...state.config.sensors },
  think: thinkFn(),
  mutate: mutationOf(state.train.mutation),
  fitness: chosenFitness(),
  crossover,
  parents: state.train.parents,
  population: state.train.population,
  rate: state.train.rate,
});

function startGeneration() {
  Object.assign(evo, settings(), { generation: state.generation });
  track = trackForGeneration(state.generation);
  evo.spawn(track);
  picked = [];
  renderPicked();
  showStudentErrors();
}

function endGeneration() {
  const { entry, report, parentCar } = evo.evaluate(picked);
  entry.trackName = track.name;
  state.history = [...state.history, entry].slice(-300);
  setChampion(cloneBrain(evo.parent), { by: 'train', generation: evo.generation });
  if (track.id === 'snake') emit('did', 'train:snake'); // шаг 1 урока 2 — рой учится на «Змейке»
  leader = { slowdowns: parentCar.slowdowns };
  if (isMaze() && forksPassed(track, parentCar.bestS) >= 2) emit('did', 'train:maze'); // шаг 3 — рой проехал развилку хотя бы на двух кругах
  addToHall(entry, report);
  showStudentErrors();
  saveOften();
  renderPanel();
  if (state.train.speed === '1' || state.train.speed === '4') renderSwarmNow({ flash: true });
  startGeneration();
}

// В турбо поколение длится доли секунды, а сохранять весь мозг и историю каждый раз дорого: не чаще раза в 2 с
let savedAt = 0;
function saveOften() {
  if (performance.now() - savedAt < 2000) return persistSoon();
  savedAt = performance.now();
  persist();
}

/** Рекорды роя: лучший результат на каждой трассе */
function addToHall(entry, report) {
  const candidate = {
    gen: entry.gen, trackName: entry.trackName, finished: report.finished, ticks: report.ticks,
    progressPct: report.progressPct, brain: cloneBrain(state.champion),
  };
  const beats = (a, b) => (a.finished !== b.finished ? a.finished : a.finished ? a.ticks < b.ticks : a.progressPct > b.progressPct + 0.5);
  const rivals = state.hall.filter((h) => h.trackName === entry.trackName);
  if (rivals.every((h) => beats(candidate, h))) state.hall = [candidate, ...state.hall].slice(0, HALL_SIZE);
}

function showStudentErrors() {
  const [error] = evo.errors;
  const line = errorLine(evo.lastError);
  showError('#tError', error && `Ошибка в коде студента${line ? ` (строка ${line})` : ''}: ${error}. Машины едут, но результат может быть странным. Подробности — на вкладке «Код».`);
}

function setRunning(on) {
  if (on && !running) remember(); // рой будет менять мозг — сначала сохраним его в историю
  if (on && !evo) {
    evo = new Evolution({ ...settings(), parent: state.champion && cloneBrain(state.champion) });
    startGeneration();
  }
  running = on;
  $('#tToggle').textContent = on ? 'Пауза' : evo ? 'Продолжить' : 'Старт';
  renderSwarmNow();
}

$('#tToggle').addEventListener('click', () => setRunning(!running));
$('#tEndGen').addEventListener('click', () => evo && endGeneration());

// ── настройки ──

$('#tTrack').innerHTML = options([
  ...TRAINING_TRACKS.map(({ id, name }) => ({ id, title: name })),
  { id: 'seed', title: 'По seed' },
  { id: 'mix', title: 'Микс: каждый раз новая' },
]);
$('#tTraffic').innerHTML = options(TRAFFIC_LEVELS);
$('#tMutation').innerHTML = options(Object.entries(MUTATIONS).map(([id, v]) => ({ id, title: v.title })));

/** Поменять настройку; трасса меняется сразу, если обучение на паузе */
function setTrain(key, value, { retrack = false } = {}) {
  state.train[key] = value;
  persist();
  syncControls();
  if (retrack && evo && !running) startGeneration();
}

$('#tTrack').addEventListener('change', (e) => setTrain('trackId', e.target.value, { retrack: true }));
$('#tTraffic').addEventListener('change', (e) => setTrain('traffic', e.target.value, { retrack: true }));
$('#tSeed').addEventListener('change', (e) => setTrain('seed', e.target.value.trim() || 'тренировка', { retrack: true }));
$('#tPop').addEventListener('input', (e) => setTrain('population', +e.target.value));
$('#tRate').addEventListener('input', (e) => setTrain('rate', +e.target.value));
$('#tParts').addEventListener('change', (e) => {
  if (e.target.id === 'tOwnFitness') return setTrain('ownFitness', e.target.checked);
  setTrain('parts', $$('#tParts [data-part]:checked').map((b) => b.dataset.part));
});
$('#tMutation').addEventListener('change', (e) => setTrain('mutation', e.target.value));
$('#tThink').addEventListener('change', (e) => {
  state.config.think = e.target.value; // форма сети та же — мозг остаётся, меняется только то, как он считает
  persist();
  syncControls();
});
delegate('.toolbar[data-for="train"]', 'click', '[data-speed]', (b) => setTrain('speed', b.dataset.speed));
delegate('.toolbar[data-for="train"]', 'click', '[data-cam]', (b) => setTrain('camera', b.dataset.cam));
delegate('[data-panel="train"]', 'click', '[data-parents]', (b) => {
  setTrain('parents', +b.dataset.parents);
  picked = picked.slice(-state.train.parents);
  renderPicked();
});

function syncControls() {
  const t = state.train;
  $('#tTrack').value = t.trackId;
  $('#tTraffic').value = t.traffic;
  $('#tSeedRow').hidden = t.trackId !== 'seed';
  $('#tSeed').value = t.seed;
  $('#tPop').value = t.population;
  $('#tPopOut').textContent = t.population;
  $('#tRate').value = t.rate;
  $('#tRateOut').textContent = t.rate.toFixed(2);
  setPressed('[data-speed]', (b) => b.dataset.speed === t.speed);
  setPressed('[data-cam]', (b) => b.dataset.cam === t.camera);
  setPressed('[data-parents]', (b) => +b.dataset.parents === t.parents);
  renderParts();
  $('#tMutation').value = MUTATIONS[t.mutation] ? t.mutation : 'spot';
  $('#tMutationHint').textContent = MUTATIONS[$('#tMutation').value].hint;
  const thinks = live.think.thinkVariants ?? {};
  $('#tThink').innerHTML = options(Object.entries(thinks).map(([id, v]) => ({ id, title: v.title || id })));
  $('#tThink').value = state.config.think;
  $('#tThinkHint').textContent = thinks[state.config.think]?.hint ?? '';
}

/** Галочки фитнеса: у каждой — что она добавляет. «Мой вариант» заменяет их все. */
const box = (attrs, title, hint) => `<label class="check"><input type="checkbox" ${attrs}><span><b>${title}</b><small>${hint}</small></span></label>`;
$('#tParts').innerHTML = Object.entries(FITNESS_PARTS).map(([id, part]) => box(`data-part="${id}"`, part.title, part.hint)).join('')
  + box('id="tOwnFitness"', 'Мой вариант', 'Своя функция fitness из student/fitness.js (вкладка «Код») вместо галочек.');

function renderParts() {
  const t = state.train;
  for (const b of $$('#tParts [data-part]')) {
    b.checked = t.parts.includes(b.dataset.part);
    b.disabled = t.ownFitness;
  }
  $('#tOwnFitness').checked = t.ownFitness;
}

// ── выбор родителей щелчком по трассе ──

canvas.addEventListener('click', (e) => {
  if (state.tab !== 'train' || !evo) return;
  const car = carAt(e, evo.cars);
  if (!car) return;
  if (picked.includes(car)) picked = picked.filter((c) => c !== car); // повторный щелчок снимает выбор
  else picked = [...picked, car].slice(-state.train.parents);
  renderPicked();
});
$('#pickedCancel').addEventListener('click', () => {
  picked = [];
  renderPicked();
});

function renderPicked() {
  $('#pickedBar').hidden = picked.length === 0;
  $('#pickedText').textContent = state.train.parents === 1
    ? 'Выбрана машина вручную: она станет родителем следующего поколения.'
    : `Выбрано вручную: ${picked.length} из 2. ${picked.length === 2 ? 'Эти двое станут родителями.' : 'Второго родителя возьмём лучшего по фитнесу — или щёлкни ещё одну машину.'}`;
}

// ── «Рой сейчас»: что происходит и что делать дальше ──

const STUCK_GENS = 10; // столько поколений без улучшения — рой застрял
const SAME_GENS = 5;   // столько поколений подряд лучший не меняется — рою нечему учиться

/** Поколения подряд на той же трассе, что сейчас, — только их и можно сравнивать */
function sameTrackHistory() {
  const h = state.history, out = [];
  for (let i = h.length - 1; i >= 0 && h[i].trackId === track?.id; i--) out.unshift(h[i]);
  return out;
}

/** На трассе есть развилка со знаком */
const isMaze = () => track?.islands?.length > 0;

/** Рой не хвалят за скорость: доехавшие для него равны */
const noTimeBonus = () => !state.train.ownFitness && !state.train.parts.includes('finish');

function swarmAdvice() {
  if (!evo) {
    return state.champion
      ? 'Нажми «Старт»: рой начнёт с текущего мозга и будет его улучшать.'
      : 'Нажми «Старт»: сто машин со случайными мозгами поедут разом. Сначала почти все разобьются — это нормально.';
  }
  if (!running) return 'Пауза. «Продолжить» — рой пойдёт дальше с того же места.';
  const h = sameTrackHistory(), last = h.at(-1);
  if (!last) return 'Смотри, какая машина уедет дальше всех: от неё пойдёт следующее поколение. Долго — жми «Турбо».';
  const tail = h.slice(-SAME_GENS);
  if (isMaze() && last.finished && leader.slowdowns > 0) {
    return noTimeBonus()
      ? `Доехал, но в медленную зону на развилке заехал ${leader.slowdowns} раз. Без бонуса за время рою всё равно — кто доехал, тот и хорош. Поставь галочку «${FITNESS_PARTS.finish.title}».`
      : `Доехал, но в медленную зону на развилке заехал ${leader.slowdowns} раз. Время дороже — рой ещё научится читать знак.`;
  }
  if (isMaze() && last.finished) {
    return 'Каждый круг — по свободному пути: рой читает знак. Посмотри в «Мозге лидера», как горит вход «зн» у знака и что делают заметки m1…m3 после него — знак-то остаётся позади раньше развилки.';
  }
  if (tail.length === SAME_GENS && tail.every((e) => e.finished && e.best === last.best)) {
    if (TRAINING_TRACKS.some((t) => t.id === track.id) && track.id !== 'snake') {
      return 'Здесь рой уже доехал. Цель урока — «Змейка» с машинами: выбери её в «Трасса».';
    }
    return noTimeBonus()
      ? `Рой доехал — и больше не ускоряется: без бонуса за время все доехавшие для него равны. Поставь галочку «${FITNESS_PARTS.finish.title}».`
      : `${SAME_GENS} поколений подряд никто не обогнал лучшего. Попробуй «Смелую» мутацию или другую трассу.`;
  }
  const before = h.at(-STUCK_GENS - 1);
  if (!last.finished && before && h.slice(-STUCK_GENS).every((e) => !e.finished && e.best <= before.best)) {
    return `${STUCK_GENS} поколений без улучшения: рой застрял на ${pct(last.progressPct)} — лучший бьётся в одном и том же месте. Помоги: в «Рецепте роя» поставь галочку «${FITNESS_PARTS.careful.title}» или выбери «Смелую» мутацию, или поставь «Без машин», а потом верни встречных.`;
  }
  if (last.finished) return `Лучший доехал за ${secs(last.ticks)}. Рой ищет мозг, который фитнес оценит ещё выше.`;
  return `Лучший в прошлом поколении проехал ${pct(last.progressPct)}. Пусть линия на графике ползёт вверх.`;
}

function renderSwarmNow({ flash = false } = {}) {
  $('#swarmSay').textContent = swarmAdvice();
  $('#cycPop').textContent = state.train.population;
  for (const li of $$('.swarm-cycle li')) {
    li.classList.toggle('on', running && li.dataset.phase === 'drive');
    // конец поколения на медленной скорости: коротко подсветить отбор и мутацию — видно, что они случились
    if (flash && li.dataset.phase !== 'drive') {
      li.classList.remove('flash');
      void li.offsetWidth; // перезапустить анимацию
      li.classList.add('flash');
    }
  }
}

// ── статистика, график, рекорды роя ──

export function renderPanel() {
  syncControls();
  renderSwarmNow();
  const last = state.history.at(-1);
  $('#stBest').textContent = last ? (last.finished ? `финиш за ${secs(last.ticks)}` : `${pct(last.progressPct)} трассы`) : '—';
  $('#stFin').textContent = last ? `${last.finishers} из ${state.train.population}` : '—';
  $('#chartLegend').hidden = !state.history.length;
  drawChart($('#chart'), state.history);
  $('#hall').innerHTML = state.hall.length
    ? state.hall.map((h, i) => `
        <li>
          <span><span class="meta">пок. ${h.gen}</span> · ${esc(h.trackName)} · <span class="meta">${h.finished ? secs(h.ticks) : pct(h.progressPct)}</span></span>
          <button class="btn small" data-hall="${i}">Взять</button>
        </li>`).join('')
    : '<li class="empty">Здесь появятся рекорды: лучший результат на каждой трассе.</li>';
}

delegate('#hall', 'click', '[data-hall]', (button) => {
  const record = state.hall[+button.dataset.hall];
  if (checkBrain(record.brain, sizesOf())) return showBanner('Этот мозг от другой архитектуры сети');
  setBrain(cloneBrain(record.brain), { by: 'hall', generation: record.gen });
  showBanner(`Текущий мозг — рекорд поколения ${record.gen}. Прежний — в «Истории»`, 2800);
});

// ── сброс ──

// Начать с нуля — кнопка «Сбросить мозг» в блоке «Мозг» (app/library.js)

// ── реакция на другие вкладки ──

on('champion', ({ by }) => {
  if (by === 'train' || !evo || !state.champion) return;
  evo.parent = cloneBrain(state.champion); // мозг обучили на «Я учу», поправили руками или взяли из библиотеки
  startGeneration();
});
on('reset', () => {
  evo = null;
  picked = [];
  setRunning(false);
  renderPanel();
});
