// «Рецепт роя»: за что хвалим (фитнес), как меняем детей (мутация), как думает мозг и сколько родителей.
// Новый рецепт действует со следующего поколения: рой перечитывает его в начале каждого (train-swarm.ts).
import { FITNESS_PARTS, MUTATIONS } from '../../engine/learn/recipes.ts';
import { state } from '../state.ts';
import { live } from '../student-code.ts';
import { changeShape } from '../library.ts';
import { fromEvents } from '../signals.ts';
import { Seg, Select } from '../components/controls.tsx';
import { train, setTrain } from './train-settings.ts';
import { mutationId, setParents } from './train-swarm.ts';

type CheckProps = { title: string; hint: string; checked: () => boolean; disabled?: () => boolean; toggle: (on: boolean) => void };

/** Галочка с пояснением: что она добавляет */
function Check({ title, hint, checked, disabled, toggle }: CheckProps): Node {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled ?? false} onChange={(e) => toggle(e.currentTarget.checked)} />
      <span><b>{title}</b><small>{hint}</small></span>
    </label>
  );
}

/** Галочки фитнеса. Порядок частей не важен: поправки всегда идут в порядке FITNESS_PARTS */
function setPart(id: string, on: boolean): void {
  setTrain('parts', Object.keys(FITNESS_PARTS).filter((part) => (part === id ? on : train().parts.includes(part))));
}

function FitnessParts(): Node {
  const own = () => train().ownFitness;
  return (
    <fieldset className="parts">
      <legend>За что хвалим</legend>
      <p className="hint">Основа — сколько проехал. Галочки добавляют поправки.</p>
      <div id="tParts">
        {Object.entries(FITNESS_PARTS).map(([id, part]) => (
          <Check title={part.title} hint={part.hint} checked={() => train().parts.includes(id)} disabled={own} toggle={(on) => setPart(id, on)} />
        ))}
        <Check title="Мой вариант" hint="Своя функция fitness из student/fitness.js (вкладка «Код») вместо галочек."
          checked={own} toggle={(on) => setTrain('ownFitness', on)} />
      </div>
    </fieldset>
  );
}

const MUTATION_CHOICES = Object.entries(MUTATIONS).map(([id, { title }]) => ({ id, title }));

type Variants = Record<string, { title?: string; hint?: string }>;
/** Варианты мозга из student/think.js: поправили код — список другой */
const variants = fromEvents(['code'], (): Variants => live.think.thinkVariants ?? {});
/** Вариант мозга в машине: меняют и здесь, и в «Профиле» */
const think = fromEvents(['config', 'car'], (): string => state.config.think);
/** Вариант на экране: такого в think.js уже нет — думает «Ступенька» (как thinkVariant() в state.js) */
const shownThink = () => (think() in variants() ? think() : 'step');

/** Форма сети та же — мозг остаётся, меняется только то, как он считает */
const setThink = (id: string) => changeShape({ ...state.config, think: id });

export function Recipe(): Node {
  const thinkChoices = () => Object.entries(variants()).map(([id, v]) => ({ id, title: v.title || id }));
  return (
    <section className="block recipe">
      <h2>Рецепт роя</h2>
      <FitnessParts />
      <div className="field wide">
        <label htmlFor="tMutation">Как меняем детей</label>
        <Select id="tMutation" items={MUTATION_CHOICES} value={() => mutationId(train().mutation)} pick={(id) => setTrain('mutation', id)} />
      </div>
      <p className="hint" id="tMutationHint">{() => MUTATIONS[mutationId(train().mutation)].hint}</p>
      <div className="field wide">
        <label htmlFor="tThink">Как думает мозг</label>
        <Select id="tThink" items={thinkChoices} value={shownThink} pick={setThink} />
      </div>
      <p className="hint" id="tThinkHint">{() => variants()[shownThink()]?.hint ?? ''}</p>
      <div className="field wide">
        <span className="lbl">Родителей</span>
        <Seg label="Сколько родителей" items={[{ id: 1, title: '1' }, { id: 2, title: '2' }]} value={() => train().parents} pick={setParents} />
      </div>
      <p className="hint">Родители — лучшие 10% поколения. С двумя ребёнок берёт нейроны от обоих (кроссовер), с одним — копия одного. Лучший всегда едет дальше без изменений — на трассе он с номером 1.</p>
      <p className="hint">Новый рецепт действует со следующего поколения.</p>
    </section>
  );
}
