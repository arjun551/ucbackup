const backend=require('../lib/backend');
module.exports=async function(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const expected=process.env.CRON_SECRET||'';
 const supplied=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 if(!expected||supplied!==expected)return res.status(401).json({error:'Unauthorized'});
 try{await backend.tick();return res.status(200).json({ok:true})}
 catch(e){console.error('Maintenance task failed:',e.message);return res.status(500).json({error:'Maintenance task failed'})}
};
