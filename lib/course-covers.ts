// Shared by the learner API and course management. Language/country variants
// keep the same visual identity; category edits take effect without a data migration.
export const categoryCovers = {
  'Induction': 'safety-pass',
  'Fire Safety': 'fire-safety',
  'Emergency Response': 'emergency-response',
  'Manual Handling': 'manual-handling',
  'Equipment Safety': 'baler-safety',
  'Night Work': 'night-work',
  'Dignity at Work': 'dignity',
  'Workplace Violence Prevention': 'security',
  'Data Protection': 'data-protection',
  'Accessibility': 'accessibility',
  'Safeguarding': 'safeguarding',
  'Code of Conduct': 'speak-up',
} as const;

export type CourseCoverKey = typeof categoryCovers[keyof typeof categoryCovers];
type CoverCourse = { title?: string; english_title?: string; category?: string };

export function courseCoverKey(course: CoverCourse): CourseCoverKey {
  const category = course.category?.trim().toLowerCase();
  const matched = Object.entries(categoryCovers).find(([name]) => name.toLowerCase() === category);
  if (matched) return matched[1];
  // Older uploads predate categorisation. Prefer their English title so a
  // translated title does not give a language variant a different cover.
  const title = (course.english_title || course.title || '').toLowerCase();
  if (/harassment|bystander|dignity|positive workplace|inclusion/.test(title)) return 'dignity';
  if (/violence|security|loss prevention|personal safety/.test(title)) return 'security';
  if (/fire|brandopzichter|incendie/.test(title)) return 'fire-safety';
  if (/emergency|evacuation|emergencia|urgence|emergenza|noodprocedures|emergência/.test(title)) return 'emergency-response';
  if (/manual handling/.test(title)) return 'manual-handling';
  if (/baler/.test(title)) return 'baler-safety';
  if (/night (shift|work)/.test(title)) return 'night-work';
  if (/data protection|privacy|gdpr/.test(title)) return 'data-protection';
  if (/accessibility/.test(title)) return 'accessibility';
  if (/safeguarding/.test(title)) return 'safeguarding';
  if (/speak up|code of conduct/.test(title)) return 'speak-up';
  return 'safety-pass';
}
