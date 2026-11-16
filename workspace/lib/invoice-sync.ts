type Snapshot={revision:number;data:any};
type Fetcher=(input:string,init?:RequestInit)=>Promise<Response>;
const object=(v:any):v is Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function equal(a:any,b:any):boolean{
 if(Object.is(a,b))return true;
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>equal(v,b[i]));
 if(object(a)&&object(b)){const keys=[...new Set([...Object.keys(a),...Object.keys(b)])];return keys.every(k=>equal(a[k],b[k]));}
 return false;
}
const labels:Record<string,string>={due:'due date',date:'invoice date',number:'invoice number',notes:'notes and terms',deletedAt:'Trash status',payments:'payment history',items:'line items',showDiscount:'discount visibility',numbering:'numbering settings'};
function conflict(path:string[],label?:string):never{
 const field=label||labels[path.at(-1)||'']||'invoice details';
 throw Error(`Another tab changed the same ${field}. Your edits are still in this form. Review the latest invoice in a separate tab before saving.`);
}
function merge(base:any,mine:any,latest:any,path:string[]):any{
 if(equal(mine,base))return latest;
 if(equal(latest,base)||equal(mine,latest))return mine;
 if(path.length===1&&path[0]==='next'&&typeof mine==='number'&&typeof latest==='number')return Math.max(mine,latest);
 if(path.length===1&&['invoices','clients','catalog'].includes(path[0])&&[base,mine,latest].every(Array.isArray)){
  const index=(items:any[])=>new Map(items.map(x=>[x.id,x]));
  const b=index(base),m=index(mine),r=index(latest);
  const ids=[...new Set([...mine.filter((x:any)=>!b.has(x.id)).map((x:any)=>x.id),...latest.map((x:any)=>x.id),...mine.map((x:any)=>x.id),...base.map((x:any)=>x.id)])];
  return ids.map(id=>merge(b.get(id),m.get(id),r.get(id),[...path,id])).filter(x=>x!==undefined);
 }
 if(object(base)&&object(mine)&&object(latest)){
  if(path[0]==='invoices'&&path.length===2){
   if(!equal(mine.deletedAt,base.deletedAt)||!equal(latest.deletedAt,base.deletedAt))conflict(path,'invoice Trash status');
   // Related billing fields stay atomic; only independent edits are combined.
   for(const [label,fields] of [
    ['amounts or payments',['currency','items','discount','tax','payments']],
    ['client details',['clientId','clientName','clientEmail','clientAddress','vendorNumber']]
   ] as const){
    const group=(v:any)=>fields.map(k=>v[k]);
    if(!equal(group(mine),group(base))&&!equal(group(latest),group(base))&&!equal(group(mine),group(latest)))conflict(path,label);
   }
  }
  const keys=[...new Set([...Object.keys(base),...Object.keys(mine),...Object.keys(latest)])];
  return Object.fromEntries(keys.map(k=>[k,merge(base[k],mine[k],latest[k],[...path,k])]));
 }
 return conflict(path);
}
/** Apply only this tab's edits, retaining unrelated newer records and fields. */
export function mergeInvoiceState(base:any,mine:any,latest:any){
 const combined=merge(base,mine,latest,[]);
 const numbers=new Set<string>();
 for(const invoice of combined.invoices){
  const number=invoice.number.trim().toLowerCase();
  if(numbers.has(number))throw Error('Another tab used this invoice number. Your edits are still here; review the latest invoice numbers before saving.');
  numbers.add(number);
 }
 return combined;
}
async function body(response:Response){return response.json().catch(()=>null);}
/** A 409 refreshes the revision and safely rebases the original edits, at most twice. */
export async function saveInvoiceState(base:Snapshot,next:any,fetcher:Fetcher=fetch):Promise<Snapshot>{
 let data=next,revision=base.revision;
 for(let attempt=0;attempt<3;attempt++){
  const response=await fetcher('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,data})});
  const result=await body(response);
  if(response.ok){
   if(!Number.isInteger(result?.revision))throw Error('Unable to confirm the save. Your edits are still here; try again.');
   return {revision:result.revision,data:result.data??data};
  }
  if(response.status!==409)throw Error(typeof result?.error==='string'?result.error:'Invoices could not be saved. Your edits are still here; try again.');
  if(attempt===2)break;
  const refresh=await fetcher('/api/state',{cache:'no-store'}),latest=await body(refresh);
  if(!refresh.ok||!Number.isInteger(latest?.revision)||!latest?.data)throw Error('Unable to load the latest invoices. Your edits are still here; try again.');
  data=mergeInvoiceState(base.data,next,latest.data);revision=latest.revision;
 }
 throw Error('Invoices are still being updated in another tab. Your edits are still here; try saving again.');
}
