// Финал, шаг 1: работы участников. Файлы из папки, секретный ключ курса, чужие файлы, которые куратор допустил,
// и аватары, которые он спрятал перед стримом. Всё — только в памяти вкладки.
import { computed, signal } from '@reely/dommy';
import { generateCourseKeys, importPrivateKey } from '../../engine/seal.ts';
import type { CourseKey } from '../../engine/seal.ts';
import { COURSE_KEY } from '../generated/course-key.js';
import { saveFile } from '../download.ts';
import { buildEntries, openSealedFiles } from './entries.ts';
import type { SourceFile, Works } from './entries.ts';
import { messageOf } from '@reely/basics';

/** Работы и сколько было запечатанных файлов: открыто, ждут ключа */
export type Pool = Works & { sealed: number; opened: number; locked: number };
/** Строка-пояснение под кнопкой: error — показать как ошибку */
export type Note = { text: string; error?: boolean };

const emptyPool = (): Pool => ({ entries: [], problems: [], twins: [], similar: [], foreign: [], skipped: 0, sealed: 0, opened: 0, locked: 0 });

/** Файлы, как их прочитали, и секретный ключ курса. Ключ не покидает память вкладки: никуда не шлём и не сохраняем */
let files: SourceFile[] = [];
let courseKey: CourseKey | null = null;
/** Номер последней сборки работ: пока открывали старую папку, могли выбрать новую — старый ответ уже не нужен */
let loading = 0;

/** Работы, собранные из файлов */
export const pool = signal<Pool>(emptyPool());
/** Чужие файлы (id участников), которые куратор всё-таки допустил */
export const allowed = signal<ReadonlySet<string>>(new Set());
/** Кто едет: все, кроме «чужих» файлов, которые куратор не допустил */
export const racers = computed(() => pool.value.entries.filter((e) => !e.foreign || allowed.value.has(e.id)));


export const keyNote = signal<Note>({ text: '' });
export const newKeysNote = signal('');

/** Собрать работы заново: после новой папки или выбранного ключа */
async function rebuild(): Promise<void> {
  const mine = ++loading;
  const opened = await openSealedFiles(files, courseKey);
  if (mine !== loading) return;
  const works = buildEntries(opened.files);
  pool.value = { ...works, problems: [...opened.problems, ...works.problems], sealed: opened.sealed, opened: opened.opened, locked: opened.locked };
}

/** Новые файлы работ (папка, несколько .json или перетащили на трассу) */
export async function loadFiles(list: Promise<SourceFile[]>): Promise<void> {
  files = await list;
  allowed.value = new Set();
  await rebuild();
}

/** Выбрали файл секретного ключа. Не подошёл — остаётся прежний ключ, если он был */
export async function chooseKey(file: File): Promise<void> {
  try {
    courseKey = await importPrivateKey(JSON.parse(await file.text()));
    const match = !COURSE_KEY || COURSE_KEY.kid === courseKey.kid;
    keyNote.value = {
      text: `Ключ курса ${courseKey.kid} выбран${match ? '' : ` — но сайт шифрует ключом ${COURSE_KEY.kid}: это ключ от другого набора`}.`,
      error: !match,
    };
    await rebuild();
  } catch (e) {
    // текст ошибки — наш или от JSON.parse; сам ключ в него не попадает
    const still = courseKey ? ` Остаётся ключ ${courseKey.kid}.` : '';
    keyNote.value = { text: `Не подошло: ${messageOf(e)}.${still}`, error: true };
  }
}

/** Новая пара ключей курса: секретный — кураторам, открытый — в репозиторий вместо course-key.json */
export async function makeNewKeys(): Promise<void> {
  try {
    const { publicFile, privateFile } = await generateCourseKeys();
    await saveFile(`ai-race-private-key-${privateFile.kid}.json`, JSON.stringify(privateFile, null, 2));
    await saveFile('course-key.json', `${JSON.stringify(publicFile, null, 2)}\n`);
    newKeysNote.value = `Готово, ключ ${publicFile.kid}. Секретный — сохраните у кураторов. course-key.json — замените в репозитории и пересоберите сайт.`;
  } catch (e) {
    newKeysNote.value = `Не получилось: ${messageOf(e)}`;
  }
}

/** Добавить id в набор или убрать из него (набор — новый: так сигнал узнает, что поменялось) */
const toggled = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
};

export const toggleAllowed = (id: string) => allowed.update((set) => toggled(set, id));
