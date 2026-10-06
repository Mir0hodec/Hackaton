"""Integration test: independent shared-workspace accounts and access boundaries.
Requires .dev.vars with documented local-only test users. Never uses production.
"""
import urllib.request,urllib.error,json,uuid,io
from PIL import Image
op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def call(body=None,cookie='',path='/api/service',raw=None,ctype='application/json'):
 if body is not None:raw=json.dumps(body).encode()
 req=urllib.request.Request('http://127.0.0.1:4173'+path,data=raw,headers={'Host':'terminal.local:4173','Cookie':cookie,'Content-Type':ctype})
 try:r=op.open(req,timeout=60)
 except urllib.error.HTTPError as e:r=e
 value=r.read()
 try:d=json.loads(value)
 except:d={}
 return r.status,d,r.headers

def ok(body,cookie=''):
 s,d,h=call(body,cookie);assert s==200,d
 return d

def login(name,password):
 s,d,h=call({'action':'login','id':name,'pin':password});assert s==200,d
 return h['Set-Cookie'].split(';')[0]

def photo(cookie):
 b=io.BytesIO();Image.new('RGB',(32,32),tuple(uuid.uuid4().bytes[:3])).save(b,format='PNG')
 boundary=uuid.uuid4().hex
 raw=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+b.getvalue()+f'\r\n--{boundary}--\r\n'.encode())
 s,d,_=call(cookie=cookie,path='/api/photo',raw=raw,ctype='multipart/form-data; boundary='+boundary);assert s==200,d
 return d['id']

s,d,_=call();assert s==200 and d['workspace'] and d['accounts']==[]
assert call({'action':'demo-start'},path='/api/demo')[0]==403
admin=login('admin','LocalAdmin_12345');master=login('master','LocalMaster_12345');w1=login('worker1','LocalWorker1_12345');w2=login('worker2','LocalWorker2_12345')
before=photo(master)
data={'title':'Течь масла — межпользовательский тест','equipment':'e0','worker':'worker1','priority':'emergency','type':'unplanned','due':'2020-01-01T10:00:00Z','photos':[before]}
assert call({'action':'create','data':data},w1)[0]!=200
id=ok({'action':'create','data':data},master)['id']
a=call(cookie=master)[1];b=call(cookie=w1)[1];c=call(cookie=w2)[1]
assert any(o['id']==id for o in a['orders']) and any(o['id']==id for o in b['orders'])
assert not any(o['id']==id for o in c['orders'])
assert call(cookie=w1,path='/api/photo?id='+before)[0]==200
assert call(cookie=w2,path='/api/photo?id='+before)[0]==403
for state in ['accepted','working','paused','working']:
 ok({'action':'transition','id':id,'status':state,'reason':'Проверка паузы'},w1)
assert next(o for o in call(cookie=master)[1]['orders'] if o['id']==id)['status']=='working'
ok({'action':'report','id':id,'report':{'works':'Заменено уплотнение, проверена герметичность, выполнен контрольный пуск','code':'М-01','materials':[],'photos':[]}},w1)
assert next(o for o in call(cookie=master)[1]['orders'] if o['id']==id)['status']=='rework'
after=photo(w1)
ok({'action':'report','id':id,'report':{'works':'Заменено уплотнение, проверена герметичность, выполнен контрольный пуск','code':'М-01','materials':[{'id':'mat1','qty':1}],'photos':[after]}},w1)
assert call({'action':'decision','id':id,'decision':'accept','reason':'Попытка исполнителя'},w1)[0]!=200
ok({'action':'decision','id':id,'decision':'accept','reason':'Принято мастером после проверки','score':5},master)
assert next(o for o in call(cookie=w1)[1]['orders'] if o['id']==id)['status']=='closed'
# Account lifecycle and secret filtering.
name='test'+uuid.uuid4().hex[:8]
body={'action':'user-create','data':{'login':name,'name':'Тест доступа','role':'worker','password':'TestAccount_12345','brigade':2}}
assert call(body,master)[0]!=200
ok(body,admin);new=login(name,'TestAccount_12345')
for user in call(cookie=admin)[1]['users']:
 assert not any(k in user for k in ['passwordHash','passwordSalt','pinHash'])
ok({'action':'user-update','id':name,'disabled':True},admin)
assert call(cookie=new)[1]['user'] is None
assert call({'action':'login','id':name,'pin':'TestAccount_12345'})[0]==401
ok({'action':'user-update','id':name,'disabled':False,'password':'Replacement_12345'},admin)
new=login(name,'Replacement_12345')
ok({'action':'password-change','oldPassword':'Replacement_12345','password':'ChangedAgain_12345'},new)
assert call(cookie=new)[1]['user'] is None
login(name,'ChangedAgain_12345')
assert call({},path='/api/reminders')[0]==401
print('PASS: shared master/worker sessions, uploaded before/after photos, isolation of unassigned worker, full lifecycle, master acceptance, account administration, blocking, password reset/change, session revocation, secret filtering and protected reminder endpoint.')
