// Хранилище браузера (localStorage) с защитой.
//
// • В приватном окне или превью его может не быть — тогда просто ничего не сохраняем.
// • Места мало: обычно около 5 МБ на сайт, и его делят все проекты на jspowwow.github.io.
//   Поэтому числа сохраняем с 5 знаками после запятой (для весов этого хватает с запасом),
//   а если место кончилось — один раз сообщаем об этом, но страница продолжает работать.
const PREFIX = 'ai-race:';
const DIGITS = 1e5;

const compact = (_key: string, value: unknown) => (typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * DIGITS) / DIGITS : value);

/** JSON покороче: дробные числа — 5 знаков после запятой (для весов мозга хватает с запасом) */
export const compactJson = (value: unknown): string => JSON.stringify(value, compact);

const fullListeners: ((key: string) => void)[] = [];
let warnedFull = false;

/** fn(key) вызовется один раз, если хранилище переполнится */
export const onStorageFull = (fn: (key: string) => void) => fullListeners.push(fn);

/** Прочитать сохранённое. Нет, испорчено или хранилища нет — fallback. Что там лежит, проверяет вызывающий */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value, compact));
    return true;
  } catch (e) {
    const full = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
    if (full && !warnedFull) {
      warnedFull = true;
      fullListeners.forEach((fn) => fn(key));
    }
    return false;
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch { /* нет хранилища — и ладно */ }
}

/** Сколько места занимает AI Race, в байтах (браузер хранит строки по 2 байта на символ) */
export function usedBytes(): number {
  try {
    let chars = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) chars += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
    return chars * 2;
  } catch {
    return 0;
  }
}
