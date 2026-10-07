type Props = {
  platformAdmin: boolean;
  canReport: boolean;
  area: 'learn' | 'report';
  onLearn: () => void;
  onReport: () => void;
  onSignOut: () => void;
  translate: (value: string) => string;
};

export default function AccountNavigation({ platformAdmin, canReport, area, onLearn, onReport, onSignOut, translate: t }: Props) {
  if (!platformAdmin && !canReport) return null;
  return <nav aria-label="Account navigation">
    <button className={area === 'learn' ? 'active' : ''} onClick={onLearn}>{t('Learner view')}</button>
    {canReport && <button className={area === 'report' ? 'active' : ''} onClick={onReport}>{t('Reporting')}</button>}
    {platformAdmin && <>
      <a className="admin-nav-link" href="/admin/courses/">Manage courses</a>
      <a className="admin-nav-link" href="/admin/reporting-access">Reporting access</a>
      <button onClick={onSignOut}>{t('Sign out')}</button>
    </>}
  </nav>;
}
