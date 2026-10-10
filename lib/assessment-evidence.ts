import {getStore} from '@netlify/blobs';
import {createHash} from 'node:crypto';
import buildContext from './deploy-context.json';
import {db} from '@/lib/database';
import {CourseError} from '@/lib/course-admin';

export const MAX_EVIDENCE_BYTES=3*1024*1024;
export const MAX_EVIDENCE_FILES=5;
export const evidenceColumns='id,filename,mime_type,size,uploaded_at,state';
export type Evidence={id:string;assignment_id:string;assessment_id:string|null;uploaded_by:string;filename:string;mime_type:string;size:number;sha256:string;storage_context:string;state:string;uploaded_at:string};
export function evidenceContext(){return buildContext.context==='production'?'production':`preview-${buildContext.branch}`;}
export function evidenceStore(context=evidenceContext(),write=false){
 const current=evidenceContext();
 if(context!==current&&(write||context!=='production'||buildContext.context==='dev'||current==='production'))throw new CourseError('Evidence is not available.',404);
 return getStore({name:`primark-evidence-${context}`,consistency:'strong'});
}
export async function requireEvidenceAssignment(assignmentId:string,actorId:string){
 const row=await db().prepare(`SELECT h.id FROM assignment_history h JOIN learners l ON l.id=h.learner_id
 WHERE h.id=? AND h.assessor_required AND h.theory_completed_at IS NOT NULL AND h.passed_assessment_id IS NULL
 AND h.cancelled_at IS NULL AND h.superseded_at IS NULL AND l.archived_at IS NULL AND l.id<>?
 AND EXISTS(SELECT 1 FROM course_assignments a WHERE a.history_id=h.id)
 AND EXISTS(SELECT 1 FROM learners actor WHERE actor.id=? AND actor.archived_at IS NULL)
 AND EXISTS(SELECT 1 FROM assessor_accounts a WHERE a.learner_id=?)
 AND EXISTS(SELECT 1 FROM assessor_grants g WHERE g.learner_id=? AND g.course_id=h.course_id AND g.active
 AND (g.expires_on IS NULL OR g.expires_on>=CURRENT_DATE) AND (g.site_id='*' OR g.site_id=l.store_id))`)
 .bind(assignmentId,actorId,actorId,actorId,actorId).first();
 if(!row)throw new CourseError('This assessment is not available to you.',403);
}
export async function evidenceFile(file:File){
 if(file.size<1||file.size>MAX_EVIDENCE_BYTES)throw new CourseError('Each evidence file must be no larger than 3 MB.',413);
 const bytes=await file.arrayBuffer(),b=new Uint8Array(bytes),text=new TextDecoder().decode(b.slice(0,64));
 const mime=b[0]===255&&b[1]===216&&b[2]===255?'image/jpeg':
 [137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)?'image/png':
 text.startsWith('%PDF-')?'application/pdf':
 text.slice(0,4)==='RIFF'&&text.slice(8,12)==='WEBP'?'image/webp':
 text.slice(4,8)==='ftyp'&&/heic|heix|hevc|hevx|mif1|msf1/.test(text.slice(8))?'image/heic':null;
 if(!mime)throw new CourseError('Use a PDF, JPEG, PNG, WebP or HEIC file.');
 const ext=({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic'} as Record<string,string>)[mime];
 const base=file.name.replace(/[\u0000-\u001f\u007f/\\<>"\u202a-\u202e\u2066-\u2069]/g,'_').replace(/\.[^.]*$/,'').trim().slice(0,150)||'evidence';
 return {bytes,mime,filename:base+'.'+ext,sha256:createHash('sha256').update(new Uint8Array(bytes)).digest('hex')};
}
export async function readEvidenceForm(request:Request){
 if(!request.body)throw new CourseError('Choose an evidence file.');
 const limit=MAX_EVIDENCE_BYTES+65536;
 if(Number(request.headers.get('content-length'))>limit)throw new CourseError('Each evidence file must be no larger than 3 MB.',413);
 const reader=request.body.getReader();let size=0;
 const stream=new ReadableStream<Uint8Array>({async pull(controller){const part=await reader.read();if(part.done){controller.close();return;}size+=part.value.byteLength;if(size>limit){controller.error(new CourseError('Each evidence file must be no larger than 3 MB.',413));await reader.cancel();return;}controller.enqueue(part.value);},cancel(reason){return reader.cancel(reason);}});
 try{return await new Response(stream,{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();}
 catch(e){if(e instanceof CourseError)throw e;throw new CourseError('Choose an evidence file.');}
}
