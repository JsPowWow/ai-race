// «Профиль», облик машины: имя и цвет. Их видно на всех трассах, в таблице гонки и на стриме финала.
import { state, persist, CAR_COLORS } from '../state.ts';
import { NAME_MAX } from '../../engine/course/car-file.ts';
import { fromEvents } from '../signals.ts';

/** Облик выбранной машины: пересели в другую (car) или поменяли этот (save) — перечитываем */
const profile = fromEvents(['car', 'save'], () => state.profile);

function setColor(color: string): void {
  state.profile.color = color;
  persist();
}

export function Look(): Node {
  const custom = () => !CAR_COLORS.includes(profile().color);
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
            aria={{ role: 'radio', ariaLabel: `Цвет ${color}`, ariaChecked: () => profile().color === color }} />
        ))}
        <label className={() => (custom() ? 'custom-color on' : 'custom-color')} title="Свой цвет"
          styles={{ background: () => (custom() ? profile().color : '') }}>
          <input type="color" id="pColorCustom" aria={{ ariaLabel: 'Свой цвет' }}
            value={() => profile().color} onChange={(e) => setColor(e.currentTarget.value)} />
        </label>
      </div>
    </section>
  );
}
