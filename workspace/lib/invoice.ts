import {z} from 'zod';

export const money=(n:number,c='NGN')=>new Intl.NumberFormat('en-NG',{style:'currency',currency:c,minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
export const formatNumericInput=(value:string|number)=>{const [whole,fraction]=String(value??'').replaceAll(',','').split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);};
export const numericValue=(v:unknown)=>Number(String(v??'').replaceAll(',',''));
export const numberingSchema=z.object({automatic:z.boolean().default(true),interval:z.number().int().min(1).max(1000000).default(4)});
export type NumberingSettings=z.infer<typeof numberingSchema>;
export const defaultNumbering:NumberingSettings={automatic:true,interval:4};
export function nextInvoiceNumber(invoices:any[],next:number,example?:string,interval=4){
 const step=numberingSchema.parse({interval}).interval;
 const pattern=example||invoices.find(i=>/\d+$/.test(i.number))?.number||'MECInv-000';
 const match=pattern.match(/^(.*?)(\d+)$/),prefix=match?.[1]||'MECInv-',width=match?.[2].length||3;
 const numbers=invoices.map(i=>String(i.number).startsWith(prefix)?String(i.number).slice(prefix.length):'').filter(n=>/^\d+$/.test(n)).map(Number);
 const highest=Math.max(Number(match?.[2]||0),0,...numbers);
 const sequence=highest>0?highest+step:Math.max(1,next);
 return prefix+String(sequence).padStart(width,'0');
}
export function copyInvoice(source:any,invoices:any[],next:number,date:string,numbering:NumberingSettings=defaultNumbering){return {...structuredClone(source),id:crypto.randomUUID(),number:numbering.automatic?nextInvoiceNumber(invoices,next,source.number,numbering.interval):'',date,due:'',payments:[],deletedAt:undefined,draft:true};}
export function prepareInvoiceForSave(edit:any,invoices:any[],next:number,numbering:NumberingSettings){
 const exists=invoices.some(i=>i.id===edit.id);
 let number=String(edit.number??'').trim();
 const duplicate=()=>invoices.some(i=>i.id!==edit.id&&String(i.number).trim().toLowerCase()===number.toLowerCase());
 if(!exists&&numbering.automatic&&(!number||duplicate()))number=nextInvoiceNumber(invoices,next,number||undefined,numbering.interval);
 if(number&&duplicate())throw Error('That invoice number is already in use. Enter a different number.');
 return normalizeInvoice({...edit,number});
}
export function totals(i:any){const sub=i.items.reduce((a:number,b:any)=>a+Math.round(numericValue(b.qty)*numericValue(b.rate)*100)/100,0);const net=Math.max(0,sub-numericValue(i.discount));const tax=Math.round(net*numericValue(i.tax))/100;const total=Math.round((net+tax)*100)/100;const paid=i.payments.reduce((a:number,b:any)=>a+numericValue(b.amount),0);return {sub,tax,total,paid,balance:Math.max(0,Math.round((total-paid)*100)/100)};}
/** Presentation only: allocate a hidden discount across line totals, to the cent. */
export function invoiceDisplayAmounts(i:any){
 const showDiscount=i.showDiscount??i.includeDiscount??true;
 const cents=i.items.map((item:any)=>Math.round(numericValue(item.qty)*numericValue(item.rate)*100));
 const gross=cents.reduce((sum:number,value:number)=>sum+value,0);
 if(showDiscount||numericValue(i.discount)<=0||gross===0)return {showDiscount,items:cents.map((value:number)=>value/100),subtotal:gross/100};
 const net=Math.max(0,gross-Math.round(numericValue(i.discount)*100));
 const shares=cents.map((value:number,index:number)=>{const exact=value*net/gross;return {index,cents:Math.floor(exact),fraction:exact-Math.floor(exact)};});
 const remainder=net-shares.reduce((sum:number,share:any)=>sum+share.cents,0);
 const ranked=[...shares].sort((a,b)=>b.fraction-a.fraction||a.index-b.index);
 for(let n=0;n<remainder;n++)ranked[n].cents++;
 return {showDiscount,items:shares.map((share:any)=>share.cents/100),subtotal:net/100};
}
export const invoiceStatus=(i:any,today:string)=>i.deletedAt?'Trash':i.draft?'Draft':totals(i).balance===0?'Paid':i.due&&i.due<today?'Overdue':totals(i).paid>0?'Part paid':'Unpaid';
const item=z.object({catalogItemId:z.string().max(100).optional(),description:z.string().min(1),qty:z.number().positive(),rate:z.number().nonnegative()});
export const invoiceSchema=z.object({id:z.string(),number:z.string().trim().min(1,'Enter an invoice number.').max(100),clientId:z.string().min(1),clientName:z.string().min(1),clientEmail:z.string(),clientAddress:z.string(),vendorNumber:z.string().optional(),includeDiscount:z.boolean().optional(),showDiscount:z.boolean().optional(),deletedAt:z.string().datetime().optional(),date:z.string().min(1),due:z.string().default(''),currency:z.enum(['NGN','USD','GBP','EUR']),items:z.array(item).min(1),discount:z.number().nonnegative(),tax:z.number().min(0).max(100),payments:z.array(z.object({amount:z.number().positive(),date:z.string(),reference:z.string()})),draft:z.boolean(),notes:z.string()}).superRefine((i,ctx)=>{if(i.discount>totals(i).sub)ctx.addIssue({code:'custom',message:'Discount cannot exceed the subtotal.'});if(totals(i).paid>totals(i).total)ctx.addIssue({code:'custom',message:'Invoice total cannot be below payments received.'});});
export function normalizeInvoice(i:any){return invoiceSchema.parse({...i,due:i.due||'',vendorNumber:(i.vendorNumber||'').trim(),discount:numericValue(i.discount),showDiscount:i.showDiscount??i.includeDiscount??true,tax:numericValue(i.tax),items:i.items.map((item:any)=>({...item,qty:numericValue(item.qty),rate:numericValue(item.rate)}))});}

export const trashInvoice=(invoice:any)=>({...invoice,deletedAt:new Date().toISOString()});
export function restoreInvoice(invoice:any){const {deletedAt,...rest}=invoice;return rest;}

export function applyCatalogItem(invoice:any,index:number,item:any,canChangeAmount=true){if(canChangeAmount&&item.rate!==null&&item.currency!==invoice.currency)throw Error('Change the invoice currency to '+item.currency+' before using this saved price.');return {...invoice,items:invoice.items.map((row:any,n:number)=>n===index?{...row,catalogItemId:item.id,description:item.name+(item.description?' — '+item.description:''),...(canChangeAmount?{rate:item.rate??''}:{})}:row)};}

