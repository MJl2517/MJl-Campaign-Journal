import {ID,TITLE,TYPES,STATUS,esc,need,matches,remaining,dateParts,imagePath,mergeTags,text,tagChoices,tagAssignments,questMatches} from "./rules.mjs";
import {entries,entry,request,writeBlock,pointcrawlDoc,pointcrawlNotebooks,pointcrawlChoices,regionKey,locationSelectable,tagLibrary} from "./store.mjs";
import {calendarLabel} from "./calendar.mjs";
import {artIssues} from "./media.mjs";
const {ApplicationV2,DialogV2}=foundry.applications.api;
const clone=v=>foundry.utils.deepClone(v);
const locationDragType="application/x-mjl-chronicle-location";
const btn=(action,label,extra="")=>`<button type="button" data-cj-action="${action}" ${extra}>${label}</button>`;
const field=(label,name,value,type="text",attrs="")=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
const area=(label,name,value)=>`<label>${label}<textarea name="${name}" rows="5">${esc(value)}</textarea></label>`;
const opts=(items,value)=>Object.entries(items).map(([k,v])=>`<option value="${esc(k)}" ${String(value)===k?"selected":""}>${esc(v)}</option>`).join("");
const confirm=(title,content)=>DialogV2.confirm({classes:["mjl-brand"],window:{title,icon:"fa-solid fa-book-open"},content:`<p>${esc(content)}</p>`,rejectClose:false,yes:{label:"Подтвердить"},no:{label:"Отмена"}});
const prose=value=>`<div class="cj-prose">${esc(value).replace(/\n/g,"<br>")}</div>`;
const actorHandle=r=>game.user.isGM&&r.type==="npc"&&r.actorUuid?`draggable="true" data-cj-actor-uuid="${esc(r.actorUuid)}" title="Перетащите на сцену, чтобы добавить токен Actor"`:"";
export function recordMenuTarget(target){const record=target.closest(".cj-row,.cj-card-preview"),control=target.closest("button,a,input,textarea,select,label,summary,[contenteditable],[role=button],[data-cj-action]");return record&&(!control||control===record)?record:null;}
export function locationChoices(includeHidden=false){return entries().filter(r=>locationSelectable(r,includeHidden)).sort((a,b)=>a.name.localeCompare(b.name,"ru"));}
function currentLocation(uuid){return locationChoices(game.user.isGM).find(r=>r.uuid===uuid);}
const locationPlaceholder=r=>r.locationUuid||r.locationUnknown?"Неизвестно":"Локация не указана";
function groupedLocationRows(choices,row,isOpen){
  const parents=new Map(choices.filter(r=>r.link&&!r.link.locationId).map(r=>[regionKey(r.link),r.uuid]));
  const standalone=new Set(choices.filter(r=>!r.link&&!r.pointcrawlUuid).map(r=>r.uuid));
  const children=new Map();
  const nestedIds=new Set();
  for(const r of choices){
    const parent=r.link?.locationId?parents.get(regionKey(r.link)):
      standalone.has(r.uuid)&&standalone.has(r.parentUuid)?r.parentUuid:null;
    if(!parent)continue;
    if(!children.has(parent))children.set(parent,[]);
    children.get(parent).push(r);
    nestedIds.add(r.uuid);
  }
  const render=(r,kind)=>{
    const nested=children.get(r.uuid);
    if(!nested)return row(r,kind);
    return `<details class="cj-location-group" data-location-group="${esc(r.uuid)}" ${isOpen(r,nested)?"open":""}><summary>${esc(r.name)}${r.visibility?`<small>${esc(r.visibility)}</small>`:""}</summary><div class="cj-location-nested">${row(r,r.link?"region":"parent")}${nested.map(child=>render(child,"child")).join("")}</div></details>`;
  };
  return choices.filter(r=>!nestedIds.has(r.uuid)).map(r=>render(r)).join("");
}
async function chooseRecord(title,choices,selected="",clear=false){
  const byUuid=new Map(choices.map(r=>[r.uuid,r]));
  const row=(r,kind)=>{
    const name=kind==="region"?"Весь регион":kind==="child"?r.label??r.name:r.name,notes=kind==="region"?"":r.notes;
    return `<label class="cj-choice" data-choice="${esc(r.uuid)}"><input type="radio" name="choice" value="${esc(r.uuid)}" ${r.uuid===selected?"checked":""}><span><strong>${esc(name)}</strong>${notes?`<small>${esc(notes.slice(0,180))}</small>`:""}</span></label>`;
  };
  const rows=groupedLocationRows(choices,row,(r,nested)=>r.uuid===selected||nested.some(child=>child.uuid===selected));
  return DialogV2.prompt({classes:["mjl-brand","mjl-chronicle","cj-picker"],window:{title,icon:"fa-solid fa-book-open",resizable:true},position:{width:620},rejectClose:false,
    content:`<div class="cj-picker-body"><label>Поиск<input type="search" name="choiceSearch" autofocus placeholder="Название или заметки…"></label>${clear?`<label class="cj-choice"><input type="radio" name="choice" value="" ${selected!==null&&!choices.some(r=>r.uuid===selected)?"checked":""}><span>Не указана</span></label>`:""}<div class="cj-choice-list">${rows}</div><p class="cj-muted" data-choice-empty ${choices.length?"hidden":""}>Доступных записей не найдено</p></div>`,
    render:event=>{
      const root=event.target.element,groups=root.querySelectorAll(".cj-location-group"),folds=new Map();
      root.querySelector('[name="choiceSearch"]').addEventListener("input",e=>{
        const query=e.target.value.trim();
        let found=0;
        for(const option of root.querySelectorAll("[data-choice]")){
          option.hidden=!matches(byUuid.get(option.dataset.choice),query);
          if(!option.hidden)found++;
          else option.querySelector("input").checked=false;
        }
        for(const group of groups){
          group.hidden=!group.querySelector("[data-choice]:not([hidden])");
          if(query){
            if(!folds.has(group))folds.set(group,group.open);
            group.open=!group.hidden;
          }else if(folds.has(group))group.open=folds.get(group)||!!group.querySelector("input:checked");
        }
        if(!query)folds.clear();
        root.querySelector("[data-choice-empty]").hidden=!!found;
      });
    },
    ok:{label:"Выбрать",callback:(_e,b)=>{const choice=b.form.querySelector('[name="choice"]:checked');need(choice,"Выберите запись из списка.");return choice.value;}}});
}
export class TagLibraryApp extends ApplicationV2{
  static instance;
  static DEFAULT_OPTIONS={classes:["mjl-brand","mjl-chronicle","cj-tags-window"],window:{title:"Теги партии",icon:"fa-solid fa-tags",resizable:true},position:{width:540,height:"auto"}};
  static open(owner){this.instance??=new this({id:`${ID}-tags`});this.instance.owner=owner;this.instance.render({force:true});return this.instance;}
  query="";page=0;busy=false;error="";
  results(){
    const library=tagLibrary(),{items:all}=tagChoices(library,[],this.query,library.length),pages=Math.max(1,Math.ceil(all.length/25));this.page=Math.min(this.page,pages-1);
    const owner=this.owner,canAssign=owner?.rendered&&owner.editing&&owner.type==="npc",selected=new Set((canAssign?owner.draft.tags:[]).map(t=>t.toLocaleLowerCase("ru"))),canWrite=!writeBlock();
    return `<div class="cj-tag-library-list">${all.slice(this.page*25,this.page*25+25).map(tag=>`<div class="cj-library-row" data-library-tag="${esc(tag)}"><span><strong>${esc(tag)}</strong><small>Общих карточек: ${tagAssignments(entries(),tag).length}</small></span>${canAssign?`<button type="button" data-tag-action="assign" ${!canWrite||selected.has(tag.toLocaleLowerCase("ru"))?"disabled":""}>${selected.has(tag.toLocaleLowerCase("ru"))?"Назначен":"Назначить"}</button>`:""}<button type="button" data-tag-action="delete" class="cj-danger" aria-label="Удалить общий тег ${esc(tag)}" ${canWrite?"":"disabled"}><i class="fa-solid fa-trash"></i></button></div>`).join("")||'<p class="cj-muted">Теги не найдены.</p>'}</div><div class="cj-tag-pager"><button type="button" data-tag-action="previous" aria-label="Предыдущая страница" ${this.page?"":"disabled"}><i class="fa-solid fa-chevron-left"></i></button><span role="status">${all.length?`${this.page*25+1}–${Math.min(all.length,this.page*25+25)} из ${all.length}`:"0"} · ${this.page+1} / ${pages}</span><button type="button" data-tag-action="next" aria-label="Следующая страница" ${this.page+1<pages?"":"disabled"}><i class="fa-solid fa-chevron-right"></i></button></div>`;
  }
  async _renderHTML(){return `<div class="cj-shell cj-tag-library"><label>Поиск по всем тегам<input type="search" name="tagSearch" value="${esc(this.query)}" placeholder="Название тега…" autocomplete="off"></label><p class="cj-muted">Крестик на листе снимает тег с одного НИП. Корзина здесь удаляет тег из общего списка и всех открытых карточек, включая архив. Скрытые карточки мастера сохраняются.</p><div class="cj-tag-library-results">${this.results()}</div><p class="cj-tag-library-status" role="status">${esc(this.error)}</p></div>`;}
  _replaceHTML(html,content){const input=content.querySelector('[name="tagSearch"]'),focused=input===document.activeElement,start=input?.selectionStart,end=input?.selectionEnd;content.innerHTML=html;if(focused){const next=content.querySelector('[name="tagSearch"]');next.focus();next.setSelectionRange(start,end);}}
  _onRender(context,options){
    super._onRender(context,options);this.listenerController?.abort();const signal=(this.listenerController=new AbortController()).signal;
    this.element.addEventListener("input",e=>{if(e.target.name==="tagSearch"){this.query=e.target.value;this.page=0;this.element.querySelector('.cj-tag-library-results').innerHTML=this.results();}},{signal});
    this.element.addEventListener("click",e=>{const button=e.target.closest('[data-tag-action]');if(button&&!button.disabled){e.preventDefault();this.run(()=>this.action(button.dataset.tagAction,button.closest('[data-library-tag]')?.dataset.libraryTag));}},{signal});
  }
  async run(fn){if(this.busy)return;this.busy=true;try{await fn();this.error="";}catch(error){this.error=error.message;ui.notifications.error(error.message);}finally{this.busy=false;if(this.rendered)this.render();}}
  async action(action,tag){
    if(action==="previous"||action==="next"){this.page+=action==="next"?1:-1;return;}
    const owner=this.owner;
    if(action==="assign"){need(owner?.rendered&&owner.editing&&owner.type==="npc"&&!owner.busy,"Откройте редактирование персонажа и дождитесь сохранения.");owner.capture();owner.addTags(tag);owner.changed();owner.render();return;}
    need(action==="delete","Неизвестное действие с тегом.");const expected=tagAssignments(entries(),tag);
    if(!await confirm("Удалить общий тег?",`«${tag}» будет удалён из общего списка и ${expected.length} открытых карточек НИП (включая архив). Скрытые карточки мастера не меняются.`))return;
    const result=await request({action:"deleteTag",tag,expected});
    if(owner?.rendered&&owner.editing&&!owner.busy){
      owner.capture();const r=owner.draft,updated=result.updated.find(v=>v.id===r.id),before=expected.find(v=>v.id===r.id);
      if(updated&&r.revision===before.revision){await owner.waitRevision(updated);r.revision=updated.revision;}
      r.tags=r.tags.filter(t=>t.toLocaleLowerCase("ru")!==tag.toLocaleLowerCase("ru"));if(r.tagInput)r.tagInput=r.tagInput.split(",").filter(t=>t.trim().toLocaleLowerCase("ru")!==tag.toLocaleLowerCase("ru")).join(", ");owner.render();
    }
  }
}
export class ChronicleApp extends ApplicationV2{
  static instances=new Map();
  static DEFAULT_OPTIONS={classes:["mjl-brand","mjl-chronicle"],window:{title:TITLE,icon:"fa-solid fa-book-open",resizable:true},position:{width:980,height:"auto"}};
  static open(type="npc",id){
    need(Object.hasOwn(TYPES,type),"Неизвестный каталог.");let app=this.instances.get(type);
    if(!app){app=new this({id:`${ID}-${type}`});app.type=type;this.instances.set(type,app);}
    if(id&&id!==app.selected&&app.dirty){app.run(async()=>{if(await app.leave()){app.select(id);app.render({force:true});}});return app;}
    if(id&&(!app.editing||!app.dirty||id!==app.selected))app.select(id);app.render({force:true});return app;
  }
  type="npc";selected="";draft=null;dirty=false;editing=false;busy=false;query="";tag="";questFilter="";archive=false;error="";sections=new Map();locationGroups=new Map();
  listMatches(r){return !!r&&!!r.archived===this.archive&&matches(r,this.query,this.tag,game.user.isGM)&&(this.type!=="quest"||questMatches(r,this.questFilter,game.time.worldTime));}
  filterRows(){
    for(const row of this.element.querySelectorAll("[data-entry]"))row.hidden=!this.listMatches(entry(row.dataset.entry));
    for(const group of this.element.querySelectorAll(".cj-list [data-location-group]")){
      group.hidden=!group.querySelector("[data-entry]:not([hidden])");
      group.open=!!this.query.trim()||(this.locationGroups.get(group.dataset.locationGroup)??!!group.querySelector(".cj-row.active"));
    }
    const empty=this.element.querySelector(".cj-list .cj-empty");if(empty)empty.hidden=!!this.element.querySelector(".cj-row:not([hidden])");
  }
  select(id){const r=entry(id);this.resetScroll=id!==this.selected;this.selected=id;this.draft=r?clone(r):null;this.dirty=false;this.editing=false;this.error="";this.deadlineMode="keep";}
  async leave(){return !this.dirty||await confirm("Несохранённые изменения","Закрыть текущий черновик без сохранения?");}
  async close(options={}){if(!await this.leave())return;if(this.contextMenu&&ui.context===this.contextMenu)await this.contextMenu.close({animate:false});if(this.selected)this.select(this.selected);return super.close(options);}
  async _renderHTML(){
    if(this.selected&&!this.dirty){const current=entry(this.selected);this.draft=current?clone(current):null;}
    const list=entries().filter(r=>r.type===this.type&&!!r.archived===this.archive).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
    const tags=[...new Set(list.flatMap(r=>r.tags??[]))].sort((a,b)=>a.localeCompare(b,"ru"));
    const block=writeBlock(),canWrite=!block,gm=game.user.isGM,r=this.draft;
    const exists=entry(this.selected);if(!exists&&this.selected){this.draft=null;this.dirty=false;this.editing=false;}
    const row=(e,kind)=>`<button type="button" draggable="true" data-entry="${e.id}" data-cj-action="select" class="cj-row ${e.id===this.selected?"active":""}" ${this.listMatches(e)?"":"hidden"}>${e.portrait?`<img src="${esc(e.portrait)}" alt="">`:'<i class="fa-solid fa-bookmark"></i>'}<span>${kind==="region"?"Весь регион":esc(e.name)}<small>${!e.published?"Скрыта от игроков":this.type==="quest"?`${STATUS[e.status]}${e.status==="active"&&e.deadline!=null&&e.deadline<=game.time.worldTime?" · Просрочен":""}`:(e.tags??[]).map(esc).join(" · ")}</small></span></button>`;
    const rows=this.type==="location"?groupedLocationRows(list.map(e=>{
      const link=e.pointcrawlUuid&&pointcrawlDoc(e.pointcrawlUuid)?.getFlag("mjl-pointcrawl","notebook");
      return {...e,link:link&&!link.archived?link:null};
    }),row,(e,nested)=>!!this.query.trim()||(this.locationGroups.get(e.uuid)??[e,...nested].some(r=>r.id===this.selected))):list.map(e=>row(e)).join("");
    return `<div class="cj-shell"><header class="cj-toolbar"><h2>${TYPES[this.type]}</h2>${btn("create","<i class=\"fa-solid fa-plus\"></i> Создать",!canWrite||this.type==="location"&&!gm?"disabled":"")}${gm&&this.type==="location"&&game.modules.get("mjl-pointcrawl")?.active?btn("importPointcrawl","<i class=\"fa-solid fa-map\"></i> Импорт из Pointcrawl",canWrite?"":"disabled"):""}${this.type==="npc"?btn("tags","<i class=\"fa-solid fa-tags\"></i> Теги"):""}${gm&&this.type==="quest"?btn("sync","Синхронизировать календарь",!canWrite?"disabled":""):""}<label class="cj-check"><input type="checkbox" name="archiveView" ${this.archive?"checked":""}>Архив</label></header>
    ${block?`<p class="cj-banner">${esc(block)} Доступен просмотр.</p>`:gm&&artIssues.size?`<p class="cj-banner">Не удалось перенести арты в мир у ${artIssues.size} записей. В их карточках есть пояснение; исходные записи сохранены.</p>`:""}
    <div class="cj-layout"><aside><label>Поиск<input name="search" type="search" value="${esc(this.query)}" placeholder="Название, заметки, теги…"></label>${this.type==="npc"?`<label>Тег<select name="tagFilter"><option value="">Все теги</option>${opts(Object.fromEntries(tags.map(t=>[t,t])),this.tag)}</select></label>`:""}${this.type==="quest"?`<label>Квесты<select name="questFilter">${opts({"":"Все квесты",active:"Активные",overdue:"Просроченные",completed:"Завершённые",failed:"Проваленные"},this.questFilter)}</select></label>`:""}<div class="cj-list">${rows}<p class="cj-empty" ${list.some(e=>this.listMatches(e))?"hidden":""}>Записей не найдено</p></div></aside>
    <main>${this.draft?this.card(this.draft,canWrite):'<div class="cj-empty"><i class="fa-solid fa-book-open"></i><p>Выберите запись или создайте новую.</p></div>'}</main></div><footer role="status">${this.busy?"Сохранение…":this.error?esc(this.error):this.dirty?"Есть несохранённые изменения":""}</footer></div>`;
  }
  card(r,canWrite){return this.editing?this.editor(r,canWrite):this.cardPreview(r,canWrite);}
  cardPreview(r,canWrite){
    const gm=game.user.isGM,loc=r.type==="npc"?currentLocation(r.locationUuid):null;
    const actorDrag=actorHandle(r);
    const section=(title,body,extra="")=>`<section class="cj-reading-section cj-block ${extra}"><h3>${title}</h3>${body}</section>`;
    let body="";
    if(r.type==="npc"){
      const tags=r.tags?.length?`<div class="cj-tags">${r.tags.map(t=>`<span>${esc(t)}</span>`).join("")}</div>`:"";
      const portrait=r.portrait?`<div class="cj-profile-block"><img class="cj-portrait-preview" src="${esc(r.portrait)}" alt="${esc(r.name)}" data-cj-action="preview" data-src="${esc(r.portrait)}" ${actorDrag}>${tags}</div>`:"";
      const where=`<p class="cj-location-summary"><i class="fa-solid fa-location-dot"></i> ${loc?btn("openLink",esc(loc.name),`class="cj-text-link" data-uuid="${esc(loc.uuid)}"`):locationPlaceholder(r)}</p>${gm&&r.actorUuid?`<div class="cj-reading-actions">${btn("actor","<i class=\"fa-solid fa-address-card\"></i> Статблок",`class="cj-text-link" ${actorDrag}`)}<small class="cj-muted">Перетащите статблок или портрет на сцену, чтобы добавить токен.</small></div>`:""}`;
      body=`<div class="cj-person-preview ${r.portrait?"has-portrait":""}">${portrait}<div class="cj-block-stack">${!r.portrait?tags:""}${section("Местонахождение",where,"cj-facts-block")}${section("Заметки партии",r.notes?prose(r.notes):'<p class="cj-muted">Пока нет заметок.</p>')}</div></div>`;
    }
    if(r.type==="location"){
      const gallery=r.images?.length?section("Галерея",`<div class="cj-gallery-grid cj-gallery-preview ${r.images.length===1?"cj-single-art":""}">${r.images.map(img=>`<figure><img src="${esc(img.src)}" alt="${esc(img.caption||r.name)}" data-cj-action="preview" data-src="${esc(img.src)}">${img.caption?`<figcaption>${esc(img.caption)}</figcaption>`:""}</figure>`).join("")}</div>`):"";
      body=`<div class="cj-block-stack">${gallery}${r.pointcrawlUuid?section("Заметки локации",btn("notebook","<i class=\"fa-solid fa-book-open\"></i> Открыть журнал локации",'class="cj-text-link"')):section("Заметки партии",r.notes?prose(r.notes):'<p class="cj-muted">Пока нет заметок.</p>')}</div>`;
    }
    if(r.type==="quest"){
      const deadline=r.deadline!=null?dateParts(game.time.calendar,r.deadline):null,date=deadline?`${deadline.day+1} ${game.i18n.localize(game.time.calendar.months.values[deadline.month]?.name??"")}, ${deadline.year} · ${String(deadline.hour).padStart(2,"0")}:${String(deadline.minute).padStart(2,"0")}`:"";
      const links=r.links.map(uuid=>{const target=entries().find(e=>e.uuid===uuid);return target?`<li>${btn("openLink",`<i class="fa-solid ${target.type==="npc"?"fa-user":"fa-location-dot"}"></i> ${esc(target.name)}`,`class="cj-text-link" data-uuid="${esc(uuid)}"`)}</li>`:'<li class="cj-muted">Запись недоступна</li>';}).join("");
      const done=r.conditions.filter(c=>c.done).length;
      const conditions=r.conditions.length?section(`Условия выполнения <span class="cj-block-caption">${done} / ${r.conditions.length}</span>`,`<progress class="cj-progress" value="${done}" max="${r.conditions.length}" aria-label="Выполнение квеста"></progress><ul class="cj-checklist-preview">${r.conditions.map((c,i)=>`<li class="${c.done?"done":""}"><label><input type="checkbox" data-cj-condition-check="${i}" ${c.done?"checked":""} ${canWrite?"":"disabled"}><span>${esc(c.text)}</span></label></li>`).join("")}</ul>${r.status==="active"&&done===r.conditions.length?`<div class="cj-complete-action">${btn("completeQuest","<i class=\"fa-solid fa-check\"></i> Завершить квест",canWrite?'class="cj-primary"':'class="cj-primary" disabled')}</div>`:""}`):"";
      const primary=`${r.description?section("Задача",prose(r.description)):""}${conditions}${r.notes?section("Заметки партии",prose(r.notes)):""}`;
      const timing=section("Срок",`<p class="cj-countdown ${r.status==="active"&&r.deadline!=null&&r.deadline<=game.time.worldTime?"cj-overdue":""}">${esc(r.status==="active"?remaining(r.deadline,game.time.worldTime,game.time.calendar):date||"Без срока")}</p>${date&&r.status==="active"?`<p class="cj-muted">${esc(date)}</p>`:""}${calendarLabel(r)?`<p class="cj-muted cj-calendar-state"><i class="fa-regular fa-calendar"></i> ${esc(calendarLabel(r))}</p>`:""}`,"cj-deadline-block");
      body=`<div class="cj-quest-preview ${primary?"":"cj-single-column"}">${primary?`<div class="cj-block-stack">${primary}</div>`:""}<div class="cj-block-stack">${timing}${links?section("Связи",`<ul class="cj-reference-list">${links}</ul>`):""}</div></div>`;
    }
    return `<article class="cj-card-preview"><header class="cj-preview-header"><div><h2>${esc(r.name)}</h2><div class="cj-card-meta">${r.type==="quest"?`<span class="cj-status-text">${STATUS[r.status]}</span>`:""}${gm&&!r.published?'<span>Скрыта от игроков</span>':""}${r.archived?'<span>Архив</span>':""}</div></div>${btn("edit","<i class=\"fa-solid fa-pen\"></i> Редактировать",canWrite?'class="cj-edit-button"':'class="cj-edit-button" disabled')}</header>${gm&&artIssues.has(r.id)?`<p class="cj-storage-warning" role="status">${esc(artIssues.get(r.id))}</p>`:""}${body}${gm&&r.gmNotes?`<div class="cj-secret-preview">${this.fold("gm-preview",'<i class="fa-solid fa-lock"></i> Заметки мастера',prose(r.gmNotes))}</div>`:""}</article>`;
  }
  editor(r,canWrite){
    const gm=game.user.isGM,linked=r.type==="location"&&r.pointcrawlUuid;
    return `<form class="cj-form"><fieldset><div class="cj-title-row">${field("Название","name",r.name,"text",r.type==="location"&&!gm?"disabled":"")}${btn("save","Сохранить",'class="cj-primary"')}${btn("cancelEdit","Отмена")}</div>
    ${gm?`<label class="cj-check"><input type="checkbox" name="published" ${r.published?"checked":""}>Открыта игрокам</label>`:""}
    ${r.type==="npc"?this.fold("portrait","Портрет и теги",this.npc(r),true):r.type==="location"?(gm?this.fold("location","Арты и связь с картой",this.location(r),true):""):this.quest(r)}
    ${r.type==="npc"?this.fold("where","Текущая локация",`<div class="cj-location-editor"><span>${esc(currentLocation(r.locationUuid)?.name??locationPlaceholder(r))}</span>${btn("chooseLocation","Выбрать локацию")}</div>`,true):""}
    ${this.fold("notes","Заметки партии",linked?`<p class="cj-muted">Общие заметки ведутся в журнале Pointcrawl.</p>${btn("notebook","Открыть исходный журнал")}`:area("Общие записи","notes",r.notes),true)}
    ${gm?this.fold("gm","Заметки мастера",area("Секретные сведения","gmNotes",r.gmNotes)):""}
    ${this.fold("advanced","Дополнительно",`<div class="cj-actions">${btn("archive",r.archived?"Вернуть из архива":"В архив")}${gm&&r.archived?btn("delete","Удалить навсегда",'class="cj-danger"'):""}</div>`)}
    </fieldset></form>`;
  }
  fold(key,title,body,open=false){return `<details class="cj-fold" data-cj-section="${this.selected}:${key}" ${(this.sections.get(`${this.selected}:${key}`)??open)?"open":""}><summary>${title}</summary><div class="cj-fold-content">${body}</div></details>`;}
  tagEditor(r){
    return `<section class="cj-tag-editor"><h3>Теги</h3><div class="cj-tag-chips">${r.tags.map((t,i)=>btn("removeTag",`${esc(t)} <i class="fa-solid fa-xmark"></i>`,`data-index="${i}" aria-label="Убрать тег ${esc(t)}"`)).join("")}</div><div class="cj-tag-entry">${field("Новый или существующий тег","newTag",r.tagInput??"","text",'maxlength="80" autocomplete="off"')}${btn("addTag","<i class=\"fa-solid fa-plus\"></i>",'aria-label="Добавить тег"')}</div><div class="cj-tag-matches">${this.tagSuggestions(r)}</div>${btn("tags",`Все теги · ${tagLibrary().length}`)}<p class="cj-muted">Enter добавляет тег. Крестик снимает тег с этого персонажа; удалить общий тег можно в списке всех тегов.</p></section>`;
  }
  tagSuggestions(r){const {items,total}=tagChoices(tagLibrary(),r.tags,r.tagInput??"");return `<div class="cj-tag-suggestions" aria-label="Сохранённые теги">${items.map(t=>btn("addTag",esc(t),`data-tag="${esc(t)}"`)).join("")}</div><p class="cj-muted" role="status">${total?`Показано ${items.length} из ${total}. Уточните поиск или откройте все теги.`:"Совпадений нет. Enter создаст новый тег."}</p>`;}
  addTags(value){
    const added=value.split(",").map(v=>text(v,80)),known=mergeTags(tagLibrary(),this.draft.tags,added),wanted=mergeTags(this.draft.tags,added);
    need(wanted.length<=40,"Не больше 40 тегов.");this.draft.tags=known.filter(t=>wanted.some(v=>v.toLocaleLowerCase("ru")===t.toLocaleLowerCase("ru")));this.draft.tagInput="";
  }
  npc(r){return `<div class="cj-npc"><div class="cj-image-target" data-image-target="portrait" tabindex="0" aria-label="Портрет: перетащите или вставьте изображение">${r.portrait?`<img data-cj-action="preview" data-src="${esc(r.portrait)}" src="${esc(r.portrait)}" alt="Портрет ${esc(r.name)}">`:'<i class="fa-solid fa-user"></i>'}<p>Перетащите изображение или нажмите Ctrl+V</p>${field("Путь или ссылка","portrait",r.portrait)}${btn("picker","Выбрать арт",'data-image-target="portrait"')}</div><div>${this.tagEditor(r)}${game.user.isGM?`<div class="cj-panel cj-actor" tabindex="0" aria-label="Перетащите Actor Foundry">${field("Статблок · UUID Actor","actorUuid",r.actorUuid)}<p>Перетащите существо или персонажа из мира / компендиума.</p>${btn("actor","Открыть статблок",r.actorUuid?actorHandle(r):"disabled")}</div>`:""}</div></div>`;}
  location(r){
    if(!game.user.isGM)return "";
    return `<div class="cj-location-editor"><span>${esc(r.pointcrawlUuid?pointcrawlDoc(r.pointcrawlUuid)?.name??"Журнал недоступен":"Собственная карточка")}</span>${btn("choosePointcrawl","Выбрать локацию Pointcrawl")}</div>${r.pointcrawlUuid?'<p>При связывании общие заметки остаются только в исходном журнале. Скопируйте туда прежний текст перед связыванием.</p>':""}<section class="cj-gallery cj-image-target" data-image-target="gallery" tabindex="0" aria-label="Галерея локации: перетащите или вставьте изображение"><h3>Изображения локации</h3><p class="cj-muted">Галерея видна игрокам у открытых локаций.</p><p>Перетащите изображения или нажмите Ctrl+V</p><div class="cj-gallery-grid">${r.images.map((img,i)=>`<figure><img src="${esc(img.src)}" alt="${esc(img.caption||r.name)}" data-cj-action="preview" data-src="${esc(img.src)}"><input aria-label="Путь арта" name="imageSrc${i}" value="${esc(img.src)}"><input aria-label="Подпись арта" name="imageCaption${i}" value="${esc(img.caption)}">${btn("removeImage","Убрать из галереи",`data-index="${i}"`)}</figure>`).join("")}</div>${btn("picker","Выбрать арт",'data-image-target="gallery"')}${btn("imagePath","Добавить по пути")}</section>`;
  }
  quest(r){
    const calendar=game.time.calendar,c=r.deadline!=null?dateParts(calendar,r.deadline):dateParts(calendar,game.time.worldTime),d=r.deadlineForm??{mode:this.deadlineMode??"keep",...c,days:1,hours:0};
    const conditions=`${r.conditions.map((v,i)=>`<div class="cj-condition" data-condition="${i}"><input type="checkbox" aria-label="Выполнено" ${v.done?"checked":""}><input type="text" aria-label="Условие" value="${esc(v.text)}">${btn("removeCondition","<i class=\"fa-solid fa-xmark\"></i>",`data-index="${i}" aria-label="Убрать условие"`)}</div>`).join("")}${btn("addCondition","Добавить условие")}`;
    const deadline=`<p class="cj-countdown ${r.status==="active"&&r.deadline!=null&&r.deadline<=game.time.worldTime?"cj-overdue":""}">${esc(remaining(r.deadline,game.time.worldTime,calendar))}</p><p class="cj-muted cj-calendar-state">${esc(calendarLabel(r))}</p><label>Изменить срок<select name="deadlineMode">${opts({keep:"Оставить текущий срок",none:"Без срока",date:"Дата и время календаря",duration:"Через N дней / часов"},d.mode)}</select></label><div class="cj-date" ${d.mode==="date"?"":"hidden"}>${field("Год","year",d.year,"number")}<label>Месяц<select name="month">${opts(Object.fromEntries(calendar.months.values.map((m,i)=>[i,game.i18n.localize(m.name)])),d.month)}</select></label>${field("День","day",Number(d.day)+1,"number",'min="1"')}${field("Час","hour",d.hour,"number",'min="0"')}${field("Минута","minute",d.minute,"number",'min="0"')}</div><div class="cj-duration" ${d.mode==="duration"?"":"hidden"}>${field("Дней","days",d.days,"number",'min="0" step="any"')}${field("Часов","hours",d.hours,"number",'min="0" step="any"')}</div>`;
    const links=`<section class="cj-links" tabindex="0" aria-label="Связи: перетащите карточку персонажа или локации"><div>${r.links.map((uuid,i)=>{const target=entries().find(e=>e.uuid===uuid&&(game.user.isGM||e.published));return `<div class="cj-link">${target?btn("openLink",esc(target.name),`data-uuid="${esc(uuid)}"`):'<span>Запись недоступна</span>'}${btn("removeLink","<i class=\"fa-solid fa-xmark\"></i>",`data-index="${i}" aria-label="Убрать ссылку"`)}</div>`;}).join("")}</div><div class="cj-actions">${btn("chooseLink","Добавить персонажа",'data-kind="npc"')}${btn("chooseLink","Добавить локацию",'data-kind="location"')}</div></section>`;
    return `<label>Статус<select name="status">${opts(STATUS,r.status)}</select></label>${this.fold("description","Описание квеста",area("Описание","description",r.description),true)}${this.fold("conditions","Условия выполнения",conditions,true)}${this.fold("deadline","Ограничение по времени",deadline,r.deadline!=null)}${this.fold("links","Персонажи и локации",links,!!r.links.length)}`;
  }
  _replaceHTML(result,content){
    if(this.contextMenu&&ui.context===this.contextMenu)this.contextMenu.close({animate:false});
    const pos=this.resetScroll?0:content.querySelector("main")?.scrollTop??0,aside=content.querySelector("aside")?.scrollTop??0;
    for(const section of content.querySelectorAll("details[data-cj-section]"))this.sections.set(section.dataset.cjSection,section.open);
    content.innerHTML=result;for(const section of content.querySelectorAll("details[data-cj-section]"))if(this.sections.has(section.dataset.cjSection))section.open=this.sections.get(section.dataset.cjSection);
    const main=content.querySelector("main");if(main)main.scrollTop=pos;if(content.querySelector("aside"))content.querySelector("aside").scrollTop=aside;this.resetScroll=false;
  }
  capture(){
    const form=this.element.querySelector(".cj-form"),r=this.draft;if(!form||!r)return;
    const f=form.elements,val=name=>f.namedItem(name)?.value;
    if(val("name")!==undefined)r.name=val("name");if(val("notes")!==undefined)r.notes=val("notes");
    if(game.user.isGM){r.published=f.namedItem("published").checked;r.gmNotes=val("gmNotes");}
    if(r.type==="npc"){r.portrait=val("portrait");if(game.user.isGM)r.actorUuid=val("actorUuid");}
    if(r.type==="location"&&game.user.isGM){r.images=r.images.map((img,i)=>({src:val(`imageSrc${i}`)??img.src,caption:val(`imageCaption${i}`)??img.caption}));}
    if(r.type==="quest"){
      r.status=val("status");r.description=val("description");r.conditions=[...form.querySelectorAll("[data-condition]")].map(row=>({done:row.querySelector('[type="checkbox"]').checked,text:row.querySelector('[type="text"]').value}));
      r.deadlineForm=Object.fromEntries(["year","month","day","hour","minute","days","hours"].map(k=>[k,val(k)]));r.deadlineForm.day=Number(r.deadlineForm.day)-1;r.deadlineForm.mode=val("deadlineMode");
    }
  }
  values(){
    this.capture();const r=this.draft,v={notes:r.pointcrawlUuid?"":r.notes,archived:r.archived};
    if(r.type==="npc")this.addTags(this.element.querySelector('[name="newTag"]')?.value??"");
    if(game.user.isGM||r.type!=="location")v.name=r.name;
    if(r.type==="npc"){
      Object.assign(v,{portrait:r.portrait,tags:r.tags});
      if(r.locationChanged)v.locationUuid=r.locationUuid;
    }
    if(r.type==="quest"){Object.assign(v,{description:r.description,status:r.status,conditions:r.conditions,links:r.links});if(r.deadlineForm?.mode!=="keep")v.deadlineInput=r.deadlineForm;}
    if(game.user.isGM){Object.assign(v,{published:r.published,gmNotes:r.gmNotes});if(r.type==="npc")v.actorUuid=r.actorUuid;if(r.type==="location")Object.assign(v,{images:r.images,pointcrawlUuid:r.pointcrawlUuid});}
    return v;
  }
  changed(){this.dirty=true;this.error="";const footer=this.element.querySelector("footer");if(footer)footer.textContent="Есть несохранённые изменения";}
  async run(fn){if(this.busy)return;this.busy=true;try{await fn();}catch(e){this.error=e.message;ui.notifications.error(e.message);}finally{this.busy=false;if(this.rendered)this.render();}}
  async save(){need(this.editing,"Нажмите «Редактировать» для изменения карточки.");const values=this.values();const result=await request({action:"save",id:this.selected,revision:this.draft.revision,values});await this.waitRevision(result);this.select(result.id);this.resetScroll=true;}
  async waitRevision(result){for(let n=0;n<50;n++){if((entry(result.id)?.revision??-1)>=result.revision)return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error("Данные сохранены мастером, но ещё не пришли в этот клиент. Черновик оставлен в форме.");}
  _onRender(context,options){
    super._onRender(context,options);const root=this.element;this.listenerController?.abort();const signal=(this.listenerController=new AbortController()).signal;
    const shell=root.querySelector(".cj-shell"),targetRecord=target=>entry(target.dataset.entry??this.selected),writable=target=>!writeBlock()&&!!targetRecord(target);
    shell.addEventListener("contextmenu",e=>{if(!recordMenuTarget(e.target)){if(this.contextMenu&&ui.context===this.contextMenu)this.contextMenu.close({animate:false});e.stopImmediatePropagation();}},{capture:true});
    this.contextMenu=new foundry.applications.ux.ContextMenu(shell,".cj-row,.cj-card-preview",[
      ...Object.entries(STATUS).map(([status,label])=>({label:`Статус: ${label}`,icon:status==="active"?"fa-solid fa-play":status==="completed"?"fa-solid fa-check":"fa-solid fa-xmark",group:"quest-status",visible:t=>writable(t)&&targetRecord(t).type==="quest"&&targetRecord(t).status!==status,onClick:(_e,t)=>this.run(()=>this.recordAction("status",targetRecord(t).id,status))})),
      {label:"Открыть игрокам",icon:"fa-solid fa-eye",group:"visibility",visible:t=>writable(t)&&game.user.isGM&&!targetRecord(t).published,onClick:(_e,t)=>this.run(()=>this.recordAction("visibility",targetRecord(t).id))},
      {label:"Скрыть от игроков",icon:"fa-solid fa-eye-slash",group:"visibility",visible:t=>writable(t)&&game.user.isGM&&targetRecord(t).published,onClick:(_e,t)=>this.run(()=>this.recordAction("visibility",targetRecord(t).id))},
      {label:"На верхний уровень",icon:"fa-solid fa-arrow-up",visible:t=>writable(t)&&game.user.isGM&&!!targetRecord(t).parentUuid,onClick:(_e,t)=>this.run(()=>this.moveLocation(targetRecord(t).id,""))},
      {label:"В архив",icon:"fa-solid fa-box-archive",visible:t=>writable(t)&&!targetRecord(t).archived,onClick:(_e,t)=>this.run(()=>this.recordAction("archive",targetRecord(t).id))},
      {label:"Вернуть из архива",icon:"fa-solid fa-box-open",visible:t=>writable(t)&&targetRecord(t).archived,onClick:(_e,t)=>this.run(()=>this.recordAction("archive",targetRecord(t).id))},
      {label:"Удалить навсегда",icon:"fa-solid fa-trash",visible:t=>writable(t)&&game.user.isGM,onClick:(_e,t)=>this.run(()=>this.recordAction("delete",targetRecord(t).id))}
    ],{eventName:"contextmenu",jQuery:false,fixed:true,relative:"cursor"});
    for(const section of root.querySelectorAll("details[data-cj-section]"))section.addEventListener("toggle",()=>this.sections.set(section.dataset.cjSection,section.open));
    for(const group of root.querySelectorAll(".cj-list [data-location-group]"))group.addEventListener("toggle",()=>{if(!this.query.trim())this.locationGroups.set(group.dataset.locationGroup,group.open);});
    this.filterRows();
    root.querySelector(".cj-form")?.addEventListener("submit",e=>{e.preventDefault();this.run(()=>this.save());});
    root.addEventListener("click",e=>{const b=e.target.closest("[data-cj-action]");if(!b||b.disabled)return;e.preventDefault();this.run(()=>this.action(b.dataset.cjAction,b));},{signal});
    root.addEventListener("input",e=>{
      const name=e.target.name;
      if(e.target.dataset.cjConditionCheck!==undefined){
        const index=Number(e.target.dataset.cjConditionCheck),done=e.target.checked;
        if(this.busy){e.target.checked=!done;return;}
        for(const box of root.querySelectorAll('[data-cj-condition-check]'))box.disabled=true;
        this.run(async()=>{const r=entry(this.selected);need(r?.type==="quest"&&!this.editing,"Квест недоступен.");const conditions=clone(r.conditions);need(conditions[index],"Условие уже изменилось. Откройте свежую запись.");conditions[index].done=done;const result=await request({action:"save",id:r.id,revision:this.draft.revision,values:{conditions}});await this.waitRevision(result);this.select(r.id);});return;
      }
      if(name==="newTag"){this.draft.tagInput=e.target.value;this.changed();root.querySelector('.cj-tag-matches').innerHTML=this.tagSuggestions(this.draft);return;}
      if(["search","tagFilter","questFilter"].includes(name)){this[name==="search"?"query":name==="tagFilter"?"tag":"questFilter"]=e.target.value;this.filterRows();return;}
      if(e.target.closest(".cj-form")){this.capture();this.changed();if(name==="deadlineMode"){root.querySelector(".cj-date").hidden=e.target.value!=="date";root.querySelector(".cj-duration").hidden=e.target.value!=="duration";}}
    },{signal});
    root.querySelector('[name="newTag"]')?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();e.stopPropagation();this.run(()=>this.action("addTag",root.querySelector('[data-cj-action="addTag"]')));}});
    root.querySelector('[name="archiveView"]')?.addEventListener("change",e=>this.run(async()=>{if(await this.leave()){this.archive=e.target.checked;this.select("");}}));
    const canMoveLocations=game.user.isGM&&!writeBlock()&&this.type==="location"&&!this.archive;
    root.querySelectorAll("[data-entry]").forEach(row=>row.addEventListener("dragstart",e=>{
      const id=row.dataset.entry;
      e.dataTransfer.setData("text/plain",JSON.stringify({type:"JournalEntry",uuid:`JournalEntry.${id}`}));
      if(canMoveLocations&&!entry(id)?.pointcrawlUuid){
        e.dataTransfer.setData(locationDragType,id);
        e.dataTransfer.effectAllowed="copyMove";
      }
    }));
    if(canMoveLocations)this.locationDrops(root.querySelector(".cj-list"));
    root.querySelectorAll('[data-cj-actor-uuid]').forEach(handle=>handle.addEventListener("dragstart",e=>{this.capture();if(!game.user.isGM||!this.draft?.actorUuid){e.preventDefault();return;}e.stopPropagation();e.dataTransfer.setData("text/plain",JSON.stringify({type:"Actor",uuid:this.draft.actorUuid}));e.dataTransfer.effectAllowed="copy";}));
    for(const zone of root.querySelectorAll(".cj-image-target,.cj-actor,.cj-links")){
      zone.addEventListener("dragover",e=>{e.preventDefault();e.stopPropagation();});
      zone.addEventListener("drop",e=>{e.preventDefault();e.stopPropagation();this.run(()=>this.drop(e,zone));});
      if(zone.classList.contains("cj-image-target"))zone.addEventListener("paste",e=>{if(e.target.matches("input,textarea"))return;e.preventDefault();e.stopPropagation();this.run(()=>this.importImage(e.clipboardData,zone.dataset.imageTarget));});
    }
    if(writeBlock())for(const el of root.querySelectorAll('.cj-form input,.cj-form textarea,.cj-form select,.cj-form button'))if(!["actor","notebook","preview","openLink","reload"].includes(el.dataset.cjAction))el.disabled=true;
  }
  locationDrops(list){
    let highlighted;
    const clear=()=>{highlighted?.classList.remove("cj-location-drop");highlighted=null;};
    const target=e=>{
      if(!e.dataTransfer.types.includes(locationDragType))return {};
      const row=e.target.closest(".cj-row,.cj-location-group>summary");
      const parent=row?.dataset.entry?entry(row.dataset.entry):
        row&&entries().find(r=>r.uuid===row.parentElement.dataset.locationGroup);
      return parent?.type==="location"&&!parent.pointcrawlUuid?{row,parent}:{};
    };
    list.addEventListener("dragover",e=>{
      const {row}=target(e);
      if(row!==highlighted)clear();
      if(!row)return;
      e.preventDefault();e.stopPropagation();
      e.dataTransfer.dropEffect="move";row.classList.add("cj-location-drop");highlighted=row;
    });
    list.addEventListener("dragleave",e=>{if(!highlighted?.contains(e.relatedTarget))clear();});
    list.addEventListener("dragend",clear);
    list.addEventListener("drop",e=>{
      const {parent}=target(e);clear();
      if(!parent)return;
      e.preventDefault();e.stopPropagation();
      const id=e.dataTransfer.getData(locationDragType);
      if(id&&id!==parent.id)this.run(()=>this.moveLocation(id,parent.uuid));
    });
  }
  async moveLocation(id,parentUuid){
    const r=entry(id);
    need(game.user.isGM&&r?.type==="location"&&!r.pointcrawlUuid,"Перемещать самостоятельные локации может мастер.");
    if((r.parentUuid??"")===parentUuid||(id===this.selected&&!await this.leave()))return;
    const result=await request({action:"save",id,revision:r.revision,values:{parentUuid}});
    await this.waitRevision(result);
    if(parentUuid)this.locationGroups.set(parentUuid,true);
    if(id===this.selected)this.select(id);
  }
  async recordAction(action,id,status){
    let r=entry(id);need(r,"Запись недоступна.");if(id===this.selected&&!await this.leave())return;
    if(action==="status"||action==="visibility"){
      if(action==="status")need(r.type==="quest"&&Object.hasOwn(STATUS,status),"Некорректный статус квеста.");else need(game.user.isGM,"Доступ игрокам меняет мастер.");
      const result=await request({action:"save",id,revision:r.revision,values:action==="status"?{status}:{published:!r.published}});await this.waitRevision(result);if(id===this.selected)this.select(id);return;
    }
    if(action==="delete"){
      need(game.user.isGM,"Окончательно удаляет записи только мастер.");
      if(!await confirm("Удалить запись навсегда?",`«${r.name}» будет удалена. Файлы артов и связанные Actor сохранятся.`))return;
      if(!r.archived){const result=await request({action:"save",id,revision:r.revision,values:{archived:true}});await this.waitRevision(result);r=entry(id);}
      await request({action:"delete",id,revision:r.revision});
    }else{const result=await request({action:"save",id,revision:r.revision,values:{archived:!r.archived}});await this.waitRevision(result);}
    if(id===this.selected)this.select("");
  }
  async action(action,b){
    if(action==="tags"){this.capture();return TagLibraryApp.open(this);}
    if(action==="completeQuest"){
      const r=entry(this.selected);need(!this.editing&&r?.type==="quest"&&r.status==="active"&&r.conditions.length&&r.conditions.every(c=>c.done),"Сначала отметьте все условия активного квеста.");
      const result=await request({action:"save",id:r.id,revision:this.draft.revision,values:{status:"completed"}});await this.waitRevision(result);this.select(r.id);return;
    }
    if(action==="select"){if(await this.leave())this.select(b.dataset.entry);return;}
    if(action==="create"){if(!await this.leave())return;const r=await request({action:"create",type:this.type});await this.waitRevision(r);this.archive=false;this.select(r.id);this.editing=true;return;}
    if(action==="importPointcrawl"){
      need(game.user.isGM&&this.type==="location","Импорт локаций доступен мастеру.");
      const ids=new Set(pointcrawlNotebooks().map(({link})=>link.sceneId));
      const scenes=game.scenes.filter(s=>ids.has(s.id)).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
      need(scenes.length,"Нет сцен с журналами Pointcrawl для импорта.");
      const sceneId=await DialogV2.prompt({classes:["mjl-brand","mjl-chronicle","cj-import"],window:{title:"Импорт локаций из Pointcrawl",icon:"fa-solid fa-map"},rejectClose:false,
        content:`<label>Сцена<select name="sceneId">${opts(Object.fromEntries(scenes.map(s=>[s.id,s.name])),scenes[0].id)}</select></label><p>Новые карточки будут скрыты от игроков. Уже привязанные места будут пропущены.</p>`,
        ok:{label:"Импортировать",callback:(_e,b)=>b.form.elements.sceneId.value}});
      if(!sceneId)return;
      const {imported,skipped}=await request({action:"importPointcrawl",sceneId});
      ui.notifications.info(`Добавлено карточек: ${imported}. Уже привязано: ${skipped}.`);
      return;
    }
    if(action==="edit"){const block=writeBlock();need(!block,block);this.select(this.selected);this.editing=true;this.resetScroll=true;return;}
    if(action==="cancelEdit"){if(await this.leave()){this.select(this.selected);this.resetScroll=true;}return;}
    if(action==="reload"){if(await this.leave())this.select(this.selected);return;}
    if(action==="save")return this.save();
    if(action==="sync")return request({action:"sync"});
    if(action==="preview"){new foundry.applications.apps.ImagePopout({src:b.dataset.src,window:{title:this.draft.name}}).render({force:true});return;}
    if(action==="openLink"){const r=entries().find(r=>r.uuid===b.dataset.uuid);need(r,"Запись недоступна.");return ChronicleApp.open(r.type,r.id);}
    if(action==="notebook"){const doc=pointcrawlDoc(this.draft.pointcrawlUuid);need(doc?.testUserPermission(game.user,"OBSERVER"),"Журнал недоступен.");return doc.sheet.render(true);}
    if(action==="actor"){need(game.user.isGM,"Статблок доступен мастеру.");this.capture();const doc=await fromUuid(this.draft.actorUuid);need(doc?.documentName==="Actor","Actor удалён или недоступен.");return doc.sheet.render(true);}
    need(this.editing,"Нажмите «Редактировать» для изменения карточки.");
    if(action==="archive"||action==="delete")return this.recordAction(action,this.selected);
    this.capture();
    if(action==="addTag"){this.addTags(b.dataset.tag??this.element.querySelector('[name="newTag"]').value);this.changed();return;}
    if(action==="removeTag"){this.draft.tags.splice(Number(b.dataset.index),1);this.changed();return;}
    if(action==="chooseLocation"){
      const r=this.draft,gm=game.user.isGM;
      const choices=locationChoices(gm).map(loc=>gm&&!locationSelectable(loc)?{...loc,notes:"Скрыта от игроков"}:loc);
      const uuid=await chooseRecord("Текущая локация персонажа",choices,r.locationUnknown?null:r.locationUuid??"",true);
      if(uuid!==null&&(r.locationUnknown||uuid!==(r.locationUuid??""))){
        Object.assign(r,{locationUuid:uuid,locationUnknown:false,locationChanged:true});this.changed();
      }
      return;
    }
    if(action==="choosePointcrawl"){
      need(game.user.isGM,"Связь с Pointcrawl настраивает мастер.");
      const uuid=await chooseRecord("Локации Pointcrawl",await pointcrawlChoices(),this.draft.pointcrawlUuid,true);
      if(uuid!==null&&uuid!==this.draft.pointcrawlUuid){this.draft.pointcrawlUuid=uuid;this.changed();}return;
    }
    if(action==="chooseLink"){const kind=b.dataset.kind;need(["npc","location"].includes(kind),"Неизвестный тип связи.");const choices=(kind==="location"?locationChoices():entries().filter(r=>r.type==="npc"&&!r.archived)).filter(r=>!this.draft.links.includes(r.uuid));const uuid=await chooseRecord(kind==="location"?"Добавить локацию к квесту":"Добавить персонажа к квесту",choices);if(uuid&&!this.draft.links.includes(uuid)){this.draft.links.push(uuid);this.changed();}return;}
    if(action==="picker"){need(game.user.can("FILES_BROWSE"),"Для выбора арта нужны штатные права Foundry «Просмотр файлов». Можно вставить готовый путь или ссылку.");const target=b.dataset.imageTarget;new foundry.applications.apps.FilePicker.implementation({type:"image",current:target==="portrait"?this.draft.portrait:"",callback:path=>this.run(async()=>{this.capture();this.addImage(path,target);})}).render(true);return;}
    if(action==="imagePath"){const path=await DialogV2.prompt({classes:["mjl-brand"],window:{title:"Добавить арт",icon:"fa-solid fa-image"},content:'<label>Путь Foundry или ссылка<input name="path" type="text"></label>',rejectClose:false,ok:{label:"Добавить",callback:(_e,b)=>b.form.elements.path.value}});if(path)this.addImage(path,"gallery");return;}
    if(action==="addCondition")this.draft.conditions.push({text:"",done:false});
    if(action==="removeCondition")this.draft.conditions.splice(Number(b.dataset.index),1);
    if(action==="removeImage")this.draft.images.splice(Number(b.dataset.index),1);
    if(action==="removeLink")this.draft.links.splice(Number(b.dataset.index),1);
    this.changed();
  }
  addImage(path,target){need(this.editing,"Сначала откройте редактирование карточки.");path=imagePath(path);need(path,"Пустой путь изображения.");if(target==="portrait")this.draft.portrait=path;else{need(game.user.isGM,"Галерея доступна мастеру.");this.draft.images.push({src:path,caption:""});}this.changed();}
  async importImage(data,target){
    need(this.editing,"Сначала откройте редактирование карточки.");const block=writeBlock();need(!block,block);this.capture();
    const files=[...(data.files??[])];if(files.length){
      const paths=[];for(const file of files){need(file.type.startsWith("image/"),"Перетащите файл изображения.");need(game.user.can("FILES_UPLOAD"),"Для загрузки файлов нужны штатные права Foundry «Загрузка файлов». Можно выбрать готовый арт или вставить ссылку.");
        const Picker=foundry.applications.apps.FilePicker.implementation,path=`worlds/${game.world.id}/${ID}`;
        try{await Picker.browse("data",path);}catch{await Picker.createDirectory("data",path);}
        const suffix=file.name.split(".").pop()?.replace(/[^a-z0-9]/gi,"")||"png",named=new File([file],`${foundry.utils.randomID()}.${suffix}`,{type:file.type});
        const result=await Picker.upload("data",path,named,{}, {notify:false});need(result?.path,"Foundry не подтвердил загрузку изображения.");paths.push(result.path);
      }
      for(const path of paths)this.addImage(path,target);return;
    }
    const raw=data.getData("text/uri-list")?.split(/\r?\n/).find(v=>v&&!v.startsWith("#"))||data.getData("text/plain");need(raw,"В буфере нет изображения или ссылки.");
    let value=raw;try{const json=JSON.parse(raw);value=json.src??json.path??json.url??raw;}catch{}this.addImage(value,target);
  }
  async drop(e,zone){
    need(this.editing,"Сначала откройте редактирование карточки.");const block=writeBlock();need(!block,block);this.capture();const raw=e.dataTransfer.getData("text/plain");let data;try{data=JSON.parse(raw);}catch{}
    if(zone.classList.contains("cj-actor")){need(game.user.isGM&&data?.type==="Actor","Перетащите Actor Foundry.");const actor=await Actor.implementation.fromDropData(data);need(actor,"Actor недоступен.");this.draft.actorUuid=actor.uuid;this.changed();return;}
    if(zone.classList.contains("cj-links")){const target=entries().find(r=>r.uuid===data?.uuid);need(target&&target.type!=="quest"&&(target.type!=="location"||locationChoices().some(r=>r.uuid===target.uuid)),"Перетащите доступную карточку НИП или открытой локации.");if(!this.draft.links.includes(target.uuid))this.draft.links.push(target.uuid);this.changed();return;}
    return this.importImage(e.dataTransfer,zone.dataset.imageTarget);
  }
}
