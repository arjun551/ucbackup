const fs=require('fs'),cp=require('child_process'),vm=require('vm');
const required=['firebase.json','firestore.rules','firestore.indexes.json','storage.rules','vercel.json','README.md','public/index.html','public/admin/index.html','public/firebase-config.js','functions/index.js','functions/package.json'];
const missing=required.filter(p=>!fs.existsSync(p));
if(missing.length){console.error('Missing required full-version files:',missing.join(', '));process.exit(1)}
const firebase=JSON.parse(fs.readFileSync('firebase.json','utf8'));
if(!firebase.functions||!firebase.firestore||!firebase.storage){console.error('Firebase Functions, Firestore and Storage must be configured.');process.exit(1)}
const vercel=JSON.parse(fs.readFileSync('vercel.json','utf8'));
if(vercel.outputDirectory!=='public'||vercel.buildCommand!=='npm run build'){console.error('Vercel static output configuration is invalid.');process.exit(1)}
const cfg=fs.readFileSync('public/firebase-config.js','utf8');
if(!cfg.includes("projectId:'ucesportslast'")){console.error('Firebase project config mismatch.');process.exit(1)}
try{cp.execFileSync(process.execPath,['--check','functions/index.js'],{stdio:'inherit'})}catch{process.exit(1)}
for(const file of ['public/index.html','public/admin/index.html']){
 const html=fs.readFileSync(file,'utf8');
 for(const m of html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi))if(m[1].trim())new vm.Script(m[1],{filename:file});
}
const player=fs.readFileSync('public/index.html','utf8'),admin=fs.readFileSync('public/admin/index.html','utf8');
const functions=fs.readFileSync('functions/index.js','utf8'),storage=fs.readFileSync('storage.rules','utf8');
for(const name of ['createDeposit','paymentWebhook','submitManualDeposit','adminReviewDeposit','requestWithdrawal','adminReviewWithdrawal','adminPublishResults','setupFirstAdmin','adminBlockUser','adminDeleteUser']){
 if(!functions.includes('exports.'+name+'=')){console.error('Missing backend function: '+name);process.exit(1)}
}
for(const token of ["call('createDeposit'","call('submitManualDeposit'","call('requestWithdrawal'"]){
 if(!player.includes(token)){console.error('Player frontend is missing payment flow: '+token);process.exit(1)}
}
for(const token of ["adminReviewDeposit","adminReviewWithdrawal","Payments","Withdrawals"]){
 if(!admin.includes(token)){console.error('Admin frontend is missing: '+token);process.exit(1)}
}
if(!storage.includes("allow read: if kind != 'payment-proofs'")){console.error('Payment proof files must not be public through the Storage catch-all rule.');process.exit(1)}
for(const secret of ['RZP_KEY_ID','RZP_KEY_SECRET','RZP_WEBHOOK_SECRET','FIRST_ADMIN_EMAIL']){
 if(!functions.includes(secret)){console.error('Missing server secret binding: '+secret);process.exit(1)}
}
if(/RZP_KEY_SECRET\\s*[:=]\\s*['"]/.test(player+admin+cfg)){console.error('A Razorpay secret appears in frontend source.');process.exit(1)}
console.log('UC Esports full-version checks passed: project files, Vercel config, JavaScript syntax, Razorpay flows, admin payment/withdrawal actions and private payment-proof rule.');
