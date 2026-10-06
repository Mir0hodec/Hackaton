'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ClipboardCheck,
  Wrench,
  ChartNoAxesCombined,
  Settings,
  Eye,
  Sun,
  Moon,
  Plus,
  Bell,
  LogOut,
  Clock,
  TriangleAlert,
  Check,
  Camera,
  X,
  Users,
  FileText,
  Factory,
  Search,
  Download,
  ChevronLeft,
  ShieldCheck,
  RefreshCw,
  Pause,
  Play,
  CheckCheck,
  WifiOff,
  Smartphone,
  SlidersHorizontal,
  ArrowUpRight,
} from 'lucide-react';
import { roles, statuses, priorities, closed, overdue, rating } from '../lib/domain';
import { WorkProfile, WorkSummary, currentWork, workRating } from '../components/work-tracking';
import { ReportsPage, ManagerDashboard, MyRating, useAnalytics } from '../components/reports';
import { HistoryPanel, SettingsPanel } from '../components/admin-panels';
import { activeMinutes, equipmentDowntime } from '../lib/timing';
import { putLocal, readLocal, removeLocal } from '../lib/offline';
import { shiftOf } from '../lib/shift';
import { readExifDate, dHash } from '../lib/photo-meta';
import { OrderReport } from '../components/order-report';
import { AssigneeHint, CodeHint, useRecommendation } from '../components/assist';
import { UrgentBanner, playAlarm, playChime, unlockAudio } from '../components/urgent';
const roleIcons: any = {
  master: ClipboardCheck,
  worker: Wrench,
  manager: ChartNoAxesCombined,
  admin: Settings,
};
const roleDescriptions: any = {
  master: 'Выдача и контроль нарядов',
  worker: 'Задания и отчёты о работе',
  manager: 'Показатели и аналитика',
  admin: 'Справочники и сотрудники',
};
const fmt = (s: string) =>
  s
    ? new Date(s).toLocaleString('ru-RU', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
const time = (s: string) => new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export default function App() {
  const workNotices = useRef<{ user: string; ids: Set<string> }>({ user: '', ids: new Set() });
  const [iconStyle, setIconStyle] = useState('standard');
  const [reportDraft, setReportDraft] = useState<any>({});
  const reportForm = useRef<HTMLFormElement>(null);
  const demoStarted = useRef(false),
    sendingQueue = useRef(false);
  const [demo, setDemo] = useState(false),
    [queued, setQueued] = useState(0),
    [syncIssue, setSyncIssue] = useState('');
  const endpoint = () =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/demo')
      ? '/api/demo'
      : '/api/service';
  const [data, setData] = useState<any>(null),
    [role, setRole] = useState(''),
    [roleChoice, setRoleChoice] = useState(''),
    [quick, setQuick] = useState(false),
    [quickTitle, setQuickTitle] = useState('Течь масла — осмотреть и устранить'),
    [quickWorker, setQuickWorker] = useState(''),
    [pushKey, setPushKey] = useState(''),
    [queueItems, setQueueItems] = useState<any[]>([]),
    [staff, setStaff] = useState<any>(null),
    [recordEdit, setRecordEdit] = useState<any>(null),
    [fromDate, setFromDate] = useState(''),
    [toDate, setToDate] = useState(''),
    [equipmentFilter, setEquipmentFilter] = useState(''),
    [account, setAccount] = useState(''),
    [pin, setPin] = useState(''),
    [tab, setTab] = useState('home'),
    [selected, setSelected] = useState<string | null>(null),
    [modal, setModal] = useState(''),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [busy, setBusy] = useState(false),
    [theme, setTheme] = useState('light'),
    [scale, setScale] = useState(1),
    [contrast, setContrast] = useState(false),
    [a11y, setA11y] = useState(false),
    [online, setOnline] = useState(true),
    [filter, setFilter] = useState('active'),
    [search, setSearch] = useState(''),
    [area, setArea] = useState(''),
    [workerFilter, setWorkerFilter] = useState(''),
    [priority, setPriority] = useState(''),
    [period, setPeriod] = useState('90'),
    [board, setBoard] = useState(false),
    [install, setInstall] = useState<any>(null),
    [urgent, setUrgent] = useState<any>(null);
  const seenAlerts = useRef<{ scope: string; ids: Set<string> }>({ scope: '', ids: new Set() });
  const load = useCallback(async () => {
    try {
      const api = endpoint();
      const isDemo = api === '/api/demo';
      setDemo(isDemo);
      if (isDemo && !demoStarted.current) {
        const start = await fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'demo-start' }),
        });
        if (!start.ok) throw new Error('Не удалось открыть демо');
        demoStarted.current = true;
      }
      const r = await fetch(api);
      const d: any = await r.json();
      if (d.demoOnly) {
        window.location.replace('/demo');
        return;
      }
      if (!r.ok) {
        if (d.expired) demoStarted.current = false;
        throw new Error(d.error);
      }
      setData(d);
      setOnline(true);
      if (d.user) await putLocal('drafts', api + ':snapshot', d).catch(() => {});
      setQueued(
        (await readLocal('queue').catch(() => [])).filter(
          (q: any) => q.api === api && q.userId === d.user?.id && q.environmentId === d.environmentId,
        ).length,
      );
    } catch (e: any) {
      setOnline(false);
      const cached = await readLocal('drafts', endpoint() + ':snapshot').catch(() => null);
      if (cached) setData(cached);
      else setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
    const prefs = JSON.parse(localStorage.getItem('naryad-visibility') || '{}');
    setTheme(prefs.themeRevision === 'white-v1' ? prefs.theme || 'light' : 'light');
    setScale(prefs.scale || 1);
    setContrast(!!prefs.contrast);
    setIconStyle(['standard', 'bold', 'large'].includes(prefs.iconStyle) ? prefs.iconStyle : 'standard');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const fn = (e: any) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener('beforeinstallprompt', fn);
    return () => window.removeEventListener('beforeinstallprompt', fn);
  }, [load]);
  useEffect(() => {
    document.documentElement.dataset.iconStyle = iconStyle;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.contrast = String(contrast);
    document.documentElement.style.fontSize = 16 * scale + 'px';
    localStorage.setItem(
      'naryad-visibility',
      JSON.stringify({ theme, scale, contrast, iconStyle, themeRevision: 'white-v1' }),
    );
  }, [theme, scale, contrast, iconStyle]);
  useEffect(() => {
    if (!data?.user) return;
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [data?.user?.id, load]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(id);
    }
  }, [toast]);
  const user = data?.user,
    orders = data?.orders || [],
    users = data?.users || [],
    workers = users.filter((u: any) => u.role === 'worker' && (user?.role !== 'worker' || u.id === user.id));
  const [extraOrder, setExtraOrder] = useState<any>(null);
  const order =
    orders.find((o: any) => o.id === selected) || (extraOrder?.id === selected ? extraOrder : null);
  const active = orders.filter((o: any) => !closed(o));
  const late = active.filter(overdue);
  const shift = shiftOf(Date.now());
  const inShift = (iso?: string) => !!iso && Date.parse(iso) >= shift.start && Date.parse(iso) < shift.end;
  const shiftStats = {
    issued: orders.filter((o: any) => inShift(o.created)).length,
    done: orders.filter((o: any) => o.status === 'closed' && inShift(o.closedAt)).length,
    late: late.length,
    rejected: orders.filter((o: any) => o.status === 'rejected' && inShift(o.updatedAt || o.created)).length,
    downtime: new Set(
      active.filter((o: any) => o.downtimeStarted && !o.downtimeEnded).map((o: any) => o.equipment),
    ).size,
  };
  // Колонки доски по ТЗ 5.2: просроченные выделены отдельно, выполненные — за текущую смену.
  const boardColumns: [string, string, (o: any) => boolean][] = [
    ['late', 'Просроченные', (o) => overdue(o)],
    ['issued', 'Выданные', (o) => o.status === 'issued'],
    ['accepted', 'Принятые', (o) => o.status === 'accepted'],
    ['queued', 'В очереди', (o) => o.status === 'queued'],
    ['working', 'В работе', (o) => ['working', 'paused'].includes(o.status)],
    ['review', 'Проверка и доработка', (o) => ['review', 'rework'].includes(o.status)],
    ['done', 'Выполненные за смену', (o) => o.status === 'closed' && inShift(o.closedAt)],
  ];
  const boardColumn = (o: any) => boardColumns.find(([, , test]) => test(o))?.[0];
  const eqName = (id: string) => data?.equipment?.find((x: any) => x.id === id)?.name || id;
  const userName = (id: string) =>
    id === 'ai' ? 'ИИ-контролёр' : users.find((x: any) => x.id === id)?.name || id;
  const areaName = (id: string) => data?.areas?.find((x: any) => x.id === id)?.name || id;
  const calculatedAlerts = active.flatMap((o: any) => {
    if (user?.role === 'worker' && o.status === 'issued')
      return [
        {
          id: o.id + 'new',
          order: o.id,
          title: `Новый наряд №${o.number} · ${priorities[o.priority]}`,
          text: o.title,
        },
      ];
    const remaining = (Date.parse(o.due) - Date.now()) / 60000;
    const unaccepted =
      o.status === 'issued' &&
      (Date.now() - Date.parse(o.created)) / 60000 > (o.priority === 'emergency' ? 3 : 10);
    return remaining < 0
      ? [
          {
            id: o.id + 'late',
            order: o.id,
            title: `№${o.number} · Просрочен на ${Math.ceil(-remaining)} мин`,
            text: `${eqName(o.equipment)} · ${userName(o.worker)}`,
          },
        ]
      : unaccepted
        ? [
            {
              id: o.id + 'wait',
              order: o.id,
              title: `№${o.number} · Не принят исполнителем`,
              text: 'Проверьте назначение и доступность сотрудника',
            },
          ]
        : remaining <= 30
          ? [
              {
                id: o.id + 'soon',
                order: o.id,
                title: `№${o.number} · До срока ${Math.ceil(remaining)} мин`,
                text: eqName(o.equipment),
              },
            ]
          : [];
  });
  const alerts = [
    ...(data?.alerts || []),
    ...calculatedAlerts.filter((a: any) => !(data?.alerts || []).some((x: any) => x.order === a.order)),
  ];
  // Новые уведомления: звук, системное уведомление в фоне и полноэкранное предупреждение для аварийных.
  useEffect(() => {
    if (!user) return;
    const scope = data.environmentId + ':' + user.id;
    if (seenAlerts.current.scope !== scope) {
      seenAlerts.current = { scope, ids: new Set(alerts.map((a: any) => a.id)) };
      // При входе исполнителя сразу показываем непринятый аварийный наряд.
      const pending =
        user.role === 'worker' &&
        orders.find((o: any) => o.priority === 'emergency' && o.status === 'issued');
      if (pending)
        setUrgent({
          order: pending.id,
          title: `АВАРИЙНЫЙ наряд №${pending.number}`,
          text: `${pending.title}. ${eqName(pending.equipment)}`,
        });
      return;
    }
    const fresh = alerts.filter((a: any) => !seenAlerts.current.ids.has(a.id));
    fresh.forEach((a: any) => seenAlerts.current.ids.add(a.id));
    if (!fresh.length) return;
    const emergency = fresh.find((a: any) => a.emergency);
    if (emergency) {
      setUrgent(emergency);
      playAlarm();
    } else playChime();
    if (
      'Notification' in window &&
      Notification.permission === 'granted' &&
      document.visibilityState !== 'visible'
    )
      fresh.slice(0, 3).forEach((a: any) => {
        navigator.serviceWorker?.ready
          .then((r) =>
            r.showNotification(a.title, {
              body: a.text,
              tag: a.id,
              icon: '/icon-192.png',
              data: { order: a.order },
            }),
          )
          .catch(() => {});
      });
  }, [alerts.map((a: any) => a.id).join(','), user?.id]);
  // Наряд из истории (его нет в оперативной ленте) загружается по ссылке отдельно.
  useEffect(() => {
    if (!selected || !user || orders.some((o: any) => o.id === selected) || extraOrder?.id === selected)
      return;
    fetch(`${endpoint()}?view=order&id=${encodeURIComponent(selected)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: any) => d?.order && setExtraOrder(d.order))
      .catch(() => {});
  }, [selected, user?.id]);
  // Звук разблокируется первым касанием; переход к наряду из системного уведомления.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'open-order') {
        setSelected(e.data.order);
        setModal('');
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const target = params.get('order');
    if (!target) return;
    setSelected(target);
    params.delete('order');
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (params.toString() ? '?' + params.toString() : ''),
    );
  }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    const own = (data?.alerts || []).filter((a: any) => a.workcard);
    const scope = data.environmentId + ':' + user.id;
    if (workNotices.current.user !== scope) {
      workNotices.current = { user: scope, ids: new Set(own.map((a: any) => a.id)) };
      return;
    }
    const fresh = own.filter((a: any) => !workNotices.current.ids.has(a.id));
    own.forEach((a: any) => workNotices.current.ids.add(a.id));
    if (fresh.length) setToast(fresh[0].title);
  }, [data?.alerts, user?.id]);
  async function resolveLocalPhotos(payload: any) {
    const target = payload.report || payload.data;
    if (!target?.photos) return payload;
    const ids = [];
    for (const id of target.photos) {
      if (!id.startsWith('local:')) {
        ids.push(id);
        continue;
      }
      const asset = await readLocal('drafts', id);
      if (!asset || asset.userId !== user.id || asset.environmentId !== data.environmentId)
        throw Object.assign(new Error('Локальное фото недоступно текущему пользователю'), { server: true });
      if (asset.remote) {
        ids.push(asset.remote);
        continue;
      }
      const form = new FormData();
      form.append('file', asset.blob, 'photo.jpg');
      if (asset.dhash) form.append('dhash', asset.dhash);
      if (asset.takenAt) form.append('takenAt', asset.takenAt);
      const r = await fetch(demo ? '/api/demo-photo' : '/api/photo', { method: 'POST', body: form });
      const result: any = await r.json();
      if (!r.ok) throw Object.assign(new Error(result.error), { server: true });
      asset.remote = result.id;
      await putLocal('drafts', id, asset);
      ids.push(result.id);
    }
    return {
      ...payload,
      ...(payload.report ? { report: { ...target, photos: ids } } : { data: { ...target, photos: ids } }),
    };
  }
  async function action(body: any) {
    if (demo && body.action === 'logout') {
      setModal('demo-role');
      return null;
    }
    setBusy(true);
    setError('');
    const payload = { ...body, requestId: crypto.randomUUID() };
    try {
      const r = await fetch(endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(await resolveLocalPhotos(payload)),
      });
      const d: any = await r.json();
      if (!r.ok) throw Object.assign(new Error(d.error), { server: true });
      if (body.action === 'logout') {
        await removeLocal('drafts', endpoint() + ':snapshot');
        const registration = await navigator.serviceWorker?.ready;
        const sub = await registration?.pushManager?.getSubscription();
        await sub?.unsubscribe();
      }
      await load();
      setToast('Сохранено');
      return d;
    } catch (e: any) {
      if (!e.server && ['transition', 'report'].includes(body.action) && user) {
        try {
          await putLocal('queue', payload.requestId, {
            ...payload,
            api: endpoint(),
            userId: user.id,
            environmentId: data.environmentId,
            createdAt: Date.now(),
          });
          setQueued((q) => q + 1);
          const snapshot = {
            ...data,
            orders: data.orders.map((o: any) =>
              o.id === body.id
                ? {
                    ...o,
                    status: body.action === 'transition' ? body.status : 'review',
                    ...(body.report ? { report: body.report } : {}),
                    pendingSync: true,
                  }
                : o,
            ),
          };
          setData(snapshot);
          await putLocal('drafts', endpoint() + ':snapshot', snapshot);
          setToast('Сохранено на устройстве. Отправим после восстановления связи.');
          setOnline(false);
          return { queued: true };
        } catch {
          setError('Не удалось сохранить действие на устройстве. Скопируйте текст отчёта и повторите.');
        }
      } else setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function syncPending() {
    if (sendingQueue.current || !user) return;
    sendingQueue.current = true;
    try {
      const rows = (await readLocal('queue').catch(() => []))
        .filter(
          (q: any) => q.api === endpoint() && q.userId === user.id && q.environmentId === data.environmentId,
        )
        .sort((a: any, b: any) => a.createdAt - b.createdAt);
      for (const row of rows) {
        const r = await fetch(endpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(await resolveLocalPhotos(row)),
        });
        const result: any = await r.json();
        if (!r.ok) {
          setSyncIssue(result.error + ' Действие сохранено на устройстве.');
          break;
        }
        await removeLocal('queue', row.requestId);
        setQueued((q) => Math.max(0, q - 1));
        setSyncIssue('');
      }
      if (rows.length) await load();
    } catch {
    } finally {
      sendingQueue.current = false;
    }
  }
  useEffect(() => {
    if (online && queued && user) syncPending();
  }, [online, queued, user?.id]);

  useEffect(() => {
    if (!user || demo) return;
    fetch('/api/service', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'push-key' }),
    })
      .then((r) => r.json())
      .then((d: any) => setPushKey(d.publicKey || ''))
      .catch(() => {});
  }, [user?.id, demo]);
  async function enablePush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setToast('Установите приложение на телефон и откройте настройки уведомлений');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setToast('Уведомления не разрешены в настройках браузера');
        return;
      }
      if (demo) {
        setToast('В демо уведомления работают при открытом приложении');
        return;
      }
      if (!pushKey)
        throw new Error('Настройка уведомлений ещё загружается. Повторите через несколько секунд.');
      const registration = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(pushKey.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
        c.charCodeAt(0),
      );
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      const r = await fetch('/api/service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push-subscribe', endpoint: subscription.endpoint }),
      });
      const result: any = await r.json();
      if (!r.ok) throw new Error(result.error);
      setToast('Push подключён для текущего сотрудника');
    } catch (e: any) {
      setError(e.message || 'Не удалось подключить уведомления');
    }
  }
  async function login(e: any) {
    e.preventDefault();
    if (await action({ action: 'login', id: account, pin })) {
      setRole('');
      setPin('');
      setTab('home');
    }
  }
  function open(o: any) {
    setSelected(o.id);
    setModal('');
    setError('');
  }
  const worklogs = data?.worklogs || [];
  function openAlert(a: any) {
    if (a.workcard) {
      setStaff(users.find((w: any) => w.id === a.worker));
      setSelected(null);
      setTab('people');
      setModal('staff');
    } else {
      setSelected(a.order || null);
      setModal('');
    }
  }
  const iconPicker = (
    <label>
      Стиль значков
      <select value={iconStyle} onChange={(e) => setIconStyle(e.target.value)}>
        <option value="standard">Стандартные</option>
        <option value="bold">Контрастные</option>
        <option value="large">Крупные</option>
      </select>
    </label>
  );
  const available = (w: any) => {
    if (w.disabled) return 'Заблокирован';
    if (!w.onShift) return 'Не на смене';
    const personal = currentWork(worklogs, w.id);
    if (personal) return 'Занят · ' + personal.title;
    const jobs = active.filter((o: any) => o.worker === w.id || o.members?.includes(w.id));
    const working = jobs.find((o: any) => o.status === 'working');
    return working ? `Выполняет №${working.number}` : jobs.length ? `В очереди: ${jobs.length}` : 'Свободен';
  };
  // Цвет статуса по ТЗ 5.2: зелёный — свободен, жёлтый — в работе, синий — очередь, серый — не на смене.
  const availabilityKind = (w: any) => {
    if (w.disabled || !w.onShift) return 'off';
    const text = available(w);
    return text === 'Свободен' ? 'free' : text.startsWith('В очереди') ? 'queue' : 'busy';
  };
  const rejectionList = (o: any) =>
    o.rejections ||
    (o.status === 'rejected' && o.rejectionReason
      ? [{ worker: o.worker, reason: o.rejectionReason, at: o.updatedAt || o.created }]
      : []);
  const statusLegend = (
    <div className="status-legend" aria-label="Обозначения статусов">
      <span className="availability free">Свободен</span>
      <span className="availability busy">В работе</span>
      <span className="availability queue">Очередь</span>
      <span className="availability off">Не на смене</span>
    </div>
  );
  const visibility = (
    <div className="visibility">
      <button onClick={() => setA11y(!a11y)} aria-expanded={a11y}>
        <Eye size={21} />
        Настройки видимости
      </button>
      {a11y && (
        <div className="visibility-panel">
          {iconPicker}
          <div className="button-row">
            <button onClick={() => setScale(Math.max(1, scale - 0.15))} aria-label="Уменьшить текст">
              А−
            </button>
            <b>{Math.round(scale * 100)}%</b>
            <button onClick={() => setScale(Math.min(2, scale + 0.15))} aria-label="Увеличить текст">
              А+
            </button>
          </div>
          <button aria-pressed={contrast} onClick={() => setContrast(!contrast)}>
            <Eye size={18} />
            Высокий контраст {contrast ? 'включён' : ''}
          </button>
          <button
            aria-pressed={theme === 'dark'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}{' '}
            {theme === 'dark' ? 'Светлая' : 'Тёмная'} тема
          </button>
        </div>
      )}
    </div>
  );
  function Status({ o }: any) {
    return (
      <span className={'badge ' + (overdue(o) ? 'danger' : o.status === 'closed' ? 'success' : '')}>
        {overdue(o) && <Clock size={13} />}{' '}
        {o.pendingSync ? 'Ожидает отправки · ' : overdue(o) ? 'Просрочен · ' : ''}
        {statuses[o.status]}
      </span>
    );
  }
  function Card({ o }: any) {
    return (
      <button
        className={'order-card ' + (o.priority === 'emergency' ? 'emergency' : '')}
        onClick={() => open(o)}
      >
        <div className="card-top">
          <span className="mono">№{o.number}</span>
          <span className={'priority ' + o.priority}>
            {o.priority === 'emergency' && <TriangleAlert size={14} />} {priorities[o.priority]}
          </span>
        </div>
        <h3>{o.title}</h3>
        <div className="muted small">
          {eqName(o.equipment)} · {areaName(o.area)}
        </div>
        <div className="card-bottom">
          <Status o={o} />
          <span className="small">До {time(o.due)}</span>
        </div>
        <div className="assignee small">{userName(o.worker)}</div>
        {worklogs.flatMap((l: any) =>
          l.entries
            .filter((c: any) => c.order === o.id && c.status === 'active')
            .map((c: any) => (
              <div key={c.id} className="order-progress">
                <small>
                  {userName(c.worker)} · {c.progress}%
                </small>
                <div className="work-meter">
                  <i style={{ width: c.progress + '%' }} />
                </div>
              </div>
            )),
        )}
      </button>
    );
  }

  function PhotoStrip({ ids }: any) {
    return (
      !!ids?.length && (
        <div className="photos">
          {ids.map((id: string) => (
            <Photo key={id} id={id} demo={demo} />
          ))}
        </div>
      )
    );
  }
  const [photos, setPhotos] = useState<string[]>([]),
    [uploading, setUploading] = useState(false),
    [materialRows, setMaterialRows] = useState<any[]>([]),
    [formEq, setFormEq] = useState(''),
    [formArea, setFormArea] = useState(''),
    [assignment, setAssignment] = useState('person');
  useEffect(() => {
    if (modal === 'report' && reportForm.current && order && user)
      putLocal('drafts', data.environmentId + ':' + user.id + ':report:' + order.id, {
        ...Object.fromEntries(new FormData(reportForm.current)),
        photos,
        materials: materialRows,
      }).catch(() => {});
  }, [photos, materialRows]);
  const [createText, setCreateText] = useState(''),
    [createWorker, setCreateWorker] = useState(''),
    [createNorm, setCreateNorm] = useState('90'),
    [quickEmergency, setQuickEmergency] = useState(true),
    [quickPicked, setQuickPicked] = useState(false);
  const canRecommend = user?.role === 'master';
  const analyticsApi = demo ? '/api/demo-analytics' : '/api/analytics';
  // Границы округлены до часа, чтобы запрос не менялся при каждой перерисовке.
  const hourNow = Math.floor(Date.now() / 3600000) * 3600000;
  const monthRatings = useAnalytics(
    analyticsApi,
    { from: new Date(hourNow - 30 * 86400000).toISOString(), to: new Date(hourNow + 3600000).toISOString() },
    !!user && user.role !== 'worker' && (tab === 'people' || modal === 'staff'),
  );
  const ratingOf = (id: string) => monthRatings.data?.ratings?.workers?.find((w: any) => w.id === id);
  const createRec = useRecommendation(
    endpoint(),
    formEq,
    createText,
    canRecommend && modal === 'create' && assignment === 'person',
  );
  const quickRec = useRecommendation(endpoint(), formEq, quickTitle, canRecommend && modal === 'quick');
  const [editWorker, setEditWorker] = useState('');
  const editRec = useRecommendation(
    endpoint(),
    order?.equipment || '',
    order ? `${order.title} ${order.description || ''}` : '',
    canRecommend && modal === 'edit',
  );
  // При переназначении после отказа не предлагаем того, кто отказался.
  const editRanked = editRec.result && {
    ...editRec.result,
    ranked: editRec.result.ranked.filter((w) => order?.status !== 'rejected' || w.id !== order?.worker),
  };
  useEffect(() => {
    if (modal === 'edit' && order) setEditWorker(order.status === 'rejected' ? '' : order.worker);
  }, [modal]);
  useEffect(() => {
    const best = editRanked?.ranked?.[0]?.id;
    if (best && !editWorker) setEditWorker(best);
  }, [editRec.result]);
  useEffect(() => {
    if (modal === 'create') {
      setCreateWorker('');
      setCreateText('');
      setCreateNorm('90');
    }
    if (modal === 'quick') {
      setQuickPicked(false);
      setQuickEmergency(true);
    }
  }, [modal]);
  useEffect(() => {
    const best = createRec.result?.ranked?.[0]?.id;
    if (best && !createWorker) setCreateWorker(best);
  }, [createRec.result]);
  useEffect(() => {
    const best = quickRec.result?.ranked?.[0]?.id;
    if (best && !quickPicked) setQuickWorker(best);
  }, [quickRec.result]);
  async function upload(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    try {
      const ids: string[] = [];
      for (const f of Array.from(files).slice(0, 5 - photos.length)) {
        const takenAt = await readExifDate(f);
        const bitmap = await createImageBitmap(f);
        const hash = dHash(bitmap);
        const c = document.createElement('canvas');
        const factor = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        c.width = bitmap.width * factor;
        c.height = bitmap.height * factor;
        c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
        bitmap.close();
        const blob = await new Promise<Blob>((resolve, reject) =>
          c.toBlob((b) => (b ? resolve(b) : reject(Error('Не удалось обработать фото'))), 'image/jpeg', 0.82),
        );
        const localId = 'local:' + crypto.randomUUID();
        await putLocal('drafts', localId, {
          blob,
          userId: user.id,
          environmentId: data.environmentId,
          createdAt: Date.now(),
          takenAt,
          dhash: hash,
        });
        ids.push(localId);
      }
      setPhotos((p) => [...p, ...ids]);
      setToast('Фото сохранено на устройстве и отправится при сохранении');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }
  const photoInput = (
    <div>
      <label className="upload-button">
        <Camera size={20} />
        {uploading ? 'Загрузка…' : `Добавить фото (${photos.length}/5)`}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={uploading || photos.length >= 5}
          onChange={(e) => upload(e.target.files)}
        />
      </label>
      <PhotoStrip ids={photos} />
      {photos.length > 0 && (
        <button type="button" className="text-button" onClick={() => setPhotos([])}>
          Убрать выбранные фото
        </button>
      )}
    </div>
  );
  async function create(e: any) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const r = await action({
      action: 'create',
      data: { ...f, equipment: formEq, photos, due: new Date(String(f.due)).toISOString() },
    });
    if (r) {
      setModal('');
      setSelected(r.id);
      setPhotos([]);
    }
  }
  async function report(e: any) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (await action({ action: 'report', id: order.id, report: { ...f, photos, materials: materialRows } })) {
      await removeLocal('drafts', data.environmentId + ':' + user.id + ':report:' + order.id).catch(() => {});
      setModal('');
    }
  }
  async function startReport() {
    const draft = await readLocal('drafts', data.environmentId + ':' + user.id + ':report:' + order.id).catch(
      () => null,
    );
    const value = draft || order.report || {};
    setReportDraft(value);
    setPhotos(value.photos || []);
    setMaterialRows(value.materials || []);
    setModal('report');
  }

  if (!data && !error)
    return (
      <main className="entry">
        <div className="entry-shell" role="status">
          <h1>НарядAI</h1>
          <p>Подготавливаем рабочую смену…</p>
        </div>
      </main>
    );
  if (!user)
    return (
      <main className="entry">
        <div className="entry-shell">
          <div className="brand">
            <img
              className="company-emblem"
              src="/company-emblem.png"
              alt="Костанайские Минералы"
              width="1420"
              height="870"
            />
            <span>
              Наряд<span className="accent">AI</span>
            </span>
            <span className="version">ВЕРСИЯ / 03</span>
          </div>
          {role ? (
            <>
              <button className="back" onClick={() => setRole('')}>
                <ChevronLeft size={20} />
                Выбор роли
              </button>
              <h1>{roles[role]}</h1>
              <p className="muted">Вход в смену</p>
              <form onSubmit={login} className="login-form">
                <label>
                  {data?.workspace ? 'Логин' : 'Сотрудник'}
                  {data?.workspace ? (
                    <input
                      required
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      placeholder="Логин от администратора"
                    />
                  ) : (
                    <select required value={account} onChange={(e) => setAccount(e.target.value)}>
                      <option value="">Выберите сотрудника</option>
                      {data?.accounts
                        ?.filter((u: any) => u.role === role)
                        .map((u: any) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </select>
                  )}
                </label>
                <label>
                  {data?.workspace ? 'Пароль' : 'ПИН-код'}
                  <input
                    autoComplete="current-password"
                    inputMode={data?.workspace ? 'text' : 'numeric'}
                    type="password"
                    maxLength={128}
                    required
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                  />
                </label>
                <button className="primary" disabled={busy || !account}>
                  {busy ? 'Вход…' : 'Войти в смену'}
                </button>
              </form>
              {!data?.workspace && (
                <details className="demo-help">
                  <summary>Тестовые учётные записи</summary>
                  <p>
                    Только синтетические данные. Мастера: 4101, 4102. Исполнители: 4201–4215 по порядку
                    списка. Руководитель: 4301. Администратор: 4401.
                  </p>
                </details>
              )}
            </>
          ) : (
            <>
              <div className="entry-title">
                <div className="eyebrow">УПРАВЛЕНИЕ РЕМОНТАМИ</div>
                <h1>Выберите роль</h1>
                <p>Вход в рабочую систему</p>
              </div>
              <div className="roles">
                {Object.entries(roles).map(([key, title]: any) => {
                  const Icon = roleIcons[key];
                  return (
                    <button
                      className={'role-card ' + (roleChoice === key ? 'selected' : '')}
                      aria-pressed={roleChoice === key}
                      key={key}
                      onClick={() => {
                        setRoleChoice(key);
                        setAccount(data?.accounts?.find((u: any) => u.role === key)?.id || '');
                        setError('');
                      }}
                    >
                      <Icon strokeWidth={1.6} />
                      <span>
                        <strong>{title}</strong>
                        <small>{roleDescriptions[key]}</small>
                      </span>
                      <span className="role-index">0{Object.keys(roles).indexOf(key) + 1}</span>
                    </button>
                  );
                })}
              </div>
              <button
                className="primary wide role-continue"
                disabled={!roleChoice}
                onClick={() => setRole(roleChoice)}
              >
                Продолжить{roleChoice ? ` · ${roles[roleChoice]}` : ''}
              </button>
            </>
          )}
          {error && (
            <div role="alert" className="error">
              {error}
              <button onClick={load}>
                <RefreshCw size={16} />
                Повторить
              </button>
            </div>
          )}
          {!role && !data?.workspace && (
            <a className="demo-entry" href="/demo">
              <Play size={20} />
              <span>
                <strong>Посмотреть демо без пароля</strong>
                <small>Все роли · личная тестовая среда</small>
              </span>
            </a>
          )}
          {visibility}
          <footer className="entry-footer">
            <span>КОСТАНАЙСКИЕ МИНЕРАЛЫ</span>
            <span>{data?.workspace ? 'Общая рабочая смена' : 'Демонстрационные данные'}</span>
          </footer>
        </div>
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img
            className="company-emblem"
            src="/company-emblem.png"
            alt="Костанайские Минералы"
            width="1420"
            height="870"
          />
          <span>
            Наряд<span className="accent">AI</span>
          </span>
        </div>
        <div className="eyebrow">РАБОЧАЯ СМЕНА</div>
        <nav>
          {[
            ['home', 'Обзор смены', Factory],
            ['orders', 'Наряды', ClipboardCheck],
            ['people', 'Сотрудники', Users],
            ['reports', 'Отчёты', ChartNoAxesCombined],
            ...(user.role === 'admin' ? [['catalog', 'Справочники', Settings]] : []),
          ].map(([k, title, Icon]: any) => (
            <button
              key={k}
              aria-current={tab === k ? 'page' : undefined}
              className={tab === k ? 'active' : ''}
              onClick={() => {
                setTab(k);
                setSelected(null);
              }}
            >
              <Icon size={21} />
              {title}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="demo-label">{data.workspace ? 'Общая смена' : 'Тестовая среда'}</span>
          <button className="text-button" onClick={() => setModal('password')}>
            Изменить пароль
          </button>
          {visibility}
          <button
            className="text-button"
            onClick={async () => {
              if (await action({ action: 'logout' })) {
                setSelected(null);
                setRole('');
              }
            }}
          >
            <LogOut size={18} />
            Сменить пользователя
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="user-identity">
            <img className="mobile-emblem" src="/company-emblem.png" alt="Костанайские Минералы" />
            <span className="eyebrow">{roles[user.role]}</span>
            <strong>{user.name}</strong>
          </div>
          <div className="top-actions">
            <button
              className="icon-button"
              onClick={() => setModal('install')}
              aria-pressed={modal === 'install'}
              aria-label="Установить на телефон"
            >
              <Smartphone />
            </button>
            <button
              className="icon-button"
              onClick={() => setModal('visibility')}
              aria-pressed={modal === 'visibility'}
              aria-label="Настройки видимости"
            >
              <Eye />
            </button>
            <button
              className="icon-button notification-button"
              onClick={() => setModal('alerts')}
              aria-pressed={modal === 'alerts'}
              aria-label={`Уведомления: ${alerts.length}`}
            >
              <Bell />
              {alerts.length > 0 && <span>{alerts.length}</span>}
            </button>
            <button
              className="avatar"
              aria-label="Сменить пользователя"
              onClick={async () => {
                if (await action({ action: 'logout' })) {
                  setSelected(null);
                  setRole('');
                }
              }}
            >
              {user.name
                .split(' ')
                .map((x: string) => x[0])
                .slice(0, 2)
                .join('')}
            </button>
          </div>
        </header>
        <main className="content">
          {demo && (
            <div className="demo-banner">
              <div>
                <strong>ДЕМОНСТРАЦИОННЫЙ РЕЖИМ</strong>
                <span>Без пароля · ваши действия не меняют рабочую базу</span>
              </div>
              <button className="role-switch" onClick={() => setModal('demo-role')}>
                <Users size={18} />
                Сменить роль
              </button>
            </div>
          )}
          {queued > 0 && (
            <div className="queue-banner" role="status">
              <Clock size={18} />
              <span>
                Ожидают отправки: {queued}. {syncIssue}
              </span>
              <button onClick={syncPending} disabled={!online}>
                Отправить
              </button>
              <button
                onClick={async () => {
                  setQueueItems(
                    (await readLocal('queue')).filter(
                      (q: any) => q.environmentId === data.environmentId && q.userId === user.id,
                    ),
                  );
                  setModal('queue');
                }}
              >
                Посмотреть
              </button>
            </div>
          )}
          {!online && (
            <div className="error">
              <WifiOff />
              Нет связи. Показаны последние сохранённые данные. Статусы, отчёты и выбранные фото сохраняются
              на устройстве до восстановления связи.
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError('')} aria-label="Скрыть ошибку">
                <X size={18} />
              </button>
            </div>
          )}
          {order ? (
            <>
              <button className="back" onClick={() => setSelected(null)}>
                <ChevronLeft size={18} />К списку нарядов
              </button>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">НАРЯД №{order.number}</div>
                  <h1>{order.title}</h1>
                </div>
                <Status o={order} />
              </div>
              <div className="detail-grid">
                <section className="panel">
                  <div className="section-title">
                    <h2>Задание</h2>
                    <span className={'priority ' + order.priority}>{priorities[order.priority]}</span>
                  </div>
                  <p className="description">{order.description}</p>
                  <dl className="facts">
                    <div>
                      <dt>Оборудование</dt>
                      <dd>{eqName(order.equipment)}</dd>
                    </div>
                    <div>
                      <dt>Участок</dt>
                      <dd>{areaName(order.area)}</dd>
                    </div>
                    <div>
                      <dt>Исполнитель</dt>
                      <dd>
                        {order.brigade
                          ? `Бригада ${order.brigade} · ${userName(order.worker)}`
                          : userName(order.worker)}
                      </dd>
                    </div>
                    <div>
                      <dt>Срок</dt>
                      <dd className={overdue(order) ? 'red' : ''}>{fmt(order.due)}</dd>
                    </div>
                    <div>
                      <dt>Норматив / активное время</dt>
                      <dd>
                        {order.norm} / {activeMinutes(order)} мин
                      </dd>
                    </div>
                    <div>
                      <dt>Тип работ</dt>
                      <dd>{order.type === 'planned' ? 'Плановые' : 'Внеплановые'}</dd>
                    </div>
                  </dl>
                  {order.downtimeStarted && (
                    <p className="muted">
                      <Clock size={16} /> Простой оборудования: {equipmentDowntime(order)} мин{' '}
                      {order.downtimeEnded ? '(завершён)' : '(продолжается)'}
                    </p>
                  )}
                  <PhotoStrip ids={order.photos} />
                  {worklogs.flatMap((l: any) =>
                    l.entries
                      .filter((c: any) => c.order === order.id && c.status === 'active')
                      .map((c: any) => (
                        <div className="linked-work" key={c.id}>
                          <h3>{userName(c.worker)}</h3>
                          <WorkSummary card={c} serverTime={online ? data.serverTime : undefined} />
                          <button
                            onClick={() => {
                              setStaff(users.find((w: any) => w.id === c.worker));
                              setModal('staff');
                            }}
                          >
                            Прогресс и карточка сотрудника
                          </button>
                        </div>
                      )),
                  )}
                  {user.role === 'worker' && !closed(order) && (
                    <div className="actions">
                      {['issued', 'queued'].includes(order.status) && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => action({ action: 'transition', id: order.id, status: 'accepted' })}
                        >
                          <Check />
                          Принять наряд
                        </button>
                      )}
                      {['accepted', 'queued', 'paused', 'rework'].includes(order.status) && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => action({ action: 'transition', id: order.id, status: 'working' })}
                        >
                          <Play />
                          Начать исполнение
                        </button>
                      )}
                      {['issued', 'accepted'].includes(order.status) && (
                        <button
                          onClick={() => action({ action: 'transition', id: order.id, status: 'queued' })}
                          disabled={busy}
                        >
                          <Clock />
                          Поставить в очередь
                        </button>
                      )}
                      {['issued', 'accepted', 'queued'].includes(order.status) && (
                        <button onClick={() => setModal('reject')}>Отклонить с причиной</button>
                      )}
                      {order.status === 'working' && (
                        <button onClick={() => setModal('pause')}>
                          <Pause />
                          Приостановить
                        </button>
                      )}
                      {['working', 'paused', 'rework'].includes(order.status) && (
                        <button className="primary" onClick={startReport}>
                          <CheckCheck />
                          Исполнено — заполнить отчёт
                        </button>
                      )}
                    </div>
                  )}
                  {user.role === 'master' && !closed(order) && (
                    <div className="actions">
                      {['review', 'rework'].includes(order.status) && (
                        <button className="primary" onClick={() => setModal('decision')}>
                          <ShieldCheck />
                          Проверить и принять
                        </button>
                      )}
                      <button onClick={() => setModal('edit')}>
                        <Settings size={18} />
                        Изменить назначение
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          action({
                            action: 'downtime',
                            id: order.id,
                            stopped: !order.downtimeStarted || !!order.downtimeEnded,
                          })
                        }
                      >
                        <Factory size={18} />
                        {order.downtimeStarted && !order.downtimeEnded
                          ? 'Оборудование восстановлено'
                          : 'Зафиксировать остановку'}
                      </button>
                    </div>
                  )}
                  {user.role === 'master' && order.status === 'rejected' && (
                    <div className="actions">
                      <button className="primary" onClick={() => setModal('edit')}>
                        <Users size={18} />
                        Переназначить другому исполнителю
                      </button>
                    </div>
                  )}
                  {rejectionList(order).length > 0 && (
                    <div className="rejections">
                      <h3>Отказы от наряда</h3>
                      {rejectionList(order).map((r: any, i: number) => (
                        <div key={i} className="rejection">
                          <p>
                            <b>{userName(r.worker)}</b> · {fmt(r.at)}: «{r.reason}»
                          </p>
                          {r.unjustified !== undefined && (
                            <span className={'badge ' + (r.unjustified ? 'danger' : 'success')}>
                              {r.unjustified ? 'Без уважительной причины' : 'Уважительная причина'}
                            </span>
                          )}
                          {user.role === 'master' && (
                            <div className="button-row">
                              <button
                                aria-pressed={r.unjustified === false}
                                disabled={busy}
                                onClick={() =>
                                  action({
                                    action: 'rejection-verdict',
                                    id: order.id,
                                    index: i,
                                    unjustified: false,
                                  })
                                }
                              >
                                Уважительная
                              </button>
                              <button
                                aria-pressed={r.unjustified === true}
                                disabled={busy}
                                onClick={() =>
                                  action({
                                    action: 'rejection-verdict',
                                    id: order.id,
                                    index: i,
                                    unjustified: true,
                                  })
                                }
                              >
                                Без уважительной причины
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      <p className="muted small">
                        Отказ без уважительной причины снижает рейтинг на 2 балла.
                      </p>
                    </div>
                  )}
                </section>
                <section className="panel">
                  <h2>Хронология</h2>
                  <div className="timeline">
                    {order.history.map((h: any, i: number) => (
                      <div key={i}>
                        <span className="timeline-dot" />
                        <small>
                          {fmt(h.at)} · {userName(h.actor)}
                        </small>
                        <p>{h.text}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              {order.report && (
                <OrderReport
                  order={order}
                  role={user.role}
                  codeName={(id) => data.codes?.find((c: any) => c.id === id)?.name || ''}
                  photos={(ids) => <PhotoStrip ids={ids} />}
                />
              )}
            </>
          ) : tab === 'home' ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {new Date().toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}{' '}
                    · ДАННЫЕ ОБНОВЛЯЮТСЯ
                  </div>
                  <h1>{user.role === 'worker' ? 'Мои задания' : 'Обзор смены'}</h1>
                  <p className="muted">
                    {user.role === 'worker'
                      ? 'Очередь работ и контроль сроков'
                      : 'Люди, оборудование и ремонтные работы'}
                  </p>
                </div>
                {user.role === 'master' && (
                  <button
                    className="primary"
                    onClick={() => {
                      setPhotos([]);
                      setFormArea('');
                      setFormEq('');
                      setQuick(false);
                      setModal('create');
                    }}
                  >
                    <Plus />
                    Выдать наряд
                  </button>
                )}
                {user.role === 'master' && (
                  <button
                    onClick={() => {
                      setFormEq(data.equipment[0]?.id || '');
                      setQuickWorker(
                        workers.find((w: any) => w.onShift && available(w) === 'Свободен')?.id ||
                          workers.find((w: any) => w.onShift)?.id ||
                          '',
                      );
                      setPhotos([]);
                      setQuick(true);
                      setModal('quick');
                    }}
                  >
                    <Play size={20} />
                    Быстрый наряд
                  </button>
                )}
              </div>
              {['master', 'admin'].includes(user.role) && (
                <div className="shift-heading">
                  <Clock size={16} /> {shift.name}
                </div>
              )}
              {user.role === 'manager' ? null : user.role !== 'worker' ? (
                <div className="metrics shift-metrics">
                  <button
                    onClick={() => {
                      setFilter('all');
                      setTab('orders');
                    }}
                  >
                    <span>Выдано за смену</span>
                    <strong>{String(shiftStats.issued).padStart(2, '0')}</strong>
                    <small>
                      <ClipboardCheck size={15} />В работе и очереди: {active.length}
                    </small>
                  </button>
                  <button
                    onClick={() => {
                      setFilter('closed');
                      setTab('orders');
                    }}
                  >
                    <span>Выполнено</span>
                    <strong>{String(shiftStats.done).padStart(2, '0')}</strong>
                    <small>
                      <CheckCheck size={15} />
                      Принято мастером
                    </small>
                  </button>
                  <button
                    className="metric-danger"
                    onClick={() => {
                      setFilter('late');
                      setTab('orders');
                    }}
                  >
                    <span>Просрочено</span>
                    <strong>{String(shiftStats.late).padStart(2, '0')}</strong>
                    <small>
                      <Clock size={15} />
                      Отклонено за смену: {shiftStats.rejected}
                    </small>
                  </button>
                  <button
                    onClick={() => {
                      setFilter('active');
                      setTab('orders');
                    }}
                  >
                    <span>Оборудование в простое</span>
                    <strong>{String(shiftStats.downtime).padStart(2, '0')}</strong>
                    <small>
                      <Factory size={15} />
                      Остановлено сейчас
                    </small>
                  </button>
                  <button onClick={() => setTab('people')}>
                    <span>Свободны</span>
                    <strong>{workers.filter((w: any) => availabilityKind(w) === 'free').length}</strong>
                    <small>
                      <Users size={15} />
                      Готовы к назначению
                    </small>
                  </button>
                </div>
              ) : (
                <div className="metrics">
                  <button
                    onClick={() => {
                      setFilter('active');
                      setTab('orders');
                    }}
                  >
                    <span>В работе и очереди</span>
                    <strong>{active.length.toString().padStart(2, '0')}</strong>
                    <small>
                      <ClipboardCheck size={15} />
                      Текущие наряды
                    </small>
                  </button>
                  <button
                    className="metric-danger"
                    onClick={() => {
                      setFilter('late');
                      setTab('orders');
                    }}
                  >
                    <span>Просрочено</span>
                    <strong>{late.length.toString().padStart(2, '0')}</strong>
                    <small>
                      <Clock size={15} />
                      Требуют внимания
                    </small>
                  </button>
                  <button onClick={() => setTab('people')}>
                    <span>{user.role === 'worker' ? 'Выполнено сегодня' : 'Свободных сотрудников'}</span>
                    <strong>
                      {user.role === 'worker'
                        ? orders.filter(
                            (o: any) =>
                              o.status === 'closed' &&
                              new Date(o.closedAt).toDateString() === new Date().toDateString(),
                          ).length
                        : workers.filter((w: any) => available(w) === 'Свободен').length}
                    </strong>
                    <small>
                      <Users size={15} />
                      {user.role === 'worker' ? 'Принято мастером' : 'Готовы к назначению'}
                    </small>
                  </button>
                </div>
              )}
              {user.role === 'manager' && (
                <ManagerDashboard
                  api={analyticsApi}
                  live={{ active: active.length, late: late.length, downtime: shiftStats.downtime }}
                  onOpenReports={() => setTab('reports')}
                />
              )}
              {user.role === 'worker' && (
                <section className="panel">
                  <WorkProfile
                    worker={user}
                    user={user}
                    logs={worklogs}
                    orders={orders}
                    serverTime={online ? data.serverTime : undefined}
                    onAction={action}
                    disabled={busy || !online}
                  />
                </section>
              )}
              {user.role === 'worker' && <MyRating api={analyticsApi} />}
              <div className="dashboard-grid">
                <section>
                  <div className="section-title">
                    <h2>
                      Требуют внимания <span className="count">{active.length}</span>
                    </h2>
                    <button className="text-button" onClick={() => setTab('orders')}>
                      Все наряды
                    </button>
                  </div>
                  <div className="cards">
                    {[...active]
                      .sort((a: any, b: any) => Date.parse(a.due) - Date.parse(b.due))
                      .slice(0, 6)
                      .map((o: any) => (
                        <Card key={o.id} o={o} />
                      ))}
                  </div>
                  {!active.length && (
                    <div className="empty">
                      <CheckCheck />
                      Все работы завершены
                    </div>
                  )}
                </section>
                <section className="panel staff-panel">
                  <div className="section-title">
                    <h2>{user.role === 'worker' ? 'Контроль сроков' : 'На смене'}</h2>
                    <span className="live-dot" />
                  </div>
                  {user.role !== 'worker' && statusLegend}
                  {user.role === 'worker' ? (
                    alerts.length ? (
                      alerts.map((a: any) => (
                        <button className="alert-item" key={a.id} onClick={() => openAlert(a)}>
                          <Clock />
                          <span>
                            <strong>{a.title}</strong>
                            <small>{a.text}</small>
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="muted">Ближайших предупреждений нет.</p>
                    )
                  ) : (
                    workers
                      .filter((w: any) => w.onShift)
                      .slice(0, 6)
                      .map((w: any) => (
                        <div className="staff-row" key={w.id}>
                          <div className="staff-icon">
                            <Wrench size={18} />
                          </div>
                          <div>
                            <strong>{w.name}</strong>
                            <small>
                              {w.spec} · Бригада {w.brigade}
                            </small>
                            <span className={'availability ' + availabilityKind(w)}>{available(w)}</span>
                            <WorkSummary
                              card={currentWork(worklogs, w.id)}
                              serverTime={online ? data.serverTime : undefined}
                            />
                            <button
                              className="text-button"
                              onClick={() => {
                                setStaff(w);
                                setModal('staff');
                              }}
                            >
                              Карточка и история
                            </button>
                          </div>
                        </div>
                      ))
                  )}
                  <button className="wide" onClick={() => setTab('people')}>
                    Сотрудники смены
                  </button>
                </section>
              </div>
              <div className="system-note">
                <ShieldCheck />
                <div>
                  <strong>
                    {data.workspace ? 'Единая смена на всех устройствах' : 'Демонстрационная среда'}
                  </strong>
                  <p>
                    {data.workspace
                      ? 'Мастер видит изменения всех исполнителей. Фото и отчёты сохраняются в общей базе. Итог ремонта подтверждает мастер.'
                      : 'Тестовые данные. Итог ремонта подтверждает мастер.'}
                  </p>
                </div>
              </div>
              <button className="install-card" onClick={() => setModal('install')}>
                <Smartphone />
                <span>
                  <strong>Установить на телефон</strong>
                  <small>Запуск с главного экрана</small>
                </span>
              </button>
            </>
          ) : tab === 'orders' ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">ЖУРНАЛ РАБОТ</div>
                  <h1>Наряды</h1>
                </div>
                {user.role === 'master' && (
                  <button
                    className="primary"
                    onClick={() => {
                      setPhotos([]);
                      setFormArea('');
                      setFormEq('');
                      setQuick(false);
                      setModal('create');
                    }}
                  >
                    <Plus />
                    Выдать наряд
                  </button>
                )}
                {user.role === 'master' && (
                  <button
                    onClick={() => {
                      setFormEq(data.equipment[0]?.id || '');
                      setQuickWorker(
                        workers.find((w: any) => w.onShift && available(w) === 'Свободен')?.id ||
                          workers.find((w: any) => w.onShift)?.id ||
                          '',
                      );
                      setPhotos([]);
                      setQuick(true);
                      setModal('quick');
                    }}
                  >
                    <Play size={20} />
                    Быстрый наряд
                  </button>
                )}
              </div>
              <div className="filters">
                <div className="search">
                  <Search size={19} />
                  <input
                    placeholder="Номер, задание или оборудование"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select aria-label="Участок" value={area} onChange={(e) => setArea(e.target.value)}>
                  <option value="">Все участки</option>
                  {data.areas.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Исполнитель"
                  value={workerFilter}
                  onChange={(e) => setWorkerFilter(e.target.value)}
                >
                  <option value="">Все исполнители</option>
                  {workers.map((w: any) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Оборудование"
                  value={equipmentFilter}
                  onChange={(e) => setEquipmentFilter(e.target.value)}
                >
                  <option value="">Всё оборудование</option>
                  {data.equipment
                    .filter((eq: any) => !area || eq.area === area)
                    .map((eq: any) => (
                      <option key={eq.id} value={eq.id}>
                        {eq.name}
                      </option>
                    ))}
                </select>
                <select aria-label="Приоритет" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="">Все приоритеты</option>
                  {Object.entries(priorities).map(([k, v]: any) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="button-row">
                <button aria-pressed={board} onClick={() => setBoard(!board)}>
                  <SlidersHorizontal size={18} />
                  {board ? 'Показать список' : 'Доска по статусам'}
                </button>
              </div>
              <div className="tabs">
                {[
                  ['active', 'Активные'],
                  ['late', 'Просроченные'],
                  ['review', 'На проверке'],
                  ['closed', 'Закрытые'],
                  ['all', 'Все'],
                ].map(([k, t]) => (
                  <button
                    key={k}
                    aria-pressed={filter === k}
                    className={filter === k ? 'selected' : ''}
                    onClick={() => setFilter(k)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className={board ? 'kanban' : 'cards orders-grid'}>
                {board
                  ? boardColumns.map(([key, label]) => {
                      const items = orders.filter(
                        (o: any) =>
                          boardColumn(o) === key &&
                          (!area || o.area === area) &&
                          (!workerFilter || o.worker === workerFilter || o.members?.includes(workerFilter)) &&
                          (!equipmentFilter || o.equipment === equipmentFilter) &&
                          (!priority || o.priority === priority) &&
                          `${o.number} ${o.title} ${eqName(o.equipment)}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      );
                      return (
                        <section className={'kanban-column column-' + key} key={key}>
                          <h2>
                            {label} <span className="count">{items.length}</span>
                          </h2>
                          {items
                            .sort((a: any, b: any) => Date.parse(a.due) - Date.parse(b.due))
                            .map((o: any) => (
                              <Card key={o.id} o={o} />
                            ))}
                        </section>
                      );
                    })
                  : orders
                      .filter(
                        (o: any) =>
                          (filter === 'all' ||
                            (filter === 'active' && !closed(o)) ||
                            (filter === 'late' && overdue(o)) ||
                            o.status === filter) &&
                          (!area || o.area === area) &&
                          (!workerFilter || o.worker === workerFilter || o.members?.includes(workerFilter)) &&
                          (!equipmentFilter || o.equipment === equipmentFilter) &&
                          (!priority || o.priority === priority) &&
                          `${o.number} ${o.title} ${eqName(o.equipment)}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .sort((a: any, b: any) => Date.parse(b.created) - Date.parse(a.created))
                      .map((o: any) => <Card key={o.id} o={o} />)}
              </div>
            </>
          ) : tab === 'people' ? (
            <>
              <div className="page-heading">
                <div className="eyebrow">ЗАГРУЗКА И ДОСТУПНОСТЬ</div>
                <h1>Сотрудники</h1>
                {statusLegend}
                {user.role === 'admin' && (
                  <button className="primary" onClick={() => setModal('user-create')}>
                    <Plus />
                    Добавить сотрудника
                  </button>
                )}
              </div>
              <div className="people-grid">
                {workers.map((w: any) => (
                  <section className="panel" key={w.id}>
                    <div className="section-title">
                      <div className="staff-icon">
                        <Wrench />
                      </div>
                      <span className={'availability ' + availabilityKind(w)}>{available(w)}</span>
                    </div>
                    <h2>{w.name}</h2>
                    <p className="muted">
                      {w.spec}
                      {w.grade ? ` · ${w.grade} разряд` : ''} · Бригада {w.brigade}
                    </p>
                    <div className="facts">
                      <div>
                        <dt>Текущих нарядов</dt>
                        <dd>
                          {active.filter((o: any) => o.worker === w.id || o.members?.includes(w.id)).length}
                        </dd>
                      </div>
                      <div>
                        <dt>Рейтинг</dt>
                        <dd>{ratingOf(w.id) ? `${ratingOf(w.id).score}/100` : '—'}</dd>
                      </div>
                    </div>
                    <WorkSummary
                      card={currentWork(worklogs, w.id)}
                      serverTime={online ? data.serverTime : undefined}
                    />
                    <p className="work-card-rating">
                      Оценка карточек: <b>{workRating(worklogs, w.id).score || '—'}/5</b> · Завершено:{' '}
                      {workRating(worklogs, w.id).done}
                    </p>
                    <p className="small muted">
                      {w.lastSeen ? `Был в приложении: ${fmt(w.lastSeen)}` : 'Ещё не входил'}
                    </p>
                    <button
                      className="wide"
                      onClick={() => {
                        setStaff(w);
                        setModal('staff');
                      }}
                    >
                      Карточка сотрудника
                    </button>
                    {['master', 'admin'].includes(user.role) && (
                      <button
                        className="wide"
                        onClick={() => action({ action: 'shift', id: w.id, onShift: !w.onShift })}
                      >
                        {w.onShift ? 'Завершить смену' : 'На смену'}
                      </button>
                    )}
                    {user.role === 'admin' && (
                      <button
                        className="wide"
                        onClick={() => {
                          setStaff(w);
                          setModal('user-edit');
                        }}
                      >
                        Управление доступом
                      </button>
                    )}
                  </section>
                ))}
              </div>
            </>
          ) : tab === 'reports' ? (
            <ReportsPage api={analyticsApi} data={data} workers={workers} />
          ) : tab === 'catalog' ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">АДМИНИСТРИРОВАНИЕ</div>
                  <h1>Справочники</h1>
                </div>
              </div>
              {user.role === 'admin' && (
                <SettingsPanel settings={data.settings} busy={busy} onAction={action} />
              )}
              {user.role === 'admin' && <HistoryPanel status={data.history} busy={busy} onAction={action} />}
              {user.role === 'admin' && (
                <section className="panel">
                  <div className="section-title">
                    <h2>Учётные записи</h2>
                    <button onClick={() => setModal('user-create')}>
                      <Plus />
                      Добавить
                    </button>
                  </div>
                  {users.map((u: any) => (
                    <button
                      className="alert-item"
                      key={u.id}
                      onClick={() => {
                        setStaff(u);
                        setModal('user-edit');
                      }}
                    >
                      <Users />
                      <span>
                        <strong>{u.name}</strong>
                        <small>
                          {roles[u.role]} · {u.id}
                          {u.disabled ? ' · заблокирован' : ''}
                        </small>
                      </span>
                    </button>
                  ))}
                </section>
              )}
              {[
                ['areas', 'Участки'],
                ['equipment', 'Оборудование'],
                ['codes', 'Шифры неисправностей'],
                ['materials', 'Материалы'],
              ].map(([kind, title]) => (
                <section className="panel" key={kind}>
                  <div className="section-title">
                    <h2>
                      {title} <span className="count">{data[kind].length}</span>
                    </h2>
                    <button onClick={() => setModal('catalog:' + kind)}>
                      <Plus size={18} />
                      Добавить
                    </button>
                  </div>
                  <div className="catalog-list">
                    {data[kind].map((x: any) => (
                      <button
                        className="catalog-item"
                        key={x.id}
                        onClick={() => {
                          setRecordEdit({ ...x, kind });
                          setModal('catalog-edit');
                        }}
                      >
                        <strong>
                          {kind === 'codes' ? x.id + ' · ' : ''}
                          {x.name}
                        </strong>
                        <span className="muted">
                          {x.unit || x.inventory || ''}
                          {x.norm ? ' · ориентир ' + x.norm : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </>
          ) : null}
        </main>
        <nav className="bottom-nav">
          {[
            ['home', 'Смена', Factory],
            ['orders', 'Наряды', ClipboardCheck],
            ['people', 'Люди', Users],
            ['reports', 'Отчёты', ChartNoAxesCombined],
            ...(user.role === 'admin' ? [['catalog', 'Данные', Settings]] : []),
          ].map(([k, title, Icon]: any) => (
            <button
              key={k}
              aria-current={tab === k ? 'page' : undefined}
              className={tab === k ? 'active' : ''}
              onClick={() => {
                setTab(k);
                setSelected(null);
              }}
            >
              <Icon size={22} />
              <span>{title}</span>
            </button>
          ))}
        </nav>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {urgent && (
        <UrgentBanner
          title={urgent.title}
          text={urgent.text}
          busy={busy}
          canAccept={
            user.role === 'worker' && orders.find((o: any) => o.id === urgent.order)?.status === 'issued'
          }
          onAccept={async () => {
            const id = urgent.order;
            if (await action({ action: 'transition', id, status: 'accepted' })) {
              setUrgent(null);
              setSelected(id);
            }
          }}
          onOpen={() => {
            setSelected(urgent.order || null);
            setModal('');
            setUrgent(null);
          }}
          onClose={() => setUrgent(null)}
        />
      )}

      {modal === 'catalog-edit' && recordEdit && (
        <Modal title="Изменить запись справочника" onClose={() => setModal('')}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action({
                  action: 'catalog-edit',
                  kind: recordEdit.kind,
                  id: recordEdit.id,
                  data: Object.fromEntries(new FormData(e.currentTarget)),
                })
              )
                setModal('');
            }}
          >
            <label>
              Название
              <input name="name" required defaultValue={recordEdit.name} />
            </label>
            {recordEdit.kind === 'equipment' && (
              <>
                <label>
                  Участок
                  <select name="area" defaultValue={recordEdit.area}>
                    {data.areas.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Инвентарный номер
                  <input name="inventory" defaultValue={recordEdit.inventory} />
                </label>
              </>
            )}
            {recordEdit.kind === 'materials' && (
              <label>
                Единица измерения
                <input name="unit" defaultValue={recordEdit.unit} />
              </label>
            )}
            {['codes', 'materials'].includes(recordEdit.kind) && (
              <label>
                Справочный норматив
                <input name="norm" type="number" min="1" defaultValue={recordEdit.norm} />
              </label>
            )}
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy}>
              Сохранить
            </button>
          </form>
        </Modal>
      )}
      {modal === 'password' && (
        <Modal title="Изменить пароль" onClose={() => setModal('')}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              if (await action({ action: 'password-change', ...f })) {
                setModal('');
                setRole('');
                setSelected(null);
                setToast('Пароль изменён. Войдите снова.');
              }
            }}
          >
            <label>
              Текущий пароль
              <input name="oldPassword" type="password" autoComplete="current-password" required />
            </label>
            <label>
              Новый пароль
              <input
                name="password"
                type="password"
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy}>
              Сохранить и выйти
            </button>
          </form>
        </Modal>
      )}
      {modal === 'staff' && staff && (
        <Modal title={staff.name} onClose={() => setModal('')}>
          <p>
            {staff.spec} · Бригада {staff.brigade}
          </p>
          <p className="muted">
            {staff.lastSeen ? `Последняя активность: ${fmt(staff.lastSeen)}` : 'Входов пока нет'}. Это
            активность в приложении, а не местоположение.
          </p>
          <WorkProfile
            key={staff.id}
            worker={users.find((w: any) => w.id === staff.id) || staff}
            user={user}
            logs={worklogs}
            orders={orders}
            serverTime={online ? data.serverTime : undefined}
            onAction={action}
            disabled={busy || !online}
          />
          <h3>Текущие задания</h3>
          <div className="cards">
            {active
              .filter((o: any) => o.worker === staff.id || o.members?.includes(staff.id))
              .map((o: any) => (
                <Card key={o.id} o={o} />
              ))}
          </div>
          {!active.some((o: any) => o.worker === staff.id || o.members?.includes(staff.id)) && (
            <p>Текущих заданий нет.</p>
          )}
          <p>
            Закрыто:{' '}
            {
              orders.filter(
                (o: any) => o.status === 'closed' && (o.worker === staff.id || o.members?.includes(staff.id)),
              ).length
            }{' '}
            · Рейтинг за 30 дней: {ratingOf(staff.id) ? `${ratingOf(staff.id).score}/100` : '—'}
          </p>
          <h3>Выполненные наряды</h3>
          <div className="cards">
            {orders
              .filter(
                (o: any) => o.status === 'closed' && (o.worker === staff.id || o.members?.includes(staff.id)),
              )
              .sort((a: any, b: any) => Date.parse(b.closedAt) - Date.parse(a.closedAt))
              .map((o: any) => (
                <Card key={o.id} o={o} />
              ))}
          </div>
        </Modal>
      )}
      {modal === 'user-create' && (
        <Modal title="Новая учётная запись" onClose={() => setModal('')}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action({
                  action: 'user-create',
                  data: Object.fromEntries(new FormData(e.currentTarget)),
                })
              )
                setModal('');
            }}
          >
            <label>
              Имя сотрудника
              <input name="name" required maxLength={100} />
            </label>
            <label>
              Логин
              <input
                name="login"
                required
                pattern="[a-z0-9._-]{3,40}"
                autoCapitalize="none"
                autoComplete="off"
                placeholder="ivan.petrov"
              />
            </label>
            <label>
              Начальный пароль
              <input name="password" type="text" required minLength={8} maxLength={128} autoComplete="off" />
            </label>
            <p className="small muted">
              Передайте пароль сотруднику лично. Он сможет изменить его после входа.
            </p>
            <label>
              Роль
              <select name="role" defaultValue="worker">
                {Object.entries(roles).map(([k, v]: any) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Специальность
              <input name="spec" />
            </label>
            <label>
              Разряд
              <input name="grade" type="number" min="1" max="6" defaultValue="4" />
            </label>
            <label>
              Бригада
              <input name="brigade" type="number" min="1" max="99" defaultValue="1" />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy}>
              Создать
            </button>
          </form>
        </Modal>
      )}
      {modal === 'user-edit' && staff && (
        <Modal title={staff.name} onClose={() => setModal('')}>
          <p>
            Логин: <strong>{staff.id}</strong> · {roles[staff.role]}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              if (await action({ action: 'user-update', id: staff.id, ...f })) setModal('');
            }}
          >
            <label>
              Специальность
              <input name="spec" defaultValue={staff.spec} />
            </label>
            <label>
              Бригада
              <input name="brigade" type="number" min="1" max="99" defaultValue={staff.brigade || 1} />
            </label>
            <label>
              Новый пароль — только для сброса
              <input
                name="password"
                type="text"
                minLength={8}
                autoComplete="off"
                placeholder="Оставьте пустым, чтобы сохранить текущий"
              />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy}>
              Сохранить
            </button>
            <button
              type="button"
              disabled={busy || staff.id === user.id}
              onClick={async () => {
                if (await action({ action: 'user-update', id: staff.id, disabled: !staff.disabled }))
                  setModal('');
              }}
            >
              {staff.disabled ? 'Разблокировать' : 'Заблокировать вход'}
            </button>
          </form>
        </Modal>
      )}
      {modal === 'queue' && (
        <Modal title="Ожидают отправки" onClose={() => setModal('')}>
          <p className="muted">
            При ошибке проверьте текущий статус наряда. Текст отчёта можно скопировать перед удалением
            действия из очереди.
          </p>
          {queueItems.map((item: any) => (
            <section className="panel" key={item.requestId}>
              <h3>{item.action === 'report' ? 'Отчёт о выполнении' : 'Изменение статуса'}</h3>
              <p>{item.report?.works || statuses[item.status]}</p>
              <div className="button-row">
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(JSON.stringify(item, null, 2));
                      setToast('Скопировано');
                    } catch {
                      setError('Браузер не разрешил копирование');
                    }
                  }}
                >
                  Скопировать
                </button>
                <button
                  onClick={async () => {
                    if (!window.confirm('Удалить это неотправленное действие?')) return;
                    await removeLocal('queue', item.requestId);
                    setQueueItems((items) => items.filter((x) => x.requestId !== item.requestId));
                    await load();
                  }}
                >
                  Удалить из очереди
                </button>
              </div>
            </section>
          ))}
          {!queueItems.length && <p>Очередь пуста.</p>}
        </Modal>
      )}
      {modal === 'install' && (
        <Modal title="Приложение на телефоне" onClose={() => setModal('')}>
          <div className="install-brand">
            <img src="/company-emblem.png" alt="Костанайские Минералы" />
            <h3>НарядAI</h3>
          </div>
          <p>Установите приложение на главный экран — оно будет открываться в отдельном окне.</p>
          {install ? (
            <button
              className="primary wide"
              onClick={async () => {
                await install.prompt();
                const result = await install.userChoice;
                if (result.outcome === 'accepted') {
                  setToast('Приложение установлено');
                  setModal('');
                }
                setInstall(null);
              }}
            >
              <Smartphone />
              Установить приложение
            </button>
          ) : (
            <>
              <h3>Android</h3>
              <p>
                Откройте ссылку в Chrome. В меню ⋮ выберите «Установить приложение» или «Добавить на главный
                экран».
              </p>
              <h3>iPhone</h3>
              <p>Откройте ссылку в Safari → «Поделиться» → «На экран Домой».</p>
            </>
          )}
          <p className="muted">
            Если приложение уже установлено, запускайте его значком на главном экране. Для первого входа нужен
            интернет.
          </p>
        </Modal>
      )}
      {modal === 'quick' && (
        <Modal title="Быстрый наряд" onClose={() => setModal('')}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await action({
                action: 'create',
                data: {
                  title: quickTitle,
                  description: quickTitle,
                  equipment: formEq,
                  worker: quickWorker,
                  priority: quickEmergency ? 'emergency' : 'high',
                  type: 'unplanned',
                  norm: quickRec.result?.code?.norm || 60,
                  due: new Date(Date.now() + 3600000).toISOString(),
                  photos,
                  suggestedCode: quickRec.result?.code?.id,
                  recommendedWorker: quickRec.result?.ranked?.[0]?.id,
                },
              });
              if (r) {
                setModal('');
                setSelected(r.id);
              }
            }}
          >
            <p className="muted">
              Внеплановый ремонт · срок через 1 час. Исполнитель подобран автоматически — проверьте перед
              выдачей.
            </p>
            <button
              type="button"
              className={'emergency-toggle ' + (quickEmergency ? 'on' : '')}
              aria-pressed={quickEmergency}
              onClick={() => setQuickEmergency(!quickEmergency)}
            >
              <TriangleAlert size={20} />
              {quickEmergency ? 'Аварийный — срочно в работу' : 'Высокий приоритет'}
            </button>
            <label>
              Задание
              <input
                required
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                maxLength={180}
              />
            </label>
            <label>
              Оборудование
              <select value={formEq} onChange={(e) => setFormEq(e.target.value)}>
                {data.equipment.map((eq: any) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.name} · {areaName(eq.area)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Исполнитель
              <select
                value={quickWorker}
                onChange={(e) => {
                  setQuickPicked(true);
                  setQuickWorker(e.target.value);
                }}
              >
                {workers
                  .filter((w: any) => w.onShift && !w.disabled)
                  .map((w: any) => (
                    <option key={w.id} value={w.id}>
                      {w.name} · {available(w)}
                    </option>
                  ))}
              </select>
            </label>
            <AssigneeHint
              result={quickRec.result}
              loading={quickRec.loading}
              selected={quickWorker}
              onPick={(id) => {
                setQuickPicked(true);
                setQuickWorker(id);
              }}
            />
            <CodeHint result={quickRec.result} onApplyNorm={() => {}} />
            {photoInput}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy || uploading || !quickWorker}>
              Выдать наряд
            </button>
            <button
              type="button"
              onClick={() => {
                setQuick(false);
                setModal('create');
              }}
            >
              Все поля и настройки
            </button>
          </form>
        </Modal>
      )}
      {modal === 'demo-role' && (
        <Modal onClose={() => setModal('')} title="Посмотреть другую роль">
          <p className="muted">Все изменения остаются в вашей тестовой среде. Пароль не нужен.</p>
          <p className="small">
            Порядок проверки: мастер выдаёт наряд → исполнитель принимает и отправляет отчёт → мастер
            принимает ремонт → руководитель смотрит итоги.
          </p>
          <div className="demo-roles">
            {Object.entries(roles).map(([r, title]: any) => {
              const Icon = roleIcons[r];
              const id =
                r === 'master'
                  ? 'master'
                  : r === 'worker'
                    ? 'worker1'
                    : r === 'manager'
                      ? 'manager'
                      : 'admin';
              return (
                <button
                  aria-pressed={(roleChoice || user.role) === r}
                  className={(roleChoice || user.role) === r ? 'selected' : ''}
                  key={r}
                  onClick={async () => {
                    setRoleChoice(r);
                    if (await action({ action: 'demo-role', id })) {
                      setModal('');
                      setTab('home');
                      setSelected(null);
                    }
                  }}
                >
                  <Icon />
                  <span>{title}</span>
                </button>
              );
            })}
          </div>
          <label>
            Или выбрать конкретного сотрудника
            <select
              value={user.id}
              onChange={async (e) => {
                if (await action({ action: 'demo-role', id: e.target.value })) {
                  setModal('');
                  setSelected(null);
                  setTab('home');
                }
              }}
            >
              {users.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {roles[u.role]}
                </option>
              ))}
            </select>
          </label>
        </Modal>
      )}
      {modal === 'visibility' && (
        <Modal
          onClose={() => {
            setModal('');
            setError('');
          }}
          title="Настройки видимости"
        >
          {iconPicker}
          <p>Размер текста</p>
          <div className="button-row">
            <button onClick={() => setScale(Math.max(1, scale - 0.15))}>А−</button>
            <strong>{Math.round(scale * 100)}%</strong>
            <button onClick={() => setScale(Math.min(2, scale + 0.15))}>А+</button>
          </div>
          <div className="actions">
            <button aria-pressed={contrast} onClick={() => setContrast(!contrast)}>
              Высокий контраст: {contrast ? 'включён' : 'выключен'}
            </button>
            <button
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? 'Светлая' : 'Тёмная'} тема
            </button>
          </div>
          <p className="muted">Настройки сохраняются на этом устройстве.</p>
          {data.workspace && <button onClick={() => setModal('password')}>Изменить пароль</button>}
          <button
            onClick={async () => {
              if (await action({ action: 'logout' })) {
                setModal('');
                setSelected(null);
                setRole('');
                setAccount('');
                setPin('');
              }
            }}
          >
            Выйти из учётной записи
          </button>
        </Modal>
      )}
      {modal === 'alerts' && (
        <Modal
          onClose={() => {
            setModal('');
            setError('');
          }}
          title="Уведомления"
        >
          <p className="muted">
            В основной версии можно включить push о новых нарядах и изменениях, даже когда окно закрыто.
            Сервер контролирует сроки при открытой смене. Для контроля при закрытых окнах нужен включённый
            фоновый сервис напоминаний. На iPhone сначала установите приложение на главный экран.
          </p>
          <button onClick={enablePush}>
            <Bell size={18} />
            Включить уведомления
          </button>
          {!demo && (
            <button
              onClick={async () => {
                const result = await action({ action: 'push-test' });
                if (result)
                  setToast(
                    result.sent
                      ? 'Тест отправлен. Проверьте уведомления телефона.'
                      : 'Нет активной подписки или push-служба недоступна.',
                  );
              }}
            >
              Проверить push
            </button>
          )}
          {alerts.map((a: any) => (
            <button className="alert-item" key={a.id} onClick={() => openAlert(a)}>
              <TriangleAlert />
              <span>
                <strong>{a.title}</strong>
                <small>{a.text}</small>
              </span>
            </button>
          ))}
          {!alerts.length && <p className="empty">Предупреждений нет</p>}
        </Modal>
      )}
      {modal === 'create' && (
        <Modal
          onClose={() => {
            setModal('');
            setError('');
          }}
          title="Выдать наряд"
        >
          <form
            onSubmit={create}
            onChange={(e) => {
              const f = new FormData(e.currentTarget);
              setCreateText(`${f.get('title') || ''} ${f.get('description') || ''}`.trim());
            }}
          >
            <input type="hidden" name="suggestedCode" value={createRec.result?.code?.id || ''} />
            <input type="hidden" name="recommendedWorker" value={createRec.result?.ranked?.[0]?.id || ''} />
            <label>
              Проблема / задание
              <input name="title" required placeholder="Например: течь масла на насосе" maxLength={180} />
            </label>
            <label>
              Подробности
              <textarea name="description" rows={2} placeholder="Что необходимо выполнить" />
            </label>
            <div className="form-grid">
              <label>
                Участок
                <select
                  required
                  value={formArea}
                  onChange={(e) => {
                    setFormArea(e.target.value);
                    setFormEq('');
                  }}
                >
                  <option value="">Выберите</option>
                  {data.areas.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Оборудование
                <select required value={formEq} onChange={(e) => setFormEq(e.target.value)}>
                  <option value="">Выберите</option>
                  {data.equipment
                    .filter((x: any) => x.area === formArea)
                    .map((x: any) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label>
              Назначить
              <select value={assignment} onChange={(e) => setAssignment(e.target.value)}>
                <option value="person">Одному сотруднику</option>
                <option value="brigade">Бригаде</option>
              </select>
            </label>
            {assignment === 'brigade' ? (
              <label>
                Бригада
                <select name="brigade" required>
                  {Array.from(new Set<number>(workers.map((w: any) => Number(w.brigade) || 1)))
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <option key={n} value={n}>
                        Бригада {n} · {workers.filter((w: any) => w.brigade === n && w.onShift).length} на
                        смене
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <label>
                Исполнитель
                <select
                  name="worker"
                  required
                  value={createWorker}
                  onChange={(e) => setCreateWorker(e.target.value)}
                >
                  <option value="" disabled>
                    Выберите сотрудника
                  </option>
                  {workers
                    .filter((w: any) => w.onShift && !w.disabled)
                    .sort(
                      (a: any, b: any) =>
                        (available(a) === 'Свободен' ? -1 : 1) - (available(b) === 'Свободен' ? -1 : 1),
                    )
                    .map((w: any) => (
                      <option key={w.id} value={w.id}>
                        {w.name} · {w.spec} · {available(w)}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {assignment === 'person' && (
              <AssigneeHint
                result={createRec.result}
                loading={createRec.loading}
                selected={createWorker}
                onPick={setCreateWorker}
              />
            )}
            <CodeHint result={createRec.result} onApplyNorm={(m) => setCreateNorm(String(m))} />
            <div className="form-grid">
              <label>
                Тип работ
                <select name="type">
                  <option value="unplanned">Внеплановый</option>
                  <option value="planned">Плановый</option>
                </select>
              </label>
              <label>
                Приоритет
                <select name="priority">
                  <option value="normal">Обычный</option>
                  <option value="emergency">Аварийный</option>
                  <option value="high">Высокий</option>
                  <option value="planned">Плановый</option>
                </select>
              </label>
              <label>
                Срок
                <input
                  name="due"
                  type="datetime-local"
                  required
                  defaultValue={new Date(Date.now() + 3600000 - new Date().getTimezoneOffset() * 60000)
                    .toISOString()
                    .slice(0, 16)}
                />
              </label>
              <label>
                Норматив, минут
                <input
                  name="norm"
                  type="number"
                  min="1"
                  value={createNorm}
                  onChange={(e) => setCreateNorm(e.target.value)}
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Сложность
                <select name="complexity">
                  <option value="1">Обычная · 1</option>
                  <option value="2">Повышенная · 2</option>
                  <option value="3">Сложная · 3</option>
                </select>
              </label>
              <label className="checkbox">
                <input type="checkbox" name="equipmentStopped" />
                Оборудование остановлено
              </label>
            </div>
            {photoInput}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="primary wide" disabled={busy || uploading}>
              {busy ? 'Сохранение…' : 'Выдать наряд'}
            </button>
          </form>
        </Modal>
      )}
      {modal === 'report' && order && (
        <Modal
          onClose={() => {
            setModal('');
            setError('');
          }}
          title="Отчёт о выполнении"
        >
          <form
            ref={reportForm}
            onChange={(e) => {
              const value = {
                ...Object.fromEntries(new FormData(e.currentTarget)),
                photos,
                materials: materialRows,
              };
              putLocal('drafts', data.environmentId + ':' + user.id + ':report:' + order.id, value).catch(
                () => {},
              );
            }}
            onSubmit={report}
          >
            <label>
              Что выполнено
              <textarea
                name="works"
                rows={4}
                defaultValue={reportDraft.works || ''}
                placeholder="Опишите ремонт и результат проверки"
              />
            </label>
            <label>
              Шифр неисправности
              <select name="code" defaultValue={reportDraft.code || ''}>
                <option value="">Выберите шифр</option>
                {data.codes.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Использованные материалы
              <select
                value=""
                onChange={(e) => {
                  const m = data.materials.find((m: any) => m.id === e.target.value);
                  if (m && !materialRows.some((r) => r.id === m.id))
                    setMaterialRows((p) => [...p, { ...m, qty: 1 }]);
                }}
              >
                <option value="">Добавить материал</option>
                {data.materials.map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.unit})
                  </option>
                ))}
              </select>
            </label>
            {materialRows.map((m: any) => (
              <div key={m.id} className="material-row">
                <span>{m.name}</span>
                <input
                  aria-label={'Количество ' + m.name}
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  value={m.qty}
                  onChange={(e) =>
                    setMaterialRows((rows) =>
                      rows.map((x) => (x.id === m.id ? { ...x, qty: Number(e.target.value) } : x)),
                    )
                  }
                />
                <small>{m.unit}</small>
                <button
                  type="button"
                  aria-label={'Убрать ' + m.name}
                  onClick={() => setMaterialRows((rows) => rows.filter((x) => x.id !== m.id))}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <label>
              Комментарий
              <textarea name="comment" defaultValue={reportDraft.comment || ''} rows={2} />
            </label>
            <p className="small muted">
              Фото «после» обязательно для внепланового ремонта. Неполный отчёт будет возвращён на доработку.
            </p>
            {photoInput}
            {error && <div className="error">{error}</div>}
            <button className="primary wide" disabled={busy || uploading}>
              {busy ? 'Проверка…' : 'Отправить на проверку'}
            </button>
          </form>
        </Modal>
      )}
      {['pause', 'reject'].includes(modal) && order && (
        <Modal
          onClose={() => {
            setModal('');
            setError('');
          }}
          title={modal === 'pause' ? 'Приостановить работу' : 'Отклонить наряд'}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await action({
                  action: 'transition',
                  id: order.id,
                  status: modal === 'pause' ? 'paused' : 'rejected',
                  reason: f.get('reason'),
                })
              )
                setModal('');
            }}
          >
            <label>
              Причина
              <textarea name="reason" required placeholder="Например: ожидаем запчасти" />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy}>
              Подтвердить
            </button>
          </form>
        </Modal>
      )}
      {modal === 'decision' && order && (
        <Modal
          onClose={() => {
            setModal('');
            setError('');
          }}
          title="Решение мастера"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              if (await action({ action: 'decision', id: order.id, ...f })) setModal('');
            }}
          >
            <label>
              Решение
              <select name="decision">
                <option value="accept">Принять и закрыть</option>
                <option value="return">Вернуть на доработку</option>
              </select>
            </label>
            <label>
              Оценка качества
              <select name="score" defaultValue={order.check?.score || 4}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              Комментарий / обоснование
              <textarea name="reason" required />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy}>
              Сохранить решение
            </button>
          </form>
        </Modal>
      )}
      {modal === 'edit' && order && (
        <Modal
          onClose={() => {
            setModal('');
            setError('');
          }}
          title={order.status === 'rejected' ? 'Переназначить наряд' : 'Изменить наряд'}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await action({
                  action: 'edit',
                  id: order.id,
                  worker: editWorker,
                  priority: f.get('priority'),
                  cancel: f.get('cancel') === 'on',
                  reason: f.get('reason'),
                })
              )
                setModal('');
            }}
          >
            <label>
              Исполнитель
              <select
                name="worker"
                required
                value={editWorker}
                onChange={(e) => setEditWorker(e.target.value)}
              >
                <option value="" disabled>
                  Выберите сотрудника
                </option>
                {workers
                  .filter(
                    (w: any) =>
                      w.onShift && !w.disabled && (order.status !== 'rejected' || w.id !== order.worker),
                  )
                  .map((w: any) => (
                    <option key={w.id} value={w.id}>
                      {w.name} · {w.spec} · {available(w)}
                    </option>
                  ))}
              </select>
            </label>
            <AssigneeHint
              result={editRanked}
              loading={editRec.loading}
              selected={editWorker}
              onPick={setEditWorker}
            />
            <label>
              Приоритет
              <select name="priority" defaultValue={order.priority}>
                {Object.entries(priorities).map(([k, v]: any) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {order.status !== 'rejected' && (
              <>
                <label className="checkbox">
                  <input type="checkbox" name="cancel" />
                  Отменить наряд
                </label>
                <label>
                  Причина отмены
                  <textarea name="reason" />
                </label>
              </>
            )}
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy}>
              Сохранить
            </button>
          </form>
        </Modal>
      )}
      {modal.startsWith('catalog:') && (
        <Modal
          onClose={() => {
            setModal('');
            setError('');
          }}
          title="Новая запись"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action({
                  action: 'catalog',
                  kind: modal.split(':')[1],
                  data: Object.fromEntries(new FormData(e.currentTarget)),
                })
              )
                setModal('');
            }}
          >
            <label>
              Название
              <input name="name" required />
            </label>
            {modal === 'catalog:equipment' && (
              <>
                <label>
                  Участок
                  <select name="area">
                    {data.areas.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Инвентарный номер
                  <input name="inventory" />
                </label>
              </>
            )}
            {modal === 'catalog:materials' && (
              <label>
                Единица измерения
                <input name="unit" defaultValue="шт." />
              </label>
            )}
            {['catalog:materials', 'catalog:codes'].includes(modal) && (
              <label>
                Справочный норматив
                <input name="norm" type="number" min="1" defaultValue="1" />
              </label>
            )}
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy}>
              Добавить
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Modal({ title, children, onClose }: any) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const first = ref.current?.querySelector<HTMLElement>('button,input,select,textarea');
    first?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const all = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select,textarea,a[href]',
          ) || [],
        );
        const first = all[0],
          last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);
  return (
    <div className="overlay">
      <section ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Photo({ id, demo }: { id: string; demo: boolean }) {
  const [local, setLocal] = useState('');
  useEffect(() => {
    if (!id.startsWith('local:')) return;
    let url = '',
      cancelled = false;
    readLocal('drafts', id)
      .then((value) => {
        if (value?.blob && !cancelled) {
          url = URL.createObjectURL(value.blob);
          setLocal(url);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  const src = id.startsWith('local:') ? local : (demo ? '/api/demo-photo?id=' : '/api/photo?id=') + id;
  return src ? (
    <a href={src} target="_blank" rel="noreferrer">
      <img src={src} alt="Фото оборудования" />
    </a>
  ) : (
    <span>Загрузка фото…</span>
  );
}
