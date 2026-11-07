import assert from "node:assert/strict";
import {worldImagePath,worldArtFolder,copyArt,localizeArt} from "../scripts/media.mjs";
let count=0;async function check(name,fn){await fn();console.log(`PASS ${name}`);count++;}
const base="https://example.test/vtt/",ID="mjl-campaign-journal";
globalThis.document={baseURI:base};globalThis.game={world:{id:"test"},user:{isGM:true}};
const folders=new Map(),uploads=[];let fetched=0;
globalThis.foundry={utils:{deepClone:structuredClone},applications:{apps:{FilePicker:{implementation:{
  async browse(_source,path){if(!folders.has(path))throw Error("missing");return {files:folders.get(path)};},
  async createDirectory(_source,path){folders.set(path,[]);},
  async upload(_source,path,file){const target=`${path}/${file.name}`;folders.get(path).push(target);uploads.push(target);return {path:target};}
}}}}};
globalThis.fetch=async url=>{fetched++;return {ok:!url.pathname.includes("missing"),blob:async()=>new Blob(["test image bytes"],{type:url.pathname.includes("html")?"text/html":"image/png"})};};
await check("current world paths are portable and route-prefix aware",()=>{
  assert.equal(worldImagePath("worlds/test/a.png","test"),"worlds/test/a.png");
  assert.equal(worldImagePath(`${base}worlds/test/a%20b%23c.png?token=x`,"test"),"worlds/test/a%20b%23c.png");
  assert.equal(worldImagePath("worlds/test/dir/../a.png","test"),"worlds/test/a.png");
});
await check("other origins, worlds and encoded traversal are not local",()=>{
  for(const path of ["https://evil.test/vtt/worlds/test/a.png","worlds/test-two/a.png","worlds/test/%2e%2e/other/a.png","worlds/test/a%2f..%2f..%2fother/a.png","icons/a.png"])assert.equal(worldImagePath(path,"test"),null,path);
});
await check("native upload stores content hash under current world",async()=>{
  const path=await copyArt("icons/a.png");assert.match(path,new RegExp(`^worlds/test/${ID}/art/[a-f0-9]{64}\\.png$`));assert.equal(uploads.length,1);
});
await check("same bytes reuse existing file; originals are not deleted",async()=>{assert.equal(await copyArt("https://cdn.test/a.png"),uploads[0]);assert.equal(uploads.length,1);});
await check("already local art needs no upload or fetch",async()=>{const n=fetched;assert.equal(await copyArt(uploads[0]),uploads[0]);assert.equal(fetched,n);});
await check("other world art is copied into this world",async()=>{assert.equal(await copyArt("worlds/other/a.png"),uploads[0]);});
await check("switching worlds isolates assets",async()=>{game.world.id="second";assert((await copyArt("icons/a.png")).startsWith(worldArtFolder("second")));assert.equal(uploads.length,2);game.world.id="test";});
await check("legacy original refs retained privately; repeated migration is stable",async()=>{
  const r={id:"npc",type:"npc",portrait:"icons/a.png",images:[]};assert(await localizeArt(r));assert.equal(r.artOriginals.portrait,"icons/a.png");assert.equal(r.portrait,uploads[0]);assert.equal(await localizeArt(r),false);
});
await check("gallery migration is atomic when a later image is missing",async()=>{
  const r={id:"location",type:"location",images:[{src:"icons/a.png",caption:"first"},{src:"icons/missing.png",caption:"second"}]},before=structuredClone(r);
  await assert.rejects(()=>localizeArt(r),/прежняя запись сохранена/);assert.deepEqual(r,before);
});
await check("non-images and unavailable images reject instead of replacing art",async()=>{await assert.rejects(()=>copyArt("icons/html.png"));await assert.rejects(()=>copyArt("icons/missing.png"));});
await check("players cannot import external files as the GM",async()=>{game.user.isGM=false;await assert.rejects(()=>copyArt("icons/a.png"),/подключённый мастер/);game.user.isGM=true;});
console.log(`${count} checks passed`);
