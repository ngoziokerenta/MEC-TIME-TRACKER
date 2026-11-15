import {emptyData,workspaceSchema} from '../../../lib/workspace';
import {readRecord,writeRecord,json,trustedWrite,BlobPreconditionFailedError} from '../../../lib/storage';
export const dynamic='force-dynamic';
// Vercel Authentication protects ALL deployments of this owner-private app.
export async function GET(){
 try{return json((await readRecord('workspace/records.json'))?.value||{data:emptyData(),version:0})}
 catch{return json({error:'Workspace could not be loaded. Please retry.'},503)}
}
export async function PUT(request:Request){
 if(!trustedWrite(request))return json({error:'This save request is not allowed.'},403);
 try{
  const body=await request.json();
  const record=await readRecord('workspace/records.json');
  if(body.data&&record)for(const key of ['billingProfile','offerings'])if(!Object.hasOwn(body.data,key))body.data[key]=record.value.data[key];
  const parsed=workspaceSchema.safeParse(body.data);
  if(!parsed.success||!Number.isInteger(body.version)||body.version<0)return json({error:parsed.success?'Invalid workspace version.':parsed.error.issues[0].message},400);
  if(body.version!==(record?.value.version||0))return json({error:'This workspace changed on another device. Reload before saving. Your form is still open.'},409);
  const saved={data:parsed.data,version:body.version+1,savedAt:new Date().toISOString()};
  await writeRecord('workspace/records.json',saved,record?.etag||null);
  return json({version:saved.version,savedAt:saved.savedAt});
 }catch(error){
  if(error instanceof BlobPreconditionFailedError)return json({error:'This workspace changed on another device. Reload before saving.'},409);
  return json({error:'Your changes could not be saved. Your form remains open.'},503);
 }
}
