import {get,put,BlobPreconditionFailedError} from '@vercel/blob';
export {BlobPreconditionFailedError};
const prefix=process.env.VERCEL_ENV==='production'?'':'preview/';
export async function readRecord(name:string){
 const result=await get(prefix+name,{access:'private',useCache:false});
 if(!result)return null;
 if(result.statusCode!==200||!result.stream)throw Error('Unable to read records');
 return {value:await new Response(result.stream).json(),etag:result.blob.etag};
}
export async function writeRecord(name:string,value:unknown,etag:string|null){
 return put(prefix+name,JSON.stringify(value),{access:'private',contentType:'application/json',addRandomSuffix:false,allowOverwrite:etag!==null,...(etag?{ifMatch:etag}:{})});
}
export const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function trustedWrite(request:Request){
 if(request.headers.get('sec-fetch-site')==='cross-site')return false;
 const origin=request.headers.get('origin');
 try{return !origin||new URL(origin).host===request.headers.get('host')}catch{return false}
}
