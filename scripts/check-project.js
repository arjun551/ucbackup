const fs=require('fs'),vm=require('vm');
const required=['firebase.json','firestore.rules','firestore.indexes.json','public/index.html','public/admin/index.html','public/firebase-config.js','public/spark-api.js'];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length){console.error('Missing required Spark project files:',missing.join(', '));process.exit(1)}
const cfg=JSON.parse(fs.readFileSync('firebase.json','utf8'));
if(cfg.functions||cfg.storage){console.error('Spark build must not deploy Cloud Functions or Firebase Storage.');process.exit(1)}
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
if(pkg.scripts['deploy:functions']){console.error('Cloud Functions deployment script must be removed.');process.exit(1)}
const fb=fs.readFileSync('public/firebase-config.js','utf8');
if(!fb.includes("projectId:'ucesportslast'")){console.error('Firebase project config mismatch.');process.exit(1)}
for(const file of ['public/index.html','public/admin/index.html','public/spark-api.js']){
 const source=fs.readFileSync(file,'utf8');
 const scripts=file.endsWith('.js')?[source]:[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(x=>x.trim());
 for(const script of scripts)new vm.Script(script,{filename:file});
}
const player=fs.readFileSync('public/index.html','utf8'),admin=fs.readFileSync('public/admin/index.html','utf8');
for(const [name,source] of [['player',player],['admin',admin]]) {
 if(/firebase-functions-compat|firebase-storage-compat|httpsCallable|\.functions\(|firebase\.storage\(/.test(source)){console.error(name+' still depends on Functions or Storage.');process.exit(1)}
}
if(/submitManualDeposit|requestWithdrawal|createDeposit|paymentWebhook|adminReviewDeposit|adminReviewWithdrawal/.test(player+admin)){console.error('Cash payment operation found in Spark UI.');process.exit(1)}
console.log('UC Esports Spark build: project files and player/admin/API JavaScript syntax passed. No Functions, Storage or cash-payment frontend dependency.');
