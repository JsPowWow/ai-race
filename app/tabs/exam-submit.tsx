// «Экзамен», блок «На гонку»: запечатанный файл для сдачи и открытый — для себя.
import { signal } from '@reely/dommy';
import { state, on, emit } from '../state.ts';
import { toCarFile } from '../car-file.ts';
import { canDownload, saveFile } from '../download.ts';
import { sealCar } from '../../engine/seal.ts';
import { COURSE_KEY } from '../generated/course-key.js';
import { LoginField, currentLogin, loginLooksValid } from './exam-login.tsx';

const CAR_FILE_NAME = 'car.json';
const SEALED_FILE_NAME = 'car.sealed.json';

/** Файл машины из текущего мозга (null — мозга нет). Перечитываем, когда открыли вкладку и когда поменялся мозг */
const carFile = signal(toCarFile());
export const refreshCarFile = (): void => {
  carFile.value = toCarFile();
};
on('champion', () => state.tab === 'exam' && refreshCarFile()); // на других вкладках — незачем: enter() перечитает

/** Что получилось с последним файлом */
const message = signal('');
/** Скачивать можно всегда, кроме случая, когда страница внутри Claude и платформа не разрешила */
const downloadable = signal(true);
canDownload().then((ok: boolean) => (downloadable.value = ok));

/** Почему нельзя скачать файл для сдачи ('' — можно) */
function sealBlocker(): string {
  if (!COURSE_KEY) return 'В этой сборке нет ключа курса (course-key.json)';
  if (!loginLooksValid()) return 'Впиши логин на GitHub';
  if (!carFile.value) return 'Сначала обучи мозг';
  return '';
}

/** Текст ошибки скачивания для людей */
const failure = (e: unknown, otherwise: string) => ((e as { code?: string } | null)?.code === 'declined' ? 'Скачивание отменено.' : otherwise);

async function seal(): Promise<void> {
  const file = toCarFile();
  if (!file) return;
  try {
    const sealed = await sealCar(file, currentLogin(), COURSE_KEY);
    await saveFile(SEALED_FILE_NAME, JSON.stringify(sealed));
    emit('did', 'sealed');
    message.value = `Сохранено: ${SEALED_FILE_NAME}. Его и сдавай пул-реквестом. Открыть его могут только кураторы.`;
  } catch (e) {
    message.value = failure(e, `Не получилось: ${e instanceof Error ? e.message : e}`);
  }
}

async function download(): Promise<void> {
  const file = toCarFile();
  if (!file) return;
  try {
    await saveFile(CAR_FILE_NAME, JSON.stringify(file, null, 1));
    message.value = `Сохранено: ${CAR_FILE_NAME}. Это открытый файл — для себя. Сдавай запечатанный.`;
  } catch (e) {
    message.value = failure(e, 'Не получилось скачать. Используй «Скопировать JSON».');
  }
}

export function Submit(): Node {
  let jsonBox: HTMLDetailsElement | null = null;
  let jsonText: HTMLTextAreaElement | null = null;
  const json = () => (carFile.value ? JSON.stringify(carFile.value) : 'Сначала обучи мозг.');

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(json());
      message.value = 'Скопировано. Отправь преподавателю или вставь на вкладке «Гонка».';
    } catch {
      // буфер обмена не пустил (нет разрешения, старый браузер) — покажем текст и выделим его
      if (jsonBox) jsonBox.open = true;
      jsonText?.select();
      message.value = 'Буфер обмена недоступен: текст выделен, скопируй его вручную (Ctrl+C).';
    }
  }

  return (
    <section className="block">
      <h2>На гонку</h2>
      <p className="hint">Имя, цвет и аватар машины — на вкладке «Профиль».</p>
      <LoginField />
      <div className="row">
        <button className="btn primary" id="pSeal" hidden={() => !downloadable.value} disabled={() => !!sealBlocker()}
          title={() => sealBlocker() || null} onClick={seal}>Скачать для сдачи</button>
      </div>
      <p className="hint">Файл для сдачи запечатан ключом курса: открыть его могут только кураторы. Поэтому его можно спокойно выкладывать в пул-реквест — никто не подсмотрит твои веса и код.</p>
      <details>
        <summary>Открытый файл — для себя</summary>
        <p className="hint">Обычный JSON: чтобы после финала перепроверить свой заезд на вкладке «Гонка» или поделиться с кем-то нарочно.</p>
        <div className="row">
          <button className="btn small" id="pCopy" disabled={() => !carFile.value} onClick={copy}>Скопировать JSON</button>
          <button className="btn small" id="pDownload" hidden={() => !downloadable.value} disabled={() => !carFile.value} onClick={download}>Скачать car.json</button>
        </div>
      </details>
      <p className="note" id="pMsg" aria={{ role: 'status' }}>{message}</p>
      <details elementRef={(el) => (jsonBox = el)}>
        <summary>Что внутри файла</summary>
        <textarea id="pJson" readOnly rows={8} aria={{ ariaLabel: 'JSON машины' }} value={json} elementRef={(el) => (jsonText = el)} />
      </details>
    </section>
  );
}
