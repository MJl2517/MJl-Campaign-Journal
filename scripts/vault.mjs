import {ID,TITLE,need} from "./rules.mjs";
let rawKey,keyId,aes,initializing;
const encode=bytes=>btoa(Array.from(new Uint8Array(bytes),b=>String.fromCharCode(b)).join(""));
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export function registerVault(){game.settings.register(ID,"vaultKeys",{scope:"client",config:false,type:Object,default:{}});}
export function ready(){return !!aes;}
export async function useKey(value,id){
  const bytes=decode(value);need(bytes.length===32,"Некорректный ключ хранилища.");
  const hash=encode(await crypto.subtle.digest("SHA-256",bytes));need(!id||id===hash,"Этот ключ относится к другому хранилищу.");
  aes=await crypto.subtle.importKey("raw",bytes,"AES-GCM",false,["encrypt","decrypt"]);rawKey=value;keyId=hash;
  await game.settings.set(ID,"vaultKeys",{...game.settings.get(ID,"vaultKeys"),[keyId]:rawKey});
}
export async function initializeVault(documents,fetchKey){
  need(globalThis.crypto?.subtle,"Секретному хранилищу нужен безопасный адрес: откройте Foundry через localhost или HTTPS.");
  if(initializing)return initializing;
  initializing=(async()=>{
    const expected=documents.find(d=>d.getFlag(ID,"sealed"))?.getFlag(ID,"sealed").keyId;
    if(aes&&(!expected||expected===keyId))return;
    const stored=expected?game.settings.get(ID,"vaultKeys")[expected]:null;
    if(stored){await useKey(stored,expected);return;}
    if(expected){
      if(fetchKey){
        const pair=await crypto.subtle.generateKey({name:"RSA-OAEP",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},false,["encrypt","decrypt"]);
        const publicKey=await crypto.subtle.exportKey("jwk",pair.publicKey),reply=await fetchKey(publicKey);
        if(reply?.ciphertext){const bytes=await crypto.subtle.decrypt({name:"RSA-OAEP"},pair.privateKey,decode(reply.ciphertext));await useKey(encode(bytes),expected);return;}
      }
      throw Error(`Нет ключа секретного хранилища. Импортируйте резервный ключ в настройках «${TITLE} · ключ мастера» либо подключите мастера с ключом и включите Socketlib.`);
    }
    await useKey(encode(crypto.getRandomValues(new Uint8Array(32))));
    ui.notifications.warn(`Хроника: сохраните резервный ключ через Настройки → Настройки модулей → ${TITLE} · ключ мастера. Он нужен для восстановления секретов в новом браузере.`,{permanent:true});
  })();
  try{await initializing;}finally{initializing=null;}
}
export async function sealed(record){
  need(aes,"Секретное хранилище не открыто.");const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=new TextEncoder().encode(JSON.stringify(record));
  const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(record.id)},aes,data);
  return {version:1,keyId,iv:encode(iv),ciphertext:encode(ciphertext)};
}
export async function unseal(value,id){
  need(aes&&value.version===1&&value.keyId===keyId,"Неизвестный формат или ключ секретного хранилища.");
  const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(value.iv),additionalData:new TextEncoder().encode(id)},aes,decode(value.ciphertext));
  const r=JSON.parse(new TextDecoder().decode(bytes));need(r.id===id,"Повреждена связь секретной записи.");return r;
}
export async function wrapKey(publicKey){
  need(rawKey,"Ключ мастера ещё не загружен.");need(publicKey?.kty==="RSA"&&publicKey.n?.length<=1400,"Некорректный запрос ключа.");
  const rsa=await crypto.subtle.importKey("jwk",publicKey,{name:"RSA-OAEP",hash:"SHA-256"},false,["encrypt"]);
  return {ciphertext:encode(await crypto.subtle.encrypt({name:"RSA-OAEP"},rsa,decode(rawKey)))};
}
export function backupKey(){need(game.user.isGM&&rawKey,"Ключ мастера недоступен.");return JSON.stringify({module:ID,world:game.world.id,keyId,key:rawKey},null,2);}
export async function importKey(json){need(game.user.isGM,"Ключом управляет мастер.");const data=JSON.parse(json);need(data.module===ID,"Выбран другой файл.");await useKey(data.key,data.keyId);}
export class VaultMenu extends foundry.applications.api.ApplicationV2{
  static DEFAULT_OPTIONS={classes:["mjl-brand","mjl-chronicle","cj-vault"],window:{title:`${TITLE} · ключ мастера`,icon:"fa-solid fa-key"},position:{width:580}};
  async _renderHTML(){return '<p>Секреты зашифрованы. Ключ хранится в этом браузере мастера. Сохраните его отдельно от мира: файл даёт доступ к секретам. При включённом Socketlib новый браузер может получить ключ от подключённого мастера автоматически.</p><button type="button" data-export>Скачать резервный ключ</button><hr><label>Восстановить из файла JSON<input type="file" accept=".json" data-import></label><p role="status"></p>';}
  _replaceHTML(result,content){content.innerHTML=`<div class="cj-shell cj-vault-content">${result}</div>`;}
  _onRender(){this.element.querySelector('[data-export]').onclick=()=>{try{foundry.utils.saveDataToFile(backupKey(),"application/json",`chronicle-key-${game.world.id}.json`);}catch(e){ui.notifications.error(e.message);}};this.element.querySelector('[data-import]').onchange=async e=>{try{const data=await e.target.files[0].text();await importKey(data);this.element.querySelector('[role=status]').textContent="Ключ импортирован. Перезагрузите страницу.";}catch(error){ui.notifications.error(error.message);}};}
}
