// UC ESPORTS TOURNAMENT — Spark + Vercel server-side backend.
// All wallet, payment, room access and admin mutations execute only on the server.
const crypto=require('crypto');
const {initializeApp,cert,getApps}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getMessaging}=require('firebase-admin/messaging');
const {getFirestore,FieldValue:FV,Timestamp:TS,AggregateField:AF}=require('firebase-admin/firestore');
if(!getApps().length){
  let serviceAccount;
  try{serviceAccount=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'{}')}catch{throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON')}
  if(!serviceAccount.project_id||!serviceAccount.client_email||!serviceAccount.private_key)throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON in the Vercel environment before calling the API.');
  initializeApp({credential:cert(serviceAccount)});
}
const db=getFirestore(),auth=getAuth(),msg=getMessaging();
const ROLE={moderator:1,admin:2,superadmin:3},ok={ok:true};
const bad=(c,m)=>{const e=new Error(m);e.code=c;throw e};
const who=c=>c.auth?c.auth.uid:bad('unauthenticated','Sign in first.');
const staff=(c,min)=>{const r=c.auth&&c.auth.token.role;if(!ROLE[r]||ROLE[r]<ROLE[min])bad('permission-denied','You do not have access.');return c.auth.uid};

const log=(w,uid,action,data)=>w.set(db.collection('audit_logs').doc(),{uid,action,data:data||{},at:FV.serverTimestamp()});
const logNow=(uid,action,data)=>db.collection('audit_logs').add({uid,action,data:data||{},at:FV.serverTimestamp()});
const note=(w,uid,title,body)=>w.set(db.collection('notifications').doc(),{uid,title,body,read:false,at:FV.serverTimestamp()});
const txn=(w,id,o)=>w.set(id?db.doc('transactions/'+id):db.collection('transactions').doc(),{...o,at:FV.serverTimestamp()});
const slug=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const wkKey=()=>{const d=new Date(),t=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())),n=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-n);const y=Date.UTC(t.getUTCFullYear(),0,1);return 'w'+t.getUTCFullYear()+'_'+String(Math.ceil(((t-y)/864e5+1)/7)).padStart(2,'0')};
const moKey=()=>{const d=new Date();return 'm'+d.getUTCFullYear()+'_'+String(d.getUTCMonth()+1).padStart(2,'0')};
async function push(uids,title,body){for(let i=0;i<uids.length;i+=200){const part=uids.slice(i,i+200),b=db.batch();part.forEach(u=>note(b,u,title,body));await b.commit();
 const us=await db.getAll(...part.map(u=>db.doc('users/'+u))),tokens=us.flatMap(s=>(s.exists&&s.data().fcm)||[]);
 for(let j=0;j<tokens.length;j+=500)await msg.sendEachForMulticast({tokens:tokens.slice(j,j+500),notification:{title,body}}).catch(()=>0)}}
const creditDeposit=(t,ds,pid)=>{const D=ds.data();t.update(ds.ref,{status:'success',paymentId:pid,paidAt:FV.serverTimestamp()});t.update(db.doc('wallets/'+D.uid),{deposit:FV.increment(D.amount)});
 txn(t,ds.id,{uid:D.uid,type:'deposit',amount:D.amount,method:D.method||'upi',status:'success',ref:ds.id});note(t,D.uid,'Payment successful','Rs '+D.amount+' was added to your wallet.')};
const DAILY_REWARDS=[2,4,6,8,3,7,3];
const indiaDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const dayBefore=k=>{const d=new Date(new Date(k+'T00:00:00+05:30').getTime()-86400000);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)};
function applyXp(t,uid,user,walletRef,amount,reason){const oldXp=Number(user.xp||0),oldLevel=Math.max(1,Number(user.level||1)),xp=oldXp+amount,level=Math.floor(xp/500)+1;let bonus=0;
 for(let lv=oldLevel+1;lv<=level;lv++){const reward=Math.min(lv,8);bonus+=reward;txn(t,null,{uid,type:'level_reward',amount:reward,method:'bonus',status:'success',ref:'level_'+lv});note(t,uid,'Level up!','You reached level '+lv+' and earned Rs '+reward+' bonus.')}
 t.update(db.doc('users/'+uid),{xp,level,title:level>=20?'Legend':level>=10?'Elite':level>=5?'Veteran':'Rookie'});
 if(bonus)t.update(walletRef,{bonus:FV.increment(bonus)});
 if(amount)note(t,uid,'XP earned','+'+amount+' XP: '+reason);
}

