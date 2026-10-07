import type { Course, Person } from '@/lib/course-types';

export const courseCategories = ['Induction','Fire Safety','Emergency Response','Manual Handling','Equipment Safety','Night Work','Dignity at Work','Workplace Violence Prevention'];
export const courseLanguages: Record<string,string> = {en:'English',de:'German',es:'Spanish',fr:'French',it:'Italian',nl:'Dutch',pt:'Portuguese',pl:'Polish',cs:'Czech',hu:'Hungarian',ro:'Romanian',sk:'Slovak',sl:'Slovenian',ar:'Arabic'};
export function availableInCountry(course: Course, country: string) {
  return course.catalogue_scope === 'global' || (course.catalogue_scope === 'countries' && JSON.parse(course.available_countries_json || '[]').includes(country));
}
export function inductionFor(courses: Course[], country: string) {
  const ready = courses.filter(c => c.status === 'published' && c.package_id);
  const ordered = (rows: Course[]) => rows.sort((a,b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  return ordered(ready.filter(c => c.induction_role === 'country' && availableInCountry(c,country)))[0]
    || ordered(ready.filter(c => c.induction_role === 'default' && c.language_code === 'en'))[0] || null;
}
export type EnrolledPerson = Person & {induction_enrolled?: boolean};
