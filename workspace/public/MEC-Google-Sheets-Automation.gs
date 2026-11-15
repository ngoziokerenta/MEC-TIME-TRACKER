
// MEC Google Forms scoring automation.
// Install in Extensions > Apps Script in the linked response spreadsheet.
// Keep the response sheet untouched. Results and drafts have separate tabs.
// After Connect assessment app, responses transfer to your private MEC app.
// Connection credentials are stored only in Script Properties.

function onOpen() {
  SpreadsheetApp.getUi().createMenu('MEC Assessment')
    .addItem('Set up automation','setupMEC')
    .addItem('Refresh scores and reports','refreshMEC')
    .addSeparator()
    .addItem('Connect assessment app','connectMECApp')
    .addItem('Transfer responses to app now','syncMECAppNow')
    .addItem('Check app connection','mecConnectionStatus')
    .addToUi();
}

function setupMEC() {
  const ss=SpreadsheetApp.getActive(),sheet=ss.getActiveSheet(),ui=SpreadsheetApp.getUi();
  if(/^MEC /.test(sheet.getName())) throw new Error('Select the original response tab before setup.');
  const confirm=ui.alert('Set up MEC scoring', 'Use "'+sheet.getName()+'" as the source response sheet? The original responses will not be changed.',ui.ButtonSet.YES_NO);
  if(confirm!==ui.Button.YES)return;
  let ordered=false;
  const sourceRows=mecSourceRows(ss,sheet);
  try { resolveColumns(sourceRows[0]||[],false); }
  catch(error) {
    if(!String(error.message).includes('Question columns could not be identified'))throw error;
    const order=ui.alert('Confirm question columns','If headers are not Q1–Q50, the order must be: Timestamp, Email Address, Full Name, Job Title, 50 questions in order, then 5 open-ended questions. Does your sheet use exactly this order?',ui.ButtonSet.YES_NO);
    if(order!==ui.Button.YES)return;
    ordered=true;
  }
  // Validate all rows before installing a trigger or writing output tabs.
  if(sourceRows.length>1)mapRows(sourceRows,ordered);
  const cohortPrompt=ui.prompt('Cohort name','Enter the cohort name to use in reports.',ui.ButtonSet.OK_CANCEL);
  if(cohortPrompt.getSelectedButton()!==ui.Button.OK)return;
  const cohort=cohortPrompt.getResponseText().trim()||'Unassigned cohort';
  PropertiesService.getScriptProperties().setProperties({MEC_SPREADSHEET_ID:ss.getId(),MEC_RESPONSE_SHEET:sheet.getName(),MEC_ORDERED:String(ordered),MEC_COHORT:cohort});
  refreshMEC();
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='mecFormSubmit').forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('mecFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ui.alert('MEC scoring is ready','Existing responses have been scored. Future form submissions will update MEC Results and MEC Reports automatically. To connect the assessment app, choose MEC Assessment > Connect assessment app and paste the connection code from the app.',ui.ButtonSet.OK);
}

function mecFormSubmit(e) {
  const p=PropertiesService.getScriptProperties();
  if(e && e.range && e.range.getSheet().getName()!==p.getProperty('MEC_RESPONSE_SHEET'))return;
  refreshMEC();
}

function mecSafeCell(value){const text=String(value==null?'':value);return /^[=+\-@\t\r]/.test(text)?"'"+text:text;}

function mecSourceRows(ss,source) {
  const range=source.getDataRange(),rows=range.getDisplayValues(),raw=range.getValues();
  if(!rows.length)return [];
  const dateColumn=rows[0].map(norm).findIndex(h=>['timestamp','date','assessment date'].includes(h));
  if(dateColumn>=0)for(let i=1;i<rows.length;i++){
    if(raw[i][dateColumn] instanceof Date)rows[i][dateColumn]=Utilities.formatDate(new Date(Math.round(raw[i][dateColumn].getTime()/1000)*1000),ss.getSpreadsheetTimeZone(),"yyyy-MM-dd'T'HH:mm:ss");
  }
  return rows;
}

