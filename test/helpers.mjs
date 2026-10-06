// Общее для тестов: боты из tools/bots.json — готовые мозги, на которых удобно проверять движок.
import { readFileSync } from 'fs';
import { parseCarFile } from '../engine/course/car-file.ts';
import { thinkVariants } from '../student/think.js';

export const BOTS = JSON.parse(readFileSync(new URL('../tools/bots.json', import.meta.url), 'utf8'));

/** Водитель для Car: { brain, think, sensors } из файла машины */
export function driverOf(file) {
  const car = parseCarFile(file);
  return { brain: car.brain, think: thinkVariants[car.thinkId].think, sensors: car.sensors };
}

export const bot = (name) => BOTS.find((b) => b.name === name) ?? BOTS[0];
