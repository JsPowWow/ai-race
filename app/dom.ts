// Элементы из app/markup.html для кода на TypeScript.

/** Элемент из разметки. Его нет — ошибка сразу, с именем селектора, а не загадочный null потом */
export function element<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`в разметке нет ${selector}`);
  return found;
}
