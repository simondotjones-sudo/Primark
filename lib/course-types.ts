export type Audience = { countries: string[]; sites: string[]; users: string[] };
export type RefresherRule={country:string;courseId:string};
export type Course = { assessor_required?:boolean; deadline_days?:number|null;quiz_json?:import('./course-quiz').CourseQuiz|null; refresher_rules?:RefresherRule[]; id: string; title: string; description: string; status: 'draft' | 'published'; audience_json: string; package_id: string | null; revision: number; updated_at: string; created_at: string;
  english_title: string; category: string; language_code: string; source_course_id: string | null; legacy_assignment_count: number | null;
  validity_months: number | null; estimated_duration_minutes: number | null; lesson_count: number | null;
  available_countries_json: string; catalogue_scope: 'unconfigured' | 'countries' | 'global'; induction_role: 'none' | 'country' | 'default'; };
export type Person = { id: string; name: string; email: string; country: string; store_id: string };
export type Sco = { id: string; title: string; href: string; mastery: string; launchData: string };
export type Package = { id: string; course_id: string; filename: string; status: string; scos_json: string; created_at: string; file_count: number; total_bytes: number };
export const emptyAudience = (): Audience => ({countries: [], sites: [], users: []});
export function matchesAudience(a: Audience, p: Person) { return a.countries.includes(p.country) || a.sites.includes(p.store_id) || a.users.includes(p.id); }
export function courseStatus(statuses: string[], count: number) { return statuses.length === count && count > 0 && statuses.every(s => s === 'completed' || s === 'passed') ? 'Completed' : statuses.length ? 'In progress' : 'Not started'; }
export const MAX_ZIP = 250 * 1024 * 1024;
export const MAX_FILE = 100 * 1024 * 1024;
export const MAX_TOTAL = 750 * 1024 * 1024;
export function validPath(path: string) { return !!path && path.length <= 500 && !/[\\\x00-\x1f:#?%]/.test(path) && !path.startsWith('/') && path.split('/').every(p => p && p !== '.' && p !== '..'); }
