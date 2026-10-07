'use client';
import type {LocalizedText} from '@/lib/ui-copy';
import {useLanguage,LanguagePicker} from '@/components/language-provider';
import { useEffect,useState } from 'react';
import ProfileMenu from '@/components/profile-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
type Data={store:{name:string;country:string};people:{id:string;name:string;email:string}[];courses:{id:string;title:string;englishTitle:string;category:string;languageCode:string}[]};
export default function StoreLearning(){
  const {t,country:countryLabel,languageName}=useLanguage();

  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState<LocalizedText>(''),[busy,setBusy]=useState(false);
  const [users,setUsers]=useState<string[]>([]),[courses,setCourses]=useState<string[]>([]),[all,setAll]=useState(false),[search,setSearch]=useState('');
  const load=async()=>{const response=await fetch('/api/store',{cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error);setData(result);};
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  const toggle=(id:string,values:string[],setter:(v:string[])=>void)=>setter(values.includes(id)?values.filter(v=>v!==id):[...values,id]);
  async function assign(){setBusy(true);setError('');setNotice('');try{const response=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({courseIds:courses,userIds:users,allUsers:all})});const result=await response.json();if(!response.ok)throw new Error(result.error);setNotice({key:'Assignment complete. Courses: {courses}. Users: {users}.',values:{courses:result.courses,users:result.users}});setCourses([]);setUsers([]);setAll(false);await load();}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
  return <div className="shell course-admin"><header className="topbar"><a className="brand" href="/"><strong>PRIMARK</strong></a><div className="top-controls"><LanguagePicker/><ProfileMenu view="store"/></div></header><main className="main">
    <div className="admin-heading"><div><span className="eyebrow">{t("STORE MANAGER")}</span><h1>{t("My store")}</h1>{data&&<p>{data.store.name} · {countryLabel(data.store.country)}</p>}</div></div>
    {error&&<p className="error" role="alert">{t(error)}</p>}{notice&&<p className="admin-success" role="status">{t(notice)}</p>}
    {!data?!error&&<p>{t("Loading your store…")}</p>:<><div className="store-assignment-grid">
      <section className="paper course-editor"><h2>{t("Users")}{" "}<small>({data.people.length})</small></h2><Input type="search" aria-label={t("Search users")} placeholder={t("Find a user")} value={search} onChange={e=>setSearch(e.target.value)}/>
      <label className="selection-label"><Checkbox disabled={busy} checked={all} onCheckedChange={v=>setAll(v===true)}/>{t("All users in this store (")}{data.people.length})</label>
      <div className="audience-options">{data.people.filter(p=>(p.name+' '+p.email).toLowerCase().includes(search.toLowerCase())).map(p=><label key={p.id}><Checkbox disabled={busy||all} checked={all||users.includes(p.id)} onCheckedChange={()=>toggle(p.id,users,setUsers)}/><span><strong>{p.name}</strong><small>{p.email}</small></span></label>)}{!data.people.length&&<p>{t("Users appear here after registering for this store.")}</p>}</div></section>
      <section className="paper course-editor"><h2>{t("Country course library")}</h2><p>{t("Courses available in")}{" "}{countryLabel(data.store.country)}.</p><div className="audience-options">{data.courses.map(c=><label key={c.id}><Checkbox disabled={busy} checked={courses.includes(c.id)} onCheckedChange={()=>toggle(c.id,courses,setCourses)}/><span><strong>{c.title}</strong><small>{t(c.category)} · {languageName(c.languageCode)}</small>{c.englishTitle!==c.title&&<small>{c.englishTitle}</small>}</span></label>)}{!data.courses.length&&<p>{t("No courses have been published for this country yet.")}</p>}</div></section>
    </div><div className="editor-actions"><span>{courses.length}{" "}{t("courses ·")}{" "}{all?data.people.length:users.length}{" "}{t("users")}</span><Button className="blue-button" disabled={busy||!courses.length||(!all&&!users.length)||!data.people.length} onClick={()=>void assign()}>{t(busy?'Assigning…':'Assign courses')}</Button></div></>}
  </main></div>;
}
