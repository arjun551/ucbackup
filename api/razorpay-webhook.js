const backend=require('./_lib/backend');
async function readRaw(req){
 if(req.rawBody&&Buffer.isBuffer(req.rawBody))return req.rawBody;
 const chunks=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));
 return Buffer.concat(chunks);
}
module.exports=async function(req,res){
 try{
  const raw=await readRaw(req);let body={};
  try{body=JSON.parse(raw.toString('utf8'))}catch{return res.status(400).send('invalid JSON')}
  const shim={method:req.method,rawBody:raw,body,get:(name)=>req.headers[String(name).toLowerCase()]};
  return backend.paymentWebhook(shim,res);
 }catch(e){console.error('Webhook route failed:',e.message);return res.status(500).send('webhook processing failed')}
};
module.exports.config={api:{bodyParser:false}};
