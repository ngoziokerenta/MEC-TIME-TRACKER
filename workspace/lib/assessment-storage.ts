import {createHash} from 'node:crypto';
import {readRecord,writeRecord,BlobPreconditionFailedError} from './storage';
import {mergeSyncedRecord} from './google-sync.mjs';

const path='assessments/records.json';
export async function assessmentSource(action?:'connect'|'disconnect'){
 const bearer=process.env.MEC_ASSESSMENT_SOURCE_TOKEN,key=process.env.MEC_ASSESSMENT_SOURCE_KEY;
 if(!bearer||!key)throw Error('The assessment connection is not configured.');
 const response=await fetch('https://mec-assessment-hub.ngoziokerenta.chatgpt.site/api/migration-export',{
  method:action?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(15000),
  headers:{'OAI-Sites-Authorization':'Bearer '+bearer,'x-mec-migration-key':key,...(action?{'Content-Type':'application/json'}:{})},
  ...(action?{body:JSON.stringify({action})}:{})
 });
 if(!response.ok)throw Error('The Google Forms connection could not be reached.');
 return response.json();
}
export async function loadAssessments(sync=true){
 let saved=await readRecord(path);
 if(!sync||process.env.MEC_ASSESSMENT_SYNC_ENABLED!=='true')return saved;
 try{
  const source=await assessmentSource();
  const hash=createHash('sha256').update(JSON.stringify(source.records)).digest('hex');
  if(saved?.value.sourceHash===hash)return saved;
  for(let attempt=0;attempt<2;attempt++){
   const previous=saved?.value||{records:[],sourceIds:[],version:0};
   const incomingIds=new Set(source.records.map((r:any)=>r.id));
   const map=new Map<string,any>(previous.records.filter((r:any)=>!previous.sourceIds?.includes(r.id)||incomingIds.has(r.id)).map((r:any)=>[r.id,r]));
   for(const record of source.records)map.set(record.id,mergeSyncedRecord(record,map.get(record.id)));
   const value={records:[...map.values()],sourceHash:hash,sourceIds:[...incomingIds],version:previous.version+1,connection:source.connection,ready:source.ready};
   try{const blob=await writeRecord(path,value,saved?.etag||null);return {value,etag:blob.etag};}
   catch(error){if(!(error instanceof BlobPreconditionFailedError)||attempt===1)throw error;saved=await readRecord(path);}
  }
 }catch(error){if(!saved)throw error;return {...saved,sourceUnavailable:true};}
 return saved;
}
export async function saveAssessments(records:any[],version:number){
 const saved=await loadAssessments(false);
 if(version!==(saved?.value.version||0))return null;
 const value=saved?.value||{records:[],sourceIds:[],version:0};
 const map=new Map<string,any>(value.records.map((r:any)=>[r.id,r]));
 for(const record of records)map.set(record.id,record);
 const next={...value,records:[...map.values()],version:version+1};
 await writeRecord(path,next,saved?.etag||null);return next;
}
