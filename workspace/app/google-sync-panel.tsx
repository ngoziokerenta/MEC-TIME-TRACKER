'use client';
import {useEffect,useState} from 'react';
import {Copy,Download,RefreshCw,CheckCircle2,Link2} from 'lucide-react';
type Status={ready:boolean;configured:boolean;connected:boolean;lastSyncAt:string|null;sheetName:string|null;cohort:string|null;responseCount:number};
export default function GoogleSyncPanel(){
  const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[manualCode,setManualCode]=useState('');
  async function refresh(){try{const res=await fetch('/api/google-sync',{cache:'no-store'}),body:any=await res.json();if(!res.ok)throw new Error(body.error);setStatus(body);}catch(e){setError(e instanceof Error?e.message:'Could not read connection status.');}}
  useEffect(()=>{refresh();const timer=setInterval(refresh,10000);return()=>clearInterval(timer);},[]);
  async function copyCode(){
    if(status?.connected&&!window.confirm('Create a replacement connection code? Paste it in Google Sheets to resume automatic transfers.'))return;
    setBusy(true);setError('');setMessage('');setManualCode('');
    try{const res=await fetch('/api/google-sync',{method:'POST'}),body:any=await res.json();if(!res.ok)throw new Error(body.error);try{await navigator.clipboard.writeText(body.code);setMessage('Connection code copied. In Sheets, choose MEC Assessment → Connect assessment app and paste it.');}catch{setManualCode(body.code);setMessage('Select and copy the connection code below. In Sheets, choose MEC Assessment → Connect assessment app and paste it.');}await refresh();}
    catch(e){setError(e instanceof Error?e.message:'Could not copy the connection code. Allow clipboard access and try again.');}
    finally{setBusy(false);}
  }
  async function disconnect(){
    setBusy(true);setError('');try{const res=await fetch('/api/google-sync',{method:'DELETE'}),body:any=await res.json();if(!res.ok)throw new Error(body.error);setMessage('Automatic transfers disconnected. Saved assessments remain available.');await refresh();}catch(e){setError(e instanceof Error?e.message:'Could not disconnect.');}finally{setBusy(false);}
  }
  return <section className="panel automation-panel">
    <div className="section-heading"><div><h2>Connect Google Forms to the app</h2><p>One-time setup in your response spreadsheet</p></div><span className="status-tag">{status?.connected?'Connected':status?.configured?'Waiting for first transfer':'Setup needed'}</span></div>
    {status?.connected?<div className="import-preview"><strong><CheckCircle2 size={15}/> Automatic transfers are active</strong><p>{status.responseCount} responses in {status.sheetName}. Last transfer: {status.lastSyncAt?new Date(status.lastSyncAt).toLocaleString('en-GB'):''}.</p><p>New submissions update this app automatically. An open app refreshes every 30 seconds.</p></div>:<p>After connecting, each form submission updates the spreadsheet and this private app. Existing responses transfer during connection.</p>}
    <ol className="setup-steps">
      <li><span>1</span><div><strong>Update the Google Sheets script</strong><p>Open your response spreadsheet → Extensions → Apps Script. Replace the old Code.gs contents with MEC-Connected-Automation.txt, save, then reload the spreadsheet.</p><a className="secondary" href="/MEC-Connected-Automation.txt" download><Download size={15}/>Download connected script</a><button className="text-button" onClick={async()=>{try{const res=await fetch('/MEC-Connected-Automation.txt',{cache:'no-store'});if(!res.ok)throw new Error('Could not load the script.');await navigator.clipboard.writeText(await res.text());setMessage('Connected script copied. Replace the old Code.gs contents and save.');}catch{setError('Use Download connected script, then copy its contents.');}}}><Copy size={14}/>Copy script</button></div></li>
      <li><span>2</span><div><strong>Copy your connection code</strong><p>Use the button below. Keep this code private; it lets your script transfer responses to this app.</p><button className="primary" disabled={busy||!status?.ready} onClick={copyCode}><Link2 size={15}/>{busy?'Preparing…':status?.connected?'Copy replacement connection code':'Copy connection code'}</button></div></li>
      <li><span>3</span><div><strong>Connect from the spreadsheet</strong><p>Choose MEC Assessment → Connect assessment app. Paste the code and click OK. Approve Google’s requested permissions, including access to an external service.</p><p>If scoring has not been set up yet, select the response tab and run Set up automation first.</p></div></li>
      <li><span>4</span><div><strong>Check the first transfer</strong><p>This panel changes to Connected after the app receives your responses. You can check it now using the button below.</p><button className="secondary" onClick={refresh}><RefreshCw size={15}/>Check connection</button></div></li>
    </ol>
    {message&&<p className="import-preview" role="status">{message}</p>}{manualCode&&<label className="field-label">Connection code<textarea readOnly value={manualCode} rows={3} onFocus={e=>e.target.select()}/></label>}{error&&<p className="warning compact" role="alert">{error}</p>}
    <div className="automation-note"><strong>What transfers?</strong><p>Assessment answers, participant details and written comments. Existing coaching notes and agreed actions in this app are retained. Failed transfers retry automatically. Use MEC Assessment → Transfer responses to app now to retry immediately.</p></div>
    {status?.configured&&<button className="text-button" disabled={busy} onClick={disconnect}>Disconnect automatic transfers</button>}
  </section>;
}
