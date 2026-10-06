import { namespace, ownerKey } from '../../../lib/context';
import { actor, bucket, db, sameOrigin, list, save } from '../../../lib/server';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const u = await actor(req);
    if (!u || !['master', 'worker'].includes(u.role))
      return Response.json({ error: 'Нет доступа' }, { status: 403 });
    const data = await req.formData();
    const file = data.get('file') as File;
    if (!file || file.size > 6 * 1024 * 1024)
      return Response.json({ error: 'Фото должно быть меньше 6 МБ' }, { status: 400 });
    const bytes = await file.arrayBuffer();
    const a = new Uint8Array(bytes);
    const mime =
      a[0] === 255 && a[1] === 216
        ? 'image/jpeg'
        : a[0] === 137 && a[1] === 80
          ? 'image/png'
          : a[0] === 82 && a[8] === 87
            ? 'image/webp'
            : null;
    if (!mime) return Response.json({ error: 'Используйте JPEG, PNG или WebP' }, { status: 400 });
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    const id = crypto.randomUUID();
    await bucket().put(id, bytes, { httpMetadata: { contentType: mime } });
    await db()
      .prepare('INSERT INTO photos(id,user_id,hash,created,type) VALUES(?,?,?,?,?)')
      .bind(id, ownerKey(u.id), hash, Date.now(), mime)
      .run();
    // Метаданные с телефона: перцептивный хэш и дата съёмки из EXIF (для проверки «свежести» фото).
    const dhash = String(data.get('dhash') || '');
    const takenAt = String(data.get('takenAt') || '');
    if (/^[0-9a-f]{16}$/.test(dhash) || Number.isFinite(Date.parse(takenAt)))
      await save('photometa', {
        id,
        user: u.id,
        dhash: /^[0-9a-f]{16}$/.test(dhash) ? dhash : null,
        takenAt: Number.isFinite(Date.parse(takenAt)) ? new Date(takenAt).toISOString() : null,
        created: new Date().toISOString(),
      });
    return Response.json({ id });
  } catch (e) {
    console.error(e);
    return Response.json({ error: 'Не удалось загрузить фото. Повторите попытку.' }, { status: 503 });
  }
}
export async function GET(req: Request) {
  const u = await actor(req);
  if (!u) return new Response('Нет доступа', { status: 401 });
  const id = new URL(req.url).searchParams.get('id') || '';
  const meta: any = await db().prepare('SELECT user_id FROM photos WHERE id=?').bind(id).first();
  if (!meta) return new Response('Не найдено', { status: 404 });
  if (namespace() && !meta.user_id.startsWith(namespace()))
    return new Response('Нет доступа', { status: 403 });
  if (!namespace() && meta.user_id.startsWith('demo:')) return new Response('Нет доступа', { status: 403 });
  if (u.role === 'worker' && meta.user_id !== ownerKey(u.id)) {
    const rows = await list('orders');
    if (
      !rows.some((o: any) => {
        return (
          (o.worker === u.id || o.members?.includes(u.id)) &&
          (o.photos?.includes(id) || o.report?.photos?.includes(id))
        );
      })
    )
      return new Response('Нет доступа', { status: 403 });
  }
  const file = await bucket().get(id);
  if (!file) return new Response('Не найдено', { status: 404 });
  return new Response(file.body, {
    headers: {
      'Content-Type': file.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
