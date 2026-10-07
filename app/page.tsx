"use client";
import {useLanguage,LanguagePicker} from "@/components/language-provider";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Image from "next/image";
import safetyPassCover from "@/public/course-images/safety-pass.png";
import manualHandlingCover from "@/public/course-images/manual-handling.png";
import securityCover from "@/public/course-images/security.png";
import speakUpCover from "@/public/course-images/speak-up.png";
import dignityCover from "@/public/course-images/dignity.png";
import dataProtectionCover from "@/public/course-images/data-protection.png";
import accessibilityCover from "@/public/course-images/accessibility.png";
import safeguardingCover from "@/public/course-images/safeguarding.png";
import type { ReportingAccess } from "@/lib/reporting-types";
import AuthForm from "@/components/auth-form";
import ProfileMenu from "@/components/profile-menu";
import { profileHref, profileScope, type ProfileAccount, type ReportFilter } from "@/lib/profile";
import TrainingReporting from "@/components/training-report";
import CertificatePaper from "@/components/certificate-paper";
import type { Certificate } from "@/lib/certificates";
import AssignedCourses from "@/components/assigned-courses";
import { ArrowLeft, BookOpen, Check, CheckCircle2, ClipboardCheck, LayoutGrid, Play, ShieldCheck, Video } from "lucide-react";
import stores from "@/lib/stores.json";
import { modules, questions } from "@/lib/course";
import { contentLanguage, languageDirection, moduleCopy, questionCopy, type Language } from "@/lib/i18n";
import { formatDuration } from "@/lib/ui-copy";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type Learner = {id:string;name:string;email:string;store_id:string;country:string;entered_at:string;started_at:string|null;completed_at:string|null;best_score:number|null;certificate_token:string|null;induction_enrolled:boolean};
type Screen = "home"|"courses"|"module"|"quiz"|"result"|"pass";
const sampleCourses = [
  {title:"Manual Handling",image:"manual-handling",cover:manualHandlingCover,alt:"Colleagues moving stock on a trolley"},
  {title:"Security, loss prevention and personal safety",image:"security",cover:securityCover,alt:"Colleagues speaking on the shop floor"},
  {title:"Code of Conduct and Speak Up",image:"speak-up",cover:speakUpCover,alt:"Colleagues having a private conversation"},
  {title:"Dignity at Work",image:"dignity",cover:dignityCover,alt:"Colleagues talking together in store"},
  {title:"Data protection",image:"data-protection",cover:dataProtectionCover,alt:"Colleague helping a customer at a till"},
  {title:"Customer service and accessibility",image:"accessibility",cover:accessibilityCover,alt:"Colleague assisting a customer"},
  {title:"Safeguarding and emergency procedures",image:"safeguarding",cover:safeguardingCover,alt:"Colleagues helping a parent and child"},
] as const;
async function api(url:string, options?:RequestInit) {
  const response = await fetch("/api/prototype"+url,{cache:"no-store",...options});
  const data: any = await response.json();
  if(!response.ok) throw new Error(data.error || "Please try again.");
  return data;
}
const post = (action:string,data:Record<string,unknown>={}) => api("",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...data})});

