import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {browser} from "./cdp.mjs";

const b=await browser(),base="http://127.0.0.1:30020",app="#mjl-campaign-journal-location",report={passed:[]};
let gm,player,context;
const ev=(s,fn,arg)=>b.eval(`(${fn})(${JSON.stringify(arg??null)})`,s);
const send=(s,args)=>ev(s,async args=>(await import("/modules/mjl-campaign-journal/scripts/store.mjs")).request(args),args);
const get=(s,id)=>ev(s,async id=>(await import("/modules/mjl-campaign-journal/scripts/store.mjs")).entry(id),id);
const change=async(s,id,values)=>send(s,{action:"save",id,revision:(await get(s,id)).revision,values});
const pass=name=>{report.passed.push(name);console.log(`PASS ${name}`);};
const row=id=>`${app} [data-entry="${id}"]`;
const group=id=>`${app} [data-location-group="JournalEntry.${id}"]`;
const exists=(s,selector)=>ev(s,selector=>!!document.querySelector(selector),selector);
const waitFor=(s,selector)=>b.until(`!!document.querySelector(${JSON.stringify(selector)})`,s);
const mouse=(type,p,extra={})=>b.call("Input.dispatchMouseEvent",{type,...p,...extra},gm);

try{
  const target=(await b.call("Target.getTargets")).targetInfos.find(t=>t.url===`${base}/game`);
  gm=(await b.call("Target.attachToTarget",{targetId:target.targetId,flatten:true})).sessionId;
  await b.call("Runtime.enable",{},gm);
  await b.call("Emulation.setDeviceMetricsOverride",{width:1440,height:1050,deviceScaleFactor:1,mobile:false},gm);
  assert.equal(await b.eval("game.world.id",gm),"chronicle-test");
  const name=`Подлокации ${Date.now().toString(36)}`;
  const create=(label,notes="")=>send(gm,{action:"create",type:"location",values:{name:`${name} ${label}`,notes,published:true}});
  const {id:a}=await create("А"),{id:d}=await create("Б","Заметка до переноса"),{id:c}=await create("В");
  const A=`JournalEntry.${a}`,D=`JournalEntry.${d}`,C=`JournalEntry.${c}`;
  await ev(gm,()=>{game.modules.get("mjl-campaign-journal").api.openLocations();});
  await waitFor(gm,row(d));
  await ev(gm,name=>{
    foundry.applications.instances.get("mjl-campaign-journal-location").setPosition({left:100,top:100,width:850});
    const search=document.querySelector("#mjl-campaign-journal-location [name=search]");
    search.value=name;search.dispatchEvent(new Event("input",{bubbles:true}));
  },name);
  const point=selector=>ev(gm,selector=>{
    const el=document.querySelector(selector);el.scrollIntoView({block:"nearest"});const r=el.getBoundingClientRect();
    return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
  },selector);
  const start=await point(row(d)),end=await point(row(a));
  await b.call("Input.setInterceptDrags",{enabled:true},gm);b.events=[];
  await mouse("mouseMoved",start);await mouse("mousePressed",start,{button:"left",buttons:1,clickCount:1});
  await mouse("mouseMoved",{x:start.x+30,y:start.y+4},{button:"left",buttons:1});
  await mouse("mouseMoved",{x:start.x+50,y:start.y+6},{button:"left",buttons:1});
  const timeout=Date.now()+5000;
  while(!b.events.some(e=>e.method==="Input.dragIntercepted")&&Date.now()<timeout)await new Promise(r=>setTimeout(r,100));
  const drag=b.events.find(e=>e.method==="Input.dragIntercepted")?.params.data;
  assert(drag,"Real mouse drag did not start");
  assert.equal(drag.items.find(i=>i.mimeType==="application/x-mjl-chronicle-location").data,d);
  assert.deepEqual(JSON.parse(drag.items.find(i=>i.mimeType==="text/plain").data),{type:"JournalEntry",uuid:D});
  for(const type of ["dragEnter","dragOver","drop"])await b.call("Input.dispatchDragEvent",{type,...end,data:drag},gm);
  await mouse("mouseReleased",end,{button:"left",buttons:0,clickCount:1});
  await waitFor(gm,`${group(a)} [data-entry="${d}"]`);
  assert.equal((await get(gm,d)).parentUuid,A);
  assert.equal((await get(gm,d)).notes,"Заметка до переноса");
  pass("real mouse drag moves a location, preserves notes and still carries its JournalEntry payload");

  await change(gm,c,{parentUuid:D});
  await waitFor(gm,`${group(a)} [data-location-group="${D}"] [data-entry="${c}"]`);
  await assert.rejects(()=>change(gm,a,{parentUuid:C}),/Нельзя вложить/);
  await assert.rejects(()=>change(gm,a,{parentUuid:A}),/Нельзя вложить/);
  const linked=await ev(gm,async()=> (await import("/modules/mjl-campaign-journal/scripts/store.mjs")).entries().find(r=>r.type==="location"&&r.pointcrawlUuid&&!r.archived)?.uuid);
  if(linked)await assert.rejects(()=>change(gm,a,{parentUuid:linked}),/самостоятельную локацию/);
  pass("recursive catalogue, cycle guard and Pointcrawl separation");

  ({browserContextId:context}=await b.call("Target.createBrowserContext"));
  player=await b.page(`${base}/join`,context);
  await b.until('document.querySelector("[name=userid]")',player);
  await b.eval('document.querySelector("[name=userid]").value=[...document.querySelector("[name=userid]").options].find(o=>o.text==="Chronicle Player A").value;document.querySelector("[name=join]").click()',player);
  await b.until('game.ready&&game.modules.get("mjl-campaign-journal")?.api',player,60000);
  await ev(player,()=>{game.modules.get("mjl-campaign-journal").api.openLocations();});
  await waitFor(player,`${group(a)} [data-location-group="${D}"] [data-entry="${c}"]`);
  await assert.rejects(()=>change(player,c,{parentUuid:""}),/Нет права/);
  await change(gm,a,{published:false});
  await b.until(`game.journal.get('${d}')?.getFlag('mjl-campaign-journal','entry')?.parentUuid===undefined&&!document.querySelector('[data-location-group="${A}"]')`,player);
  assert(await exists(player,`${group(d)} [data-entry="${c}"]`));
  await change(gm,a,{published:true});
  await waitFor(player,`${group(a)} [data-location-group="${D}"]`);
  pass("players see only visible parents and cannot alter the tree");

  await ev(gm,()=>{
    const search=document.querySelector("#mjl-campaign-journal-location [name=search]");
    search.value="";search.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await ev(gm,selector=>{
    const group=document.querySelector(selector);const summary=group.querySelector("summary");
    if(!group.open)summary.click();summary.click();if(group.open)throw Error("Did not collapse");
    summary.click();if(!group.open)throw Error("Did not expand");
  },group(a));
  await ev(gm,selector=>{
    const group=document.querySelector(selector);if(!group.open)group.querySelector("summary").click();
  },group(d));
  const p=await point(row(c));
  await mouse("mouseMoved",p);await mouse("mousePressed",p,{button:"right",buttons:2,clickCount:1});await mouse("mouseReleased",p,{button:"right",buttons:0,clickCount:1});
  await b.until('[...document.querySelectorAll("#context-menu .context-item")].some(e=>e.innerText==="На верхний уровень")',gm);
  await b.eval('[...document.querySelectorAll("#context-menu .context-item")].find(e=>e.innerText==="На верхний уровень").click()',gm);
  await b.until(`!!document.querySelector('${app} .cj-list > [data-entry="${c}"]')`,gm);
  assert.equal((await get(gm,c)).parentUuid,"");
  const archived=await change(gm,a,{archived:true});
  await send(gm,{action:"delete",id:a,revision:archived.revision});
  assert.equal((await get(gm,d)).parentUuid,"");
  assert.equal((await get(gm,d)).notes,"Заметка до переноса");
  pass("context menu and parent deletion return children to top level");
}catch(error){report.error=error.stack;console.error(error);process.exitCode=1;}
finally{
  if(gm)await b.call("Input.setInterceptDrags",{enabled:false},gm).catch(()=>{});
  if(context)await b.call("Target.disposeBrowserContext",{browserContextId:context}).catch(()=>{});
  await writeFile(new URL("../dev/location-nesting-report.json",import.meta.url),JSON.stringify(report,null,2));
  b.close();
}
