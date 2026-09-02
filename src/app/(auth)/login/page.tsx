import { safeNextPath } from '@/lib/auth/next';
import { brandFontVars } from '@/lib/fonts';
import AuthShell from '../_auth-shell';
import LoginForm from './_form';

/**
 * SIGN IN.
 *
 * A Server Component so the post-authentication destination (`?next=`) is read from
 * `searchParams` and VALIDATED before it reaches the browser at all. The form itself is the
 * client half; nothing else about the screen changed.
 *
 * WHY THERE IS A DESTINATION HERE AT ALL (Phase 2). Browsing designs is public; using one is
 * not. A visitor who presses "Use this design" on /stories or the home shelf is sent here with
 * `next=/albums/new?design=<id>`, and after signing in lands on that design instead of on a
 * generic dashboard with their choice forgotten. The value is a same-origin relative path and
 * nothing else — see `lib/auth/next.ts`.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string; error?: string };
}) {
  const next = safeNextPath(searchParams?.next);
  const notice =
    searchParams?.error === 'auth_callback_failed'
      ? 'That sign-in link could not be completed. Please sign in again.'
      : null;

  return (
    <div className={`${brandFontVars} font-ui`}>
      <AuthShell title="Welcome Back" subtitle="Enter your credentials to access your memory workspace.">
        <LoginForm next={next} notice={notice} />
      </AuthShell>
    </div>
  );
}