// ---------- accounts and roles ----------
exports.onUserCreate=async (u)=>{
 const uid=u.uid,ur=db.doc('users/'+uid),wr=db.doc('wallets/'+uid),name=(u.displayName||(u.email||'player').split('@')[0]).replace(/[^\w ]/g,'').slice(0,24);
 await db.runTransaction(async t=>{const [us,ws]=await t.getAll(ur,wr);if(!us.exists)t.set(ur,{username:name.length>=3?name:'Player_'+uid.slice(0,4),email:u.email||'',photoURL:u.photoURL||'',mobile:'',gameIds:{},notify:{match:true,room:true,pay:true},blocked:false,wins:0,joined:0,xp:0,level:1,title:'Rookie',dailyStreak:0,createdAt:FV.serverTimestamp(),lastSeen:FV.serverTimestamp()});if(!ws.exists)t.set(wr,{deposit:0,winnings:0,bonus:0,earned:0,withdrawn:0})})};

exports.ensurePlayerProfile=async(d,c)=>{const uid=who(c),u=await auth.getUser(uid),ur=db.doc('users/'+uid),wr=db.doc('wallets/'+uid);
 await db.runTransaction(async t=>{const [us,ws]=await t.getAll(ur,wr);if(!us.exists){const name=(u.displayName||(u.email||'player').split('@')[0]).replace(/[^\w ]/g,'').slice(0,24);t.set(ur,{username:name.length>=3?name:'Player_'+uid.slice(0,4),email:u.email||'',photoURL:u.photoURL||'',mobile:'',gameIds:{},notify:{match:true,room:true,pay:true},blocked:false,wins:0,joined:0,xp:0,level:1,title:'Rookie',dailyStreak:0,createdAt:FV.serverTimestamp(),lastSeen:FV.serverTimestamp()})}if(!ws.exists)t.set(wr,{deposit:0,winnings:0,bonus:0,earned:0,withdrawn:0})});return ok};

exports.setupFirstAdmin=async(d,c)=>{const uid=who(c),e=c.auth.token.email;
 if(!process.env.FIRST_ADMIN_EMAIL||e!==process.env.FIRST_ADMIN_EMAIL||!c.auth.token.email_verified)bad('permission-denied','This account cannot run the setup.');
 await db.runTransaction(async t=>{const s=db.doc('settings/setup');if((await t.get(s)).exists)bad('already-exists','Setup was already completed.');
  t.set(s,{uid,at:FV.serverTimestamp()});t.set(db.doc('admin_roles/'+uid),{role:'superadmin',email:e,at:FV.serverTimestamp()});log(t,uid,'setupFirstAdmin')});
 await auth.setCustomUserClaims(uid,{role:'superadmin'});return ok};

exports.setRole=async(d,c)=>{const me=staff(c,'superadmin'),role=String(d.role||'');
 if(!['admin','moderator','none'].includes(role))bad('invalid-argument','Unknown role.');
 const u=await auth.getUserByEmail(String(d.email||'').trim()).catch(()=>bad('not-found','No user with that email.'));
 if(u.uid===me||(u.customClaims&&u.customClaims.role==='superadmin'))bad('failed-precondition','A super admin role cannot be changed here.');
 await auth.setCustomUserClaims(u.uid,role==='none'?{}:{role});
 const b=db.batch();role==='none'?b.delete(db.doc('admin_roles/'+u.uid)):b.set(db.doc('admin_roles/'+u.uid),{role,email:u.email,by:me,at:FV.serverTimestamp()});
 log(b,me,'setRole',{target:u.uid,role});await b.commit();return ok};

exports.adminBlockUser=async(d,c)=>{const me=staff(c,'admin'),uid=String(d.uid||''),b=d.blocked===true;
 const u=await auth.getUser(uid).catch(()=>bad('not-found','No such user.'));if(u.customClaims&&u.customClaims.role)bad('failed-precondition','Staff accounts cannot be blocked here.');
 await auth.updateUser(uid,{disabled:b});if(b)await auth.revokeRefreshTokens(uid);await db.doc('users/'+uid).update({blocked:b});await logNow(me,b?'block':'unblock',{uid});return ok};

exports.adminEditUser=async(d,c)=>{const me=staff(c,'admin'),uid=String(d.uid||''),data=d.data||{},allowed={};
 if(typeof data.username==='string'&&data.username.trim().length>=3&&data.username.trim().length<=24)allowed.username=data.username.trim();
 if(typeof data.mobile==='string'&&/^[+0-9 -]{7,18}$/.test(data.mobile))allowed.mobile=data.mobile.trim();
 if(typeof data.photoURL==='string'&&data.photoURL.length<=1500)allowed.photoURL=data.photoURL;
 if(typeof data.gameIds==='object'&&data.gameIds&&!Array.isArray(data.gameIds))allowed.gameIds=data.gameIds;
 if(!Object.keys(allowed).length)bad('invalid-argument','No valid profile fields were supplied.');
 await db.doc('users/'+uid).update(allowed);await logNow(me,'user.edit',{uid,fields:Object.keys(allowed)});return ok};
