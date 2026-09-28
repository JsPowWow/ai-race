// Вкладка «Гонка» (урок 5): участники, секретная трасса, отсчёт, таблица и номинации.
import { Car, carReport, maxTicksFor } from '../../engine/car.js';
import { cloneBrain } from '../../engine/brain.js';
import { TRAFFIC_LEVELS, withTraffic } from '../../engine/traffic.js';
import { state, persist, thinkVariant, emit, CAR_COLORS } from '../state.js';
import { live } from '../student-code.js';
import { seedTrack } from '../tracks.js';
import { toCarFile, fromCarFile, approveCode } from '../car-file.js';
import { BOTS } from '../generated/bots.js';
import { startCountdown, stopCountdown, updateCountdown } from '../countdown.js';
import { drawScene, paintCar, paintSensors, trafficOn, setHud, lapText, showBanner } from '../stage.js';
import { $, esc, secs, pct, options, setPressed, delegate, showError, avatarTag } from '../ui.js';

const SOURCE_LABEL = { bot: 'бот', mine: 'мой', file: 'файл', cross: 'гибрид' };

let entrants = BOTS.map((file) => ({ ...fromCarFile(file), source: 'bot' }));
const crossPick = new Set();

const race = { track: null, cars: [], tick: 0, maxTicks: 0, speed: 1, running: false, finished: false };

export const raceTab = {
  enter() {
    renderEntrants();
    if (!race.running && !race.finished) prepare();
  },
  frame(frameNo) {
    if (updateCountdown() && !race.finished) race.running = true;
    if (race.running) {
      advance();
      if (frameNo % 6 === 0) renderBoard();
    }
    const { track } = race;
    drawScene(track, { traffic: trafficOn(track, race.tick), tick: race.tick });
    const [leader] = standings();
    for (const { entrant, car } of race.cars) {
      const isLeader = leader?.car === car;
      paintCar(car, { color: entrant.color, alpha: car.status === 'crashed' ? 0.5 : 1, label: isLeader ? entrant.name : null });
    }
    if (leader && !leader.car.done) paintSensors(leader.car);
    setHud([
      `<b>${esc(track.name)}</b>`,
      `время <b>${secs(race.tick)}</b>`,
      ...(leader ? [`лидер: ${lapText(track, leader.car.bestS)}`] : []),
      `участников <b>${race.cars.length}</b>`,
      race.running ? `×${race.speed}` : race.finished ? 'финиш' : 'ждём старта',
    ]);
  },
};

// ── заезд ──

function prepare() {
  race.track = withTraffic(seedTrack(state.race.seed || 'урок-1'), state.race.traffic);
  race.cars = entrants.filter((e) => e.think).map((entrant) => ({ entrant, car: new Car(race.track, entrant) }));
  Object.assign(race, { tick: 0, maxTicks: maxTicksFor(race.track), running: false, finished: false });
  stopCountdown();
  $('#rStart').textContent = 'Старт гонки';
  $('#rAwards').innerHTML = '';
  renderBoard();
}

/** Несколько тиков за кадр: все машины видят один и тот же трафик */
function advance() {
  for (let k = 0; k < race.speed; k++) {
    const traffic = trafficOn(race.track, race.tick);
    let driving = 0;
    for (const { car } of race.cars) {
      car.step(race.track, race.maxTicks, traffic);
      if (!car.done) driving++;
    }
    race.tick++;
    if (!driving) return finish();
  }
}

$('#rStart').addEventListener('click', () => {
  prepare();
  if (!race.cars.length) return showBanner('Добавь участников');
  startCountdown();
  emit('did', 'race:start');
  $('#rStart').textContent = 'Заново';
});
delegate('.toolbar[data-for="race"]', 'click', '[data-rspeed]', (b) => {
  race.speed = +b.dataset.rspeed;
  setPressed('[data-rspeed]', (x) => x === b);
});

// ── таблица и номинации ──

function standings() {
  return [...race.cars].sort((a, b) => {
    const fa = a.car.status === 'finished', fb = b.car.status === 'finished';
    if (fa !== fb) return fa ? -1 : 1;
    return fa ? a.car.finishTick - b.car.finishTick : b.car.bestS - a.car.bestS;
  });
}

function resultText(car) {
  const done = pct(carReport(car, race.track).progressPct);
  if (car.status === 'finished') return secs(car.finishTick);
  if (car.status === 'driving') return done;
  return `${car.status === 'crashed' ? (car.crashedInto === 'car' ? 'авария' : 'бордюр') : 'сошёл'} · ${done}`;
}

function renderBoard() {
  const rows = standings();
  $('#rBoard').innerHTML = rows.length
    ? rows.map(({ entrant, car }, i) => `
        <li${car.status === 'finished' && i < 3 ? ` class="p${i + 1}"` : ''}>
          ${avatarTag(entrant)}
          <span>${esc(entrant.name)}</span><span class="res">${resultText(car)}</span>
        </li>`).join('')
    : '<li class="empty">Добавь участников</li>';
}

