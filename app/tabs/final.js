// Вкладка «Финал» (для кураторов): работы участников → расчёт в Web Worker → шоу этап за этапом → итоги.
//
// Расчёт и показ разделены. Сначала все заезды считаются заранее (несколько секунд),
// потом на стриме показывается запись — плавно, с любой скоростью и без сюрпризов.
import {
  STAGES, stageLabel, stageSeed, stageTrack, isSuperfinal, trafficSnapshot,
  standings, superfinalists, finalStandings, nominations,
} from '../../engine/rally.js';
import { getTrainingTrack } from '../../engine/track.js';
import { buildEntries, openSealedFiles, readFileList, readDrop } from '../final/entries.js';
import { generateCourseKeys, importPrivateKey } from '../../engine/seal.js';
import { COURSE_KEY } from '../generated/course-key.js';
import { runJobs, computeMode } from '../final/pool.js';
import { StageReplay, countStatuses, drawStage, drawProgressStrip } from '../final/show.js';
import { resultText, toMarkdown, toCsv, toJson } from '../final/export.js';
import { startCountdown, stopCountdown, updateCountdown } from '../countdown.js';
import { drawScene, setHud, showBanner } from '../stage.js';
import { saveFile } from '../download.js';
import { state } from '../state.js';
import { $, esc, secs, setPressed, delegate, avatarTag } from '../ui.js';

const STAGE_COUNT = STAGES + 1; // этапы и суперфинал
const BOARD_EVERY = 6;          // обновлять таблицу раз в столько кадров
const LIVE_ROWS = 10;

/** Загруженные файлы и секретный ключ курса (только в памяти вкладки) */
let files = [];
let courseKey = null;
/** Работы, собранные из файлов */
let pool = emptyPool();
/** Чужие файлы, которые куратор всё-таки допустил */
const allowed = new Set();

function emptyPool() {
  return { entries: [], problems: [], twins: [], similar: [], foreign: [], skipped: 0, sealed: 0, opened: 0, locked: 0 };
}
/** Кто едет: все, кроме «чужих» файлов, которые куратор не допустил */
const racers = () => pool.entries.filter((e) => !e.foreign || allowed.has(e.id));
/** Посчитанный финал: { secret, tracks, results[этап] → Map, after[k] — зачёт после k+1 этапов, final, awards } */
let calc = null;
let computing = null;

const show = {
  stage: 0, replay: null, tick: 0, running: false, counting: false, speed: 1, camera: 'follow',
  order: [], found: null, avatars: true, hiddenAvatars: new Set(), watched: new Set(),
};

export const finalTab = {
  enter() {
    renderSetup();
    renderStages();
    renderBoard();
  },
  frame(frameNo) {
    if (updateCountdown() && show.counting) {
      show.counting = false;
      show.running = true;
      renderStages();
    }
    if (show.running) advance();
    draw();
    if (show.running && frameNo % BOARD_EVERY === 0) renderBoard();
  },
};

// ── 1. работы ──

async function loadFiles(list) {
  files = await list;
  allowed.clear();
  await rebuild();
}

/** Собрать работы заново: после новой папки или выбранного ключа */
async function rebuild() {
  const opened = await openSealedFiles(files, courseKey);
  pool = { ...buildEntries(opened.files), sealed: opened.sealed, opened: opened.opened, locked: opened.locked };
  pool.problems.unshift(...opened.problems);
  calc = null;
  show.replay = null;
  show.found = null;
  show.hiddenAvatars.clear();
  show.watched.clear();
  $('#fComputeNote').textContent = '';
  $('#fDq').innerHTML = '';
  $('#fResults').hidden = true;
  renderSetup();
  renderStages();
  renderBoard();
}

