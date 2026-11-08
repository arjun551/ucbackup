const fs=require('fs'),cp=require('child_process'),vm=require('vm');
const required=['firebase.json','firestore.rules','storage.rules','public/index.html','public/admin/index.html','public/firebase-config.js','functions/index.js','functions/package.json'];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length){console.error('Missing required project files:',missing.join(', '));process.exit(1)}
try{cp.execFileSync(process.execPath,['--check','functions/index.js'],{stdio:'inherit'})}catch{process.exit(1)}
const cfg=fs.readFileSync('public/firebase-config.js','utf8');
if(!cfg.includes("projectId:'ucesportslast'")){console.error('Firebase project config mismatch.');process.exit(1)}
for(const file of ['public/index.html','public/admin/index.html']){const html=fs.readFileSync(file,'utf8');for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){if(m[1].trim())new vm.Script(m[1],{filename:file})}}
console.log('UC Esports project structure and player/admin/Cloud Functions syntax checks passed.');