function finish() {
  race.running = false;
  race.finished = true;
  renderBoard();
  const awards = nominations();
  $('#rAwards').innerHTML = awards.map(([title, text]) => `<div class="award"><b>${title}</b>${esc(text)}</div>`).join('');
  const [winner] = standings();
  showBanner(winner?.car.status === 'finished' ? `Победил ${winner.entrant.name}!` : 'Никто не доехал', 3000);
}

function nominations() {
  const all = race.cars.map(({ entrant, car }) => ({ name: entrant.name, car, report: carReport(car, race.track) }));
  const finished = all.filter((x) => x.car.status === 'finished');
  const pick = (list, score) => list.reduce((best, x) => (!best || score(x) > score(best) ? x : best), null);
  const awards = [];

  const winner = pick(finished, (x) => -x.car.finishTick);
  if (winner) awards.push(['Победитель', `${winner.name} — ${secs(winner.car.finishTick)}`]);
  const crash = pick(all.filter((x) => x.car.status === 'crashed'), (x) => x.car.crashSpeed);
  if (crash) awards.push(['Самая эпичная авария', `${crash.name}: ${crash.car.crashedInto === 'car' ? 'в машину' : 'в бордюр'} на скорости ${crash.car.crashSpeed.toFixed(1)}`]);
  const almost = pick(all.filter((x) => x.car.status !== 'finished'), (x) => x.report.progressPct);
  if (almost?.report.progressPct > 50) awards.push(['Почти доехал', `${almost.name}: ${pct(almost.report.progressPct)} трассы`]);
  const smooth = pick(finished, (x) => -x.report.wiggle / x.report.ticks);
  if (smooth && finished.length > 1) awards.push(['Самый плавный ход', `${smooth.name}: меньше всех дёргал руль`]);
  return awards;
}

// ── трасса ──

$('#rSeed').value = state.race.seed;
$('#rTraffic').innerHTML = options(TRAFFIC_LEVELS);
$('#rTraffic').value = state.race.traffic;
for (const [id, key] of [['#rSeed', 'seed'], ['#rTraffic', 'traffic']]) {
  $(id).addEventListener('change', (e) => {
    state.race[key] = e.target.value.trim();
    persist();
    prepare();
  });
}

// ── участники ──

/** inheritThink — готовый think (гибрид берёт его у мамы, повторно проверять код не нужно) */
function addEntrant(file, source, { inheritThink = null } = {}) {
  try {
    const entrant = { ...fromCarFile(file, CAR_COLORS[entrants.length % CAR_COLORS.length]), source };
    if (inheritThink) entrant.think = inheritThink;
    else if (entrant.code && source === 'mine') approveCode(entrant); // свой код — свой браузер
    if (source === 'mine') entrants = entrants.filter((e) => e.source !== 'mine');
    entrants = [...entrants, entrant];
    showError('#rError', null);
  } catch (e) {
    showError('#rError', e.message);
  }
  renderEntrants();
  prepare();
}

function addFromText(text) {
  try {
    addEntrant(JSON.parse(text), 'file');
  } catch (e) {
    showError('#rError', `Не получилось прочитать JSON: ${e.message}`);
  }
}

const readFiles = (files) => [...files].forEach((f) => f.text().then(addFromText));

$('#rAddMine').addEventListener('click', () => {
  const file = toCarFile();
  if (!file) return showBanner('Сначала обучи мозг: на «Я учу» или «Учится само»');
  addEntrant(file, 'mine');
  emit('did', 'race:mine');
});
$('#rFiles').addEventListener('change', (e) => {
  readFiles(e.target.files);
  e.target.value = '';
});
$('#rPasteAdd').addEventListener('click', () => {
  const text = $('#rPaste').value.trim();
  if (!text) return;
  addFromText(text);
  $('#rPaste').value = '';
});

const viewport = $('#viewport');
viewport.addEventListener('dragover', (e) => {
  if (state.tab !== 'race') return;
  e.preventDefault();
  viewport.classList.add('drop');
});
viewport.addEventListener('dragleave', () => viewport.classList.remove('drop'));
viewport.addEventListener('drop', (e) => {
  if (state.tab !== 'race') return;
  e.preventDefault();
  viewport.classList.remove('drop');
  readFiles(e.dataTransfer.files);
});

