import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {browser} from './cdp.mjs';
const b=await browser(),contexts=[],report={passed:[]},base='http://127.0.0.1:30020',ID='mjl-campaign-journal';
let gm;
const ev=(s,fn,args)=>b.eval(`(${fn.toString()})(${JSON.stringify(args??null)})`,s);
const pass=name=>{report.passed.push(name);console.log(`PASS ${name}`);};
const count=s=>b.eval('document.querySelectorAll(".mjl-chronicle").length',s);
async function click(s,selector){
  await b.until(`!!document.querySelector(${JSON.stringify(selector)})`,s);
  const p=await ev(s,selector=>{const r=document.querySelector(selector).getBoundingClientRect(),p={x:r.x+r.width/2,y:r.y+r.height/2};globalThis.lastToolbarClick={selector,...p,target:document.elementFromPoint(p.x,p.y)?.outerHTML.slice(0,350)};return p;},selector);
  await b.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p},s);
  await b.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p},s);await b.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p},s);
}
async function category(s,name){await click(s,`button.layer[data-control="${name}"]`);await b.until(`ui.controls.control?.name===${JSON.stringify(name)}`,s);await b.eval('new Promise(resolve=>setTimeout(resolve,200))',s);}
async function check(s,label){
  await b.until('canvas.ready',s);assert.equal(await b.eval('game.world.id',s),'chronicle-test');
  await b.eval('document.querySelector(".application.user-config [type=submit]")?.click()',s);
  await category(s,'tokens');await category(s,ID);assert.equal(await count(s),0);assert.equal(await b.eval('ui.controls.tool',s),null);pass(`${label}: category selection opens no window`);
  for(const type of ['npc','location','quest']){
    await click(s,`button.tool[data-tool="${type}"]`);await b.until(`!!document.querySelector('#${ID}-${type} .cj-shell')`,s);assert.equal(await count(s),1);pass(`${label}: ${type} button opens its window`);
    await click(s,`#${ID}-${type} .window-header [data-action="close"]`);await b.until('document.querySelectorAll(".mjl-chronicle").length===0',s);
    await category(s,'tokens');assert.equal(await count(s),0);await category(s,ID);assert.equal(await count(s),0);pass(`${label}: closing ${type} and changing categories never reopens it`);
  }
}
try{
 const target=(await b.call('Target.getTargets')).targetInfos.find(t=>t.url===`${base}/game`);gm=(await b.call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;await b.call('Runtime.enable',{},gm);await b.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},gm);b.events=[];await check(gm,'GM');
 const {browserContextId}=await b.call('Target.createBrowserContext');contexts.push(browserContextId);const p=await b.page(`${base}/join`,browserContextId);await b.until('document.querySelector("[name=userid]")',p);await b.eval('document.querySelector("[name=userid]").value=[...document.querySelector("[name=userid]").options].find(o=>o.text==="Chronicle Player A").value;document.querySelector("[name=join]").click()',p);await b.until('game.ready&&game.modules.get("mjl-campaign-journal")?.api',p,60000);await check(p,'Player');
 assert.equal(b.events.filter(e=>e.method==='Runtime.exceptionThrown').length,0);pass('no unhandled JavaScript exceptions');
}catch(error){report.error=error.stack;if(gm)report.state=await b.eval('({control:ui.controls.control?.name,lastClick:globalThis.lastToolbarClick,notifications:[...document.querySelectorAll(".notification")].map(e=>e.innerText)})',gm);console.error(error,report.state);process.exitCode=1;}
finally{await writeFile(new URL('../dev/toolbar-report.json',import.meta.url),JSON.stringify(report,null,2));for(const id of contexts)await b.call('Target.disposeBrowserContext',{browserContextId:id}).catch(()=>{});b.close();}
