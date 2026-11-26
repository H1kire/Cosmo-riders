import { LoadingScreen } from './loading-screen.ts';

const loading = new LoadingScreen();
window.addEventListener('cosmo-loading-stage',(event:Event)=>{
  const detail=(event as CustomEvent<{id?:string;complete?:boolean}>).detail;
  if(!detail?.id)return;
  if(detail.complete)loading.complete(detail.id);else loading.stage(detail.id);
});
const startScreen = document.getElementById('start-screen');
const startButton = document.getElementById('start-simulation') as HTMLButtonElement|null;

async function startApplication():Promise<void>{
  // Даємо браузеру намалювати екран до імпорту великих модулів симуляції.
  await loading.nextFrame();
  loading.complete('bootstrap');
  loading.stage('application');
  try{
    await import('./lab.ts');
    loading.complete('application');
    loading.stage('first-frame');
    // Чекаємо саме на перший успішно відмальований кадр, а не просто на таймер RAF.
    await new Promise<void>((resolve,reject)=>{
      const cleanup=()=>{window.removeEventListener('cosmo-loading-stage',onFirstFrame);window.removeEventListener('cosmo-loading-failed',onFailure);};
      const onFirstFrame=(event:Event)=>{const detail=(event as CustomEvent<{id?:string;complete?:boolean}>).detail;if(detail?.id==='first-frame'&&detail.complete){cleanup();resolve();}};
      const onFailure=(event:Event)=>{cleanup();const detail=(event as CustomEvent<{message?:string}>).detail;reject(new Error(detail?.message??'Initial scene setup failed.'));};
      window.addEventListener('cosmo-loading-stage',onFirstFrame);window.addEventListener('cosmo-loading-failed',onFailure);
    });
    loading.ready();
  }catch(error){
    console.error('Cosmo-riders bootstrap failed:',error);
    loading.fail(error);
  }
}

if(startScreen&&startButton){
  startButton.addEventListener('click',()=>{
    if(startButton.disabled)return;
    startButton.disabled=true;
    startScreen.classList.add('is-hidden');
    startScreen.setAttribute('aria-hidden','true');
    loading.show();
    void startApplication();
  });
}else{
  console.error('Cosmo-riders start screen is incomplete: expected #start-screen and #start-simulation.');
}
