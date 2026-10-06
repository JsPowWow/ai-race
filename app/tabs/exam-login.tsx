// «Экзамен», логин на GitHub для сдачи.
// Логин нужен, чтобы в финале сверить: файл сдал тот, кто его сделал. Он один на все машины гаража (state.login).
// Проверка на GitHub — подсказка против опечаток: если GitHub недоступен или кончился лимит, она не мешает.
import { signal, untracked, Show } from '@reely/dommy';
import { retry } from '@reely/async';
import { GITHUB_LOGIN } from '../../engine/course/seal.ts';
import { state, persist } from '../state.ts';

/** Спрашиваем GitHub, когда перестали печатать */
const CHECK_DELAY_MS = 700;
const GITHUB_AVATARS = 'https://avatars.githubusercontent.com';
/** GitHub иногда подвисает: ждём столько и пробуем ещё раз через секунду, потом — «не получилось проверить» */
const GITHUB_TIMEOUT_MS = 8000;

/** Что GitHub рассказал о пользователе (нам нужно немногое) */
type GitHubUser = { login: string; name: string | null; avatar_url: string };
type Check =
  | { status: 'checking' } // ждём ответа
  | { status: 'found'; user: GitHubUser }
  | { status: 'missing' } // такого нет
  | { status: 'unknown' }; // GitHub не ответил: нет сети, лимит

/** Логин, как он в поле (пока печатают — вместе с пробелами) */
const typed = signal<string>(state.login ?? '');
/** Уже проверенные логины (в нижнем регистре) — раз за сессию, чтобы не тратить лимит GitHub */
const checks = signal<ReadonlyMap<string, Check>>(new Map());

export const currentLogin = (): string => typed.value.trim();
export const loginLooksValid = (): boolean => GITHUB_LOGIN.test(currentLogin());

function setCheck(login: string, check: Check): void {
  checks.update((now) => new Map(now).set(login.toLowerCase(), check));
}

/** Запомнить логин: в поле и в state (он общий для всех машин) */
function remember(value: string): void {
  typed.value = value;
  state.login = value.trim();
  persist();
}

let timer = 0;
function onType(value: string): void {
  remember(value);
  clearTimeout(timer);
  timer = window.setTimeout(checkLogin, CHECK_DELAY_MS);
}

async function askGitHub(login: string): Promise<Check> {
  const ask = async (_attempt: number, signal: AbortSignal): Promise<Check> => {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers: { Accept: 'application/vnd.github+json' }, signal });
    if (res.status === 404) return { status: 'missing' };
    if (res.ok) return { status: 'found', user: (await res.json()) as GitHubUser };
    return { status: 'unknown' }; // GitHub ответил, но не пустил (лимит запросов) — повторять незачем
  };
  try {
    return await retry(ask, { retries: 1, delay: 1000, timeout: GITHUB_TIMEOUT_MS });
  } catch {
    return { status: 'unknown' }; // нет сети или GitHub так и не ответил — не страшно
  }
}

/** Спросить GitHub про логин из поля (если он похож на логин и его ещё не спрашивали) */
export async function checkLogin(): Promise<void> {
  const login = untracked(currentLogin);
  if (!GITHUB_LOGIN.test(login) || checks.peek().has(login.toLowerCase())) return;
  setCheck(login, { status: 'checking' });
  const result = await askGitHub(login);
  setCheck(login, result);
  // GitHub знает, как логин пишется правильно (регистр букв) — подставим. Но только если в поле всё ещё он:
  // пока GitHub отвечал, могли допечатать другой
  const canonical = result.status === 'found' ? result.user.login : login;
  if (canonical !== login && canonical.toLowerCase() === login.toLowerCase() && untracked(currentLogin) === login) remember(canonical);
}

/** Картинка пользователя 64×64 — только с сервера аватаров GitHub */
function avatarOf(user: GitHubUser): string | null {
  try {
    const url = new URL(user.avatar_url);
    if (url.origin !== GITHUB_AVATARS) return null;
    url.searchParams.set('s', '64');
    return url.href;
  } catch {
    return null;
  }
}

/** Что показать под полем: подсказку (tone — хорошо, плохо или нейтрально) или найденного пользователя */
type Hint = { tone: 'good' | 'bad' | null; text: string; user: GitHubUser | null };
function hint(): Hint {
  const say = (text: string, tone: Hint['tone'] = null): Hint => ({ tone, text, user: null });
  const login = currentLogin();
  if (!login) return say('Впиши логин — без него файл для сдачи не скачать.');
  if (!loginLooksValid()) return say('Так логин на GitHub не пишется: латиница, цифры и дефис, до 39 символов.', 'bad');
  const check = checks.value.get(login.toLowerCase());
  if (!check || check.status === 'checking') return say('Проверяем на GitHub…');
  if (check.status === 'found') return { tone: 'good', text: '', user: check.user };
  if (check.status === 'missing') return say('Такого пользователя на GitHub нет — проверь, нет ли опечатки.', 'bad');
  return say('Не получилось проверить на GitHub — просто убедись, что логин верный.');
}

function FoundUser({ user }: { user: () => GitHubUser }): Node {
  return (
    <>
      <Show when={() => avatarOf(user())}>
        {/* не загрузилась картинка — просто прячем её */}
        {(src) => <img src={src} alt="" onError={(e) => (e.currentTarget.hidden = true)} />}
      </Show>
      <span>Это ты? <b>{() => user().name || user().login}</b> @{() => user().login}</span>
    </>
  );
}

export function LoginField(): Node {
  const found = () => hint().user;
  return (
    <>
      <div className="field wide">
        <label htmlFor="pLogin">Логин GitHub</label>
        <input type="text" id="pLogin" maxLength={39} placeholder="например, JsPowWow" autocomplete="username" autocapitalize="off" spellcheck={false}
          value={typed} onInput={(e) => onType(e.currentTarget.value)} />
      </div>
      <div className={() => ['gh-check', hint().tone].filter(Boolean).join(' ')} id="pLoginCheck" aria={{ role: 'status' }}>
        <Show when={found} fallback={() => <>{() => hint().text}</>}>
          {(user) => <FoundUser user={user} />}
        </Show>
      </div>
    </>
  );
}
