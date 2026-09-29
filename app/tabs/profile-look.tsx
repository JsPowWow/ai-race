// «Профиль», облик машины: имя, цвет и аватар. Их видно на всех трассах, в таблице гонки и на стриме финала.
import { signal } from '@reely/dommy';
import { state, persist, CAR_COLORS, on } from '../state.ts';
import { checkAvatar, avatarUrl, NAME_MAX } from '../../engine/car-file.ts';
import { fromEvents } from '../signals.ts';

/** Облик выбранной машины: пересели в другую (car) или поменяли этот (save) — перечитываем */
const profile = fromEvents(['car', 'save'], () => state.profile);
const avatarError = signal('');
on('car', () => (avatarError.value = '')); // у другой машины своя картинка — старая ошибка ни при чём

function setColor(color: string): void {
  state.profile.color = color;
  persist();
}

/** Аватар — маленькая SVG-картинка, её покажут в таблице гонки и на стриме */
async function loadAvatar(input: HTMLInputElement): Promise<void> {
  const [file] = input.files ?? [];
  input.value = ''; // тот же файл ещё раз — снова событие change
  if (!file) return;
  try {
    state.profile.avatar = checkAvatar(await file.text()) ?? undefined;
    avatarError.value = '';
    persist();
  } catch (err) {
    avatarError.value = `Не подошло: ${(err as Error).message}`;
  }
}

function clearAvatar(): void {
  delete state.profile.avatar;
  avatarError.value = '';
  persist();
}

export function Look(): Node {
  const custom = () => !CAR_COLORS.includes(profile().color);
  const avatar = () => avatarUrl(profile().avatar);
  return (
    <section className="block">
      <h2>Облик</h2>
      <div className="field">
        <label htmlFor="pName">Имя машины</label>
        <input type="text" id="pName" maxLength={NAME_MAX} placeholder="Например, Торетто"
          value={() => profile().name}
          onInput={(e) => {
            state.profile.name = e.currentTarget.value;
            persist();
          }} />
      </div>
      <div className="colors" id="pColors" aria={{ role: 'radiogroup', ariaLabel: 'Цвет машины' }}>
        {CAR_COLORS.map((color) => (
          <button data-color={color} styles={{ background: color }} onClick={() => setColor(color)}
            aria={{ role: 'radio', ariaLabel: `Цвет ${color}`, ariaChecked: () => String(profile().color === color) }} />
        ))}
        <label className={() => (custom() ? 'custom-color on' : 'custom-color')} title="Свой цвет"
          styles={{ background: () => (custom() ? profile().color : '') }}>
          <input type="color" id="pColorCustom" aria={{ ariaLabel: 'Свой цвет' }}
            value={() => profile().color} onChange={(e) => setColor(e.currentTarget.value)} />
        </label>
      </div>
      <div className="avatar-row">
        <img id="pAvatarImg" className="avatar big" alt="Аватар машины" src={avatar} hidden={() => !avatar()} />
        <label className="btn small file">
          Аватар .svg
          <input type="file" id="pAvatarFile" accept=".svg,image/svg+xml" onChange={(e) => loadAvatar(e.currentTarget)} />
        </label>
        <button className="btn small" id="pAvatarClear" hidden={() => !avatar()} onClick={clearAvatar}>Убрать</button>
      </div>
      <p className="hint">Аватар — необязательная SVG-картинка до 8 КБ: её покажут в таблице гонки и на стриме. Без скриптов и ссылок на другие сайты.</p>
      <div className="error" id="pAvatarError" hidden={() => !avatarError.value}>{avatarError}</div>
    </section>
  );
}
