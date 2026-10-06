// ════════════════════════════════════════════════════════════════
//  БОНУС. РУЧНОЕ УПРАВЛЕНИЕ
// ════════════════════════════════════════════════════════════════
//
//  Вызывается на каждое нажатие и отпускание клавиши (и на джойстик под трассой на телефоне: наклон — это те же стрелки).
//  key      — какая клавиша: 'ArrowUp', 'w', ' ' и т. д. (как event.key)
//  isDown   — true: нажали, false: отпустили
//  controls — объект { gas, brake, left, right }, каждое значение от 0 до 1.
//             Меняй нужные поля. Остальные не трогай.
//
//  Вернуть true, если клавиша «наша» (тогда страница не будет прокручиваться стрелками).

export function handleKey(key, isDown, controls) {
  const value = isDown ? 1 : 0;
  switch (key) {
    case 'ArrowUp':
      controls.gas = value;
      return true;
    case 'ArrowDown':
      controls.brake = value;
      return true;
    case 'ArrowLeft':
      controls.left = value;
      return true;
    case 'ArrowRight':
      controls.right = value;
      return true;
  }
  return false;

  // TODO:
  //  • добавь WASD (осторожно: при включённом Caps Lock придёт 'W', а не 'w')
  //  • пробел — «ручник»: газ в ноль, тормоз до упора
  //  • Shift — «аккуратный режим»: газ только наполовину
}
