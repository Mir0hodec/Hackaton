"""Integration test: history import, trimmed live payload, analytics finds the planted patterns,
worker sees only own rating, history clean-up keeps real orders."""
import urllib.request, urllib.error, json, datetime

op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = 'http://127.0.0.1:4173'


def call(body=None, cookie='', path='/api/service'):
    raw = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=raw, headers={'Host': 'terminal.local:4173', 'Cookie': cookie, 'Content-Type': 'application/json'})
    try:
        r = op.open(req, timeout=120)
    except urllib.error.HTTPError as e:
        r = e
    value = r.read()
    try:
        return r.status, json.loads(value), r.headers
    except Exception:
        return r.status, {'raw': value[:300]}, r.headers


def ok(body=None, cookie='', path='/api/service'):
    s, d, _ = call(body, cookie, path)
    assert s == 200, (body, path, s, d)
    return d


def login(name, password):
    s, d, h = call({'action': 'login', 'id': name, 'pin': password})
    assert s == 200, d
    return h['Set-Cookie'].split(';')[0]


admin = login('admin', 'LocalAdmin_12345')
master = login('master', 'LocalMaster_12345')
manager = login('manager', 'LocalManager_12345')
w1 = login('worker1', 'LocalWorker1_12345')

assert call({'action': 'history-import'}, master)[0] != 200
res = ok({'action': 'history-import'}, admin)
assert res['orders'] >= 500, res
assert ok(cookie=admin)['history']['orders'] == res['orders']

# Оперативная лента не тащит историю на телефоны.
live = ok(cookie=master)
assert not any(o.get('synthetic') and o['status'] == 'closed' for o in live['orders'])
assert len(json.dumps(live)) < 200_000, len(json.dumps(live))

now = datetime.datetime.now(datetime.timezone.utc)
q = f"from={(now - datetime.timedelta(days=91)).isoformat()}&to={(now + datetime.timedelta(minutes=5)).isoformat()}"
a = ok(cookie=manager, path='/api/analytics?' + q.replace('+', '%2B'))
assert a['summary']['issued'] >= 500, a['summary']
kinds = {i['kind'] for i in a['insights']}
titles = ' | '.join(i['title'] for i in a['insights'])
for expected in ['frequent', 'after_ppr', 'shift', 'worker', 'materials', 'trend']:
    assert expected in kinds, (expected, titles)
assert 'К-3' in titles and 'МШЦ-3600' in titles and 'Дробление' in titles and 'К-12' in titles and 'Бригада 3' in titles, titles
assert a['ratings']['workers'][0]['explanation'] and a['ratings']['brigades'], a['ratings']['brigades']
assert a['materials']['deviations'] and a['equipment'][0]['unplanned'] > 0

# Фильтр по участку.
area = ok(cookie=manager, path='/api/analytics?' + q.replace('+', '%2B') + '&area=a0')
assert area['summary']['issued'] < a['summary']['issued']

# Исполнитель видит только свой рейтинг.
mine = ok(cookie=w1, path='/api/analytics?' + q.replace('+', '%2B'))
assert set(mine.keys()) == {'self'} and mine['self']['count'] > 0 and 'Рейтинг' in mine['self']['explanation'], mine

# Наряд из истории открывается по ссылке.
hist = ok(cookie=master, path='/api/service?view=order&id=hist-1001')['order']
assert hist['synthetic'] is True

# Подбор исполнителя учитывает историю: для подшипника конвейера — слесарь с опытом.
rec = ok({'action': 'recommend', 'equipment': 'e1', 'text': 'Шум подшипника привода'}, master)
assert rec['code']['id'] == 'М-02' and any('ремонт' in r for r in rec['ranked'][0]['reasons']), rec['ranked'][0]

cleared = ok({'action': 'history-clear'}, admin)
assert cleared['removed'] >= 500
a2 = ok(cookie=manager, path='/api/analytics?' + q.replace('+', '%2B'))
assert a2['summary']['issued'] < 50
print('PASS: history import, light live payload, analytics finds all planted patterns, filters, worker self-rating, history clean-up.')
