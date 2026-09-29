// Новый вариант мозга (#24). Его приносят два учителя: ты («Я учу») и рой («Учится само»).
// Твой мозг он сам не заменяет: сначала оба едут одинаковый контрольный заезд (engine/control.ts),
// и вердикт — ▲ лучше, ▼ хуже или = так же. Лучше — рядом с трассой карточка «Взять», и решаешь ты.
// Галочка «Брать лучшее само» (выключена) берёт без вопроса. Мозга ещё нет — первый вариант берём сразу: заменять нечего.
// Вкладки друг друга не знают: обе зовут propose() отсюда и рисуют ленту попыток компонентом components/tries.tsx.
import { signal } from '@reely/dommy';
import { cloneBrain, type Brain } from '../engine/brain.ts';
import { controlRun, verdict, controlText, type ControlLeg, type ControlResult, type Mark } from '../engine/control.ts';
import { getTrainingTrack, type Track } from '../engine/track.ts';
import { withTraffic } from '../engine/traffic.ts';
import { state, thinkFn, on, type Shape } from './state.ts';
import { setBrain } from './library.ts';
import { stored } from './storage.ts';

export type Source = 'teach' | 'train';

/** Вариант мозга: сам мозг, его форма и как его назвать в «Истории» */
export type Variant = { brain: Brain; config: Shape; by: Source; note: string };

/** Попытка в ленте: чем кончилась. 'first' — мозга не было, вариант стал первым */
export type Attempt = { id: number; mark: Mark | 'first'; text: string; result: string; label: string; taken: boolean };

/** Вариант, который лучше твоего, ждёт «Взять» */
export type Offer = Variant & { attempt: Attempt };

/** Сколько попыток помнит лента: видно, как машина росла, а старое не мешает */
const FEED_SIZE = 12;

/** «Брать лучшее само»: вариант лучше — сразу твой, без карточки */
export const autoTake = stored<boolean>('autoTake', false);

const feeds = signal<Record<Source, readonly Attempt[]>>({ teach: [], train: [] });
const offers = signal<Record<Source, Offer | null>>({ teach: null, train: null });
export const feed = (source: Source): readonly Attempt[] => feeds.value[source];
export const offer = (source: Source): Offer | null => offers.value[source];

// ── контрольный заезд ──

/** Вторая трасса контрольного — не та, на которой учились: так видно, умеет ли мозг ездить, а не только заучил */
const SECOND = ['snake', 'warmup'];

/** Трассы контрольного: трасса урока (серия знаков 0) и вторая, с тем же трафиком */
export function controlTracks(lesson: Track): Track[] {
  const second = SECOND.find((id) => id !== lesson.id) ?? SECOND[0];
  return [lesson, withTraffic(getTrainingTrack(second), lesson.trafficLevel)];
}

/** Трассы контрольного словами: «трассы «Разминка» и «Змейка»» */
export const controlNames = (lesson: Track): string => `трассы «${controlTracks(lesson).map((t) => t.name).join('» и «')}»`;

const tracksKey = (tracks: readonly Track[]) => tracks.map((t) => `${t.id}|${t.trafficLevel ?? 'none'}`).join();
const drive = (brain: Brain, config: Shape, tracks: readonly Track[]): ControlResult =>
  controlRun(tracks, { brain: cloneBrain(brain), think: thinkFn(config.think), sensors: config.sensors });

/** Твой мозг на контрольном: считаем раз на трассы, пока мозг тот же (сменился — кэш чистит on('champion')) */
let yours = new Map<string, ControlResult>();
function yourResult(tracks: readonly Track[]): ControlResult | null {
  if (!state.champion) return null;
  const key = tracksKey(tracks);
  let result = yours.get(key);
  if (!result) yours.set(key, (result = drive(state.champion, state.config, tracks)));
  return result;
}

/** Твой мозг на трассе урока — первая трасса контрольного (null — мозга нет) */
export const yourLessonLeg = (lesson: Track): ControlLeg | null => yourResult(controlTracks(lesson))?.legs[0] ?? null;

// ── предложить и взять ──

let lastId = 0;
/** Рой приносит вариант каждое поколение, но лучший часто тот же, что и в прошлый раз: второй раз его не проверяем */
const lastBrain: Record<Source, string> = { teach: '', train: '' };

/**
 * Учитель принёс вариант: контрольный заезд, строка в ленте, а если лучше — карточка «Взять»
 * (или сразу «Взять», если стоит галочка). Тот же мозг, что и в прошлый раз, — ничего не делаем, вернём null.
 */
export function propose(variant: Variant, lesson: Track, label: string): Attempt | null {
  const source = variant.by;
  const json = JSON.stringify(variant.brain);
  // тот же, что в прошлый раз, или просто твой мозг (рой начал с него) — сравнивать не с чем
  if (json === lastBrain[source] || (state.champion && json === JSON.stringify(state.champion))) return null;
  lastBrain[source] = json;
  const tracks = controlTracks(lesson);
  const before = yourResult(tracks);
  const now = drive(variant.brain, variant.config, tracks);
  const judged = before && verdict(now, before);
  const attempt: Attempt = {
    id: ++lastId,
    mark: judged?.mark ?? 'first',
    text: judged?.text ?? 'первый мозг — теперь он твой',
    result: controlText(now),
    label,
    taken: false,
  };
  feeds.value = { ...feeds.peek(), [source]: [...feeds.peek()[source], attempt].slice(-FEED_SIZE) };
  if (attempt.mark === 'first' || (attempt.mark === 'better' && autoTake.peek())) return takeVariant(variant, attempt);
  if (attempt.mark === 'better') offers.value = { ...offers.peek(), [source]: { ...variant, attempt } };
  return attempt;
}

/** Вариант — в твой мозг. Возвращает строку ленты, отмеченную «взят» */
function takeVariant(variant: Variant, attempt: Attempt): Attempt {
  const source = variant.by;
  const taken = { ...attempt, taken: true };
  feeds.value = { ...feeds.peek(), [source]: feeds.peek()[source].map((a) => (a === attempt ? taken : a)) };
  // номер поколения — счёт роя, он идёт своим чередом: мозг его не меняет
  setBrain(cloneBrain(variant.brain), { config: structuredClone(variant.config), by: source, generation: state.generation, note: variant.note });
  return taken;
}

/** «Взять»: вариант становится твоим мозгом, прежний — в «Историю» */
export function take(source: Source): void {
  const now = offers.peek()[source];
  if (now) takeVariant(now, now.attempt);
}

/** «Не надо»: карточку убираем, строка в ленте остаётся */
export function dismiss(source: Source): void {
  offers.value = { ...offers.peek(), [source]: null };
}

// Твой мозг сменился (взяли вариант, вернули из «Истории», поправили руками): прежние сравнения уже не про него
on('champion', () => {
  yours = new Map();
  offers.value = { teach: null, train: null };
});
// Другая форма сети: и твой мозг проедет иначе, и варианты старой формы уже не подходят
on('config', () => {
  yours = new Map();
  offers.value = { teach: null, train: null };
});
// Другая машина или сброс — её попытки начинаются заново
const forget = () => {
  feeds.value = { teach: [], train: [] };
  offers.value = { teach: null, train: null };
};
on('car', forget);
on('reset', forget);
