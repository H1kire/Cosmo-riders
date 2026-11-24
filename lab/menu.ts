const button=document.getElementById('menu-toggle');
const sidebar=document.getElementById('app-sidebar');
button?.addEventListener('click',()=>{
 const hidden=sidebar?.classList.toggle('menu-hidden')??false;
 button.setAttribute('aria-expanded',String(!hidden));
});
