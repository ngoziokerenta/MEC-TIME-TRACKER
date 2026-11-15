import {emptyState,stateSchema} from '../../../lib/state';
import {readRecord,writeRecord,json,trustedWrite,BlobPreconditionFailedError} from '../../../lib/storage';
export const dynamic='force-dynamic';
async function directory(data:any){
 const workspace=(await readRecord('workspace/records.json'))?.value.data;
 if(!workspace)return data;
 const clients=workspace.companies.map((c:any)=>({id:c.id,name:c.name,email:c.contactEmail||'',address:c.billingAddress||'',vendorNumber:c.vendorNumber||'',offeringIds:c.offeringIds||[]}));
 // Retain any older billing-only clients that are absent from the shared list.
 for(const c of data.clients)if(!clients.some((x:any)=>x.id===c.id||x.name.trim().toLowerCase()===c.name.trim().toLowerCase()))clients.push(c);
 return {...data,company:workspace.billingProfile||data.company,catalog:workspace.offerings,clients};
}
export async function GET(){
 try{const record=await readRecord('finance/records.json');return json({revision:record?.value.revision||0,data:await directory(record?.value.data||emptyState)})}
 catch{return json({error:'Invoices could not be loaded. Please retry.'},503)}
}
export async function PUT(request:Request){
 if(!trustedWrite(request))return json({error:'This save request is not allowed.'},403);
 try{
  const body=await request.json();
  const parsed=stateSchema.safeParse(await directory(body.data));
  if(!parsed.success)return json({error:parsed.error.issues[0].message},400);
  const record=await readRecord('finance/records.json');
  if(body.revision!==(record?.value.revision||0))return json({error:'Invoices changed on another device. Reload before saving again.'},409);
  const revision=body.revision+1;
  await writeRecord('finance/records.json',{revision,data:parsed.data},record?.etag||null);
  return json({revision});
 }catch(error){
  if(error instanceof BlobPreconditionFailedError)return json({error:'Invoices changed on another device. Reload before saving again.'},409);
  return json({error:'Invoice changes could not be saved. Your form remains open.'},503);
 }
}
