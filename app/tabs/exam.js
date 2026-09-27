// Вкладка «Экзамен» (урок 3): проверка на незнакомых трассах и файл для гонки.
import { TRAINING_TRACKS, getTrainingTrack } from '../../engine/track.js';
import { Car, carReport, maxTicksFor } from '../../engine/car.js';
import { withTraffic } from '../../engine/traffic.js';
import { state, persist, thinkFn, on, CAR_COLORS } from '../state.js';
import { seedTrack } from '../tracks.js';
import { toCarFile } from '../car-file.js';
import { drawScene, paintCar, trafficOn, setHud, showBanner } from '../stage.js';
import { $, $$, esc, secs, pct, delegate, showError } from '../ui.js';
import { canDownload, saveFile } from '../download.js';
import { sealCar, GITHUB_LOGIN } from '../../engine/seal.js';
import { COURSE_KEY } from '../generated/course-key.js';
import { checkAvatar, avatarUrl } from '../../engine/car-file.js';

const UNKNOWN_SEEDS = ['экзамен-1', 'экзамен-2', 'экзамен-3'];
const REPLAY_SPEED = 3;
const CAR_FILE_NAME = 'car.json';
const SEALED_FILE_NAME = 'car.sealed.json';
const LOGIN_CHECK_DELAY_MS = 700;

let results = [];
let replay = null; // { index, car, pauseUntil }

export const examTab = {
  enter: renderExport,
  frame() {
    const track = replay ? results[replay.index].track : getTrainingTrack('warmup');
    if (!replay) {
      drawScene(track);
      return setHud(['<b>Экзамен</b>', 'чемпион проедет 6 трасс']);
    }
    const { car } = replay;
    for (let k = 0; k < REPLAY_SPEED; k++) car.step(track, maxTicksFor(track));
    if (car.done) {
      replay.pauseUntil ||= performance.now() + 1500;
      if (performance.now() > replay.pauseUntil) playReplay(replay.index);
    }
    drawScene(track, { traffic: trafficOn(track, car.ticks) });
    paintCar(car, { color: state.profile.color, sensors: true, number: 1 });
    setHud([
      `<b>${esc(trackTitle(results[replay.index], replay.index))}</b>`,
      `время <b>${secs(car.ticks)}</b>`,
      `пройдено <b>${pct(carReport(car, track).progressPct)}</b>`,
      `повтор ×${REPLAY_SPEED}`,
    ]);
  },
};

// ── экзамен ──

/** Как на гонке: всегда с попутными и встречными машинами */
const examTracks = () => [
  ...TRAINING_TRACKS.map(({ id }) => ({ track: withTraffic(getTrainingTrack(id), 'all'), known: true })),
  ...UNKNOWN_SEEDS.map((seed) => ({ track: withTraffic(seedTrack(seed), 'all'), known: false })),
];

const championCar = (track) => new Car(track, { brain: state.champion, think: thinkFn(), sensors: state.config.sensors });

function runExam() {
  if (!state.champion) return showBanner('Сначала обучи мозг: на «Я учу» или «Учится само»');
  results = examTracks().map(({ track, known }) => {
    const car = championCar(track);
    const maxTicks = maxTicksFor(track);
    while (!car.done) car.step(track, maxTicks);
    return { track, known, status: car.status, into: car.crashedInto, pct: carReport(car, track).progressPct, ticks: car.ticks };
  });
  const firstFail = results.findIndex((r) => r.status !== 'finished');
  playReplay(Math.max(0, firstFail));
}

function playReplay(index) {
  replay = { index, car: championCar(results[index].track), pauseUntil: 0 };
  renderResults();
}

const trackTitle = (r, i) => (r.known ? r.track.name : `Незнакомая ${i - TRAINING_TRACKS.length + 1}`);

const statusHtml = (r) =>
  r.status === 'finished' ? '<span class="st-ok">доехал</span>'
  : r.status === 'crashed' ? `<span class="st-bad">${r.into === 'car' ? 'авария' : 'бордюр'} на ${pct(r.pct)}</span>`
  : `<span class="st-meh">заглох на ${pct(r.pct)}</span>`;