$('#fKey').addEventListener('change', async (e) => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  try {
    courseKey = await importPrivateKey(JSON.parse(await file.text()));
    const match = !COURSE_KEY || COURSE_KEY.kid === courseKey.kid;
    $('#fKeyNote').textContent = `Ключ курса ${courseKey.kid} выбран${match ? '' : ` — но сайт шифрует ключом ${COURSE_KEY.kid}: это ключ от другого набора`}.`;
    $('#fKeyNote').classList.toggle('error', !match);
    await rebuild();
  } catch (err) {
    courseKey = null;
    $('#fKeyNote').textContent = `Не подошло: ${err.message}`;
    $('#fKeyNote').classList.add('error');
  }
});

$('#fNewKeys').addEventListener('click', async () => {
  try {
    const { publicFile, privateFile } = await generateCourseKeys();
    await saveFile(`ai-race-private-key-${privateFile.kid}.json`, JSON.stringify(privateFile, null, 2));
    await saveFile('course-key.json', `${JSON.stringify(publicFile, null, 2)}\n`);
    $('#fNewKeysNote').textContent = `Готово, ключ ${publicFile.kid}. Секретный — сохраните у кураторов. course-key.json — замените в репозитории и пересоберите сайт.`;
  } catch (e) {
    $('#fNewKeysNote').textContent = `Не получилось: ${e.message}`;
  }
});

$('#fFolder').addEventListener('change', (e) => {
  loadFiles(readFileList(e.target.files));
  e.target.value = '';
});
$('#fFiles').addEventListener('change', (e) => {
  loadFiles(readFileList(e.target.files));
  e.target.value = '';
});
const viewport = $('#viewport');
viewport.addEventListener('dragover', (e) => {
  if (state.tab !== 'final') return;
  e.preventDefault();
  viewport.classList.add('drop');
});
viewport.addEventListener('drop', (e) => {
  if (state.tab !== 'final') return;
  e.preventDefault();
  viewport.classList.remove('drop');
  loadFiles(readDrop(e.dataTransfer));
});

function renderSetup() {
  const { entries, problems, twins, similar, foreign, skipped, sealed, opened, locked } = pool;
  $('#fCount').textContent = racers().length;
  $('#fCode').textContent = entries.filter((e) => e.code).length;
  $('#fTwins').textContent = twins.reduce((n, g) => n + g.length, 0);
  const notes = [];
  if (problems.length) {
    notes.push(`<details class="notes"><summary>Замечания: ${problems.length}</summary><ul>${problems.map((p) => `<li><code>${esc(p.path)}</code> — ${esc(p.message)}</li>`).join('')}</ul></details>`);
  }
  if (twins.length) {
    notes.push(`<details class="notes"><summary>Одинаковый мозг: групп ${twins.length}</summary>
      <p class="hint">Одинаковые файлы едут одинаково и делят место. Обычно это скопированный или несданный «по умолчанию» мозг.</p>
      <ul>${twins.map((g) => `<li>${g.length} × ${g.map((e) => esc(e.author)).join(', ')}</li>`).join('')}</ul></details>`);
  }
  if (foreign.length) {
    notes.push(`<details class="notes" open><summary class="warn">Чужой файл? ${foreign.length}</summary>
      <p class="hint">Логин внутри печати не совпадает с автором работы. Это кража чужого файла или опечатка в логине. Такие работы не едут, пока вы их не допустите.</p>
      <ul>${foreign.map((e) => `<li><b>${esc(e.author)}</b> сдал файл, запечатанный для <b>${esc(e.claimed)}</b>
        <button class="btn small" data-allow="${esc(e.id)}">${allowed.has(e.id) ? 'Снять допуск' : 'Допустить'}</button></li>`).join('')}</ul></details>`);
  }
  if (similar.length) {
    notes.push(`<details class="notes"><summary>Похожие мозги: пар ${similar.length}</summary>
      <p class="hint">Веса почти совпадают (сходство выше 97%): похоже, один файл скопировали и чуть-чуть поправили. Независимо обученные сети так не совпадают.</p>
      <ul>${similar.slice(0, 100).map((p) => `<li>${esc(p.a.author)} ~ ${esc(p.b.author)} — ${Math.floor(p.similarity * 1000) / 10}%</li>`).join('')}</ul></details>`);
  }
  if (skipped) notes.push(`<p class="hint">Пропущено файлов, не похожих на машину: ${skipped}.</p>`);
  if (sealed || entries.length) {
    const open = entries.filter((e) => !e.sealed).length;
    const waiting = locked ? ` · <b class="warn">ждут секретный ключ: ${locked}</b>` : '';
    notes.unshift(`<p class="hint">Запечатанных файлов: ${sealed}, открыто: ${opened}${waiting}. Незапечатанных работ: ${open}.</p>`);
  }
  $('#fNotes').innerHTML = notes.join('');
  $('#fCompute').disabled = !racers().length || !!computing;

  const withAvatar = entries.filter((e) => e.avatar);
  $('#fGalleryBox').hidden = !withAvatar.length;
  $('#fGallery').innerHTML = withAvatar.map((e) => `
    <button data-av="${esc(e.id)}" class="${show.hiddenAvatars.has(e.id) ? 'off' : ''}" title="${esc(e.author)}">
      ${avatarTag(e)}<span>${esc(e.author)}</span>
    </button>`).join('');
  $('#fNames').innerHTML = entries.map((e) => `<option value="${esc(e.author)}">${esc(e.name)}</option>`).join('');
}

