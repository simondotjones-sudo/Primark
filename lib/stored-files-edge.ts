import type { Context, Config } from '@netlify/edge-functions';
import { photoBucket, InvalidRange } from './storage.ts';
// Authorisation stays in the application; file bytes stream at the edge to avoid
// the 20 MB serverless response ceiling. Never trust a caller-supplied object key.
export default async (request: Request, context: Context) => {
  if(!['GET','HEAD'].includes(request.method))return context.next();
  if(new URL(request.url).pathname.startsWith('/scorm-content/')&&/\.html?$/i.test(new URL(request.url).pathname))return context.next();
  try {
    const headers=new Headers(request.headers);headers.set('x-primark-storage-descriptor','1');
    const checked=await context.next(new Request(request.url,{method:'GET',headers}));
    if(!checked.ok)return checked;
    const descriptor=await checked.json() as {key:string;headers:Record<string,string>};
    if(typeof descriptor.key!=='string'||!descriptor.headers)return new Response('File not available',{status:503});
    const object=await photoBucket().get(descriptor.key,{range:request.headers});
    if(!object)return new Response('File not found',{status:404,headers:{'Cache-Control':'private, no-store'}});
    const result=new Headers(descriptor.headers);result.set('Accept-Ranges','bytes');
    if(object.range)result.set('Content-Range',`bytes ${object.range.offset}-${object.range.offset+object.range.length-1}/${object.size}`);
    result.set('Content-Length',String(object.range?.length??object.size));
    return new Response(request.method==='HEAD'?null:object.body,{status:object.range?206:200,headers:result});
  }catch(error){if(error instanceof InvalidRange)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${error.size}`}});console.error('File delivery failed',error);return new Response('File temporarily unavailable',{status:503});}
};
export const config: Config = {path:['/scorm-content/*','/api/shot-list/photos/*']};
