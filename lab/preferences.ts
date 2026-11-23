import { formatNumber, type NumberFormat } from '../src/presentation/number-format.ts';

const FORMAT_KEY='cosmo-riders.number-format.v1';
const LANGUAGE_KEY='cosmo-riders.language.v1';
const languageSelect=document.getElementById('app-language') as HTMLSelectElement|null;
const formatSelect=document.getElementById('number-format') as HTMLSelectElement|null;

export function currentLocale():string{
  const language=localStorage.getItem(LANGUAGE_KEY)??'ru';
  return language==='en'?'en-US':language==='uk'?'uk-UA':'ru-RU';
}
export function formatDisplayNumber(value:number,digits=2):string{
  const format=(localStorage.getItem(FORMAT_KEY)??'suffix') as NumberFormat;
  return formatNumber(value,digits,format,currentLocale());
}

const translations:Record<string,Record<string,string>>={
  en:{'Информация о планете':'Planet information','Настройки':'Settings','Солнечная система':'Solar system','СБРОСИТЬ КАМЕРУ':'RESET CAMERA','Перемещайте камеру и исследуйте орбиты планет':'Move the camera and explore planetary orbits','Основные':'General','Графика':'Graphics','ЯЗЫК ИНТЕРФЕЙСА':'INTERFACE LANGUAGE','ФОРМАТ ЧИСЕЛ':'NUMBER FORMAT'},
  uk:{'Информация о планете':'Інформація про планету','Настройки':'Налаштування','Солнечная система':'Сонячна система','Перемещайте камеру и исследуйте орбиты планет':'Переміщуйте камеру та досліджуйте орбіти планет','Основные':'Основні','Графика':'Графіка','ЯЗЫК ИНТЕРФЕЙСА':'МОВА ІНТЕРФЕЙСУ','ФОРМАТ ЧИСЕЛ':'ФОРМАТ ЧИСЕЛ'}
};
function applyLanguage(language:string){
  const dict=translations[language]??{};
  document.documentElement.lang=language;
  document.querySelectorAll<HTMLElement>('.nav-item,.window-titlebar strong,.settings-section h3,.universe-title small').forEach(node=>{
    const source=node.dataset.sourceText??node.textContent?.trim()??'';
    node.dataset.sourceText=source;
    if(dict[source])node.textContent=dict[source];
  });
}
function saveFormat(){
  if(formatSelect)localStorage.setItem(FORMAT_KEY,formatSelect.value);
  window.dispatchEvent(new Event('number-format-change'));
}
function saveLanguage(){
  const language=languageSelect?.value??'ru';
  localStorage.setItem(LANGUAGE_KEY,language);
  applyLanguage(language);
}
if(languageSelect){
  languageSelect.value=localStorage.getItem(LANGUAGE_KEY)??'ru';
  languageSelect.addEventListener('change',saveLanguage);
  applyLanguage(languageSelect.value);
}
if(formatSelect){
  formatSelect.value=localStorage.getItem(FORMAT_KEY)??'suffix';
  formatSelect.addEventListener('change',saveFormat);
}
window.addEventListener('storage',event=>{
  if(event.key===FORMAT_KEY)window.dispatchEvent(new Event('number-format-change'));
  if(event.key===LANGUAGE_KEY)applyLanguage(event.newValue??'ru');
});
