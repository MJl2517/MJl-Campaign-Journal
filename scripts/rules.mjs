export const ID="mjl-campaign-journal";
export const TITLE="MJl - Campaign Journal";
export const TYPES={npc:"Персонажи",location:"Локации",quest:"Квесты"};
export const STATUS={active:"Активен",completed:"Выполнен",failed:"Провален"};
export const PACK=`world.${ID}-private`;
export const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export function need(ok,message){if(!ok)throw Error(message);}
export function mergeTags(...groups){const tags=new Map();for(const tag of groups.flat()){const value=tag.trim();if(value&&!tags.has(value.toLocaleLowerCase("ru")))tags.set(value.toLocaleLowerCase("ru"),value);}return [...tags.values()];}
export function tagChoices(library,selected=[],query="",limit=8){const used=new Set(selected.map(t=>t.toLocaleLowerCase("ru"))),q=query.trim().toLocaleLowerCase("ru"),all=mergeTags(library).filter(t=>!used.has(t.toLocaleLowerCase("ru"))&&t.toLocaleLowerCase("ru").includes(q)).sort((a,b)=>a.localeCompare(b,"ru"));return {items:all.slice(0,limit),total:all.length};}
export function tagAssignments(records,tag){const key=tag.toLocaleLowerCase("ru");return records.filter(r=>r.type==="npc"&&r.published&&r.tags.some(t=>t.toLocaleLowerCase("ru")===key)).map(r=>({id:r.id,revision:r.revision})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);}
export function text(value,max=50000){need(typeof value==="string"&&value.length<=max,"Некорректный или слишком длинный текст.");return value.trim();}
export function imagePath(value){const s=text(value,2048);need(!s||!/^(?:[a-z][a-z\d+.-]*:)/i.test(s)||/^https?:\/\//i.test(s),"Используйте путь Foundry или ссылку http(s).");need(!/[<>\x00-\x1f]/.test(s),"Некорректный путь изображения.");return s;}
export function clock(calendar){const d=calendar.days;return {hour:d.minutesPerHour*d.secondsPerMinute,day:d.hoursPerDay*d.minutesPerHour*d.secondsPerMinute};}
export function dateParts(calendar,time){const c=calendar.timeToComponents(time);return {year:c.year,month:c.month,day:c.dayOfMonth,hour:c.hour,minute:c.minute};}
export function deadlineValue(input,calendar,now){
  need(input&&typeof input==="object","Некорректный срок.");
  if(input.mode==="none")return null;
  if(input.mode==="duration"){
    const days=Number(input.days),hours=Number(input.hours),unit=clock(calendar);
    need(Number.isFinite(days)&&Number.isFinite(hours)&&days>=0&&hours>=0&&days+hours>0,"Укажите положительную длительность.");
    const value=now+days*unit.day+hours*unit.hour;need(Number.isSafeInteger(Math.round(value)),"Слишком большая длительность.");return Math.round(value);
  }
  need(input.mode==="date","Неизвестный способ задания срока.");
  need(["year","month","day","hour","minute"].every(k=>input[k]!==null&&input[k]!==undefined&&String(input[k]).trim()!==""),"Заполните дату и время.");
  const {year,month,day,hour,minute}=Object.fromEntries(["year","month","day","hour","minute"].map(k=>[k,Number(input[k])]));
  need([year,month,day,hour,minute].every(Number.isInteger),"Заполните дату и время.");
  const months=calendar.months.values,leap=calendar.isLeapYear(year),monthDays=m=>leap&&m.leapDays!=null?m.leapDays:m.days;
  need(month>=0&&month<months.length&&day>=0&&day<monthDays(months[month])&&hour>=0&&hour<calendar.days.hoursPerDay&&minute>=0&&minute<calendar.days.minutesPerHour,"Несуществующая дата или время календаря.");
  const yearDay=months.slice(0,month).reduce((n,m)=>n+monthDays(m),day);
  const value=calendar.componentsToTime({year,day:yearDay,hour,minute,second:0});need(Number.isSafeInteger(value),"Некорректная дата.");return value;
}
export function remaining(deadline,now,calendar){
  if(deadline==null)return "Без срока";
  let n=Math.max(0,Math.ceil(deadline-now));if(!n)return "Просрочен";
  const unit=clock(calendar),days=Math.floor(n/unit.day);n-=days*unit.day;const hours=Math.floor(n/unit.hour);n-=hours*unit.hour;
  return `Осталось: ${days?`${days} дн. `:""}${hours?`${hours} ч. `:""}${Math.ceil(n/calendar.days.secondsPerMinute)} мин.`;
}
export function publicData(r,available=true,{parentUuid="",locationVisible=true}={}){
  const base={id:r.id,type:r.type,revision:r.revision,published:r.published&&available};
  if(!base.published)return base;
  const result={...base,name:r.name,notes:r.pointcrawlUuid?"":r.notes,archived:r.archived,uuid:r.uuid};
  if(r.type==="npc"){
    Object.assign(result,{portrait:r.portrait,tags:r.tags,locationUuid:locationVisible?r.locationUuid??"":""});
    if(r.locationUuid&&!locationVisible)result.locationUnknown=true;
  }
  if(r.type==="location")Object.assign(result,{pointcrawlUuid:r.pointcrawlUuid,images:(r.images??[]).map(({src,caption})=>({src,caption}))});
  if(r.type==="location"&&parentUuid)result.parentUuid=parentUuid;
  if(r.type==="quest")Object.assign(result,{description:r.description,status:r.status,conditions:r.conditions,links:r.links,deadline:r.deadline,calendar:r.calendar});
  return result;
}
export function matches(r,query,tag="",gm=false){
  return (!tag||r.tags?.includes(tag))&&[r.name,r.notes,r.description,...(r.tags??[]),...(gm?[r.gmNotes]:[])].join(" ").toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"));
}
export function questMatches(r,filter,now){return filter==="overdue"?r.status==="active"&&r.deadline!=null&&r.deadline<=now:!filter||r.status===filter;}
export function validatePatch(r,values,isGM){
  need(values&&typeof values==="object"&&!Array.isArray(values),"Некорректная запись.");
  const allowed=new Set(["notes","archived"]);
  if(isGM||r.type!=="location")allowed.add("name");
  if(r.type==="npc"){allowed.add("portrait");allowed.add("tags");allowed.add("locationUuid");}
  if(r.type==="quest")for(const k of ["description","status","conditions","links","deadlineInput"])allowed.add(k);
  if(isGM)for(const k of ["gmNotes","published",...(r.type==="npc"?["actorUuid"]:[]),...(r.type==="location"?["images","pointcrawlUuid","parentUuid"]:[])])allowed.add(k);
  for(const key of Object.keys(values))need(allowed.has(key),"Нет права менять это поле.");
  const patch={};
  for(const [key,value]of Object.entries(values)){
    if(["notes","gmNotes","description"].includes(key))patch[key]=text(value);
    else if(key==="name"){patch.name=text(value,200);need(patch.name,"Введите название.");}
    else if(["archived","published"].includes(key)){need(typeof value==="boolean","Некорректный флаг.");patch[key]=value;}
    else if(key==="portrait")patch[key]=imagePath(value);
    else if(key==="tags"){need(Array.isArray(value)&&value.length<=40,"Не больше 40 тегов.");patch.tags=mergeTags(value.map(v=>text(v,80)));}
    else if(key==="status"){need(Object.hasOwn(STATUS,value),"Некорректный статус.");patch.status=value;}
    else if(key==="conditions"){need(Array.isArray(value)&&value.length<=200,"Не больше 200 условий.");patch.conditions=value.map(c=>{need(typeof c.done==="boolean","Некорректная отметка.");return {text:text(c.text,1000),done:c.done};});}
    else if(key==="links"){need(Array.isArray(value)&&value.length<=100,"Не больше 100 ссылок.");patch.links=[...new Set(value.map(v=>text(v,300)))];}
    else if(key==="images"){need(Array.isArray(value)&&value.length<=100,"Не больше 100 артов.");patch.images=value.map(v=>({src:imagePath(v.src),caption:text(v.caption,300)})).filter(v=>v.src);}
    else if(["actorUuid","pointcrawlUuid","locationUuid","parentUuid"].includes(key))patch[key]=text(value,300);
  }
  return patch;
}