function renderEntrants() {
  for (const e of crossPick) if (!entrants.includes(e)) crossPick.delete(e);
  $('#rList').innerHTML = entrants.map((e, i) => `
    <li>
      ${avatarTag(e)}
      <span>${esc(e.name)} <span class="kind">${SOURCE_LABEL[e.source]} · ${esc(thinkVariant(e.thinkId)?.title ?? e.thinkId)} · ${e.sizes.join('-')}</span>
        ${e.think ? '' : `<button class="btn small review-btn" data-review="${i}">Свой код — проверить</button>`}</span>
      <input type="checkbox" data-pick="${i}" ${crossPick.has(e) ? 'checked' : ''} aria-label="Выбрать ${esc(e.name)} для скрещивания">
      <button data-remove="${i}" aria-label="Убрать ${esc(e.name)}">×</button>
    </li>`).join('') || '<li class="kind">Нет участников</li>';
  renderCrossNote();
}

delegate('#rList', 'click', '[data-remove]', (b) => {
  entrants = entrants.filter((_, i) => i !== +b.dataset.remove);
  renderEntrants();
  prepare();
});

// ── скрещивание двух участников ──

delegate('#rList', 'change', '[data-pick]', (box) => {
  const entrant = entrants[+box.dataset.pick];
  if (box.checked) crossPick.add(entrant);
  else crossPick.delete(entrant);
  if (crossPick.size > 2) crossPick.delete([...crossPick][0]);
  renderEntrants();
});

function renderCrossNote() {
  const [a, b] = crossPick;
  const compatible = a && b && a.sizes.join() === b.sizes.join() && !!a.think;
  $('#rCross').disabled = !compatible;
  $('#rCrossNote').textContent = !b
    ? 'Отметь галочками двух участников, чтобы получить их ребёнка.'
    : compatible
      ? `Ребёнок возьмёт сенсоры и вариант мозга у «${a.name}», веса — через твой crossover().`
      : `Не скрестить: у «${a.name}» сеть ${a.sizes.join('-')}, у «${b.name}» — ${b.sizes.join('-')}. Нужна одинаковая.`;
}

$('#rCross').addEventListener('click', () => {
  const [mom, dad] = crossPick;
  try {
    const brain = live.crossover.crossover(cloneBrain(mom.brain), cloneBrain(dad.brain));
    crossPick.clear();
    const child = { ...mom.file, name: `${mom.name} × ${dad.name}`.slice(0, 24), color: mixColors(mom.color, dad.color), brain };
    addEntrant(child, 'cross', { inheritThink: mom.think });
  } catch (e) {
    showError('#rError', `Ошибка в crossover(): ${e.message}`);
  }
});

function mixColors(a, b) {
  const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round((channel(a, i) + channel(b, i)) / 2).toString(16).padStart(2, '0')).join('')}`;
}

// ── проверка чужого кода ──
// Свой вариант мозга из чужого файла — это код, который выполнится у тебя в браузере.
// Поэтому он не запускается сам: преподаватель читает его и нажимает «Разрешить».

const SUSPICIOUS = /\b(window|self|globalThis|document|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|navigator|location|eval|Function|constructor|prototype|__proto__|import|setTimeout|setInterval|postMessage)\b|while\s*\(\s*(true|1)\s*\)|for\s*\(\s*;\s*;\s*\)|Math\.\w+\s*=[^=]/;
let reviewing = null;

delegate('#rList', 'click', '[data-review]', (b) => openReview(entrants[+b.dataset.review]));

function openReview(entrant) {
  reviewing = entrant;
  const lines = entrant.code.split('\n');
  const flagged = lines.map((line, i) => (SUSPICIOUS.test(line) ? i + 1 : 0)).filter(Boolean);
  $('#rReviewTitle').textContent = `Код участника «${entrant.name}»`;
  $('#rReviewCode').innerHTML = lines.map((line, i) =>
    `<span class="${flagged.includes(i + 1) ? 'sus' : ''}">${String(i + 1).padStart(3)}  ${esc(line)}</span>`).join('\n');
  $('#rReviewFlags').textContent = flagged.length
    ? `Внимание, строки ${flagged.join(', ')}: здесь обращение к странице, сети, хранилищу или возможный бесконечный цикл. Честному мозгу это не нужно — такой код лучше отклонить.`
    : 'Подозрительного не нашлось. Всё равно прочитай: разрешай, только если понятно, что делает каждая строка.';
  $('#rReviewFlags').classList.toggle('error', flagged.length > 0);
  $('#rReview').hidden = false;
  $('#rReview').scrollIntoView({ block: 'nearest' });
}

$('#rReviewAllow').addEventListener('click', () => {
  try {
    approveCode(reviewing);
    showError('#rError', null);
  } catch (e) {
    showError('#rError', `${reviewing.name}: ${e.message}`);
  }
  closeReview();
});
$('#rReviewReject').addEventListener('click', () => {
  entrants = entrants.filter((e) => e !== reviewing);
  closeReview();
});

function closeReview() {
  reviewing = null;
  $('#rReview').hidden = true;
  renderEntrants();
  prepare();
}
