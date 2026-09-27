// Собрать работы финала из пул-реквестов на GitHub.
//
//   node tools/collect-entries.mjs prs.txt [папка=entries]
//
// prs.txt — любой текст, в котором есть ссылки вида https://github.com/<owner>/<repo>/pull/<номер>
// (например, выгрузка сабмитов из RS App). Нужен GitHub CLI (`gh auth login`) с доступом к этим репозиториям —
// подойдут и приватные репозитории студентов.
//
// Из каждого PR берём добавленные или изменённые .json-файлы машины — запечатанные (car.sealed.json) или открытые —
// и кладём в <папка>/<логин автора PR>/<имя файла>. Эту папку потом открываем на вкладке «Финал».
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';

const run = promisify(execFile);
const [listFile, outDir = 'entries'] = process.argv.slice(2);
if (!listFile) {
  console.error('Использование: node tools/collect-entries.mjs prs.txt [папка]');
  process.exit(1);
}

const PR = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
const prs = [...new Map([...readFileSync(listFile, 'utf8').matchAll(PR)].map((m) => [m[0], { owner: m[1], repo: m[2], number: m[3], url: m[0] }])).values()];
console.log(`Пул-реквестов в списке: ${prs.length}`);

const gh = async (path, raw = false) => {
  const args = ['api', path, ...(raw ? ['-H', 'Accept: application/vnd.github.raw'] : [])];
  const { stdout } = await run('gh', args, { maxBuffer: 20e6 });
  return raw ? stdout : JSON.parse(stdout);
};

async function collect({ owner, repo, number, url }) {
  const pr = await gh(`repos/${owner}/${repo}/pulls/${number}`);
  const files = await gh(`repos/${owner}/${repo}/pulls/${number}/files?per_page=100`);
  const login = pr.user.login;
  const headRepo = pr.head.repo?.full_name ?? `${owner}/${repo}`;
  let saved = 0;
  for (const f of files) {
    if (f.status === 'removed' || !/\.json$/i.test(f.filename)) continue;
    const text = await gh(`repos/${headRepo}/contents/${encodeURI(f.filename)}?ref=${pr.head.sha}`, true);
    let json;
    try { json = JSON.parse(text); } catch { continue; }
    if (typeof json?.format !== 'string' || !/car@|sealed@/.test(json.format)) continue;
    mkdirSync(join(outDir, login), { recursive: true });
    writeFileSync(join(outDir, login, basename(f.filename)), text);
    saved++;
  }
  return saved ? `ok    ${login}: файлов ${saved}` : `пусто ${login}: в PR нет файла машины — ${url}`;
}

const report = [];
let next = 0;
async function worker() {
  while (next < prs.length) {
    const pr = prs[next++];
    try {
      report.push(await collect(pr));
    } catch (e) {
      report.push(`ОШИБКА ${pr.url}: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
    }
    process.stdout.write(`\r${report.length}/${prs.length}`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`\n${report.sort().join('\n')}\n\nГотово: ${outDir}/`);
