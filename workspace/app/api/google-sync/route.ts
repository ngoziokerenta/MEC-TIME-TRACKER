import {assessmentSource} from '../../../lib/assessment-storage';
import {json,trustedWrite} from '../../../lib/storage';
export const dynamic='force-dynamic';
export async function GET(){
 if(process.env.MEC_ASSESSMENT_SYNC_ENABLED!=='true')return json({ready:false,configured:false,connected:false,lastSyncAt:null,sheetName:null,cohort:null,responseCount:0,migrationPending:true});
 try{const source=await assessmentSource(),row=source.connection;return json({ready:source.ready,configured:!!row?.enabled,connected:!!row?.enabled&&!!row?.last_sync_at,lastSyncAt:row?.last_sync_at??null,sheetName:row?.sheet_name??null,cohort:row?.cohort??null,responseCount:row?.last_count??0})}
 catch{return json({error:'Could not read the Google Forms connection status.'},503)}
}
export async function POST(request:Request){
 if(!trustedWrite(request))return json({error:'Invalid request origin.'},403);
 if(process.env.MEC_ASSESSMENT_SYNC_ENABLED!=='true')return json({error:'The existing assessment connection has not been transferred yet.'},409);
 try{return json(await assessmentSource('connect'))}catch{return json({error:'Could not prepare the Google Forms connection.'},503)}
}
export async function DELETE(request:Request){
 if(!trustedWrite(request))return json({error:'Invalid request origin.'},403);
 if(process.env.MEC_ASSESSMENT_SYNC_ENABLED!=='true')return json({error:'Manage the existing connection in the original Assessment Hub until its transfer is approved.'},409);
 try{return json(await assessmentSource('disconnect'))}catch{return json({error:'Could not disconnect Google Forms.'},503)}
}
