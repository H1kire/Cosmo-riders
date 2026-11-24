import { LoadingScreen } from './loading-screen.ts';

const loading = new LoadingScreen();
loading.show();

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
void startApplication();