exports.adminMessageUser=async(d,c)=>{const me=staff(c,'moderator'),uid=String(d.uid||''),title=String(d.title||'').trim().slice(0,80),body=String(d.body||'').trim().slice(0,1000);
 if(!title||!body)bad('invalid-argument','A title and message are required.');if(!(await db.doc('users/'+uid).get()).exists)bad('not-found','User not found.');
 await db.collection('notifications').add({uid,title,body,read:false,at:FV.serverTimestamp(),by:me});await logNow(me,'user.message',{uid,title});return ok};
exports.adminDeleteUser=async(d,c)=>{const me=staff(c,'admin'),uid=String(d.uid||'');if(uid===me)bad('failed-precondition','You cannot delete your own admin account.');
 const u=await auth.getUser(uid).catch(()=>bad('not-found','User not found.'));if(u.customClaims&&u.customClaims.role)bad('failed-precondition','Staff accounts cannot be deleted here.');
 await auth.updateUser(uid,{disabled:true});await auth.revokeRefreshTokens(uid);await db.doc('users/'+uid).set({blocked:true,deleted:true,deletedAt:FV.serverTimestamp(),deletedBy:me},{merge:true});
 await logNow(me,'user.softDelete',{uid});return ok};

exports.saveFcmToken=async(d,c)=>{const uid=who(c),t=String(d.token||'');if(t.length<20)bad('invalid-argument','Bad token.');
 await db.doc('users/'+uid).update({fcm:FV.arrayUnion(t)});await msg.subscribeToTopic(t,'all').catch(()=>0);return ok};

// ---------- admin content (tournaments, announcements, promotions, settings) ----------
const FIELDS={
 tournaments:{min:'moderator',f:{title:'s',game:'s',type:'s',map:'s',poster:'s',fee:'n',prize:'n',max:'n',startAt:'t',rules:'s',split:'s',featured:'b',streamUrl:'s'}},
 announcements:{min:'moderator',f:{title:'s',text:'s',enabled:'b',pinned:'b'}},
 promotions:{min:'admin',f:{title:'s',kind:'s',link:'s',image:'s',enabled:'b',order:'n'}},
 settings:{min:'admin',f:{brandName:'s',games:'s',supportWhatsapp:'s',supportEmail:'s',supportUrl:'s',helpUrl:'s',upiMerchantName:'s',upiId:'s',minWithdraw:'n',roomOpenMinutes:'n'}}};
const conv=(k,v)=>k==='s'?String(v).trim().slice(0,3000):k==='n'?(Number.isFinite(+v)?+v:bad('invalid-argument','A number field is invalid.')):k==='t'?TS.fromMillis(+v):v===true;
exports.adminUpsert=async(d,c)=>{const F=FIELDS[d.col];if(!F)bad('invalid-argument','Unknown collection.');
 const me=staff(c,d.del?'admin':F.min),id=d.col==='settings'?'public':String(d.id||db.collection(d.col).doc().id),ref=db.doc(d.col+'/'+id),old=await ref.get();
 if(d.del){if(d.col==='tournaments'&&old.exists&&old.data().joined>0)bad('failed-precondition','This tournament has players. Cancel it instead.');
  await ref.delete();if(d.col==='tournaments')await db.doc('tournaments/'+id+'/private/room').delete();await logNow(me,'delete.'+d.col,{id});return ok}
 const x={};for(const k in F.f){const v=d.data&&d.data[k];if(v!==undefined&&v!==null&&(v!==''||k==='streamUrl'))x[k]=conv(F.f[k],v)}
 if(d.col==='tournaments'){
  if(!old.exists){if(!x.title||!x.game||!x.startAt||!(x.max>=1))bad('invalid-argument','Title, game, start time and slots are required.');Object.assign(x,{status:'upcoming',joined:0,createdAt:FV.serverTimestamp()})}
  if([x.fee,x.prize,x.max].some(v=>v!==undefined&&!Number.isInteger(v))||x.fee<0||x.prize<0||(x.max&&x.max<(old.exists?old.data().joined:0)))bad('invalid-argument','Check entry fee, prize pool and slots (whole numbers, slots not below players joined).');
  if(x.game)x.gameKey=slug(x.game);if(x.streamUrl){let u;try{u=new URL(x.streamUrl)}catch{bad('invalid-argument','Enter a valid YouTube live URL.')}if(!['youtube.com','www.youtube.com','youtu.be','m.youtube.com','youtube-nocookie.com'].includes(u.hostname))bad('invalid-argument','Only YouTube live URLs are allowed.')}}
 if(d.col==='settings'&&x.upiId&&!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(x.upiId))bad('invalid-argument','Enter a valid UPI ID.')
 await ref.set(x,{merge:true});await logNow(me,'save.'+d.col,{id});
 if(d.col==='announcements'&&!old.exists&&x.enabled!==false)msg.send({topic:'all',notification:{title:x.title||'Announcement',body:(x.text||'').slice(0,200)}}).catch(()=>0);
 return{id}};

