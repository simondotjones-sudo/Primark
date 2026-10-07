'use client';
import ProfileMenu from '@/components/profile-menu';
import {LanguagePicker,useLanguage} from '@/components/language-provider';
import type { ProfileView } from '@/lib/profile';

export default function PageHeader({ title, view }: { title: string; view: ProfileView }) {
  const {t}=useLanguage();
  return <header className="topbar page-topbar">
    <div className="topbar-brand">
      <a href="/" className="brand"><strong>PRIMARK</strong></a>
      <h1 className="topbar-title">{t(title)}</h1>
    </div>
    <div className="top-controls"><ProfileMenu view={view}/></div>
  </header>;
}
