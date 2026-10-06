import {db,get,list,save,requireRoles} from './server';
import {namespace} from './context';
import {notifyUsers} from './web-push';

const text=(v:any,max=2000)=>String(v||'').trim().slice(0,max);
function number(v:any,min:number,max:number,label:string){const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)throw new Error(label);return n;}
export async function workcardAction(user:any,b:any,origin:string){
  const workerId=String(b.worker||user.id);
  if(workerId!==user.id)requireRoles(user,['master','admin']);
  else requireRoles(user,['worker','master','admin']);
  const worker=await get('users',workerId);
  if(!worker||worker.role!=='worker'||worker.disabled)throw new Error('Выберите действующего исполнителя');
  const record=await get('worklogs',workerId)||{id:workerId,entries:[]};
  if(b.requestId&&record.entries.some((e:any)=>e.history.some((h:any)=>h.requestId===b.requestId)))return {ok:true};
  const now=new Date().toISOString();let card:any,event='';
  if(b.action==='work-start'){
    if(record.entries.some((e:any)=>e.status==='active'))throw new Error('Сначала завершите или отмените текущую карточку занятости');
    if(record.entries.length>=500)throw new Error('Достигнут лимит 500 карточек сотрудника. Обратитесь к администратору для архивирования.');
    const minutes=number(b.minutes,1,525600,'Укажите время от 1 минуты до 365 дней');
    const remind=number(b.remindMinutes??0,0,minutes,'Напоминание должно быть в пределах запланированного времени');
    const title=text(b.title,180);if(!title)throw new Error('Укажите выполняемую работу');
    if(!worker.onShift)throw new Error('Сотрудник должен быть на смене');
    let linked=null;
    if(b.order){linked=await get('orders',String(b.order));if(!linked||!(linked.worker===workerId||linked.members?.includes(workerId))||['closed','cancelled','rejected'].includes(linked.status))throw new Error('Выберите активный наряд этого сотрудника');}
    card={id:crypto.randomUUID(),worker:workerId,title,order:linked?.id||null,started:now,due:new Date(Date.now()+minutes*60000).toISOString(),plannedMinutes:minutes,remindMinutes:remind,status:'active',progress:0,workedMinutes:0,note:text(b.note),createdBy:user.id,history:[]};
    record.entries.unshift(card);event=`Начата работа. План: ${minutes} мин`;
  }else{
    card=record.entries.find((e:any)=>e.id===b.id);if(!card)throw new Error('Карточка работы не найдена');
    if(b.action==='work-review'){
      requireRoles(user,['master','admin']);if(card.status!=='completed')throw new Error('Оценить можно завершённую работу');
      const score=number(b.score,1,5,'Укажите оценку от 1 до 5');if(!Number.isInteger(score))throw new Error('Оценка должна быть целым числом');
      const comment=text(b.comment);if(!comment)throw new Error('Добавьте комментарий к оценке');
      card.review={score,comment,actor:user.id,at:now};event=`Оценка мастера: ${score}/5. ${comment}`;
    }else{
      if(card.status!=='active')throw new Error('Эта карточка уже завершена');
      if(b.action==='work-progress'){
        const progress=number(b.progress,0,100,'Прогресс должен быть от 0 до 100%');
        const minutes=number(b.workedMinutes,0,525600,'Проверьте отработанное время');
        const note=text(b.note);if(!note)throw new Error('Кратко опишите выполненный этап');
        if(progress<card.progress||minutes<card.workedMinutes)throw new Error('Накопленные прогресс и время не могут уменьшаться');
        card.progress=progress;card.workedMinutes=minutes;card.note=note;event=`Прогресс ${progress}%. Отработано суммарно ${minutes} мин. ${note}`;
      }else if(b.action==='work-plan'){
        const minutes=number(b.minutes,1,525600,'Укажите от 1 минуты до 365 дней');
        const reason=text(b.note);if(!reason)throw new Error('Укажите причину изменения срока');
        card.due=new Date(Date.now()+minutes*60000).toISOString();card.plannedMinutes=(Date.parse(card.due)-Date.parse(card.started))/60000;
        card.remindMinutes=number(b.remindMinutes??0,0,minutes,'Проверьте время напоминания');event=`Новый срок: ${card.due}. ${reason}`;
      }else if(b.action==='work-finish'||b.action==='work-cancel'){
        const note=text(b.note);if(!note)throw new Error('Опишите результат или причину отмены');
        if(b.action==='work-finish'){
          const minutes=number(b.workedMinutes??card.workedMinutes,0,525600,'Проверьте отработанное время');
          if(minutes<card.workedMinutes)throw new Error('Накопленное время не может уменьшаться');
          card.workedMinutes=minutes;card.progress=100;card.status='completed';card.early=Date.parse(now)<Date.parse(card.due);event=card.early?'Работа завершена досрочно':'Работа завершена';
        }else{card.status='cancelled';event='Работа отменена';}
        card.finished=now;card.note=note;event+=': '+note;
      }else throw new Error('Неизвестное действие с карточкой');
    }
  }
  if(card.history.length>=1000)throw new Error('Достигнут лимит записей этой карточки');
  card.history.push({at:now,actor:user.id,text:event,requestId:b.requestId||null});
  await save('worklogs',record,record.version);
  await checkWorkDeadlines(origin).catch(e=>console.error('Work reminders:',e));
  return {ok:true,id:card.id};
}

export async function checkWorkDeadlines(origin:string){
  const [logs,users]=await Promise.all([list('worklogs'),list('users')]);const now=Date.now(),recipients=new Set<string>();let created=0;
  for(const log of logs){const name=users.find(u=>u.id===log.id)?.name||log.id;
    const to=users.filter(u=>!u.disabled&&(u.id===log.id||['master','manager'].includes(u.role))).map(u=>u.id);
    for(const c of log.entries){const left=Date.parse(c.due)-now;let kind='',title='';
      if(c.status==='active'&&left<=0){kind='elapsed:'+c.due;title='Время закончилось';}
      else if(c.status==='active'&&c.remindMinutes>0&&left<=c.remindMinutes*60000){kind='reminder:'+c.due;title=`Напоминание: осталось ${Math.max(1,Math.ceil(left/60000))} мин`;}
      else if(c.status==='completed'){kind='completed';title=c.early?'Работа завершена досрочно':'Работа завершена';}
      else if(c.status==='cancelled'){kind='cancelled';title='Занятость отменена';}
      if(!kind)continue;
      const id='work-alert:'+c.id+':'+kind;
      const record={id,workcard:c.id,worker:log.id,order:c.order,title:`${name} · ${title}`,text:`${c.title}. Выполнено ${c.progress}%. ${c.note||''}`,to,created:new Date(now).toISOString()};
      const result=await db().prepare('INSERT OR IGNORE INTO records(id,kind,data,version) VALUES(?,?,?,0)').bind(namespace()+id,namespace()+'alerts',JSON.stringify(record)).run();
      if(result.meta.changes){created++;to.forEach(x=>recipients.add(x));}
    }
  }
  if(recipients.size)await notifyUsers([...recipients],origin).catch(()=>{});
  return created;
}
