// Web Worker расчёта финала. Здесь выполняется чужой код (свой вариант мозга из файла участника).
//
// Чего у кода здесь нет: страницы, хранилища, cookies — это Worker.
// Что мы дополнительно отнимаем, пока не запустили ни строчки чужого кода:
//  • сеть и общение с внешним миром (fetch, WebSocket, postMessage …);
//  • возможность испортить общие вещи для следующих участников (Math, прототипы заморожены);
//  • «лазейки» к глобальному объекту (eval, конструктор функций).
// Зависание ловит страница: если ответа нет несколько секунд, Worker просто уничтожают.
import { runJob } from './job.ts';
import type { Job } from './job.ts';
import { mulberry32, hashString } from '../../engine/utils.ts';

/** Задача от страницы (см. pool.ts) */
export type JobMessage = Job & { jobId: number };

/** То, чем мы пользуемся у Worker. Типы проекта описывают страницу (lib dom), а не Worker — поэтому своё описание */
type WorkerScope = {
  postMessage(message: unknown, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<JobMessage>) => void) | null;
};
const scope = self as unknown as WorkerScope;

// Берём до lockdown(): потом postMessage у глобального объекта уже не будет
const post = scope.postMessage.bind(scope);

// Math.random у каждого участника на каждом этапе свой, но всегда одинаковый — гонку можно повторить
let rng = mulberry32(1);
Math.random = () => rng();

scope.onmessage = ({ data }) => {
  rng = mulberry32(hashString(`${data.entry.id}|${data.seed}`));
  const result = runJob(data, { allowCode: true });
  post({ jobId: data.jobId, result }, [result.traj.buffer]);
};

lockdown();

function lockdown(): void {
  const forbid = [
    'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'Request', 'Response',
    'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker',
    'postMessage', 'close', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'onmessage',
    'setTimeout', 'setInterval', 'queueMicrotask', 'eval',
  ];
  for (const name of forbid) {
    for (let o: object | null = self; o; o = Object.getPrototypeOf(o)) {
      if (Object.hasOwn(o, name)) {
        try { delete (o as Record<string, unknown>)[name]; } catch { /* не удалилось — ниже закроем сверху */ }
      }
    }
    try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }); } catch { /* ок */ }
  }

  // (() => {}).constructor('return this')() — классический путь к глобальному объекту
  const blocked = function () { throw new Error('создавать функции из строк здесь нельзя'); };
  const fnKinds = [function () {}, async function () {}, function* () {}, async function* () {}];
  for (const fn of fnKinds) {
    Object.defineProperty(Object.getPrototypeOf(fn), 'constructor', { value: blocked, writable: false, configurable: false });
  }

  const typedArray = Object.getPrototypeOf(Float32Array.prototype);
  // Итераторы: по ним ходит любой for…of. Подмени кто-нибудь arrayIterator.next — у всех, кто едет после него
  // в этом же Worker, машины «ослепнут», а итог зависел бы от того, кому какой Worker достался
  const arrayIterator = Object.getPrototypeOf([][Symbol.iterator]());
  const iterators = [
    arrayIterator, Object.getPrototypeOf(arrayIterator),
    Object.getPrototypeOf(new Map()[Symbol.iterator]()), Object.getPrototypeOf(new Set()[Symbol.iterator]()),
    Object.getPrototypeOf(''[Symbol.iterator]()),
  ];
  for (const target of [
    Math, JSON, Reflect, Object, Array, Number, String, Boolean, Symbol, Map, Set, Error,
    Object.prototype, Array.prototype, Function.prototype, Number.prototype, String.prototype, Boolean.prototype,
    Map.prototype, Set.prototype, Error.prototype, typedArray, typedArray.prototype, Float32Array, Float32Array.prototype,
    Float64Array, Float64Array.prototype, ArrayBuffer, ArrayBuffer.prototype, Symbol.prototype,
    WeakMap, WeakMap.prototype, WeakSet, WeakSet.prototype, Promise, Promise.prototype,
    RegExp, RegExp.prototype, Date, Date.prototype, ...iterators,
  ]) Object.freeze(target);
}