exports.adminSetRoom=async(d,c)=>{const me=staff(c,'moderator'),id=String(d.tid||'');
 if(!(await db.doc('tournaments/'+id).get()).exists)bad('not-found','Tournament not found.');
 await db.doc('tournaments/'+id+'/private/room').set({roomId:String(d.roomId||'').slice(0,40),roomPass:String(d.roomPass||'').slice(0,40),at:FV.serverTimestamp()});
 await logNow(me,'setRoom',{tid:id});return ok};

exports.adminTournamentAction=async(d,c)=>{
 const me=staff(c,'moderator'),id=String(d.tid||''),a=String(d.action||''),ref=db.doc('tournaments/'+id);
 if(!['start','complete','cancel'].includes(a))bad('invalid-argument','Unknown action.');
 const s=await ref.get();if(!s.exists)bad('not-found','Tournament not found.');const st=s.data().status;
 if(a==='start'){if(st!=='upcoming')bad('failed-precondition','Only upcoming tournaments can be started.');await ref.update({status:'live'});}
 if(a==='complete'){
  if(!['live','completed'].includes(st))bad('failed-precondition','Only live tournaments can be completed.');
  const regs=(await db.collection('registrations').where('tid','==',id).where('status','==','registered').get()).docs;
  for(const r of regs){await db.runTransaction(async t=>{const rr=db.doc(r.ref.path),[rs,us,ws]=await t.getAll(rr,db.doc('users/'+r.data().uid),db.doc('wallets/'+r.data().uid));if(!rs.exists||rs.data().status!=='registered'||rs.data().completionXpAwarded)return;if(us.exists&&ws.exists){applyXp(t,r.data().uid,us.data(),ws.ref,50,'Match completed');t.update(rr,{completionXpAwarded:true})}})}
  if(st==='live')await ref.update({status:'completed'});
 }
 if(a==='cancel'){
  if(!['upcoming','live','cancelled'].includes(st))bad('failed-precondition','This tournament cannot be cancelled.');
  if(st!=='cancelled')await ref.update({status:'cancelled'});
  const regs=(await db.collection('registrations').where('tid','==',id).where('status','==','registered').get()).docs;
  for(let i=0;i<regs.length;i+=20)await Promise.all(regs.slice(i,i+20).map(r=>db.runTransaction(async t=>{const x=await t.get(r.ref),R=x.data();if(!x.exists||R.status!=='registered')return;
   if(R.fee>0){const p=R.paidFrom||{deposit:R.fee,winnings:0,bonus:0},refund={};if(p.deposit)refund.deposit=FV.increment(p.deposit);if(p.winnings)refund.winnings=FV.increment(p.winnings);if(p.bonus)refund.bonus=FV.increment(p.bonus);if(Object.keys(refund).length)t.update(db.doc('wallets/'+R.uid),refund);txn(t,null,{uid:R.uid,type:'refund',amount:R.fee,method:'wallet',status:'success',ref:id})}
   t.update(r.ref,{status:'refunded'});t.set(db.doc('tournament_rosters/'+id+'/teams/'+R.uid),{status:'refunded'},{merge:true})})));
  await push(regs.map(r=>r.data().uid),'Tournament cancelled','Your entry fee was refunded to your wallet.')
 }
 await logNow(me,'tournament.'+a,{tid:id});return ok};

