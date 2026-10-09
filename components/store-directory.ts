'use client';
import {useEffect,useState} from 'react';
import baseline from '@/lib/stores.json';
import type {DirectoryStore} from '@/lib/store-directory';
export function useStores(includeArchived=false){
  const [stores,setStores]=useState<DirectoryStore[]>(baseline);
  useEffect(()=>{const controller=new AbortController();fetch('/api/stores',{cache:'no-store',signal:controller.signal}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>setStores(data.stores)).catch(()=>{});return()=>controller.abort();},[]);
  return stores.filter(s=>includeArchived||s.active);
}
