const backend=require('../lib/backend');
const {getAuth}=require('firebase-admin/auth');
const ALLOWED=new Set([
 'ensurePlayerProfile','setupFirstAdmin','setRole','adminBlockUser','adminEditUser','adminMessageUser','adminDeleteUser','saveFcmToken',
 'adminUpsert','adminSetRoom','adminTournamentAction','joinTournament','getRoom','submitManualDeposit','claimDailyReward','createDeposit',
 'adminReviewDeposit','getManualDepositProof','requestWithdrawal','adminReviewWithdrawal','adminPublishResults','adminStats'
]);
const STATUS={'unauthenticated':401,'permission-denied':403,'not-found':404,'already-exists':409,'failed-precondition':409,'invalid-argument':400,'resource-exhausted':429,'unavailable':503};
module.exports=async function(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 try{
  const h=String(req.headers.authorization||'');
  if(!h.startsWith('Bearer '))return res.status(401).json({error:'Sign in first.'});
  const decoded=await getAuth().verifyIdToken(h.slice(7));
  const name=String(req.body?.name||'');
  if(!ALLOWED.has(name)||typeof backend[name]!=='function')return res.status(404).json({error:'Unknown operation.'});
  const data=req.body?.data&&typeof req.body.data==='object'?req.body.data:{};
  const result=await backend[name](data,{auth:{uid:decoded.uid,token:{email:decoded.email||'',email_verified:decoded.email_verified===true,role:decoded.role||''}},rawRequest:req});
  return res.status(200).json({data:result===undefined?null:result});
 }catch(e){
  const code=String(e.code||'internal');
  console.error('UC API request failed:',code,e.message);
  return res.status(STATUS[code]||500).json({error:STATUS[code]?e.message:'Server request failed.',code});
 }
};
