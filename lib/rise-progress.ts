// Rise's v3 suspend envelope contains LZW-compressed JSON. In the supplied
// BGNmEg11 export, progress.p is the same rounded course percentage shown in
// Rise's sidebar; progress.lessons[*].p and cmi.core.score.raw are different.
// Read only: never rewrite the opaque resume data or infer a quiz score.
const MAX_PACKED = 65536;
const MAX_UNPACKED = 262144;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function unpack(value: unknown): string | null {
  // Rise leaves strings containing characters outside its byte alphabet raw.
  if (typeof value === 'string') return value.length <= MAX_UNPACKED ? value : null;
  if (!Array.isArray(value) || !value.length || value.length > MAX_PACKED) return null;
  const dictionary = Array.from({length: 256}, (_, i) => String.fromCharCode(i));
  if (!Number.isInteger(value[0]) || value[0] < 0 || value[0] > 255) return null;
  let previous = dictionary[value[0]], result = previous;
  for (let i = 1; i < value.length; i++) {
    const code = value[i];
    if (!Number.isInteger(code) || code < 0 || code > dictionary.length) return null;
    const phrase = code === dictionary.length ? previous + previous[0] : dictionary[code];
    if (result.length + phrase.length > MAX_UNPACKED) return null;
    result += phrase;
    dictionary.push(previous + phrase[0]);
    previous = phrase;
  }
  return result;
}

export function riseProgressPercent(suspendData: unknown): number | null {
  if (typeof suspendData !== 'string' || suspendData.length > MAX_PACKED) return null;
  try {
    const envelope: unknown = JSON.parse(suspendData);
    if (!record(envelope) || envelope.v !== 3) return null;
    const raw = unpack(envelope.d);
    if (raw === null) return null;
    const state: unknown = JSON.parse(raw);
    if (!record(state) || typeof state.cpv !== 'string' || !state.cpv ||
        !record(state.progress) || !record(state.progress.lessons)) return null;
    // Rise's decoder defaults the course percentage to zero until a lesson
    // completes, even when that lesson already has its own partial percentage.
    const percent = state.progress.p === undefined ? 0 : state.progress.p;
    return typeof percent === 'number' && Number.isInteger(percent) && percent >= 0 && percent <= 100 ? percent : null;
  } catch {
    // Other authoring tools/versions and damaged data retain the status label.
    return null;
  }
}

export function savedCourseProgress(scormData: string | undefined, scoCount: number): number | null {
  // Rise exports one SCO. Do not invent weighting across unrelated SCOs.
  if (!scormData || scoCount !== 1) return null;
  try {
    const data: unknown = JSON.parse(scormData);
    return record(data) ? riseProgressPercent(data['cmi.suspend_data']) : null;
  } catch { return null; }
}