delegate('#fNotes', 'click', '[data-allow]', (b) => {
  const id = b.dataset.allow;
  if (allowed.has(id)) allowed.delete(id);
  else allowed.add(id);
  calc = null;
  show.replay = null;
  renderSetup();
  renderStages();
  renderBoard();
});

delegate('#fGallery', 'click', '[data-av]', (b) => {
  const id = b.dataset.av;
  if (show.hiddenAvatars.has(id)) show.hiddenAvatars.delete(id);
  else show.hiddenAvatars.add(id);
  b.classList.toggle('off', show.hiddenAvatars.has(id));
  renderBoard();
});
$('#fAvatars').addEventListener('change', (e) => {
  show.avatars = e.target.checked;
  renderBoard();
});
const avatarOf = (entry) => (show.avatars && !show.hiddenAvatars.has(entry.id) ? entry : { ...entry, avatar: null });

// ── 2. расчёт ──

$('#fSecret').addEventListener('input', () => {
  $('#fCompute').disabled = !racers().length || !!computing;
});

$('#fCompute').addEventListener('click', compute);

async function compute() {
  const secret = $('#fSecret').value.trim();
  if (!secret) return showBanner('Сначала придумайте секретную фразу', 2500);
  const entries = racers();
  computing?.abort();
  const run = (computing = new AbortController());
  entries.forEach((e) => delete e.dq);
  calc = null;
  show.replay = null;
  show.watched.clear();
  $('#fResults').hidden = true;
  renderStages();
  renderSetup();

  const mode = computeMode();
  const started = performance.now();
  const tracks = Array.from({ length: STAGE_COUNT }, (_, i) => stageTrack(stageSeed(secret, i)));
  const results = tracks.map(() => new Map());
  const jobs = [];
  for (let s = 0; s < STAGES; s++) for (const entry of entries) jobs.push({ entry, seed: stageSeed(secret, s), stage: s });
  const total = jobs.length + Math.min(10, entries.length);
  const progress = $('#fProgress');
  progress.hidden = false;
  const onProgress = (done) => {
    progress.value = done / total;
    $('#fComputeNote').textContent = `Считаем заезды: ${done} из ${total}…`;
  };
  const onResult = (job, result) => {
    if (!result) return;
    if (result.status === 'hung') job.entry.dq = result.message;
    results[job.stage].set(job.entry.id, result);
  };

  try {
    await runJobs(jobs, { onResult, onProgress, skip: (job) => !!job.entry.dq, signal: run.signal });
    if (run.signal.aborted) return;
    const after = [1, 2, 3].map((k) => standings(entries, results, k));
    const finalists = superfinalists(after[STAGES - 1]);
    await runJobs(finalists.map((entry) => ({ entry, seed: stageSeed(secret, STAGES), stage: STAGES })), {
      onResult, onProgress: (done) => onProgress(jobs.length + done), signal: run.signal,
    });
    if (run.signal.aborted) return;

    const final = finalStandings(after[STAGES - 1], results[STAGES]);
    calc = { secret, tracks, results, after, final, awards: nominations(entries, results, final) };
    progress.hidden = true;
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    $('#fComputeNote').textContent = `Готово за ${seconds} с: ${entries.length} участников, ${jobs.length + finalists.length} заездов.${mode === 'page' ? ' Браузер не дал создать Web Worker — участники со своим кодом не посчитаны.' : ''}`;
    renderDq();
    renderSetup();
    selectStage(0);
    showBanner('Финал посчитан. Можно начинать шоу!', 2500);
  } finally {
    if (computing === run) {
      computing = null;
      progress.hidden = true;
      renderSetup();
    }
  }
}

