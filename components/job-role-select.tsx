'use client';
import {NativeSelect} from '@/components/ui/native-select';
import {useLanguage} from '@/components/language-provider';
import type {JobRole} from '@/lib/job-role-types';
export default function JobRoleSelect({roles,value,onChange,name}:{roles:JobRole[];value?:string;onChange?:(value:string)=>void;name?:string}){
 const {t}=useLanguage();
 return <label>{t('Job role')}<NativeSelect name={name} value={value} onChange={e=>onChange?.(e.target.value)}><option value="">{t('Not assigned')}</option>{roles.filter(r=>!r.archived||r.id===value).map(r=><option key={r.id} value={r.id}>{r.name}{r.archived?' · '+t('Archived'):''}</option>)}</NativeSelect></label>;
}
