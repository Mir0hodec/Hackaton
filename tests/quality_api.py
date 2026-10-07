"""Run against a disposable local demo namespace. No production URLs accepted."""
import concurrent.futures, datetime as dt, http.cookiejar, json, os, pathlib, time, urllib.error, urllib.parse, urllib.request, uuid
origin=os.environ.get('NARYADAI_ORIGIN','http://127.0.0.1:4173').rstrip('/')
assert urllib.parse.urlparse(origin).hostname in ['127.0.0.1','localhost'], 'Local sandbox only'
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(body=None,path='/api/demo',raw=None,ctype='application/json'):
 if body is not None: raw=json.dumps(body).encode()
 try: r=opener.open(urllib.request.Request(origin+path,data=raw,headers={'Content-Type':ctype,'Origin':origin}),timeout=35)
 except urllib.error.HTTPError as e: r=e
 content=r.read()
 try: data=json.loads(content)
 except Exception: data={}
 return r.status,data
def ok(body):
 status,data=call(body);assert status==200,(status,data);return data
def role(id):ok({'action':'demo-role','id':id})
def get(id):return next(o for o in call()[1]['orders'] if o['id']==id)
def transition(id,status,**kwargs):return ok({'action':'transition','id':id,'status':status,**kwargs})
due=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)).isoformat()
ok({'action':'demo-start'});assert call()[1]['user']['role']=='master'
data=call()[1]
assert not data['capabilities'].get('lanDemo')
assert call(path='/api/lan-discovery')[0]==404
isolated=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
isolated.open(urllib.request.Request(origin+'/api/demo',data=json.dumps({'action':'demo-start'}).encode(),headers={'Content-Type':'application/json','Origin':origin}),timeout=35).read()
other=json.loads(isolated.open(origin+'/api/demo',timeout=35).read())
assert other['environmentId']!=data['environmentId'], 'Public demo visitors must remain isolated'
worker_id=next(u['id'] for u in data['users'] if u['role']=='worker' and u.get('onShift') and not any(o['status'] not in ['closed','cancelled','rejected'] and (o['worker']==u['id'] or u['id'] in o.get('members',[])) for o in data['orders']))
material_id=next(m['id'] for m in data['materials'] if 'Кольцо' in m['name'] or 'Манжета' in m['name'])
def create(title,type='planned',due=due,priority='emergency'):return ok({'action':'create','requestId':str(uuid.uuid4()),'data':{'title':title,'equipment':'e0','worker':worker_id,'priority':priority,'type':type,'norm':60,'due':due}})['id']
first=create('Первое задание в очереди');second=create('Второе задание в очереди')
assert get(first)['priority']=='emergency'
role(worker_id);transition(first,'queued');transition(second,'queued')
status,data=call({'action':'transition','id':second,'status':'working'});assert status==400 and 'первый наряд' in data['error'],data
transition(second,'accepted')
assert call({'action':'transition','id':second,'status':'working'})[0]==400
role('master');third=create('Обычное задание без постановки в очередь',priority='normal');role(worker_id);transition(third,'accepted')
assert call({'action':'transition','id':third,'status':'working'})[0]==400
transition(first,'working')
assert call({'action':'transition','id':second,'status':'working'})[0]==400
assert call({'action':'transition','id':first,'status':'paused'})[0]==400
transition(first,'paused',reason='Ожидание комплектующих');assert get(first)['activeSince'] is None
ok({'action':'report','id':first,'report':{'works':'Выполнен осмотр и контрольный запуск оборудования','code':'М-01','materials':[],'photos':[]}})
assert get(first)['status']=='review';assert len(get(first)['check']['checks'])>=5
assert call({'action':'decision','id':first,'decision':'accept','reason':'Проверка доступа'})[0]==400
role('master');ok({'action':'decision','id':first,'decision':'accept','reason':'Принято в тестовой песочнице','score':5});assert get(first)['status']=='closed'
role(worker_id);transition(second,'working');ok({'action':'report','id':second,'report':{'works':'Выполнена проверка креплений и контрольный пуск','code':'М-03','materials':[],'photos':[]}})
role('master');ok({'action':'decision','id':second,'decision':'accept','reason':'Контроль выполнен','score':4})
bad=create('Течь масла на насосе','unplanned');role(worker_id);transition(bad,'accepted');transition(bad,'working')
ok({'action':'report','id':bad,'report':{'works':'Заменено уплотнение и проверена герметичность','code':'Г-01','materials':[{'id':material_id,'qty':20}],'photos':[]}})
o=get(bad);assert o['status']=='rework' and any(c['id']=='photos' and c['status']=='fail' for c in o['check']['checks']);assert any(c['id']=='materials' and c['status']=='review' for c in o['check']['checks'])
transition(bad,'working')
boundary=uuid.uuid4().hex
image=pathlib.Path('public/icon-192.png').read_bytes()
raw=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n'.encode()+image+f'\r\n--{boundary}--\r\n'.encode())
status,photo=call(path='/api/demo-photo',raw=raw,ctype='multipart/form-data; boundary='+boundary);assert status==200,photo
assert call(path='/api/demo-photo?id='+photo['id'])[0]==200
assert call(path='/api/photo?id='+photo['id'])[0] in [401,403]
ok({'action':'report','id':bad,'report':{'works':'Заменено уплотнение и проверена герметичность','code':'Г-01','materials':[{'id':material_id,'qty':1}],'photos':[photo['id']]}})
o=get(bad);assert o['status']=='review';assert any(c['id']=='visual' and c['status']=='review' for c in o['check']['checks']);assert o['check']['mode']=='rules'
role('manager');assert call({'action':'decision','id':bad,'decision':'accept','reason':'Не мастер'})[0]==400
role('master');ok({'action':'decision','id':bad,'decision':'accept','reason':'Фото проверяет мастер в тестовом сценарии','score':4})
past=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=3)).isoformat()
late=create('Короткий срок для проверки просрочки',due=past)
deadline=time.monotonic()+36
while time.monotonic()<deadline:
 alerts=call()[1]['alerts']
 if any(a.get('order')==late and 'просрочен' in a['title'] for a in alerts):break
 time.sleep(2)
