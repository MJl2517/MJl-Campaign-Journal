import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {browser} from "./cdp.mjs";
const b=await browser(),contexts=[],report={passed:[]},base="http://127.0.0.1:30020",ID="mjl-campaign-journal";let gm,player;
const ev=(s,fn,args)=>b.eval(`(${fn.toString()})(${JSON.stringify(args??null)})`,s);
const pass=name=>{report.passed.push(name);console.log(`PASS ${name}`);};
const send=(s,args)=>ev(s,async args=>(await import('/modules/mjl-campaign-journal/scripts/store.mjs')).request(args),args);
const get=(s,id)=>ev(s,async id=>(await import('/modules/mjl-campaign-journal/scripts/store.mjs')).entry(id),id);
async function change(s,id,values){return send(s,{action:"save",id,revision:(await get(s,id)).revision,values});}
async function settled(s){await b.until('![...foundry.applications.instances.values()].some(a=>a.options.classes.includes("mjl-chronicle")&&a.busy)',s);}
async function open(s,id){await ev(s,async id=>{for(const a of [...foundry.applications.instances.values()])if(a.options.classes.includes('mjl-chronicle')){a.dirty=false;await a.close();}game.modules.get('mjl-campaign-journal').api.openEntry(`JournalEntry.${id}`);},id);await b.until('!!document.querySelector(".cj-card-preview")',s);}
async function click(s,action){await ev(s,action=>{const el=document.querySelector(`[data-cj-action="${action}"]`);if(!el)throw Error(`Missing ${action}`);el.click();},action);await settled(s);}
async function input(s,name,value){await ev(s,({name,value})=>{const el=document.querySelector(`.mjl-chronicle [name="${name}"]`);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},{name,value});}
async function menu(s,selector){
 const {x,y}=await ev(s,selector=>{const el=document.querySelector(selector);if(!el)throw Error(`Missing target ${selector}`);el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+Math.min(r.width/2,60),y:r.y+Math.min(r.height/2,18)};},selector);
 await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y},s);await b.call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'right',buttons:2,clickCount:1},s);await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'right',buttons:0,clickCount:1},s);
 await b.until('!!document.querySelector("#context-menu .context-item")',s);
 return b.eval('[...document.querySelectorAll("#context-menu .context-item")].map(e=>e.innerText)',s);
}
async function menuClick(s,label){await ev(s,label=>{const el=[...document.querySelectorAll('#context-menu .context-item')].find(e=>e.innerText===label);if(!el)throw Error(`Missing menu ${label}`);el.click();},label);}
async function confirm(s,yes){await b.until('!!document.querySelector(".application [data-action=yes]")',s);await b.eval(`document.querySelector('.application [data-action=${yes?'yes':'no'}]').click()`,s);await settled(s);}
try{
 const target=(await b.call('Target.getTargets')).targetInfos.find(t=>t.url===`${base}/game`);gm=(await b.call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;await b.call('Runtime.enable',{},gm);assert.equal(await b.eval('game.world.id',gm),'chronicle-test');
 await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false},gm);
 const {browserContextId}=await b.call('Target.createBrowserContext');contexts.push(browserContextId);player=await b.page(`${base}/join`,browserContextId);await b.until('document.querySelector("[name=userid]")',player);await b.eval('document.querySelector("[name=userid]").value=[...document.querySelector("[name=userid]").options].find(o=>o.text==="Chronicle Player A").value;document.querySelector("[name=join]").click()',player);await b.until('game.ready&&game.modules.get("mjl-campaign-journal")?.api',player,60000);b.events=[];
 const quest=await send(player,{action:'create',type:'quest',values:{name:'Проверка быстрых отметок',conditions:[{text:'Найти проводника',done:false},{text:'Собрать припасы',done:false}],notes:'Не менять эту заметку'}});
 for(const [s,done]of [[player,true],[gm,false]]){
   await open(s,quest.id);await b.eval('document.querySelector("[data-cj-condition-check]").click()',s);await settled(s);
   await b.until(`document.querySelector('[data-cj-condition-check="0"]')?.checked===${done}`,s);const r=await get(gm,quest.id);assert.equal(r.conditions[0].done,done);assert.equal(r.notes,'Не менять эту заметку');assert.equal(r.status,'active');assert(!await b.eval('!!document.querySelector(".cj-form")',s));
 }
 pass('GM and player toggle quest checkboxes directly in preview; notes and manual status preserved');
 const tag=`Дозор-${Date.now()}`,secret=`SECRET_TAG_${Date.now()}`;
 const npc=await send(player,{action:'create',type:'npc',values:{name:'Первый носитель тега'}});await open(player,npc.id);await click(player,'edit');await b.until('!!document.querySelector("[name=newTag]")',player);await input(player,'newTag',tag);await b.eval('document.querySelector("[name=newTag]").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))',player);await settled(player);await click(player,'save');assert.deepEqual((await get(gm,npc.id)).tags,[tag]);
 await b.until(`game.settings.get('${ID}','tagLibrary').includes('${tag}')`,player);pass('Enter creates a tag and remembers it in the world library');
 const second=await send(player,{action:'create',type:'npc',values:{name:'Второй носитель тега'}});await open(player,second.id);await click(player,'edit');await b.until('!!document.querySelector("[name=newTag]")',player);
 await input(player,'newTag',tag.toUpperCase());assert(await ev(player,tag=>[...document.querySelectorAll('.cj-tag-suggestions button:not([hidden])')].some(e=>e.dataset.tag===tag),tag));
 await ev(player,tag=>[...document.querySelectorAll('.cj-tag-suggestions button')].find(e=>e.dataset.tag===tag).click(),tag);await settled(player);await click(player,'save');assert.deepEqual((await get(gm,second.id)).tags,[tag]);pass('existing tags are searchable and assigned to another NPC with one click');
 await change(player,second.id,{tags:[tag.toUpperCase(),tag]});assert.deepEqual((await get(gm,second.id)).tags,[tag]);pass('case variants reuse the saved label without duplicates');
 await open(player,second.id);await click(player,'edit');await b.until('!!document.querySelector("[data-cj-action=removeTag]")',player);await click(player,'removeTag');await click(player,'save');assert.deepEqual((await get(gm,second.id)).tags,[]);assert(await ev(player,tag=>game.settings.get('mjl-campaign-journal','tagLibrary').includes(tag),tag));pass('removing a tag from an NPC retains the reusable label');
 const hidden=await send(gm,{action:'create',type:'npc',values:{name:'Скрытый НИП для тегов',tags:[secret]}});assert(!await ev(player,secret=>JSON.stringify(game.settings.get('mjl-campaign-journal','tagLibrary')).includes(secret),secret));await change(gm,hidden.id,{published:true});await b.until(`game.settings.get('${ID}','tagLibrary').includes('${secret}')`,player);pass('hidden NPC tags stay private until the NPC is revealed');
 for(const type of ['npc','location','quest']){
   const r=await send(gm,{action:'create',type,values:{name:`Контекстное меню ${type}`,published:true}});await b.until(`!!game.journal.get('${r.id}')`,player);await open(player,r.id);
   const labels=await menu(player,`.cj-row[data-entry="${r.id}"]`);assert(labels.includes('В архив'));assert(!labels.includes('Удалить навсегда'));await menuClick(player,'В архив');await settled(player);assert.equal((await get(gm,r.id)).archived,true);
   await open(gm,r.id);assert((await menu(gm,'.cj-card-preview')).includes('Вернуть из архива'));await menuClick(gm,'Вернуть из архива');await settled(gm);assert.equal((await get(gm,r.id)).archived,false);
   await open(gm,r.id);assert((await menu(gm,'.cj-card-preview')).includes('Удалить навсегда'));await menuClick(gm,'Удалить навсегда');await confirm(gm,false);assert.equal((await get(gm,r.id)).archived,false);
   await menu(gm,'.cj-card-preview');await menuClick(gm,'Удалить навсегда');await confirm(gm,true);assert.equal(await get(gm,r.id),undefined);pass(`${type}: real right-click archive/restore, GM-only confirmed delete, cancel preserves active card`);
 }
 await open(gm,second.id);await click(gm,'edit');await b.until('!!document.querySelector("[name=notes]")',gm);await input(gm,'notes','Несохранённый текст остаётся');await menu(gm,`.cj-row[data-entry="${npc.id}"]`);await menuClick(gm,'Удалить навсегда');await confirm(gm,true);assert.equal(await get(gm,npc.id),undefined);assert.equal(await b.eval('document.querySelector("[name=notes]").value',gm),'Несохранённый текст остаётся');assert(await ev(gm,tag=>game.settings.get('mjl-campaign-journal','tagLibrary').includes(tag),tag));pass('context targets the clicked row, preserves another draft and retains tags after source deletion');
 await ev(gm,async()=>{for(const a of [...foundry.applications.instances.values()])if(a.options.classes.includes('mjl-chronicle')){a.dirty=false;await a.close();}});
 await open(player,quest.id);await b.eval('globalThis.__reload=true;location.reload()',player);await b.until('!globalThis.__reload&&game.ready&&game.modules.get("mjl-campaign-journal")?.api',player,60000);assert(await ev(player,tag=>game.settings.get('mjl-campaign-journal','tagLibrary').includes(tag),tag));assert.equal((await get(player,quest.id)).conditions[0].done,false);pass('tag library and quick checkbox changes survive client reconnect');
 const permissions=await ev(gm,()=>foundry.utils.deepClone(game.permissions));
 try{
   await ev(gm,async()=>{const p=foundry.utils.deepClone(game.permissions);p.FILES_UPLOAD=p.FILES_UPLOAD.filter(role=>role!==1);await game.settings.set('core','permissions',p);});await b.until('!game.user.can("FILES_UPLOAD")',player);const before=await get(gm,second.id);
   await assert.rejects(()=>change(player,second.id,{portrait:'icons/svg/mystery-man.svg'}),/Загрузка файлов/);assert.deepEqual(await get(gm,second.id),before);pass('GM image copying respects the requesting player upload permission and preserves the record');
 }finally{await ev(gm,async p=>{await game.settings.set('core','permissions',p);},permissions);}
 assert.equal(b.events.filter(e=>e.method==='Runtime.exceptionThrown').length,0);pass('no unhandled JavaScript exceptions');
 await writeFile(new URL('../dev/interactions-fixture.json',import.meta.url),JSON.stringify({quest:quest.id,tag},null,2));
}catch(error){report.error=error.stack;console.error(error);process.exitCode=1;}
finally{await writeFile(new URL('../dev/interactions-report.json',import.meta.url),JSON.stringify(report,null,2));for(const id of contexts)await b.call('Target.disposeBrowserContext',{browserContextId:id}).catch(()=>{});b.close();}
