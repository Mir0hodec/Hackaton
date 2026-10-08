import { isLanDemo } from '../../../lib/lan-mode';
import { workcardAction } from '../../../lib/workcards';
import { checkDeadlines, storeAlert } from '../../../lib/deadlines';
import { loadSettings, updateSettings } from '../../../lib/settings';
import { recommendWorkers } from '../../../lib/recommend';
import { importHistory, clearHistory, historyStatus } from '../../../lib/history-import';
import { credentials, verifyPassword } from '../../../lib/password';
import { pushKeys, subscribePush, removePush, notifyUsers } from '../../../lib/web-push';
import { rateLimit } from '../../../lib/rate-limit';
import { markAiPending, runAiReview } from '../../../lib/ai-review';
import { llmInfo } from '../../../lib/llm';
import { activeMinutes, equipmentDowntime, stopWorkClock } from '../../../lib/timing';
import { env, waitUntil } from 'cloudflare:workers';
import { namespace, ownerKey } from '../../../lib/context';
import {
  db,
  bucket,
  initialize,
  list,
  get,
  save,
  saveWorkingOrder,
  actor,
  safeUser,
  hash,
  requireRoles,
  sameOrigin,
  cookie,
  nextNumber,
} from '../../../lib/server';
import { evaluate, closed, formatServerTime } from '../../../lib/domain';
import { queueHead, wasQueued } from '../../../lib/queue';
import { hamming } from '../../../lib/photo-meta';
export const dynamic = 'force-dynamic';
// Закрытые наряды остаются в оперативной ленте: мастеру — 3 дня, исполнителю — 14 дней (свои оценки).
const RECENT_MS = 3 * 86400000;
const RECENT_WORKER_MS = 14 * 86400000;
function json(data: any, status = 200, headers: any = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
export async function GET(req: Request) {
  try {
    if ((env as any).DEMO_ONLY === 'true' && !namespace()) return json({ user: null, demoOnly: true });
    await initialize();
    const u = await actor(req);
    const users = await list('users');
    if (!u)
      return json({
        user: null,
        workspace: (env as any).WORKSPACE_MODE === 'true',
        accounts: (env as any).WORKSPACE_MODE === 'true' ? [] : users.map(safeUser),
      });
    // Лёгкий запрос service worker'а: текст последних уведомлений для показа push.
    if (new URL(req.url).searchParams.get('view') === 'order') {
      const o = await get('orders', new URL(req.url).searchParams.get('id') || '');
      if (!o || (u.role === 'worker' && o.worker !== u.id && !o.members?.includes(u.id)))
        return json({ error: 'Наряд не найден' }, 404);
      return json({ order: o });
    }
    if (new URL(req.url).searchParams.get('view') === 'notifications') {
      const items = (await list('alerts'))
        .filter((a) => a.to?.includes(u.id))
        .sort((a, b) => Date.parse(b.created) - Date.parse(a.created))
        .slice(0, 5)
        .map(({ id, title, text, order, emergency, created }) => ({
          id,
          title,
          text,
          order,
          emergency,
          created,
        }));
      return json({ items });
    }
    if (!u.lastSeen || Date.now() - Date.parse(u.lastSeen) > 60000)
      await save('users', { ...u, lastSeen: new Date().toISOString() }, u.version).catch(() => {});
    await checkDeadlines(new URL(req.url).origin).catch(() => {});
    const alerts = (await list('alerts'))
      .filter((a) => a.to?.includes(u.id))
      .sort((a, b) => Date.parse(b.created) - Date.parse(a.created))
      .slice(0, 60);
    const settings = await loadSettings();
    const [areas, equipment, codes, materials, all] = await Promise.all(
      ['areas', 'equipment', 'codes', 'materials', 'orders'].map(list),
    );
    const worklogs = (await list('worklogs')).filter((x) => u.role !== 'worker' || x.id === u.id);
    return json({
      serverTime: new Date().toISOString(),
      worklogs,
      workspace: (env as any).WORKSPACE_MODE === 'true',
      user: safeUser(u),
      users: users
        .filter((x) => u.role !== 'worker' || x.id === u.id || x.role === 'master' || x.brigade === u.brigade)
        .map(safeUser),
      areas,
      equipment,
      codes,
      materials,
      // Телефоны получают только текущие и недавние наряды; история и отчёты — через /api/analytics.
      orders: all.filter(
        (o) =>
          (u.role !== 'worker' || o.worker === u.id || o.members?.includes(u.id)) &&
          (!closed(o) ||
            Date.now() - Date.parse(o.updatedAt || o.closedAt || o.created) <
              (u.role === 'worker' ? RECENT_WORKER_MS : RECENT_MS)) &&
          !(o.synthetic && closed(o)),
      ),
      history: u.role === 'admin' ? await historyStatus() : undefined,
      alerts,
      settings,
      demo: !!namespace(),
      environmentId: namespace() || 'workplace',
      capabilities: {
        lanDemo: isLanDemo(env as any),
        llm: !!llmInfo().provider,
        llmProvider: llmInfo().provider,
        push: !namespace(),
      },
    });
  } catch (e: any) {
    console.error(e);
    return json({ error: 'Не удалось загрузить данные. Повторите попытку.' }, 503);
  }
}
export async function POST(req: Request) {
  try {
    // Тело читается до проверок: недочитанный запрос перезапускает локальный workerd.
    const b: any = await req.json();
    sameOrigin(req);
    if ((env as any).DEMO_ONLY === 'true' && !namespace())
      return json({ error: 'Используйте демонстрационный режим' }, 403);
    await initialize();
    if (b.action === 'login') {
      if (!(await rateLimit(req, 'login', 30, 300000)))
        return json({ error: 'Слишком много попыток входа. Повторите через 5 минут.' }, 429);
      const login = String(b.id || '')
        .trim()
        .toLowerCase();
      if (!(await rateLimit(req, 'account-' + (await hash(login)), 12, 300000)))
        return json({ error: 'Слишком много попыток входа. Повторите через 5 минут.' }, 429);
      const u = await get('users', login);
      const valid =
        u &&
        !u.disabled &&
        (u.passwordHash
          ? await verifyPassword(u, String(b.pin || ''))
          : u.pinHash === (await hash(u.id + ':' + String(b.pin))));
      if (!valid) return json({ error: 'Неверный логин или пароль' }, 401);
      const token = crypto.randomUUID() + crypto.randomUUID();
      await db()
        .prepare('INSERT INTO sessions(id,user_id,expires) VALUES(?,?,?)')
        .bind(await hash(token), u.id, Date.now() + 43200000)
        .run();
      return json({ ok: true }, 200, { 'Set-Cookie': cookie('naryad_session', token, req) });
    }
    const u = await actor(req);
    if (!u) return json({ error: 'Войдите в систему' }, 401);
    if (b.action === 'push-key') {
      return json({ publicKey: (await pushKeys()).publicKey });
    }
    if (b.action === 'push-subscribe') {
      await subscribePush(u, String(b.endpoint));
      return json({ ok: true });
    }
    if (b.action === 'push-unsubscribe') {
      await removePush(u, String(b.endpoint));
      return json({ ok: true });
    }
    if (b.action === 'push-test') {
      if (namespace()) throw new Error('Push доступен в основной версии');
      if (!(await rateLimit(req, 'push-test', 6, 60000)))
        return json({ error: 'Повторите тест через минуту' }, 429);
      return json(await notifyUsers([u.id], new URL(req.url).origin));
    }
    if (b.action === 'logout') {
      const token = req.headers.get('cookie')?.match(/(?:^|;\s*)naryad_session=([^;]+)/)?.[1];
      if (token)
        await db()
          .prepare('DELETE FROM sessions WHERE id=?')
          .bind(await hash(token))
          .run();
      return json({ ok: true }, 200, { 'Set-Cookie': cookie('naryad_session', '', req, 0) });
    }
    if (
      ['work-start', 'work-progress', 'work-plan', 'work-finish', 'work-cancel', 'work-review'].includes(
        b.action,
      )
    )
      return json(await workcardAction(u, b, new URL(req.url).origin));
    if (b.action === 'user-create') {
      requireRoles(u, ['admin']);
      const d = b.data;
      const id = String(d.login || '')
        .trim()
        .toLowerCase();
      if (
        !/^[a-z0-9._-]{3,40}$/.test(id) ||
        !d.name?.trim() ||
        !['master', 'worker', 'manager', 'admin'].includes(d.role)
      )
        throw new Error('Проверьте логин, имя и роль');
      if (await get('users', id)) throw new Error('Логин уже занят');
      const account = {
        id,
        name: String(d.name).trim().slice(0, 100),
        role: d.role,
        grade: Math.max(1, Math.min(6, Number(d.grade) || 4)),
        spec: String(d.spec || '').slice(0, 80),
        brigade: Math.max(1, Math.min(99, Number(d.brigade) || 1)),
        onShift: d.role === 'worker',
        created: new Date().toISOString(),
        ...(await credentials(String(d.password || ''))),
      };
      await save('users', account);
      return json({ ok: true });
    }
    if (b.action === 'user-update') {
      requireRoles(u, ['admin']);
      const target = await get('users', String(b.id));
      if (!target) throw new Error('Сотрудник не найден');
      if (b.disabled && target.id === u.id)
        throw new Error('Нельзя заблокировать собственную учётную запись');
      const changes: any = { ...target };
      if (typeof b.disabled === 'boolean') changes.disabled = b.disabled;
      if (b.password) Object.assign(changes, await credentials(String(b.password)));
      if (b.spec !== undefined) changes.spec = String(b.spec).slice(0, 80);
      if (b.brigade) changes.brigade = Math.max(1, Math.min(99, Number(b.brigade)));
      await save('users', changes, target.version);
      if (b.disabled || b.password) {
        await db().prepare('DELETE FROM sessions WHERE user_id=?').bind(target.id).run();
        await db()
          .prepare("DELETE FROM records WHERE kind='push' AND json_extract(data,'$.user')=?")
          .bind(target.id)
          .run();
      }
      return json({ ok: true });
    }
    if (b.action === 'password-change') {
      if (!(await verifyPassword(u, String(b.oldPassword || '')))) throw new Error('Текущий пароль неверен');
      await save('users', { ...u, ...(await credentials(String(b.password || ''))) }, u.version);
      await db().prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id).run();
      return json({ ok: true }, 200, { 'Set-Cookie': cookie('naryad_session', '', req, 0) });
    }
    if (b.action === 'create') {
      requireRoles(u, ['master']);
      const d = b.data;
      if (b.requestId) {
        const old = await get('orders', String(b.requestId));
        if (old && old.master === u.id) return json({ ok: true, id: old.id });
      }
      const eq = await get('equipment', d.equipment);
      const allUsers = await list('users');
      const brigade = d.brigade ? Number(d.brigade) : null;
      const members = brigade
        ? allUsers
            .filter((w) => w.role === 'worker' && w.brigade === brigade && w.onShift && !w.disabled)
            .map((w) => w.id)
        : [];
      const worker = await get('users', d.worker || members[0]);
      if (brigade && !members.length) throw new Error('В бригаде нет сотрудников на смене');
      if (
        !d.title?.trim() ||
        !eq ||
        worker?.role !== 'worker' ||
        !worker.onShift ||
        worker.disabled ||
        !['emergency', 'high', 'normal', 'planned'].includes(d.priority) ||
        !['planned', 'unplanned'].includes(d.type) ||
        !Number.isFinite(Date.parse(d.due))
      )
        throw new Error('Заполните описание, оборудование, срок и выберите исполнителя на смене');
      const existing = await list('orders');
      const now = new Date().toISOString();
      const o = {
        id: /^[a-f0-9-]{36}$/.test(b.requestId || '') ? b.requestId : crypto.randomUUID(),
        number: await nextNumber(),
        title: String(d.title).slice(0, 180),
        description: String(d.description || d.title).slice(0, 4000),
        area: eq.area,
        equipment: eq.id,
        worker: worker.id,
        brigade: brigade || null,
        members: brigade ? members : [worker.id],
        complexity: Math.min(3, Math.max(1, Number(d.complexity) || 1)),
        downtimeStarted: d.equipmentStopped ? now : null,
        activeMs: 0,
        master: u.id,
        type: d.type,
        priority: d.priority,
        due: d.due,
        norm: Math.max(1, Number(d.norm) || 90),
        photos: Array.isArray(d.photos) ? d.photos.slice(0, 5) : [],
        suggestedCode: typeof d.suggestedCode === 'string' ? d.suggestedCode.slice(0, 10) : null,
        recommendedWorker: typeof d.recommendedWorker === 'string' ? d.recommendedWorker.slice(0, 60) : null,
        status: 'issued',
        created: now,
        updatedAt: now,
        history: [{ at: now, actor: u.id, text: 'Наряд выдан' }],
      };
      await validatePhotos(o.photos, u.id);
      await save('orders', o);
      await storeAlert({
        id: 'new:' + o.id,
        order: o.id,
        title: `${o.priority === 'emergency' ? 'АВАРИЙНЫЙ наряд' : 'Новый наряд'} №${o.number}`,
        text: `${o.title}. ${eq.name}. Срок: ${formatServerTime(o.due)}`,
        to: o.members,
        emergency: o.priority === 'emergency',
        kind: 'new',
      });
      await notifyUsers(o.members, new URL(req.url).origin).catch(() => {});
      return json({ ok: true, id: o.id });
    }
    if (b.action === 'recommend') {
      requireRoles(u, ['master']);
      const [orders, users, equipment, codes, worklogs] = await Promise.all(
        ['orders', 'users', 'equipment', 'codes', 'worklogs'].map(list),
      );
      const result = recommendWorkers({
        orders,
        users,
        equipment,
        codes,
        worklogs,
        equipmentId: String(b.equipment || ''),
        text: String(b.text || '').slice(0, 2000),
      });
      return json({ ...result, ranked: result.ranked.slice(0, 5) });
    }
    if (b.action === 'history-import') {
      requireRoles(u, ['admin']);
      return json({ ok: true, ...(await importHistory()) });
    }
    if (b.action === 'history-clear') {
      requireRoles(u, ['admin']);
      return json({ ok: true, ...(await clearHistory()) });
    }
    if (b.action === 'settings') {
      requireRoles(u, ['admin']);
      return json({ ok: true, settings: await updateSettings(b.data || {}) });
    }
    if (b.action === 'catalog-edit') {
      requireRoles(u, ['admin']);
      if (!['areas', 'equipment', 'codes', 'materials'].includes(b.kind))
        throw new Error('Неизвестный справочник');
      const item = await get(b.kind, String(b.id));
      if (!item) throw new Error('Запись не найдена');
      const d = b.data;
      if (!String(d.name || '').trim()) throw new Error('Введите название');
      const update: any = { ...item, name: String(d.name).trim().slice(0, 140) };
      if (['codes', 'materials'].includes(b.kind)) update.norm = Math.max(1, Number(d.norm) || 1);
      if (b.kind === 'materials') update.unit = String(d.unit || 'шт.').slice(0, 20);
      if (b.kind === 'equipment') {
        if (!(await get('areas', String(d.area)))) throw new Error('Выберите участок');
        update.area = d.area;
        update.inventory = String(d.inventory || '—').slice(0, 80);
      }
      await save(b.kind, update, item.version);
      return json({ ok: true });
    }
    if (b.action === 'catalog') {
      requireRoles(u, ['admin']);
      if (!['areas', 'equipment', 'codes', 'materials'].includes(b.kind))
        throw new Error('Неизвестный справочник');
      const x = b.data;
      if (!x.name?.trim()) throw new Error('Укажите название');
      const item = {
        id: crypto.randomUUID(),
        name: String(x.name).slice(0, 140),
        ...(b.kind === 'equipment' ? { area: x.area, inventory: x.inventory || '—', critical: false } : {}),
        ...(b.kind === 'materials' ? { unit: x.unit || 'шт.', norm: Math.max(1, Number(x.norm) || 1) } : {}),
        ...(b.kind === 'codes' ? { norm: Math.max(1, Number(x.norm) || 60) } : {}),
      };
      if (b.kind === 'equipment' && !(await get('areas', x.area))) throw new Error('Выберите участок');
      await save(b.kind, item);
      return json({ ok: true });
    }
    if (b.action === 'shift') {
      requireRoles(u, ['admin', 'master']);
      const w = await get('users', b.id);
      if (w?.role !== 'worker') throw new Error('Исполнитель не найден');
      await save('users', { ...w, onShift: !!b.onShift }, w.version);
      return json({ ok: true });
    }
    const o = await get('orders', b.id);
    if (!o) throw new Error('Наряд не найден');
    if (u.role === 'worker' && o.worker !== u.id && !o.members?.includes(u.id))
      return json({ error: 'Нет доступа к этому наряду' }, 403);
    if (b.requestId && o.history?.some((h: any) => h.requestId === b.requestId))
      return json({ ok: true, id: o.id });
    const v = o.version;
    const now = new Date().toISOString();
    let event = '';
    // Уведомления, которые записываются после успешного сохранения наряда.
    const pendingAlerts: Parameters<typeof storeAlert>[0][] = [];
    const users = await list('users');
    const who = (id: string) => users.find((x) => x.id === id)?.name || id;
    if (b.action === 'transition') {
      requireRoles(u, ['worker']);
      const allowed: any = {
        issued: ['accepted', 'queued', 'rejected'],
        accepted: ['working', 'queued', 'rejected'],
        queued: ['working', 'accepted', 'rejected'],
        working: ['paused'],
        paused: ['working'],
        rework: ['working'],
      };
      if (!allowed[o.status]?.includes(b.status)) throw new Error('Такой переход недоступен');
      if (['paused', 'rejected'].includes(b.status) && !b.reason?.trim()) throw new Error('Укажите причину');
      if (b.status === 'queued') o.queuedAt = now;
      if (b.status === 'working') {
        const all = await list('orders');
        if (['queued', 'accepted'].includes(o.status)) {
          const head = [...new Set<string>([o.worker, ...(o.members || [])])]
            .map((id) => queueHead(all, id))
            .find((head) => head && head.id !== o.id);
          if (
            head &&
            head.id !== o.id &&
            !(o.priority === 'emergency' && o.status === 'accepted' && !wasQueued(o))
          )
            throw new Error('Сначала начните первый наряд очереди №' + head.number);
        }
        if (
          all.some(
            (x) =>
              x.id !== o.id && (x.worker === u.id || x.members?.includes(u.id)) && x.status === 'working',
          )
        )
          throw new Error('Сначала приостановите или завершите текущую работу');
        o.started ??= now;
        o.activeSince = now;
      }
      if (b.status === 'paused') stopWorkClock(o, now);
      // Время реакции считается от выдачи до первого ответа исполнителя.
      if (['accepted', 'queued', 'working'].includes(b.status)) o.acceptedAt ??= now;
      o.status = b.status;
      event =
        {
          accepted: 'Наряд принят',
          queued: 'Поставлен в очередь',
          working: 'Начато исполнение',
          paused: 'Работа приостановлена',
          rejected: 'Наряд отклонён',
        }[b.status as string] || b.status;
      if (b.reason) {
        o.lastComment = String(b.reason).slice(0, 1000);
        event += ': ' + o.lastComment;
      }
      if (b.status === 'rejected') {
        o.rejectionReason = String(b.reason);
        o.rejections = [
          ...(o.rejections || []),
          { worker: u.id, reason: String(b.reason).slice(0, 1000), at: now },
        ];
        pendingAlerts.push({
          id: `rejected:${o.id}:${o.rejections.length}`,
          order: o.id,
          title: `Наряд №${o.number} отклонён`,
          text: `${who(u.id)}: «${o.rejectionReason}». Переназначьте наряд и оцените причину отказа.`,
          to: [o.master],
          emergency: o.priority === 'emergency',
          kind: 'rejected',
        });
      } else if (o.priority === 'emergency' && ['accepted', 'working'].includes(b.status)) {
        pendingAlerts.push({
          id: `status:${o.id}:${b.status}`,
          order: o.id,
          title: `Аварийный №${o.number}: ${b.status === 'accepted' ? 'принят' : 'в работе'}`,
          text: `${who(u.id)} — ${o.title}`,
          to: [o.master],
          kind: 'status',
        });
      }
    } else if (b.action === 'rejection-verdict') {
      requireRoles(u, ['master']);
      if (!o.rejections && o.status === 'rejected' && o.rejectionReason)
        o.rejections = [{ worker: o.worker, reason: o.rejectionReason, at: o.updatedAt || o.created }];
      const item = o.rejections?.[Number(b.index)];
      if (!item) throw new Error('Отказ не найден');
      item.unjustified = !!b.unjustified;
      item.reviewedBy = u.id;
      event = `Причина отказа (${who(item.worker)}) признана ${item.unjustified ? 'неуважительной' : 'уважительной'}`;
    } else if (b.action === 'report') {
      requireRoles(u, ['worker']);
      if (!['working', 'paused', 'rework'].includes(o.status)) throw new Error('Сначала начните работу');
      const r = b.report;
      const codes = await list('codes');
      if (r.code && !codes.some((c) => c.id === r.code)) throw new Error('Неизвестный шифр');
      if (r.photos?.length > 5) throw new Error('Не более пяти фото');
      await validatePhotos(r.photos || [], u.id);
      const mats = await list('materials');
      const materialRows = (r.materials || []).map((m: any) => {
        const found = mats.find((x) => x.id === m.id);
        if (!found || !Number.isFinite(Number(m.qty)) || Number(m.qty) <= 0)
          throw new Error('Проверьте количество материалов');
        return { ...found, qty: Number(m.qty) };
      });
      o.report = {
        works: String(r.works || '').slice(0, 8000),
        code: r.code,
        materials: materialRows,
        photos: r.photos || [],
        comment: String(r.comment || '').slice(0, 2000),
      };
      let duplicate = false;
      for (const photo of o.report.photos) {
        const p: any = await db().prepare('SELECT hash,created FROM photos WHERE id=?').bind(photo).first();
        if (p) {
          const count: any = await db()
            .prepare('SELECT COUNT(*) AS n FROM photos WHERE hash=? AND user_id=?')
            .bind(p.hash, ownerKey(u.id))
            .first();
          if (count.n > 1 || p.created < Date.parse(o.created)) duplicate = true;
        }
      }
      const otherOrders = await list('orders');
      if (
        otherOrders.some(
          (x) => x.id !== o.id && x.report?.photos?.some((id: string) => o.report.photos.includes(id)),
        )
      )
        duplicate = true;
      const photoIssues = await photoFindings(o, o.report.photos);
      stopWorkClock(o, now);
      o.check = evaluate(o, o.report, duplicate, photoIssues);
      o.check.minutes = activeMinutes(o);
      o.check = markAiPending(o.check);
      o.finished = now;
      o.status = o.check.verdict === 'rework' ? 'rework' : 'review';
      if (o.status === 'rework') o.returned = true;
      event = o.status === 'rework' ? 'Проверка: требуется доработка' : 'Отчёт направлен мастеру';
      const verdictText: any = {
        accepted: 'принято',
        remarks: 'принято с замечаниями',
        rework: 'требует доработки',
      };
      pendingAlerts.push({
        id: `report:${o.id}:${now}`,
        order: o.id,
        title: `Отчёт по наряду №${o.number}: ${verdictText[o.check.verdict]} (${o.check.score}/5)`,
        text: `${who(u.id)} — ${o.title}. ${o.check.issues?.[0] || 'Замечаний нет.'}`,
        to: [o.master],
        kind: 'report',
      });
      if (o.status === 'rework')
        pendingAlerts.push({
          id: `rework:${o.id}:${now}`,
          order: o.id,
          title: `Наряд №${o.number} возвращён на доработку`,
          text: o.check.issues?.join(' ') || 'Дополните отчёт.',
          to: o.members || [o.worker],
          kind: 'rework',
        });
    } else if (b.action === 'decision') {
      requireRoles(u, ['master']);
      if (!['review', 'rework'].includes(o.status)) throw new Error('Наряд ещё не направлен на проверку');
      if (b.decision === 'return') {
        if (!b.reason?.trim()) throw new Error('Напишите, что нужно доработать');
        o.status = 'rework';
        o.returned = true;
        event = 'Мастер вернул на доработку: ' + b.reason;
        pendingAlerts.push({
          id: `decision:${o.id}:${now}`,
          order: o.id,
          title: `Наряд №${o.number}: мастер вернул на доработку`,
          text: String(b.reason).slice(0, 300),
          to: o.members || [o.worker],
          kind: 'decision',
        });
      } else {
        if (b.decision !== 'accept') throw new Error('Неизвестное решение');
        if (!b.reason?.trim()) throw new Error('Добавьте комментарий мастера');
        o.status = 'closed';
        o.closedAt = now;
        o.masterScore = Math.min(5, Math.max(1, Number(b.score) || o.check?.score || 4));
        o.masterComment = String(b.reason).slice(0, 2000);
        if (o.downtimeStarted && !o.downtimeEnded) o.downtimeEnded = now;
        o.downtime = equipmentDowntime(o);
        if (o.check && o.masterScore !== o.check.score) o.check.masterOverride = true;
        event = 'Наряд принят мастером. ' + o.masterComment;
        pendingAlerts.push({
          id: `decision:${o.id}:${now}`,
          order: o.id,
          title: `Наряд №${o.number} закрыт. Ваша оценка: ${o.masterScore}/5`,
          text: o.masterComment,
          to: o.members || [o.worker],
          kind: 'decision',
        });
      }
    } else if (b.action === 'downtime') {
      requireRoles(u, ['master']);
      if (b.stopped) {
        if (o.downtimeStarted && !o.downtimeEnded) throw new Error('Простой уже учитывается');
        o.previousDowntime = equipmentDowntime(o);
        o.downtimeStarted = now;
        o.downtimeEnded = null;
        event = 'Оборудование остановлено';
      } else {
        if (!o.downtimeStarted || o.downtimeEnded)
          throw new Error('Остановка не зафиксирована или уже завершена');
        o.downtimeEnded = now;
        o.downtime = equipmentDowntime(o);
        event = 'Работа оборудования восстановлена';
      }
    } else if (b.action === 'edit') {
      requireRoles(u, ['master']);
      // Отклонённый наряд можно переназначить другому исполнителю (ТЗ, раздел 4).
      const reassignRejected = o.status === 'rejected' && b.worker && !b.cancel;
      if (closed(o) && !reassignRejected) throw new Error('Наряд уже завершён');
      if (b.worker && b.worker !== o.worker) {
        const w = await get('users', b.worker);
        if (w?.role !== 'worker' || !w.onShift || w.disabled)
          throw new Error('Выберите исполнителя на смене');
        if (o.status === 'working') throw new Error('Для переназначения сначала приостановите работу');
        o.worker = w.id;
        o.members = [w.id];
        o.brigade = null;
        if (o.status === 'rejected') {
          o.status = 'issued';
          delete o.acceptedAt; // время реакции нового исполнителя считается заново
        }
        pendingAlerts.push({
          id: `assigned:${o.id}:${w.id}:${now}`,
          order: o.id,
          title: `${o.priority === 'emergency' ? 'АВАРИЙНЫЙ наряд' : 'Наряд'} №${o.number} назначен вам`,
          text: o.title,
          to: [w.id],
          emergency: o.priority === 'emergency',
          kind: 'new',
        });
      } else if (reassignRejected) throw new Error('Выберите другого исполнителя');
      if (b.priority) {
        if (!['emergency', 'high', 'normal', 'planned'].includes(b.priority))
          throw new Error('Неизвестный приоритет');
        o.priority = b.priority;
      }
      if (b.cancel) {
        stopWorkClock(o, now);
        if (!b.reason?.trim()) throw new Error('Укажите причину отмены');
        o.status = 'cancelled';
      }
      event = b.cancel
        ? 'Отменён: ' + b.reason
        : reassignRejected
          ? `Переназначен после отказа: ${who(o.worker)}`
          : 'Изменены назначение / приоритет';
    } else throw new Error('Неизвестное действие');
    o.history.push({ at: now, actor: u.id, text: event, requestId: b.requestId || null });
    o.updatedAt = now;
    if (b.action === 'transition' && b.status === 'working') await saveWorkingOrder(o, v);
    else await save('orders', o, v);
    for (const alert of pendingAlerts) await storeAlert(alert).catch((e) => console.error('alert:', e));
    // ИИ-проверка отчёта идёт в фоне: исполнитель не ждёт ответа модели.
    if (b.action === 'report' && o.check?.aiPending) waitUntil(runAiReview(o.id, new URL(req.url).origin));
    // Push получают только адресаты новых уведомлений: service worker покажет их текст.
    const recipients = [...new Set(pendingAlerts.flatMap((a) => a.to))];
    if (recipients.length) await notifyUsers(recipients, new URL(req.url).origin).catch(() => {});
    return json({ ok: true, id: o.id });
  } catch (e: any) {
    console.error(e);
    return json({ error: e.message || 'Не удалось сохранить изменения' }, 400);
  }
}
/** Сравнение фото «после» с фото «до» и прежними снимками (dHash) и проверка даты съёмки (EXIF). */
async function photoFindings(o: any, ids: string[]) {
  const issues: string[] = [];
  if (!ids.length) return issues;
  const meta = await list('photometa');
  const byId = new Map(meta.map((m: any) => [m.id, m]));
  for (const id of ids) {
    const m: any = byId.get(id);
    if (!m) continue;
    if (m.dhash) {
      const similar = meta.filter((x: any) => x.id !== id && x.dhash && hamming(x.dhash, m.dhash) <= 6);
      if (similar.some((x: any) => o.photos?.includes(x.id)))
        issues.push(
          'Фото «после» практически совпадает с фото «до»: видимых изменений нет. Нужна проверка мастером.',
        );
      else if (similar.some((x: any) => !ids.includes(x.id)))
        issues.push('Фото «после» очень похоже на ранее загруженный снимок. Нужна проверка мастером.');
    }
    if (m.takenAt && Date.parse(m.takenAt) < Date.parse(o.created) - 10 * 60000)
      issues.push(
        `По данным EXIF снимок сделан ${formatServerTime(m.takenAt)}, раньше выдачи наряда. Нужна проверка мастером.`,
      );
  }
  return [...new Set(issues)];
}
async function validatePhotos(ids: string[], user: string) {
  for (const id of ids) {
    const p: any = await db().prepare('SELECT user_id FROM photos WHERE id=?').bind(id).first();
    if (!p || p.user_id !== ownerKey(user)) throw new Error('Недоступная фотография');
  }
}
