'use client';
import {useEffect,useState} from 'react';
import type {FeatureId} from '@/lib/feature-catalogue';
export function useFeatures(){
 const [features,setFeatures]=useState<Partial<Record<FeatureId,boolean>>>({});
 useEffect(()=>{let active=true;const load=()=>{fetch('/api/features',{cache:'no-store'}).then(async r=>{if(r.ok&&active)setFeatures((await r.json()).features);}).catch(()=>{});};load();window.addEventListener('focus',load);window.addEventListener('features-updated',load);return()=>{active=false;window.removeEventListener('focus',load);window.removeEventListener('features-updated',load);};},[]);
 return features;
}
