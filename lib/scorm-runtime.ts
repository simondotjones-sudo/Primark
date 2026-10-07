// Self-contained: this function is injected before the course's own scripts.
export function installScormRuntime(config: {seed:Record<string,string>;token:string}) {
  // Let the outer player reveal the package at DOM readiness, instead of waiting
  // for every image, video and nested frame to finish the window load event.
  if(typeof document!=='undefined'){
    const ready=()=>window.parent.postMessage({type:'primark-scorm-ready',token:config.token},'*');
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
  }
  // Nested driver/content documents share one synchronous SCORM API and state.
  // Separate adapters in each helper frame can overwrite the learner's real progress.
  try {
    const parentApi = (window.parent as any).__primarkScormRuntime;
    if (window.parent !== window && parentApi?.token === config.token && parentApi.api) {
      (window as any).API = parentApi.api;
      (window as any).__primarkScormRuntime = parentApi;
      return;
    }
  } catch { /* A cross-origin parent is not part of this SCORM launch. */ }
  const data:Record<string,string>={...config.seed};
  let initialized=false, finished=false, error='0';
  const errors:Record<string,string>={'0':'No error','101':'General exception','201':'Invalid argument error','202':'Element cannot have children','203':'Element not an array','301':'Not initialized','401':'Not implemented error','402':'Invalid set value, element is a keyword','403':'Element is read only','404':'Element is write only','405':'Incorrect data type'};
  const readonly=new Set(['cmi.core.student_id','cmi.core.student_name','cmi.core.credit','cmi.core.entry','cmi.core.lesson_mode','cmi.core.total_time','cmi.launch_data','cmi.student_data.mastery_score','cmi.student_data.max_time_allowed','cmi.student_data.time_limit_action','cmi.comments_from_lms']);
  const writeonly=new Set(['cmi.core.exit','cmi.core.session_time']);
  const children:Record<string,string>={'cmi.core':'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time','cmi.core.score':'raw,min,max','cmi.student_data':'mastery_score,max_time_allowed,time_limit_action','cmi.student_preference':'audio,language,speed,text','cmi.objectives':'id,score,status','cmi.interactions':'id,objectives,time,type,correct_responses,weighting,student_response,result,latency'};
  const fail=(code:string,value='false')=>{error=code;return value;};
  const suspend=()=>{if(!['completed','passed'].includes(data['cmi.core.lesson_status']))data['cmi.core.exit']='suspend';};
  const send=()=>window.parent.postMessage({type:'primark-scorm-save',token:config.token,data:{...data}},'*');
  // Retain scoped relays for legacy nested messages; normal children share this API.
  window.addEventListener('message',e=>{if(e.source!==window.parent && e.data?.token===config.token && e.data?.type==='primark-scorm-save'){Object.assign(data,e.data.data);window.parent.postMessage(e.data,'*');}});
  const known=(key:string)=>key in data || key in children || /^cmi\.(objectives\.\d+\.(id|status|score\.(raw|min|max))|interactions\.\d+\.(id|time|type|weighting|student_response|result|latency|objectives\.\d+\.id|correct_responses\.\d+\.pattern))$/.test(key);
  const api={
    LMSInitialize(arg:string){if(arg!=='')return fail('201');if(initialized||finished)return fail('101');initialized=true;error='0';return 'true';},
    LMSFinish(arg:string){if(arg!=='')return fail('201');if(!initialized||finished)return fail('301');send();finished=true;error='0';return 'true';},
    LMSGetValue(key:string){if(!initialized||finished)return fail('301','');if(writeonly.has(key)||key.startsWith('cmi.interactions.')&&!key.endsWith('._count')&&!key.endsWith('._children'))return fail('404','');
      error='0';if(key.endsWith('._children'))return children[key.slice(0,-10)]??fail('202','');
      if(key.endsWith('._count')){const base=key.slice(0,-7);if(!/^cmi\.(objectives|interactions)(\.\d+\.(objectives|correct_responses))?$/.test(base))return fail('203','');const ids=Object.keys(data).filter(k=>k.startsWith(base+'.')).map(k=>Number(k.slice(base.length+1).split('.')[0])).filter(Number.isInteger);return String(ids.length?Math.max(...ids)+1:0);}
      if(!known(key))return fail('401','');return data[key]??'';},
    LMSSetValue(key:string,value:unknown){if(!initialized||finished)return fail('301');if(typeof key!=='string')return fail('201');if(readonly.has(key))return fail('403');if(key.endsWith('._children')||key.endsWith('._count'))return fail('402');if(!known(key))return fail('401');
      const v=String(value);if(v.length>4096||(key==='cmi.core.lesson_location'&&v.length>255))return fail('405');
      if(key==='cmi.core.lesson_status'&&!['passed','completed','failed','incomplete','browsed','not attempted'].includes(v))return fail('405');
      if(key==='cmi.core.exit'&&!['time-out','suspend','logout',''].includes(v))return fail('405');
      if(key==='cmi.core.session_time'&&!/^\d{2,4}:[0-5]\d:[0-5]\d(?:\.\d{1,2})?$/.test(v))return fail('405');
      if(/\.score\.(raw|min|max)$/.test(key)&&v!==''&&!Number.isFinite(Number(v)))return fail('405');
      data[key]=v;error='0';return 'true';},
    LMSCommit(arg:string){if(arg!=='')return fail('201');if(!initialized||finished)return fail('301');send();error='0';return 'true';},
    LMSGetLastError(){return error;},LMSGetErrorString(code:string){return errors[code]||'Unknown error';},LMSGetDiagnostic(code:string){return errors[code||error]||'Unknown error';},
  };
  (window as any).API=api;
  (window as any).__primarkScormRuntime={token:config.token,api};
  window.addEventListener('message',e=>{if(e.source===window.parent&&e.data?.type==='primark-scorm-flush'&&e.data?.token===config.token){
    if(initialized&&!finished)suspend();
    // All nested frames share this API. Acknowledge one authoritative snapshot;
    // the player waits for its server save before leaving or changing lessons.
    window.parent.postMessage({type:'primark-scorm-flushed',token:config.token,requestId:e.data.requestId,data:initialized?{...data}:null},'*');
  }});
  window.addEventListener('pagehide',()=>{if(initialized&&!finished){suspend();send();}});
  setInterval(()=>{if(initialized&&!finished)send();},15000);
}
export function initialData(id:string,name:string,mastery:string,launchData:string,old:Record<string,string>={},total='0000:00:00.00') {
  return {'cmi.core.lesson_location':'','cmi.core.lesson_status':'not attempted','cmi.core.score.raw':'','cmi.core.score.min':'','cmi.core.score.max':'','cmi.suspend_data':'','cmi.comments':'','cmi.comments_from_lms':'','cmi.student_preference.audio':'0','cmi.student_preference.language':'','cmi.student_preference.speed':'100','cmi.student_preference.text':'0',...old,'cmi.core.student_id':id,'cmi.core.student_name':name,'cmi.core.credit':'credit','cmi.core.entry':old['cmi.core.exit']==='suspend'?'resume':Object.keys(old).length?'':'ab-initio','cmi.core.lesson_mode':'normal','cmi.core.total_time':total,'cmi.core.session_time':'0000:00:00.00','cmi.core.exit':'','cmi.launch_data':launchData,'cmi.student_data.mastery_score':mastery,'cmi.student_data.max_time_allowed':'','cmi.student_data.time_limit_action':'continue,no message'};
}
export function timeCentiseconds(time:string) { const match=/^(\d{2,4}):([0-5]\d):([0-5]\d)(?:\.(\d{1,2}))?$/.exec(time); return match ? ((+match[1]*3600 + +match[2]*60 + +match[3])*100+ +(match[4]||'0').padEnd(2,'0')) : 0; }
export function timeString(n:number) { const s=Math.floor(n/100); return `${String(Math.floor(s/3600)).padStart(4,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`; }
