'use client';
import { useEffect,useState } from 'react';
import ProfileMenu from '@/components/profile-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { courseLanguages } from '@/lib/course-catalogue';
type Data={store:{name:string;country:string};people:{id:string;name:string;email:string}[];courses:{id:string;title:string;englishTitle:string;category:string;languageCode:string}[]};
export default function StoreLearning(){
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [users,setUsers]=useState<string[]>([]),[courses,setCourses]=useState<string[]>([]),[all,setAll]=useState(false),[search,setSearch]=useState('');
  const load=async()=>{const response=await fetch('/api/store',{cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error);setData(result);};
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  const toggle=(id:string,values:string[],setter:(v:string[])=>void)=>setter(values.includes(id)?values.filter(v=>v!==id):[...values,id]);
  async function assign(){setBusy(true);setError('');setNotice('');try{const response=await fetch('/api/store',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({courseIds:courses,userIds:users,allUsers:all})});const result=await response.json();if(!response.ok)throw new Error(result.error);setNotice(`${result.courses} course${result.courses===1?'':'s'} assigned to ${result.users} user${result.users===1?'':'s'}.`);setCourses([]);setUsers([]);setAll(false);await load();}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
  return <div className="shell course-admin"><header className="topbar"><a className="brand" href="/"><strong>PRIMARK</strong></a><ProfileMenu view="store"/></header><main className="main">
    <div className="admin-heading"><div><span className="eyebrow">STORE MANAGER</span><h1>My store</h1>{data&&<p>{data.store.name} · {data.store.country}</p>}</div></div>
    {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="admin-success" role="status">{notice}</p>}
    {!data?!error&&<p>Loading your store…</p>:<><div className="store-assignment-grid">
      <section className="paper course-editor"><h2>Users <small>({data.people.length})</small></h2><Input type="search" aria-label="Search users" placeholder="Find a user" value={search} onChange={e=>setSearch(e.target.value)}/>
      <label className="selection-label"><Checkbox disabled={busy} checked={all} onCheckedChange={v=>setAll(v===true)}/>All users in this store ({data.people.length})</label>
      <div className="audience-options">{data.people.filter(p=>(p.name+' '+p.email).toLowerCase().includes(search.toLowerCase())).map(p=><label key={p.id}><Checkbox disabled={busy||all} checked={all||users.includes(p.id)} onCheckedChange={()=>toggle(p.id,users,setUsers)}/><span><strong>{p.name}</strong><small>{p.email}</small></span></label>)}{!data.people.length&&<p>Users appear here after registering for this store.</p>}</div></section>
      <section className="paper course-editor"><h2>Country course library</h2><p>Courses available in {data.store.country}.</p><div className="audience-options">{data.courses.map(c=><label key={c.id}><Checkbox disabled={busy} checked={courses.includes(c.id)} onCheckedChange={()=>toggle(c.id,courses,setCourses)}/><span><strong>{c.title}</strong><small>{c.category} · {courseLanguages[c.languageCode]||c.languageCode}</small>{c.englishTitle!==c.title&&<small>{c.englishTitle}</small>}</span></label>)}{!data.courses.length&&<p>No courses have been published for this country yet.</p>}</div></section>
    </div><div className="editor-actions"><span>{courses.length} courses · {all?data.people.length:users.length} users</span><Button className="blue-button" disabled={busy||!courses.length||(!all&&!users.length)||!data.people.length} onClick={()=>void assign()}>{busy?'Assigning…':'Assign courses'}</Button></div></>}
  </main></div>;
}
