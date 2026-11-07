import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {browser} from './cdp.mjs';
const b=await browser(),contexts=[],report={passed:[],screenshots:[]},base='http://127.0.0.1:30020',ID='mjl-campaign-journal';let gm,player,fixture;
const ev=(s,fn,args)=>b.eval(`(${fn.toString()})(${JSON.stringify(args??null)})`,s);
const pass=name=>{report.passed.push(name);console.log(`PASS ${name}`);};
const send=(s,args)=>ev(s,async args=>(await import('/modules/mjl-campaign-journal/scripts/store.mjs')).request(args),args);
const get=(s,id)=>ev(s,async id=>(await import('/modules/mjl-campaign-journal/scripts/store.mjs')).entry(id),id);
async function change(s,id,values){return send(s,{action:'save',id,revision:(await get(s,id)).revision,values});}
async function open(s,id){await ev(s,async id=>{for(const a of [...foundry.applications.instances.values()])if(a.options.classes.includes('mjl-chronicle')){a.dirty=false;await a.close();}game.modules.get('mjl-campaign-journal').api.openEntry(`JournalEntry.${id}`);},id);await b.until('!!document.querySelector(".cj-card-preview")',s);}
async function click(s,action,extra=''){await ev(s,({action,extra})=>{const el=document.querySelector(`.mjl-chronicle [data-cj-action="${action}"]${extra}`);if(!el)throw Error(`Missing ${action}`);el.click();},{action,extra});}
async function edit(s){await click(s,'edit');await b.until('!!document.querySelector(".cj-form")',s);}
async function input(s,name,value){await ev(s,({name,value})=>{const el=document.querySelector(`.mjl-chronicle [name="${name}"]`);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},{name,value});}
async function save(s){await click(s,'save');await b.until('!!document.querySelector(".cj-card-preview")&&!document.querySelector(".cj-form")',s);}
async function choose(s,action,uuid,query='',extra=''){
 await click(s,action,extra);await b.until('!!document.querySelector(".cj-picker")',s);
 if(query)await input(s,'choiceSearch',query);
 await pick(s,uuid);
}
async function pick(s,uuid){
 await ev(s,uuid=>{const r=[...document.querySelectorAll('.cj-picker [name="choice"]')].find(r=>r.value===uuid);if(!r||r.closest('[hidden],details:not([open])'))throw Error('Choice not visible');r.click();document.querySelector('.cj-picker button[data-action="ok"]').click();},uuid);
 await b.until('!document.querySelector(".cj-picker")',s);await b.until('![...foundry.applications.instances.values()].some(a=>a.options.classes.includes("mjl-chronicle")&&a.busy)',s);
}
async function shot(name,s){const target=new URL(`../previews/${name}.png`,import.meta.url);await mkdir(new URL('../previews/',import.meta.url),{recursive:true});await b.screenshot(fileURLToPath(target),s);report.screenshots.push(name);}
try{
 const target=(await b.call('Target.getTargets')).targetInfos.find(t=>t.url===`${base}/game`);gm=(await b.call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;await b.call('Runtime.enable',{},gm);await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false},gm);assert.equal(await b.eval('game.world.id',gm),'chronicle-test');
 const prefix=`Карточки ${Date.now()}`;
 const openLoc=await send(gm,{action:'create',type:'location',values:{name:`${prefix} — Маяк`,notes:'Открытый причал у маяка',published:true,gmNotes:'SECRET_VIEW_LOCATION',images:[{src:'icons/svg/castle.svg',caption:'Башня над гаванью'}]}});
 const otherLoc=await send(gm,{action:'create',type:'location',values:{name:`${prefix} — Трактир`,notes:'Городской трактир',published:true}});
 const hidden=await send(gm,{action:'create',type:'location',values:{name:'SECRET_PICKER_HIDDEN',published:false}});
 const archived=await send(gm,{action:'create',type:'location',values:{name:'SECRET_PICKER_ARCHIVED',published:true,archived:true}});
 const {browserContextId}=await b.call('Target.createBrowserContext');contexts.push(browserContextId);player=await b.page(`${base}/join`,browserContextId);await b.until('document.querySelector("[name=userid]")',player);await b.eval('localStorage.setItem("core.noCanvas","true");document.querySelector("[name=userid]").value=[...document.querySelector("[name=userid]").options].find(o=>o.text==="Chronicle Player A").value;document.querySelector("[name=join]").click()',player);await b.until('game.ready&&game.modules.get("mjl-campaign-journal")?.api',player,120000);await b.until(`!!game.journal.get('${openLoc.id}')`,player);b.events=[];
 const npc=await send(player,{action:'create',type:'npc',values:{name:'Марен, капитан «Зари»',portrait:'icons/svg/anchor.svg',notes:'Встречает путников у старого причала.\nОбещал помочь с лодкой.',tags:['Союзник','Гавань']}});
 const quest=await send(player,{action:'create',type:'quest',values:{name:'Путь к Старому маяку',description:'Договориться с капитаном и подготовить лодку.',conditions:[{text:'Найти капитана',done:true},{text:'Подготовить лодку',done:false}],notes:'Проверить груз перед отправлением.',links:[`JournalEntry.${npc.id}`],deadlineInput:{mode:'duration',days:2,hours:3}}});
 fixture={npc:npc.id,location:openLoc.id,other:otherLoc.id,quest:quest.id,hidden:hidden.id,archived:archived.id};
 for(const [s,role]of [[gm,'GM'],[player,'Player']])for(const id of [npc.id,openLoc.id,quest.id]){
   await open(s,id);assert.equal(await b.eval('document.querySelectorAll(".cj-card-preview input:not([data-cj-condition-check]),.cj-card-preview textarea,.cj-card-preview select").length',s),0);assert.equal(await b.eval('!!document.querySelector(".cj-form")',s),false);assert(await b.eval('!!document.querySelector(".cj-card-preview [data-cj-action=edit]")',s));pass(`${role}: ${(await get(s,id)).type} opens in clean preview`);
 }
 await open(player,npc.id);await edit(player);await input(player,'notes','Сохранённая заметка игрока');await save(player);assert((await get(gm,npc.id)).notes.includes('Сохранённая'));pass('Edit and Save return to preview with persisted notes');
 await edit(player);await input(player,'notes','Отменённый черновик');await click(player,'cancelEdit');await b.until('!!document.querySelector(".application [data-action=yes]")',player);await b.eval('document.querySelector(".application [data-action=yes]").click()',player);await b.until('!!document.querySelector(".cj-card-preview")',player);assert.equal((await get(gm,npc.id)).notes,'Сохранённая заметка игрока');pass('Cancel confirms discard and preserves saved notes');
 await edit(player);await click(player,'chooseLocation');await b.until('!!document.querySelector(".cj-picker")',player);assert(!await b.eval('document.querySelector(".cj-picker").innerText.includes("SECRET_PICKER")',player));await ev(player,q=>{const el=document.querySelector('.cj-picker [name=choiceSearch]');el.value=q;el.dispatchEvent(new Event('input',{bubbles:true}));},`${prefix.toUpperCase()} — МАЯК`);assert.equal(await b.eval('document.querySelectorAll(".cj-picker [data-choice]:not([hidden])").length',player),1);await shot('location-picker',player);await b.eval('document.querySelector(".cj-picker .window-header [data-action=close]").click()',player);await b.until('!document.querySelector(".cj-picker")',player);assert.equal((await get(player,npc.id)).locationUuid,'');pass('searchable location modal excludes hidden/archived places and cancel keeps location');
 await choose(player,'chooseLocation',`JournalEntry.${openLoc.id}`,'МАЯК');await save(player);assert.equal((await get(gm,npc.id)).locationUuid,`JournalEntry.${openLoc.id}`);assert(await b.eval('document.querySelector(".cj-location-summary").innerText.includes("Маяк")',player));await shot('npc-preview',player);pass('NPC location persists and appears as link in preview');
 await click(player,'openLink');await b.until(`document.querySelector('#${ID}-location .cj-card-preview h2')?.innerText.includes('Маяк')`,player);pass('NPC location link opens the location preview');
 await open(player,quest.id);await edit(player);await choose(player,'chooseLink',`JournalEntry.${openLoc.id}`,'МАЯК','[data-kind=location]');await save(player);assert((await get(gm,quest.id)).links.includes(`JournalEntry.${openLoc.id}`));await shot('quest-preview-dark',player);pass('quest adds location through the same searchable modal');
 await ev(player,async()=>{const c=foundry.utils.deepClone(game.settings.get('core','uiConfig'));c.colorScheme={applications:'light',interface:'light'};await game.settings.set('core','uiConfig',c);});await b.until('getComputedStyle(document.querySelector(".cj-text-link")).color===getComputedStyle(document.querySelector(".cj-status-text")).color',player);await shot('quest-preview-light',player);
 await change(gm,openLoc.id,{published:false});await open(player,npc.id);assert.equal(await b.eval('document.querySelector(".cj-location-summary").innerText.trim()',player),"Неизвестно");assert.equal((await get(player,npc.id)).locationUuid,"");await edit(player);await input(player,'notes','Связь сохранена после закрытия места');await save(player);assert.equal((await get(gm,npc.id)).locationUuid,`JournalEntry.${openLoc.id}`);pass('hidden current location redacted without blocking unrelated edits');
 await assert.rejects(()=>change(player,npc.id,{locationUuid:`JournalEntry.${hidden.id}`}));await assert.rejects(()=>change(player,npc.id,{locationUuid:`JournalEntry.${archived.id}`}));await assert.rejects(()=>change(player,npc.id,{locationUuid:`JournalEntry.${quest.id}`}));pass('server rejects hidden, archived and wrong-type location assignments');
 await edit(player);await choose(player,'chooseLocation','');await save(player);assert.equal((await get(gm,npc.id)).locationUuid,'');pass('location can be cleared through picker');
 await change(gm,openLoc.id,{published:true});await change(player,npc.id,{locationUuid:`JournalEntry.${openLoc.id}`});await open(gm,openLoc.id);assert(await b.eval('!!document.querySelector(".cj-gallery-preview")',gm));assert.equal(await b.eval('document.querySelectorAll(".cj-gallery-preview input,.cj-gallery-preview button:not([data-cj-action=preview])").length',gm),0);await shot('location-preview-gm',gm);await open(player,openLoc.id);assert.equal(await b.eval('!!document.querySelector(".cj-gallery-preview")',player),true);assert(!await b.eval('document.querySelector(".cj-card-preview").innerText.includes("SECRET_VIEW_LOCATION")',player));pass('gallery preview shares art/captions with player while GM notes stay private');
 await edit(gm);assert(await b.eval('!!document.querySelector(".cj-gallery [data-cj-action=picker]")',gm));assert(await b.eval('!!document.querySelector("[name=gmNotes]")',gm));assert(await b.eval('!!document.querySelector("[data-cj-action=choosePointcrawl]")',gm));pass('full gallery and secret settings remain available in Edit');
 const secret=await ev(gm,async suffix=>{
   const pc=await import('/modules/mjl-pointcrawl/scripts/store.mjs'),journals=await import('/modules/mjl-pointcrawl/scripts/journals.mjs');
   const scene=await Scene.create({name:`Импорт Pointcrawl ${suffix}`,width:1600,height:1000,grid:{type:0,size:100}});
   const [region]=await scene.createEmbeddedDocuments('Region',[{name:'Северные скалы',shapes:[{type:'rectangle',x:100,y:100,width:800,height:600}]}]);
   await pc.request('enable',{enabled:true},scene);
   const regionName=`Северные скалы ${suffix}`;
   await pc.request('region',{regionId:region.id,values:{name:regionName,explored:true,center:{x:300,y:300}}},scene);
   const values={name:`Тайная бухта ${suffix}`,x:350,y:350,revealed:false};
   const siblingName=`Маяк на мысе ${suffix}`;
   await pc.request('location',{regionId:region.id,values},scene);
   await pc.request('location',{regionId:region.id,values:{name:siblingName,x:390,y:350,revealed:true,description:'Заметки Pointcrawl'}},scene);
   const locations=pc.privateData(scene).regions[region.id].locations;
   const location=locations.find(l=>l.name===values.name);
   const doc=journals.notebook(scene,region.id,location.id);
   return {sceneId:scene.id,regionId:region.id,locationId:location.id,uuid:doc.uuid,publicName:doc.name,values,regionName,siblingName,
     parentUuid:journals.notebook(scene,region.id).uuid,siblingUuid:journals.notebook(scene,region.id,locations.find(l=>l.name===siblingName).id).uuid};
 },Date.now().toString(36));
 assert.equal(secret.publicName,'Скрытая локация');
 const bound=await send(gm,{action:'create',type:'location',values:{name:'Локация из карты',published:true}});
 await open(gm,bound.id);await edit(gm);await click(gm,'choosePointcrawl');await b.until('!!document.querySelector(".cj-picker")',gm);
 await ev(gm,({parentUuid,uuid,regionName})=>{
   const group=document.querySelector(`.cj-picker [data-location-group="${parentUuid}"]`);
   const summary=group?.querySelector('summary');
   if(group?.open!==false||!summary?.textContent.includes(regionName)||!group.querySelector(`[data-choice="${uuid}"]`))throw Error('Missing collapsed Pointcrawl region or child');
   summary.click();if(!group.open)throw Error('Could not expand region');
   summary.click();if(group.open)throw Error('Could not collapse region');
   summary.click();
 },secret);
 await pick(gm,secret.parentUuid);await save(gm);assert.equal((await get(gm,bound.id)).pointcrawlUuid,secret.parentUuid);
 assert(await b.eval('!!document.querySelector(".cj-card-preview [data-cj-action=notebook]")',gm));
 pass('Pointcrawl binding displays collapsible sublocations and lets GM select the whole region');
 await edit(gm);await click(gm,'choosePointcrawl');await b.until('!!document.querySelector(".cj-picker")',gm);
 await ev(gm,uuid=>document.querySelector(`.cj-picker [data-location-group="${uuid}"] summary`).click(),secret.parentUuid);
 await input(gm,'choiceSearch',secret.values.name.toUpperCase());
 assert(await ev(gm,({uuid,parentUuid})=>{
   const group=document.querySelector(`.cj-picker [data-location-group="${parentUuid}"]`);
   return group.open&&!group.hidden&&!group.querySelector(`[data-choice="${uuid}"]`).hidden;
 },secret));
 await shot('pointcrawl-binding-tree',gm);
 await input(gm,'choiceSearch','');
 assert.equal(await ev(gm,uuid=>document.querySelector(`.cj-picker [data-location-group="${uuid}"]`).open,secret.parentUuid),false);
 await input(gm,'choiceSearch',secret.values.name.toUpperCase());await pick(gm,secret.uuid);await save(gm);
 assert.equal((await get(gm,bound.id)).pointcrawlUuid,secret.uuid);
 await b.until(`game.journal.get('${bound.id}')?.getFlag('mjl-campaign-journal','entry')?.published === false`,player);
 assert.equal(await get(player,bound.id),undefined);
 assert(!await ev(player,uuid=>fromUuidSync(uuid)?.testUserPermission(game.user,'OBSERVER'),secret.uuid));
 pass('GM finds and binds a never-revealed Pointcrawl location by real name while players lose access to the linked card');
 const boundUuid=`JournalEntry.${bound.id}`;
 await open(gm,npc.id);await edit(gm);await choose(gm,'chooseLocation',boundUuid,'Локация из карты');await save(gm);
 assert.equal((await get(gm,npc.id)).locationUuid,boundUuid);
 assert(await ev(gm,uuid=>document.querySelector('.cj-location-summary [data-cj-action="openLink"]').dataset.uuid===uuid,boundUuid));
 await open(player,npc.id);
 const redacted=await get(player,npc.id);
 assert.equal(redacted.locationUuid,'');assert.equal(redacted.locationUnknown,true);
 assert(!JSON.stringify(redacted).includes(boundUuid));
 assert.equal(await b.eval('document.querySelector(".cj-location-summary").innerText.trim()',player),"Неизвестно");
 await assert.rejects(()=>change(player,npc.id,{locationUuid:boundUuid}),/Выберите открытую локацию/);
 pass('GM assigns an NPC to unrevealed Pointcrawl location; player sees Unknown without UUID and cannot submit hidden reference');
 await ev(gm,async({sceneId,regionId,locationId,values})=>{
   const pc=await import('/modules/mjl-pointcrawl/scripts/store.mjs');
   await pc.request('location',{regionId,locationId,values:{...values,revealed:true}},game.scenes.get(sceneId));
 },secret);
 await b.until(`game.journal.get('${bound.id}')?.getFlag('mjl-campaign-journal','entry')?.published === true`,player);
 await b.until(`document.querySelector('.cj-location-summary [data-uuid="${boundUuid}"]')`,player);
 assert.equal((await get(player,npc.id)).locationUuid,boundUuid);
 pass('revealing the Pointcrawl location replaces Unknown with the NPC location link automatically');
 await change(gm,npc.id,{locationUuid:`JournalEntry.${openLoc.id}`});
 await open(player,bound.id);
 assert(await b.eval('!!document.querySelector(".cj-card-preview [data-cj-action=notebook]")',player));
 pass('revealing the Pointcrawl location restores player access without rebinding');
 const readImported=()=>ev(gm,async ids=>(await import('/modules/mjl-campaign-journal/scripts/store.mjs')).entries().filter(r=>ids.includes(r.pointcrawlUuid)),[secret.parentUuid,secret.uuid,secret.siblingUuid]);
 async function importScene(){
   await click(gm,'importPointcrawl');await b.until('!!document.querySelector(".cj-import select")',gm);
   await ev(gm,id=>{const select=document.querySelector('.cj-import select');select.value=id;if(select.value!==id)throw Error('Scene missing from import picker');document.querySelector('.cj-import [data-action=ok]').click();},secret.sceneId);
   await b.until('!document.querySelector(".cj-import")&&!foundry.applications.instances.get("mjl-campaign-journal-location").busy',gm);
 }
 await assert.rejects(()=>send(player,{action:'importPointcrawl',sceneId:secret.sceneId}),/доступен мастеру/);
 assert(!await b.eval('!!document.querySelector("[data-cj-action=importPointcrawl]")',player));
 const existing=await get(gm,bound.id);
 await open(gm,bound.id);
 await importScene();
 const imported=await readImported(),parent=imported.find(r=>r.pointcrawlUuid===secret.parentUuid),sibling=imported.find(r=>r.pointcrawlUuid===secret.siblingUuid);
 assert.equal(imported.length,3);assert.equal(parent.name,secret.regionName);assert.equal(sibling.name,secret.siblingName);
 assert.equal(parent.published,false);assert.equal(sibling.published,false);
 assert.deepEqual(await get(gm,bound.id),existing);
 assert(await ev(gm,uuid=>fromUuidSync(uuid).pages.contents[0].text.content.includes('Заметки Pointcrawl'),secret.siblingUuid));
 await importScene();assert.deepEqual(await readImported(),imported);
 pass('GM imports selected scene with linked journals, hidden defaults and no duplicates; player import is rejected');
 await b.until(`!!document.querySelector('.cj-list [data-location-group="${parent.uuid}"]')`,gm);
 await input(gm,'search',secret.siblingName);
 assert(await ev(gm,({parent,sibling})=>{
   const group=document.querySelector(`.cj-list [data-location-group="${parent.uuid}"]`);
   return group.open&&!group.hidden&&!group.querySelector(`[data-entry="${sibling.id}"]`).hidden;
 },{parent,sibling}));
 await input(gm,'search','');
 await ev(gm,uuid=>{const group=document.querySelector(`.cj-list [data-location-group="${uuid}"]`);if(!group.open)group.querySelector('summary').click();},parent.uuid);
 await shot('pointcrawl-import-tree',gm);
 assert.equal(await get(player,parent.id),undefined);
 await change(gm,parent.id,{published:true});
 await b.until(`!!document.querySelector('.cj-list [data-location-group="${parent.uuid}"] [data-entry="${bound.id}"]')`,player);
 assert(!await ev(player,id=>!!document.querySelector(`.cj-list [data-entry="${id}"]`),sibling.id));
 pass('imported cards appear in expandable catalogue groups and player groups contain only visible cards');
 await ev(player,async()=>{for(const a of [...foundry.applications.instances.values()])if(a.options.classes.includes('mjl-chronicle')){a.dirty=false;await a.close();}game.modules.get('mjl-campaign-journal').api.openNPCs();});await b.until('!!document.querySelector("[data-cj-action=create]")',player);await click(player,'create');await b.until('!!document.querySelector(".cj-form")',player);pass('new card starts in Edit');
 await open(player,npc.id);await b.eval('globalThis.__reload=true;location.reload()',player);await b.until('!globalThis.__reload&&game.ready&&game.modules.get("mjl-campaign-journal")?.api',player,60000);await open(player,npc.id);assert.equal((await get(player,npc.id)).locationUuid,`JournalEntry.${openLoc.id}`);pass('reload preserves NPC location and opens preview');
 assert.equal(b.events.filter(e=>e.method==='Runtime.exceptionThrown').length,0,JSON.stringify(b.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text)));pass('no unhandled JavaScript exceptions');
 await writeFile(new URL('../dev/cards-fixture.json',import.meta.url),JSON.stringify(fixture,null,2));
}catch(error){report.error=error.stack;console.error(error);if(gm)await shot('cards-failure-gm',gm).catch(()=>{});if(player)await shot('cards-failure-player',player).catch(()=>{});process.exitCode=1;}
finally{await writeFile(new URL('../dev/cards-report.json',import.meta.url),JSON.stringify(report,null,2));for(const id of contexts)await b.call('Target.disposeBrowserContext',{browserContextId:id}).catch(()=>{});b.close();}
