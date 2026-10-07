export type ReportingAccess = {
  scope: 'organisation' | 'country' | 'site';
  country: string | null;
  siteId: string | null;
};
