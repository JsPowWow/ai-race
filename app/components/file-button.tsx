// Кнопка «выбрать файлы»: label с невидимым <input type="file"> поверх (стиль — .btn.file в components.css).
import type { ReelyNode } from '@reely/dommy';

type FileButtonProps = {
  id: string;
  children: ReelyNode;
  accept?: string;
  multiple?: boolean;
  /** Выбрать папку целиком (Chrome, Edge, Firefox: webkitdirectory) */
  folder?: boolean;
  disabled?: () => boolean;
  /** Что делать с выбранными файлами; не выбрали ничего — не зовём */
  onFiles: (files: File[]) => unknown;
};

/** Поле очищаем сразу: тот же файл ещё раз — снова событие change */
export function FileButton({ id, children, accept = '.json,application/json', multiple = false, folder = false, disabled, onFiles }: FileButtonProps): Node {
  return (
    <label className="btn small file">
      {children}
      <input type="file" id={id} accept={folder ? '' : accept} multiple={multiple || folder} webkitdirectory={folder}
        disabled={disabled ?? false}
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length) void onFiles(files);
        }} />
    </label>
  );
}