// ---------- players ----------
exports.joinTournament=async(d,c)=>{const uid=who(c),id=String(d.tid||''),TAGS=Array.isArray(d.players)?d.players:[{ign:d.ign,gameId:d.gameId}];
 if(d.age18!==true)bad('failed-precondition','You must confirm that you are 18 or older.');
 const type=String((await db.doc('tournaments/'+id).get()).data()?.type||'').toLowerCase(),expected=type.includes('squad')?4:type.includes('duo')?2:1;
 if(TAGS.length!==expected)bad('invalid-argument','This tournament requires exactly '+expected+' player tag(s).');
 const members=TAGS.map(x=>({ign:String(x.ign||'').trim(),gameId:String(x.gameId||'').trim()}));
 if(members.some(x=>! /^[\w ]{3,24}$/.test(x.ign)||! /^[\w ]{3,20}$/.test(x.gameId)))bad('invalid-argument','Check every in-game name and game ID.');
 await db.runTransaction(async t=>{const tr=db.doc('tournaments/'+id),rr=db.doc('registrations/'+id+'_'+uid),wr=db.doc('wallets/'+uid),ur=db.doc('users/'+uid);
  const [ts,rs,ws,us]=await t.getAll(tr,rr,wr,ur);if(!ts.exists)bad('not-found','Tournament not found.');const T=ts.data(),required=String(T.type||'').toLowerCase().includes('squad')?4:String(T.type||'').toLowerCase().includes('duo')?2:1;if(members.length!==required)bad('failed-precondition','Tournament team size changed. Reload and try again.')
  if(!us.exists||us.data().blocked||us.data().deleted)bad('permission-denied','Your account cannot join tournaments.');
  if(rs.exists&&rs.data().status==='registered')bad('already-exists','You have already joined this tournament.');
  if(T.status!=='upcoming'||T.startAt.toMillis()<=Date.now())bad('failed-precondition','Registration is closed.');
  if((T.joined||0)>=(T.max||0))bad('resource-exhausted','This tournament is full.');
  const fee=(T.fee||0),w=ws.data()||{},dep=Number(w.deposit||0),win=Number(w.winnings||0),bonus=Number(w.bonus||0);
  if(dep+win+bonus<fee)bad('failed-precondition','Not enough balance. Add money or use bonus credits.');
  let left=fee,useD=Math.min(dep,left);left-=useD;let useW=Math.min(win,left);left-=useW;let useB=Math.min(bonus,left);
  if(useD||useW||useB)t.update(wr,{...(useD?{deposit:FV.increment(-useD)}:{}),...(useW?{winnings:FV.increment(-useW)}:{}),...(useB?{bonus:FV.increment(-useB)}:{})});
  if(fee)txn(t,null,{uid,type:'entry_fee',amount:fee,method:'wallet',status:'success',ref:id});
  t.set(rr,{tid:id,uid,ign:members[0].ign,gameId:members[0].gameId,members,seatCount:expected,fee,paidFrom:{deposit:useD,winnings:useW,bonus:useB},status:'registered',at:FV.serverTimestamp()});
  t.set(db.doc('tournament_rosters/'+id+'/teams/'+uid),{uid,username:us.data().username||'Player',members,seatCount:expected,status:'registered',at:FV.serverTimestamp()});
  t.update(tr,{joined:FV.increment(1),playerCount:FV.increment(expected)});t.update(ur,{joined:FV.increment(1)});applyXp(t,uid,us.data(),wr,50,'Tournament joined');note(t,uid,'Registration confirmed','You joined '+T.title+'.')});
 return ok};

exports.getRoom=async(d,c)=>{const uid=who(c),id=String(d.tid||'');
 const [reg,t,room,set]=await Promise.all([db.doc('registrations/'+id+'_'+uid).get(),db.doc('tournaments/'+id).get(),db.doc('tournaments/'+id+'/private/room').get(),db.doc('settings/public').get()]);
 if(!reg.exists||reg.data().status!=='registered')bad('permission-denied','Join this tournament to see the room.');
 const T=t.data(),open=((set.data()||{}).roomOpenMinutes||15)*60000;
 if(!['upcoming','live'].includes(T.status))bad('failed-precondition','This match is over.');
 if(Date.now()<T.startAt.toMillis()-open)bad('failed-precondition','The room opens '+(open/60000)+' minutes before the match.');
 if(!room.exists)bad('not-found','The organiser has not added the room yet.');
 return{roomId:room.data().roomId,roomPass:room.data().roomPass}};

// ---------- payments ----------
exports.submitManualDeposit=async(d,c)=>{
 const uid=who(c),amount=Number(d.amount),utr=String(d.utr||'').trim(),proofData=String(d.proofData||'');
 if(!Number.isInteger(amount)||amount<10||amount>50000)bad('invalid-argument','Deposit amount must be between Rs 10 and Rs 50,000.');
 if(!/^[A-Za-z0-9-]{6,40}$/.test(utr))bad('invalid-argument','Enter a valid UTR/reference number.');
 if(!/^data:image\/(jpeg|png|webp);base64,/.test(proofData)||proofData.length>700000)bad('invalid-argument','Payment screenshot must be a compressed image under the Firestore size limit.');
 const raw=proofData.split(',')[1]||'',bytes=Buffer.from(raw,'base64');
 if(!bytes.length||bytes.length>500*1024)bad('invalid-argument','Payment screenshot must be under 500 KB after compression.');
 const user=await db.doc('users/'+uid).get();if(!user.exists||user.data().blocked||user.data().deleted)bad('permission-denied','Your account cannot add money.');
 const ref=db.collection('deposits').doc(),proofRef=db.doc('deposit_proofs/'+ref.id);
 await db.runTransaction(async t=>{
  const dup=await t.get(db.collection('deposits').where('utr','==',utr).limit(1));if(!dup.empty)bad('already-exists','This UTR has already been submitted.');
  t.set(proofRef,{uid,data:proofData,contentType:proofData.slice(5,proofData.indexOf(';')),createdAt:FV.serverTimestamp()});
  t.set(ref,{uid,email:c.auth.token.email||'',amount,status:'review',method:'manual_upi',gateway:'manual',utr,proofId:ref.id,createdAt:FV.serverTimestamp()});
  t.set(db.doc('transactions/'+ref.id),{uid,type:'deposit',amount,method:'manual_upi',status:'review',ref:ref.id,at:FV.serverTimestamp()});
  t.set(db.collection('notifications').doc(),{uid,title:'Payment submitted',body:'Your UPI payment is waiting for admin verification.',read:false,at:FV.serverTimestamp()})
 });return{id:ref.id}
};
exports.getManualDepositProof=async(d,c)=>{
 staff(c,'admin');const id=String(d.id||'');if(!id)bad('invalid-argument','Deposit reference is required.');
 const [ds,ps]=await Promise.all([db.doc('deposits/'+id).get(),db.doc('deposit_proofs/'+id).get()]);
 if(!ds.exists||!ps.exists||ds.data().proofId!==id)bad('not-found','Payment screenshot not found.');
 return{data:ps.data().data,contentType:ps.data().contentType||'image/jpeg'};
};

