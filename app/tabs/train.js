// Вкладка «Учится само» (урок 2): рой и эволюция — поколения, отбор, мутация, кроссовер.
import { TRAINING_TRACKS, getTrainingTrack } from '../../engine/track.js';
import { Car } from '../../engine/car.js';
import { cloneBrain, checkBrain } from '../../engine/brain.js';
import { Evolution } from '../../engine/evolution.js';
import { TRAFFIC_LEVELS, withTraffic } from '../../engine/traffic.js';
import { drawChart } from '../../engine/netviz.js';
import { state, persist, sizesOf, thinkFn, setChampion, on } from '../state.js';
import { setBrain, remember, renderLibrary } from '../library.js';
import { live, errorLine } from '../student-code.js';
import { seedTrack } from '../tracks.js';
import { canvas, drawScene, paintCar, trafficOn, carAt, setHud, showBanner } from '../stage.js';
import { $, esc, secs, pct, options, setPressed, delegate, showError } from '../ui.js';

const TURBO_BUDGET_MS = 22;
const HALL_SIZE = 8;

let evo = null;       // идущая эволюция (null — ещё не запускали)
let running = false;
let track = null;     // трасса текущего поколения
let picked = [];      // машины, выбранные щелчком в родители

export const isTraining = () => running;

export const trainTab = {
  enter() {
    renderPanel();
    renderLibrary();
  },
  frame() {
    if (!evo) return drawIdle();
    const lead = leaderOf(evo.cars);
    drawScene(track, { camera: state.train.camera, follow: lead, traffic: evo.traffic ?? trafficOn(track, 0) });
    for (const car of evo.cars) {
      if (car !== lead && !picked.includes(car)) paintCar(car, { color: state.profile.color, alpha: car.done ? 0.18 : 0.35 });
    }
    for (const car of picked) if (car !== lead) paintCar(car, { color: state.profile.color, highlight: true });
    if (lead) paintCar(lead, { color: state.profile.color, sensors: true, glow: true, highlight: picked.includes(lead) });
    setHud([
      `поколение <b>${state.generation + 1}</b>`,
      `едут <b>${evo.cars.filter((c) => !c.done).length}</b>/${evo.cars.length}`,
      `доехали <b>${evo.cars.filter((c) => c.status === 'finished').length}</b>`,
      `время <b>${secs(evo.tick)}</b>`,
      `<b>${esc(track.name)}</b>`,
    ]);
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
  return withTraffic(base, traffic);
}

/** Настройки и свежий код студента — с каждого нового поколения */
const settings = () => ({
  sizes: sizesOf(),
  sensors: { ...state.config.sensors },
  think: thinkFn(),
  mutate: live.mutate.mutate,
  fitness: live.fitness.fitness,
  crossover: live.crossover.crossover,
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
  const { entry, report } = evo.evaluate(picked);
  entry.trackName = track.name;
  state.history = [...state.history, entry].slice(-300);
  setChampion(cloneBrain(evo.parent), { by: 'train', generation: evo.generation });
  addToHall(entry, report);
  showStudentErrors();
  persist();
  renderPanel();
  startGeneration();
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
}

$('#tToggle').addEventListener('click', () => setRunning(!running));
$('#tEndGen').addEventListener('click', () => evo && endGeneration());

// ── настройки ──

$('#tTrack').innerHTML = options([
  ...TRAINING_TRACKS.map(({ id, name }) => ({ id, title: name })),
  { id: 'seed', title: 'Случайная по seed' },
  { id: 'mix', title: 'Микс: новая трасса каждое поколение' },
]);
$('#tTraffic').innerHTML = options(TRAFFIC_LEVELS);

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

// ── статистика, график, рекорды роя ──

export function renderPanel() {
  syncControls();
  const last = state.history.at(-1);
  $('#stGen').textContent = state.generation;
  $('#stBest').textContent = last ? (last.finished ? secs(last.ticks) : pct(last.progressPct)) : '—';
  $('#stFin').textContent = last ? last.finishers : '—';
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
