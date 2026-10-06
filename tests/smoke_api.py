"""Local API smoke test. Uses synthetic accounts; no production changes."""
import urllib.request, urllib.error, json, uuid, pathlib
base='http://127.0.0.1:4173'
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
def call(body=None,cookie='',path='/api/service',raw=None,ctype=None):
    headers={'Host':'terminal.local:4173'}
    if cookie: headers['Cookie']=cookie
    if body is not None: raw=json.dumps(body).encode();ctype='application/json'
    if ctype:headers['Content-Type']=ctype
    req=urllib.request.Request(base+path,data=raw,headers=headers)
    try:
        r=opener.open(req,timeout=30)
    except urllib.error.HTTPError as e:r=e
    data=r.read()
    try:d=json.loads(data)
    except:d={'raw_bytes':len(data)}
    return r.status,d,r.headers

def login(id,pin):
    status,d,h=call({'action':'login','id':id,'pin':pin})
    assert status==200,d
    return h['Set-Cookie'].split(';')[0]
assert call()[1]['user'] is None
assert call({'action':'login','id':'master','pin':'9999'})[0]==401
master=login('master','4101');worker=login('worker1','4201');manager=login('manager','4301')
status,data,_=call(cookie=master)
assert len(data['orders'])>=524 and len(data['equipment'])==25
assert len(data['materials'])==40 and len(data['codes'])==20
payload={'action':'create','data':{'title':'Проверка сквозного сценария','description':'Тест API, только локальная база','equipment':'e0','worker':'worker1','priority':'emergency','type':'unplanned','due':'2026-12-31T12:00:00Z','photos':[]}}
assert call(payload,worker)[0]!=200
_,d,_=call(payload,master);id=d['id']
assert call({'action':'decision','id':id,'decision':'accept','reason':'Рано'},master)[0]!=200
for s in ('accepted','working'):
    st,d,_=call({'action':'transition','id':id,'status':s},worker);assert st==200,d
st,d,_=call({'action':'report','id':id,'report':{'works':'Заменено уплотнение и выполнен контрольный запуск','code':'М-01','materials':[],'photos':[]}},worker);assert st==200,d
state=next(o for o in call(cookie=master)[1]['orders'] if o['id']==id)
assert state['status']=='rework'
assert any('фото' in s for s in state['check']['issues'])
# Upload a local placeholder image to exercise object storage; not real repair evidence.
boundary='test'+uuid.uuid4().hex
image=pathlib.Path('public/icon-192.png').read_bytes()
raw=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+image+f'\r\n--{boundary}--\r\n'.encode())
st,d,_=call(cookie=worker,path='/api/photo',raw=raw,ctype='multipart/form-data; boundary='+boundary);assert st==200,d
photo=d['id'];assert call(cookie=worker,path='/api/photo?id='+photo)[0]==200
assert call(path='/api/photo?id='+photo)[0]==401
st,d,_=call({'action':'report','id':id,'report':{'works':'Заменено уплотнение и выполнен контрольный запуск','code':'М-01','materials':[{'id':'mat1','qty':1}],'photos':[photo]}},worker);assert st==200,d
state=next(o for o in call(cookie=master)[1]['orders'] if o['id']==id)
assert state['status']=='review'
assert call({'action':'decision','id':id,'decision':'accept','reason':'Недопустимо'},worker)[0]!=200
assert call({'action':'decision','id':id,'decision':'accept','reason':'Недопустимо'},manager)[0]!=200
st,d,_=call({'action':'decision','id':id,'decision':'accept','reason':'Проверено мастером в локальном тесте','score':5},master);assert st==200,d
state=next(o for o in call(cookie=master)[1]['orders'] if o['id']==id)
assert state['status']=='closed' and state['masterScore']==5 and len(state['history'])==6
assert all(o['worker']=='worker1' for o in call(cookie=worker)[1]['orders'])
assert call({'action':'transition','id':id,'status':'working'},worker)[0]!=200
assert call({'action':'transition','id':'demo1','status':'paused','reason':'Недопустимо'},worker)[0]==403
call({'action':'logout'},worker)
assert call(cookie=worker)[1]['user'] is None
print('PASS: seed, PIN authentication, role permissions, create, accept, start, incomplete report → rework, upload/read permissions, review, master approval, closed-state guard, worker scoping, logout.')
