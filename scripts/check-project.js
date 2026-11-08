const fs=require('fs'),vm=require('vm'),cp=require('child_process');
const required=['firebase.json','firestore.rules','firestore.indexes.json','vercel.json','README.md','package.json','api/call.js','api/razorpay-webhook.js','lib/backend.js','public/index.html','public/admin/index.html','public/firebase-config.js'];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length){console.error('Missing files:',missing.join(', '));process.exit(1)}
const fb=JSON.parse(fs.readFileSync('firebase.json','utf8'));
if(fb.functions||fb.hosting){console.error('Firebase Hosting/Functions must not be configured for this Vercel-only website.');process.exit(1)}
const v=JSON.parse(fs.readFileSync('vercel.json','utf8'));
if(v.outputDirectory!=='public'||v.buildCommand!=='npm run build'){console.error('Vercel output configuration is invalid.');process.exit(1)}
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
if(!pkg.dependencies?.['firebase-admin']){console.error('firebase-admin dependency is missing.');process.exit(1)}
for(const file of ['api/call.js','api/razorpay-webhook.js','api/maintenance.js','lib/backend.js','public/firebase-config.js']){
 try{cp.execFileSync(process.execPath,['--check',file],{stdio:'inherit'})}catch{process.exit(1)}
}
for(const file of ['public/index.html','public/admin/index.html']){
 const html=fs.readFileSync(file,'utf8');
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1],{filename:file});
 if(/firebase-functions-compat|httpsCallable|\.functions\(['"]/.test(html)){console.error('Firebase Functions client SDK still present in '+file);process.exit(1)}
}
const backend=fs.readFileSync('lib/backend.js','utf8');
for(const n of ['ensurePlayerProfile','createDeposit','paymentWebhook','joinTournament','getRoom','requestWithdrawal','adminReviewWithdrawal','adminPublishResults','setupFirstAdmin'])if(!backend.includes('exports.'+n+'=')){console.error('Missing backend operation '+n);process.exit(1)}
if(/RZP_KEY_SECRET\s*[:=]\s*['"]/.test(fs.readFileSync('public/index.html','utf8')+fs.readFileSync('public/admin/index.html','utf8'))){console.error('Razorpay secret found in browser source');process.exit(1)}
if(fs.existsSync('public/manifest.webmanifest')||fs.existsSync('public/sw.js')){console.error('PWA install/service-worker assets still present');process.exit(1)}
console.log('UC Esports website checks passed: Spark/Vercel config, API syntax, backend operations, browser script syntax, no Functions SDK, no PWA assets.');
