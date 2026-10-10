'use client';
import {storeLabel} from '@/lib/store-label';
import type {LocalizedText} from '@/lib/ui-copy';
import {useLanguage} from '@/components/language-provider';
import CourseMetadata from '@/components/course-metadata';
import { coursePanelDetails } from '@/lib/course-panel-details';
import CourseCover from '@/components/course-cover';
import { courseCoverKey } from '@/lib/course-covers';
import CourseCatalogueFields,{fieldsFor} from '@/components/course-catalogue-fields';
import { courseCategories,courseLanguages,availableInCountry } from '@/lib/course-catalogue';
import { NativeSelect } from '@/components/ui/native-select';
import AdminSummary from '@/components/admin-summary';
import PageHeader from "@/components/page-header";
import type { FileEntry } from '@zip.js/zip.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, FileArchive, Globe2, Plus, Search, Upload, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { emptyAudience, matchesAudience, validPath, MAX_ZIP, MAX_FILE, MAX_TOTAL, type Audience, type Course, type Person, type Package, type Sco } from '@/lib/course-types';
import {useStores} from '@/components/store-directory';
async function request(url:string,body?:unknown){const res=await fetch(url,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data:any=await res.json();if(!res.ok)throw new Error(data.error||'Please try again.');return data;}
export default function CourseAdmin(){
 const stores=useStores();
const countries=[...new Set(stores.map(s=>s.country))].sort();
  const {t,country:countryLabel}=useLanguage();

 const [courses,setCourses]=useState<Course[]>([]),[people,setPeople]=useState<Person[]>([]),[packages,setPackages]=useState<Package[]>([]),[progress,setProgress]=useState<any[]>([]);
 const [current,setCurrent]=useState<Course|null>(null),[editing,setEditing]=useState(false),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[audience,setAudience]=useState<Audience>(emptyAudience),[step,setStep]=useState(0);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState<LocalizedText>(''),[query,setQuery]=useState(''),[percent,setPercent]=useState(0),[uploadLabel,setUploadLabel]=useState<LocalizedText>('');
 const [catalogue,setCatalogue]=useState(()=>fieldsFor(null));
 const [librarySearch,setLibrarySearch]=useState(''),[categoryFilter,setCategoryFilter]=useState(''),[countryFilter,setCountryFilter]=useState('');
 const visibleCourses=courses.filter(c=>(!categoryFilter||c.category===categoryFilter)&&(!countryFilter||availableInCountry(c,countryFilter))&&`${c.title} ${c.english_title} ${c.source_course_id||''} ${courseLanguages[c.language_code]||''}`.toLowerCase().includes(librarySearch.toLowerCase()));
 const noticeRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!notice||!noticeRef.current)return;
  noticeRef.current.focus({preventScroll:true});
  noticeRef.current.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
 },[notice]);
 const selectedPackage=packages.find(p=>p.id===current?.package_id);
 const matched=useMemo(()=>people.filter(p=>matchesAudience(audience,p)),[people,audience]);
 const load=async()=>{const d=await request('/api/admin/courses');setCourses(d.courses);setPeople(d.people);setPackages(d.packages);setProgress(d.progress);return d;};
 useEffect(()=>{load().catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
 const open=(course:Course|null)=>{setCurrent(course);setCatalogue(fieldsFor(course));setTitle(course?.title||'');setDescription(course?.description||'');setAudience(course?{...JSON.parse(course.audience_json),users:(JSON.parse(course.audience_json).users as string[]).filter(id=>people.some(p=>p.id===id))}:emptyAudience());setStep(0);setQuery('');setEditing(true);setError('');setNotice('');};
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
 async function save(status:'draft'|'published'){const d=await request('/api/admin/courses',{id:current?.id,revision:current?.revision,title,description,audience,status,...catalogue});setCurrent(d.course);await load();return d.course as Course;}
 const toggle=(key:keyof Audience,value:string)=>setAudience(a=>({...a,[key]:a[key].includes(value)?a[key].filter(v=>v!==value):[...a[key],value]}));
 async function upload(file:File){
  if(!file.name.toLowerCase().endsWith('.zip')||file.size>MAX_ZIP)throw new Error('Choose a SCORM 1.2 ZIP up to 250 MB.');
  setUploadLabel('Checking package…');setPercent(0);
  const {ZipReader,BlobReader,BlobWriter,TextWriter}=await import('@zip.js/zip.js');
  const reader=new ZipReader(new BlobReader(file),{useWebWorkers:false});
  try {
   const entries=(await reader.getEntries()).filter((e): e is FileEntry=>!e.directory&&!e.filename.startsWith('__MACOSX/')&&!e.filename.split('/').some(p=>p.startsWith('.')));
   if(!entries.length||entries.length>5000||entries.some(e=>!validPath(e.filename)||e.encrypted||e.uncompressedSize>MAX_FILE)||entries.reduce((n,e)=>n+e.uncompressedSize,0)>MAX_TOTAL)throw new Error('The ZIP contains an unsafe path, encryption, or exceeds the package limits (5,000 files, 100 MB per file, 750 MB extracted).');
   const manifest=entries.find(e=>e.filename==='imsmanifest.xml');if(!manifest||manifest.uncompressedSize>1000000)throw new Error('imsmanifest.xml must be at the root of a SCORM 1.2 ZIP.');
   const {parseManifest}=await import('@/lib/scorm-manifest');parseManifest(await manifest.getData(new TextWriter()),new Set(entries.map(e=>e.filename)));
   const saved=current||await save('draft');const init=await request('/api/admin/packages',{courseId:saved.id,filename:file.name,files:entries.map(e=>({path:e.filename,size:e.uncompressedSize}))});
   for(let i=0;i<entries.length;i++){
    const entry=entries[i];setUploadLabel({key:'Uploading file {current} of {total}',values:{current:i+1,total:entries.length}});
    const blob=await entry.getData(new BlobWriter(),{checkSignature:true});if(blob.size!==entry.uncompressedSize)throw new Error('The ZIP contains a damaged file.');
    for(let offset=0;offset<Math.max(1,blob.size);offset+=2*1024*1024){
      let done=false;
      for(let retry=0;retry<3&&!done;retry++){try{const res=await fetch(`/api/admin/packages/${init.id}/files?path=${encodeURIComponent(entry.filename)}&offset=${offset}`,{method:'PUT',body:blob.slice(offset,offset+2*1024*1024)});const result:any=await res.json();if(!res.ok)throw new Error(result.error||'Upload failed.');done=true;}catch(e){if(retry===2)throw e;}}
    }
    setPercent(Math.round((i+1)/entries.length*95));
   }
   setUploadLabel('Validating course…');const complete=await request('/api/admin/packages',{action:'finish',id:init.id});setCurrent(complete.course);await load();setPercent(100);setUploadLabel('Package ready');setNotice('SCORM 1.2 package validated. Preview the course, then choose who receives it.');
  }finally{await reader.close();}
 }
 const filteredSites=stores.filter(s=>(s.name+' '+s.country+' '+(s.storeCode||'')).toLowerCase().includes(query.toLowerCase()));
 const filteredPeople=people.filter(p=>(p.name+' '+p.email+' '+p.country+' '+(stores.find(s=>s.id===p.store_id)?.name||'')).toLowerCase().includes(query.toLowerCase()));
 return <div className="shell course-admin app-page"><PageHeader title={t("Course library")} view="courses"/><main className="main">
 {error&&<div role="alert" className="error">{t(error)}<Button variant="ghost" onClick={()=>run(async()=>{const d=await load();if(current){const latest=d.courses.find((c:Course)=>c.id===current.id);if(latest)open(latest);}})}>{t("Reload")}</Button></div>}{notice&&<div ref={noticeRef} tabIndex={-1} className="admin-success" role="status"><Check size={18}/>{t(notice)}</div>}
 {loading?<p>{t("Loading courses…")}</p>:!editing?<><AdminSummary items={[{label:t("Courses"),value:courses.length},{label:t("Published"),value:courses.filter(c=>c.status==="published").length,blue:true},{label:t("Draft"),value:courses.filter(c=>c.status==="draft").length},{label:t("Users"),value:people.length}]}/><div className="course-toolbar"><Button className="blue-button" onClick={()=>open(null)}><Plus size={18}/>{t("Create course")}</Button></div><div className="catalogue-filters"><Input type="search" aria-label={t("Search courses")} placeholder={t("Search course, English title or ID")} value={librarySearch} onChange={e=>setLibrarySearch(e.target.value)}/><NativeSelect aria-label={t("Filter by category")} value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">{t("All categories")}</option>{[...new Set([...courseCategories,...courses.map(c=>c.category).filter(Boolean)])].map(c=><option key={c} value={c}>{t(c)}</option>)}</NativeSelect><NativeSelect aria-label={t("Filter by country")} value={countryFilter} onChange={e=>setCountryFilter(e.target.value)}><option value="">{t("All country settings")}</option>{countries.map(c=><option key={c} value={c}>{countryLabel(c)}</option>)}</NativeSelect></div>{courses.length?<div className="admin-course-list">{!visibleCourses.length&&<p>{t("No courses match these filters.")}</p>}{visibleCourses.map(c=>{return <button className="paper admin-course-row" key={c.id} onClick={()=>open(c)}><span className="admin-course-cover"><CourseCover coverKey={courseCoverKey(c)} sizes="(max-width: 700px) 88px, 144px" /></span><span><strong>{c.title}</strong>{c.english_title&&c.english_title!==c.title&&<small>{c.english_title}</small>}<CourseMetadata details={coursePanelDetails(c)} showUnconfigured showRenewal/></span><span className={'status '+(c.status==='published'?'done':'')}>{t(c.status==='published'?'Published':'Draft')}</span></button>;})}</div>:<div className="paper course-empty"><BookOpen size={34}/><h2>{t("Your course library starts here")}</h2><p>{t("Create a course, add its SCORM file and choose who should receive it.")}</p><Button onClick={()=>open(null)}>{t("Create course")}</Button></div>}</>:
 <div><button disabled={busy} className="back" onClick={()=>setEditing(false)}>{t("All courses")}</button><div className="course-steps" aria-label={t("Course setup")}>{['Course details','SCORM package','Audience & publish'].map((label,i)=><button key={label} className={step===i?'selected':''} disabled={busy||(i>0&&!current)} onClick={()=>setStep(i)}><b>{i+1}</b>{t(label)}</button>)}</div>
 <div className="paper course-editor">
 {step===0&&<form onSubmit={e=>{e.preventDefault();run(async()=>{await save(current?.status||'draft');setStep(1);setNotice('Course details saved.');});}}><h2>{t("Course details")}</h2><div className="course-cover-preview"><CourseCover coverKey={courseCoverKey({title,english_title:catalogue.englishTitle,category:catalogue.category})} sizes="(max-width: 700px) calc(100vw - 72px), 360px" /></div>{current?.source_course_id&&<p>{t("Original course ID")}{" "}{current.source_course_id}{current.legacy_assignment_count!==null?' · '+t('Historical assignments: {count}',{count:current.legacy_assignment_count}):""}</p>}<label>{t("Course name")}<Input required maxLength={150} placeholder={t("e.g. Manual Handling")} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>{t("Short description")}<textarea maxLength={2000} rows={3} placeholder={t("What will colleagues learn?")} value={description} onChange={e=>setDescription(e.target.value)}/></label><CourseCatalogueFields value={catalogue} onChange={setCatalogue}/><div className="editor-actions"><Button type="submit" className="blue-button" disabled={busy}>{t("Save & continue")}</Button></div></form>}
 {step===1&&<><h2>{t("SCORM package")}</h2><p>{t("Upload the ZIP exported as SCORM 1.2 from your authoring tool.")}</p>{current?.status==='published'?<div className="admin-note"><p>{t("This course is published. Pause it before replacing the package. Existing learning records are retained; a replacement package starts a new set of progress records.")}</p><Button disabled={busy} variant="outline" onClick={()=>run(async()=>{await save('draft');setNotice('Course paused. It is hidden from learners until you publish it again.');})}>{t("Pause course")}</Button></div>:<label className={'upload-zone '+(busy?'disabled':'')}><Upload size={28}/><strong>{t(selectedPackage?'Replace SCORM ZIP':'Choose SCORM ZIP')}</strong><span>{t("Up to 250 MB · Keep this page open while uploading")}</span><input type="file" accept=".zip,application/zip" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)run(()=>upload(f));e.target.value='';}}/></label>}
 {uploadLabel&&<div className="upload-progress" role="status"><span>{t(busy?uploadLabel:percent===100?'Package ready':'Upload stopped. Choose the ZIP again to retry.')}</span><Progress value={percent}/></div>}
 {selectedPackage&&<div className="package-ready"><FileArchive/><div><strong>{selectedPackage.filename}</strong><small>SCORM 1.2 · {JSON.parse(selectedPackage.scos_json).length}{" "}{t("SCORM launch")}{" "}{t(JSON.parse(selectedPackage.scos_json).length===1?'item':'items')} · {selectedPackage.file_count}{" "}{t("files")}</small></div><a target="_blank" rel="noopener" href={`/learn/${current!.id}/?preview=1`}>{t("Preview course")}</a></div>}
 <div className="editor-actions"><Button disabled={busy||!selectedPackage} className="blue-button" onClick={()=>setStep(2)}>{t("Choose audience")}</Button></div></>}
 {step===2&&<><h2>{t("Who should receive this course?")}</h2><p>{t("Optionally assign this course directly to countries, sites or users. Country library availability and new joiner induction settings are saved under Course details.")}</p><Tabs defaultValue="countries" onValueChange={()=>setQuery('')}><div className="audience-tabs-scroll"><TabsList className="audience-tabs pill-switch"><TabsTrigger value="countries"><Globe2 size={16}/>{t("Countries (")}{audience.countries.length})</TabsTrigger><TabsTrigger value="sites">{t("Sites (")}{audience.sites.length})</TabsTrigger><TabsTrigger value="users"><Users size={16}/>{t("Users (")}{audience.users.length})</TabsTrigger></TabsList></div>
 <div className="audience-search"><Search size={18}/><Input aria-label={t("Search audience")} placeholder={t("Search…")} value={query} onChange={e=>setQuery(e.target.value)}/></div>
 <TabsContent value="countries"><div className="audience-options">{countries.filter(c=>c.toLowerCase().includes(query.toLowerCase())).map(c=><label key={c}><Checkbox checked={audience.countries.includes(c)} onCheckedChange={()=>toggle('countries',c)}/><span><strong>{countryLabel(c)}</strong><small>{stores.filter(s=>s.country===c).length}{" "}{t("sites")}</small></span></label>)}</div></TabsContent>
 <TabsContent value="sites"><div className="audience-options">{filteredSites.map(s=><label key={s.id}><Checkbox checked={audience.sites.includes(s.id)} onCheckedChange={()=>toggle('sites',s.id)}/><span><strong>{storeLabel(s)}</strong><small>{countryLabel(s.country)}{audience.countries.includes(s.country)?' · '+t('Already covered by country'):''}</small></span></label>)}</div></TabsContent>
 <TabsContent value="users"><div className="audience-options">{filteredPeople.map(p=><label key={p.id}><Checkbox checked={audience.users.includes(p.id)} onCheckedChange={()=>toggle('users',p.id)}/><span><strong>{p.name}</strong><small>{p.email} · {stores.find(s=>s.id===p.store_id)?.name}</small></span></label>)}{!filteredPeople.length&&<p>{t("No matching users. People appear here after registering.")}</p>}</div></TabsContent></Tabs>
 <div className="audience-review"><div><strong>{matched.length}{" "}{t("users match now")}</strong><span>{audience.countries.length}{" "}{t("countries ·")}{" "}{audience.sites.length}{" "}{t("sites ·")}{" "}{audience.users.length}{" "}{t("individual users")}</span></div><p>{t("Country and site selections also apply automatically to future joiners. Users see the course in My Courses once published.")}</p><details><summary>{t("Review matching users")}</summary>{matched.length?<ul>{matched.map(p=><li key={p.id}>{p.name} <small>{p.email} · {countryLabel(p.country)}</small></li>)}</ul>:<p>{t("No current users match. Future joiners at your selected locations will receive it.")}</p>}</details></div>
 <div className="editor-actions"><Button variant="outline" disabled={busy} onClick={()=>run(async()=>{await save('draft');setNotice('Saved as draft. This course is hidden from learners.');})}>{t(current?.status==='published'?'Pause & save draft':'Save draft')}</Button><Button className="blue-button" disabled={busy||!selectedPackage||(!Object.values(audience).some(v=>v.length)&&catalogue.catalogueScope==='unconfigured')} onClick={()=>run(async()=>{await save('published');setNotice(catalogue.inductionRole!=='none'?'Induction published. New joiner assignments are now active.':{key:'Course published. Matching users: {count}.',values:{count:matched.length}});})}>{t(current?.status==='published'?'Update published course':'Publish course')}</Button></div>
 {current?.package_id&&<details className="course-records"><summary>{t("Learning records for this package")}</summary><div className="table-scroll"><table><thead><tr><th>{t("User")}</th><th>{t("Lesson")}</th><th>{t("Status")}</th><th>{t("Score")}</th></tr></thead><tbody>{progress.filter(p=>p.package_id===current.package_id).map((p,i)=><tr key={i}><td>{people.find(u=>u.id===p.learner_id)?.name||t('User')}</td><td>{(JSON.parse(selectedPackage?.scos_json||'[]') as Sco[]).find(s=>s.id===p.sco_id)?.title||t('Lesson')}</td><td>{t(p.status)}</td><td>{p.score??'—'}</td></tr>)}</tbody></table>{!progress.some(p=>p.package_id===current.package_id)&&<p>{t("No learning records yet.")}</p>}</div></details>}
 </>}
 </div></div>}
 {!editing&&<a className="profile-link shot-list-link" href="/shot-list">{t("Shot list")}</a>}</main></div>;
}
