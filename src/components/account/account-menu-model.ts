/**
 * WHAT THE ACCOUNT MENU OFFERS, PER CONTEXT — a pure model, deliberately separate from the
 * component that draws it.
 *
 * The menu answers a different question depending on where the person is standing, and that
 * difference is the whole point of it:
 *
 *   · on the PUBLIC site they are browsing, and the account is somewhere to GO —
 *     so it opens the door inward: Dashboard, Cart.
 *   · inside the APP they are already there, and the account is the way BACK OUT —
 *     so it offers the public rooms: Home, Stories, Contact & FAQ.
 *
 * Listing "Dashboard" in the dashboard would be a menu item that does nothing, and listing the
 * public pages on the public site would duplicate the nav bar three inches above it. Each context
 * offers only what is not already in front of you.
 *
 * WHY A MODEL AND NOT JSX. Three things need to agree about these lists — the popup, the tests,
 * and anyone reading the file later — and a list of objects is the only one of those three that
 * can be asserted directly. It also keeps the component free of branching: it maps.
 *
 * THE ROUTES ARE THE EXISTING ROUTES. Nothing here invents a destination; every href is a page
 * that already shipped.
 */
import { Home, LayoutGrid, LifeBuoy, Library, ShoppingCart, type LucideIcon } from 'lucide-react';

/**
 * WHERE THE MENU IS BEING RENDERED.
 *
 * Resolved by the LAYOUT that renders the header, not by inspecting a pathname: `(app)/layout.tsx`
 * and `admin/layout.tsx` render the app header, and the public pages render the public one. The
 * route group IS the context, so it cannot drift out of step with a list of path prefixes that
 * someone forgets to update when a route is added.
 */
export type AccountContext = 'public' | 'app';

export type AccountMenuLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** One short line of orientation. Present on every row or none — never a ragged half-set. */
  hint: string;
};

const PUBLIC_LINKS: AccountMenuLink[] = [
  { href: '/dashboard', label: 'Your stories', icon: Library, hint: 'Albums in progress' },
  { href: '/cart', label: 'Cart', icon: ShoppingCart, hint: 'Ready to order' },
];

const APP_LINKS: AccountMenuLink[] = [
  { href: '/', label: 'Home', icon: Home, hint: 'The studio' },
  { href: '/stories', label: 'Stories', icon: LayoutGrid, hint: 'Browse designs' },
  { href: '/contact', label: 'Contact & FAQ', icon: LifeBuoy, hint: 'Talk to us' },
];

/** The navigation rows for a context, in order. */
export function accountMenuLinks(context: AccountContext): AccountMenuLink[] {
  return context === 'app' ? APP_LINKS : PUBLIC_LINKS;
}

/**
 * SIGNING OUT IS OFFERED IN BOTH CONTEXTS, and that is a deliberate decision rather than an
 * oversight of the brief, which asked for it on the public menu only.
 *
 * Before this change, the app header's "Log out" text action was the ONLY way to sign out of the
 * authenticated application — `/account` has no logout, the sidebar has none, and the builder's
 * own header is a different route. Replacing that text action with a menu that omits logout would
 * leave a signed-in customer with no way to sign out at all, which is a worse outcome than a menu
 * with one more row in it. The brief anticipates exactly this ("unless already required by the
 * established design"), and the established design requires it.
 *
 * It is separated by a rule and set apart typographically in both contexts, so it never competes
 * with the navigation above it.
 */
export const ACCOUNT_MENU_HAS_SIGN_OUT = true;
