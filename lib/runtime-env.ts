export function runtimeEnv(name: string): string {
  const runtime = (globalThis as typeof globalThis & { Netlify?: { env: { get: (key: string) => string | undefined } } }).Netlify;
  if (runtime) return runtime.env.get(name) ?? '';
  // next dev / next build outside Netlify; never imported by client components.
  return typeof process !== 'undefined' ? process.env[name] ?? '' : '';
}
