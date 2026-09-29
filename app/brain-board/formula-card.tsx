// Карточка формулы нейрона поверх табло. Строки заведены один раз: пока указатель водят по нейронам,
// меняется только их текст — карточка не перестраивается 10 раз в секунду.
import type { Formula } from './formula.ts';
import { TOP_TERMS } from './formula.ts';

type Term = Formula['terms'][number];

/** Строка слагаемого «s1  +.46 × +0.88 = +0.40»; слагаемых меньше, чем строк, — лишние спрятаны */
function TermRow({ term }: { term: () => Term | undefined }): Node {
  return (
    <span hidden={() => !term()}>
      <span className="src">{() => term()?.source.padEnd(3, ' ') ?? ''}</span> {() => term()?.math ?? ''}
    </span>
  );
}

/** Содержимое карточки; formula() — null, когда указатель не над нейроном (тогда карточку прячет табло) */
export function FormulaCard({ formula }: { formula: () => Formula | null }): Node {
  const text = (pick: (f: Formula) => string) => () => {
    const f = formula();
    return f ? pick(f) : '';
  };
  return (
    <>
      <b>{text((f) => f.title)}</b>
      {Array.from({ length: TOP_TERMS }, (_, n) => <TermRow term={() => formula()?.terms[n]} />)}
      <span className="more" hidden={() => !formula()?.rest}>{text((f) => f.rest)}</span>
      <span className="sep">{text((f) => f.sum)} <em>{text((f) => f.z)}</em></span>
      <span>{text((f) => f.activation)} <em>{text((f) => f.value)}</em></span>
    </>
  );
}
