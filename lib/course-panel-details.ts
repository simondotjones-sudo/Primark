import type { Course } from '@/lib/course-types';

export type CoursePanelDetails = {
  category: string;
  languageCode: string;
  catalogueScope: Course['catalogue_scope'];
  availableCountries: string[];
  estimatedDurationMinutes: number | null;
  lessonCount: number | null;
};

export function coursePanelDetails(course: Course): CoursePanelDetails {
  return {
    category: course.category,
    languageCode: course.language_code,
    catalogueScope: course.catalogue_scope,
    availableCountries: JSON.parse(course.available_countries_json || '[]'),
    estimatedDurationMinutes: course.estimated_duration_minutes ?? null,
    lessonCount: course.lesson_count ?? null,
  };
}

export const countryFlagCodes: Record<string, string> = {
  Austria: 'at', Bahrain: 'bh', Belgium: 'be', 'Czech Republic': 'cz',
  France: 'fr', Germany: 'de', Hungary: 'hu', Ireland: 'ie', Italy: 'it',
  Kuwait: 'kw', Netherlands: 'nl', Poland: 'pl', Portugal: 'pt', Romania: 'ro',
  Slovakia: 'sk', Slovenia: 'si', Spain: 'es', UAE: 'ae',
  'United Kingdom': 'gb', 'United States': 'us',
};
