// Кнопки масштаба табло: «+», «−» и «1:1». Кладутся в контейнер .zoom (role="group" — в разметке).
// Что можно нажать, решает сам масштаб: отдалять дальше обычного некуда, приближать — дальше предела.

/** Куда двинуть масштаб */
export type ZoomStep = 'in' | 'out' | 'reset';

export function ZoomButtons({ zoom, max, onZoom }: { zoom: () => number; max: number; onZoom: (how: ZoomStep) => void }): Node {
  return (
    <>
      <button className="btn" data-z="in" aria={{ ariaLabel: 'Приблизить' }} disabled={() => zoom() >= max} onClick={() => onZoom('in')}>+</button>
      <button className="btn" data-z="out" aria={{ ariaLabel: 'Отдалить' }} disabled={() => zoom() === 1} onClick={() => onZoom('out')}>−</button>
      <button className="btn" data-z="reset" aria={{ ariaLabel: 'Обычный масштаб' }} hidden={() => zoom() === 1} onClick={() => onZoom('reset')}>1:1</button>
    </>
  );
}
