import {numericAnswer} from './scoring.mjs';

export function canonicalTimestamp(value){
  const text=String(value??'').trim();
  const legacy=text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)(?:\s+[A-Za-z]+)?$/i);
  if(legacy){let hour=Number(legacy[4])%12;if(legacy[7].toLowerCase()==='pm')hour+=12;return legacy[1]+'-'+legacy[2].padStart(2,'0')+'-'+legacy[3].padStart(2,'0')+'T'+String(hour).padStart(2,'0')+':'+legacy[5]+':'+legacy[6];}
  return text;
}
export function assessmentIdentity(record){return record.email.trim().toLowerCase()+'|'+canonicalTimestamp(record.submittedAt);}
export function findBaselineAssessment(incoming,baseline){
  // The original workbook truncated sub-second Google timestamps, while the
  // Google export rounds them. This exception applies only to the fixed seed,
  // with matching answers/comments; new reassessments use exact timestamps.
  const time=new Date(canonicalTimestamp(incoming.submittedAt)).getTime();
  return baseline.find(old=>old.email.toLowerCase()===incoming.email.toLowerCase()&&
    Math.abs(new Date(canonicalTimestamp(old.submittedAt)).getTime()-time)<=1000&&
    old.answers.every((answer,i)=>numericAnswer(answer,i+1)===numericAnswer(incoming.answers[i],i+1))&&
    old.openAnswers.every((answer,i)=>answer.trim()===incoming.openAnswers[i].trim()));
}
export function mergeSyncedRecord(incoming,existing){
  return {...incoming,id:existing?.id??incoming.id,source:'Google Forms (automatic)',
    notes:existing?.notes??incoming.notes,goals:existing?.goals??incoming.goals,reviewed:existing?.reviewed??incoming.reviewed};
}
// Preserve coach edits atomically, including an edit saved while sync was running.
export const SYNC_UPSERT_SQL = `INSERT INTO assessments (id,payload,updated_at,deleted) VALUES (?,?,?,0)
ON CONFLICT(id) DO UPDATE SET payload=json_set(excluded.payload,
'$.notes',COALESCE(json_extract(assessments.payload,'$.notes'),''),
'$.goals',COALESCE(json_extract(assessments.payload,'$.goals'),''),
'$.reviewed',json(CASE WHEN json_extract(assessments.payload,'$.reviewed') THEN 'true' ELSE 'false' END)),
updated_at=excluded.updated_at WHERE assessments.deleted=0`;