export default function Home() {
  const {lang,t}=useLanguage();
  const copyLang=contentLanguage(lang);
  const shownModules=modules.map((m,i)=>copyLang==="en"?m:{...m,...moduleCopy[copyLang][i],short:moduleCopy[copyLang][i].title});
  const shownQuestions=questions.map((q,i)=>copyLang==="en"?q:{...q,...questionCopy[copyLang][i]});
  const [platformAdmin,setPlatformAdmin]=useState(false);
  const [reportingAccess,setReportingAccess]=useState<ReportingAccess|null>(null);
  const accessKey=useRef("");
  const [area,setArea]=useState<"learn"|"report">("learn");
  const [screen,setScreen]=useState<Screen>("home");
  const [learner,setLearner]=useState<Learner|null>(null);
  const [viewed,setViewed]=useState<string[]>([]);
  const [legacyCompleted,setLegacyCompleted]=useState(false);
  const [account,setAccount]=useState<ProfileAccount|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [moduleIndex,setModuleIndex]=useState(0);
  const [questionIndex,setQuestionIndex]=useState(0);
  const [answers,setAnswers]=useState<number[]>(Array(20).fill(-1));
  const [result,setResult]=useState<{score:number;passed:boolean}|null>(null);
  const [qr,setQr]=useState("");
  const [role,setRole]=useState<"global"|"country"|"site">("global");
  const [scopeCountry,setScopeCountry]=useState("Ireland");
  const [scopeSite,setScopeSite]=useState(stores.find(s=>s.country==="Ireland")?.id || "");
  const refreshMe=useCallback(async()=>{
    const data=await api("?view=me");
    const access:ReportingAccess|null=data.reportingAccess||null;
    setPlatformAdmin(!!data.platformAdmin);setLearner(data.learner);setAccount(data.account||null);
    // Keep the same access object when a profile/focus refresh confirms the same permissions.
    // The dashboard reloads only when its scope or filters actually change.
    setReportingAccess(previous=>previous?.scope===access?.scope&&previous?.country===access?.country&&previous?.siteId===access?.siteId?previous:access);
    setViewed(data.viewed||[]);setLegacyCompleted(!!data.legacyCompleted);
    const key=JSON.stringify([data.learner?.id,!!data.platformAdmin,access]);
    if(key!==accessKey.current){
      accessKey.current=key;
      if(!access){setArea("learn");}else{
        const params=new URLSearchParams(location.search);
        const selected=profileScope(access,{role:params.get("role") as ReportFilter['role'],country:params.get("country")||undefined,site:params.get("site")||undefined}).filter;
        setRole(selected.role);setScopeCountry(selected.country);setScopeSite(selected.site);
        if(params.get("view")==="report"||data.platformAdmin)setArea("report");
      }
    }
    return !!access;
  },[]);
  useEffect(()=>{const refresh=()=>{refreshMe().catch(()=>{setPlatformAdmin(false);setReportingAccess(null);setAccount(null);setArea("learn");});};window.addEventListener("focus",refresh);return()=>window.removeEventListener("focus",refresh);},[refreshMe]);
  useEffect(()=>{if(new URLSearchParams(location.search).get("courses")==="1")setScreen("courses");},[]);
  useEffect(()=>{if(learner?.induction_enrolled&&screen!=="courses")setScreen("courses");},[learner?.induction_enrolled,screen]);

  useEffect(()=>{refreshMe().catch(e=>setError(e.message)).finally(()=>setLoading(false));},[refreshMe]);
  useEffect(()=>{if(learner?.certificate_token)QRCode.toDataURL(location.origin+"/verify/"+learner.certificate_token+"?lang="+lang,{margin:1,width:260,color:{dark:"#173046",light:"#ffffff"}}).then(setQr).catch(()=>setQr(""));},[learner?.certificate_token,lang]);
  useEffect(()=>{
    type ToolContext={registerTool:(tool:{name:string;title:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>unknown},options:{signal:AbortSignal})=>void|Promise<void>};
    const context=(document as Document & {modelContext?:ToolContext}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    void Promise.resolve(context.registerTool({
      name:"open_induction_chapter",title:"Open induction chapter",description:"Open one of the six Primark sample induction chapters in the learner view.",
      inputSchema:{type:"object",properties:{chapter:{type:"string",enum:modules.map(m=>m.key)}},required:["chapter"],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input){const key=(input as {chapter?:string})?.chapter;const index=modules.findIndex(m=>m.key===key);if(index<0)throw new Error("Unknown chapter.");if(!learner)throw new Error("Join the induction first.");setArea("learn");setModuleIndex(index);setScreen("module");return {opened:modules[index].title};},
    },{signal:lifecycle.signal})).catch(()=>{});
    return ()=>lifecycle.abort();
  },[learner]);
  async function run(fn:()=>Promise<void>){setBusy(true);setError("");try{await fn();}catch(e){setError(e instanceof Error?e.message:"Please try again.");}finally{setBusy(false);}}
  const complete=!!learner?.completed_at;
  const nextChapter=shownModules.findIndex(m=>!viewed.includes(m.key));

  return <div className={"shell"+(!account&&!loading?" login-screen":"")} lang={lang} dir={languageDirection(lang)}>
    <header className="topbar"><div className="topbar-brand"><button className="brand" onClick={()=>{setArea(platformAdmin?"report":"learn");setScreen("home");}}><strong>PRIMARK</strong></button>{reportingAccess&&<nav aria-label={t("Primary menu")}><button className={area==="report"?"active":""} aria-current={area==="report"?"page":undefined} onClick={()=>setArea("report")}>{t("Learning Overview")}</button></nav>}</div><div className="top-controls"><LanguagePicker/><ProfileMenu account={account} view={area} filter={{role,country:scopeCountry,site:scopeSite}} onOpen={()=>{void refreshMe().catch(()=>{});}}
      onViewChange={next=>{if(next==="learn"||next==="report"){setArea(next);}else location.assign(profileHref(next));}}
      onFilterChange={next=>{setRole(next.role);setScopeCountry(next.country);setScopeSite(next.site);setArea("report");}}
      onSignOut={async()=>{if(platformAdmin){const response=await fetch("/api/admin/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"logout"})});if(!response.ok)throw new Error("Could not sign out. Please try again.");}else await post("logout");await refreshMe();setArea("learn");setScreen("home");}}/></div></header>
    <main className="main">
    {error&&<div className="error" role="alert">{t(error)}<button onClick={()=>setError("")} aria-label={t("Dismiss error")}>×</button></div>}
    {(area==="learn"||!reportingAccess) ? loading?<div className="paper loading">{t("Loading induction…")}</div> : !learner?
      <div className="entry">
        <div className="entry-copy"><span className="eyebrow">{t("FOR NEW STORE COLLEAGUES")}</span><h1>{t("Start safe.")}<br/>{t("Feel ready for day one.")}</h1><p>{t("Your safety training, ready when you are.")}</p><div className="steps"><span><b>01</b> {t("Choose your store")}</span><span><b>02</b> {t("Learn at your pace")}</span><span><b>03</b> {t("Show your pass")}</span></div><div className="soft-note"><ShieldCheck/>{t("Your progress is saved so you can come back.")}</div></div>
        <AuthForm lang={lang} busy={busy} onAuthenticate={(action,fields)=>{void run(async()=>{const result=await post(action,{...fields,returnTo:new URLSearchParams(location.search).get("returnTo")});if(result.returnTo){location.assign(result.returnTo);return;}setArea("learn");setScreen("courses");await refreshMe();});}}/>
      </div> :
      <div className="learn-layout"><aside className="sidebar"><small>{t("YOUR LEARNING")}</small><button className={screen==="courses"?"selected":""} onClick={()=>setScreen("courses")}><LayoutGrid/>{t("My Courses")}</button>{!learner.induction_enrolled&&<><hr className="course-divider"/><button className={screen==="home"?"selected":""} onClick={()=>setScreen("home")}><BookOpen/>{t("Safety Passport")}</button>{shownModules.map((m,i)=><button key={m.key} className={"chapter-nav "+(screen==="module"&&moduleIndex===i?"selected":"")} onClick={()=>{setModuleIndex(i);setScreen("module");}}><span className={"number "+(viewed.includes(m.key)?"checked":"")}>{viewed.includes(m.key)?<Check/>:i+1}</span>{m.short}</button>)}<button className={screen==="quiz"?"selected":""} onClick={()=>{setScreen("quiz");setQuestionIndex(0);}}><ClipboardCheck/>{t("Assessment")}</button>{complete&&<button className={screen==="pass"?"selected":""} onClick={()=>setScreen("pass")}><ShieldCheck/>{t("My Safety Passport")}</button>}</>}</aside>
        <div className="learner-main">

          {screen==="home"&&<section><div className="welcome"><h1>{t("Hello,")} {learner.name.split(" ")[0]}.</h1>{!complete&&<div className="progress-count"><strong>{viewed.length}<small>/6</small></strong><span>{t("chapters viewed")}</span></div>}</div>
            {!complete&&<div className="next-step"><div><span className="eyebrow">{nextChapter<0?t("Final assessment"):t("Continue learning")}</span><h2>{nextChapter<0?t("Show what you know."):shownModules[nextChapter].title}</h2></div><Button className="blue-button" onClick={()=>{if(nextChapter<0){setQuestionIndex(0);setScreen("quiz");}else{setModuleIndex(nextChapter);setScreen("module");}}}>{nextChapter<0?t("Open assessment"):viewed.length?t("Continue learning"):t("Open chapter")}</Button></div>}
            {legacyCompleted&&<div className="legacy-note"><CheckCircle2/>{t("A completion from the previous LMS is on your record, shown separately.")}</div>}
            {complete&&<button className="pass-callout" onClick={()=>setScreen("pass")}><span><Check/></span><strong>{t("Your Primark Safety Passport is ready")}</strong><b>{t("View my pass")}</b></button>}
            <div className="section-title"><h2>{t("Six short chapters")}</h2></div><div className="module-grid">{shownModules.map((m,i)=>{const isViewed=viewed.includes(m.key);return <button className="module-card lesson-tile" key={m.key} aria-label={`${m.title}. ${isViewed?t("Viewed")+". "+t("View again"):t("Open chapter")}`} onClick={()=>{setModuleIndex(i);setScreen("module");}}><img src={`/lesson-covers/chapter-${i+1}.webp`} width="1280" height="720" alt="" loading="lazy" decoding="async"/>{lang!=="en"&&<strong className="localized-lesson-title">{m.title}</strong>}<span className="lesson-tile-footer"><small>{isViewed?"✓ "+t("Viewed"):formatDuration(m.duration,lang)}</small><span>{isViewed?t("View again"):t("Open chapter")} <span aria-hidden="true">→</span></span></span></button>})}<button className="module-card assessment-tile" onClick={()=>{setScreen("quiz");setQuestionIndex(0);}}><ClipboardCheck/><strong>{t("Final assessment")}</strong><small>{(learner.best_score||0)>=18?t("Passed"):t("Open assessment")}</small></button></div>
          </section>}
          {screen==="courses"&&<section className="courses-page">
            <span className="eyebrow">{t("YOUR LEARNING")}</span><h1>{t("My Courses")}</h1>
            {!learner.induction_enrolled&&<button className="course-feature" onClick={()=>setScreen(complete?"pass":"home")}>
              <Image src={safetyPassCover} alt="" placeholder="blur" loading="eager" fetchPriority="high" sizes="(max-width: 760px) calc(100vw - 36px), (max-width: 1340px) calc(43vw - 135px), 420px" />
              <span className="course-feature-copy"><small>{complete?t("Completed"):t("Available now")}</small><strong>{t("Primark Safety Passport")}</strong><span>{complete?t("View my pass"):t("Continue learning")}</span></span>
            </button>}
            <AssignedCourses/>{!learner.induction_enrolled&&<><div className="section-title"><h2>{t("More courses")}</h2><span>{t("Coming soon")}</span></div>
            <div className="course-catalog-grid">{sampleCourses.map((course,index)=><article className="course-tile" key={course.image}>
              <Image src={course.cover} alt="" placeholder="blur" loading={index<2?"eager":"lazy"} sizes="(max-width: 760px) calc(100vw - 36px), (max-width: 1340px) calc(50vw - 178px), 480px"/>
              <div><small>{t("Coming soon")}</small><h3>{t(course.title)}</h3>{course.image==="manual-handling"&&<p>{t("Includes a practical element")}</p>}</div>
            </article>)}</div></>}
          </section>}
          {screen==="module"&&<section className="chapter"><button className="back" onClick={()=>setScreen("home")}><ArrowLeft/>{t("All chapters")}</button><span className="eyebrow">{t("CHAPTER")} {String(moduleIndex+1).padStart(2,"0")} {t("OF 06")} · {formatDuration(modules[moduleIndex].duration,lang)}</span><h1>{shownModules[moduleIndex].title}</h1><p>{shownModules[moduleIndex].description}</p>{modules[moduleIndex].key==="manual"&&<p className="course-separate-note">{t("This is an introduction only. Manual Handling is a separate course with a practical element.")}</p>}{moduleIndex===0?<video className="chapter-video" lang="en" dir="ltr" controls playsInline preload="metadata" poster="/lesson-covers/chapter-1.webp" aria-label={shownModules[moduleIndex].title}><source src="/videos/chapter-1.mp4" type="video/mp4"/><track kind="captions" src="/videos/chapter-1.en.vtt" srcLang="en" label="English" default/></video>:<div className="video-placeholder"><div className="play"><Play fill="currentColor"/></div><strong>{t("SYNTHESIA VIDEO GOES HERE")}</strong><small>{t("SAMPLE CHAPTER · VIDEO CONTENT WILL BE ADDED LATER")}</small><span><Video/> {formatDuration(modules[moduleIndex].duration,lang)} {t("estimated")}</span></div>}<div className="paper remember"><h2>{t("Remember")}</h2>{shownModules[moduleIndex].points.map(p=><p key={p}><CheckCircle2/>{p}</p>)}</div><div className="chapter-actions"><Button className="blue-button" disabled={busy} onClick={()=>run(async()=>{await post("view",{key:modules[moduleIndex].key});await refreshMe();if(moduleIndex<5)setModuleIndex(moduleIndex+1);else setScreen("home");})}>{viewed.includes(modules[moduleIndex].key)?t("Next chapter"):t("Mark sample chapter viewed")}</Button><small>{t("You can open any chapter at any time.")}</small></div></section>}
          {screen==="quiz"&&<section className="quiz"><button className="back" onClick={()=>setScreen("home")}><ArrowLeft/>{t("Back to induction")}</button><span className="eyebrow">{t("FINAL ASSESSMENT · SAMPLE QUESTIONS")}</span><h1>{t("Show what you know.")}</h1><p>{t("Answer all 20 questions. You need 18 correct to pass.")}</p><div className="quiz-count"><span>{t("Question")} {questionIndex+1} {t("of")} 20</span><span>{answers.filter(x=>x>=0).length} {t("answered")}</span></div><Progress value={(questionIndex+1)*5}/><div className="paper question"><span>{String(questionIndex+1).padStart(2,"0")}</span><h2>{shownQuestions[questionIndex].q}</h2>{shownQuestions[questionIndex].a.map((answer,i)=><button key={answer} className={answers[questionIndex]===i?"chosen":""} onClick={()=>setAnswers(prev=>{const next=[...prev];next[questionIndex]=i;return next;})}><i/>{answer}</button>)}</div><div className="quiz-buttons"><Button variant="outline" disabled={questionIndex===0} onClick={()=>setQuestionIndex(questionIndex-1)}>{t("Previous")}</Button>{questionIndex<19?<Button className="blue-button" onClick={()=>setQuestionIndex(questionIndex+1)}>{t("Next question")}</Button>:<Button className="blue-button" disabled={busy||answers.some(x=>x<0)} onClick={()=>run(async()=>{const r=await post("submit",{answers});setResult(r);setScreen("result");await refreshMe();})}>{t("Submit answers")}</Button>}</div></section>}
          {screen==="result"&&result&&<div className="paper result"><div className={"result-mark "+(result.passed?"passed":"failed")}>{result.passed?<Check/>:"↻"}</div><span className="eyebrow">{t("ASSESSMENT RESULT")}</span><h1>{result.passed?t("You passed. Well done."):t("You can try again.")}</h1><p>{t("You scored")} <strong>{result.score}/20</strong>. {t("The pass mark is 18/20.")}</p>{result.passed&&viewed.length<6&&<p>{t("View all six chapters to get your Safety Passport.")}</p>}<Button className="blue-button" onClick={()=>{setAnswers(Array(20).fill(-1));setQuestionIndex(0);setScreen(result.passed?"home":"quiz");}}>{result.passed?t("Back to chapters"):t("Retry assessment")}</Button>{complete&&<Button variant="outline" onClick={()=>setScreen("pass")}>{t("View my pass")}</Button>}</div>}
          {screen==="pass"&&(complete?<Pass learner={learner} qr={qr} lang={lang}/>:<div className="paper result"><ShieldCheck/><h2>{t("Your pass is almost ready")}</h2><p>{t("View all six chapters and pass the assessment.")}</p><Button onClick={()=>setScreen("home")}>{t("Back to induction")}</Button></div>)}
        </div></div>
    : <TrainingReporting key={account?.email||"report"} access={reportingAccess} platformAdmin={platformAdmin} filter={{role,country:scopeCountry,site:scopeSite}} onFilterChange={next=>{setRole(next.role);setScopeCountry(next.country);setScopeSite(next.site);}} lang={lang}/>}
    </main><footer><strong><bdi dir="ltr">PRIMARK</bdi> · {t("Safety Passport")}</strong>{platformAdmin&&<a href="/admin/courses/">{t("Platform admin")}</a>}<span>{t("Private working prototype · Sample content is not approved training")}</span></footer>
  </div>;
}

function Pass({learner}:{learner:Learner;qr:string;lang:Language}){
  const {t}=useLanguage();
  const [record,setRecord]=useState<Certificate|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;fetch('/api/certificates',{cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);const certificate=data.certificates.find((c:Certificate)=>c.token===learner.certificate_token);if(!certificate)throw new Error('Your certificate could not be found. Please reload and try again.');if(active)setRecord(certificate);}).catch(e=>{if(active)setError(e.message);});return ()=>{active=false;};},[learner.certificate_token]);
  return error?<p role="alert">{t(error)}</p>:record?<CertificatePaper record={record}/>:<p role="status">{t("Loading your certificate…")}</p>;
}
