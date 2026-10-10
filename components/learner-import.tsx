'use client';
import {useState} from 'react';
import {useLanguage} from '@/components/language-provider';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import {csvDownload,importColumns,type ImportPreview} from '@/lib/learner-import-csv';

type Result=ImportPreview&{applied?:boolean;batch?:string;pathwayFailures?:number};
export default function LearnerImport({onClose}:{onClose:()=>void}){
 const {t}=useLanguage();
 const [csv,setCsv]=useState(''),[fileName,setFileName]=useState(''),[mode,setMode]=useState('upsert'),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 function download(name:string,rows:unknown[][]){const url=URL.createObjectURL(new Blob([csvDownload(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function read(file:File|undefined){setResult(null);setError('');setCsv('');setFileName('');if(!file)return;if(file.size>500000){setError('This request is too large.');return;}setBusy(true);try{setCsv(await file.text());setFileName(file.name);}catch{setError('Please try again.');}finally{setBusy(false);}}
 async function submit(apply=false){setBusy(true);setError('');try{const response=await fetch('/api/users/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv,mode,...(apply&&result?{revision:result.revision}:{})})});const data=await response.json();if(!response.ok)throw new Error(data.error);setResult(data);if(data.applied)setCsv('');}catch(e){setError(e instanceof Error?e.message:'Please try again.');setResult(null);}finally{setBusy(false);}}
 return <section className="paper user-panel learner-import">
 <h2>{t('Bulk learner import')}</h2>
 <p>{t('Match by Workday ID. Blank fields keep existing values. Maximum 200 learners per CSV.')}</p>
 <p>{t('New learners need name, email, store code and initial password. Dates use YYYY-MM-DD. No emails are sent.')}</p>
 <p>{t('Use active, leaver or rejoin for status. Transfers, leavers and rejoiners require effective_date and reason.')}</p>
 <p>{t('Training history is preserved. Automatic assignments may use credits.')}</p>
 <div className="editor-actions"><Button variant="outline" disabled={busy} onClick={()=>download('learner-import-template.csv',[Array.from(importColumns)])}>{t('Download template')}</Button><Button variant="outline" disabled={busy} onClick={onClose}>{t('← Back to accounts')}</Button></div>
 <fieldset disabled={busy||!!result?.applied} className="directory-filters"><label>{t('Import mode')}<NativeSelect value={mode} onChange={e=>{setMode(e.target.value);setResult(null);setError('');}}><option value="upsert">{t('Create and update')}</option><option value="create">{t('Create only')}</option><option value="update">{t('Update only')}</option></NativeSelect></label><label>{t('CSV file')}<Input type="file" accept=".csv,text/csv" onChange={e=>void read(e.target.files?.[0])}/></label></fieldset>
 <div aria-live="polite">{error&&<p className="error" role="alert">{t(error)}</p>}{result?.applied&&<p className="admin-success">{t('Import complete.')} {result.changed} {t('Users')} · {result.batch}</p>}{!!result?.pathwayFailures&&<p className="error">{t('Some automatic pathway assignments need attention. Check Learning Pathways.')}</p>}</div>
 {!result?.applied&&<Button className="blue-button" disabled={busy||!csv} onClick={()=>void submit()}>{t(busy?'Loading…':'Preview import')}</Button>}
 {result&&<><p>{fileName} · {result.rows.length} {t('Users')} · {result.changed} {t('Changes')}</p>
 {!result.valid&&<p className="error">{t('Fix every row error before applying the import.')}</p>}
 <div className="learner-import-table"><table><thead><tr>{['Row','Workday ID','Name','Action','Changes','Errors'].map(k=><th key={k}>{t(k)}</th>)}</tr></thead><tbody>{result.rows.map(row=><tr key={row.row}><td>{row.row}</td><td>{row.workdayId}</td><td>{row.name}</td><td>{t(row.action)}</td><td>{row.changes.map(c=><div key={c.field}><strong>{c.field}</strong>: {c.before||'—'} → {c.after||'—'}</div>)}</td><td>{row.errors.map(e=><div className="error" key={e}>{t(e)}</div>)}</td></tr>)}</tbody></table></div>
 <div className="editor-actions"><Button variant="outline" disabled={busy} onClick={()=>download('learner-import-results.csv',[['row','workday_id','name','action','changes','errors'],...result.rows.map(r=>[r.row,r.workdayId,r.name,r.action,r.changes.map(c=>`${c.field}: ${c.before} → ${c.after}`).join('; '),r.errors.join('; ')])])}>{t('Download results')}</Button>{!result.applied&&<Button className="blue-button" disabled={busy||!result.valid||!result.changed} onClick={()=>void submit(true)}>{t(busy?'Saving…':'Apply import')}</Button>}</div>
 </>}
 </section>;
}
