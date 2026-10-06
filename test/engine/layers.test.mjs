// Движок разложен по слоям — будущим пакетам (engine/README.md). Слой берёт только из тех, что ниже:
// тогда любой нижний слой можно вынести в отдельный пакет и сделать на нём другую игрушку про машинки и трассы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ENGINE = path.resolve(import.meta.dirname, '../../engine');

/** Кому из кого можно брать. Свой слой — всегда можно */
const ALLOWED = {
  core: [],
  net: ['core'],
  world: ['core', 'net'],
  learn: ['core', 'net', 'world'],
  course: ['core', 'net', 'world', 'learn'],
  draw: ['core', 'net', 'world'],
  sound: ['core', 'world'],
};
/** Здесь нет ни окна, ни страницы: слой работает в Node и в Web Worker */
const NO_DOM = ['core', 'net', 'world', 'learn', 'course', 'sound'];

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);
}
const layerOf = (file) => path.relative(ENGINE, file).split(path.sep)[0];
/** Код без комментариев и строк: «window» в тексте комментария — не обращение к окну */
const bare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, "''");

const files = sources(ENGINE);

test('каждый файл движка лежит в известном слое', () => {
  for (const f of files) assert.ok(layerOf(f) in ALLOWED, `${path.relative(ENGINE, f)}: не в слое — положи в один из ${Object.keys(ALLOWED).join(', ')}`);
});

test('слой берёт только из слоёв ниже', () => {
  for (const f of files) {
    const from = layerOf(f);
    for (const [, spec] of fs.readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) {
      const target = path.resolve(path.dirname(f), spec);
      const rel = path.relative(ENGINE, target);
      assert.ok(!rel.startsWith('..'), `${path.relative(ENGINE, f)}: движок не берёт из интерфейса (${spec})`);
      const to = rel.split(path.sep)[0];
      assert.ok(to === from || ALLOWED[from].includes(to), `${path.relative(ENGINE, f)} (${from}) берёт из ${to}: ${spec}`);
    }
  }
});

test('нижние слои — без DOM: работают в Node и в Web Worker', () => {
  for (const f of files.filter((f) => NO_DOM.includes(layerOf(f)))) {
    const code = bare(fs.readFileSync(f, 'utf8'));
    for (const name of ['window', 'document', 'localStorage']) {
      assert.ok(!new RegExp(`\\b${name}\\s*[.[]`).test(code), `${path.relative(ENGINE, f)}: ${name} — это интерфейс, не движок`);
    }
  }
});
