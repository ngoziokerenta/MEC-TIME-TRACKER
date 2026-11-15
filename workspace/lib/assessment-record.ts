export type AssessmentRecord = {
  id:string;name:string;email:string;role:string;date:string;submittedAt:string;
  cohort:string;source:string;answers:(string|number|null)[];openAnswers:string[];
  notes:string;goals:string;reviewed:boolean;
};
export function validAssessment(r:any):r is AssessmentRecord {
  return !!r && typeof r.id==='string' && !!r.id.trim() && r.id.length<=500 &&
    typeof r.name==='string' && !!r.name.trim() && r.name.length<=200 &&
    typeof r.email==='string' && /^\S+@\S+\.\S+$/.test(r.email) && r.email.length<=300 &&
    typeof r.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
    !Number.isNaN(new Date(r.date+'T00:00:00Z').getTime()) && new Date(r.date+'T00:00:00Z').toISOString().slice(0,10)===r.date &&
    typeof r.submittedAt==='string' && !!r.submittedAt.trim() && r.submittedAt.length<=200 &&
    typeof r.source==='string' && r.source.length<=500 &&
    Array.isArray(r.answers) && r.answers.length===50 && r.answers.every((v:unknown)=>(typeof v==='number'||typeof v==='string'||v===null)&&String(v??'').length<=200) &&
    Array.isArray(r.openAnswers) && r.openAnswers.length===5 && r.openAnswers.every((v:unknown)=>typeof v==='string'&&v.length<=20000) &&
    typeof r.notes==='string' && r.notes.length<=30000 && typeof r.goals==='string' && r.goals.length<=10000 &&
    typeof r.reviewed==='boolean' && typeof r.role==='string' && r.role.length<=500 && typeof r.cohort==='string' && r.cohort.length<=300;
}
