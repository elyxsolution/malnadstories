import { signOut } from '@/lib/actions/auth';

export default function AppHeader({ email }: { email: string }) {
  return (
    <header className="flex items-center justify-between border-b px-8 h-14 shrink-0">
      <span className="font-semibold text-sm">Malnad Stories</span>
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">{email}</span>
        <form action={signOut}>
          <button
            type="submit"
            className="text-sm underline underline-offset-2 cursor-pointer hover:text-foreground text-muted-foreground"
          >
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