function renderDq() {
  const dq = racers().filter((e) => e.dq);
  const broken = racers().filter((e) => !e.dq && calc.results.some((m) => m.get(e.id)?.status === 'error'));
  const list = (title, items, why) => (items.length
    ? `<details class="notes"><summary>${title}: ${items.length}</summary><ul>${items.map((e) => `<li><b>${esc(e.author)}</b> — ${esc(why(e))}</li>`).join('')}</ul></details>`
    : '');
  $('#fDq').innerHTML = list('Сняты (код завис)', dq, (e) => e.dq)
    + list('Ошибка в коде (едут со штрафом)', broken, (e) => calc.results.find((m) => m.get(e.id)?.status === 'error').get(e.id).message);
}

// ── 3. шоу ──

function renderStages() {
  $('#fStages').innerHTML = Array.from({ length: STAGE_COUNT }, (_, i) =>
    `<button data-fstage="${i}" aria-pressed="${i === show.stage}" ${calc ? '' : 'disabled'}>${stageLabel(i)}${show.watched.has(i) ? ' ✓' : ''}</button>`).join('');
  $('#fPlay').disabled = !calc || show.counting;
  $('#fPlay').textContent = show.counting ? '3… 2… 1…'
    : show.running ? '⏸ Пауза'
    : show.replay && show.tick > 0 && show.tick < show.replay.length ? '▶ Дальше' : '▶ Старт этапа';
}

function selectStage(i) {
  stopCountdown();
  show.counting = false;
  show.stage = i;
  const rows = [];
  for (const entry of racers()) {
    const result = calc.results[i].get(entry.id);
    if (result && !entry.dq) rows.push({ entry, result });
  }
  show.replay = new StageReplay(calc.tracks[i], rows);
  show.tick = 0;
  show.running = false;
  show.order = show.replay.order(0);
  renderStages();
  renderBoard();
}

delegate('#fStages', 'click', '[data-fstage]', (b) => selectStage(+b.dataset.fstage));

$('#fPlay').addEventListener('click', () => {
  if (!show.replay) return;
  if (show.running) show.running = false;
  else if (show.tick > 0 && show.tick < show.replay.length) show.running = true;
  else {
    show.tick = 0;
    show.counting = true;
    startCountdown();
  }
  renderStages();
  renderBoard();
});

delegate('.toolbar[data-for="final"]', 'click', '[data-fspeed]', (b) => {
  show.speed = +b.dataset.fspeed;
  setPressed('[data-fspeed]', (x) => x === b);
});
delegate('.toolbar[data-for="final"]', 'click', '[data-fcam]', (b) => {
  show.camera = b.dataset.fcam;
  setPressed('[data-fcam]', (x) => x === b);
});

function advance() {
  show.tick = Math.min(show.tick + show.speed, show.replay.length);
  if (show.tick >= show.replay.length) stageEnded();
}

