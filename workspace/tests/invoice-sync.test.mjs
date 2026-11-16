import {test,after,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mergeInvoiceState,saveInvoiceState} from '../lib/invoice-sync.ts';
import {normalizeInvoice,totals,invoiceStatus,invoiceDisplayAmounts} from '../lib/invoice.ts';

const invoice={id:'invoice-a',number:'TEST-001',clientId:'test-client',clientName:'Example Client',clientEmail:'',clientAddress:'',vendorNumber:'',date:'2026-11-01',due:'2026-11-10',currency:'NGN',items:[{description:'Example service',qty:1,rate:1000}],discount:100,showDiscount:false,tax:7.5,payments:[],draft:false,notes:'Original notes'};
const state=()=>({company:{name:'Example business',email:'',address:'',taxId:'',bank:'',account:'',accountName:'',terms:''},numbering:{automatic:true,interval:4},catalog:[],clients:[{id:'test-client',name:'Example Client',email:'',address:''}],invoices:[structuredClone(invoice)],next:5});
const change=(data,patch)=>({...data,invoices:data.invoices.map(i=>i.id===invoice.id?{...i,...patch}:i)});
const response=(data,status=200)=>Response.json(data,{status});

test('clearing due date recovers from a stale revision and preserves newer payments and other invoices',async()=>{
 const base=state(),mine=change(base,{due:''});
 const latest=change(base,{notes:'Notes saved by another tab',payments:[{amount:100,date:'2026-11-02',reference:'Received'}]});
 latest.invoices.push({...invoice,id:'invoice-b',number:'TEST-005'});latest.next=9;
 let puts=0;
 const saved=await saveInvoiceState({revision:1,data:base},mine,async(url,options)=>{
  if(options?.method!=='PUT')return response({revision:2,data:latest});
  if(++puts===1)return response({error:'Invoices changed on another device.'},409);
  const body=JSON.parse(options.body);assert.equal(body.revision,2);
  assert.equal(body.data.invoices[0].due,'');assert.deepEqual(body.data.invoices[0].payments,latest.invoices[0].payments);
  assert.equal(body.data.invoices[0].notes,latest.invoices[0].notes);assert.equal(body.data.invoices.length,2);assert.equal(body.data.next,9);
  return response({revision:3,data:body.data});
 });
 assert.equal(puts,2);assert.equal(saved.revision,3);assert.equal(saved.data.invoices[0].due,'');
 assert.equal(totals(saved.data.invoices[0]).total,totals(invoice).total);
 assert.equal(base.invoices[0].due,'2026-11-10');assert.equal(mine.invoices[0].due,'');
});

test('same-field changes stay in the form and never overwrite the other tab',async()=>{
 const base=state(),mine=change(base,{due:''}),latest=change(base,{due:'2026-12-01'});let puts=0;
 await assert.rejects(()=>saveInvoiceState({revision:1,data:base},mine,async(url,options)=>{
  if(options?.method==='PUT'){puts++;return response({error:'Conflict'},409)}
  return response({revision:2,data:latest});
 }),/same due date/);
 assert.equal(puts,1);assert.equal(mine.invoices[0].due,'');assert.equal(latest.invoices[0].due,'2026-12-01');
});

test('related amount changes, Trash changes, and duplicate numbers are not silently merged',()=>{
 const base=state();
 assert.throws(()=>mergeInvoiceState(base,change(base,{discount:200}),change(base,{items:[{description:'Service',qty:1,rate:2000}]})),/amounts or payments/);
 assert.throws(()=>mergeInvoiceState(base,change(base,{due:''}),change(base,{deletedAt:'2026-11-16T00:00:00.000Z'})),/Trash status/);
 const mine={...base,invoices:[...base.invoices,{...invoice,id:'mine',number:'TEST-005'}]};
 const latest={...base,invoices:[...base.invoices,{...invoice,id:'theirs',number:'TEST-005'}]};
 assert.throws(()=>mergeInvoiceState(base,mine,latest),/used this invoice number/);
});

test('errors are readable, drafts survive a failed refresh, and retries are bounded',async()=>{
 const base=state(),mine=change(base,{due:''});
 await assert.rejects(()=>saveInvoiceState({revision:1,data:base},mine,async()=>response({error:'Check the amount.'},400)),e=>e.message==='Check the amount.');
 await assert.rejects(()=>saveInvoiceState({revision:1,data:base},mine,async(url,options)=>options?.method==='PUT'?response({},409):response({},503)),/edits are still here/);
 let puts=0;
 await assert.rejects(()=>saveInvoiceState({revision:1,data:base},mine,async(url,options)=>{
  if(options?.method==='PUT'){puts++;return response({},409)}return response({revision:puts+1,data:base});
 }),/try saving again/);
 assert.equal(puts,3);assert.equal(mine.invoices[0].due,'');
});

