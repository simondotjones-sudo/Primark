'use client';
import UserDirectory from '@/components/user-directory';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useLanguage} from '@/components/language-provider';
import type {LocalizedText} from '@/lib/ui-copy';
import {useStores} from '@/components/store-directory';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import {Checkbox} from '@/components/ui/checkbox';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import './manage-users.css';

type Person={id:string;name:string;email:string;country:string;store_id:string;admin_only?:boolean};
type Data={store:{id:string;name:string;country:string}|null;people:Person[];assignments:{learner_id:string;course_id:string}[];courses:{id:string;title:string;englishTitle:string;category:string;languageCode:string}[]};
export default function ManageUsers(){
 const [platformAdmin,setPlatformAdmin]=useState(false),[canAssign,setCanAssign]=useState(false);
 const permissions=useCallback((options:{platformAdmin:boolean;canAssign:boolean})=>{setPlatformAdmin(options.platformAdmin);setCanAssign(options.canAssign);},[]);
 const {t,country:countryLabel,languageName}=useLanguage();
 const stores=useStores(true);
 const [view,setView]=useState('users'),[country,setCountry]=useState(''),[storeId,setStoreId]=useState('');
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState<LocalizedText>('');
 const [query,setQuery]=useState(''),[courseQuery,setCourseQuery]=useState(''),[users,setUsers]=useState<string[]>([]),[courses,setCourses]=useState<string[]>([]),[all,setAll]=useState(false);
 const generation=useRef(0),feedback=useRef<HTMLDivElement>(null);
 const load=useCallback(async()=>{
   if(view!=='assign'||!canAssign)return;
   const current=++generation.current;setLoading(true);setError('');setData(null);
   try{const r=await fetch('/api/store'+(platformAdmin&&storeId?'?storeId='+encodeURIComponent(storeId):''),{cache:'no-store'});const result=await r.json();if(current!==generation.current)return;if(!r.ok)throw new Error(result.error);setData({...result,people:result.people.filter((p:Person)=>!p.admin_only)});}
   catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Please try again.');}
   finally{if(current===generation.current)setLoading(false);}
 },[platformAdmin,storeId,view,canAssign]);
 useEffect(()=>{void load();return()=>{generation.current++;};},[load]);
 useEffect(()=>{if(error||notice)feedback.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[error,notice]);
 const toggle=(id:string,values:string[],setter:(v:string[])=>void)=>setter(values.includes(id)?values.filter(v=>v!==id):[...values,id]);
 function resetSelection(){setUsers([]);setCourses([]);setAll(false);setNotice('');setError('');setCourseQuery('');}
 function changeStore(id:string){setStoreId(id);resetSelection();}
 function quickAssign(person:Person){resetSelection();setQuery('');setUsers([person.id]);if(platformAdmin){setCountry(person.country);setStoreId(person.store_id);}setView('assign');}
 async function assign(){
   if(!data?.store)return;
   setBusy(true);setError('');setNotice('');
   try{const r=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({courseIds:courses,userIds:users,allUsers:all,...(platformAdmin?{storeId:data.store.id}:{})})});const result=await r.json();if(!r.ok)throw new Error(result.error);setData(current=>current?{...current,assignments:[...current.assignments.filter(a=>!(all?data.people.map(p=>p.id):users).includes(a.learner_id)),...result.assignments]}:current);setNotice(result.unavailable?{key:'New assignments: {added}. Already assigned: {already}. Unavailable: {unavailable}. Refresh and try again.',values:{added:result.added,already:result.alreadyAssigned,unavailable:result.unavailable}}:result.added?{key:'New assignments: {added}. Already assigned and skipped: {already}.',values:{added:result.added,already:result.alreadyAssigned}}:'Already assigned — no changes made.');setCourses([]);}
   catch(e){setError(e instanceof Error?e.message:'Please try again.');}
   finally{setBusy(false);}
 }
 const shown=(data?.people||[]).filter(p=>(!platformAdmin||!country||p.country===country)&&(p.name+' '+p.email+' '+(stores.find(s=>s.id===p.store_id)?.name||'')).toLowerCase().includes(query.toLowerCase()));
 const selectedUsers=all?(data?.people||[]).map(p=>p.id):users;
 const assigned=new Set((data?.assignments||[]).map(a=>a.learner_id+'\0'+a.course_id));
 const assignmentCount=(courseId:string)=>selectedUsers.filter(id=>assigned.has(id+'\0'+courseId)).length;
 const existingCount=courses.reduce((sum,id)=>sum+assignmentCount(id),0),newCount=selectedUsers.length*courses.length-existingCount;
 const visibleCourses=(data?.courses||[]).filter(c=>(c.title+' '+c.englishTitle).toLowerCase().includes(courseQuery.toLowerCase()));
 return <div className="manage-users">
 <Tabs value={view} onValueChange={setView}>
 {view!=='assign'?<TabsList className="user-view-tabs pill-switch" aria-label={t('Manage Users')}><TabsTrigger value="users">{t('All users')}</TabsTrigger><TabsTrigger value="learners">{t('Learners')}</TabsTrigger><TabsTrigger value="admins">{t('Admins')}</TabsTrigger></TabsList>:<Button variant="outline" className="users-back" disabled={busy} onClick={()=>setView('users')}>{t('← Back to accounts')}</Button>}
 {view==='assign'&&<>
 {platformAdmin?<div className="user-location"><label>{t('Country')}<NativeSelect value={country} disabled={busy} onChange={e=>{setCountry(e.target.value);changeStore('');}}><option value="">{t('All countries')}</option>{[...new Set(stores.map(s=>s.country))].sort().map(c=><option key={c} value={c}>{countryLabel(c)}</option>)}</NativeSelect></label><label>{t('Store')}<NativeSelect value={storeId} disabled={busy} onChange={e=>changeStore(e.target.value)}><option value="">{t('All stores')}</option>{stores.filter(s=>s.active&&(!country||s.country===country)).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></label></div>:data?.store&&<p className="user-store-name">{data.store.name} · {countryLabel(data.store.country)}</p>}
 <div ref={feedback} aria-live="polite">{error&&<p className="error" role="alert">{t(error)}</p>}{notice&&<p className="admin-success" role="status">{t(notice)}</p>}</div>
 {loading&&<p className="empty">{t('Loading accounts…')}</p>}
 </>}
 {view!=='assign'&&<TabsContent value={view}><UserDirectory type={view==='learners'?'learner':view==='admins'?'admin':'all'} onAssign={quickAssign} onAssignAll={()=>{resetSelection();setView('assign');}} onPermissions={permissions}/></TabsContent>}
 <TabsContent value="assign">{!loading&&data&&(data.store?<>
 <div className="store-assignment-grid">
 <section className="paper user-panel"><h2>{t('Users')}</h2><Input type="search" value={query} onChange={e=>setQuery(e.target.value)} aria-label={t('Search users')} placeholder={t('Find a user')}/><label className="selection-label"><Checkbox disabled={busy||!data.people.length} checked={all} onCheckedChange={value=>setAll(value===true)}/>{t('All users in this store (')}{data.people.length})</label><div className="user-selections">{shown.map(person=><label className="user-selection" key={person.id}><Checkbox disabled={busy||all} checked={all||users.includes(person.id)} onCheckedChange={()=>toggle(person.id,users,setUsers)}/><span><strong>{person.name}</strong><small>{person.email}</small>{courses.length>0&&<small className="assignment-state">{t('Already assigned: {assigned} of {courses}',{assigned:courses.filter(id=>assigned.has(person.id+'\0'+id)).length,courses:courses.length})}</small>}</span></label>)}</div>{!shown.length&&<p className="empty">{t(data.people.length?'No accounts match your search.':'Users appear here after registering for this store.')}</p>}</section>
 <section className="paper user-panel"><h2>{t('Country course library')}</h2><Input type="search" value={courseQuery} onChange={e=>setCourseQuery(e.target.value)} aria-label={t('Search courses')} placeholder={t('Search courses')}/><div className="user-selections">{visibleCourses.map(course=><label className="user-selection" key={course.id}><Checkbox disabled={busy||(selectedUsers.length>0&&assignmentCount(course.id)===selectedUsers.length&&!courses.includes(course.id))} checked={courses.includes(course.id)} onCheckedChange={()=>toggle(course.id,courses,setCourses)}/><span><strong>{course.title}</strong><small>{t(course.category)} · {languageName(course.languageCode)}</small>{selectedUsers.length>0&&assignmentCount(course.id)>0&&<small className="assignment-state">{t(selectedUsers.length===1?'Already assigned':{key:'Already assigned to {assigned} of {users} users',values:{assigned:assignmentCount(course.id),users:selectedUsers.length}})}</small>}</span></label>)}</div>{!visibleCourses.length&&<p className="empty">{t(data.courses.length?'No matching courses.':'No courses have been published for this country yet.')}</p>}</section>
 </div><div className="editor-actions user-assignment-actions"><span aria-live="polite">{t({key:'New assignments: {added}. Already assigned: {already}.',values:{added:newCount,already:existingCount}})}</span><Button className="blue-button" disabled={busy||!courses.length||(!all&&!users.length)||!data.people.length||newCount===0} onClick={()=>void assign()}>{t(busy?'Assigning…':'Assign courses')}</Button></div>
 </>:<p className="paper user-panel">{t('Choose a store to assign courses.')}</p>)}</TabsContent>
 </Tabs></div>;
}
