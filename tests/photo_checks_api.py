"""Integration test: «after» photo freshness checks (perceptual hash vs «before», EXIF date)."""
import urllib.request, urllib.error, json, uuid, io
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
        return r.status, json.loads(value), r.headers
    except Exception:
        return r.status, {'raw': value[:300]}, r.headers


def ok(body=None, cookie='', path='/api/service'):
    s, d, _ = call(body, cookie, path)
    assert s == 200, (body, s, d)
    return d


def login(name, password):
    s, d, h = call({'action': 'login', 'id': name, 'pin': password})
    assert s == 200, d
    return h['Set-Cookie'].split(';')[0]


def photo(cookie, dhash=None, taken=None):
    b = io.BytesIO()
    Image.new('RGB', (48, 48), tuple(uuid.uuid4().bytes[:3])).save(b, format='JPEG')
    boundary = uuid.uuid4().hex
    fields = b''
    for name, value in (('dhash', dhash), ('takenAt', taken)):
        if value:
            fields += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
    raw = (fields + f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode()
           + b.getvalue() + f'\r\n--{boundary}--\r\n'.encode())
    s, d, _ = call(cookie=cookie, path='/api/photo', raw=raw, ctype='multipart/form-data; boundary=' + boundary)
    assert s == 200, d
    return d['id']


master = login('master', 'LocalMaster_12345')
w1 = login('worker1', 'LocalWorker1_12345')
same = 'f0e1d2c3b4a59687'
before = photo(master, dhash=same)
oid = ok({'action': 'create', 'data': {'title': 'Течь масла', 'equipment': 'e0', 'worker': 'worker1', 'priority': 'high',
                                     'type': 'unplanned', 'due': '2099-01-01T10:00:00Z', 'photos': [before]}}, master)['id']
ok({'action': 'transition', 'id': oid, 'status': 'accepted'}, w1)
ok({'action': 'transition', 'id': oid, 'status': 'working'}, w1)
after = photo(w1, dhash='f0e1d2c3b4a59686', taken='2020-01-01T08:00:00Z')  # 1 бит отличия и старая дата
ok({'action': 'report', 'id': oid, 'report': {'works': 'Заменено уплотнение, течь устранена, проверено.', 'code': 'Г-01',
                                             'materials': [], 'photos': [after]}}, w1)
o = next(x for x in ok(cookie=master)['orders'] if x['id'] == oid)
issues = ' '.join(o['check']['issues'])
assert 'совпадает с фото «до»' in issues and 'EXIF' in issues, o['check']['issues']
assert o['check']['verdict'] != 'accepted'
ok({'action': 'edit', 'id': oid, 'cancel': True, 'reason': 'Тест завершён'}, master)
print('PASS: «after» photo compared with «before» by perceptual hash, EXIF date earlier than the order is flagged.')
