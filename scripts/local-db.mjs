import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import './sites-env.mjs';
const config = 'dist/server/wrangler.json';
if (!existsSync(config)) throw new Error('Сначала выполните npm run build');
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
function sql(extra, capture = false) {
  const r = spawnSync(
    process.execPath,
    [
      './node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      'DB',
      '--local',
      '--config',
      config,
      '--persist-to',
      '.wrangler/state',
      ...extra,
    ],
    { stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' },
  );
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr || 'Ошибка миграции');
  return r.stdout;
}
sql(['--command', 'CREATE TABLE IF NOT EXISTS _naryadai_migrations (name TEXT PRIMARY KEY)']);
for (const item of journal.entries) {
  const tag = item.tag;
  if (!/^[a-zA-Z0-9_]+$/.test(tag)) throw new Error('Invalid migration');
  const result = JSON.parse(
    sql(['--command', `SELECT name FROM _naryadai_migrations WHERE name='${tag}'`, '--json'], true),
  );
  if (result.some((x) => x.results?.length)) continue;
  sql(['--file', `drizzle/${tag}.sql`]);
  sql(['--command', `INSERT INTO _naryadai_migrations(name) VALUES('${tag}')`]);
}
console.log('Локальная база готова. Выполните npm start и откройте адрес из терминала.');
