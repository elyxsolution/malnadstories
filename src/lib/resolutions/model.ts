// Refund & Reprint shared vocabulary — pure constants + presentational maps, safe in
// both client and server components. No I/O. Values are the lowercase DB enums (0029).

export const REQUEST_STATUSES = ['pending', 'under_review', 'approved', 'rejected', 'completed'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REFUND_REASONS = [
  'damaged_product',
  'wrong_product',
  'late_delivery',
  'quality_issue',
  'duplicate_order',
  'other',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const REPRINT_ISSUE_TYPES = [
  'damaged_delivery',
  'print_quality',
  'wrong_album',
  'missing_pages',
  'binding_issue',
  'other',
] as const;
export type ReprintIssueType = (typeof REPRINT_ISSUE_TYPES)[number];

// Statuses that count as an "active" request — one of these per order is allowed
// (mirrors the partial unique index). Rejected/completed are closed but stay visible.
export const ACTIVE_REQUEST_STATUSES: readonly RequestStatus[] = ['pending', 'under_review', 'approved'];
export const isActiveRequestStatus = (s: string): boolean =>
  (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(s);

// Order statuses that qualify for each request kind (must mirror the RLS WITH CHECK).
export const REFUND_ELIGIBLE_ORDER_STATUSES = [
  'paid',
  'processing',
  'printing',
  'packed',
  'shipped',
  'delivered',
] as const;
export const REPRINT_ELIGIBLE_ORDER_STATUSES = ['delivered'] as const;

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Pending',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  completed: 'Completed',
};

export const REFUND_REASON_LABEL: Record<RefundReason, string> = {
  damaged_product: 'Damaged product',
  wrong_product: 'Wrong product',
  late_delivery: 'Late delivery',
  quality_issue: 'Quality issue',
  duplicate_order: 'Duplicate order',
  other: 'Something else',
};

export const REPRINT_ISSUE_LABEL: Record<ReprintIssueType, string> = {
  damaged_delivery: 'Damaged in delivery',
  print_quality: 'Print quality',
  wrong_album: 'Wrong album',
  missing_pages: 'Missing pages',
  binding_issue: 'Binding issue',
  other: 'Something else',
};

// Status → tailwind chip classes (semantic tokens; no hardcoded hex).
export const STATUS_CHIP: Record<RequestStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  under_review: 'bg-blue-500/10 text-blue-600',
  approved: 'bg-primary/10 text-primary',
  rejected: 'bg-destructive/10 text-destructive',
  completed: 'bg-success/12 text-success',
};

// Forward-only request transitions (mirror the RPCs). Used to render admin controls.
export const ALLOWED_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  pending: ['under_review', 'approved', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['completed'],
  rejected: [],
  completed: [],
};

export const isRequestStatus = (v: string): v is RequestStatus =>
  (REQUEST_STATUSES as readonly string[]).includes(v);

export const statusLabel = (v: string): string => STATUS_LABEL[v as RequestStatus] ?? v;
export const refundReasonLabel = (v: string): string => REFUND_REASON_LABEL[v as RefundReason] ?? v;
export const reprintIssueLabel = (v: string): string => REPRINT_ISSUE_LABEL[v as ReprintIssueType] ?? v;
export const statusChip = (v: string): string => STATUS_CHIP[v as RequestStatus] ?? 'bg-muted text-muted-foreground';
export const allowedNextStatuses = (v: string): RequestStatus[] => ALLOWED_TRANSITIONS[v as RequestStatus] ?? [];
