import {FORM_QUESTIONS,FORM_OPEN_QUESTIONS} from './form-headings.mjs';

export function parseCSV(text) {
  text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"'&&field==='')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}else field+=c;}
  if(quoted)throw new Error('A quoted CSV field is unfinished. Re-export the file and try again.');
  row.push(field);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
export function safeCSV(rows) {
  return '\uFEFF'+rows.map(r=>r.map(x=>{let v=String(x??'');if(/^[=+\-@\t\r]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');
}
function norm(x){return String(x??'').trim().toLowerCase().replace(/[‘’]/g,"'").replace(/\s+/g,' ').replace(/[.!?]+$/,'');}
export function resolveColumns(headerRow,ordered=false){
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
export function mapRows(rows,ordered=false,cohort='Imported cohort'){
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
  if(!result.length)throw new Error('No response rows were found.');if(result.length>200)throw new Error('Import a maximum of 200 assessments at a time.');
  const ids=new Set();for(const r of result){if(ids.has(r.id))throw new Error('Repeated email and timestamp in this file. Remove duplicate rows.');ids.add(r.id);}return result;
}

export async function parseXLSX(buffer){
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(view.getUint32(i,true)===0x06054b50){end=i;break;}}
  if(end<0)throw new Error('This is not a readable XLSX file. Export as CSV instead.');
  const entries=new Map();let cursor=view.getUint32(end+16,true),count=view.getUint16(end+10,true);
  if(count>10000)throw new Error('This workbook has too many entries. Export only responses as CSV.');
  const decoder=new TextDecoder();
  for(let i=0;i<count;i++){
    if(view.getUint32(cursor,true)!==0x02014b50)throw new Error('Invalid XLSX directory.');
    const method=view.getUint16(cursor+10,true),size=view.getUint32(cursor+20,true),expanded=view.getUint32(cursor+24,true),n=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true),name=decoder.decode(bytes.slice(cursor+46,cursor+46+n));
    entries.set(name,{method,size,expanded,offset});cursor+=46+n+extra+comment;
  }
  async function read(name){
    const e=entries.get(name);if(!e)return null;if(e.expanded>20000000)throw new Error('A worksheet is too large. Export responses as CSV.');
    const local=e.offset,start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true),content=bytes.slice(start,start+e.size);
    let text;if(e.method===0)text=decoder.decode(content);else if(e.method===8){try{const stream=new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw'));text=await new Response(stream).text();}catch{throw new Error('Your browser cannot decompress this XLSX. Export the response sheet as CSV.');}}else throw new Error('Unsupported XLSX compression. Use CSV.');
    const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.getElementsByTagName('parsererror').length)throw new Error('Invalid workbook XML. Use CSV.');return xml;
  }
  const workbook=await read('xl/workbook.xml'),rels=await read('xl/_rels/workbook.xml.rels');if(!workbook||!rels)throw new Error('Workbook metadata is missing.');
  const sheets=[...workbook.getElementsByTagName('sheet')],sheet=sheets.find(x=>x.getAttribute('name')==='Response_Data')??sheets.find(x=>/form responses/i.test(x.getAttribute('name')??''))??sheets[0];
  const id=sheet.getAttribute('r:id'),rel=[...rels.getElementsByTagName('Relationship')].find(x=>x.getAttribute('Id')===id);if(!rel)throw new Error('Response worksheet could not be located.');
  const target=rel.getAttribute('Target'),path=target.startsWith('/')?target.slice(1):('xl/'+target).split('/').reduce((a,v)=>v==='..'?(a.pop(),a):v==='.'?a:[...a,v],[]).join('/');
  const shared=await read('xl/sharedStrings.xml'),strings=shared?[...shared.getElementsByTagName('si')].map(x=>[...x.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
  const xml=await read(path);if(!xml)throw new Error('Response worksheet is missing.');
  return [...xml.getElementsByTagName('row')].map(row=>{const values=[];for(const cell of row.getElementsByTagName('c')){const ref=cell.getAttribute('r')??'',letters=ref.match(/^[A-Z]+/)?.[0];if(!letters)continue;let index=0;for(const ch of letters)index=index*26+ch.charCodeAt(0)-64;const type=cell.getAttribute('t'),v=cell.getElementsByTagName('v')[0]?.textContent??'';values[index-1]=type==='s'?strings[Number(v)]??'':type==='inlineStr'?[...cell.getElementsByTagName('t')].map(x=>x.textContent).join(''):v;}return Array.from({length:values.length},(_,i)=>values[i]??'');}).filter(row=>row.some(Boolean));
}
