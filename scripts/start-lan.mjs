import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, cpSync, mkdtempSync, chmodSync } from 'node:fs';
import { networkInterfaces, hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lanAiConfig } from './lan-ai-config.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const port = Number(process.env.NARYADAI_LAN_PORT || 8788);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Неверный порт NARYADAI_LAN_PORT');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args) => {
  const r = spawnSync(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status || 1);
};
if (!existsSync('node_modules/wrangler/bin/wrangler.js')) run(['run', 'install:ci']);
if (!existsSync('dist/server/index.js')) run(['run', 'build']);
await import('./sites-env.mjs');
try {
  const existing = await fetch(`http://127.0.0.1:${port}/api/lan-discovery`, {
    signal: AbortSignal.timeout(800),
  });
  if (existing.ok && (await existing.json()).mode === 'shared-lan-demo') {
    console.log(`Сервер уже работает: http://127.0.0.1:${port}/demo`);
    console.log(`iPhone QR-вход: http://127.0.0.1:${port}/lan`);
    process.exit(0);
  }
} catch {}

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((x) => x && !x.internal && x.family === 'IPv4')
  .map((x) => x.address);
const rawHost = hostname().replace(/\.$/, '');
const localHost = rawHost.endsWith('.local') ? rawHost : rawHost + '.local';
if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.local$/.test(localHost))
  throw new Error('Имя ноутбука недоступно для Bonjour');
const runtime = path.join(root, '.lan-runtime');
mkdirSync(runtime, { recursive: true });
// Keep server modules and hashed browser assets from the same build during development.
// A later build may replace dist; the running demo continues using this immutable copy.
const site = mkdtempSync(path.join(runtime, 'site-'));
cpSync(path.join(root, 'dist'), site, {
  recursive: true,
  filter: (source) => !path.basename(source).startsWith('.dev.vars'),
});
const config = JSON.parse(readFileSync(path.join(site, 'server/wrangler.json'), 'utf8'));
config.main = path.join(site, 'server/index.js');
config.assets = { ...config.assets, directory: path.join(site, 'client') };
config.r2_buckets = [];
const lanAi = lanAiConfig(root);
config.vars = {
  ...lanAi.vars,
  DEMO_ONLY: 'true',
  WORKSPACE_MODE: 'false',
  LOCAL_DEMO_NETWORK: 'true',
  LOCAL_DEMO_HOST: localHost,
  LOCAL_DEMO_PORT: String(port),
  LOCAL_DEMO_ADDRESSES: addresses.join(','),
};
config.triggers = {};
delete config.build;
writeFileSync(path.join(runtime, 'wrangler.json'), JSON.stringify(config, null, 2));
// Only the explicitly enabled local AI key is allowed; deployment secrets stay out.
writeFileSync(
  path.join(runtime, '.dev.vars'),
  Object.entries({ ...config.vars, ...lanAi.secrets })
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n',
);
chmodSync(path.join(runtime, '.dev.vars'), 0o600);
const state = path.join(root, '.wrangler/lan-state');
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
const sql = (args, capture = false) => {
  const r = spawnSync(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'd1',
      'execute',
      'DB',
      '--local',
      '--config',
      path.join(runtime, 'wrangler.json'),
      '--persist-to',
      state,
      ...args,
    ],
    { stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8', env: process.env },
  );
  if (r.status !== 0) throw new Error(capture ? r.stderr : 'Не удалось подготовить локальную базу');
  return r.stdout;
};
sql(['--command', 'CREATE TABLE IF NOT EXISTS _naryadai_migrations (name TEXT PRIMARY KEY)']);
for (const { tag } of journal.entries) {
  if (!/^[a-zA-Z0-9_]+$/.test(tag)) throw new Error('Invalid migration');
  const rows = JSON.parse(
    sql(['--command', `SELECT name FROM _naryadai_migrations WHERE name='${tag}'`, '--json'], true),
  );
  if (rows.some((r) => r.results?.length)) continue;
  sql(['--file', `drizzle/${tag}.sql`]);
  sql(['--command', `INSERT INTO _naryadai_migrations(name) VALUES('${tag}')`]);
}
writeFileSync(
  path.join(runtime, 'connection.json'),
  JSON.stringify(
    {
      port,
      addresses,
      host: localHost,
      joinPath: '/lan',
      path: '/demo',
      service: '_naryadai._tcp.local',
      mode: 'shared-lan-demo',
    },
    null,
    2,
  ),
);
console.log('\nНарядAI · общая демо-смена в Wi-Fi\n');
console.log(`На ноутбуке: http://127.0.0.1:${port}/demo`);
console.log(`iPhone · QR-вход: http://127.0.0.1:${port}/lan`);
console.log(`iPhone · Safari: http://${localHost}:${port}/demo`);
for (const ip of addresses) console.log(`С телефона: http://${ip}:${port}/demo`);
console.log('Откройте APK: он найдёт сервер автоматически. Ноутбук и телефоны должны быть в одной сети.\n');
const worker = spawn(
  process.execPath,
  [
    '--import',
    './scripts/sites-env.mjs',
    'node_modules/wrangler/bin/wrangler.js',
    'dev',
    '--config',
    path.join(runtime, 'wrangler.json'),
    '--local',
    '--persist-to',
    state,
    '--ip',
    '0.0.0.0',
    '--inspector-port',
    '0',
    '--port',
    String(port),
  ],
  { stdio: 'inherit' },
);
let bonjour,
  service,
  stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  try {
    bonjour?.unpublishAll();
    bonjour?.destroy();
  } catch {}
  worker.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
worker.on('error', (e) => {
  console.error('Не удалось запустить сервер:', e.message);
  process.exitCode = 1;
  stop();
});
worker.on('exit', (code) => {
  stop();
  process.exit(process.exitCode || code || 0);
});
try {
  for (let i = 0; i < 60; i++) {
    if (worker.exitCode !== null) throw new Error('LAN сервер остановлен');
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/lan-discovery`, {
        signal: AbortSignal.timeout(1500),
      });
      const v = await r.json();
      if (r.ok && v.mode === 'shared-lan-demo') break;
    } catch {}
    if (i === 59) throw new Error('Сервер не запустился');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try {
    const { default: Bonjour } = await import('bonjour-service');
    bonjour = new Bonjour(undefined, (e) => console.warn('Автопоиск недоступен:', e.message));
    service = bonjour.publish({
      name: 'NaryadAI Demo',
      host: localHost,
      type: 'naryadai',
      protocol: 'tcp',
      port,
      disableIPv6: true,
      txt: { app: 'naryadai', protocol: '1', path: '/demo', mode: 'shared-lan-demo' },
    });
    service.on('up', () => console.log('Автообнаружение включено: _naryadai._tcp.local'));
    service.on('error', (e) => console.warn('Автопоиск:', e.message));
  } catch (e) {
    console.warn('Автопоиск недоступен. Используйте адрес, показанный выше:', e.message);
  }
} catch (e) {
  console.error(e.message);
  stop();
  process.exitCode = 1;
}
