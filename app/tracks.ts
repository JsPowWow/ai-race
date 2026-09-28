// Трассы по seed строятся один раз и дальше берутся из памяти.
import { generateTrack, type Track } from '../engine/track.ts';

const cache = new Map<string, Track>();

export function seedTrack(seed: string): Track {
  let track = cache.get(seed);
  if (!track) cache.set(seed, (track = generateTrack(seed)));
  return track;
}
