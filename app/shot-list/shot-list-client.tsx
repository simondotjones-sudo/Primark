"use client";
import ProfileMenu from "@/components/profile-menu";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Check, CheckCircle2, ChevronLeft, ChevronRight, Download, ImagePlus, Images, LoaderCircle, RefreshCw, X } from "lucide-react";
import { getShot, requiredShots, shotKey, shotModules, type ShotData, type ShotPhoto, type ShotState } from "@/lib/shot-list";
import "./shot-list.css";

type Pending = { id: string; file: File; module: number; slide: number; status: "waiting" | "uploading" | "failed"; progress: number; error?: string };
const photoUrl = (id: string, mode = "preview") => `/api/shot-list/photos/${id}?${mode}=1`;
const sizeLabel = (size: number) => `${(size / (1024 * 1024)).toFixed(1)} MB`;
const shotKindLabel = { photo: "Required", optional: "Optional photo", reuse: "Reuse existing shots", screen: "Screenshot later" };
async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Please try again.");
  return data;
}
async function thumbnail(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { img.src = ""; reject(new Error("Preview unavailable")); }, 10000);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new Error("Preview unavailable")); };
      img.src = url;
    });
    const scale = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.8));
  } catch { return null; }
  finally { URL.revokeObjectURL(url); }
}
async function uploadPhoto(item: Pending, progress: (value: number) => void): Promise<ShotPhoto> {
  const preview = await thumbnail(item.file);
  const chunkSize=2*1024*1024;
  for(let offset=0;offset<item.file.size;offset+=chunkSize){
    const form=new FormData();
    form.append('module',String(item.module));form.append('slide',String(item.slide));form.append('id',item.id);
    form.append('total',String(item.file.size));form.append('offset',String(offset));form.append('name',item.file.name);
    form.append('photo',item.file.slice(offset,offset+chunkSize),'part');
    if(preview&&offset+chunkSize>=item.file.size)form.append('thumbnail',preview,'preview.jpg');
    const res=await fetch('/api/shot-list/photos',{method:'POST',body:form});
    const result=await res.json();if(!res.ok)throw new Error(result.error||'The photo was not saved. Please retry.');
    progress(Math.round(Math.min(item.file.size,offset+chunkSize)/item.file.size*100));
    if(result.photo)return result.photo;
  }
  throw new Error('The save could not be confirmed. Please retry.');
}

