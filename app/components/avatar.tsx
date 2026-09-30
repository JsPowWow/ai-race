// Аватар машины — общий для гаража, гонки и других списков участников.
import { Show } from '@reely/dommy';
import { avatarUrl } from '../../engine/car-file.ts';

/** Облик, из которого рисуем аватар: SVG-картинка (может не быть) и цвет машины */
export type AvatarLook = { avatar?: string | null; color: string };

/**
 * Картинка участника или кружок его цвета.
 * SVG показываем только через <img>: так браузер не выполняет скрипты из картинки и ничего не грузит из сети.
 */
export function Avatar({ look }: { look: () => AvatarLook }): Node {
  return (
    <Show when={() => avatarUrl(look().avatar)} fallback={() => <span className="car-dot" styles={{ background: () => look().color }} />}>
      {(src) => <img className="avatar" src={src} alt="" loading="lazy" />}
    </Show>
  );
}