exports.claimDailyReward=async(d,c)=>{const uid=who(c),today=indiaDay(),ur=db.doc('users/'+uid),wr=db.doc('wallets/'+uid);let reward=0,streak=0;
 await db.runTransaction(async t=>{const [us,ws]=await t.getAll(ur,wr);if(!us.exists||us.data().blocked||us.data().deleted)bad('permission-denied','Your account cannot claim rewards.');const U=us.data();
  if(U.lastDailyClaimDate===today)bad("already-exists","Today's reward has already been claimed.");streak=U.lastDailyClaimDate===dayBefore(today)?((U.dailyStreak||0)%7)+1:1;reward=DAILY_REWARDS[(streak-1)%7];
  t.update(ur,{lastDailyClaimDate:today,dailyStreak:streak});t.update(wr,{bonus:FV.increment(reward)});
  txn(t,null,{uid,type:'daily_reward',amount:reward,method:'bonus',status:'success',ref:today});note(t,uid,'Daily reward claimed','You received Rs '+reward+' bonus credit.')});return{reward,streak,today}};

exports.createDeposit=async(d,c)=>{const uid=who(c),amt=d.amount;
 if(!Number.isInteger(amt)||amt<10||amt>50000)bad('invalid-argument','Amount must be between Rs 10 and Rs 50,000.');
 const us=await db.doc('users/'+uid).get();if(!us.exists||us.data().blocked||us.data().deleted)bad('permission-denied','Your account cannot add money.');
 const ref=db.collection('deposits').doc(),exp=Date.now()+300000;
 // Create the pending record before exposing the QR to the player.
 await ref.set({uid,email:c.auth.token.email||'',amount:amt,status:'creating',gateway:'razorpay',createdAt:FV.serverTimestamp(),expiresAt:TS.fromMillis(exp)});
 try{
  const r=await fetch('https://api.razorpay.com/v1/payments/qr_codes',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(process.env.RZP_KEY_ID+':'+process.env.RZP_KEY_SECRET).toString('base64')},
   body:JSON.stringify({type:'upi_qr',name:'UC ESPORTS',usage:'single_use',fixed_amount:true,payment_amount:amt*100,description:'UC Esports wallet top-up',close_by:Math.floor(exp/1000),notes:{depositId:ref.id,uid}})});
  const q=await r.json().catch(()=>({}));
  if(!r.ok||!q.id||!q.image_url)throw new Error('Razorpay could not create a payment QR.');
  await ref.update({status:'pending',qrId:q.id,qrImage:q.image_url});
  return{id:ref.id,qr:q.image_url,qrId:q.id,expiresAt:exp};
 }catch(e){
  await ref.update({status:'failed',failureReason:String(e.message||'Payment QR creation failed').slice(0,180)}).catch(()=>0);
  console.error('Razorpay QR creation failed',e);
  bad('unavailable','Razorpay could not create the QR right now. Please try again.');
 }
};

exports.paymentWebhook=async(req,res)=>{
 if(req.method!=='POST')return res.status(405).send('method not allowed');
 const sig=req.get('x-razorpay-signature')||'',raw=req.rawBody||Buffer.from('');
 const h=crypto.createHmac('sha256',process.env.RZP_WEBHOOK_SECRET).update(raw).digest('hex');
 if(!sig||sig.length!==h.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(h)))return res.status(401).send('bad signature');
 try{
  const ev=req.body||{};
  if(ev.event!=='qr_code.credited')return res.status(200).send('ignored');
  const pay=ev.payload?.payment?.entity,qr=ev.payload?.qr_code?.entity;
  if(!pay?.id||!qr?.id)return res.status(400).send('invalid event payload');
  const q=await db.collection('deposits').where('qrId','==',qr.id).limit(1).get();
  if(q.empty)return res.status(200).send('unknown QR');
  await db.runTransaction(async t=>{
   const seen=db.doc('payments_seen/'+pay.id),[ds,sn]=await t.getAll(q.docs[0].ref,seen);
   if(sn.exists)return;
   const D=ds.data();
   t.create(seen,{deposit:ds.id,at:FV.serverTimestamp()});
   const expired=D.expiresAt&&D.expiresAt.toMillis()<=Date.now();
   if(D.status==='pending'&&!expired&&pay.status==='captured'&&pay.amount===D.amount*100&&pay.currency==='INR'){
    creditDeposit(t,ds,pay.id);
   }else if(['pending','expired'].includes(D.status)){
    t.update(ds.ref,{status:'review',paymentId:pay.id,paidAmount:Number(pay.amount||0)/100,paymentCurrency:pay.currency||''});
   }
  });
  return res.status(200).send('ok');
 }catch(e){
  console.error('Razorpay webhook processing failed',e);
  return res.status(500).send('webhook processing failed');
 }
};

