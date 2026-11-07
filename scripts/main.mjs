import {ID,TITLE,TYPES,need} from "./rules.mjs";
import {initialize,loadPrivate,connectSocket,enqueue,reconcile,checkDeadlines,entries,entry,request,available} from "./store.mjs";
import {ChronicleApp,TagLibraryApp,locationChoices} from "./app.mjs";
import {registerVault,VaultMenu} from "./vault.mjs";
class NPCMenu extends ChronicleApp{constructor(){super({id:`${ID}-npc`});this.type="npc";ChronicleApp.instances.set(this.type,this);}}
class LocationMenu extends ChronicleApp{constructor(){super({id:`${ID}-location`});this.type="location";ChronicleApp.instances.set(this.type,this);}}
class QuestMenu extends ChronicleApp{constructor(){super({id:`${ID}-quest`});this.type="quest";ChronicleApp.instances.set(this.type,this);}}
Hooks.once("init",()=>{
  game.settings.register(ID,"tagLibrary",{scope:"world",config:false,type:Array,default:[]});
  registerVault();game.settings.registerMenu(ID,"vault",{name:`${TITLE} · ключ мастера`,label:"Сохранить / восстановить ключ",icon:"fa-solid fa-key",type:VaultMenu,restricted:true});
  for(const [type,App]of [["npc",NPCMenu],["location",LocationMenu],["quest",QuestMenu]])game.settings.registerMenu(ID,type,{name:`${TITLE} · ${TYPES[type]}`,label:"Открыть",icon:"fa-solid fa-book-open",type:App,restricted:false});
});
Hooks.once("socketlib.ready",connectSocket);
const notify=error=>{console.error(`${ID} |`,error);ui.notifications.error(`Хроника: ${error.message}`);};
function openMapLocation(id){
  const r=entry(id);
  need(r?.type==="location"&&(game.user.isGM||r.published&&available(r)&&game.journal.get(id)?.testUserPermission(game.user,"OBSERVER")),"Локация недоступна.");
  return ChronicleApp.open("location",r.id);
}
let refreshTimer,syncTimer;
function render(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(TagLibraryApp.instance?.rendered&&!TagLibraryApp.instance.busy)TagLibraryApp.instance.render();for(const app of ChronicleApp.instances.values())if(app.rendered&&!app.busy){if(!app.dirty)app.render();else if(app.type==="quest"){app.filterRows();const r=entry(app.selected),counter=app.element.querySelector(".cj-countdown");if(r&&counter)import("./rules.mjs").then(m=>{counter.textContent=m.remaining(r.deadline,game.time.worldTime,game.time.calendar);});}}},80);}
function sync(){clearTimeout(syncTimer);syncTimer=setTimeout(()=>enqueue(reconcile).catch(notify),250);}
Hooks.once("ready",async()=>{
  try{
    connectSocket();
    game.modules.get(ID).api=Object.freeze({version:1,openNPCs:()=>ChronicleApp.open("npc"),openLocations:()=>ChronicleApp.open("location"),openQuests:()=>ChronicleApp.open("quest"),openEntry:uuid=>{const r=entries().find(r=>r.uuid===uuid);need(r,"Запись недоступна.");return ChronicleApp.open(r.type,r.id);},
      mapLocations:()=>locationChoices(game.user.isGM).map(r=>({id:r.id,name:r.name,visible:r.published&&available(r)})),
      prepareMapLocation:async({id,name})=>{
        if(name)({id}=await request({action:"create",type:"location",values:{name}}));
        return (await request({action:"prepareMapLocation",id})).id;
      },
      openMapLocation});
    game.socket.on(`module.${ID}`,message=>{if(message?.type==="refresh"){if(game.user.isGM&&!game.users.activeGM?.isSelf)loadPrivate().then(render).catch(notify);else render();}if(message?.type==="overdue"){const r=entry(message.id);if(r)ui.notifications.warn(`Просрочен квест: ${r.name}`);}});
    await initialize();if(game.users.activeGM?.isSelf){await enqueue(reconcile);await enqueue(checkDeadlines);}render();
  }catch(e){notify(e);}
});
Hooks.on("activateNote",note=>{
  const {document:doc}=note;
  if(doc.pageId||doc.flags?.["mjl-dungeon-sketch"]?.poi!=="chronicle")return;
  try{openMapLocation(doc.entryId);}catch(error){notify(error);}
  return false;
});
Hooks.on("refreshNote",note=>{
  const {document:doc,tooltip}=note;
  if(!game.user.isGM||doc.text||doc.flags?.["mjl-dungeon-sketch"]?.poi!=="chronicle")return;
  const r=entry(doc.entryId);
  if(r?.type==="location"&&tooltip)tooltip.text=r.name;
});
Hooks.on("getSceneControlButtons",controls=>{
  if(!controls.tokens)return;
  controls[ID]={name:ID,title:"Хроника",icon:"fa-solid fa-book-open",order:9,layer:"tokens",visible:true,tools:Object.fromEntries(Object.entries(TYPES).map(([type,title],order)=>[type,{name:type,title,order,icon:type==="npc"?"fa-solid fa-address-book":type==="location"?"fa-solid fa-images":"fa-solid fa-scroll",button:true,onChange:(_event,active)=>{if(active)ChronicleApp.open(type);}}]))};
});
Hooks.on(`${ID}.refresh`,render);
Hooks.on("updateWorldTime",()=>{render();enqueue(checkDeadlines).catch(notify);});
Hooks.on("userConnected",()=>{render();if(game.users.activeGM?.isSelf)enqueue(async()=>{await initialize();await reconcile();}).catch(notify);});
for(const hook of ["updateJournalEntry","deleteJournalEntry"])Hooks.on(hook,doc=>{render();if(doc.getFlag("mjl-pointcrawl","notebook"))sync();});
Hooks.on("updateSetting",doc=>{if(doc.key?.startsWith("wgtgm-mini-calendar.calendar"))sync();if(doc.key===`${ID}.tagLibrary`)render();});
Hooks.on("renderJournalEntrySheet",(app,html)=>{
  const r=app.document?.getFlag(ID,"entry");if(!r?.published||html.querySelector(".cj-open-card"))return;
  const button=document.createElement("button");button.type="button";button.className="cj-open-card";button.textContent="Хроника · открыть карточку";button.onclick=()=>ChronicleApp.open(r.type,r.id);html.querySelector(".journal-header")?.append(button);
});
