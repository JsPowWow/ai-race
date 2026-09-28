// «Профиль», облик машины: имя, цвет и аватар. Их видно на всех трассах, в таблице гонки и на стриме финала.
import { state, persist, CAR_COLORS, on } from '../state.js';
import { checkAvatar, avatarUrl } from '../../engine/car-file.js';
import { $, $$, delegate, showError } from '../ui.js';

const swatches = CAR_COLORS.map((c) =>
  `<button role="radio" aria-checked="false" data-color="${c}" style="background:${c}" aria-label="Цвет ${c}"></button>`).join('');
$('#pColors').innerHTML = `${swatches}<label class="custom-color" title="Свой цвет"><input type="color" id="pColorCustom" aria-label="Свой цвет"></label>`;

export function renderLook(error = '') {
  if (document.activeElement !== $('#pName')) $('#pName').value = state.profile.name;
  const custom = !CAR_COLORS.includes(state.profile.color);
  for (const b of $$('#pColors button')) b.setAttribute('aria-checked', String(b.dataset.color === state.profile.color));
  $('#pColorCustom').value = state.profile.color;
  $('#pColorCustom').parentElement.classList.toggle('on', custom);
  $('#pColorCustom').parentElement.style.background = custom ? state.profile.color : '';

  const url = avatarUrl(state.profile.avatar);
  $('#pAvatarImg').hidden = !url;
  if (url) $('#pAvatarImg').src = url;
  $('#pAvatarClear').hidden = !url;
  showError('#pAvatarError', error);
}

function setColor(color) {
  state.profile.color = color;
  persist();
  renderLook();
}
delegate('#pColors', 'click', '[data-color]', (b) => setColor(b.dataset.color));
$('#pColorCustom').addEventListener('change', (e) => setColor(e.target.value));
$('#pName').addEventListener('input', (e) => {
  state.profile.name = e.target.value;
  persist();
});

// ── аватар: маленькая SVG-картинка, её покажут в таблице гонки и на стриме ──

$('#pAvatarFile').addEventListener('change', async (e) => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  try {
    state.profile.avatar = checkAvatar(await file.text());
    persist();
    renderLook();
  } catch (err) {
    renderLook(`Не подошло: ${err.message}`);
  }
});
$('#pAvatarClear').addEventListener('click', () => {
  delete state.profile.avatar;
  persist();
  renderLook();
});

on('car', () => renderLook()); // пересели в другую машину гаража — у неё свой облик