function verdict() {
  const known = results.filter((r) => r.known && r.status === 'finished').length;
  const unknown = results.filter((r) => !r.known && r.status === 'finished').length;
  if (known + unknown === results.length) return 'Доехал везде. Можно на гонку. Теперь выжимай скорость через фитнес.';
  if (known + unknown === 0) return 'Пока не доехал ни разу. Учи дальше или поменяй настройки.';
  if (unknown === 0) return `Знакомые трассы: ${known} из 3, незнакомые: 0 из 3. Похоже на переобучение: мозг выучил трассу, а не умение ездить. Попробуй режим «Микс».`;
  return `Знакомые трассы: ${known} из 3, незнакомые: ${unknown} из 3. На гонке будет незнакомая трасса.`;
}

function renderResults() {
  $('#examTable tbody').innerHTML = results.length
    ? results.map((r, i) => `
        <tr data-i="${i}" class="${replay?.index === i ? 'sel' : ''}">
          <td>${esc(trackTitle(r, i))}</td><td>${statusHtml(r)}</td>
          <td class="num">${r.status === 'finished' ? secs(r.ticks) : '—'}</td>
        </tr>`).join('')
    : '<tr class="empty"><td colspan="3">Нажми «Проверить чемпиона»: он проедет 3 знакомые и 3 незнакомые трассы. Как на гонке — с попутными и встречными машинами.</td></tr>';
  $('#examVerdict').textContent = results.length ? verdict() : '';
}

$('#eRun').addEventListener('click', runExam);
delegate('#examTable', 'click', 'tr[data-i]', (row) => playReplay(+row.dataset.i));

// ── файл для гонки ──

const swatches = CAR_COLORS.map((c) =>
  `<button role="radio" aria-checked="false" data-color="${c}" style="background:${c}" aria-label="Цвет ${c}"></button>`).join('');
$('#pColors').innerHTML = `${swatches}<label class="custom-color" title="Свой цвет"><input type="color" id="pColorCustom" aria-label="Свой цвет"></label>`;
$('#pName').value = state.profile.name;

function renderExport() {
  const custom = !CAR_COLORS.includes(state.profile.color);
  for (const b of $$('#pColors button')) b.setAttribute('aria-checked', String(b.dataset.color === state.profile.color));
  $('#pColorCustom').value = state.profile.color;
  $('#pColorCustom').parentElement.classList.toggle('on', custom);
  $('#pColorCustom').parentElement.style.background = custom ? state.profile.color : '';
  renderAvatar();
  const file = toCarFile();
  $('#pJson').value = file ? JSON.stringify(file) : 'Сначала обучи мозг.';
  $('#pCopy').disabled = $('#pDownload').disabled = !file;
  renderSealButton();
  if (loginLooksValid() && !loginChecks.has(currentLogin().toLowerCase())) checkLogin(); // раз за сессию, чтобы не тратить лимит GitHub
  renderResults();
}

function setColor(color) {
  state.profile.color = color;
  persist();
  renderExport();
}
delegate('#pColors', 'click', '[data-color]', (b) => setColor(b.dataset.color));
$('#pColorCustom').addEventListener('change', (e) => setColor(e.target.value));
$('#pName').addEventListener('input', (e) => {
  state.profile.name = e.target.value;
  persist();
  renderExport();
});

// ── аватар: маленькая SVG-картинка, её покажут в таблице гонки и на стриме ──

function renderAvatar(error = '') {
  const url = avatarUrl(state.profile.avatar);
  $('#pAvatarImg').hidden = !url;
  if (url) $('#pAvatarImg').src = url;
  $('#pAvatarClear').hidden = !url;
  showError('#pAvatarError', error);
}

$('#pAvatarFile').addEventListener('change', async (e) => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  try {
    state.profile.avatar = checkAvatar(await file.text());
    persist();
    renderExport();
  } catch (err) {
    renderAvatar(`Не подошло: ${err.message}`);
  }
});
$('#pAvatarClear').addEventListener('click', () => {
  delete state.profile.avatar;
  persist();
  renderExport();
});

$('#pCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#pJson').value);
    $('#pMsg').textContent = 'Скопировано. Отправь преподавателю или вставь на вкладке «Гонка».';
  } catch {
    $('#pJson').closest('details').open = true;
    $('#pJson').select();
    $('#pMsg').textContent = 'Буфер обмена недоступен: текст выделен, скопируй его вручную (Ctrl+C).';
  }
});