function refreshMEC() {
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    const p=PropertiesService.getScriptProperties(),id=p.getProperty('MEC_SPREADSHEET_ID');
    if(!id)throw new Error('Run Set up automation first.');
    const ss=SpreadsheetApp.openById(id),source=ss.getSheetByName(p.getProperty('MEC_RESPONSE_SHEET'));
    if(!source)throw new Error('The configured response sheet was renamed or removed. Run setup again.');
    const sourceRows=mecSourceRows(ss,source);
    const records=sourceRows.length<2?[]:mapRows(sourceRows,p.getProperty('MEC_ORDERED')==='true',p.getProperty('MEC_COHORT'));
    const notesSheet=ss.getSheetByName('MEC Coach Notes')||ss.insertSheet('MEC Coach Notes');
    const notesRows=notesSheet.getDataRange().getValues(),notesById=new Map();
    for(let i=1;i<notesRows.length;i++)if(notesRows[i][0])notesById.set(String(notesRows[i][0]),notesRows[i]);
    // Migrate note IDs from the previous timestamp formatter (whole seconds
    // truncated) to the rounded timestamps used by Google CSV/XLSX exports.
    const oldNoteIds=new Map(),rawSource=source.getDataRange().getValues(),columns=resolveColumns(sourceRows[0],p.getProperty('MEC_ORDERED')==='true');
    for(let i=1;i<rawSource.length;i++){
      const date=rawSource[i][columns.date];
      if(!(date instanceof Date))continue;
      const address=String(rawSource[i][columns.email]||'').trim().toLowerCase();
      const oldTime=Utilities.formatDate(date,ss.getSpreadsheetTimeZone(),"yyyy-MM-dd'T'HH:mm:ss");
      const newTime=Utilities.formatDate(new Date(Math.round(date.getTime()/1000)*1000),ss.getSpreadsheetTimeZone(),"yyyy-MM-dd'T'HH:mm:ss");
      if(oldTime!==newTime)oldNoteIds.set('import-'+address+'-'+newTime,'import-'+address+'-'+oldTime);
    }
    const freshNotes=[['Assessment ID','Participant','Coach observations','Agreed development actions','Reviewed (Yes/No)']];
    for(const r of records){const oldId=oldNoteIds.get(r.id),n=notesById.get(r.id)||notesById.get(oldId);if(n){r.notes=String(n[2]||'');r.goals=String(n[3]||'');r.reviewed=String(n[4]).toLowerCase()==='yes';freshNotes.push([r.id,r.name,...n.slice(2,5)]);if(oldId&&!notesById.has(r.id))notesById.delete(oldId);}else freshNotes.push([r.id,r.name,'','','No']);}
    // Keep keyed notes for older records even when source responses are archived.
    const activeIds=new Set(records.map(r=>r.id));for(const [key,n] of notesById)if(!activeIds.has(key))freshNotes.push(n.slice(0,5));
    mecWriteSheet(notesSheet,freshNotes);
    const resultRows=[['Participant','Email','Cohort','Assessment date','Valid answers /50','Growth Mindset /48','Mindset band','Strategic Capability /50','Strategic band','Operational Friction /50','Friction band',...TRAITS.map(t=>t+' /20'),'What Growth Mindset suggests','What Strategic Capability suggests','What Operational Friction suggests','Questions needing attention','Coach reviewed','Scoring version']];
    const reports=[['Participant','Assessment date','Status','Participant assessment report']];
    const coachReviews=[['Participant','Assessment date','Coach only response consistency review']];
    for(const r of records){const s=calculate(r.answers),e=explanations(s);resultRows.push([r.name,r.email,r.cohort,r.date,s.answered,s.mindset===null?'Incomplete':s.mindset,s.mindsetBand,s.strategic===null?'Incomplete':s.strategic,s.strategicBand,s.friction===null?'Incomplete':s.friction,s.frictionBand,...s.traits.map(v=>v===null?'Incomplete':v),e.mindset,e.strategic,e.friction,s.issues.map(x=>'Q'+x.question+': '+x.reason).join(', '),r.reviewed?'Yes':'No',RULE_VERSION]);reports.push([r.name,r.date,s.complete?'Ready for coach review':'Incomplete assessment',reportText(r,s)]);coachReviews.push([r.name,r.date,coachConsistencyText(s)]);}
    const resultsSheet=ss.getSheetByName('MEC Results')||ss.insertSheet('MEC Results');mecWriteSheet(resultsSheet,resultRows);resultsSheet.setColumnWidth(1,240);resultsSheet.setColumnWidths(17,4,350);
    const reportsSheet=ss.getSheetByName('MEC Reports')||ss.insertSheet('MEC Reports');mecWriteSheet(reportsSheet,reports);reportsSheet.setColumnWidth(1,240);reportsSheet.setColumnWidth(4,850);if(reports.length>1)reportsSheet.setRowHeights(2,reports.length-1,750);
    const coachReviewSheet=ss.getSheetByName('MEC Coach Review')||ss.insertSheet('MEC Coach Review');mecWriteSheet(coachReviewSheet,coachReviews);coachReviewSheet.setColumnWidth(1,240);coachReviewSheet.setColumnWidth(3,850);if(coachReviews.length>1)coachReviewSheet.setRowHeights(2,coachReviews.length-1,750);
    notesSheet.setColumnWidth(1,450);notesSheet.setColumnWidth(2,220);notesSheet.setColumnWidths(3,2,450);
    mecPushToApp(ss,source,records);
  } finally {lock.releaseLock();}
}

function mecWriteSheet(sheet,rows) {
  if(sheet.getMaxRows()<rows.length)sheet.insertRowsAfter(sheet.getMaxRows(),rows.length-sheet.getMaxRows());
  if(sheet.getMaxColumns()<rows[0].length)sheet.insertColumnsAfter(sheet.getMaxColumns(),rows[0].length-sheet.getMaxColumns());
  sheet.clearContents();
  const safe=rows.map(row=>row.map(value=>typeof value==='number'?value:mecSafeCell(value)));
  sheet.getRange(1,1,safe.length,safe[0].length).setValues(safe).setFontFamily('Montserrat').setFontSize(10).setVerticalAlignment('top').setWrap(true);
  sheet.getRange(1,1,1,safe[0].length).setBackground('#60368a').setFontColor('#ffffff').setFontWeight('bold');sheet.setFrozenRows(1);sheet.setRowHeight(1,50);
  if(safe.length>1)sheet.setRowHeights(2,safe.length-1,72);
}

// Transfer is enabled only after the owner pastes a connection code.
// The code is stored in Script Properties, never in this source file.
const MEC_APP_ORIGIN='https://mec-assessment-hub.ngoziokerenta.chatgpt.site';

function connectMECApp(){
  const p=PropertiesService.getScriptProperties(),ui=SpreadsheetApp.getUi();
  if(!p.getProperty('MEC_SPREADSHEET_ID'))throw new Error('Select the response tab and run Set up automation first.');
  const prompt=ui.prompt('Connect assessment app','In the app, open Import & automation and click Copy connection code. Paste that code here.',ui.ButtonSet.OK_CANCEL);
  if(prompt.getSelectedButton()!==ui.Button.OK)return;
  let config;
  try{
    let code=prompt.getResponseText().trim().replace(/^MEC1-/,'');
    while(code.length%4)code+='=';
    config=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(code)).getDataAsString());
  }catch{throw new Error('The connection code was not recognised. Copy a new code from the app.');}
  if(config.version!==1||config.url!==MEC_APP_ORIGIN||typeof config.accessToken!=='string'||!config.accessToken||!/^[a-f0-9]{64}$/.test(config.syncKey))throw new Error('Use a connection code from your MEC assessment app.');
  p.setProperties({MEC_APP_URL:config.url,MEC_APP_ACCESS_TOKEN:config.accessToken,MEC_APP_SYNC_KEY:config.syncKey,MEC_APP_SYNC_PENDING:'true',MEC_APP_DISABLED:'false'});
  mecEnsureSyncTriggers();
  refreshMEC();
  ui.alert('App connected','Existing responses have been transferred. New form submissions will update the spreadsheet and the assessment app automatically. Open the app to see the results.',ui.ButtonSet.OK);
}

function mecEnsureSyncTriggers(){
  const p=PropertiesService.getScriptProperties(),triggers=ScriptApp.getProjectTriggers();
  if(!triggers.some(t=>t.getHandlerFunction()==='mecFormSubmit'))ScriptApp.newTrigger('mecFormSubmit').forSpreadsheet(SpreadsheetApp.openById(p.getProperty('MEC_SPREADSHEET_ID'))).onFormSubmit().create();
  if(!triggers.some(t=>t.getHandlerFunction()==='mecRetryAppSync'))ScriptApp.newTrigger('mecRetryAppSync').timeBased().everyMinutes(5).create();
}