exports.adminReviewDeposit=async(d,c)=>{const me=staff(c,'admin'),id=String(d.id||'');
 await db.runTransaction(async t=>{const ds=await t.get(db.doc('deposits/'+id));if(!ds.exists)bad('not-found','Deposit not found.');const D=ds.data();
  if(!['review','expired','pending'].includes(D.status))bad('failed-precondition','Only pending or review deposits can be changed.');
  if(d.approve===true)creditDeposit(t,ds,D.paymentId||'manual');
  else{t.update(ds.ref,{status:'rejected',by:me});t.set(db.doc('transactions/'+id),{uid:D.uid,type:'deposit',amount:D.amount,method:D.method||'upi',status:'rejected',ref:id,at:FV.serverTimestamp()},{merge:true});note(t,D.uid,'Payment not credited','Your Rs '+D.amount+' payment could not be verified.')}
  log(t,me,d.approve===true?'deposit.approve':'deposit.reject',{id,amount:D.amount})});return ok};

exports.requestWithdrawal=async(d,c)=>{const uid=who(c),amt=d.amount,upi=String(d.upi||'').trim(),holder=String(d.holder||'').trim();
 if(!c.auth.token.email_verified)bad('failed-precondition','Verify your email before withdrawing.');
 const min=((await db.doc('settings/public').get()).data()||{}).minWithdraw||100;
 if(!Number.isInteger(amt)||amt<min)bad('invalid-argument','The minimum withdrawal is Rs '+min+'.');
 if(!/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(upi)||holder.length<3)bad('invalid-argument','Check your UPI ID and account holder name.');
 const wid=db.collection('withdrawals').doc().id;
 await db.runTransaction(async t=>{const wr=db.doc('wallets/'+uid),[ws,us]=await t.getAll(wr,db.doc('users/'+uid));
  if(!us.exists||us.data().blocked)bad('permission-denied','Your account cannot withdraw.');
  if(ws.data().winnings<amt)bad('failed-precondition','Only winnings can be withdrawn.');
  t.update(wr,{winnings:FV.increment(-amt)});
  t.set(db.doc('withdrawals/'+wid),{uid,email:c.auth.token.email||'',amount:amt,upi,holder,status:'pending',createdAt:FV.serverTimestamp()});
  txn(t,wid,{uid,type:'withdrawal',amount:amt,method:'upi',status:'pending',ref:wid});note(t,uid,'Withdrawal requested','Your withdrawal of Rs '+amt+' is pending review.')});
 return{id:wid}};

const NEXT={processing:['pending'],approved:['pending','processing'],paid:['approved'],rejected:['pending','processing','approved']};
exports.adminReviewWithdrawal=async(d,c)=>{const me=staff(c,'admin'),id=String(d.id||''),to=String(d.to||'');
 if(!NEXT[to])bad('invalid-argument','Unknown status.');
 await db.runTransaction(async t=>{const wr=db.doc('withdrawals/'+id),w=await t.get(wr);if(!w.exists)bad('not-found','Withdrawal not found.');const W=w.data();
  if(!NEXT[to].includes(W.status))bad('failed-precondition','Cannot move a '+W.status+' withdrawal to '+to+'.');
  if(to==='rejected')t.update(db.doc('wallets/'+W.uid),{winnings:FV.increment(W.amount)});
  if(to==='paid')t.update(db.doc('wallets/'+W.uid),{withdrawn:FV.increment(W.amount)});
  t.update(wr,{status:to,by:me,updatedAt:FV.serverTimestamp()});t.update(db.doc('transactions/'+id),{status:to});
  note(t,W.uid,'Withdrawal '+to,'Your withdrawal of Rs '+W.amount+' is now '+to+'.');log(t,me,'withdrawal.'+to,{id,uid:W.uid,amount:W.amount})});return ok};

