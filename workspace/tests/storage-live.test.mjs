import {test} from 'node:test';
import assert from 'node:assert/strict';
import {del} from '@vercel/blob';
import {readRecord,writeRecord,BlobPreconditionFailedError} from '../lib/storage.ts';

test('large real private records retain a strong write token and reject genuine stale writes',{
 skip:!process.env.BLOB_READ_WRITE_TOKEN&&!process.env.BLOB_STORE_ID
},async()=>{
 const path='verification/save-'+crypto.randomUUID()+'.json';
 const prefix=process.env.VERCEL_ENV==='production'?'':'preview/';
 const value={revision:1,notes:'Fictional storage verification. '.repeat(5000)};
 try{
  await writeRecord(path,value,null);
  const initial=await readRecord(path);assert.deepEqual(initial.value,value);assert(!initial.etag.startsWith('W/'));
  await writeRecord(path,{...value,revision:2},initial.etag);
  const saved=await readRecord(path);assert.equal(saved.value.revision,2);
  await assert.rejects(()=>writeRecord(path,{...value,revision:3},initial.etag),BlobPreconditionFailedError);
 }finally{await del(prefix+path)}
});