function syncMECAppNow(){
  const p=PropertiesService.getScriptProperties();
  if(!p.getProperty('MEC_APP_SYNC_KEY')||p.getProperty('MEC_APP_DISABLED')==='true')throw new Error('Choose MEC Assessment > Connect assessment app first.');
  p.setProperty('MEC_APP_SYNC_PENDING','true');refreshMEC();
  SpreadsheetApp.getUi().alert('Responses transferred','The assessment app is up to date.',SpreadsheetApp.getUi().ButtonSet.OK);
}

function mecRetryAppSync(){
  const p=PropertiesService.getScriptProperties();
  if(p.getProperty('MEC_APP_SYNC_PENDING')==='true'&&p.getProperty('MEC_APP_DISABLED')!=='true')refreshMEC();
}

function mecConnectionStatus(){
  const p=PropertiesService.getScriptProperties(),ui=SpreadsheetApp.getUi();
  const status=!p.getProperty('MEC_APP_SYNC_KEY')?'App not connected. Choose Connect assessment app.':p.getProperty('MEC_APP_DISABLED')==='true'?'Connection was disconnected or replaced. Copy a new connection code from the app.':'Last successful transfer: '+(p.getProperty('MEC_APP_LAST_SYNC')||'Waiting for first transfer')+(p.getProperty('MEC_APP_SYNC_PENDING')==='true'?'\nA transfer is pending. The script will retry automatically.':'')+(p.getProperty('MEC_APP_LAST_ERROR')?'\n'+p.getProperty('MEC_APP_LAST_ERROR'):'');
  ui.alert('Assessment app connection',status,ui.ButtonSet.OK);
}

function mecPushToApp(ss,source,records){
  const p=PropertiesService.getScriptProperties();
  if(!p.getProperty('MEC_APP_SYNC_KEY')||p.getProperty('MEC_APP_DISABLED')==='true')return;
  p.setProperty('MEC_APP_SYNC_PENDING','true');
  try{
    for(let i=0;i<records.length;){
      let end=Math.min(i+100,records.length),payload;
      while(true){
        payload=JSON.stringify({spreadsheetId:ss.getId(),sheetName:source.getName(),total:records.length,records:records.slice(i,end)});
        if(payload.length<=2800000)break;
        if(end-i<=1)throw new Error('An assessment is too large to transfer. Shorten unusually long written responses.');
        end=i+Math.max(1,Math.floor((end-i)/2));
      }
      const response=UrlFetchApp.fetch(MEC_APP_ORIGIN+'/api/google-sync/ingest',{
        method:'post',contentType:'application/json',followRedirects:false,muteHttpExceptions:true,timeoutSeconds:30,
        headers:{'OAI-Sites-Authorization':'Bearer '+p.getProperty('MEC_APP_ACCESS_TOKEN'),'X-MEC-Sync-Key':p.getProperty('MEC_APP_SYNC_KEY')},
        payload:payload
      });
      const code=response.getResponseCode();let body={};
      try{body=JSON.parse(response.getContentText());}catch{}
      if(code!==200||body.accepted!==end-i){
        if(code===401||code===403){p.setProperties({MEC_APP_DISABLED:'true',MEC_APP_SYNC_PENDING:'false'});}
        // Store only a fixed status message; never credentials or response data.
        throw new Error(code===401||code===403?'The app connection needs to be renewed. Copy a new connection code from the app.':'The app transfer failed (HTTP '+code+'). Your responses remain in Sheets. It will retry automatically.');
      }
      i=end;
    }
    p.setProperties({MEC_APP_LAST_SYNC:new Date().toISOString(),MEC_APP_SYNC_PENDING:'false',MEC_APP_LAST_ERROR:''});
  }catch(error){
    const message=String(error.message||'App transfer failed.');
    p.setProperty('MEC_APP_LAST_ERROR',message.includes('HTTP')||message.includes('renewed')?message:'The app transfer failed. Your responses remain in Sheets. It will retry automatically.');
    throw new Error(p.getProperty('MEC_APP_LAST_ERROR'));
  }
}

