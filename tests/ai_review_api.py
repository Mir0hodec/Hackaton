"""Integration test of the background AI review pipeline.
Run against a local server started with AI_PROVIDER=mock in .dev.vars (no external calls).
Checks: instant rules verdict, background AI result, AI rework for unrelated works,
rules rework without photo and with excessive/odd materials, worker/master report fields.
"""
import urllib.request, urllib.error, json, time, uuid, io
from PIL import Image

op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = 'http://127.0.0.1:4173'


def call(body=None, cookie='', path='/api/service', raw=None, ctype='application/json'):
    if body is not None:
        raw = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=raw, headers={'Host': 'terminal.local:4173', 'Cookie': cookie, 'Content-Type': ctype})
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


def photo(cookie):
    b = io.BytesIO()
    Image.new('RGB', (64, 64), tuple(uuid.uuid4().bytes[:3])).save(b, format='JPEG')
    boundary = uuid.uuid4().hex
    raw = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode()
           + b.getvalue() + f'\r\n--{boundary}--\r\n'.encode())
    s, d, _ = call(cookie=cookie, path='/api/photo', raw=raw, ctype='multipart/form-data; boundary=' + boundary)
    assert s == 200, d
    return d['id']


master = login('master', 'LocalMaster_12345')
w1 = login('worker1', 'LocalWorker1_12345')
caps = ok(cookie=master)['capabilities']
if caps.get('llmProvider') != 'mock':
    print('SKIP: server is not running with AI_PROVIDER=mock')
    raise SystemExit(0)

materials = ok(cookie=master)['materials']
seal = next(m for m in materials if 'Кольцо' in m['name'] or 'Манжета' in m['name'] or 'Уплотн' in m['name'])
cable = next(m for m in materials if 'Кабель' in m['name'])


def new_order(title):
    oid = ok({'action': 'create', 'data': {'title': title, 'description': title, 'equipment': 'e0', 'worker': 'worker1',
                                         'priority': 'high', 'type': 'unplanned', 'due': '2099-01-01T10:00:00Z',
                                         'photos': [photo(master)]}}, master)['id']
    ok({'action': 'transition', 'id': oid, 'status': 'accepted'}, w1)
    ok({'action': 'transition', 'id': oid, 'status': 'working'}, w1)
    return oid


def wait_ai(oid, cookie=master):
    for _ in range(30):
        o = next(x for x in ok(cookie=cookie)['orders'] if x['id'] == oid)
        if not o['check'].get('aiPending'):
            return o
        time.sleep(1)
    raise AssertionError('AI review did not finish')


# 1. Хороший отчёт: работы по проблеме, фото, материалы в норме → ИИ принимает.
good = new_order('Течь масла через уплотнение насоса')
ok({'action': 'report', 'id': good, 'report': {'works': 'Заменено уплотнение насоса, течь масла устранена, пробный пуск без течи.',
                                              'code': 'Г-01', 'materials': [{'id': seal['id'], 'qty': 1}], 'photos': [photo(w1)]}}, w1)
o = next(x for x in ok(cookie=master)['orders'] if x['id'] == good)
assert o['status'] == 'review' and (o['check'].get('aiPending') or o['check']['mode'] == 'ai'), o['check']
o = wait_ai(good)
c = o['check']
assert c['mode'] == 'ai' and c['verdict'] in ('accepted', 'remarks') and c['summaryForMaster'] and c['strengths'], c
assert o['status'] == 'review'

# 2. Работы не про ту проблему → ИИ возвращает на доработку, исполнитель получает уведомление.
wrong = new_order('Течь масла через уплотнение насоса')
ok({'action': 'report', 'id': wrong, 'report': {'works': 'Покрашены перила площадки обслуживания краской.',
                                               'code': 'Г-01', 'materials': [], 'photos': [photo(w1)]}}, w1)
o = wait_ai(wrong)
assert o['check']['verdict'] == 'rework' and o['status'] == 'rework', (o['status'], o['check'])
items = ok(cookie=w1, path='/api/service?view=notifications')['items']
assert any(i['order'] == wrong and 'ИИ' in i['title'] for i in items), items

# 3. Без фото и с лишними/нетипичными материалами → правила сразу возвращают с объяснением.
bad = new_order('Течь масла через уплотнение насоса')
ok({'action': 'report', 'id': bad, 'report': {'works': 'Заменено уплотнение, течь устранена.', 'code': 'Г-01',
                                             'materials': [{'id': seal['id'], 'qty': 40}, {'id': cable['id'], 'qty': 5}], 'photos': []}}, w1)
o = next(x for x in ok(cookie=w1)['orders'] if x['id'] == bad)
issues = ' '.join(o['check']['issues'])
assert o['status'] == 'rework' and 'фото' in issues and 'ориентир' in issues and 'нетипичны' in issues, o['check']
assert o['check']['improvements'], o['check']

for oid in (good, wrong, bad):
    call({'action': 'edit', 'id': oid, 'cancel': True, 'reason': 'Тест завершён'}, master)
print('PASS: instant rules verdict, background AI review, AI rework with worker notice, rules rework for missing photo and odd materials.')