function stageEnded() {
  show.running = false;
  show.watched.add(show.stage);
  show.order = show.replay.order(show.tick);
  const leader = show.order[0]?.row.entry;
  if (isSuperfinal(show.stage)) {
    const winner = calc.final[0]?.entry;
    showBanner(winner ? `Победитель финала — ${winner.name} (@${winner.author})!` : 'Финал завершён', 6000);
    renderResults();
  } else {
    showBanner(leader ? `${stageLabel(show.stage)}: быстрее всех ${leader.name}` : `${stageLabel(show.stage)} завершён`, 4000);
  }
  renderStages();
  renderBoard();
}

function draw() {
  if (!show.replay) {
    drawScene(getTrainingTrack('warmup'));
    setHud(['<b>Финал курса</b>', racers().length ? `участников <b>${racers().length}</b>` : 'загрузите работы', calc ? '' : 'потом — «Посчитать финал»'].filter(Boolean));
    return;
  }
  const { replay, tick } = show;
  const order = (show.order = replay.order(tick));
  const target = (show.found && order.find((x) => x.row.entry === show.found)) || order.find((x) => x.car.status === 'driving') || order[0];
  drawScene(replay.track, { camera: show.camera, follow: target?.car, traffic: trafficSnapshot(replay.track, tick) });
  drawStage(order, { found: show.found, showAvatars: show.avatars, hiddenAvatars: show.hiddenAvatars });
  drawProgressStrip(order, { found: show.found });
  const count = countStatuses(order);
  setHud([
    `<b>${stageLabel(show.stage)}</b>`,
    `время <b>${secs(tick)}</b>`,
    `на трассе <b>${count.driving}</b>`,
    `финиш <b>${count.finished}</b>`,
    `сошли <b>${count.out}</b>`,
    show.speed > 1 ? `×${show.speed}` : '',
  ].filter(Boolean));
}

// ── таблица ──

$('#fSearch').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  show.found = q ? pool.entries.find((x) => x.author.toLowerCase() === q) ?? pool.entries.find((x) => x.author.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)) ?? null : null;
  renderBoard();
  scrollToFound();
});

/** Прокрутить таблицу (но не страницу) к найденному участнику */
function scrollToFound() {
  const board = $('#fBoard');
  const row = $('#fBoard .found');
  if (row) board.scrollTop = row.offsetTop - board.clientHeight / 2;
}

const who = (entry) => `${avatarTag(avatarOf(entry))}<span class="who"><b>${esc(entry.name)}</b><span class="kind">@${esc(entry.author)}</span></span>`;
const rowClass = (entry, place) => [entry === show.found ? 'found' : '', place <= 3 ? `p${place}` : ''].filter(Boolean).join(' ');

function renderBoard() {
  const board = $('#fBoard');
  if (!calc || !show.replay) {
    $('#fBoardTitle').textContent = 'Участники';
    $('#fCounts').textContent = '';
    board.innerHTML = racers().length
      ? racers().map((e) => `<li class="${rowClass(e, 99)}">${who(e)}</li>`).join('')
      : '<li class="empty">Загрузите работы участников</li>';
    return;
  }
  const live = show.running || (show.tick > 0 && show.tick < show.replay.length);
  if (live) renderLive(board);
  else renderStandings(board);
}

function renderLive(board) {
  const order = show.order;
  const count = countStatuses(order);
  $('#fBoardTitle').textContent = `${stageLabel(show.stage)} · live`;
  $('#fCounts').textContent = `На трассе ${count.driving} · финиш ${count.finished} · сошли ${count.out}`;
  const liveText = ({ car, row }) => (car.status === 'driving' ? `${Math.floor(car.progress * 100)}%` : resultText(row.result));
  const line = (item, i) => `<li class="${rowClass(item.row.entry, i + 1)}"><span class="pos">${i + 1}</span>${who(item.row.entry)}<span class="res">${liveText(item)}</span></li>`;
  const rows = order.slice(0, LIVE_ROWS).map(line);
  const foundAt = show.found ? order.findIndex((x) => x.row.entry === show.found) : -1;
  if (foundAt >= LIVE_ROWS) rows.push('<li class="gap">…</li>', line(order[foundAt], foundAt));
  board.innerHTML = rows.join('');
}