const RULE_VERSION = 'MEC 2.2 — coach response consistency review';
const TRAITS = ['Extraversion', 'Agreeableness', 'Conscientiousness', 'Emotional Stability', 'Openness'];
const OPEN_LABELS = ['Greatest challenge or frustration', 'Habit to improve', 'Recent setback', 'Strategic contribution', 'Support needed'];
const TRAIT_GUIDE = {
  Extraversion:{measures:'How readily someone engages socially, communicates outwardly and takes an active presence in groups.',low:'A quieter, more reflective and reserved approach, often preferring time to think and smaller-group interaction.',high:'A more outgoing, expressive and socially energetic approach, often engaging readily and thinking aloud.',strengthsLow:['Thoughtful listening','Comfort with independent work'],watchLow:['May contribute less visibly','May need preparation time before group discussion'],strengthsHigh:['Visible energy and engagement','Ease initiating conversations'],watchHigh:['May speak before fully reflecting','Can leave less space for quieter voices'],developLow:'Prepare one contribution before an important meeting and choose a deliberate moment to share it.',developHigh:'Pause, invite two other perspectives and summarise before adding your own view.'},
  Agreeableness:{measures:'How strongly someone prioritises cooperation, empathy, trust and consideration in relationships.',low:'A more questioning, candid and competitive approach, with greater readiness to challenge ideas.',high:'A more cooperative, considerate and trusting approach, with close attention to relationships.',strengthsLow:['Direct challenge and critical thinking','Willingness to address difficult issues'],watchLow:['Candour may feel blunt','May underestimate relationship impact'],strengthsHigh:['Collaborative relationships','Sensitivity to other people’s needs'],watchHigh:['May avoid necessary disagreement','May agree before testing feasibility'],developLow:'When challenging an idea, name the shared goal and ask a curious question before offering an alternative.',developHigh:'State one concern or boundary clearly before committing, especially when resources are tight.'},
  Conscientiousness:{measures:'How strongly someone tends to organise, plan, follow through and work with care toward goals.',low:'A more flexible, spontaneous and adaptable approach, often responding in the moment rather than relying on detailed structure.',high:'A more organised, dependable and planful approach, often valuing standards, preparation and completion.',strengthsLow:['Flexibility when circumstances change','Comfort improvising'],watchLow:['Follow-through may become inconsistent','Details can be missed without structure'],strengthsHigh:['Reliable follow-through','Strong planning and attention to standards'],watchHigh:['Can over-plan or become exacting','May find sudden change frustrating'],developLow:'Use one visible weekly priority list with owners, deadlines and a short end-of-week review.',developHigh:'Define what “good enough” looks like and where flexibility is more valuable than perfection.'},
  'Emotional Stability':{measures:'How steadily someone tends to respond when facing pressure, uncertainty or setbacks.',low:'Greater sensitivity to pressure and emotional signals, with risks and concerns often noticed quickly.',high:'A calmer, more even-tempered response to pressure, with relatively quick recovery during uncertainty.',strengthsLow:['Early awareness of risk or tension','Sensitivity to important concerns'],watchLow:['Worry may consume attention','Pressure can make recovery harder'],strengthsHigh:['Composure under pressure','Ability to recover after setbacks'],watchHigh:['May overlook a situation’s emotional weight','Can appear unaffected when others need acknowledgement'],developLow:'Identify an early pressure signal and pair it with a specific reset routine, support request or decision checkpoint.',developHigh:'Check how others are experiencing the situation and acknowledge its impact before moving to solutions.'},
  Openness:{measures:'How strongly someone seeks new ideas, explores possibilities and engages with complexity and change.',low:'A more practical, familiar and implementation-focused approach, often favouring proven methods and concrete information.',high:'A more curious, imaginative and exploratory approach, often enjoying new ideas and alternative perspectives.',strengthsLow:['Practical focus','Preference for tested methods'],watchLow:['Novel ideas may be dismissed quickly','May keep familiar methods after conditions change'],strengthsHigh:['Curiosity and idea generation','Comfort considering new possibilities'],watchHigh:['Can generate more options than can be executed','May lose interest in routine implementation'],developLow:'Before rejecting a new idea, identify one small, low-risk experiment that would provide useful evidence.',developHigh:'Choose one promising idea, define its practical value and convert it into a small next step with a deadline.'}
};
const FIVE = {'strongly disagree':1,disagree:2,neutral:3,agree:4,'strongly agree':5,never:1,rarely:2,sometimes:3,often:4,always:5};
const SIX = {'disagree a lot':1,disagree:2,'disagree a little':3,'agree a little':4,agree:5,'agree a lot':6};
function numericAnswer(value, question) {
  const max = question >= 21 && question <= 28 ? 6 : 5;
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim().replace(/\s+/g, ' ').toLowerCase();
  if (/^\d+(\.0+)?$/.test(text)) { const n = Number(text); return Number.isInteger(n) && n >= 1 && n <= max ? n : null; }
  const table=max===6?SIX:FIVE;
  return Object.prototype.hasOwnProperty.call(table,text)?table[text]:null;
}
function mindsetBand(x) { return x===null ? 'Incomplete' : x>=41 ? 'Strong Growth' : x>=33 ? 'Growth-Leaning' : x>=25 ? 'Mixed Mindset' : x>=17 ? 'Fixed-Leaning' : 'Strong Fixed'; }
function strategicBand(x) { return x===null ? 'Incomplete' : x>=40 ? 'Highly Strategic' : x>=30 ? 'Developing Strategic' : x>=20 ? 'Operationally Focused' : 'Reactive Execution'; }
function frictionBand(x) { return x===null ? 'Incomplete' : x>=40 ? 'High Friction' : x>=30 ? 'Elevated Friction' : x>=20 ? 'Typical Friction' : 'Low Friction'; }
function traitBand(x) { if(x===null)return 'Incomplete';const p=x/20*100;return p>=80 ? 'Very High' : p>=65 ? 'High' : p>=50 ? 'Moderate' : p>=35 ? 'Low' : 'Very Low'; }
function calculate(answers) {
  const numeric=Array.from({length:50},(_,i)=>numericAnswer(answers?.[i],i+1));
  const issues=numeric.flatMap((v,i)=>v===null ? [{question:i+1,reason:answers?.[i]===undefined||answers?.[i]===null||String(answers[i]).trim()==='' ? 'Missing answer' : answers[i]==='Conflicting duplicate answers' ? 'Conflicting duplicate answers' : 'Unrecognised or out-of-range answer'}] : []);
  function total(items) {if(items.some(x=>numeric[(typeof x==='number'?x:x.q)-1]===null))return null;return items.reduce((s,x)=>s+(typeof x==='number'?numeric[x-1]:x.anchor-numeric[x.q-1]),0);}
  const rev=(q,anchor=6)=>({q,anchor});
  const traits=Array.from({length:5},(_,i)=>total([i*4+1,i*4+2,i*4+3,rev(i*4+4)]));
  const mindset=total([21,23,25,27,rev(22,7),rev(24,7),rev(26,7),rev(28,7)]);
  const strategic=total([29,30,31,32,33,34,35,36,rev(37),rev(38)]);
  const friction=total([39,40,41,42,43,44,45,46,47,48]);
  return {numeric,issues,answered:50-issues.length,complete:issues.length===0,traits,mindset,strategic,friction,mindsetBand:mindsetBand(mindset),strategicBand:strategicBand(strategic),frictionBand:frictionBand(friction),strategicDomains:[total([29,33,34,rev(38)]),total([30,32,36,rev(37)]),total([31,35])]};
}
const CONSISTENCY_REVIEW_NOTE = 'Coach only. Q49 and Q50 are response consistency checks, excluded from dimension totals and participant reports. These comparisons prompt clarification; they do not establish dishonesty. No flag does not establish that responses are accurate.';
function responseConsistencyChecks(s) {
  const frequency=['','Never','Rarely','Sometimes','Often','Always'];
  const item=q=>({question:q,wording:FORM_QUESTIONS[q-1],value:s.numeric[q-1],response:s.numeric[q-1]===null?'Unavailable':frequency[s.numeric[q-1]]});
  const definitions=[
    {question:49,title:'Escalation and follow-through',compare:[41,42],summary:'Reports flagging discrepancies promptly alongside difficulty seeking help or communicating challenges. The situations may differ; clarify who receives the flag and what happens afterwards.',prompt:'Walk me through a recent discrepancy. When and to whom did you flag it, what did you do next, and who followed it through to resolution?'},
    {question:50,title:'Knowing when work is complete',compare:[39,40],summary:'Reports knowing when work is complete without re-verification alongside repeated checking or difficulty submitting work. Clarify when each response applies.',prompt:'Describe a recent task you knew was complete and another you rechecked or delayed submitting. What was different, and what told you the work met the required standard?'}
  ];
  return definitions.map(d=>{
    const primary=item(d.question),comparisons=d.compare.map(item);
    // A transparent coaching cue, not a validated threshold for deception.
    // Only frequent responses on both sides prompt review. Lower/neutral and
    // missing answers must never be converted into a positive truthfulness result.
    const opposed=comparisons.filter(x=>primary.value!==null&&primary.value>=4&&x.value!==null&&x.value>=4);
    const missing=[primary,...comparisons].some(x=>x.value===null);
    const status=opposed.length?'review':missing?'incomplete':'no_flag';
    return {...primary,title:d.title,comparisons,status,statusLabel:status==='review'?'Potential inconsistency to explore':status==='incomplete'?'Some responses unavailable':'No direct mismatch flagged',summary:status==='review'?d.summary:status==='incomplete'?'Review the available answers and clarify any missing or invalid responses before interpreting this comparison.':'The selected answers do not trigger this comparison. Ask for examples and consider the work context before drawing conclusions.',prompt:d.prompt,missing,rule:'A review prompt appears when Q'+d.question+' is Often or Always and at least one of Q'+d.compare.join(' or Q')+' is also Often or Always. This is a discussion cue, not a truthfulness test.'};
  });
}
function coachConsistencyText(s) {
  const lines=['RESPONSE CONSISTENCY CHECKS',CONSISTENCY_REVIEW_NOTE,''];
  for(const c of responseConsistencyChecks(s)){
    lines.push(c.title,c.statusLabel,'Q'+c.question+': '+c.wording+' — '+c.response);
    c.comparisons.forEach(x=>lines.push('Compare Q'+x.question+': '+x.wording+' — '+x.response));
    lines.push(c.summary,'Follow-up: '+c.prompt,'Review rule: '+c.rule,'');
  }
  return lines.join('\n');
}
function explanations(s) {
  return {
    mindset:s.mindset===null ? 'Complete Q21–Q28 to interpret this dimension.' : s.mindset>=41 ? 'Responses consistently favour learning and development. Explore how this holds up during difficult tasks and feedback.' : s.mindset>=33 ? 'Responses generally favour growth, with some mixed beliefs. Explore how the participant responds when progress is difficult.' : s.mindset>=25 ? 'Responses combine growth-oriented and fixed beliefs. Explore the situations in which each appears.' : 'Responses lean toward fixed beliefs about ability. Explore what makes learning, mistakes or feedback feel difficult.',
    strategic:s.strategic===null ? 'Complete Q29–Q38 to interpret this dimension.' : s.strategic>=40 ? 'The participant reports connecting work to wider goals and anticipating consequences. Ask for recent examples of these behaviours.' : s.strategic>=30 ? 'The participant reports some strategic habits. Explore how consistently they connect daily work to wider outcomes.' : s.strategic>=20 ? 'Responses place more emphasis on immediate tasks. Explore opportunities to anticipate needs and understand wider business outcomes.' : 'Responses suggest work is often driven by immediate demands. Explore planning, priorities and opportunities for greater initiative.',
    friction:s.friction===null ? 'Complete Q39–Q48 to interpret this dimension.' : s.friction>=40 ? 'Responses indicate frequent workflow difficulties. Explore the specific tasks, conditions and support needs behind them.' : s.friction>=30 ? 'Responses indicate elevated workflow difficulties. Explore where delays, uncertainty or repeated checking occur.' : s.friction>=20 ? 'Responses indicate some workflow difficulties. Explore when these affect delivery or become more frequent.' : 'Responses indicate relatively few workflow difficulties. Explore which habits and working conditions support this.'
  };
}
function coachingPrompts(s) {
  const out=[];
  if(s.mindset!==null)out.push({title:s.mindset<33?'Learning and feedback':'Growth in practice',question:'Tell me about a recent difficult task or piece of feedback. What did you think, do and learn?',action:'Choose one real example and agree a specific learning experiment.'});
  if(s.strategic!==null)out.push({title:s.strategic<30?'From tasks to contribution':'Strategic contribution',question:'How did one recent action support a wider team or business goal? What did you initiate yourself?',action:'Identify one opportunity to anticipate a need and define the outcome.'});
  if(s.friction!==null)out.push({title:s.friction>=30?'Workflow difficulties':'Working habits',question:'Which task takes longer than it should? What causes the delay, and what is within your control?',action:'Test one practical change and review its effect on time, quality or follow-through.'});
  return out;
}
function traitResult(name,score){const g=TRAIT_GUIDE[name],position=score===null?'incomplete':score/20<.5?'low':score/20>=.65?'high':'balanced';return {g,strengths:position==='low'?g.strengthsLow:position==='high'?g.strengthsHigh:[g.strengthsLow[0],g.strengthsHigh[0]],watch:position==='low'?g.watchLow:position==='high'?g.watchHigh:[g.watchLow[0],g.watchHigh[0]],development:position==='low'?g.developLow:position==='high'?g.developHigh:'Choose one lower- or higher-tendency behaviour that would be useful in your current role and practise it in a specific situation.'};}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function reportText(r,s=calculate(r.answers)) {
  const e=explanations(s),l=['MANSFIELD EYRE CONSULTING','Professional Effectiveness Assessment Report','',r.name,r.role,'Assessment date: '+r.date,'','HOW TO READ THIS REPORT','This report describes self-reported tendencies at the time of the assessment. It is not a diagnosis, personality type, ability test or performance rating. Scores are raw questionnaire scores, not population percentiles.',''];
  if(!s.complete)l.push('INCOMPLETE ASSESSMENT — '+s.answered+'/50 valid answers.','');
  l.push('EXECUTIVE SNAPSHOT','Growth Mindset: '+(s.mindset??'Incomplete')+'/48 — '+s.mindsetBand,e.mindset,'','Strategic Capability: '+(s.strategic??'Incomplete')+'/50 — '+s.strategicBand,e.strategic,'','Operational Friction: '+(s.friction??'Incomplete')+'/50 — '+s.frictionBand,e.friction,'','UNDERSTANDING THE BIG FIVE','The Big Five describes five broad work-style tendencies. High and low scores can each bring useful strengths and possible watch-outs; neither end is automatically better.','');
  TRAITS.forEach((name,i)=>{const x=traitResult(name,s.traits[i]),score=s.traits[i];l.push(name.toUpperCase(),score===null?'Result: Incomplete':'Result: '+score+'/20 — '+traitBand(score),'What it measures: '+x.g.measures,'Lower scores may indicate: '+x.g.low,'Higher scores may indicate: '+x.g.high,'Potential strengths: '+x.strengths.join('; '),'Possible watch-outs: '+x.watch.join('; '),'Practical development suggestion: '+x.development,'');});
  if(r.openAnswers?.some(Boolean)){l.push('PARTICIPANT REFLECTIONS');OPEN_LABELS.forEach((name,i)=>{if(r.openAnswers[i])l.push(name+': '+r.openAnswers[i]);});l.push('');}
  l.push('IMPORTANT INTERPRETATION NOTES','Results should be considered alongside role demands, culture, lived experience and specific examples. Higher Operational Friction indicates more reported difficulty. Work-style scores describe tendencies, not fixed traits or capability limits.');
  return l.join('\n');
}
function participantReportHTML(r,s=calculate(r.answers)) {
  const e=explanations(s),cards=TRAITS.map((name,i)=>{const score=s.traits[i],x=traitResult(name,score),pct=score===null?0:score/20*100;return `<section class="page"><div class="kicker">WORK-STYLE PROFILE · ${i+1} OF 5</div><h2>${esc(name)}</h2><div class="score"><b>${score??'—'}</b><span>/20 · ${esc(traitBand(score))}</span><div class="bar"><i style="width:${pct}%"></i></div></div><div class="measure"><h3>What it measures</h3><p>${esc(x.g.measures)}</p></div><div class="columns"><article><h3>Lower scores may indicate</h3><p>${esc(x.g.low)}</p></article><article><h3>Higher scores may indicate</h3><p>${esc(x.g.high)}</p></article></div><div class="columns soft"><article><h3>Potential strengths</h3><ul>${x.strengths.map(v=>`<li>${esc(v)}</li>`).join('')}</ul></article><article><h3>Possible watch-outs</h3><ul>${x.watch.map(v=>`<li>${esc(v)}</li>`).join('')}</ul></article></div><div class="development"><b>Practical development suggestion</b><p>${esc(x.development)}</p></div><p class="fine">This result reflects a self-reported tendency, not a fixed identity or performance judgement.</p></section>`;}).join(''),profile=TRAITS.map((name,i)=>`<div class="row"><div><b>${esc(name)}</b><small>${esc(traitBand(s.traits[i]))}</small></div><div class="bar"><i style="width:${s.traits[i]===null?0:s.traits[i]/20*100}%"></i></div><strong>${s.traits[i]??'—'}/20</strong></div>`).join(''),comments=(r.openAnswers||[]).map((v,i)=>v?`<article class="reflection"><h3>${esc(OPEN_LABELS[i])}</h3><p>${esc(v)}</p></article>`:'').join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>MEC Assessment Report — ${esc(r.name)}</title><meta name="viewport" content="width=device-width"><style>@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap');*{box-sizing:border-box}body{margin:0;background:#eeeaf1;color:#251d29;font:15px/1.65 Montserrat,Arial,sans-serif}.print{position:fixed;z-index:5;right:22px;top:18px;border:0;border-radius:8px;padding:12px 18px;background:#4d256d;color:white;font:600 14px Montserrat;box-shadow:0 4px 18px #0003}.page{width:210mm;min-height:297mm;margin:18px auto;background:white;padding:22mm 20mm;page-break-after:always;box-shadow:0 8px 30px #2d203b22;position:relative}.cover{background:#18141d;color:white;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center}.brand{color:#d8b8ee;font-size:13px;letter-spacing:.18em}.brand b{display:block;color:white;font-size:30px;letter-spacing:.12em}.cover h1{color:white;font-size:40px;max-width:640px;margin:50px 0 18px}.rule{width:75px;height:3px;background:#bd8fde;margin-bottom:32px}.person{font-family:Georgia,serif;font-size:30px}.muted{color:#d1c8d6}.cover footer{position:absolute;bottom:22mm;left:20mm;right:20mm;border-top:1px solid #76528c;padding-top:14px;font-size:11px;color:#d1c8d6}.kicker{font-size:11px;font-weight:700;letter-spacing:.16em;color:#74458e;margin-bottom:12px}h2{font:34px/1.2 Georgia,serif;color:#2b1738;margin:0 0 25px}h3{font-size:14px;color:#512971;margin:0 0 7px}p{margin:0 0 14px}.lead{font-size:18px;line-height:1.75}.notice,.measure{background:#f4eff7;border-left:4px solid #774392;padding:18px 20px;margin:26px 0}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;margin:28px 0}.summary article,.bigfive article,.columns article{border:1px solid #e2d8e7;border-radius:11px;padding:17px}.summary b{display:block;font-size:24px;color:#4d256d}.summary small{display:block;color:#75687a;margin:3px 0 12px}.summary p,.bigfive p,.columns p,.columns li{font-size:12px}.bigfive,.columns{display:grid;grid-template-columns:1fr 1fr;gap:14px}.bigfive article:last-child{grid-column:1/-1}.row{display:grid;grid-template-columns:180px 1fr 65px;gap:18px;align-items:center;padding:15px 0;border-bottom:1px solid #ede7f0}.row small{display:block;color:#74657a}.row strong{text-align:right;color:#512971}.bar{height:9px;border-radius:99px;background:#e9dfed;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,#a375bf,#4d256d)}.score{margin-bottom:25px}.score b{font-size:40px;color:#4d256d}.score span{color:#75687a;margin-left:5px}.score .bar{margin-top:12px}.soft{margin-top:14px}.soft article{background:#faf8fb}.columns ul{padding-left:18px}.development{background:#4d256d;color:white;border-radius:11px;padding:20px 22px;margin-top:18px}.development p{margin:7px 0 0}.fine{font-size:11px;color:#766d79;margin-top:24px}.reflection{padding:16px 0;border-bottom:1px solid #e7deeb}@media print{body{background:white}.print{display:none}.page{margin:0;box-shadow:none}@page{size:A4;margin:0}}@media(max-width:850px){.page{width:100%;min-height:auto;margin:0 0 10px;padding:38px 25px}.summary,.bigfive,.columns{grid-template-columns:1fr}.bigfive article:last-child{grid-column:auto}.row{grid-template-columns:145px 1fr 55px}}</style></head><body><button class="print" onclick="window.print()">Print / Save as PDF</button><section class="page cover"><div class="brand"><b>ME.</b>MANSFIELD EYRE CONSULTING</div><h1>Professional Effectiveness Assessment</h1><div class="rule"></div><div class="person">${esc(r.name)}</div><div class="muted">${esc(r.role||'Participant')}</div><p class="muted" style="margin-top:50px">Assessment date · ${esc(r.date)}${r.cohort?`<br>Cohort · ${esc(r.cohort)}`:''}</p><footer>Prepared by Mansfield Eyre Consulting Limited (MEC)</footer></section><section class="page"><div class="kicker">ABOUT THIS REPORT</div><h2>How to read your results</h2><p class="lead">This report offers a structured view of your self-reported work preferences, learning beliefs and day-to-day experience at the time you completed the assessment.</p><div class="notice"><b>There is no single “ideal” profile.</b><p>Higher and lower scores can each bring useful strengths and possible watch-outs. The value comes from understanding the pattern and choosing behaviours that fit your role and context.</p></div><div class="kicker" style="margin-top:38px">UNDERSTANDING THE BIG FIVE</div><h2 style="font-size:28px">Five broad work-style tendencies</h2><div class="bigfive">${TRAITS.map(name=>`<article><h3>${esc(name)}</h3><p>${esc(TRAIT_GUIDE[name].measures)}</p></article>`).join('')}</div><p class="fine">This is a self-report, not a diagnosis, fixed personality type, ability test or performance rating. Scores are raw questionnaire scores, not population percentiles.</p></section><section class="page"><div class="kicker">EXECUTIVE SNAPSHOT</div><h2>Your results at a glance</h2><div class="summary"><article><h3>Growth Mindset</h3><b>${s.mindset??'—'}/48</b><small>${esc(s.mindsetBand)}</small><p>${esc(e.mindset)}</p></article><article><h3>Strategic Capability</h3><b>${s.strategic??'—'}/50</b><small>${esc(s.strategicBand)}</small><p>${esc(e.strategic)}</p></article><article><h3>Operational Friction</h3><b>${s.friction??'—'}/50</b><small>${esc(s.frictionBand)}</small><p>${esc(e.friction)}</p></article></div><div class="kicker" style="margin-top:38px">WORK-STYLE PROFILE</div><h2 style="font-size:28px">Your Big Five score profile</h2>${profile}<p class="fine">Bars show raw questionnaire scores as a share of the available 20 points. Higher is not automatically better.</p></section>${cards}${comments?`<section class="page"><div class="kicker">YOUR VOICE</div><h2>Participant reflections</h2>${comments}</section>`:''}<section class="page"><div class="kicker">INTERPRETATION</div><h2>Use the report as a starting point</h2><p class="lead">The most useful interpretation connects these scores with real situations, role expectations and the outcomes you want to create.</p><div class="notice"><ul><li>Results describe responses at one point in time.</li><li>They do not define identity or set limits on capability.</li><li>Higher Operational Friction means more reported difficulty, not poorer performance.</li><li>Role, culture, current pressure and lived experience all matter.</li><li>Development is about expanding choice, not changing who you are.</li></ul></div></section></body></html>`;
}

