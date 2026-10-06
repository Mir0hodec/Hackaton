"""Integration test: rejection → master verdict → reassignment, AI assignee suggestion,
fault-code hint, configurable thresholds and push notification texts.
Requires the local server (npm run start:local) with the local test accounts from .dev.vars.
"""
import urllib.request, urllib.error, json

op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = 'http://127.0.0.1:4173'


def call(body=None, cookie='', path='/api/service'):
    raw = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=raw, headers={'Host': 'terminal.local:4173', 'Cookie': cookie, 'Content-Type': 'application/json'})
    try:
        r = op.open(req, timeout=60)
    except urllib.error.HTTPError as e:
        r = e
    value = r.read()
    try:
        d = json.loads(value)
    except Exception:
        d = {'raw': value[:300]}
    return r.status, d, r.headers


def ok(body=None, cookie='', path='/api/service'):
    s, d, _ = call(body, cookie, path)
    assert s == 200, (body, s, d)
    return d


def login(name, password):
    s, d, h = call({'action': 'login', 'id': name, 'pin': password})
    assert s == 200, d
    return h['Set-Cookie'].split(';')[0]


admin = login('admin', 'LocalAdmin_12345')
master = login('master', 'LocalMaster_12345')
w1 = login('worker1', 'LocalWorker1_12345')
w2 = login('worker2', 'LocalWorker2_12345')

# Подсказки при выдаче: шифр по описанию и ранжированные исполнители с объяснением.
rec = ok({'action': 'recommend', 'equipment': 'e0', 'text': 'Течь масла на насосе'}, master)
assert rec['code'] and rec['code']['id'] == 'Г-01', rec['code']
assert rec['ranked'] and all(r['reasons'] for r in rec['ranked']), rec
assert call({'action': 'recommend', 'equipment': 'e0', 'text': 'x'}, w1)[0] != 200

# Аварийный наряд: исполнитель получает уведомление с текстом и признаком аварии.
order_id = ok({'action': 'create', 'data': {'title': 'Течь масла на насосе', 'equipment': 'e0', 'worker': 'worker1',
                                           'priority': 'emergency', 'type': 'unplanned', 'due': '2099-01-01T10:00:00Z',
                                           'suggestedCode': rec['code']['id']}}, master)['id']
items = ok(cookie=w1, path='/api/service?view=notifications')['items']
assert any(i['order'] == order_id and i['emergency'] and 'АВАРИЙНЫЙ' in i['title'] for i in items), items

# Отказ с причиной → мастер получает уведомление.
ok({'action': 'transition', 'id': order_id, 'status': 'rejected', 'reason': 'Занят другим нарядом'}, w1)
master_view = ok(cookie=master)
assert any(a['order'] == order_id and 'отклонён' in a['title'] for a in master_view['alerts'])
o = next(x for x in master_view['orders'] if x['id'] == order_id)
assert o['status'] == 'rejected' and o['rejections'][0]['worker'] == 'worker1'

# Оценка причины отказа доступна только мастеру и влияет на рейтинг.
assert call({'action': 'rejection-verdict', 'id': order_id, 'index': 0, 'unjustified': True}, w1)[0] != 200
ok({'action': 'rejection-verdict', 'id': order_id, 'index': 0, 'unjustified': True}, master)

# Переназначение отклонённого наряда другому исполнителю.
assert call({'action': 'edit', 'id': order_id, 'worker': 'worker1'}, master)[0] != 200
ok({'action': 'edit', 'id': order_id, 'worker': 'worker2'}, master)
o = next(x for x in ok(cookie=master)['orders'] if x['id'] == order_id)
assert o['status'] == 'issued' and o['worker'] == 'worker2', o
assert o['rejections'][0]['unjustified'] is True
assert any(x['id'] == order_id for x in ok(cookie=w2)['orders'])
assert not any(x['id'] == order_id for x in ok(cookie=w1)['orders'])
assert any(i['order'] == order_id for i in ok(cookie=w2, path='/api/service?view=notifications')['items'])

# Время реакции фиксируется при первом ответе исполнителя.
ok({'action': 'transition', 'id': order_id, 'status': 'accepted'}, w2)
o = next(x for x in ok(cookie=master)['orders'] if x['id'] == order_id)
assert o.get('acceptedAt') and o.get('updatedAt'), o
ok({'action': 'edit', 'id': order_id, 'cancel': True, 'reason': 'Тест завершён'}, master)

# Пороги контроля сроков настраивает только администратор.
assert call({'action': 'settings', 'data': {'remindBeforeMin': 45}}, master)[0] != 200
assert call({'action': 'settings', 'data': {'remindBeforeMin': 1}}, admin)[0] != 200
ok({'action': 'settings', 'data': {'remindBeforeMin': 45}}, admin)
assert ok(cookie=master)['settings']['remindBeforeMin'] == 45
ok({'action': 'settings', 'data': {'remindBeforeMin': 30}}, admin)

print('PASS: rejection verdict and reassignment, AI assignee and code hints, notification texts, reaction time, thresholds.')
