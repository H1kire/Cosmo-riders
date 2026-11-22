import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const checks=[
 ['SI unit policy',async()=>{const s=await readFile(new URL('../src/physics/constants.js',import.meta.url),'utf8');if(!s.includes('G = 6.67430e-11')||!s.includes('AU = 149_597_870_700'))throw Error('Expected SI constants missing.');}],
 ['No runtime dependencies',async()=>{if(Object.keys(pkg.dependencies??{}).length)throw Error('Physics core must remain dependency-free.');}],
 ['No suspicious NaN/Infinity defaults',async()=>{const s=await readFile(new URL('../src/physics/kepler.js',import.meta.url),'utf8');if(/\\b(?:NaN|Infinity)\\s*[,;]/.test(s))throw Error('Suspicious numeric literal.');}]
];
let failed=0;for(const [name,run] of checks){try{await run();process.stdout.write('PASS '+name+'\\n');}catch(e){failed++;process.stderr.write('FAIL '+name+': '+e.message+'\\n');}}
const syntax=spawnSync(process.execPath,['--check','src/physics/index.js'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
if(syntax.status===0)process.stdout.write('PASS JavaScript syntax smoke-check\\n');else{failed++;process.stderr.write('FAIL syntax: '+syntax.stderr+'\\n');}
if(failed)process.exitCode=1;else process.stdout.write('AUDIT PASSED\\n');