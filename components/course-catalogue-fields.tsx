'use client';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { courseCategories,courseLanguages } from '@/lib/course-catalogue';
import stores from '@/lib/stores.json';
import type { Course } from '@/lib/course-types';

export type CatalogueFields={englishTitle:string;category:string;languageCode:string;catalogueScope:Course['catalogue_scope'];availableCountries:string[];inductionRole:Course['induction_role'];validityMonths:number|null;estimatedDurationMinutes:number|null;lessonCount:number|null};
export const fieldsFor=(course:Course|null):CatalogueFields=>({englishTitle:course?.english_title||'',category:course?.category||'',languageCode:course?.language_code||'en',catalogueScope:course?.catalogue_scope||'unconfigured',availableCountries:JSON.parse(course?.available_countries_json||'[]'),inductionRole:course?.induction_role||'none',validityMonths:course?.validity_months??null,estimatedDurationMinutes:course?.estimated_duration_minutes??null,lessonCount:course?.lesson_count??null});
const countries=[...new Set(stores.map(s=>s.country))].sort();
export default function CourseCatalogueFields({value,onChange}:{value:CatalogueFields;onChange:(next:CatalogueFields)=>void}){
  const change=(next:Partial<CatalogueFields>)=>onChange({...value,...next});
  return <div className="catalogue-fields">
    <label>English title<Input value={value.englishTitle} maxLength={150} onChange={e=>change({englishTitle:e.target.value})}/></label>
    <label>Category<Input list="course-categories" value={value.category} maxLength={80} onChange={e=>change({category:e.target.value})}/><datalist id="course-categories">{courseCategories.map(c=><option key={c} value={c}/>)}</datalist></label>
    <label>Course language<NativeSelect value={value.languageCode} onChange={e=>change({languageCode:e.target.value})}>{Object.entries(courseLanguages).map(([code,name])=><option key={code} value={code}>{name}</option>)}</NativeSelect></label>
    <div className="course-size-fields">
      <label>Estimated duration (minutes)<Input type="number" min={1} max={10080} step={1} placeholder="Optional" value={value.estimatedDurationMinutes ?? ''} aria-describedby="course-size-help" onChange={e=>change({estimatedDurationMinutes:e.target.value===''?null:e.target.valueAsNumber})}/></label>
      <label>Number of lessons<Input type="number" min={1} max={1000} step={1} placeholder="Optional" value={value.lessonCount ?? ''} aria-describedby="course-size-help" onChange={e=>change({lessonCount:e.target.value===''?null:e.target.valueAsNumber})}/></label>
    </div>
    <p id="course-size-help" className="course-field-help">Use the duration and actual lesson count from the course. Leave unknown values blank; they will stay hidden on course panels.</p>
    <label>Valid for (months)<Input type="number" min={1} max={120} step={1} placeholder="No expiry" value={value.validityMonths ?? ''} aria-describedby="course-validity-help" onChange={e=>change({validityMonths:e.target.value===''?null:e.target.valueAsNumber})}/></label>
    <p id="course-validity-help" className="course-field-help">Measured from completion. Leave blank for no expiry. Changes apply to existing completions in Reporting.</p>
    <label>Country library availability<NativeSelect value={value.catalogueScope} onChange={e=>change({catalogueScope:e.target.value as CatalogueFields['catalogueScope']})}><option value="unconfigured">Not set</option><option value="countries">Selected countries</option><option value="global">All countries</option></NativeSelect></label>
    {value.catalogueScope==='countries'&&<fieldset><legend>Available in</legend><div className="catalogue-country-list">{countries.map(c=><label key={c}><Checkbox checked={value.availableCountries.includes(c)} onCheckedChange={()=>change({availableCountries:value.availableCountries.includes(c)?value.availableCountries.filter(v=>v!==c):[...value.availableCountries,c]})}/>{c}</label>)}</div></fieldset>}
    <label>New joiner induction<NativeSelect value={value.inductionRole} onChange={e=>{const role=e.target.value as CatalogueFields['inductionRole'];change({inductionRole:role,...(role==='default'?{languageCode:'en',catalogueScope:'global' as const}:role==='country'?{catalogueScope:'countries' as const}:{})});}}><option value="none">Do not auto-assign</option><option value="country">Induction for the selected countries</option><option value="default">English fallback induction</option></NativeSelect></label>
    <p>{value.inductionRole==='none'?'Country availability lets Store Managers assign this course after it is published.':value.inductionRole==='default'?'New joiners receive this course when no published induction is available for their country.':'New joiners using the safety code receive this induction in the selected countries once it is published.'}</p>
  </div>;
}
