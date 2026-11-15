import {test,mock,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';

// Run the actual API handlers against a storage double; no production writes.
const root=resolve(import.meta.dirname,'..');
const temporary=mkdtempSync(join(root,'.test-'));
after(()=>rmSync(temporary,{recursive:true,force:true}));
const modules=[['lib/invoice.ts','invoice'],['lib/catalog.ts','catalog'],['lib/state.ts','state'],['app/api/state/route.ts','route']];
for(const [path,name] of modules){
 let source=readFileSync(join(root,path),'utf8');
 source=source.replaceAll("'./invoice'","'./invoice.mjs'").replaceAll("'./catalog'","'./catalog.mjs'").replaceAll("'../../../lib/state'","'./state.mjs'");
 writeFileSync(join(temporary,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
let record=null,etag=0,writes=0;
class Conflict extends Error{}
mock.module('@vercel/blob',{namedExports:{
 BlobPreconditionFailedError:Conflict,
 get:async(path,options)=>{
  assert.equal(options.access,'private');assert.equal(options.useCache,false);
  if(!record)return null;
  return {statusCode:200,stream:new Blob([JSON.stringify(record)]).stream(),blob:{etag:String(etag)}};
 },
 put:async(path,body,options)=>{
  assert.equal(options.access,'private');
  if(record&&(options.allowOverwrite===false||options.ifMatch!==String(etag)))throw new Conflict();
  record=JSON.parse(body);etag++;writes++;return {etag:String(etag)};
 }
}});
delete process.env.MEC_INVOICE_MIGRATION;
const {GET,PUT}=await import(pathToFileURL(join(temporary,'route.mjs')));
const {emptyState}=await import(pathToFileURL(join(temporary,'state.mjs')));
const {totals,copyInvoice,nextInvoiceNumber}=await import(pathToFileURL(join(temporary,'invoice.mjs')));
const request=(body,headers={})=>new Request('https://finance.test/api/state',{method:'PUT',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('records persist, stale/concurrent changes are rejected, bad and cross-site writes fail',async()=>{
 const first=await GET();assert.equal(first.headers.get('Cache-Control'),'private, no-store');
 assert.deepEqual(await first.json(),{revision:0,data:emptyState});assert.equal(writes,0);
 const data={...emptyState,company:{...emptyState.company,name:'Example business'}};
 assert.equal((await PUT(request({revision:0,data}))).status,200);
 assert.equal((await (await GET()).json()).data.company.name,'Example business');
 assert.equal((await PUT(request({revision:0,data}))).status,409);
 const concurrent=await Promise.all([PUT(request({revision:1,data})),PUT(request({revision:1,data}))]);
 assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);
 assert.equal((await PUT(request({revision:2,data:{}}))).status,400);
 assert.equal((await PUT(request({revision:2,data},{'sec-fetch-site':'cross-site'}))).status,403);
});
test('hidden discounts still affect totals; copies get new numbers and cleared payments',()=>{
 const invoice={id:'sample',number:'MECInv-080',currency:'NGN',items:[{description:'Service',qty:2,rate:1000}],discount:200,showDiscount:false,tax:10,payments:[{amount:100}],due:'2026-11-20'};
 assert.equal(totals(invoice).total,1980);
 assert.equal(nextInvoiceNumber([invoice],1,undefined,4),'MECInv-084');
 const copy=copyInvoice(invoice,[invoice],1,'2026-11-15');
 assert.equal(copy.number,'MECInv-084');assert.notEqual(copy.id,invoice.id);assert.equal(copy.due,'');assert.deepEqual(copy.payments,[]);assert.equal(copy.showDiscount,false);assert.equal(copy.discount,200);
});
