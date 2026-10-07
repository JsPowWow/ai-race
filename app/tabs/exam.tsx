// Вкладка «Экзамен» (урок 4): проверка на незнакомых трассах и файл для гонки.
// Панель и кнопка под трассой — на @reely/dommy (#20); повтор заезда на трассе рисует кадровый цикл (frame).
//   exam-run.ts — сам экзамен;  exam-results.tsx — таблица итогов;  exam-submit.tsx, exam-login.tsx — файл для сдачи
import { effect, mount, untracked } from '@reely/dommy';
import { getTrainingTrack } from '../../engine/world/track.ts';
import { maxTicksFor, carReport } from '../../engine/world/car.ts';
import type { Car } from '../../engine/world/car.ts';
import { state } from '../state.ts';
import { drawScene, paintCar, trafficOn, setHud, lapText } from '../stage.ts';
import { esc } from '../ui.ts';
import { secs, pct } from '../format.ts';
import { element } from '../dom.ts';
import { championCar, KNOWN_COUNT, UNKNOWN_COUNT } from './exam-run.ts';
import type { ExamResult } from './exam-run.ts';
import { Results, results, selected, check } from './exam-results.tsx';
import { Submit, refreshCarFile } from './exam-submit.tsx';
import { checkLogin, loginLooksValid } from './exam-login.tsx';

/** Повтор идёт быстрее обычного: тиков за кадр */
const REPLAY_SPEED = 3;
/** Доехал или сошёл — постоять, чтобы было видно чем кончилось, и заново */
const REPLAY_PAUSE_MS = 1500;

mount(element('#examPanel'), () => (
  <>
    <Results />
    <Submit />
  </>
));
mount(element('#examToolbar'), () => (
  <>
    <button className="btn primary" id="eRun" onClick={check}>Проверить чемпиона</button>
    <span className="note" id="eReplayNote">Щёлкни строку в таблице, чтобы посмотреть заезд</span>
  </>
));

/** Повтор выбранного заезда: та же машина с тем же мозгом едет заново */
type Replay = { result: ExamResult; car: Car; pauseUntil: number };
let replay: Replay | null = null;

function replayOf(index: number | null): Replay | null {
  const result = index === null ? undefined : results.peek()[index];
  return result ? { result, car: championCar(result.track), pauseUntil: 0 } : null;
}
// новая проверка или выбрали другую строку — повтор сначала
effect(() => {
  void results.value;
  const index = selected.value;
  replay = untracked(() => replayOf(index));
});

export const examTab = {
  enter(): void {
    refreshCarFile();
    if (loginLooksValid()) checkLogin(); // не спрашивали про этот логин — спросим (раз за сессию)
  },
  frame(): void {
    if (!replay) {
      drawScene(getTrainingTrack('warmup'));
      setHud(['<b>Экзамен</b>', `чемпион проедет ${KNOWN_COUNT + UNKNOWN_COUNT} трасс`]);
      return;
    }
    const { car, result } = replay;
    const { track } = result;
    for (let k = 0; k < REPLAY_SPEED; k++) car.step(track, maxTicksFor(track));
    if (car.done) {
      replay.pauseUntil ||= performance.now() + REPLAY_PAUSE_MS;
      if (performance.now() > replay.pauseUntil) replay = replayOf(selected.peek());
    }
    drawScene(track, { traffic: trafficOn(track, car.ticks), tick: car.ticks });
    paintCar(car, { color: state.profile.color, sensors: true, number: 1 });
    // табло — HTML-строки (app/stage.ts): имя трассы из seed — через esc()
    setHud([
      `<b>${esc(result.title)}</b>`,
      `время <b>${secs(car.ticks)}</b>`,
      lapText(track, car.bestS),
      `пройдено <b>${pct(carReport(car, track).progressPct)}</b>`,
      `повтор ×${REPLAY_SPEED}`,
    ]);
  },
};