// Question identities verified against Corporate Behavioural Assessment (Responses).
// Scoring order follows MEC Score_Calculator, independently of sheet column order.
const FORM_QUESTIONS = [
  'I enjoy collaborating with colleagues on projects.',
  'I am comfortable speaking up during meetings.',
  'I gain energy from interacting with others at work.',
  'I prefer to keep to myself during most work activities, finding it hard to engage in social spaces.',
  'I maintain positive working relationships even under pressure.',
  'I willingly support colleagues when they need assistance.',
  'I consider the impact of my actions on others.',
  'I find it difficulty to adapt my working style to accommodate others.',
  'I consistently meet deadlines and commitments.',
  'I pay close attention to details in my work.',
  'I keep my work organised and structured.',
  'I sometimes postpone important tasks until the last minute.',
  'I remain calm when priorities suddenly change.',
  'I recover quickly after setbacks or mistakes.',
  'I can manage pressure during busy periods.',
  'Unexpected challenges easily overwhelm me.',
  'I enjoy learning new systems and processes.',
  'I look for better ways of doing things.',
  'I am curious about new ideas and approaches.',
  'I prefer established methods over experimenting with alternatives.',
  'No matter how much intelligence you have, you can always significantly increase your intelligence.',
  'You can learn new things, but your core intelligence level stays largely fixed.',
  'I like my work best when it makes me think hard.',
  'I like my work best when tasks are clear and straightforward, requiring little adjustment.',
  'I like work that I will learn from even if I make a lot of mistakes.',
  'I like my work best when I can do it perfectly without any mistakes.',
  'When something is hard, it makes me want to work more on it, not less.',
  'When I work hard, it sometimes makes me feel as though I am not very smart.',
  'I understand how my work contributes to organisational goals.',
  'I think about the long-term impact of my decisions.',
  'I actively identify opportunities to improve processes.',
  'I consider how decisions affect other departments.',
  'I identify risks before they become significant problems.',
  'I balance immediate priorities with future objectives.',
  'I challenge inefficient ways of working.',
  'I look beyond my immediate responsibilities to understand the bigger picture.',
  'I tend to focus on completing my immediate task without thinking about wider organisational goals.',
  "I find it difficult to see how my work connects to the organisation's broader strategy.",
  'I repeatedly re-check completed work because I worry I may have missed an error.',
  "I find it difficult to accept that my work is 'good enough' to submit.",
  'I spend too long solving problems alone before asking for help.',
  'I find it difficult to communicate challenges to my manager.',
  'I take feedback on errors as a sign of personal failure.',
  'I focus on task completion without considering wider business impact.',
  'I avoid taking ownership of unfamiliar issues.',
  'I become overly cautious when deadlines are tight.',
  'I hesitate to make decisions without complete certainty.',
  'I continue using inefficient processes even when better alternatives exist.',
  'When I identify a discrepancy, I flag it immediately and move on.',
  'I know when a task is complete without needing to re-verify'
];
const FORM_OPEN_QUESTIONS = [
  'What aspect of your current role creates the greatest challenge or frustration?',
  'What professional habit would you most like to improve over the next six months?',
  'Describe a recent setback and how you responded to it.',
  'What strategic contribution would you like to make to your team or organisation?',
  'What support or capability would help you perform at your highest level?'
];


