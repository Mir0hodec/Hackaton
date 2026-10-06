"""Isolation and retry regression tests against local preview only."""
import urllib.request,urllib.error,json,uuid,pathlib
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def call(body=None,cookie='',path='/api/demo',raw=None,ctype='application/json'):
 headers={'Host':'terminal.local:4173','Content-Type':ctype,'Cookie':cookie}
 if body is not None:raw=json.dumps(body).encode()
 try:r=opener.open(urllib.request.Request('http://127.0.0.1:4173'+path,data=raw,headers=headers),timeout=60)
 except urllib.error.HTTPError as e:r=e
 b=r.read()
 try:d=json.loads(b)
 except:d={}
 return r.status,d,r.headers

def start():
 s,d,h=call({'action':'demo-start'});assert s==200,d
 return h['Set-Cookie'].split(';')[0]
def ok(body,cookie):
 s,d,h=call(body,cookie);assert s==200,d
 return d
assert call()[0]==401
first=start();second=start()
a=call(cookie=first)[1];b=call(cookie=second)[1]
assert len(a['orders'])==524 and a['user']['role']=='master'
assert a['environmentId']!=b['environmentId']
assert call(cookie=first,path='/api/service')[1]['user'] is None
assert call({'action':'login','id':'m1','pin':'4101'},first)[0]==400
request=str(uuid.uuid4())
payload={'action':'create','requestId':request,'data':{'title':'Бригада: контроль изоляции','equipment':'e0','brigade':1,'priority':'normal','type':'planned','due':'2026-12-31T12:00:00Z','equipmentStopped':True}}
item=ok(payload,first)['id'];ok(payload,first)
a=call(cookie=first)[1]
assert len([o for o in a['orders'] if o['id']==item])==1
assert not any(o['id']==item for o in call(cookie=second)[1]['orders'])
order=next(o for o in a['orders'] if o['id']==item)
assert len(order['members'])>1
worker=next(w for w in order['members'][1:] if not any(o['worker']==w and o['status']=='working' for o in a['orders']))
ok({'action':'demo-role','id':worker},first)
assert any(o['id']==item for o in call(cookie=first)[1]['orders'])
assert call(payload,first)[0]!=200
for status in ['accepted','working','paused']:
 body={'action':'transition','id':item,'status':status,'reason':'Пауза по тесту','requestId':str(uuid.uuid4())}
 ok(body,first);ok(body,first)
state=next(o for o in call(cookie=first)[1]['orders'] if o['id']==item)
assert len(state['history'])==4 and state['activeSince'] is None
ok({'action':'transition','id':item,'status':'working'},first)
ok({'action':'report','id':item,'report':{'works':'Выполнена проверка креплений, подтяжка и контрольный пуск','code':'М-01','materials':[],'photos':[]}},first)
assert call({'action':'decision','id':item,'decision':'accept','reason':'Запрет'},first)[0]!=200
for role in ['lead','admin','m2','m1']:
 ok({'action':'demo-role','id':role},first);assert call(cookie=first)[1]['user']['id']==role
ok({'action':'decision','id':item,'decision':'accept','reason':'Проверено в тестовой среде','score':5},first)
state=next(o for o in call(cookie=first)[1]['orders'] if o['id']==item)
assert state['status']=='closed' and state['downtimeEnded']
# Photos must not leak between independent demo visitors, including administrators.
boundary=uuid.uuid4().hex
raw=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+pathlib.Path('public/icon-192.png').read_bytes()+f'\r\n--{boundary}--\r\n'.encode())
s,d,_=call(cookie=first,path='/api/demo-photo',raw=raw,ctype='multipart/form-data; boundary='+boundary);assert s==200,d
photo=d['id'];assert call(cookie=first,path='/api/demo-photo?id='+photo)[0]==200
ok({'action':'demo-role','id':'admin'},second)
assert call(cookie=second,path='/api/demo-photo?id='+photo)[0] in [403,404]
assert call(cookie=first,path='/api/photo?id='+photo)[0]==401
print('PASS: passwordless roles, two isolated visitors, workplace separation, brigade access, idempotent retries, active clock, approval permissions, downtime and private photos.')
