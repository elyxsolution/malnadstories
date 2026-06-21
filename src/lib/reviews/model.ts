// Album-review shared vocabulary — pure constants + presentational maps, safe in both
// client and server components. No I/O. Values are the lowercase DB enums (0030).

export const REVIEW_STATUSES = ['pending_review', 'approved', 'changes_requested', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVISION_STATUSES = ['open', 'in_progress', 'resubmitted', 'completed'] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

// A review is "active" (in the admin's work queue) when it awaits a decision.
export const ACTIVE_REVIEW_STATUSES: readonly ReviewStatus[] = ['pending_review'];

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
};

export const REVISION_STATUS_LABEL: Record<RevisionStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resubmitted: 'Resubmitted',
  completed: 'Completed',
};

// Status → tailwind chip classes (semantic tokens; no hardcoded hex).
export const REVIEW_STATUS_CHIP: Record<ReviewStatus, string> = {
  pending_review: 'bg-blue-500/10 text-blue-600',
  approved: 'bg-success/12 text-success',
  changes_requested: 'bg-amber-500/10 text-amber-600',
  rejected: 'bg-destructive/10 text-destructive',
};

export const REVISION_STATUS_CHIP: Record<RevisionStatus, string> = {
  open: 'bg-amber-500/10 text-amber-600',
  in_progress: 'bg-blue-500/10 text-blue-600',
  resubmitted: 'bg-primary/10 text-primary',
  completed: 'bg-success/12 text-success',
};

// Forward-only admin transitions (mirror admin_set_album_review). Used to render controls.
export const ALLOWED_REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  pending_review: ['approved', 'changes_requested', 'rejected'],
  changes_requested: ['approved', 'changes_requested', 'rejected'],
  approved: [],
  rejected: [],
};

export const isReviewStatus = (v: string): v is ReviewStatus =>
  (REVIEW_STATUSES as readonly string[]).includes(v);
export const isRevisionStatus = (v: string): v is RevisionStatus =>
  (REVISION_STATUSES as readonly string[]).includes(v);

export const reviewStatusLabel = (v: string): string => REVIEW_STATUS_LABEL[v as ReviewStatus] ?? v;
export const revisionStatusLabel = (v: string): string => REVISION_STATUS_LABEL[v as RevisionStatus] ?? v;
export const reviewStatusChip = (v: string): string =>
  REVIEW_STATUS_CHIP[v as ReviewStatus] ?? 'bg-muted text-muted-foreground';
export const revisionStatusChip = (v: string): string =>
  REVISION_STATUS_CHIP[v as RevisionStatus] ?? 'bg-muted text-muted-foreground';
export const allowedNextReviewStatuses = (v: string): ReviewStatus[] =>
  ALLOWED_REVIEW_TRANSITIONS[v as ReviewStatus] ?? [];
