import {inTransaction} from '@/lib/database';
import {getAdminUser} from '@/lib/admin-auth';
import { NextRequest } from 'next/server';
import { db } from '@/lib/server';
import { photoBucket } from '@/lib/shot-server';
import { bodyJson, failed, getCourse, getPackage, json, now, requireAdmin, CourseError } from '@/lib/course-admin';
import { MAX_FILE, MAX_TOTAL, validPath } from '@/lib/course-types';
import { parseManifest } from '@/lib/scorm-manifest';
export const dynamic='force-dynamic';
export async function POST(request: NextRequest) { try {
  await requireAdmin(request); const b=await bodyJson(request);
  if(b.action==='finish') {
    const pack=await getPackage(b.id); if(!pack || pack.status!=='uploading') throw new CourseError('Upload not found or already finished.');
    const course=await getCourse(pack.course_id); if(!course || course.status!=='draft') throw new CourseError('Pause the course before replacing its package.',409);
    const files=await db().prepare('SELECT path,uploaded FROM course_files WHERE package_id=?').bind(pack.id).all<{path:string;uploaded:number}>();
    if(files.results.length!==pack.file_count || files.results.some(f=>!f.uploaded)) throw new CourseError('Some files have not finished uploading. Retry the upload.');
    const manifest=await photoBucket().get(`scorm/${pack.id}/imsmanifest.xml`);
    if(!manifest || manifest.size>1000000) throw new CourseError('A valid imsmanifest.xml is required at the root of the ZIP.');
    let scos; try { scos=parseManifest(await manifest.text(),new Set(files.results.map(f=>f.path))); } catch(e) { throw new CourseError((e as Error).message); }
    await inTransaction(async tx=>{
      await tx.query("SELECT set_config('app.audit_actor',$1,true)",[(await getAdminUser())!.email]);
      const changed=await db().prepare("UPDATE courses SET package_id=?,revision=revision+1,updated_at=? WHERE id=? AND status='draft' AND revision=?").bind(pack.id,now(),course.id,course.revision).execute(tx);
      if(!changed.rowCount)throw new CourseError('The course changed during upload. Reload before continuing.',409);
      await db().prepare("UPDATE course_packages SET status='ready',scos_json=? WHERE id=?").bind(JSON.stringify(scos),pack.id).execute(tx);
    });
    const current=await getCourse(course.id); if(current?.package_id!==pack.id) throw new CourseError('The course changed during upload. Reload before continuing.',409);
    return json({package:await getPackage(pack.id),course:current});
  }
  const course=await getCourse(b.courseId); if(!course) throw new CourseError('Save the course before uploading.');
  if(course.status!=='draft') throw new CourseError('Pause this course before changing its SCORM package.');
  if(typeof b.filename!=='string'||!b.filename.toLowerCase().endsWith('.zip')||b.filename.length>255) throw new CourseError('Choose a SCORM ZIP file.');
  const files=b.files as {path:string;size:number}[];
  if(!Array.isArray(files)||!files.length||files.length>5000) throw new CourseError('A package can contain up to 5,000 files.');
  if(files.some(f=>!validPath(f.path)||!Number.isSafeInteger(f.size)||f.size<0||f.size>MAX_FILE)) throw new CourseError('The ZIP contains an unsafe path or a file over 100 MB.');
  const total=files.reduce((n,f)=>n+f.size,0);
  if(total>MAX_TOTAL || new Set(files.map(f=>f.path)).size!==files.length) throw new CourseError('The ZIP is too large or contains duplicate file paths.');
  if(!files.some(f=>f.path==='imsmanifest.xml'&&f.size<=1000000)) throw new CourseError('imsmanifest.xml must be at the root of the ZIP.');
  const id=crypto.randomUUID();
  await db().prepare('INSERT INTO course_packages(id,course_id,filename,file_count,total_bytes,created_at) VALUES(?,?,?,?,?,?)').bind(id,course.id,b.filename,files.length,total,now()).run();
  for(let i=0;i<files.length;i+=80) await db().batch(files.slice(i,i+80).map(f=>db().prepare('INSERT INTO course_files(package_id,path,size) VALUES(?,?,?)').bind(id,f.path,f.size)));
  return json({id});
} catch(e) {return failed(e);} }
