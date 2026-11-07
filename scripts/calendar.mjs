import {ID,esc,dateParts} from "./rules.mjs";
export const CALENDAR="wgtgm-mini-calendar";
const JOURNAL="Calendar Events - Mini Calendar";
export const eventId=id=>`mjl-quest-${id}`;
export function storedEvents(id){return game.journal.getName(JOURNAL)?.pages.contents.flatMap(p=>(p.getFlag(CALENDAR,"notes")??[]).filter(n=>n.id===eventId(id)))??[];}
export function calendarReady(){return game.modules.get(CALENDAR)?.active&&game.wgtngmMiniCalender&&typeof game.wgtngmMiniCalender._transactionalNoteUpdate==="function";}
export function eventFor(r,calendar){
  const date=dateParts(calendar,r.deadline);
  return {id:eventId(r.id),title:esc(`Срок: ${r.name}`),icon:"fas fa-scroll",content:`@UUID[${r.uuid}]{Открыть квест}`,hour:date.hour,minute:date.minute,playerTimeDisplay:"exact",playerVisible:true,autoExecuteMacros:false,duration:1,repeatUnit:"none",repeatInterval:1,repeatCount:0,linkedMacros:[],linkedDocuments:[{uuid:r.uuid,name:esc(r.name),type:"JournalEntry"}],userId:game.user.id,isPlayerNote:false,startDate:{year:date.year,month:date.month,day:date.day},[ID]:r.id};
}
export async function syncCalendar(r){
  if(r.type!=="quest")return;
  if(!game.modules.get(CALENDAR)?.active){r.calendar={state:"absent"};return;}
  if(!calendarReady()){r.calendar={state:"error",message:"Mini Calendar ещё не готов или его интерфейс изменился."};return;}
  const app=game.wgtngmMiniCalender,id=eventId(r.id),wanted=r.published&&!r.archived&&r.status==="active"&&r.deadline!=null;
  try{
    const locations=[];
    for(const page of game.journal.getName(JOURNAL)?.pages??[]){
      const notes=page.getFlag(CALENDAR,"notes")??[];
      if(notes.some(n=>n.id===id)){
        const parts=page.name.match(/^(-?\d+)-(\d+)-(\d+)$/);
        if(parts)locations.push({year:Number(parts[1]),month:Number(parts[2])-1,day:Number(parts[3])-1,notes:notes.filter(n=>n.id===id)});
      }
    }
    const note=wanted?eventFor(r,game.time.calendar):null,target=note?.startDate,key=d=>`${d.year}/${d.month}/${d.day}`;
    // Each mutation uses Mini Calendar's own read/merge/save path, preserving unrelated notes.
    const existing=wanted?locations.find(d=>key(d)===key(target))?.notes:null;
    const unchanged=existing?.length===1&&Object.keys(note).every(k=>JSON.stringify(note[k])===JSON.stringify(existing[0][k]));
    if(wanted&&!unchanged)await app._transactionalNoteUpdate(target,notes=>[...notes.filter(n=>n.id!==id),note]);
    for(const date of locations)if(!wanted||key(date)!==key(target))await app._transactionalNoteUpdate(date,notes=>notes.filter(n=>n.id!==id));
    const stored=storedEvents(r.id);
    if(wanted?(stored.length!==1||stored[0].title!==note.title||stored[0].hour!==note.hour||stored[0].minute!==note.minute):stored.length!==0)throw Error("Calendar did not confirm the event update");
    app._clearNotesCache();if(app.rendered)app.render();
    r.calendar={state:wanted?"synced":"none"};
  }catch(error){console.error(`${ID} | calendar`,error);r.calendar={state:"error",message:"Событие не синхронизировано. Повторите синхронизацию."};}
}
export function calendarLabel(r){return {absent:"Mini Calendar не включён",error:r.calendar?.message??"Ожидает синхронизации",synced:"Событие в Mini Calendar",none:""}[r.calendar?.state]??"Ожидает синхронизации";}