// ---------- results and prizes ----------
exports.adminPublishResults=async(d,c)=>{
 const me=staff(c,'admin'),id=String(d.tid||''),W=Array.isArray(d.winners)?d.winners:[];
 if(!W.length||W.length>50)bad('invalid-argument','Add between 1 and 50 winners.');
 const seen=new Set(),ranks=new Set();for(const w of W){if(typeof w.uid!=='string'||seen.has(w.uid)||!Number.isInteger(w.rank)||w.rank<1||ranks.has(w.rank)||!Number.isInteger(w.prize)||w.prize<0)bad('invalid-argument','Each winner needs a unique player, a unique whole-number rank and a whole-number prize.');seen.add(w.uid);ranks.add(w.rank)}
 await db.runTransaction(async t=>{const tr=db.doc('tournaments/'+id),ts=await t.get(tr);if(!ts.exists)bad('not-found','Tournament not found.');const T=ts.data();
  if(!['live','completed'].includes(T.status)||T.resultsPublished)bad('failed-precondition','Results cannot be published for this tournament.');
  const total=W.reduce((a,w)=>a+w.prize,0);if(total>(T.prize||0))bad('failed-precondition','Prizes add up to more than the prize pool.');
  const snaps=await t.getAll(...W.flatMap(w=>[db.doc('registrations/'+id+'_'+w.uid),db.doc('wallets/'+w.uid),db.doc('users/'+w.uid),db.doc('leaderboards/'+w.uid)])),gk=T.gameKey||slug(T.game),wk=wkKey(),mo=moKey();
  W.forEach((w,i)=>{const [rs,ws,us]=snaps.slice(i*4,i*4+4),ls=snaps[i*4+3];
   if(!rs.exists||rs.data().status!=='registered')bad('failed-precondition','Player '+w.uid+' is not registered in this tournament.');
   const win=w.rank===1?1:0,inc={wins:FV.increment(win),earnings:FV.increment(w.prize)};
   t.update(rs.ref,{rank:w.rank,prize:w.prize});
   if(w.prize>0){t.update(ws.ref,{winnings:FV.increment(w.prize),earned:FV.increment(w.prize)});txn(t,null,{uid:w.uid,type:'winning',amount:w.prize,method:'wallet',status:'success',ref:id})}
   t.set(ls.ref,{uid:w.uid,username:us.data().username,photoURL:us.data().photoURL||'',...inc,games:{[gk]:inc},wk:{[wk]:inc},mo:{[mo]:inc}},{merge:true});
   applyXp(t,w.uid,us.data(),ws.ref,200,'Tournament win');if(win)t.update(us.ref,{wins:FV.increment(1)});
   note(t,w.uid,'Tournament result','You placed #'+w.rank+' in '+T.title+(w.prize?' and won Rs '+w.prize+'.':'.'))});
  t.set(db.doc('results/'+id),{tid:id,title:T.title,game:T.game,winners:W.map(w=>({uid:w.uid,rank:w.rank,prize:w.prize})),by:me,at:FV.serverTimestamp()});
  t.update(tr,{status:'completed',resultsPublished:true});log(t,me,'publishResults',{tid:id,total})});
 return ok};

// ---------- dashboard and scheduled jobs ----------
exports.adminStats=async(d,c)=>{staff(c,'moderator');
 const n=q=>q.count().get().then(r=>r.data().count),s=q=>q.aggregate({t:AF.sum('amount')}).get().then(r=>r.data().t||0),col=x=>db.collection(x),wk=TS.fromMillis(Date.now()-7*864e5);
 const [users,active,tours,live,done,pd,pw,dep,wd,fees,ref,win]=await Promise.all([n(col('users')),n(col('users').where('lastSeen','>=',wk)),n(col('tournaments')),n(col('tournaments').where('status','==','live')),n(col('tournaments').where('status','==','completed')),
  n(col('deposits').where('status','in',['pending','review'])),n(col('withdrawals').where('status','in',['pending','processing','approved'])),
  s(col('deposits').where('status','==','success')),s(col('withdrawals').where('status','==','paid')),s(col('transactions').where('type','==','entry_fee')),s(col('transactions').where('type','==','refund')),s(col('transactions').where('type','==','winning'))]);
 return{users,active,tours,live,done,pendingDeps:pd,pendingWds:pw,deposits:dep,withdrawals:wd,revenue:fees-ref-win}};

exports.tick=async ()=>{const now=Date.now();
 const ex=await db.collection('deposits').where('status','==','pending').where('expiresAt','<=',TS.fromMillis(now)).limit(200).get();
 await Promise.all(ex.docs.map(d=>db.runTransaction(async t=>{const s=await t.get(d.ref);if(s.data().status!=='pending')return;
  t.update(d.ref,{status:'expired'});note(t,s.data().uid,'Payment expired','Your Rs '+s.data().amount+' payment was not confirmed in time. Your wallet was not credited.')})));
 const open=((await db.doc('settings/public').get()).data()||{}).roomOpenMinutes||15;
 const soon=await db.collection('tournaments').where('status','==','upcoming').where('startAt','>=',TS.fromMillis(now)).where('startAt','<=',TS.fromMillis(now+open*60000)).get();
 for(const t of soon.docs){if(t.data().reminded)continue;await t.ref.update({reminded:true});
  const regs=await db.collection('registrations').where('tid','==',t.id).where('status','==','registered').get();
  await push(regs.docs.map(r=>r.data().uid),'Room details are ready',t.data().title+' starts soon. Open the tournament to see the Room ID and password.')}};
