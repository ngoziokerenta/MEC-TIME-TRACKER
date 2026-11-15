import {get,put,BlobPreconditionFailedError} from '@vercel/blob';
import {stateSchema,emptyState} from '../../../lib/state';

export const dynamic='force-dynamic';
// This internal tool requires Vercel Authentication on ALL deployments,
// including production. Storage tokens and import data stay server-side.
const pathname=process.env.VERCEL_ENV==='production'?'finance/records.json':'finance/preview-records.json';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});

async function current(){
 const file=await get(pathname,{access:'private',useCache:false});
 if(!file)return null;
 if(file.statusCode!==200||!file.stream)throw Error('Unable to read saved records');
 const saved=await new Response(file.stream).json();
 return {saved,etag:file.blob.etag};
}
async function load(){
 const existing=await current();
 if(existing)return existing;
 const raw=process.env.MEC_INVOICE_MIGRATION;
 if(!raw)return {saved:{revision:0,data:emptyState},etag:null};
 const saved={revision:1,data:raw?stateSchema.parse(JSON.parse(raw)):emptyState};
 try{
  const file=await put(pathname,JSON.stringify(saved),{access:'private',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false});
  return {saved,etag:file.etag};
 }catch(error){
  const winner=await current();if(winner)return winner;throw error;
 }
}
export async function GET(){
 try{return reply((await load()).saved)}catch{return reply({error:'Records could not be loaded. Try again shortly.'},503)}
}
export async function PUT(request:Request){
 if(request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'Untrusted request'},403);
 const origin=request.headers.get('origin');
 if(origin&&new URL(origin).host!==request.headers.get('host'))return reply({error:'Untrusted request'},403);
 try{
  const body=await request.json();
  const parsed=stateSchema.safeParse(body.data);
  if(!parsed.success)return reply({error:parsed.error.issues[0]?.message||'Invalid records'},400);
  const previous=await load();
  if(body.revision!==previous.saved.revision)return reply({error:'Records changed in another tab. Reload before saving again.'},409);
  const saved={revision:previous.saved.revision+1,data:parsed.data};
  await put(pathname,JSON.stringify(saved),{access:'private',contentType:'application/json',addRandomSuffix:false,allowOverwrite:previous.etag!==null,...(previous.etag?{ifMatch:previous.etag}:{})});
  return reply({revision:saved.revision});
 }catch(error){
  if(error instanceof BlobPreconditionFailedError)return reply({error:'Records changed in another tab. Reload before saving again.'},409);
  return reply({error:'Records could not be saved. Your form remains open; please try again.'},503);
 }
}
