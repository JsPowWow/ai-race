// Метка машины — кружок её цвета: общий для гаража, гонки и других списков участников.

/** Кружок цвета машины. look — откуда взять цвет (участник, соперник, машина гаража) */
export function CarDot({ look }: { look: () => { color: string } }): Node {
  return <span className="car-dot" styles={{ background: () => look().color }} />;
}
