// Support Center shared vocabulary — pure constants + presentational maps, safe in
// both client and server components. No I/O. Values are the lowercase DB enums
// (see 0028); labels/colors are display-only.

export const SUPPORT_CATEGORIES = [
  'order',
  'payment',
  'upload',
  'album',
  'delivery',
  'refund',
  'technical',
  'other',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_STATUSES = ['open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

// Customers may pick from a calmer subset of categories + priorities when opening a
// ticket; admins can set any value. URGENT is reserved for admin triage.
export const CUSTOMER_PRIORITIES = ['low', 'medium', 'high'] as const;

export const CATEGORY_LABEL: Record<SupportCategory, string> = {
  order: 'Order',
  payment: 'Payment',
  upload: 'Photo upload',
  album: 'Album & layout',
  delivery: 'Delivery',
  refund: 'Refund',
  technical: 'Technical',
  other: 'Something else',
};

export const PRIORITY_LABEL: Record<SupportPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const STATUS_LABEL: Record<SupportStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_for_customer: 'Awaiting your reply',
  resolved: 'Resolved',
  closed: 'Closed',
};

// Admin-facing status label (slightly terser for the dense queue).
export const ADMIN_STATUS_LABEL: Record<SupportStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_for_customer: 'Waiting on customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

// Tailwind chip classes (semantic tokens / muted palette — no hardcoded hex).
export const STATUS_CHIP: Record<SupportStatus, string> = {
  open: 'bg-primary/10 text-primary',
  in_progress: 'bg-blue-500/10 text-blue-600',
  waiting_for_customer: 'bg-amber-500/10 text-amber-600',
  resolved: 'bg-success/12 text-success',
  closed: 'bg-muted text-muted-foreground',
};

export const PRIORITY_CHIP: Record<SupportPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-blue-500/10 text-blue-600',
  high: 'bg-amber-500/10 text-amber-600',
  urgent: 'bg-destructive/10 text-destructive',
};

export const isSupportCategory = (v: string): v is SupportCategory =>
  (SUPPORT_CATEGORIES as readonly string[]).includes(v);
export const isSupportPriority = (v: string): v is SupportPriority =>
  (SUPPORT_PRIORITIES as readonly string[]).includes(v);
export const isSupportStatus = (v: string): v is SupportStatus =>
  (SUPPORT_STATUSES as readonly string[]).includes(v);

export const categoryLabel = (v: string): string => CATEGORY_LABEL[v as SupportCategory] ?? v;
export const priorityLabel = (v: string): string => PRIORITY_LABEL[v as SupportPriority] ?? v;
export const statusLabel = (v: string): string => STATUS_LABEL[v as SupportStatus] ?? v;
export const adminStatusLabel = (v: string): string => ADMIN_STATUS_LABEL[v as SupportStatus] ?? v;
export const statusChip = (v: string): string => STATUS_CHIP[v as SupportStatus] ?? 'bg-muted text-muted-foreground';
export const priorityChip = (v: string): string =>
  PRIORITY_CHIP[v as SupportPriority] ?? 'bg-muted text-muted-foreground';