export default function ShotList() {
  const [data, setData] = useState<ShotData>({ photos: [], states: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [moduleNumber, setModuleNumber] = useState<number | null>(null), [slideNumber, setSlideNumber] = useState(1);
  const [gallery, setGallery] = useState(false), [galleryModule, setGalleryModule] = useState(0);
  const [queue, setQueue] = useState<Pending[]>([]), [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState("");
  const [showNote, setShowNote] = useState(false), [note, setNote] = useState("");
  const [offline, setOffline] = useState(false);
  const uploadLock = useRef(false), cameraInput = useRef<HTMLInputElement>(null), libraryInput = useRef<HTMLInputElement>(null);
  const module = shotModules.find(m => m.number === moduleNumber);
  const slide = module?.slides.find(s => s.number === slideNumber);
  const stateMap = useMemo(() => new Map(data.states.map(s => [shotKey(s.module_number,s.slide_number),s])), [data.states]);
  const state = module ? stateMap.get(shotKey(module.number,slideNumber)) : undefined;
  const slidePhotos = data.photos.filter(p => p.module_number === moduleNumber && p.slide_number === slideNumber);
  const completed = requiredShots.filter(k => stateMap.get(k)?.status === "complete").length;
  const unavailable = requiredShots.filter(k => stateMap.get(k)?.status === "unavailable").length;
  const photosByShot = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of data.photos) { const key = shotKey(p.module_number,p.slide_number); map.set(key,(map.get(key)||0)+1); }
    return map;
  }, [data.photos]);
  const load = useCallback(async () => {
    setError("");
    try { setData(await jsonRequest<ShotData>("/api/shot-list")); }
    catch (e) { setError(e instanceof Error ? e.message : "The shot list could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); document.documentElement.lang = "en"; document.documentElement.dir = "ltr"; }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(location.search), m = Number(params.get("module")), s = Number(params.get("slide"));
    if (getShot(m,s)) { setModuleNumber(m); setSlideNumber(s); }
    if (params.get("view") === "photos") setGallery(true);
  }, []);
  useEffect(() => { setNote(state?.note || ""); setShowNote(state?.status === "unavailable"); setNotice(""); }, [moduleNumber,slideNumber,state?.note,state?.status]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine); update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online",update); window.removeEventListener("offline",update); };
  }, []);
  useEffect(() => {
    if (!queue.length) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload",warn); return () => window.removeEventListener("beforeunload",warn);
  }, [queue.length]);
  function openSlide(m: number, s: number) {
    setModuleNumber(m); setSlideNumber(s); setGallery(false); setNotice("");
    history.replaceState(null,"",`/shot-list/?module=${m}&slide=${s}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function openOverview() { setModuleNumber(null); setGallery(false); history.replaceState(null,"","/shot-list/"); }
  function openGallery() { setGallery(true); history.replaceState(null,"","/shot-list/?view=photos"); }
  async function process(items: Pending[]) {
    if (uploadLock.current) return;
    uploadLock.current = true; setUploading(true); setNotice("");
    try {
      for (const item of items) {
        setQueue(q => q.map(p => p.id === item.id ? { ...p, status: "uploading", progress: 0, error: undefined } : p));
        try {
          const photo = await uploadPhoto(item, progress => setQueue(q => q.map(p => p.id === item.id ? { ...p, progress } : p)));
          setData(d => ({ ...d, photos: [photo,...d.photos.filter(p => p.id !== photo.id)] }));
          setQueue(q => q.filter(p => p.id !== item.id));
          setNotice(`Photo saved to Module ${item.module}, Slide ${item.slide}.`);
        } catch (e) {
          setQueue(q => q.map(p => p.id === item.id ? { ...p, status: "failed", error: e instanceof Error ? e.message : "Please retry." } : p));
        }
      }
    } finally { uploadLock.current = false; setUploading(false); }
  }
  function addFiles(files: FileList | null) {
    if (!files || !module || !slide || uploadLock.current) return;
    const items: Pending[] = [];
    for (const file of Array.from(files)) {
      if (!file.size || file.size > 20*1024*1024) { setError(`${file.name}: choose a photo smaller than 20 MB.`); continue; }
      if (!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name) && !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) { setError(`${file.name}: use a JPEG, PNG, WebP or HEIC photo.`); continue; }
      items.push({ id: crypto.randomUUID(), file, module: module.number, slide: slide.number, status: "waiting", progress: 0 });
    }
    if (items.length) { setQueue(q => [...q,...items]); void process(items); }
  }
  async function saveStatus(status: ShotState["status"]) {
    if (!module || !slide) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await jsonRequest<{state: ShotState}>("/api/shot-list", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ module: module.number, slide: slide.number, status, note }) });
      setData(d => ({ ...d, states: [...d.states.filter(s => shotKey(s.module_number,s.slide_number) !== shotKey(module.number,slide.number)),result.state] }));
      setNotice(status === "complete" ? "Slide complete. Your progress is saved." : status === "unavailable" ? "Note saved for the project team." : "Slide reopened.");
    } catch (e) { setError(e instanceof Error ? e.message : "The status was not saved."); }
    finally { setSaving(false); }
  }
  const pendingForSlide = queue.some(p => p.module === moduleNumber && p.slide === slideNumber);
  const isReference = slide?.kind === "reuse" || slide?.kind === "screen";
  return <div className="shoot-shell" lang="en" dir="ltr">
    <header className="shoot-top"><a className="shoot-brand" href="/"><strong>PRIMARK</strong></a><ProfileMenu view="shots"/></header>
    <main className="shoot-main">
      <div className="shoot-heading"><div><span className="shoot-kicker">STORE PHOTOGRAPHY</span><h1>Shot list</h1></div><button className={"shoot-secondary "+(gallery?"is-active":"")} onClick={gallery?openOverview:openGallery}><Images size={19}/>{gallery?"Modules":"View photos"}{!gallery&&data.photos.length>0&&<span>{data.photos.length}</span>}</button></div>
      <p className="shoot-intro">Read the brief, add your photos, then mark the slide complete.</p>
      <div className="shoot-progress-line"><span><strong>{completed} of {requiredShots.length}</strong> required slides complete{unavailable>0&&` · ${unavailable} unavailable`}</span></div>
      <progress className="shoot-progress" max={requiredShots.length} value={completed} aria-label="Required slides complete"/>
      {offline&&<div className="shoot-warning" role="status">You’re offline. Reconnect to upload. Keep this page open for any photos waiting to save.</div>}
      {error&&<div className="shoot-error" role="alert"><span>{error} <a href="/admin/sign-in?returnTo=%2Fshot-list" target="_blank" rel="noreferrer">Sign in in a new tab</a></span><button onClick={()=>setError("")} aria-label="Dismiss error"><X size={18}/></button></div>}
      {queue.length>0&&<section className="shoot-queue" aria-label="Photos waiting to save"><h2>{uploading?"Saving photos…":"Photos waiting to save"}</h2><p>Keep this page open until every photo is saved.</p>{queue.map(item=><div className="shoot-queue-item" key={item.id}><div><strong>Module {item.module} · Slide {item.slide}</strong><span>{item.file.name}</span>{item.status==="uploading"?<span role="status">{item.progress<100?`Uploading ${item.progress}%` : "Confirming save…"}</span>:item.status==="failed"?<span className="shoot-failed" role="alert">{item.error}</span>:<span>Waiting…</span>}</div>{item.status==="failed"&&<div className="shoot-queue-actions"><button className="shoot-secondary" disabled={uploading||offline} onClick={()=>void process([item])}>Retry</button><button className="shoot-text" disabled={uploading} onClick={()=>{if(confirm("Remove this unsaved photo from the upload queue?"))setQueue(q=>q.filter(p=>p.id!==item.id));}}>Discard</button></div>}</div>)}</section>}
      {loading?<div className="shoot-empty" role="status"><LoaderCircle className="shoot-spin"/>Loading shot list…</div>:<>
        {!gallery&&!module&&<>
          <details className="shoot-tips"><summary>Before you start</summary><ul><li>Take a wider context shot and a close-up. Capture portrait and landscape options.</li><li>Most content slides use a tall image on the right. Cover photos need title space on the left.</li><li>Use colleagues in normal store clothing and ask the safety lead to check demonstrations.</li><li>Photograph controls without operating alarms or emergency stops. Do not create live hazards.</li><li>Wait for “Photo saved” before leaving the page. Saved originals are available to platform admins.</li></ul></details>
          <div className="shoot-modules">{shotModules.map(m=>{
            const required=m.slides.filter(s=>s.kind==="photo");
            const done=required.filter(s=>stateMap.get(shotKey(m.number,s.number))?.status==="complete").length;
            const blocked=required.filter(s=>stateMap.get(shotKey(m.number,s.number))?.status==="unavailable").length;
            const count=data.photos.filter(p=>p.module_number===m.number).length;
            const next=required.find(s=>stateMap.get(shotKey(m.number,s.number))?.status!=="complete"&&stateMap.get(shotKey(m.number,s.number))?.status!=="unavailable") || m.slides[0];
            return <button key={m.number} className={"shoot-module "+(done===required.length?"is-complete":"")} onClick={()=>openSlide(m.number,next.number)}><span className="shoot-module-num">{done===required.length?<Check size={25}/>:String(m.number).padStart(2,"0")}</span><div><small>Module {m.number} · {m.slides.length} slides</small><h2>{m.title}</h2><p>{m.location}</p><span className="shoot-module-count">{done}/{required.length} required complete · {count} photo{count===1?"":"s"}{blocked>0&&` · ${blocked} unavailable`}</span></div><ChevronRight size={22}/></button>;
          })}</div><p className="shoot-footnote">Cover photos are optional. Recap slides reuse earlier shots. Slide numbers include each deck’s cover.</p>
        </>}
        {gallery&&<section className="shoot-gallery"><div className="shoot-section-head"><h2>Saved photos</h2><label>Module<select value={galleryModule} onChange={e=>setGalleryModule(Number(e.target.value))}><option value={0}>All modules</option>{shotModules.map(m=><option key={m.number} value={m.number}>{m.number}. {m.title}</option>)}</select></label><button className="shoot-secondary" onClick={()=>void load()}><RefreshCw size={17}/>Refresh</button></div><p className="shoot-muted">Original files, organised by module and slide. Downloads include the module and slide in the filename.</p>{(galleryModule?[shotModules[galleryModule-1]]:shotModules).map(m=>{
          const photos=data.photos.filter(p=>p.module_number===m.number);
          return photos.length?<div className="shoot-gallery-group" key={m.number}><h3>Module {m.number}: {m.title}</h3><div className="shoot-photo-grid">{[...photos].sort((a,b)=>a.slide_number-b.slide_number).map(p=><PhotoCard key={p.id} photo={p} showSlide onOpen={()=>openSlide(p.module_number,p.slide_number)}/>)}</div></div>:null;
        })}{!data.photos.some(p=>!galleryModule||p.module_number===galleryModule)&&<div className="shoot-empty"><Images size={30}/><h3>No photos saved yet</h3><p>Open a module and add the first photo.</p><button className="shoot-secondary" onClick={openOverview}>Open modules</button></div>}</section>}
        {!gallery&&module&&slide&&<section className="shoot-workspace">
          <button className="shoot-back" onClick={openOverview}><ArrowLeft size={18}/>All modules</button>
          <div className="shoot-module-heading"><span>Module {module.number}</span><h2>{module.title}</h2></div>
          <nav className="shoot-slides" aria-label="Slides in this module">{module.slides.map(s=>{const status=stateMap.get(shotKey(module.number,s.number))?.status;return <button key={s.number} aria-current={s.number===slideNumber?"step":undefined} title={s.title} className={(s.number===slideNumber?"is-current ":"")+(status==="complete"?"is-complete":status==="unavailable"?"is-unavailable":"")} onClick={()=>openSlide(module.number,s.number)}><span>Slide {s.number}</span>{status==="complete"?<Check size={14}/>:status==="unavailable"?<span aria-label="Unavailable">!</span>:(photosByShot.get(shotKey(module.number,s.number))||0)>0?<Camera size={14}/>:null}</button>;})}</nav>
          <article className="shoot-brief"><div className="shoot-brief-meta"><span>Slide {slide.number} of {module.slides.length}</span><span className={"shoot-badge "+(state?.status==="complete"?"is-complete":state?.status==="unavailable"?"is-unavailable":"")}>{state?.status==="complete"?"Complete":state?.status==="unavailable"?"Unavailable":shotKindLabel[slide.kind]}</span></div><h2>{slide.title}</h2><h3>{slide.subject}</h3><ul>{slide.details.map(detail=><li key={detail}>{detail}</li>)}</ul>
            {!isReference&&<div className="shoot-capture"><button className="shoot-primary" disabled={uploading||loading} onClick={()=>cameraInput.current?.click()}><Camera size={22}/>{uploading?"Saving…":"Add Photo"}</button><button className="shoot-secondary" disabled={uploading||loading} onClick={()=>libraryInput.current?.click()}><ImagePlus size={19}/>Choose from library</button><p>Original quality · Up to 20 MB per photo</p></div>}
            {isReference&&<p className="shoot-reference">No new store photo needed. You can move to the next slide.</p>}
            <input className="shoot-file-input" aria-label="Take a photo" ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={e=>{addFiles(e.target.files);e.target.value="";}}/>
            <input className="shoot-file-input" aria-label="Choose photos" ref={libraryInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple onChange={e=>{addFiles(e.target.files);e.target.value="";}}/>
          </article>
          {notice&&<div className="shoot-success" role="status"><CheckCircle2 size={19}/>{notice}</div>}
          {slidePhotos.length>0&&<section className="shoot-saved"><h3>{slidePhotos.length} saved photo{slidePhotos.length===1?"":"s"}</h3><div className="shoot-photo-grid">{slidePhotos.map(p=><PhotoCard key={p.id} photo={p}/>)}</div></section>}
          {!isReference&&<div className="shoot-completion">
            {state?.status==="complete"?<div className="shoot-done"><CheckCircle2 size={22}/><strong>This slide is complete</strong><button className="shoot-text" disabled={saving} onClick={()=>void saveStatus("todo")}>Reopen</button></div>:<><button className="shoot-primary" disabled={saving||pendingForSlide||!slidePhotos.length} onClick={()=>void saveStatus("complete")}><Check size={20}/>{saving?"Saving…":"Mark slide complete"}</button><p>{slidePhotos.length?"Check that you’ve captured all the details above.":"Add a photo before marking this slide complete."}</p></>}
            {state?.status!=="complete"&&<button className="shoot-text" onClick={()=>setShowNote(!showNote)}>{showNote?"Hide note":"Not available at this store?"}</button>}
            {showNote&&state?.status!=="complete"&&<div className="shoot-note"><label htmlFor="unavailable-note">What could not be photographed?</label><textarea id="unavailable-note" maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="For example: no conveyor at this store."/><div><button className="shoot-secondary" disabled={saving||!note.trim()} onClick={()=>void saveStatus("unavailable")}>Save as unavailable</button>{state?.status==="unavailable"&&<button className="shoot-text" disabled={saving} onClick={()=>void saveStatus("todo")}>Reopen slide</button>}</div></div>}
          </div>}
          <div className="shoot-step-nav"><button className="shoot-secondary" disabled={slideNumber===1&&module.number===1} onClick={()=>slideNumber>1?openSlide(module.number,slideNumber-1):openSlide(module.number-1,shotModules[module.number-2].slides.length)}><ChevronLeft size={18}/>Previous</button>{slideNumber<module.slides.length?<button className="shoot-secondary" onClick={()=>openSlide(module.number,slideNumber+1)}>Next slide<ChevronRight size={18}/></button>:module.number<6?<button className="shoot-secondary" onClick={()=>openSlide(module.number+1,1)}>Next module<ChevronRight size={18}/></button>:<button className="shoot-secondary" onClick={openOverview}>Back to modules</button>}</div>
        </section>}
      </>}
    </main><footer className="shoot-footer"><span>Primark Safety Passport · Photo collection</span><button className="shoot-text" onClick={()=>void load()} disabled={loading||uploading}>Refresh saved progress</button></footer>
  </div>;
}

function PhotoCard({ photo, showSlide=false, onOpen }: { photo: ShotPhoto; showSlide?: boolean; onOpen?: () => void }) {
  const [failed, setFailed] = useState(false);
  const canPreview = !failed && (photo.has_thumbnail || photo.mime_type !== "image/heic");
  return <div className="shoot-photo"><a className="shoot-photo-preview" href={photoUrl(photo.id,"view")} target="_blank" rel="noreferrer" aria-label={`Open photo for module ${photo.module_number}, slide ${photo.slide_number}`}>{canPreview?<img src={photoUrl(photo.id)} alt={`Module ${photo.module_number}, slide ${photo.slide_number}: ${photo.filename}`} loading="lazy" onError={()=>setFailed(true)}/>:<div><Images size={30}/><span>Original saved</span><small>Download to view</small></div>}</a><div className="shoot-photo-caption">{showSlide&&<button className="shoot-text" onClick={onOpen}>Slide {photo.slide_number}: {getShot(photo.module_number,photo.slide_number)?.title}</button>}<span className="shoot-photo-name" title={photo.filename}>{photo.filename}</span><small>{sizeLabel(photo.size)} · {photo.uploader_name}</small><a className="shoot-download" href={photoUrl(photo.id,"download")} download><Download size={16}/>Download original</a></div></div>;
}