function renderStandings(board) {
  const stage = show.stage;
  const watched = show.watched.has(stage);
  let rows, prev = null, title, value;
  if (isSuperfinal(stage) && watched) {
    rows = calc.final;
    title = 'Итог финала';
    value = (r) => (r.superTime !== undefined ? resultText(calc.results[STAGES].get(r.entry.id)) : `${r.total.toFixed(1)} с`);
  } else {
    const shown = watched ? Math.min(stage, STAGES - 1) : stage - 1;
    if (shown < 0) {
      $('#fBoardTitle').textContent = `${stageLabel(stage)} · на старте`;
      $('#fCounts').textContent = `Участников: ${show.replay.rows.length}`;
      board.innerHTML = show.replay.rows.map(({ entry }) => `<li class="${rowClass(entry, 99)}">${who(entry)}</li>`).join('');
      return;
    }
    rows = calc.after[shown];
    prev = shown > 0 ? new Map(calc.after[shown - 1].map((r) => [r.entry, r.place])) : null;
    title = isSuperfinal(stage) ? 'Суперфинал · едет первая десятка' : `Общий зачёт после ${shown + 1} ${shown ? 'этапов' : 'этапа'}`;
    value = (r) => `${Number.isFinite(r.total) ? r.total.toFixed(1) : '—'} с`;
  }
  $('#fBoardTitle').textContent = title;
  $('#fCounts').textContent = `Сумма времени этапов. Не доехал — штраф. ${rows.length} участников.`;
  board.innerHTML = rows.map((r) => {
    const was = prev?.get(r.entry);
    const delta = was === undefined || was === r.place ? '' : was > r.place ? `<span class="up">▲${was - r.place}</span>` : `<span class="down">▼${r.place - was}</span>`;
    return `<li class="${rowClass(r.entry, r.place)}"><span class="pos">${r.place}</span>${who(r.entry)}${delta}<span class="res">${esc(value(r))}</span></li>`;
  }).join('');
}

// ── итоги ──

function renderResults() {
  $('#fResults').hidden = false;
  $('#fAwards').innerHTML = calc.awards.map((a) =>
    `<div class="award"><b>${esc(a.title)}</b>${a.entry ? `${esc(a.entry.name)} (@${esc(a.entry.author)}) — ` : ''}${esc(a.text)}</div>`).join('');
}

async function save(filename, data, type) {
  try {
    await saveFile(filename, data, type);
    $('#fSaveNote').textContent = `Сохранено: ${filename}`;
  } catch (e) {
    $('#fSaveNote').textContent = e?.code === 'declined' ? 'Скачивание отменено.' : `Не получилось сохранить: ${e.message}`;
  }
}
$('#fSaveMd').addEventListener('click', () => save('RESULTS.md', toMarkdown(calc, racers()), 'text/markdown'));
$('#fSaveCsv').addEventListener('click', () => save('ai-race-results.csv', toCsv(calc), 'text/csv'));
$('#fSaveJson').addEventListener('click', () => save('results.json', toJson(calc, racers())));

// ── режим трансляции: только трасса и таблица, на весь экран ──

function setBroadcast(on) {
  document.body.classList.toggle('broadcast', on);
  $('#fBroadcast').setAttribute('aria-pressed', String(on));
  if (on) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
$('#fBroadcast').addEventListener('click', () => setBroadcast(!document.body.classList.contains('broadcast')));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('broadcast')) setBroadcast(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('broadcast')) setBroadcast(false);
});

/** Уходим с вкладки — выходим из трансляции */
export function leaveFinal() {
  if (document.body.classList.contains('broadcast')) setBroadcast(false);
}