const root=resolve(import.meta.dirname,'..'),temporary=mkdtempSync(join(root,'.test-invoice-'));
after(()=>rmSync(temporary,{recursive:true,force:true}));
function compile(path,name){
 let source=readFileSync(join(root,path),'utf8');
 source=source.replaceAll("'./invoice'","'./invoice.mjs'").replaceAll("'./catalog'","'./catalog.mjs'").replaceAll("'../../../lib/state'","'./state.mjs'").replaceAll("'../../../lib/storage'","'./storage.mjs'").replaceAll("'../lib/invoice'","'./invoice.mjs'").replaceAll("'./mec-brand'","'./mec-brand.mjs'");
 writeFileSync(join(temporary,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);
}
for(const [path,name] of [['lib/invoice.ts','invoice'],['lib/catalog.ts','catalog'],['lib/state.ts','state'],['lib/storage.ts','storage'],['app/api/state/route.ts','route'],['components/mec-brand.tsx','mec-brand'],['components/invoice-document.tsx','document']])compile(path,name);
const {default:InvoiceDocument}=await import(pathToFileURL(join(temporary,'document.mjs')));

test('an empty due date saves as empty, has no overdue status, and is omitted from the printed invoice',()=>{
 const cleared=normalizeInvoice({...invoice,due:''});
 assert.equal(cleared.due,'');assert.equal(invoiceStatus(cleared,'2026-12-01'),'Unpaid');
 assert.equal(totals(cleared).total,967.5);
 const html=renderToStaticMarkup(React.createElement(InvoiceDocument,{invoice:cleared,company:state().company}));
 assert(!html.includes('DUE DATE'));assert(!html.includes('>Discount<'));assert(html.includes('TOTAL PAYABLE'));assert(html.includes('/mec-logo.png'));assert(!html.includes('mec-site-mark'));
});

let stored=state(),revision=2,etag=1;
stored=change(stored,{notes:'Newer saved notes'});
class Conflict extends Error{}
mock.module('@vercel/blob',{namedExports:{BlobPreconditionFailedError:Conflict,
 get:async(path,options)=>{assert.equal(options.access,'private');assert.equal(options.useCache,false);if(path.endsWith('workspace/records.json'))return null;return {statusCode:200,stream:new Blob([JSON.stringify({revision,data:stored})]).stream(),blob:{etag:options.headers?.['Accept-Encoding']==='identity'?String(etag):'W/'+String(etag)}};},
 put:async(path,body,options)=>{assert.equal(options.access,'private');if(options.ifMatch!==String(etag))throw new Conflict();const next=JSON.parse(body);stored=next.data;revision=next.revision;etag++;return {etag:String(etag)};}
}});
const api=await import(pathToFileURL(join(temporary,'route.mjs')));
test('actual API handlers save compressed-size records with a strong ETag and persist a cleared due date',async()=>{
 const base=state(),mine=change(base,{due:''});
 const result=await saveInvoiceState({revision:1,data:base},mine,async(url,options)=>options?.method==='PUT'?api.PUT(new Request('https://example.test/api/state',options)):api.GET());
 assert.equal(result.revision,3);assert.equal(stored.invoices[0].due,'');assert.equal(stored.invoices[0].notes,'Newer saved notes');
 const reread=await (await api.GET()).json();assert.equal(reread.data.invoices[0].due,'');assert.equal(reread.revision,3);
});


test('hidden discount is included in printed item amounts and subtotal without changing VAT or final total',()=>{
 const sample={...invoice,items:[{description:'Coaching',qty:5,rate:250000}],discount:250000,tax:7.5,showDiscount:false};
 const before=structuredClone(sample),display=invoiceDisplayAmounts(sample);
 assert.deepEqual(display.items,[1000000]);assert.equal(display.subtotal,1000000);
 assert.equal(totals(sample).tax,75000);assert.equal(totals(sample).total,1075000);
 const hidden=renderToStaticMarkup(React.createElement(InvoiceDocument,{invoice:sample,company:state().company}));
 assert(hidden.includes('1,000,000.00'));assert(!hidden.includes('1,250,000.00'));assert(!hidden.includes('>Discount<'));assert(hidden.includes('1,075,000.00'));
 const shown=renderToStaticMarkup(React.createElement(InvoiceDocument,{invoice:{...sample,showDiscount:true},company:state().company}));
 assert(shown.includes('1,250,000.00'));assert(shown.includes('>Discount<'));assert(shown.includes('1,075,000.00'));
 assert.deepEqual(sample,before);
});

test('multiple discounted items add up exactly after cent rounding, including zero-price lines',()=>{
 const sample={...invoice,items:[{description:'A',qty:1,rate:1},{description:'B',qty:1,rate:1},{description:'C',qty:1,rate:1},{description:'Free',qty:1,rate:0}],discount:1,showDiscount:false,tax:0};
 const display=invoiceDisplayAmounts(sample);
 assert.deepEqual(display.items,[0.67,0.67,0.66,0]);assert.equal(display.items.reduce((sum,value)=>sum+Math.round(value*100),0),200);assert.equal(display.subtotal,2);assert.equal(totals(sample).total,2);
 const legacy={...sample,showDiscount:undefined,includeDiscount:false};assert.deepEqual(invoiceDisplayAmounts(legacy).items,display.items);
 assert.deepEqual(invoiceDisplayAmounts({...sample,discount:0}).items,[1,1,1,0]);
 assert.deepEqual(invoiceDisplayAmounts({...sample,discount:3}).items,[0,0,0,0]);
});
