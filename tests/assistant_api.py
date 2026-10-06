"""Integration test: master's assistant answers the ТЗ example questions from live data and analytics."""
import urllib.request, urllib.error, json

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


def login(name, password):
    s, d, h = call({'action': 'login', 'id': name, 'pin': password})
    assert s == 200, d
    return h['Set-Cookie'].split(';')[0]


def ask(cookie, q):
    s, d, _ = call({'message': q}, cookie, '/api/assistant')
    assert s == 200, (q, s, d)
    return d['text']


admin = login('admin', 'LocalAdmin_12345')
master = login('master', 'LocalMaster_12345')
w1 = login('worker1', 'LocalWorker1_12345')
assert call({'action': 'history-import'}, admin)[0] == 200

assert call({'message': 'Что просрочено?'}, w1, '/api/assistant')[0] == 403
t = ask(master, 'Кто сейчас свободен из электриков?')
assert 'Свобод' in t, t
t = ask(master, 'Что просрочено на смене?')
assert 'росроч' in t, t
t = ask(master, 'Сформируй отчёт за неделю по участку обогащения')
assert 'Обогащение' in t and 'Выдано' in t, t
t = ask(master, 'Что с конвейером К-3?')
assert 'К-3' in t and 'внеплановых' in t, t
t = ask(master, 'Покажи проблемы участка дробления за 3 месяца')
assert 'Дробление' in t and 'Главное' in t, t
t = ask(master, 'Какой рейтинг у Алиева?')
assert 'Арман Алиев' in t and 'Рейтинг' in t, t
print('PASS: assistant answers free workers, overdue, weekly area report, equipment history, problems and worker rating.')
