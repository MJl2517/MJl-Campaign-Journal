import {ID,PACK,TYPES,need,publicData,validatePatch,deadlineValue,esc,mergeTags,text,tagAssignments} from "./rules.mjs";
import {syncCalendar,storedEvents} from "./calendar.mjs";
import {initializeVault,sealed,unseal,wrapKey} from "./vault.mjs";
import {copyArt,localizeArt,artIssues,worldImagePath} from "./media.mjs";
export const records=new Map();
const docs=new Map();let socket,initializing,privateReady=false,queue=Promise.resolve();
function recordByUuid(uuid){
  const r=records.get(uuid?.split(".")[1]);
  return r?.uuid===uuid?r:null;
}
const locationChildren=uuid=>[...records.values()].filter(r=>r.type==="location"&&r.parentUuid===uuid);
// ponytail: one GM queue serializes all cards; use per-record queues if saves start contending.
export function enqueue(fn){const next=queue.then(fn);queue=next.catch(()=>{});return next;}
export const pack=()=>game.packs.get(PACK);
const ownership={GAMEMASTER:"OWNER",ASSISTANT:"OWNER",TRUSTED:"NONE",PLAYER:"NONE"};
export function pointcrawlDoc(uuid){const doc=fromUuidSync(uuid);return doc?.documentName==="JournalEntry"&&doc.getFlag("mjl-pointcrawl","notebook")?doc:null;}
export const regionKey=({sceneId,regionId})=>`${sceneId}.${regionId}`;
export function pointcrawlNotebooks(sceneId){
  if(!game.user.isGM||!game.modules.get("mjl-pointcrawl")?.active)return [];
  return game.journal.filter(doc=>{
    const link=doc.getFlag("mjl-pointcrawl","notebook");
    return link&&!link.archived&&(!sceneId||link.sceneId===sceneId);
  }).map(doc=>({doc,link:doc.getFlag("mjl-pointcrawl","notebook")}));
}
export async function pointcrawlChoices(sceneId){
  const notebooks=pointcrawlNotebooks(sceneId),regionsByScene=new Map();
  const api=game.modules.get("mjl-pointcrawl")?.api;
  const usesApi=api?.version===1&&typeof api.listNotebooks==="function";
  const byUuid=new Map(usesApi&&notebooks.length?api.listNotebooks({sceneId}).map(item=>[item.uuid,item]):[]);
  if(!usesApi&&notebooks.some(({link})=>!link.published)){
    const {privateData}=await import(foundry.utils.getRoute("/modules/mjl-pointcrawl/scripts/store.mjs"));
    for(const {link} of notebooks){
      const scene=game.scenes.get(link.sceneId);
      if(!link.published&&scene&&!regionsByScene.has(scene.id))regionsByScene.set(scene.id,privateData(scene).regions);
    }
  }
  const choices=notebooks.map(({doc,link})=>{
    const item=byUuid.get(doc.uuid);
    const region=regionsByScene.get(link.sceneId)?.[link.regionId];
    const location=region?.locations.find(l=>l.id===link.locationId);
    const name=item?.name??(location?`${region.name} — ${location.name}`:region&&!link.locationId?region.name:doc.name);
    const visibility=doc.ownership.default>=2?"":"Скрыто от игроков";
    return {uuid:doc.uuid,name,label:link.locationId?(item?.label??location?.name):undefined,link,notes:visibility,visibility};
  });
  const regions=new Map(choices.filter(r=>!r.link.locationId).map(r=>[regionKey(r.link),r.name]));
  for(const r of choices){
    const parent=r.link.locationId&&regions.get(regionKey(r.link));
    const prefix=`${parent} — `;
    if(parent&&r.name.startsWith(prefix))r.label??=r.name.slice(prefix.length);
  }
  return choices.sort((a,b)=>(a.label??a.name).localeCompare(b.label??b.name,"ru"));
}
export function available(r){
  if(r.type!=="location"||!r.pointcrawlUuid)return true;
  if(!game.modules.get("mjl-pointcrawl")?.active)return false;
  const doc=pointcrawlDoc(r.pointcrawlUuid);return !!doc&&!doc.getFlag("mjl-pointcrawl","notebook").archived&&doc.ownership.default>=2;
}
export function locationSelectable(r,isGM=false){
  return r?.type==="location"&&!r.archived&&(isGM||r.published&&available(r));
}
export function entries(){return game.user.isGM?[...records.values()]:game.journal.map(j=>j.getFlag(ID,"entry")).filter(r=>r?.published);}
export function entry(id){return entries().find(r=>r.id===id);}
export const tagLibrary=()=>game.settings.get(ID,"tagLibrary");
async function rememberTags(tags){const old=tagLibrary(),next=mergeTags(old,tags);if(next.length!==old.length)await game.settings.set(ID,"tagLibrary",next);}
export async function loadPrivate(){
  if(!game.user.isGM||!pack())return;
  const documents=await pack().getDocuments(),gm=game.users.activeGM;
  await initializeVault(documents,socket&&gm&&!gm.isSelf?async publicKey=>{const result=await socket.executeAsUser("key",gm.id,publicKey);need(result?.ok,result?.error??"Мастер не подтвердил передачу ключа.");return result.value;}:null);
  const loaded=new Map();for(const doc of documents){const encrypted=doc.getFlag(ID,"sealed"),r=encrypted?await unseal(encrypted,doc.id):doc.getFlag(ID,"record");if(r)loaded.set(r.id,{r,doc});}
  records.clear();docs.clear();for(const [id,{r,doc}]of loaded){records.set(id,r);docs.set(id,doc);}
  privateReady=true;
}
export async function initialize(){
  if(!game.user.isGM)return;
  if(initializing)return initializing;
  initializing=(async()=>{
    if(!pack()&&game.users.activeGM?.isSelf)await CompendiumCollection.createCompendium({name:`${ID}-private`,label:"Хроника · секреты мастера",type:"JournalEntry",ownership},{render:false});
    if(!pack())return;
    if(game.users.activeGM?.isSelf&&(pack().locked||["PLAYER","TRUSTED"].some(role=>pack().ownership[role]!=="NONE")))await pack().configure({ownership,locked:false});
    await loadPrivate();
  })();
  try{await initializing;}finally{initializing=null;}
}
async function save(r){
  const doc=docs.get(r.id);
  const data={name:`Хроника ${r.id}`,flags:{[ID]:{sealed:await sealed(r)}}};
  const saved=doc?await doc.update(data,{broadcast:false,diff:false,recursive:false}):await JournalEntry.create({_id:r.id,...data,ownership:{default:0}},{pack:PACK,keepId:true,broadcast:false,render:false});
  docs.set(r.id,saved);records.set(r.id,foundry.utils.deepClone(r));
}
async function folder(type){let f=game.folders.find(f=>f.type==="JournalEntry"&&f.getFlag(ID,"folder")===type);if(!f)f=await Folder.create({name:`Хроника · ${TYPES[type]}`,type:"JournalEntry",flags:{[ID]:{folder:type}}});return f;}
export async function publish(r,{placeholder=false}={}){
  const parent=r.parentUuid&&recordByUuid(r.parentUuid);
  const parentUuid=!r.pointcrawlUuid&&parent?.type==="location"&&!parent.pointcrawlUuid&&parent.published?parent.uuid:"";
  const locationVisible=!r.locationUuid||locationSelectable(recordByUuid(r.locationUuid));
  const p=publicData(r,available(r),{parentUuid,locationVisible});let doc=game.journal.get(r.id);
  if(p.published&&p.type==="npc")await rememberTags(p.tags);
  if(!p.published&&!doc&&!placeholder)return;
  const name=p.published?p.name:"Недоступная запись",body=p.published?`<h2>${esc(name)}</h2><p>${esc(p.description??"").replace(/\n/g,"<br>")}</p><p>${esc(p.notes??"").replace(/\n/g,"<br>")}</p>${p.type==="quest"?`<ul>${p.conditions.map(c=>`<li>${c.done?"☑":"☐"} ${esc(c.text)}</li>`).join("")}</ul>`:""}`:"<p>Запись недоступна.</p>";
  if(doc&&doc.name===name&&doc.ownership.default===(p.published?2:0)&&JSON.stringify(doc.getFlag(ID,"entry"))===JSON.stringify(p)&&doc.pages.contents[0]?.text.content===body)return;
  const data={name,ownership:{default:p.published?2:0},flags:{[ID]:{entry:p}},folder:(await folder(r.type)).id};
  if(!doc)doc=await JournalEntry.create({_id:r.id,...data,pages:[{name:"Запись",type:"text",text:{format:1,content:body}}]},{keepId:true,render:false});
  else{
    await doc.update(data,{diff:false,recursive:false});
    if(doc.pages.size)await doc.pages.contents[0].update({name:"Запись","text.content":body});
    else await doc.createEmbeddedDocuments("JournalEntryPage",[{name:"Запись",type:"text",text:{format:1,content:body}}]);
  }
}
async function publishOccupants(uuid){
  for(const r of records.values())if(r.type==="npc"&&r.locationUuid===uuid)await publish(r);
}
export async function reconcile(){
  if(!game.users.activeGM?.isSelf)return;
  for(const original of records.values()){
    const r=foundry.utils.deepClone(original);
    try{if(await localizeArt(r))r.revision++;}catch(error){artIssues.set(r.id,error.message);}
    await syncCalendar(r);if(!docs.get(r.id)?.getFlag(ID,"sealed")||JSON.stringify(r)!==JSON.stringify(original))await save(r);await publish(r);
  }
  refresh();
}
export function refresh(){Hooks.callAll(`${ID}.refresh`);game.socket.emit(`module.${ID}`,{type:"refresh"});}
function publicAccess(r,user){return r?.published&&available(r)&&game.journal.get(r.id)?.testUserPermission(user,"OBSERVER");}
function artNotebook(uuid){
  if(!game.modules.get("mjl-pointcrawl")?.active||typeof uuid!=="string"||!/^JournalEntry\.[a-z\d]+$/i.test(uuid))return null;
  const doc=pointcrawlDoc(uuid);
  return doc&&!doc.getFlag("mjl-pointcrawl","notebook").archived?doc:null;
}
function artCard(cards,uuid,user){
  return cards.filter(r=>r.type==="location"&&!r.archived&&r.pointcrawlUuid===uuid&&(user.isGM||publicAccess(r,user)))
    .sort((a,b)=>Number(b.published)-Number(a.published)||a.id.localeCompare(b.id))[0];
}
export function pointcrawlArt(uuid){
  const doc=artNotebook(uuid),user=game.user;
  if(!doc||!doc.testUserPermission(user,"OBSERVER"))return null;
  const r=artCard(entries(),uuid,user);
  return r?{src:r.images[0]?.src??""}:null;
}
function newRecord(type,isGM){
  const id=foundry.utils.randomID();
  return {id,uuid:`JournalEntry.${id}`,type,name:type==="npc"?"Новый персонаж":type==="quest"?"Новый квест":"Новая локация",notes:"",gmNotes:"",tags:[],portrait:"",actorUuid:"",locationUuid:"",images:[],pointcrawlUuid:"",published:type==="quest"||!isGM,archived:false,description:"",status:"active",conditions:[],links:[],deadline:null,revision:0,calendar:{state:"none"},notifiedDeadline:null};
}
export async function processRequest(args,userId){
  need(game.users.activeGM?.isSelf,"Активный мастер сменился. Повторите действие.");
  need(privateReady,"Хранилище мастера ещё открывается. Повторите сохранение через несколько секунд.");
  const user=game.users.get(userId);need(user?.active,"Пользователь не подключён.");need(args&&typeof args==="object","Некорректный запрос.");
  const {action,id,values={}}=args;
  if(action==="sync"){need(user.isGM,"Синхронизацию запускает мастер.");await reconcile();return;}
  if(action==="importPointcrawl"){
    need(user.isGM,"Импорт локаций доступен мастеру.");
    need(typeof args.sceneId==="string"&&game.scenes.has(args.sceneId),"Выберите существующую сцену.");
    const choices=await pointcrawlChoices(args.sceneId);
    need(choices.length,"На этой сцене нет журналов Pointcrawl для импорта.");
    const linked=new Set([...records.values()].filter(r=>r.type==="location").map(r=>r.pointcrawlUuid));
    let imported=0;
    try{
      for(const choice of choices){
        if(linked.has(choice.uuid))continue;
        const r=newRecord("location",true);
        Object.assign(r,validatePatch(r,{name:(choice.label??choice.name).slice(0,200),pointcrawlUuid:choice.uuid},true),{revision:1});
        await save(r);linked.add(choice.uuid);imported++;
      }
    }finally{if(imported)refresh();}
    return {imported,skipped:choices.length-imported};
  }
  if(action==="deleteTag"){
    const key=text(args.tag,80).toLocaleLowerCase("ru"),tag=tagLibrary().find(t=>t.toLocaleLowerCase("ru")===key);need(tag,"Тег уже удалён из общего списка.");
    const affected=tagAssignments([...records.values()].filter(r=>user.isGM||publicAccess(r,user)),tag);
    need(Array.isArray(args.expected)&&JSON.stringify(args.expected)===JSON.stringify(affected),"Использование тега изменилось. Обновите список и повторите удаление.");
    for(const {id} of affected){const r=foundry.utils.deepClone(records.get(id));r.tags=r.tags.filter(t=>t.toLocaleLowerCase("ru")!==key);r.revision++;await save(r);await publish(r);}
    await game.settings.set(ID,"tagLibrary",tagLibrary().filter(t=>t.toLocaleLowerCase("ru")!==key));refresh();return {updated:affected.map(({id})=>({id,revision:records.get(id).revision}))};
  }
  let r=records.get(id);
  if(action==="setPointcrawlArt"){
    need(user.isGM,"Арт Pointcrawl меняет мастер.");
    const doc=artNotebook(args.notebookUuid);need(doc,"Журнал Pointcrawl недоступен.");
    const current=artCard([...records.values()],doc.uuid,user);
    r=current?foundry.utils.deepClone(current):newRecord("location",true);
    if(!current)Object.assign(r,validatePatch(r,{name:args.name,pointcrawlUuid:doc.uuid,published:true},true));
    const src=await copyArt(args.src);need(src,"Выберите изображение.");
    if(r.images[0]?.src!==src){
      r.images=[{src,caption:r.images[0]?.caption??""},...r.images.slice(1)];
      r.revision++;await save(r);
    }
    await publish(r);refresh();return {src};
  }
  if(action==="prepareMapLocation"){
    need(user.isGM&&locationSelectable(r,true),"Выберите существующую локацию вне архива.");
    await publish(r,{placeholder:true});
    return {id:r.id};
  }
  if(action==="create"){
    need(Object.hasOwn(TYPES,args.type),"Неизвестный вид записи.");need(user.isGM||args.type!=="location","Локации создаёт мастер.");
    r=newRecord(args.type,user.isGM);
  }else{
    need(r&&(user.isGM||publicAccess(r,user)),"Запись недоступна.");r=foundry.utils.deepClone(r);
    need(args.revision===r.revision,"Запись уже изменена другим участником. Ваш текст оставлен в форме: скопируйте его и откройте свежую запись.");
  }
  if(action==="delete"){
    need(user.isGM,"Окончательно удаляет записи только мастер.");need(r.archived,"Сначала поместите запись в архив.");
    r.published=false;await syncCalendar(r);need(r.calendar?.state!=="error","Не удалось убрать событие календаря; удаление отменено.");
    need(!storedEvents(r.id).length,"Событие ещё осталось в календаре. Включите Mini Calendar и повторите удаление.");
    await game.journal.get(r.id)?.delete();await docs.get(r.id).delete({broadcast:false});records.delete(r.id);docs.delete(r.id);artIssues.delete(r.id);
    if(r.type==="location"){
      for(const child of locationChildren(r.uuid)){
        const detached={...child,parentUuid:"",revision:child.revision+1};
        await save(detached);await publish(detached);
      }
      await publishOccupants(r.uuid);
    }
    refresh();return;
  }
  need(["create","save"].includes(action),"Неизвестное действие.");
  const patch=validatePatch(r,values,user.isGM);
  if(!user.isGM&&patch.portrait&&patch.portrait!==r.portrait&&worldImagePath(patch.portrait,game.world.id)===null)need(user.can("FILES_UPLOAD"),"Для копирования нового арта в мир нужны штатные права Foundry «Загрузка файлов». Попросите мастера включить их или выберите уже сохранённый в этом мире арт.");
  if(patch.tags)patch.tags=mergeTags(tagLibrary(),patch.tags).filter(t=>patch.tags.some(v=>v.toLocaleLowerCase("ru")===t.toLocaleLowerCase("ru")));
  if(patch.locationUuid){
    const target=recordByUuid(patch.locationUuid);
    need(locationSelectable(target,user.isGM)&&(user.isGM||publicAccess(target,user)),user.isGM?"Выберите локацию вне архива.":"Выберите открытую локацию.");
  }
  if(patch.actorUuid){const actor=await fromUuid(patch.actorUuid);need(actor?.documentName==="Actor","Перетащите Actor Foundry.");}
  if(patch.parentUuid){
    const parent=recordByUuid(patch.parentUuid);
    need(!r.archived&&!patch.archived&&!(patch.pointcrawlUuid??r.pointcrawlUuid)&&parent?.type==="location"&&!parent.archived&&!parent.pointcrawlUuid,"Выберите самостоятельную локацию вне архива.");
    const seen=new Set([r.uuid]);
    for(let ancestor=parent;ancestor;ancestor=recordByUuid(ancestor.parentUuid)){
      need(!seen.has(ancestor.uuid),"Нельзя вложить локацию в себя или в её подлокацию.");
      seen.add(ancestor.uuid);
    }
  }
  if(patch.pointcrawlUuid&&patch.pointcrawlUuid!==r.pointcrawlUuid){
    need(!recordByUuid(patch.parentUuid??r.parentUuid)&&!locationChildren(r.uuid).length,"Перед привязкой к Pointcrawl переместите карточку и её подлокации на верхний уровень.");
  }
  if(patch.pointcrawlUuid){need(pointcrawlDoc(patch.pointcrawlUuid),"Выберите существующий журнал Pointcrawl.");need(patch.pointcrawlUuid===r.pointcrawlUuid||!r.notes,"Перед связыванием перенесите прежние заметки в Pointcrawl и сохраните карточку с пустыми общими заметками.");need(!(Object.hasOwn(patch,"notes")&&patch.notes),"Общие заметки связанного места ведутся в журнале Pointcrawl.");}
  if(r.pointcrawlUuid&&Object.hasOwn(patch,"notes"))need(!patch.notes,"Общие заметки ведутся в журнале Pointcrawl.");
  if(patch.links)for(const uuid of patch.links){if(r.links.includes(uuid))continue;const target=[...records.values()].find(r=>r.uuid===uuid);need(target&&target.type!=="quest"&&(target.type!=="location"||target.published&&!target.archived&&available(target))&&(user.isGM||publicAccess(target,user)),"Ссылка на недоступную запись.");}
  if(Object.hasOwn(values,"deadlineInput"))patch.deadline=deadlineValue(values.deadlineInput,game.time.calendar,game.time.worldTime);
  const visibilityChanged=r.type==="location"&&Object.hasOwn(patch,"published")&&patch.published!==r.published;
  const wasSelectable=locationSelectable(r);
  Object.assign(r,patch);r.revision++;
  try{await localizeArt(r);}catch(error){
    const old=records.get(r.id),sources=v=>v?.type==="npc"?v.portrait:v?.type==="location"?v.images.map(i=>i.src):null;
    if(!old||JSON.stringify(sources(old))!==JSON.stringify(sources(r)))throw error;
    artIssues.set(r.id,error.message);
  }
  // Save the authoritative record first: a calendar or projection failure must not lose the edit.
  await save(r);await syncCalendar(r);await save(r);await publish(r);
  if(visibilityChanged)for(const child of locationChildren(r.uuid))await publish(child);
  if(r.type==="location"&&wasSelectable!==locationSelectable(r))await publishOccupants(r.uuid);
  refresh();
  return {id:r.id,revision:r.revision};
}
export async function checkDeadlines(){
  if(!game.users.activeGM?.isSelf)return;
  for(const original of records.values())if(original.type==="quest"&&original.published&&!original.archived&&original.status==="active"&&original.deadline!=null&&original.deadline<=game.time.worldTime&&original.notifiedDeadline!==original.deadline){
    const r=foundry.utils.deepClone(original);r.notifiedDeadline=r.deadline;await save(r);
    const message=`Просрочен квест: ${r.name}`;ui.notifications.warn(message);game.socket.emit(`module.${ID}`,{type:"overdue",id:r.id});
  }
}
export function connectSocket(){
  if(socket)return socket;
  const module=game.modules.get("socketlib"),version=module?.version?.replace(/^v/i,"");
  if(!module?.active||!version||foundry.utils.isNewerVersion("1.1.4",version)||!game.modules.get(ID)?.socket)return;
  const connection=globalThis.socketlib?.registerModule(ID);
  if(!connection)return;
  connection.register("key",async function(publicKey){try{need(game.users.get(this.socketdata.userId)?.isGM,"Ключ доступен только мастеру.");need(game.users.activeGM?.isSelf,"Повторите запрос активному мастеру.");return {ok:true,value:await wrapKey(publicKey)};}catch(error){return {ok:false,error:error.message};}});
  connection.register("request",function(args){const sender=this.socketdata.userId;return enqueue(async()=>{try{return {ok:true,value:await processRequest(args,sender)};}catch(error){console.error(`${ID} |`,error);return {ok:false,error:error.message};}});});
  return socket=connection;
}
export function writeBlock(){
  const gm=game.users.activeGM;
  if(!gm)return "Мастер не подключён.";
  if(gm.isSelf)return privateReady?"":"Хранилище мастера ещё открывается.";
  return socket?"":"Для совместного редактирования нужен активный Socketlib 1.1.4 или новее.";
}
export async function request(args){
  const block=writeBlock();need(!block,block);
  const gm=game.users.activeGM;
  if(gm.isSelf)return enqueue(()=>processRequest(args,game.user.id));
  const result=await socket.executeAsUser("request",gm.id,args);need(result?.ok,result?.error??"Сохранение не подтверждено. Обновите список перед повтором.");return result.value;
}
