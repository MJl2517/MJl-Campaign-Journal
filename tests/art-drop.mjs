import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {browser} from "./cdp.mjs";

const b=await browser(),base="http://127.0.0.1:30020",moduleId="mjl-campaign-journal";
const files=["raspberry.webp","campaign-journal.webp"].map(name=>fileURLToPath(new URL(`../art/${name}`,import.meta.url)));
const ev=(s,fn,arg)=>b.eval(`(${fn.toString()})(${JSON.stringify(arg??null)})`,s);
const until=(s,code)=>b.until(code,s,60000);
const send=(s,args)=>ev(s,async args=>(await import("/modules/mjl-campaign-journal/scripts/store.mjs")).request(args),args);
const get=(s,id)=>ev(s,async id=>(await import("/modules/mjl-campaign-journal/scripts/store.mjs")).entry(id),id);
async function join(name,context){
  const s=await b.page(`${base}/join`,context);
  await until(s,'!!document.querySelector("select[name=userid]")');
  await ev(s,({name,noCanvas})=>{
    if(noCanvas)localStorage.setItem("core.noCanvas","true");
    const select=document.querySelector("select[name=userid]");
    select.value=[...select.options].find(o=>o.text===name).value;
    document.querySelector("button[name=join]").click();
  },{name,noCanvas:!!context});
  await until(s,`globalThis.game?.ready&&game.modules.get("${moduleId}")?.api`);
  return s;
}
const click=(s,selector)=>ev(s,selector=>document.querySelector(selector).click(),selector);
const open=(s,id)=>ev(s,id=>{game.modules.get("mjl-campaign-journal").api.openEntry(`JournalEntry.${id}`);},id);
const shot=(s,name)=>b.screenshot(fileURLToPath(new URL(`../dev/${name}.png`,import.meta.url)),s);
const zone='.cj-image-target[data-image-target=gallery]';
let gm,context;
const records=[];
try{
  gm=await join("Gamemaster");
  assert.equal(await b.eval("game.world.id",gm),"chronicle-test");
  await until(gm,'(async()=>!(await import("/modules/mjl-campaign-journal/scripts/store.mjs")).writeBlock())()');
  const location=await send(gm,{action:"create",type:"location",values:{name:"Каменный берег",published:true}});
  records.push(location.id);
  await open(gm,location.id);
  await until(gm,'!!document.querySelector("[data-cj-action=edit]")');
  await click(gm,"[data-cj-action=edit]");
  await until(gm,`!!document.querySelector('${zone}')`);
  const point=await ev(gm,selector=>{
    const rect=document.querySelector(selector).getBoundingClientRect();
    return {x:Math.floor(rect.left+rect.width/2),y:Math.floor(rect.top+rect.height/2)};
  },zone);
  const drag={items:[],files,dragOperationsMask:1};
  for(const type of ["dragEnter","dragOver"])await b.call("Input.dispatchDragEvent",{type,...point,data:drag},gm);
  await until(gm,`document.querySelector('${zone}').classList.contains("cj-drag-over")`);
  await b.call("Input.dispatchDragEvent",{type:"drop",...point,data:drag},gm);
  await until(gm,'document.querySelectorAll(".cj-gallery-editor figure img").length===2');
  assert.equal((await get(gm,location.id)).images.length,0);
  assert.equal(await b.eval(`document.querySelector('${zone}').classList.contains("cj-drag-over")`,gm),false);
  console.log("PASS native file drop highlights the zone and stages both files");

  await ev(gm,selector=>{
    const input=document.querySelector("[name=imageCaption1]");input.value="Обложка после перетаскивания";
    input.dispatchEvent(new Event("input",{bubbles:true}));
    const data=new DataTransfer();
    data.setData("text/uri-list",location.origin+"/join");
    data.setData("text/html",`<a href="/join"><img src="${location.origin}/icons/svg/anchor.svg"></a>`);
    document.querySelector(selector).dispatchEvent(new DragEvent("drop",{dataTransfer:data,bubbles:true,cancelable:true}));
  },zone);
  await until(gm,'document.querySelector("[name=imageSrc2]")?.value.endsWith("/icons/svg/anchor.svg")');
  await click(gm,'[data-cj-action=primaryImage][data-index="1"]');
  await until(gm,'document.querySelector("[name=imageCaption0]")?.value==="Обложка после перетаскивания"');
  await until(gm,'[...document.querySelectorAll(".cj-gallery-editor img")].every(i=>i.naturalWidth>0)');
  await shot(gm,"art-ui-editor");
  await click(gm,"[data-cj-action=save]");
  await until(gm,'document.querySelectorAll(".cj-gallery-preview img").length===3');
  const saved=await get(gm,location.id);
  assert.equal(saved.images[0].caption,"Обложка после перетаскивания");
  assert(saved.images.every(i=>i.src.startsWith("worlds/chronicle-test/")));
  console.log("PASS browser image drop, cover selection, and gallery save preserve captions");

  const npc=await send(gm,{action:"create",type:"npc",values:{name:"Смотритель гавани"}});
  records.push(npc.id);
  await open(gm,npc.id);
  const npcWindow="#mjl-campaign-journal-npc";
  await until(gm,`!!document.querySelector("${npcWindow} [data-cj-action=edit]")`);
  await click(gm,`${npcWindow} [data-cj-action=edit]`);
  await until(gm,`!!document.querySelector("${npcWindow} [data-cj-image-files]")`);
  await b.call("Page.setInterceptFileChooserDialog",{enabled:true},gm);
  await click(gm,`${npcWindow} [data-cj-action=imageFiles]`);
  await until(gm,`!!document.querySelector("${npcWindow} [data-cj-image-files]")`);
  const {root}=await b.call("DOM.getDocument",{},gm);
  const {nodeId}=await b.call("DOM.querySelector",{nodeId:root.nodeId,selector:`${npcWindow} [data-cj-image-files]`},gm);
  await b.call("DOM.setFileInputFiles",{files:[files[0]],nodeId},gm);
  await until(gm,'document.querySelector("[name=portrait]")?.value.startsWith("worlds/chronicle-test/")');
  await click(gm,`${npcWindow} [data-cj-action=save]`);
  await until(gm,'!!document.querySelector(".cj-portrait-preview")');
  assert((await get(gm,npc.id)).portrait.startsWith("worlds/chronicle-test/"));
  console.log("PASS native file chooser uploads and saves an NPC portrait");

  ({browserContextId:context}=await b.call("Target.createBrowserContext"));
  const player=await join("Chronicle Player A",context);
  await open(player,location.id);
  await until(player,'document.querySelector(".cj-cover img")?.naturalWidth>0');
  assert.equal(await b.eval('document.querySelector(".cj-cover figcaption").textContent',player),saved.images[0].caption);
  await shot(player,"art-ui-reader");
  await click(player,".cj-cover .cj-art-preview");
  await until(player,'!!document.querySelector(".image-popout")');
  await click(player,"[data-cj-action=edit]");
  await until(player,'!!document.querySelector(".cj-form")');
  assert.equal(await b.eval('!!document.querySelector(".cj-image-target,.cj-gallery-editor")',player),false);
  console.log("PASS player can open the cover and edit notes with no gallery editor");
}finally{
  if(context)await b.call("Target.disposeBrowserContext",{browserContextId:context}).catch(console.error);
  for(const id of records)try{
    let r=await get(gm,id);
    if(!r.archived)await send(gm,{action:"save",id,revision:r.revision,values:{archived:true}});
    r=await get(gm,id);await send(gm,{action:"delete",id,revision:r.revision});
  }catch(error){console.error(error);}
  if(gm){
    const {targetInfo}=await b.call("Target.getTargetInfo",{},gm);
    await b.call("Target.closeTarget",{targetId:targetInfo.targetId});
  }
  b.close();
}
