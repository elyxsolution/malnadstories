import { safeNextPath } from '@/lib/auth/next';
import { brandFontVars } from '@/lib/fonts';
import SignupForm from './_form';

/**
 * CREATE AN ACCOUNT. A Server Component purely so `?next=` is read from `searchParams` and
 * validated before the browser sees it — the same shape as the sign-in page. The form, the
 * Supabase call and the verification-email flow are unchanged.
 */
export default function SignupPage({ searchParams }: { searchParams?: { next?: string } }) {
  return (
    <div className={`${brandFontVars} font-ui`}>
      <SignupForm next={safeNextPath(searchParams?.next)} />
    </div>
  );
}
