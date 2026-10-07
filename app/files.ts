// Файлы машин, которые выбрали или перетащили: читаем все сразу, плохой файл не мешает хорошим.
import { messageOf } from '@reely/basics';

/** JSON.parse с понятной ошибкой: файл машины — не JSON */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Не получилось прочитать JSON: ${messageOf(e)}`, { cause: e });
  }
}

/**
 * Прочитать JSON-файлы и отдать каждый в use() — по порядку. Возвращает ошибки: по строке на плохой файл,
 * с его именем (use() тоже может бросить — значит, файл не подошёл)
 */
export async function eachJsonFile(files: Iterable<File>, use: (json: unknown, name: string) => void): Promise<string[]> {
  const list = [...files];
  const texts = await Promise.all(list.map((f) => f.text()));
  const errors: string[] = [];
  list.forEach(({ name }, i) => {
    try {
      use(parseJson(texts[i]), name);
    } catch (e) {
      errors.push(`${name}: ${messageOf(e)}`);
    }
  });
  return errors;
}
