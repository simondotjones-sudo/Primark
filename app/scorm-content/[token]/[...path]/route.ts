import { learnerOnlySql } from '@/lib/account-type';
import { NextRequest } from 'next/server';
import { db, now } from '@/lib/server';
import { photoBucket } from '@/lib/shot-server';
import { validPath } from '@/lib/course-types';
import { installScormRuntime } from '@/lib/scorm-runtime';
export const dynamic='force-dynamic';
const mime:Record<string,string>={html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',js:'application/javascript',mjs:'application/javascript',css:'text/css',json:'application/json',xml:'application/xml',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',vtt:'text/vtt',pdf:'application/pdf',wasm:'application/wasm'};
export async function GET(request:NextRequest,context:{params:Promise<{token:string;path:string[]}>}) {try {
 const {token,path:parts}=await context.params;const path=parts.join('/');if(!validPath(path))return new Response('Invalid path',{status:400});
 const launch=await db().prepare(`SELECT package_id,seed_json FROM scorm_launches WHERE token=? AND expires_at>? AND (preview=1 OR EXISTS(SELECT 1 FROM learners l WHERE l.id=scorm_launches.learner_id AND ${learnerOnlySql()}))`).bind(token,now()).first<{package_id:string;seed_json:string}>();
 if(!launch)return new Response('This course session has expired. Reopen it from My Courses.',{status:401});
 const ext=path.split('.').pop()?.toLowerCase()||'';const isHtml=ext==='html'||ext==='htm';
 const key=`scorm/${launch.package_id}/${path}`;
 if(!isHtml&&request.headers.get('x-primark-storage-descriptor')==='1')return Response.json({key,headers:{'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-downloads; worker-src 'none'; object-src 'none'; base-uri 'none'"}},{headers:{'Cache-Control':'private, no-store'}});
 const object=await photoBucket().get(key,isHtml?undefined:{range:request.headers});if(!object)return new Response('Course file not found',{status:404});
 // SCORM drivers use same-origin nested frames (e.g. Rustici blank.html/AICCComm.html).
 // Packages are executable content uploaded only by the verified platform owner.
 // Keep sandbox navigation limits; opaque frame origins prevent the course from booting.
 const headers=new Headers({'Content-Type':mime[ext]||'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','Content-Security-Policy':"sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-downloads; worker-src 'none'; object-src 'none'; base-uri 'none'"});
 if(isHtml){if(object.size>5*1024*1024)return new Response('Course HTML file is too large',{status:413});const source=await object.text();const script=`<script>(${installScormRuntime.toString()})(${JSON.stringify({seed:JSON.parse(launch.seed_json),token}).replace(/</g,'\\u003c')});</script>`;const html=/<head(?:\s[^>]*)?>/i.test(source)?source.replace(/<head(?:\s[^>]*)?>/i,m=>m+script):script+source;return new Response(html,{headers});}
 headers.set('Accept-Ranges','bytes');const range=object.range;if(range&&'offset' in range&&'length' in range&&typeof range.offset==='number'&&typeof range.length==='number'){headers.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${object.size}`);headers.set('Content-Length',String(range.length));return new Response(object.body,{status:206,headers});}headers.set('Content-Length',String(object.size));return new Response(object.body,{headers});
 }catch(error){console.error('SCORM content failed',error);return new Response('Course content is temporarily unavailable.',{status:503});} }
export function OPTIONS(){return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Range'}});}
