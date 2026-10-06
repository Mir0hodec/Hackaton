import { credentials } from './password';
import { env } from 'cloudflare:workers';
import { makeSeed } from './seed';
import { namespace, demoContext, ownerKey } from './context';
export function db() {
  if (!env.DB) throw new Error('Хранилище временно недоступно');
  return env.DB;
}
export function bucket() {
  if (!env.BUCKET) throw new Error('Хранилище фото недоступно');
  return env.BUCKET;
}
export async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function initialize() {
  const exists = await db()
    .prepare('SELECT id FROM records WHERE id = ?')
    .bind(namespace() + 'seed-ready')
    .first();
  if (exists) return;
  const data = makeSeed();
  if ((env as any).WORKSPACE_MODE === 'true' && !namespace()) {
    data.orders = [];
    const initial = JSON.parse((env as any).INITIAL_USERS || '[]');
    if (!initial.length) throw new Error('Первичная настройка учётных записей не завершена');
    data.users = await Promise.all(
      initial.map(async (u: any) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        spec: u.spec || '',
        brigade: u.brigade || 1,
        onShift: u.role === 'worker',
        created: new Date().toISOString(),
        ...(await credentials(u.password)),
      })),
    );
  }
  const all: any[] = [];
  for (const [kind, items] of Object.entries(data)) {
    for (const item of items) {
      const value: any = { ...item };
      if (kind === 'users' && value.pin) {
        value.pinHash = await hash(value.id + ':' + value.pin);
        delete value.pin;
      }
      all.push(
        db()
          .prepare('INSERT OR IGNORE INTO records (id,kind,data,version) VALUES (?,?,?,0)')
          .bind(namespace() + kind + ':' + value.id, namespace() + kind, JSON.stringify(value)),
      );
    }
  }
  for (let i = 0; i < all.length; i += 60) await db().batch(all.slice(i, i + 60));
  await db()
    .prepare('INSERT OR IGNORE INTO records (id,kind,data,version) VALUES (?,?,?,0)')
    .bind(namespace() + 'seed-ready', namespace() + 'meta', '{}')
    .run();
}
export async function list(kind: string) {
  const r = await db()
    .prepare('SELECT data,version FROM records WHERE kind = ?')
    .bind(namespace() + kind)
    .all();
  return r.results.map((r: any) => ({ ...JSON.parse(r.data), version: r.version }));
}
export async function get(kind: string, id: string) {
  const r: any = await db()
    .prepare('SELECT data,version FROM records WHERE id = ?')
    .bind(namespace() + kind + ':' + id)
    .first();
  return r ? { ...JSON.parse(r.data), version: r.version } : null;
}
export async function save(kind: string, obj: any, version?: number) {
  if (version !== undefined) {
    const r = await db()
      .prepare('UPDATE records SET data=?,version=version+1 WHERE id=? AND version=?')
      .bind(JSON.stringify(obj), namespace() + kind + ':' + obj.id, version)
      .run();
    if (!r.meta.changes)
      throw new Error('Наряд уже изменён на другом устройстве. Обновите его и повторите действие.');
  } else
    await db()
      .prepare('INSERT INTO records(id,kind,data,version) VALUES(?,?,?,0)')
      .bind(namespace() + kind + ':' + obj.id, namespace() + kind, JSON.stringify(obj))
      .run();
}
export async function actor(req: Request) {
  if (demoContext.getStore()) return get('users', demoContext.getStore()!.user);
  const token = req.headers.get('cookie')?.match(/(?:^|;\s*)naryad_session=([^;]+)/)?.[1];
  if (!token) return null;
  const s: any = await db()
    .prepare('SELECT user_id FROM sessions WHERE id=? AND expires>?')
    .bind(await hash(token), Date.now())
    .first();
  const u = s ? await get('users', s.user_id) : null;
  return u && !u.disabled ? u : null;
}
export function safeUser(u: any) {
  const { pinHash, passwordHash, passwordSalt, ...rest } = u;
  return rest;
}
export function requireRoles(user: any, roles: string[]) {
  if (!user || !roles.includes(user.role)) throw new Error('Недостаточно прав для этого действия');
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) throw new Error('Запрос с другого сайта отклонён');
}

export function cookie(name: string, token: string, req: Request, maxAge = 43200) {
  const local = new URL(req.url).hostname;
  const secure =
    local === 'localhost' || local === '127.0.0.1' || local === 'terminal.local' ? '' : '; Secure';
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
export async function nextNumber() {
  const key = namespace() + 'order-counter';
  const maximum: any = await db()
    .prepare("SELECT MAX(CAST(json_extract(data,'$.number') AS INTEGER)) AS n FROM records WHERE kind=?")
    .bind(namespace() + 'orders')
    .first();
  await db()
    .prepare('INSERT OR IGNORE INTO records(id,kind,data,version) VALUES(?,?,?,0)')
    .bind(key, namespace() + 'meta', String(Math.max(2004, maximum?.n || 0)))
    .run();
  const result: any = await db()
    .prepare('UPDATE records SET data=CAST(MAX(CAST(data AS INTEGER),?)+1 AS TEXT) WHERE id=? RETURNING data')
    .bind(maximum?.n || 2004, key)
    .first();
  return Number(result.data);
}
