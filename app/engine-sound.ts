// Звук мотора в виде из машины (#25): процедурно, Web Audio — без звуковых файлов (по мотивам Раду).
// Мотор — «пила» и квадрат октавой ниже через фильтр, с пульсацией «тук-тук» цилиндров. Чужие машины — такие же
// моторы, только тише и глуше; громкость — по расстоянию, слева/справа — по стороне. Тон и громкость считает
// engine/sound/motor.ts, здесь — только провода. Браузер даёт звук лишь после касания: включается кнопкой.
import { debounced } from '@reely/dommy-kit';
import { toneOf, heard } from '../engine/sound/motor.ts';
import type { Point } from '../engine/world/track.ts';

/** Один мотор: генераторы → пульсация → фильтр → громкость → сторона */
type Motor = { saw: OscillatorNode; sub: OscillatorNode; beat: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode };

/** Что звучит в этом кадре: твоя машина и чужие (трафик, призрак) */
export type Hearing = {
  me: Point & { angle: number; speed: number; gas: number; done: boolean };
  others: (Point & { speed: number; loud?: number })[];
};

const VOICES = 4; // чужих моторов одновременно — самые близкие; больше в каше всё равно не разобрать
const GLIDE = 0.06; // секунд на смену тона: без щелчков и без «лесенки» по кадрам
const MASTER = 0.5;

let audio: AudioContext | null = null;
let master: GainNode;
let mine: Motor;
const others: Motor[] = [];

function motor(ctx: AudioContext, out: AudioNode): Motor {
  const saw = new OscillatorNode(ctx, { type: 'sawtooth' });
  const sub = new OscillatorNode(ctx, { type: 'square' });
  const subLevel = new GainNode(ctx, { gain: 0.45 });
  // «тук-тук»: громкость качается с частотой вспышек в цилиндрах — так гул становится мотором
  const pulse = new GainNode(ctx, { gain: 0.7 });
  const beat = new OscillatorNode(ctx, { type: 'sine' });
  const depth = new GainNode(ctx, { gain: 0.3 });
  const filter = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 3 });
  const gain = new GainNode(ctx, { gain: 0 });
  const pan = new StereoPannerNode(ctx);
  saw.connect(pulse); sub.connect(subLevel).connect(pulse);
  beat.connect(depth).connect(pulse.gain);
  pulse.connect(filter).connect(gain).connect(pan).connect(out);
  for (const o of [saw, sub, beat]) o.start();
  return { saw, sub, beat, filter, gain, pan };
}

/** Плавно повернуть ручку к значению */
function glide(param: AudioParam, value: number, ctx: AudioContext): void {
  param.setTargetAtTime(value, ctx.currentTime, GLIDE);
}

function tune(m: Motor, ctx: AudioContext, freq: number, cutoff: number, gain: number, pan: number): void {
  glide(m.saw.frequency, freq, ctx);
  glide(m.sub.frequency, freq / 2, ctx);
  glide(m.beat.frequency, freq / 4, ctx);
  glide(m.filter.frequency, cutoff, ctx);
  glide(m.gain.gain, gain, ctx);
  glide(m.pan.pan, pan, ctx);
}

/** Включить звук. Зовётся из нажатия кнопки или клавиши — только тогда браузер его разрешит */
export function wakeSound(): void {
  if (!audio) {
    audio = new AudioContext();
    const squeeze = new DynamicsCompressorNode(audio, { threshold: -18, ratio: 4 }); // много моторов рядом — без хрипа
    master = new GainNode(audio, { gain: MASTER });
    master.connect(squeeze).connect(audio.destination);
    mine = motor(audio, master);
    for (let i = 0; i < VOICES; i++) others.push(motor(audio, master));
  }
  void audio.resume();
}

/** Звук этого кадра. null — тишина (вид сверху, звук выключен) */
export function hearFrame(frame: Hearing | null): void {
  if (!audio) return;
  if (!frame) { sleep(); return; }
  if (audio.state === 'suspended') void audio.resume();
  sleepSoon(); // кадры перестали приходить (ушли с вкладки, свернули окно) — заснём
  const { me } = frame;
  const t = toneOf(me.speed, me.gas);
  tune(mine, audio, t.freq, t.cutoff, me.done ? 0 : t.gain * 0.5, 0);
  const near = frame.others
    .map((o) => ({ o, ear: heard(me, o) }))
    .filter((x) => x.ear.gain > 0)
    .sort((a, b) => b.ear.gain - a.ear.gain);
  others.forEach((m, i) => {
    const x = near[i];
    if (!x) { glide(m.gain.gain, 0, audio!); return; }
    const tone = toneOf(x.o.speed, 0.4); // чужие всегда едут «с газом»: так их слышно издалека
    // чужой мотор глуше твоего: его слышно через воздух, а свой — ещё и через сиденье
    tune(m, audio!, tone.freq * 1.07, tone.cutoff * 0.6, x.ear.gain * tone.gain * 0.45 * (x.o.loud ?? 1), x.ear.pan);
  });
}

/** Притушить и усыпить: звук не тратит процессор, пока не нужен */
function sleep(): void {
  if (!audio || audio.state !== 'running') return;
  sleepSoon.cancel();
  glide(mine.gain.gain, 0, audio);
  for (const m of others) glide(m.gain.gain, 0, audio);
  const ctx = audio;
  window.setTimeout(() => { if (ctx.state === 'running' && mine.gain.gain.value < 0.01) void ctx.suspend(); }, 250);
}
/** Уснуть, если кадры со звуком не приходят 0,3 с */
const sleepSoon = debounced(sleep, 300);
