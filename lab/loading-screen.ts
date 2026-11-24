export interface LoadingStage { id:string; label:string; description:string; weight:number; }
const STAGES:readonly LoadingStage[]=[
 {id:'bootstrap',label:'Application bootstrap',description:'Проверка оболочки и подготовка загрузчика',weight:5},
 {id:'application',label:'Загрузка приложения',description:'Импорт модулей физики и визуализации',weight:5},
 {id:'webgl',label:'WebGL-контекст',description:'Создание графического контекста и базовых программ',weight:15},
 {id:'solar-system',label:'Солнечная система',description:'Подготовка физических тел и начального состояния',weight:20},
 {id:'renderer',label:'Рендерер сцены',description:'Подготовка камеры, освещения и графических систем',weight:15},
 {id:'surface',label:'Поверхность Земли',description:'Генерация геодезических мешей и процедурных страниц в Worker',weight:20},
 {id:'gpu',label:'GPU-страницы',description:'Постепенная загрузка текстурных страниц',weight:10},
 {id:'first-frame',label:'Сцена готова',description:'Первый кадр Солнечной системы отрисован',weight:10}
];

/** Прогрес завжди відображає лише завершені етапи; невідома робота показується як indeterminate. */
export class LoadingScreen {
 private readonly root:HTMLElement|null;
 private readonly title:HTMLElement|null;
 private readonly description:HTMLElement|null;
 private readonly percent:HTMLElement|null;
 private readonly bar:HTMLElement|null;
 private readonly fill:HTMLElement|null;
 private readonly errorPanel:HTMLElement|null;
 private readonly retry:HTMLButtonElement|null;
 private completed=new Set<string>();
 constructor(){
  this.root=document.getElementById('loading-screen');
  this.title=document.getElementById('loading-stage');
  this.description=document.getElementById('loading-description');
  this.percent=document.getElementById('loading-percent');
  this.bar=document.getElementById('loading-progress');
  this.fill=document.getElementById('loading-progress-fill');
  this.errorPanel=document.getElementById('loading-error');
  this.retry=document.getElementById('loading-retry') as HTMLButtonElement|null;
  this.retry?.addEventListener('click',()=>location.reload());
 }
 show():void{
  this.completed.clear();
  if(this.errorPanel)this.errorPanel.hidden=true;
  if(this.retry)this.retry.hidden=true;
  this.root?.classList.remove('is-hidden','is-ready');this.root?.setAttribute('aria-hidden','false');
  this.stage('bootstrap');this.update();
 }
 complete(id:string):void{if(STAGES.some(stage=>stage.id===id))this.completed.add(id);this.update();}
 stage(id:string):void{
  const stage=STAGES.find(item=>item.id===id);if(!stage)return;
  if(this.title)this.title.textContent=stage.label;
  if(this.description)this.description.textContent=stage.description;
  this.root?.classList.toggle('is-indeterminate',id==='application'||id==='surface'||id==='gpu');
  this.update();
 }
 private update():void{
  const value=Math.min(100,STAGES.reduce((sum,stage)=>sum+(this.completed.has(stage.id)?stage.weight:0),0));
  if(this.percent)this.percent.textContent=Math.round(value)+'%';
  if(this.fill)this.fill.style.width=value+'%';
  this.bar?.setAttribute('aria-valuenow',String(value));
 }
 async nextFrame():Promise<void>{await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}
 ready():void{
  this.completed=new Set(STAGES.map(stage=>stage.id));this.update();
  if(this.title)this.title.textContent='Система готова';
  if(this.description)this.description.textContent='Солнечная система загружена';
  this.root?.classList.add('is-ready');
  window.setTimeout(()=>{this.root?.classList.add('is-hidden');this.root?.setAttribute('aria-hidden','true');},320);
 }
 fail(error:unknown):void{
  const message=error instanceof Error?error.message:String(error??'Неизвестная ошибка');
  if(this.errorPanel){this.errorPanel.hidden=false;this.errorPanel.textContent='Не удалось запустить Cosmo-riders: '+message;}
  if(this.retry)this.retry.hidden=false;
  if(this.title)this.title.textContent='Ошибка загрузки';
  if(this.description)this.description.textContent='Проверьте поддержку WebGL2 и перезагрузите страницу';
  this.root?.classList.remove('is-indeterminate');
 }
}
