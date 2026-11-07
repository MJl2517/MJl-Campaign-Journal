import assert from "node:assert/strict";
import {publicData,validatePatch,matches,imagePath,deadlineValue,remaining,clock,esc,mergeTags,tagChoices,tagAssignments,questMatches} from "../scripts/rules.mjs";
import {eventFor,eventId} from "../scripts/calendar.mjs";
let count=0;const check=(name,fn)=>{fn();count++;console.log(`PASS ${name}`);};
const r={id:"a",uuid:"JournalEntry.a",type:"npc",name:"Капитан",notes:"Видели в гавани",tags:["Союзник"],portrait:"worlds/test/a.png",published:true,revision:2,archived:false,gmNotes:"SECRET",actorUuid:"Actor.SECRET",images:[{src:"SECRET.png"}],status:"active",description:"Поручение",conditions:[{text:"Найти",done:false}],links:[],deadline:100,calendar:{state:"synced"}};
check("public NPC excludes all secrets",()=>{const p=publicData(r);assert.equal(p.name,r.name);assert(!JSON.stringify(p).includes("SECRET"));assert.deepEqual(Object.keys(p).sort(),["id","uuid","type","revision","published","name","notes","archived","portrait","tags","locationUuid"].sort());});
check("older NPC defaults to no location",()=>assert.equal(publicData(r).locationUuid,""));
check("hidden NPC location publishes an unknown marker without its UUID",()=>{
  const npc={...r,locationUuid:"JournalEntry.SECRET"};
  const projected=publicData(npc,true,{locationVisible:false});
  assert.equal(projected.locationUnknown,true);
  assert.equal(projected.locationUuid,"");
  assert(!JSON.stringify(projected).includes(npc.locationUuid));
  assert.equal(publicData(npc).locationUuid,npc.locationUuid);
});
check("NPC location reference accepts string and clearing",()=>{assert.deepEqual(validatePatch(r,{locationUuid:" JournalEntry.location "},false),{locationUuid:"JournalEntry.location"});assert.deepEqual(validatePatch(r,{locationUuid:""},false),{locationUuid:""});assert.throws(()=>validatePatch({...r,type:"quest"},{locationUuid:"x"},false));});
check("unpublished projection contains no name or content",()=>assert.deepEqual(publicData({...r,published:false}),{id:"a",type:"npc",revision:2,published:false}));
check("closed Pointcrawl location is redacted",()=>assert(!JSON.stringify(publicData({...r,type:"location"},false)).includes("Капитан")));
check("open location shares art and captions but excludes GM fields and original sources",()=>{const p=publicData({...r,type:"location",pointcrawlUuid:"JournalEntry.p",images:[{src:"worlds/test/view.webp",caption:"Вид гавани",gmNote:"SECRET"}],artOriginals:{images:[{src:"SECRET_SOURCE"}]}});assert.equal(p.notes,"");assert.deepEqual(p.images,[{src:"worlds/test/view.webp",caption:"Вид гавани"}]);assert(!JSON.stringify(p).includes("SECRET"));assert(!JSON.stringify(publicData({...r,type:"location",published:false})).includes("images"));});
check("quest projection contains checklist and fixed deadline",()=>{const p=publicData({...r,type:"quest"});assert.equal(p.deadline,100);assert.equal(p.conditions[0].done,false);assert(!JSON.stringify(p).includes("SECRET"));});
for(const key of ["gmNotes","published","actorUuid","images","pointcrawlUuid","revision","id","type","calendar","notifiedDeadline"])check(`player cannot patch ${key}`,()=>assert.throws(()=>validatePatch(r,{[key]:"x"},false),/Нет права/));
check("only GM can move a location; public parent is explicit",()=>{
  const location={...r,type:"location",parentUuid:"JournalEntry.parent"};
  assert.throws(()=>validatePatch(location,{parentUuid:""},false),/Нет права/);
  assert.deepEqual(validatePatch(location,{parentUuid:""},true),{parentUuid:""});
  assert.equal(publicData(location).parentUuid,undefined);
  assert.equal(publicData(location,true,{parentUuid:location.parentUuid}).parentUuid,location.parentUuid);
  assert.equal(publicData(location,false,{parentUuid:location.parentUuid}).parentUuid,undefined);
});
check("player cannot rename location",()=>assert.throws(()=>validatePatch({...r,type:"location"},{name:"x"},false)));
check("player edits NPC and normalizes tags",()=>assert.deepEqual(validatePatch(r,{name:" X ",notes:" text ",tags:["a"," a ",""]},false),{name:"X",notes:"text",tags:["a"]}));
check("quest validation",()=>assert.deepEqual(validatePatch({...r,type:"quest"},{conditions:[{text:" X ",done:true}],links:["a","a"],status:"completed"},false),{conditions:[{text:"X",done:true}],links:["a"],status:"completed"}));
check("reject invalid status",()=>assert.throws(()=>validatePatch({...r,type:"quest"},{status:"__proto__"},false)));
check("reject malformed checkbox",()=>assert.throws(()=>validatePatch({...r,type:"quest"},{conditions:[{text:"X",done:"false"}]},false)));
check("reject oversized payload",()=>assert.throws(()=>validatePatch(r,{notes:"x".repeat(50001)},false)));
check("case insensitive Russian search and tags",()=>{assert(matches(r,"КАПИТАН","Союзник"));assert(matches(r,"ГАВАНИ"));assert(!matches(r,"secret"));assert(matches(r,"secret","",true));assert(!matches(r,"","Враг"));});
for(const value of ["javascript:alert(1)","data:image/svg+xml,x","file:///x","blob:a","<svg>","a\nx"])check(`reject unsafe image ${value.slice(0,15)}`,()=>assert.throws(()=>imagePath(value)));
check("accept image paths and http(s)",()=>{assert.equal(imagePath("worlds/test/a.webp"),"worlds/test/a.webp");assert.equal(imagePath("https://example.org/a.png"),"https://example.org/a.png");});
const calendar={days:{hoursPerDay:10,minutesPerHour:20,secondsPerMinute:30},months:{values:[{days:3},{days:4,leapDays:5}]},isLeapYear:y=>y===4,componentsToTime:c=>c.year*100000+c.day*6000+c.hour*600+c.minute*30,timeToComponents:t=>({year:4,month:1,dayOfMonth:2,hour:3,minute:4})};
check("custom calendar units",()=>assert.deepEqual(clock(calendar),{hour:600,day:6000}));
check("relative deadline uses calendar and becomes absolute",()=>assert.equal(deadlineValue({mode:"duration",days:2,hours:3},calendar,100),13900));
check("date counts day of year and zero based month/day",()=>assert.equal(deadlineValue({mode:"date",year:4,month:1,day:4,hour:9,minute:19},calendar,0),447970));
check("non-leap invalid day rejected",()=>assert.throws(()=>deadlineValue({mode:"date",year:3,month:1,day:4,hour:0,minute:0},calendar,0)));
for(const input of [{mode:"duration",days:0,hours:0},{mode:"duration",days:-1,hours:2},{mode:"duration",days:"x",hours:0},{mode:"date",year:1,month:8,day:0,hour:0,minute:0}])check("invalid duration/date",()=>assert.throws(()=>deadlineValue(input,calendar,0)));
check("no deadline",()=>assert.equal(deadlineValue({mode:"none"},calendar,100),null));
check("countdown exact boundary and rewind",()=>{assert.equal(remaining(100,100,calendar),"Просрочен");assert.equal(remaining(100,101,calendar),"Просрочен");assert.equal(remaining(100,70,calendar),"Осталось: 1 мин.");assert.equal(remaining(null,0,calendar),"Без срока");});
check("event identity stable, visible, no macros",()=>{globalThis.game={user:{id:"gm"}};const n=eventFor({...r,type:"quest"},calendar);assert.equal(n.id,eventId(r.id));assert.equal(n.hour,3);assert.equal(n.playerVisible,true);assert.equal(n.autoExecuteMacros,false);assert.deepEqual(n.linkedMacros,[]);assert(!JSON.stringify(n).includes("SECRET"));});
check("HTML is escaped",()=>assert.equal(esc('<img onerror="x">'),"&lt;img onerror=&quot;x&quot;&gt;"));
globalThis.foundry={applications:{api:{ApplicationV2:class{}}}};
const settings=new Map();globalThis.game={user:{isGM:true},world:{id:"test"},settings:{get:()=>settings.get("keys")??{},set:async(_id,_key,value)=>settings.set("keys",value)}};
const vault=await import("../scripts/vault.mjs");
await vault.useKey(btoa("x".repeat(32)));
const encrypted=await vault.sealed({...r,notes:"x".repeat(150000)});
check("vault has no plaintext and handles long notes",()=>{assert(!JSON.stringify(encrypted).includes("SECRET"));assert(encrypted.iv&&encrypted.ciphertext);});
assert.equal((await vault.unseal(encrypted,r.id)).gmNotes,"SECRET");count++;console.log("PASS vault encryption round trip");
await assert.rejects(()=>vault.unseal(encrypted,"other-id"));count++;console.log("PASS ciphertext bound to record identity");
await assert.rejects(()=>vault.useKey(btoa("y".repeat(32)),encrypted.keyId));count++;console.log("PASS wrong recovery key rejected");
const pair=await crypto.subtle.generateKey({name:"RSA-OAEP",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},false,["encrypt","decrypt"]);
const wrapped=await vault.wrapKey(await crypto.subtle.exportKey("jwk",pair.publicKey));
const unwrapped=await crypto.subtle.decrypt({name:"RSA-OAEP"},pair.privateKey,Uint8Array.from(atob(wrapped.ciphertext),c=>c.charCodeAt(0)));
check("GM key transfer encrypted for recipient",()=>assert.equal(new TextDecoder().decode(unwrapped),"x".repeat(32)));
const {syncCalendar}=await import("../scripts/calendar.mjs");
Object.assign(game,{user:{id:"gm",isGM:true},modules:new Map([["wgtgm-mini-calendar",{active:true}]]),journal:{getName:()=>({pages:{contents:[]}})},time:{calendar},wgtngmMiniCalender:{_transactionalNoteUpdate:async()=>{}}});
const silentFailure={...r,type:"quest"},savedError=console.error;console.error=()=>{};try{await syncCalendar(silentFailure);}finally{console.error=savedError;}
check("silent calendar write failure is not reported as synchronized",()=>assert.equal(silentFailure.calendar.state,"error"));
const handlers=new Map();globalThis.Hooks={once(){},on:(name,fn)=>handlers.set(name,fn)};
await import("../scripts/main.mjs");
const controls={tokens:{}};handlers.get("getSceneControlButtons")(controls);
const toolbar=controls["mjl-campaign-journal"],{ChronicleApp}=await import("../scripts/app.mjs"),opened=[],savedOpen=ChronicleApp.open;
ChronicleApp.open=type=>opened.push(type);
try{
  check("category has no default window button",()=>assert.equal(toolbar.activeTool,undefined));
  for(const [type,tool]of Object.entries(toolbar.tools)){
    check(`${type} ignores deactivation`,()=>{const before=opened.length;tool.onChange({},false);assert.equal(opened.length,before);});
    check(`${type} opens on button activation`,()=>{tool.onChange({},true);assert.equal(opened.at(-1),type);assert.equal(tool.button,true);});
  }
}finally{ChronicleApp.open=savedOpen;}
game.user.isGM=false;game.journal.map=fn=>[{getFlag:()=>publicData(r)}].map(fn);game.i18n={localize:v=>v};game.time.worldTime=0;
const previewApp={selected:r.id,sections:new Map(),fold:ChronicleApp.prototype.fold};
for(const type of ["npc","location","quest"])check(`${type} preview has no editing fields or setup buttons`,()=>{const html=ChronicleApp.prototype.cardPreview.call(previewApp,{...r,type,images:[{src:"worlds/test/location.webp",caption:"Гавань"}],notes:'<script>bad()</script>'},true);assert(html.includes('data-cj-action="edit"'));assert(!/<(?:textarea|select)\b/.test(html));assert.equal((html.match(/<input/g)??[]).length,type==="quest"?1:0);if(type==="quest")assert(html.includes("data-cj-condition-check"));assert(!/data-cj-action="(?:save|picker|archive|delete|removeLink)"/.test(html));assert(!html.includes("SECRET"));assert(!html.includes("<script>"));});


