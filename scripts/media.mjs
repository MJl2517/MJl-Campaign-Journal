import {ID,imagePath,need} from "./rules.mjs";

export const artIssues=new Map();
export const worldArtFolder=worldId=>`worlds/${worldId}/${ID}/art`;
export function worldImagePath(value,worldId,baseURI=globalThis.document?.baseURI){
  if(!value)return "";
  try{
    const base=new URL(`worlds/${worldId}/`,baseURI),source=new URL(value,baseURI);
    const normalized=new URL(source.origin);normalized.pathname=decodeURIComponent(source.pathname);
    if(source.origin!==base.origin||!normalized.pathname.startsWith(base.pathname))return null;
    return `worlds/${worldId}/${normalized.pathname.slice(base.pathname.length)}`;
  }catch{return null;}
}
async function directory(Picker,path){
  try{return await Picker.browse("data",path);}catch{
    try{await Picker.createDirectory("data",path);}catch(error){try{return await Picker.browse("data",path);}catch{throw error;}}
    return Picker.browse("data",path);
  }
}
export async function copyArt(value){
  const source=imagePath(value);if(!source)return "";
  const own=worldImagePath(source,game.world.id);if(own!==null)return own;
  need(game.user.isGM,"Копирование арта в мир выполняет подключённый мастер.");
  try{
    const response=await fetch(new URL(source,document.baseURI),{credentials:"same-origin"});
    need(response.ok,"Файл изображения недоступен.");const blob=await response.blob(),type=blob.type.split(";")[0];
    const extension={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif","image/svg+xml":"svg","image/avif":"avif","image/bmp":"bmp","image/tiff":"tif","image/apng":"apng","image/x-icon":"ico","image/vnd.microsoft.icon":"ico"}[type];
    need(extension,"Ссылка не вернула поддерживаемое изображение.");
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer())),n=>n.toString(16).padStart(2,"0")).join("");
    const Picker=foundry.applications.apps.FilePicker.implementation,root=`worlds/${game.world.id}/${ID}`,folder=worldArtFolder(game.world.id);
    await directory(Picker,root);const files=await directory(Picker,folder),target=`${folder}/${hash}.${extension}`;
    if(files.files?.some(path=>worldImagePath(path,game.world.id)===target))return target;
    const uploaded=await Picker.upload("data",folder,new File([blob],`${hash}.${extension}`,{type}),{},{notify:false});
    const path=uploaded?.path?worldImagePath(uploaded.path,game.world.id):null;need(path,"Foundry не подтвердил сохранение арта в текущем мире.");return path;
  }catch(error){console.error(`${ID} | world art`,error);throw Error("Не удалось сохранить арт в текущем мире. Проверьте доступность изображения или загрузите его файлом; прежняя запись сохранена.");}
}
export async function localizeArt(record){
  const portrait=record.type==="npc"?await copyArt(record.portrait??""):record.portrait;
  let images=record.images;
  if(record.type==="location"){images=[];for(const image of record.images??[])images.push({...image,src:await copyArt(image.src)});}
  const changed=portrait!==record.portrait||JSON.stringify(images)!==JSON.stringify(record.images);
  if(changed){
    record.artOriginals??={portrait:record.portrait??"",images:foundry.utils.deepClone(record.images??[])};
    if(record.type==="npc")record.portrait=portrait;if(record.type==="location")record.images=images;
  }
  artIssues.delete(record.id);return changed;
}
