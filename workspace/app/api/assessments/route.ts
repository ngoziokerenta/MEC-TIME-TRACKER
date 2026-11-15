import {loadAssessments,saveAssessments} from '../../../lib/assessment-storage';
import {validAssessment} from '../../../lib/assessment-record';
import {json,trustedWrite,BlobPreconditionFailedError} from '../../../lib/storage';
export const dynamic='force-dynamic';
export async function GET(){
 try{const saved=await loadAssessments();return json({records:saved?.value.records||[],version:saved?.value.version||0,storage:'saved',migrationPending:process.env.MEC_ASSESSMENT_SYNC_ENABLED!=='true',sourceUnavailable:!!saved&&'sourceUnavailable' in saved})}
 catch{return json({error:'Assessments could not be loaded. Please retry.'},503)}
}
export async function POST(request:Request){
 if(!trustedWrite(request))return json({error:'Invalid request origin.'},403);
 try{
  const body=await request.json(),records=body.records;
  if(!Number.isInteger(body.version)||!Array.isArray(records)||records.length<1||records.length>200||records.some(r=>!validAssessment(r))||new Set(records.map(r=>r.id)).size!==records.length)return json({error:'Check the assessment fields and try again.'},400);
  const saved=await saveAssessments(records,body.version);
  if(!saved)return json({error:'Assessments changed on another device. Refresh before saving. Your notes remain in the form.'},409);
  return json({saved:records.length,version:saved.version,updatedAt:new Date().toISOString()});
 }catch(error){
  if(error instanceof BlobPreconditionFailedError)return json({error:'Assessments changed on another device. Refresh before saving.'},409);
  return json({error:'Assessments could not be saved. Your changes remain in the form.'},503);
 }
}
