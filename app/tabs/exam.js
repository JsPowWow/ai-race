// Вкладка «Экзамен» (урок 3): проверка на незнакомых трассах и файл для гонки.
import { TRAINING_TRACKS, getTrainingTrack } from '../../engine/track.js';
import { Car, carReport, maxTicksFor } from '../../engine/car.js';
import { withTraffic } from '../../engine/traffic.js';
import { state, persist, thinkFn, on, CAR_COLORS } from '../state.js';
import { seedTrack } from '../tracks.js';
import { toCarFile } from '../car-file.js';
import { drawScene, paintCar, trafficOn, setHud, showBanner } from '../stage.js';
import { $, $$, esc, secs, pct, delegate } from '../ui.js';

const UNKNOWN_SEEDS = ['экзамен-1', 'экзамен-2', 'экзамен-3'];
const REPLAY_SPEED = 3;

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
    paintCar(car, { color: state.profile.color, sensors: true, glow: true });
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
  if (!state.champion) return showBanner('Сначала обучи мозг на вкладке «Трек»');
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

$('#pColors').innerHTML = CAR_COLORS.map((c) =>
  `<button role="radio" aria-checked="false" data-color="${c}" style="background:${c}" aria-label="Цвет ${c}"></button>`).join('');
$('#pName').value = state.profile.name;

function renderExport() {
  for (const b of $$('#pColors button')) b.setAttribute('aria-checked', String(b.dataset.color === state.profile.color));
  const file = toCarFile();
  $('#pJson').value = file ? JSON.stringify(file) : 'Сначала обучи мозг.';
  $('#pCopy').disabled = $('#pDownload').disabled = !file;
  renderResults();
}

delegate('#pColors', 'click', '[data-color]', (b) => {
  state.profile.color = b.dataset.color;
  persist();
  renderExport();
});
$('#pName').addEventListener('input', (e) => {
  state.profile.name = e.target.value;
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

// Скачивание: внутри Claude — через платформу, на обычном сайте — ссылкой.
let platformDownloads = null;
if (typeof window.claude?.use === 'function') {
  window.claude.use('downloads')
    .then((d) => { platformDownloads = d; $('#pDownload').hidden = !d; })
    .catch(() => ($('#pDownload').hidden = true));
}

$('#pDownload').addEventListener('click', async () => {
  const file = toCarFile();
  if (!file) return;
  const data = JSON.stringify(file, null, 1);
  const filename = `${file.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.json`;
  try {
    if (platformDownloads) await platformDownloads.save({ filename, data });
    else downloadViaLink(filename, data);
    $('#pMsg').textContent = `Сохранено: ${filename}`;
  } catch (e) {
    $('#pMsg').textContent = e?.code === 'declined' ? 'Скачивание отменено.' : 'Не получилось скачать. Используй «Скопировать JSON».';
  }
});

function downloadViaLink(filename, data) {
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([data], { type: 'application/json' })),
    download: filename,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

on('champion', () => {
  results = [];
  replay = null;
  if (state.tab === 'exam') renderExport();
});
