const baseValue=process.env.PAGES_URL||'https://h1kire.github.io/Cosmo-riders/';
const base=new URL(baseValue.endsWith('/')?baseValue:baseValue+'/');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fetchRetry(url,attempts=10){
 let failure;
 for(let i=0;i<attempts;i++){
  try{
   const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(15000)});
   if(response.ok)return response;
   failure=new Error(url+' returned HTTP '+response.status);
  }catch(error){failure=error;}
  if(i+1<attempts)await pause(3000);
 }
 throw failure;
}
async function resource(pageUrl,ref,type){
 const url=new URL(ref,pageUrl);
 if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw new Error('Unexpected resource outside the Pages project: '+url.href);
 const response=await fetchRetry(url.href,2);
 const mime=(response.headers.get('content-type')||'').toLowerCase();
 if(!mime.includes(type))throw new Error(url.href+' served with '+mime+' instead of '+type);
}
for(const path of ['','lab/']){
 const page=new URL(path,base),response=await fetchRetry(page.href);
 const mime=(response.headers.get('content-type')||'').toLowerCase();
 if(!mime.includes('text/html'))throw new Error(page.href+' is not served as HTML: '+mime);
 const html=await response.text();
 const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
 const styles=[...html.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
 if(!scripts.length)throw new Error(page.href+' has no JS entry point.');
 for(const ref of scripts){if(/\.tsx?(?:$|[?#])/i.test(ref))throw new Error('Published HTML references raw TypeScript: '+ref);await resource(page,ref,'javascript');}
 for(const ref of styles)await resource(page,ref,'text/css');
 process.stdout.write('PASS live page '+page.href+'\n');
}
process.stdout.write('LIVE DEPLOYMENT AUDIT PASSED: both pages and JS/CSS MIME types are reachable.\n');
