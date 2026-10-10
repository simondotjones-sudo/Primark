'use client';
import CourseQuizEditor from '@/components/course-quiz-editor';
import type {CourseQuiz} from '@/lib/course-quiz';
import {useLanguage} from '@/components/language-provider';
import { useState } from 'react';
import {Button} from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { courseCategories,courseLanguages } from '@/lib/course-catalogue';
import {useStores} from '@/components/store-directory';
import type { Course } from '@/lib/course-types';

export type CatalogueFields={assessorRequired:boolean;deadlineDays:number|null;quiz:CourseQuiz|null;refresherRules:NonNullable<Course['refresher_rules']>;englishTitle:string;category:string;languageCode:string;catalogueScope:Course['catalogue_scope'];availableCountries:string[];inductionRole:Course['induction_role'];validityMonths:number|null;estimatedDurationMinutes:number|null;lessonCount:number|null};
export const fieldsFor=(course:Course|null):CatalogueFields=>({assessorRequired:!!course?.assessor_required,deadlineDays:course?.deadline_days??null,quiz:course?.quiz_json??null,refresherRules:course?.refresher_rules??[],englishTitle:course?.english_title||'',category:course?.category||'',languageCode:course?.language_code||'en',catalogueScope:course?.catalogue_scope||'unconfigured',availableCountries:JSON.parse(course?.available_countries_json||'[]'),inductionRole:course?.induction_role||'none',validityMonths:course?.validity_months??null,estimatedDurationMinutes:course?.estimated_duration_minutes??null,lessonCount:course?.lesson_count??null});
export default function CourseCatalogueFields({value,onChange,courses=[],courseId}:{value:CatalogueFields;onChange:(next:CatalogueFields)=>void;courses?:Course[];courseId?:string}){
 const stores=useStores();
const countries=[...new Set(stores.map(s=>s.country))].sort();
  const {t,country:countryLabel,languageName}=useLanguage();

  const standard=[3,6,12,24,36];
  const [custom,setCustom]=useState(value.validityMonths!==null&&!standard.includes(value.validityMonths));
  const change=(next:Partial<CatalogueFields>)=>onChange({...value,...next});
  return <div className="catalogue-fields">
    <label>{t("English title")}<Input value={value.englishTitle} maxLength={150} onChange={e=>change({englishTitle:e.target.value})}/></label>
    <label>{t("Category")}<Input list="course-categories" value={value.category} maxLength={80} onChange={e=>change({category:e.target.value})}/><datalist id="course-categories">{courseCategories.map(c=><option key={c} value={c} label={t(c)}/>)}</datalist></label>
    <label>{t("Course language")}<NativeSelect value={value.languageCode} onChange={e=>change({languageCode:e.target.value})}>{Object.entries(courseLanguages).map(([code,name])=><option key={code} value={code}>{languageName(code)}</option>)}</NativeSelect></label>
    <div className="course-size-fields">
      <label>{t("Estimated duration (minutes)")}<Input type="number" min={1} max={10080} step={1} placeholder={t("Optional")} value={value.estimatedDurationMinutes ?? ''} aria-describedby="course-size-help" onChange={e=>change({estimatedDurationMinutes:e.target.value===''?null:e.target.valueAsNumber})}/></label>
      <label>{t("Number of lessons")}<Input type="number" min={1} max={1000} step={1} placeholder={t("Optional")} value={value.lessonCount ?? ''} aria-describedby="course-size-help" onChange={e=>change({lessonCount:e.target.value===''?null:e.target.valueAsNumber})}/></label>
    </div>
    <p id="course-size-help" className="course-field-help">{t("Use the duration and actual lesson count from the course. Leave unknown values blank; they will stay hidden on course panels.")}</p>
    <label>{t('Deadline (days from assignment)')}<Input type="number" min={1} max={3650} step={1} value={value.deadlineDays??''} placeholder={t('No deadline')} onChange={e=>change({deadlineDays:e.target.value===''?null:e.target.valueAsNumber})}/></label>
    <p className="course-field-help">{t('Applies to new assignments only. Existing deadlines stay unchanged.')}</p>
    <label className="quiz-toggle"><input type="checkbox" checked={value.assessorRequired} onChange={e=>change({assessorRequired:e.target.checked})}/>{t("Assessor sign-off required")}</label><p className="course-field-help">{t("For new assignments in this organisation, a certificate is issued only after practical assessment.")} <a href="/assessor">{t("Manage assessors")}</a></p>
    <CourseQuizEditor value={value.quiz} onChange={quiz=>change({quiz})}/>
    <fieldset className="course-certification-fields"><legend>{t("Certification")}</legend>
      <label>{t("Renewal frequency")}<NativeSelect value={custom?'custom':value.validityMonths??''} aria-describedby="course-validity-help" onChange={e=>{const selected=e.target.value;setCustom(selected==='custom');if(selected!=='custom')change({validityMonths:selected===''?null:Number(selected)});else if(value.validityMonths===null)change({validityMonths:12});}}>
        <option value="">{t("No expiry")}</option><option value="3">{t("Every 3 months")}</option><option value="6">{t("Every 6 months")}</option><option value="12">{t("Every year")}</option><option value="24">{t("Every 2 years")}</option><option value="36">{t("Every 3 years")}</option><option value="custom">{t("Custom")}</option>
      </NativeSelect></label>
      {custom&&<label>{t("Renew every (months)")}<Input required type="number" min={1} max={120} step={1} value={value.validityMonths??''} onChange={e=>change({validityMonths:e.target.value===''?null:e.target.valueAsNumber})}/></label>}
      <p id="course-validity-help" className="course-field-help">{t("A certificate is issued when all course lessons are passed or completed. Renewal runs from the completion date. Changes apply to future certificates; issued certificates keep their original expiry.")}</p>
    </fieldset>
    <fieldset className="course-certification-fields"><legend>{t('Refresher courses')}</legend>
      <p className="course-field-help">{t('Assign a linked course 30 days before expiry in the selected countries. Each new assignment uses one credit. Publish the refresher before it is due.')} {t('Credits apply only when enabled.')}</p>
      {value.refresherRules.map((rule,index)=><div className="refresher-rule" key={index}>
        <label>{t('Country')}<NativeSelect required value={rule.country} onChange={e=>change({refresherRules:value.refresherRules.map((r,i)=>i===index?{...r,country:e.target.value}:r)})}>
          <option value="">{t('Select a country')}</option>{countries.map(c=><option key={c} value={c} disabled={value.refresherRules.some((r,i)=>i!==index&&r.country===c)}>{countryLabel(c)}</option>)}
        </NativeSelect></label>
        <label>{t('Refresher course')}<NativeSelect required value={rule.courseId} onChange={e=>change({refresherRules:value.refresherRules.map((r,i)=>i===index?{...r,courseId:e.target.value}:r)})}>
          <option value="">{t('Choose a course')}</option>{courses.filter(c=>c.id!==courseId).map(c=><option key={c.id} value={c.id}>{c.title} · {c.source_course_id||c.id} · {t(c.status)}</option>)}
        </NativeSelect></label>
        <Button type="button" variant="outline" onClick={()=>change({refresherRules:value.refresherRules.filter((_,i)=>i!==index)})}>{t('Remove')}</Button>
      </div>)}
      <Button type="button" variant="outline" disabled={value.refresherRules.length>=countries.length} onClick={()=>change({refresherRules:[...value.refresherRules,{country:'',courseId:''}]})}>{t('Add refresher rule')}</Button>
    </fieldset>
    <label>{t("Country library availability")}<NativeSelect value={value.catalogueScope} onChange={e=>change({catalogueScope:e.target.value as CatalogueFields['catalogueScope']})}><option value="unconfigured">{t("Not set")}</option><option value="countries">{t("Selected countries")}</option><option value="global">{t("All countries")}</option></NativeSelect></label>
    {value.catalogueScope==='countries'&&<fieldset><legend>{t("Available in")}</legend><div className="catalogue-country-list">{countries.map(c=><label key={c}><Checkbox checked={value.availableCountries.includes(c)} onCheckedChange={()=>change({availableCountries:value.availableCountries.includes(c)?value.availableCountries.filter(v=>v!==c):[...value.availableCountries,c]})}/>{countryLabel(c)}</label>)}</div></fieldset>}
    <label>{t("New joiner induction")}<NativeSelect value={value.inductionRole} onChange={e=>{const role=e.target.value as CatalogueFields['inductionRole'];change({inductionRole:role,...(role==='default'?{languageCode:'en',catalogueScope:'global' as const}:role==='country'?{catalogueScope:'countries' as const}:{})});}}><option value="none">{t("Do not auto-assign")}</option><option value="country">{t("Induction for the selected countries")}</option><option value="default">{t("English fallback induction")}</option></NativeSelect></label>
    <p>{t(value.inductionRole==='none'?'Country availability lets Store Managers assign this course after it is published.':value.inductionRole==='default'?'New joiners receive this course when no published induction is available for their country.':'New joiners using the safety code receive this induction in the selected countries once it is published.')}</p>
  </div>;
}
