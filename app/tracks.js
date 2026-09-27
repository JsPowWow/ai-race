// Трассы по seed строятся один раз и дальше берутся из памяти.
import { generateTrack } from '../engine/track.js';

const cache = new Map();

export function seedTrack(seed) {
  if (!cache.has(seed)) cache.set(seed, generateTrack(seed));
  return cache.get(seed);
}
