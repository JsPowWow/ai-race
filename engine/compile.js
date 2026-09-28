// Текст ES-модуля студента → объект с его экспортами.
//
// Текст превращается в функцию через new Function. Это НЕ песочница: код выполнится с теми же
// правами, что и место, где его запустили. Поэтому:
//  • на странице запускается только свой код (вкладка «Код») или чужой после «Разрешить»;
//  • в финале чужой код выполняется в Web Worker (app/final/worker.js): там нет страницы,
//    хранилища и cookies, а зависший расчёт просто останавливается.
// Опасные глобальные имена подменены на undefined — от случайностей и простых шалостей, не от взлома.
import { lerp, randomBetween, randomGauss, sigmoid, clamp } from './utils.js';

export const BLOCKED = [
  'window', 'self', 'globalThis', 'document', 'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator', 'location', 'history',
  'open', 'alert', 'Function', 'Worker', 'importScripts', 'postMessage', 'BroadcastChannel',
];
const HELPERS = { lerp, randomBetween, randomGauss, sigmoid, clamp };

/** Бросает то, что бросил код студента (с исходным стеком) */
export function compileSource(src) {
  const names = [...src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const body = src
    .replace(/^[ \t]*import\s[^;]*;?/gm, (m) => m.replace(/[^\n]/g, '')) // строки не сдвигаются
    .replace(/export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/g, '');
  const params = [...Object.keys(HELPERS), ...BLOCKED];
  const factory = new Function(...params, `"use strict";\n${body}\nreturn { ${names.join(', ')} };`);
  return factory(...Object.values(HELPERS));
}

/** Свой вариант мозга из текста think.js: функция thinkVariants.mine.think */
export function compileMineThink(src) {
  const think = compileSource(src).thinkVariants?.mine?.think;
  if (typeof think !== 'function') throw new Error('в коде нет thinkVariants.mine.think');
  return think;
}
