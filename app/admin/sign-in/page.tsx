import { isLanguage } from '@/lib/i18n';
import { redirect } from 'next/navigation';
import { safeReturnTo } from '@/lib/admin-auth';

// Preserve old bookmarks while using the same login screen for every role.
export default async function SignIn({searchParams}: {searchParams: Promise<{returnTo?: string; lang?: string}>}) {
  const params = await searchParams;
  redirect(`/?login=1&returnTo=${encodeURIComponent(safeReturnTo(params.returnTo))}${isLanguage(params.lang)?`&lang=${params.lang}`:''}`);
}
