'use client';
import {useLanguage} from '@/components/language-provider';
export default function OrganisationSettings(){const {t}=useLanguage();return <section className="paper course-editor"><h2>{t('Organisation settings')}</h2><p><a href="/admin/settings">{t('Manage features in Settings')}</a></p></section>;}