canDownload().then((ok) => ($('#pDownload').hidden = $('#pSeal').hidden = !ok));
$('#pDownload').addEventListener('click', async () => {
  const file = toCarFile();
  if (!file) return;
  try {
    await saveFile(CAR_FILE_NAME, JSON.stringify(file, null, 1));
    $('#pMsg').textContent = `Сохранено: ${CAR_FILE_NAME}. Это открытый файл — для себя. Сдавай запечатанный.`;
  } catch (e) {
    $('#pMsg').textContent = e?.code === 'declined' ? 'Скачивание отменено.' : 'Не получилось скачать. Используй «Скопировать JSON».';
  }
});

// ── сдача: логин на GitHub и запечатанный файл ──
// Логин нужен, чтобы в финале сверить: файл сдал тот, кто его сделал.
// Проверка на GitHub — подсказка против опечаток: если GitHub недоступен или кончился лимит, она не мешает.

const loginChecks = new Map(); // логин → { status: 'found' | 'missing' | 'unknown', user }
let loginTimer = 0;

$('#pLogin').value = state.profile.login ?? '';
const currentLogin = () => (state.profile.login ?? '').trim();
const loginLooksValid = () => GITHUB_LOGIN.test(currentLogin());

$('#pLogin').addEventListener('input', (e) => {
  state.profile.login = e.target.value.trim();
  persist();
  clearTimeout(loginTimer);
  loginTimer = setTimeout(checkLogin, LOGIN_CHECK_DELAY_MS);
  renderLoginCheck();
  renderSealButton();
});

async function checkLogin() {
  const login = currentLogin();
  if (!GITHUB_LOGIN.test(login) || loginChecks.has(login.toLowerCase())) return renderLoginCheck();
  loginChecks.set(login.toLowerCase(), { status: 'checking' });
  renderLoginCheck();
  let result = { status: 'unknown' };
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.status === 404) result = { status: 'missing' };
    else if (res.ok) result = { status: 'found', user: await res.json() };
  } catch { /* нет сети или GitHub не пустил — не страшно */ }
  loginChecks.set(login.toLowerCase(), result);
  // GitHub знает, как логин пишется правильно (регистр букв) — подставим
  if (result.status === 'found' && result.user.login !== login && result.user.login.toLowerCase() === login.toLowerCase()) {
    state.profile.login = $('#pLogin').value = result.user.login;
    persist();
  }
  renderLoginCheck();
}

function renderLoginCheck() {
  const login = currentLogin();
  const box = $('#pLoginCheck');
  const check = loginChecks.get(login.toLowerCase());
  box.className = 'gh-check';
  if (!login) box.textContent = 'Впиши логин — без него файл для сдачи не скачать.';
  else if (!loginLooksValid()) {
    box.textContent = 'Так логин на GitHub не пишется: латиница, цифры и дефис, до 39 символов.';
    box.classList.add('bad');
  } else if (!check || check.status === 'checking') box.textContent = 'Проверяем на GitHub…';
  else if (check.status === 'found') {
    const { avatar_url: avatar, name, login: canonical } = check.user;
    box.innerHTML = `${/^https:\/\/avatars\.githubusercontent\.com\//.test(avatar) ? `<img src="${esc(avatar)}&s=64" alt="" onerror="this.remove()">` : ''}<span>Это ты? <b>${esc(name || canonical)}</b> @${esc(canonical)}</span>`;
    box.classList.add('good');
  } else if (check.status === 'missing') {
    box.textContent = 'Такого пользователя на GitHub нет — проверь, нет ли опечатки.';
    box.classList.add('bad');
  } else box.textContent = 'Не получилось проверить на GitHub — просто убедись, что логин верный.';
}

function renderSealButton() {
  $('#pSeal').disabled = !toCarFile() || !loginLooksValid() || !COURSE_KEY;
  $('#pSeal').title = !COURSE_KEY ? 'В этой сборке нет ключа курса (course-key.json)' : !loginLooksValid() ? 'Впиши логин на GitHub' : '';
}

$('#pSeal').addEventListener('click', async () => {
  const file = toCarFile();
  if (!file) return;
  try {
    const sealed = await sealCar(file, currentLogin(), COURSE_KEY);
    await saveFile(SEALED_FILE_NAME, JSON.stringify(sealed));
    $('#pMsg').textContent = `Сохранено: ${SEALED_FILE_NAME}. Его и сдавай пул-реквестом. Открыть его могут только кураторы.`;
  } catch (e) {
    $('#pMsg').textContent = e?.code === 'declined' ? 'Скачивание отменено.' : `Не получилось: ${e.message}`;
  }
});

renderLoginCheck();

on('champion', () => {
  results = [];
  replay = null;
  if (state.tab === 'exam') renderExport();
});
