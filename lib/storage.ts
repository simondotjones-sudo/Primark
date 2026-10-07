import { getStore } from '@netlify/blobs';
import buildContext from './deploy-context.json' with { type: 'json' };
export const CHUNK_SIZE = 2 * 1024 * 1024;
type Manifest = { size: number; chunks: number };
type Store = Pick<ReturnType<typeof getStore>, 'get' | 'set' | 'setJSON'>;
async function objectId(key: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))), b=>b.toString(16).padStart(2,'0')).join(''); }
export class InvalidRange extends Error { constructor(public size: number) { super('Requested range is not available.'); } }
export function byteRange(header: string | null, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) throw new InvalidRange(size);
  const offset = match[1] ? Number(match[1]) : Math.max(0,size-Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size-1,Number(match[2])) : size-1) : size-1;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset<0 || offset>=size || end<offset) throw new InvalidRange(size);
  return { offset, length: end-offset+1 };
}
// Production objects and preview objects never share a writable namespace.
// A preview can read immutable production files referenced by its database snapshot.
function stores() {
  const primary = getStore({name:'primark-files',consistency:'strong'});
  const context = buildContext.context;
  if (context === 'production') return { current: primary, fallback: undefined };
  const safe = buildContext.branch;
  return { current: getStore({name:`primark-preview-${safe}`,consistency:'strong'}), fallback: context === 'dev' || !context ? undefined : primary };
}
export function createBucket(current: Store, fallback?: Store) {
  async function locate(key: string) {
    const id=await objectId(key);
    let store=current, meta=await current.get(`objects/${id}`,{type:'json'}) as Manifest|null;
    if(!meta&&fallback){store=fallback;meta=await fallback.get(`objects/${id}`,{type:'json'}) as Manifest|null;}
    return meta?{id,meta,store}:null;
  }
  return {
    async writeChunk(key: string, index: number, bytes: ArrayBuffer) {
      const id=await objectId(key);
      await current.set(`parts/${id}/${index}`,bytes);
      await current.setJSON(`sizes/${id}/${index}`,{size:bytes.byteLength});
    },
    async complete(key: string, size: number) {
      const id=await objectId(key), count=Math.max(1,Math.ceil(size/CHUNK_SIZE));
      for(let i=0;i<count;i++){
        const part=await current.get(`sizes/${id}/${i}`,{type:'json'}) as {size:number}|null;
        if(!part||part.size!==Math.min(CHUNK_SIZE,size-i*CHUNK_SIZE)) throw new Error('Some file parts have not finished uploading. Retry the file.');
      }
      await current.setJSON(`objects/${id}`,{size,chunks:count});
    },
    async put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>, _options?: unknown) {
      const bytes = value instanceof ArrayBuffer ? value : await new Response(value as BodyInit).arrayBuffer();
      for(let i=0;i<Math.max(1,Math.ceil(bytes.byteLength/CHUNK_SIZE));i++)await this.writeChunk(key,i,bytes.slice(i*CHUNK_SIZE,(i+1)*CHUNK_SIZE));
      await this.complete(key,bytes.byteLength);
    },
    async head(key: string) { const located=await locate(key);return located?{size:located.meta.size}:null; },
    async get(key: string, options?: { range: Headers }) {
      const found=await locate(key);if(!found)return null;
      const {id,meta,store}=found, range=byteRange(options?.range.get('range')??null,meta.size);
      const start=range?.offset??0,end=range?start+range.length:meta.size;
      function stream() {
        let part=Math.floor(start/CHUNK_SIZE),position=start;
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            if(position>=end){controller.close();return;}
            try {
              const data=await store.get(`parts/${id}/${part}`,{type:'arrayBuffer'}) as ArrayBuffer|null;
              if(!data)throw new Error('Stored file part is missing.');
              const from=position-part*CHUNK_SIZE,to=Math.min(data.byteLength,end-part*CHUNK_SIZE);
              if(to<=from)throw new Error('Stored file part is incomplete.');
              controller.enqueue(new Uint8Array(data,from,to-from));position+=to-from;part++;
            } catch(error){controller.error(error);}
          },
        });
      }
      return {size:meta.size,range:range??undefined,body:stream(),text:()=>new Response(stream()).text(),arrayBuffer:()=>new Response(stream()).arrayBuffer()};
    },
  };
}
export function photoBucket() { const {current,fallback}=stores(); return createBucket(current,fallback); }
export async function readChunk(request: Request) {
  const reader=request.body?.getReader();if(!reader)return new ArrayBuffer(0);
  const parts: Uint8Array[]=[];let size=0;
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>CHUNK_SIZE){await reader.cancel();throw new Error('Upload this file in smaller parts.');}parts.push(part.value);}
  const result=new Uint8Array(size);let at=0;for(const part of parts){result.set(part,at);at+=part.byteLength;}return result.buffer;
}
