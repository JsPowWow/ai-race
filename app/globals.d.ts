// Типы для проверки (npm run typecheck): то, что есть на странице, но не описано в стандартной библиотеке.

interface Window {
  /** Страница открыта внутри Claude: платформа даёт скачивание файлов */
  claude?: { use(name: 'downloads'): Promise<{ save(file: { filename: string; data: string | Blob }): Promise<void> }> };
}
