'use client';
import {useLanguage} from '@/components/language-provider';
import { BookOpen, CalendarClock, Clock3, Flame, Globe2, HeartHandshake, Languages, LifeBuoy, Moon, Package, Settings2, ShieldCheck, Users } from 'lucide-react';
import {languageLocale} from '@/lib/i18n';
import { countryFlagCodes, type CoursePanelDetails } from '@/lib/course-panel-details';

const categoryIcons = {
  Induction: ShieldCheck,
  'Fire Safety': Flame,
  'Emergency Response': LifeBuoy,
  'Manual Handling': Package,
  'Equipment Safety': Settings2,
  'Night Work': Moon,
  'Dignity at Work': HeartHandshake,
  'Workplace Violence Prevention': Users,
};

export function CourseLessonCount({count}:{count:number|null}) {
  const {t}=useLanguage();
  return count==null?null:<span className="course-metadata-item"><BookOpen size={15} aria-hidden="true"/>{t('Lessons: {count}',{count})}</span>;
}

export function CourseRenewal({validityMonths}:{validityMonths:number|null}) {
  const {t,lang}=useLanguage();
  const years=validityMonths!=null&&validityMonths%12===0;
  const period=validityMonths==null?'':new Intl.NumberFormat(languageLocale(lang),{style:'unit',unit:years?'year':'month',unitDisplay:'long'}).format(years?validityMonths/12:validityMonths);
  return <span className="course-metadata-item"><CalendarClock size={15} aria-hidden="true"/>{validityMonths==null?t('No expiry'):t('Expires after {period}',{period})}</span>;
}

export default function CourseMetadata({ details, showUnconfigured = false, showRenewal = false }: {
  details: CoursePanelDetails; showUnconfigured?: boolean; showRenewal?: boolean;
}) {
  const {t,country:countryLabel,duration,languageName}=useLanguage();

  const Icon = categoryIcons[details.category as keyof typeof categoryIcons] || BookOpen;
  const countries = details.catalogueScope === 'countries' ? details.availableCountries : [];
  return <span className="course-metadata">
    <span className="course-metadata-item"><Icon size={15} aria-hidden="true"/>{t(details.category || 'Uncategorised')}</span>
    {details.catalogueScope === 'global' && <span className="course-metadata-item"><Globe2 size={15} aria-hidden="true"/>{t("All countries")}</span>}
    {countries.map(country => <span className="course-metadata-item" key={country}>
      {countryFlagCodes[country] ? <img className="course-country-flag" src={`/country-flags/${countryFlagCodes[country]}.svg`} width={20} height={15} alt=""/> : <Globe2 size={15} aria-hidden="true"/>}
      {countryLabel(country)}
    </span>)}
    {showUnconfigured && details.catalogueScope === 'unconfigured' && <span className="course-metadata-item"><Globe2 size={15} aria-hidden="true"/>{t("Country availability not set")}</span>}
    {details.languageCode && <span className="course-metadata-item"><Languages size={15} aria-hidden="true"/><span className="sr-only">{t("Language:")}{" "}</span>{languageName(details.languageCode)}</span>}
    {details.estimatedDurationMinutes != null && <span className="course-metadata-item"><Clock3 size={15} aria-hidden="true"/>{t("Approx. {time}",{time:duration(details.estimatedDurationMinutes)})}</span>}
    <CourseLessonCount count={details.lessonCount}/>
    {showRenewal&&<CourseRenewal validityMonths={details.validityMonths}/>}
  </span>;
}