else:raise AssertionError('No master overdue notification within one server tick')
role(worker_id);assert any(a.get('order')==late and 'просрочен' in a['title'] for a in call()[1]['alerts'])
role('master');race1=create('Одновременная попытка А');race2=create('Одновременная попытка Б');role(worker_id);transition(race1,'accepted');transition(race2,'accepted')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 results=list(pool.map(lambda id:call({'action':'transition','id':id,'status':'working'}),[race1,race2]))
assert sorted(r[0] for r in results)==[200,400],results
assert sum(get(id)['status']=='working' for id in [race1,race2])==1
winner=next(id for id in [race1,race2] if get(id)['status']=='working');loser=next(id for id in [race1,race2] if id!=winner)
assert call({'action':'work-start','worker':worker_id,'title':'Посторонняя работа','minutes':30})[0]==400
linked=ok({'action':'work-start','worker':worker_id,'title':'Таймер текущего наряда','minutes':30,'order':winner})['id']
transition(winner,'paused',reason='Проверка взаимной занятости')
assert call({'action':'transition','id':loser,'status':'working'})[0]==400
ok({'action':'work-cancel','worker':worker_id,'id':linked,'note':'Завершение теста связи'})
private=ok({'action':'work-start','worker':worker_id,'title':'Самостоятельная работа','minutes':30})['id']
assert call({'action':'transition','id':loser,'status':'working'})[0]==400
ok({'action':'work-cancel','worker':worker_id,'id':private,'note':'Освободить сотрудника'})
linked=ok({'action':'work-start','worker':worker_id,'title':'Таймер нового наряда','minutes':30,'order':loser})['id']
transition(loser,'working')
role('admin');assert call()[1]['user']['role']=='admin'
assert call(path='/api/service')[1].get('user') is None
print('PASS: emergency issuance; FIFO, accepted bypass and concurrent work and linked/private card guards; pause reason; role permissions; incomplete report rework; material facts; image pipeline and explicit visual fallback; master acceptance; overdue alerts to both roles; workplace separation.')
