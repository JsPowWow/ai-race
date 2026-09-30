// Текст ошибки для человека. Бросить можно что угодно — не только Error (студент может написать throw 'упс').
// Нужен и странице, и движку, и Workers — поэтому здесь, в engine/.
// Ждёт своего места в @reely/basics (попросили сессию reely) — появится там, возьмём оттуда.

/** Сообщение ошибки: у Error — message, у всего остального — оно же строкой */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
