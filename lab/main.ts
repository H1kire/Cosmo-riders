import { LoadingScreen } from './loading-screen.ts';

const loading = new LoadingScreen();
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
    // RAF симуляції був зареєстрований під час ініціалізації lab.ts.
    await loading.nextFrame();
    loading.complete('first-frame');
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
