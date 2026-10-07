'use client';
import {createContext,useContext,useEffect,useMemo,useState} from 'react';
import {Globe2} from 'lucide-react';
import {isLanguage,languageDirection,languageLocale,languageOptions,type Language} from '@/lib/i18n';
import {countryName,formatDate,tr,type LocalizedText} from '@/lib/ui-copy';


type Values=Record<string,string|number>;
const makeLanguage=(lang:Language,setLang:(lang:Language)=>void)=>({lang,setLang,t:(key:LocalizedText,values?:Values)=>tr(lang,key,values),country:(value:string)=>countryName(value,lang),date:(value:string|null)=>formatDate(value,lang),duration:(value:number)=>new Intl.NumberFormat(languageLocale(lang),{style:'unit',unit:'minute',unitDisplay:'short'}).format(value),languageName:(code:string)=>{try{return new Intl.DisplayNames([languageLocale(lang)],{type:'language'}).of(code)||code;}catch{return code;}}});
const Context=createContext(makeLanguage('en',()=>{}));
export function LanguageProvider({children}:{children:React.ReactNode}){
  const [lang,setLang]=useState<Language>('en'),[ready,setReady]=useState(false);
  useEffect(()=>{
    const query=new URLSearchParams(location.search).get('lang');
    let saved:string|null=null;try{saved=localStorage.getItem('primark-language');}catch{}
    setLang(isLanguage(query)?query:isLanguage(saved)?saved:'en');setReady(true);
    const sync=(event:StorageEvent)=>{if(event.key==='primark-language'&&isLanguage(event.newValue))setLang(event.newValue);};
    window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
  },[]);
  useEffect(()=>{
    if(!ready)return;
    document.documentElement.lang=lang;document.documentElement.dir=languageDirection(lang);
    try{localStorage.setItem('primark-language',lang);}catch{}
    const url=new URL(location.href);if(url.searchParams.has('lang')&&url.searchParams.get('lang')!==lang){url.searchParams.set('lang',lang);history.replaceState(history.state,'',url);}
  },[lang,ready]);
  const value=useMemo(()=>makeLanguage(lang,setLang),[lang]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useLanguage=()=>useContext(Context);
export function LanguagePicker(){const {lang,setLang,t}=useLanguage();return <label className="language-picker"><Globe2 size={17}/><span className="sr-only">{t('Language')}</span><select aria-label={t('Language')} value={lang} onChange={e=>setLang(e.target.value as Language)}>{languageOptions.map(option=><option key={option.code} value={option.code} lang={option.code} dir={languageDirection(option.code)}>{option.name}</option>)}</select></label>;}
export function Text({children}:{children:string}){return <>{useLanguage().t(children)}</>;}
