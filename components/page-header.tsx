import ProfileMenu from '@/components/profile-menu';
import type { ProfileView } from '@/lib/profile';

export default function PageHeader({ title, view }: { title: string; view: ProfileView }) {
  return <header className="topbar page-topbar">
    <div className="topbar-brand">
      <a href="/" className="brand"><strong>PRIMARK</strong></a>
      <h1 className="topbar-title">{title}</h1>
    </div>
    <ProfileMenu view={view}/>
  </header>;
}
