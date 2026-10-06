// Деплой НарядAI в собственный аккаунт Cloudflare: Worker + D1 + R2 + Cron Trigger.
//
// Перед первым запуском:
//   1. npx wrangler login          (вход в аккаунт Cloudflare через браузер)
//   2. создайте .dev.vars.production (не коммитится) по образцу .env.example:
//      WORKSPACE_MODE, INITIAL_USERS, REMINDER_TOKEN, PUBLIC_ORIGIN, ключ LLM при наличии.
// Запуск: npm run deploy:cf
//
// Скрипт создаёт базу D1 и бакет R2, если их ещё нет, сохраняет их параметры в
// .cloudflare.local.json, собирает проект, применяет миграции и публикует Worker.
// Секреты из .dev.vars.production загружаются после публикации.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import './sites-env.mjs';

const stateFile = '.cloudflare.local.json';
const secretsFile = '.dev.vars.production';
const config = 'dist/server/wrangler.json';
const state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : { name: 'naryadai', d1Name: 'naryadai', bucket: 'naryadai-photos' };

function wrangler(args, { capture = false, allowFail = false, env = {} } = {}) {
  const r = spawnSync(process.execPath, ['./node_modules/wrangler/bin/wrangler.js', ...args], {
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail)
    throw new Error(`wrangler ${args[0]} завершился с ошибкой\n${r.stderr || ''}`);
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

if (!state.d1Id) {
  console.log(`Создаю базу D1 «${state.d1Name}»…`);
  const created = wrangler(['d1', 'create', state.d1Name], { capture: true, allowFail: true });
  let id = created.out.match(/"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/)?.[1];
  if (!id) {
    const listed = wrangler(['d1', 'list', '--json'], { capture: true });
    id = JSON.parse(listed.out.slice(listed.out.indexOf('['))).find((d) => d.name === state.d1Name)?.uuid;
  }
  if (!id) throw new Error('Не удалось получить id базы D1:\n' + created.out);
  state.d1Id = id;
  writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
}

console.log(`Проверяю бакет R2 «${state.bucket}»…`);
const bucket = wrangler(['r2', 'bucket', 'create', state.bucket], { capture: true, allowFail: true });
if (!bucket.ok && !/already exists|already own/i.test(bucket.out)) {
  throw new Error('Не удалось создать бакет R2. Включите R2 в панели Cloudflare.\n' + bucket.out);
}

console.log('Собираю проект…');
const build = spawnSync(process.execPath, ['scripts/run-framework.mjs', 'build'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NARYADAI_CF_NAME: state.name,
    NARYADAI_CF_D1_NAME: state.d1Name,
    NARYADAI_CF_D1_ID: state.d1Id,
    NARYADAI_CF_BUCKET: state.bucket,
  },
});
if (build.status !== 0) throw new Error('Сборка завершилась с ошибкой');

console.log('Применяю миграции к удалённой базе…');
const d1 = (extra, capture = false) =>
  wrangler(['d1', 'execute', 'DB', '--remote', '--config', config, ...extra], { capture });
d1(['--command', 'CREATE TABLE IF NOT EXISTS _naryadai_migrations (name TEXT PRIMARY KEY)']);
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
for (const { tag } of journal.entries) {
  if (!/^[a-zA-Z0-9_]+$/.test(tag)) throw new Error('Некорректное имя миграции');
  const out = d1(
    ['--command', `SELECT name FROM _naryadai_migrations WHERE name='${tag}'`, '--json'],
    true,
  ).out;
  if (JSON.parse(out.slice(out.indexOf('['))).some((x) => x.results?.length)) continue;
  d1(['--file', `drizzle/${tag}.sql`]);
  d1(['--command', `INSERT INTO _naryadai_migrations(name) VALUES('${tag}')`]);
}

console.log('Публикую Worker…');
wrangler(['deploy', '--config', config]);

if (existsSync(secretsFile)) {
  console.log('Загружаю секреты…');
  wrangler(['secret', 'bulk', secretsFile, '--config', config]);
} else {
  console.log(`Файл ${secretsFile} не найден: секреты не обновлялись.`);
}
console.log('Готово.');