function parseCSV(text) {
  text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"'&&field==='')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}else field+=c;}
  if(quoted)throw new Error('A quoted CSV field is unfinished. Re-export the file and try again.');
  row.push(field);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
function safeCSV(rows) {
  return '\uFEFF'+rows.map(r=>r.map(x=>{let v=String(x??'');if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');
}
function norm(x){return String(x??'').trim().toLowerCase().replace(/[‘’]/g,"'").replace(/\s+/g,' ').replace(/[.!?]+$/,'');}
function resolveColumns(headerRow,ordered=false){
  const headers=headerRow.map(norm);
  const email=headers.findIndex(h=>['email','email address','e-mail address'].includes(h)),name=headers.findIndex(h=>['full name','name','participant','participant name'].includes(h)),role=headers.findIndex(h=>['job title','role','position'].includes(h)),date=headers.findIndex(h=>['timestamp','date','assessment date'].includes(h));
  const numbered=Array.from({length:50},(_,i)=>headers.flatMap((h,c)=>new RegExp('^q\\s*'+(i+1)+'(?:\\b|[:.)])','i').test(h)?[c]:[]));
  const named=FORM_QUESTIONS.map((text,i)=>headers.flatMap((h,c)=>h===norm(text)||(i===27&&norm(h.replace(/ 2$/,''))===norm(text))?[c]:[]));
  let questions,mode;
  if(numbered.every(cols=>cols.length===1)){questions=numbered;mode='numbered';}
  else if(named.some(cols=>cols.length)){
    const missing=named.flatMap((cols,i)=>cols.length?[]:['Q'+(i+1)+': '+FORM_QUESTIONS[i]]);
    if(missing.length)throw new Error('Question headings missing or changed: '+missing.join('; ')+'. Restore the form wording or provide a reviewed mapping.');
    questions=named;mode='form';
  }else if(ordered){
    if(headers.length<54)throw new Error('The original layout needs 4 identity columns followed by 50 questions.');
    questions=Array.from({length:50},(_,i)=>[i+4]);mode='ordered';
  }else throw new Error('Question columns could not be identified. Use the assessment form headings, Q1–Q50 headers, or confirm the original column order below.');
  if(mode!=='ordered'&&(email<0||name<0||date<0))throw new Error('Include Timestamp, Full Name and Email Address columns.');
  const open=Array.from({length:5},(_,i)=>headers.findIndex(h=>new RegExp('^oe'+(i+1)+'\\b','i').test(h)||h===norm(FORM_OPEN_QUESTIONS[i])));
  return {mode,questions,email:mode==='ordered'?1:email,name:mode==='ordered'?2:name,role:mode==='ordered'?3:role,date:mode==='ordered'?0:date,open:mode==='ordered'?Array.from({length:5},(_,i)=>i+54):open};
}
function formTimestamp(value){
  const text=String(value??'').trim();
  // These exports contain local Excel date serials. Match the local timestamp
  // produced by Apps Script, so importing XLSX and CSV does not create duplicates.
  if(/^\d{5}(\.\d+)?$/.test(text))return new Date(Math.round((Number(text)-25569)*86400)*1000).toISOString().slice(0,19);
  const dayFirst=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if(dayFirst){const [,d,m,y,h='00',minute='00',second='00']=dayFirst;if(Number(h)>23||Number(minute)>59||Number(second)>59)throw new Error('Invalid assessment timestamp.');return y+'-'+m.padStart(2,'0')+'-'+d.padStart(2,'0')+'T'+h.padStart(2,'0')+':'+minute+':'+second;}
  return text;
}
function questionValue(row,columns){
  const values=columns.map(c=>String(row[c]??'').trim()).filter(Boolean);
  if(!values.length)return '';
  return new Set(values.map(norm)).size===1?values[0]:'Conflicting duplicate answers';
}
function mapRows(rows,ordered=false,cohort='Imported cohort'){
  if(rows.length<2)throw new Error('The file needs a header row and at least one response.');
  const columns=resolveColumns(rows[0],ordered);
  const result=[];
  for(let i=1;i<rows.length;i++){
    const row=rows[i];if(!row.some(x=>String(x??'').trim()))continue;
    const person=String(row[columns.name]??'').trim(),address=String(row[columns.email]??'').trim().toLowerCase();
    if((!person&&columns.mode!=='form')||!/^\S+@\S+\.\S+$/.test(address))throw new Error('Row '+(i+1)+': enter a valid name and email address.');
    const timestamp=columns.mode==='form'?formTimestamp(row[columns.date]):String(row[columns.date]??'').trim();
    const dateMatch=timestamp.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);let iso;
    if(dateMatch)iso=dateMatch[1]+'-'+dateMatch[2].padStart(2,'0')+'-'+dateMatch[3].padStart(2,'0');
    else if(/^\d{5}(\.\d+)?$/.test(timestamp))iso=new Date((Number(timestamp)-25569)*86400000).toISOString().slice(0,10);
    else throw new Error('Row '+(i+1)+': assessment date must start YYYY-MM-DD or YYYY/MM/DD. Convert ambiguous dates before importing.');
    const parsedDate=new Date(iso+'T00:00:00Z');if(Number.isNaN(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==iso)throw new Error('Row '+(i+1)+': assessment date is not a valid calendar date.');
    result.push({id:'import-'+address+'-'+timestamp,name:person||address+' (name not provided)',email:address,role:String(row[columns.role]??''),date:iso,submittedAt:timestamp,cohort,source:'Imported responses',answers:columns.questions.map(cols=>questionValue(row,cols)),openAnswers:columns.open.map(c=>String(row[c]??'').trim()),notes:'',goals:'',reviewed:false});
  }
  if(!result.length)throw new Error('No response rows were found.');if(result.length>2000)throw new Error('This automation supports up to 2000 responses per sheet. Archive older responses first.');
  const ids=new Set();for(const r of result){if(ids.has(r.id))throw new Error('Repeated email and timestamp in this file. Remove duplicate rows.');ids.add(r.id);}return result;
}

