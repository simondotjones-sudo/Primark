'use client';
import {useFeatures} from '@/hooks/use-features';
import {useEffect,useState} from 'react';
import {useLanguage} from '@/components/language-provider';

export type EvidenceFile={id:string;filename:string;mime_type:string;size:number;uploaded_at:string;state?:string};
const size=(bytes:number)=>bytes>=1024*1024?(bytes/(1024*1024)).toFixed(1)+' MB':Math.max(1,Math.ceil(bytes/1024))+' KB';

export function EvidenceDownloads({files}:{files:EvidenceFile[]}){
 const {t}=useLanguage();
 if(!files.length)return <p className="evidence-empty">{t('No evidence attached.')}</p>;
 return <ul className="assessment-evidence-list">{files.map(file=><li key={file.id}><a href={'/api/assessor/evidence/'+file.id} download aria-label={t('Download {filename}',{filename:file.filename})}>{file.filename}</a><small>{size(file.size)}</small></li>)}</ul>;
}

export function EvidenceUploader({assignmentId,onChange,onBusy,onReady,disabled}:{assignmentId:string;onChange:(files:EvidenceFile[])=>void;onBusy:(busy:boolean)=>void;onReady:(ready:boolean)=>void;disabled:boolean}){
 const features=useFeatures();
 const {t}=useLanguage();
 const [files,setFiles]=useState<EvidenceFile[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const endpoint='/api/assessor/evidence?assignment='+encodeURIComponent(assignmentId);
 function update(next:EvidenceFile[]){setFiles(next);onChange(next);onReady(true);}
 async function load(){const r=await fetch(endpoint,{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error);update(data.evidence);}
 useEffect(()=>{
  const controller=new AbortController();onBusy(true);onReady(false);onChange([]);
  fetch(endpoint,{signal:controller.signal,cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data.evidence;}).then(update).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted){setBusy(false);onBusy(false);}});
  return()=>controller.abort();
 },[assignmentId]);
 async function upload(chosen:File[]){
  setError('');
  if(chosen.length+files.length>5){setError('Choose up to five evidence files.');return;}
  if(chosen.some(f=>!f.size||f.size>3*1024*1024)){setError('Each evidence file must be no larger than 3 MB.');return;}
  setBusy(true);onBusy(true);
  try{for(const file of chosen){const form=new FormData();form.set('file',file);const r=await fetch(endpoint,{method:'POST',body:form});const data=await r.json();if(!r.ok)throw Error(data.error);}await load();}
  catch(e){setError((e as Error).message);try{await load();}catch{/* Keep the original upload error. */}}
  finally{setBusy(false);onBusy(false);}
 }
 async function remove(id:string){setBusy(true);onBusy(true);setError('');try{const r=await fetch('/api/assessor/evidence/'+id,{method:'DELETE'});const data=await r.json();if(!r.ok)throw Error(data.error);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);onBusy(false);}}
 return <div className="assessment-evidence-upload"><h3>{t('Practical assessment evidence')}</h3>
 <p>{t('Attach photos or signed assessment sheets. Up to five files, 3 MB each.')}</p>
 <label>{t('Add evidence (optional)')}<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/jpeg,image/png,image/webp,image/heic" multiple disabled={disabled||busy||files.length>=5||!features.assessment_evidence} onChange={e=>{const chosen=Array.from(e.target.files||[]);e.target.value='';if(chosen.length)void upload(chosen);}}/></label>
 <p className="evidence-help">{t('Uploads are saved as drafts. Saving the assessment locks the attached files.')}</p>
 {error&&<><p role="alert" className="error">{t(error)}</p><button type="button" disabled={disabled||busy} onClick={()=>{setError('');setBusy(true);onBusy(true);load().catch(e=>setError(e.message)).finally(()=>{setBusy(false);onBusy(false);});}}>{t('Retry')}</button></>}{busy&&<p role="status">{t('Saving evidence…')}</p>}
 <ul className="assessment-evidence-list">{files.map(file=><li key={file.id}><div>{file.state==='ready'?<a href={'/api/assessor/evidence/'+file.id} download>{file.filename}</a>:<span>{file.filename}</span>}<small>{size(file.size)}{file.state!=='ready'&&' · '+t('Upload incomplete. Remove and retry.')}</small></div><button type="button" disabled={disabled||busy} onClick={()=>void remove(file.id)} aria-label={t('Remove {filename}',{filename:file.filename})}>{t('Remove')}</button></li>)}</ul>
 </div>;
}
