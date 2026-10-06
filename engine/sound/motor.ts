// Звук мотора (#25): только счёт — какой тон у мотора и как слышно чужую машину. Звучит app/engine-sound.ts.
// Мотор игрушечный, но честный: высота — от скорости (быстрее крутятся колёса), громкость и «яркость» — от газа.
import { CAR } from '../world/car.ts';
import type { Point } from '../world/track.ts';

/** Тон мотора: частота «пилы» (Гц), срез фильтра (Гц, выше — ярче, «злее») и громкость 0…1 */
export type Tone = { freq: number; cutoff: number; gain: number };

/** Мотор на холостом и на полной скорости */
const MOTOR = { idle: 42, top: 150, gasLift: 22 };

/** Тон мотора при скорости speed (px за тик, назад — тоже) и газе gas (0…1) */
export function toneOf(speed: number, gas: number): Tone {
  const fast = Math.min(1, Math.abs(speed) / CAR.maxSpeed);
  return {
    freq: MOTOR.idle + (MOTOR.top - MOTOR.idle) * fast + MOTOR.gasLift * gas,
    cutoff: 380 + 900 * fast + 1500 * gas,
    gain: 0.35 + 0.25 * fast + 0.4 * gas,
  };
}

/** Как далеко слышно чужую машину и как быстро она стихает, px */
export const HEAR = { range: 480, half: 90 };

/**
 * Как слышно машину source, если ты — listener: громкость 0…1 (на расстоянии half — вдвое тише)
 * и сторона −1…1 (слева/справа по ходу, как в жизни). y трассы растёт вниз, поэтому «вправо» — (−sin, cos).
 */
export function heard(listener: Point & { angle: number }, source: Point): { gain: number; pan: number } {
  const dx = source.x - listener.x, dy = source.y - listener.y;
  const d = Math.hypot(dx, dy);
  if (d > HEAR.range) return { gain: 0, pan: 0 };
  const side = -dx * Math.sin(listener.angle) + dy * Math.cos(listener.angle);
  const edge = 1 - d / HEAR.range; // у края слышимости стихает до нуля плавно, без щелчка
  return { gain: edge / (1 + d / HEAR.half), pan: d < 1 ? 0 : Math.max(-1, Math.min(1, (side / d) * 1.2)) };
}