check("tag labels trim and deduplicate across Russian letter case",()=>assert.deepEqual(mergeTags([" Союзник ","Гавань"],["союзник","НОВЫЙ","новый"]),["Союзник","Гавань","НОВЫЙ"]));

check("quest preview disables quick checks without an active GM",()=>{const html=ChronicleApp.prototype.cardPreview.call(previewApp,{...r,type:"quest"},false);assert.match(html,/<input type="checkbox" data-cj-condition-check="0"[^>]*disabled/);});
check("500 free tags render at most eight suggestions, rare query finds the end",()=>{const tags=Array.from({length:500},(_,i)=>`Тег ${String(i).padStart(3,"0")}`);assert.equal(tagChoices(tags).items.length,8);assert.equal(tagChoices(tags).total,500);assert.deepEqual(tagChoices(tags,[],"ТЕГ 499").items,["Тег 499"]);assert.equal(tagChoices(tags,["тег 499"],"499").total,0);});
check("global tag deletion targets only shared NPCs, including archive",()=>assert.deepEqual(tagAssignments([{id:"b",type:"npc",published:true,tags:["СОЮЗНИК"],revision:2,archived:true},{id:"a",type:"npc",published:true,tags:["Союзник"],revision:1},{id:"secret",type:"npc",published:false,tags:["Союзник"],revision:5},{id:"quest",type:"quest",published:true,tags:["Союзник"],revision:1}],"союзник"),[{id:"a",revision:1},{id:"b",revision:2}]));
check("quest filters cover all manual states, expired boundary and rewind",()=>{const q={status:"active",deadline:100};assert(questMatches(q,"",100));assert(questMatches(q,"active",100));assert(questMatches(q,"overdue",100));assert(!questMatches(q,"overdue",99));assert(!questMatches({...q,status:"completed"},"overdue",101));assert(questMatches({...q,status:"completed"},"completed",101));assert(questMatches({...q,status:"failed"},"failed",101));assert(!questMatches({...q,deadline:null},"overdue",101));});
check("completion button requires nonempty, fully checked active quest",()=>{for(const [conditions,status,expected]of [[[],"active",false],[[{text:"x",done:false}],"active",false],[[{text:"x",done:true}],"active",true],[[{text:"x",done:true}],"completed",false]]){const html=ChronicleApp.prototype.cardPreview.call(previewApp,{...r,type:"quest",conditions,status},true);assert.equal(html.includes('data-cj-action="completeQuest"'),expected);}});
check("tag deletion snapshots use a locale-independent ID order",()=>assert.deepEqual(tagAssignments(["z","A","a","Z"].map(id=>({id,type:"npc",published:true,tags:["x"],revision:1})),"x").map(r=>r.id),["A","Z","a","z"]));
check("Actor drag handles appear for GM only, on portrait and statblock",()=>{game.user.isGM=true;const html=ChronicleApp.prototype.cardPreview.call(previewApp,r,true);assert.equal((html.match(/data-cj-actor-uuid=/g)??[]).length,2);assert(html.includes(r.actorUuid));game.user.isGM=false;const publicHtml=ChronicleApp.prototype.cardPreview.call(previewApp,r,true);assert(!publicHtml.includes("data-cj-actor-uuid"));assert(!publicHtml.includes(r.actorUuid));});
console.log(`${count} checks passed`);
