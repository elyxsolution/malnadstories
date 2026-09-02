// CMS shared vocabulary — pure constants + a per-type field config, safe in both client
// and server components. No I/O. Values are the lowercase DB enums (0031).

export const CONTENT_TYPES = [
  'blog',
  'faq',
  'testimonial',
  'legacy_story',
  'homepage_section',
  'announcement',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const TYPE_LABEL: Record<ContentType, string> = {
  blog: 'Blog post',
  faq: 'FAQ',
  testimonial: 'Testimonial',
  legacy_story: 'Legacy story',
  homepage_section: 'Homepage section',
  announcement: 'Announcement',
};

export const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

// Status → tailwind chip classes (admin tool palette; semantic-ish tokens).
export const STATUS_CHIP: Record<ContentStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  published: 'bg-success/12 text-success',
  archived: 'bg-amber-500/10 text-amber-600',
};

export const isContentType = (v: string): v is ContentType =>
  (CONTENT_TYPES as readonly string[]).includes(v);
export const isContentStatus = (v: string): v is ContentStatus =>
  (CONTENT_STATUSES as readonly string[]).includes(v);

export const typeLabel = (v: string): string => TYPE_LABEL[v as ContentType] ?? v;
export const statusLabel = (v: string): string => STATUS_LABEL[v as ContentStatus] ?? v;
export const statusChip = (v: string): string =>
  STATUS_CHIP[v as ContentStatus] ?? 'bg-muted text-muted-foreground';

// ── Per-type field config ─────────────────────────────────────────────────────
// Drives the editor: how to label the core columns per type + which metadata fields to
// collect. `key` for metadata fields is stored under content_pages.metadata[key].
export type MetaField = {
  key: string;
  label: string;
  /**
   * `blueprints` is an ENTITY-REFERENCE field (Phase 1): an ordered list of design ids stored
   * under `metadata[key]`. It is a generic field KIND rather than a homepage-only special case,
   * so any future content type that curates designs declares it the same way and gets the same
   * picker — the editor branches on the kind, never on the content type.
   */
  kind: 'text' | 'textarea' | 'number' | 'boolean' | 'blueprints';
  placeholder?: string;
  min?: number;
  max?: number;
};

export type TypeConfig = {
  // Labels for the shared columns (title/content always shown; excerpt/cover optional).
  titleLabel: string;
  contentLabel: string;
  showExcerpt: boolean;
  showCover: boolean;
  metaFields: MetaField[];
  blurb: string; // short helper shown atop the editor
};

export const TYPE_CONFIG: Record<ContentType, TypeConfig> = {
  blog: {
    titleLabel: 'Title',
    contentLabel: 'Body (markdown)',
    showExcerpt: true,
    showCover: true,
    metaFields: [],
    blurb: 'A long-form post. Stored as markdown/plain text.',
  },
  faq: {
    titleLabel: 'Question',
    contentLabel: 'Answer',
    showExcerpt: false,
    showCover: false,
    metaFields: [{ key: 'category', label: 'Category', kind: 'text', placeholder: 'Ordering, Shipping, Payments…' }],
    blurb: 'A question/answer pair shown on the public FAQ page, grouped by category.',
  },
  testimonial: {
    titleLabel: 'Customer name',
    contentLabel: 'Review',
    showExcerpt: false,
    showCover: false,
    metaFields: [
      { key: 'location', label: 'Location', kind: 'text', placeholder: 'Bengaluru, KA' },
      { key: 'rating', label: 'Rating (1–5)', kind: 'number', min: 1, max: 5 },
    ],
    blurb: 'A customer quote shown on the public testimonials page.',
  },
  legacy_story: {
    titleLabel: 'Title',
    contentLabel: 'Story',
    showExcerpt: true,
    showCover: true,
    metaFields: [
      { key: 'subtitle', label: 'Subtitle', kind: 'text' },
      { key: 'featured', label: 'Featured', kind: 'boolean' },
    ],
    blurb: 'An inspirational showcase story. Not linked to any real customer album.',
  },
  homepage_section: {
    titleLabel: 'Section name',
    contentLabel: 'Body',
    showExcerpt: false,
    showCover: true,
    metaFields: [
      { key: 'heading', label: 'Heading', kind: 'text' },
      { key: 'subheading', label: 'Subheading', kind: 'text' },
      { key: 'cta_label', label: 'CTA label', kind: 'text' },
      { key: 'cta_link', label: 'CTA link', kind: 'text', placeholder: '/stories' },
      // The curated designs this section shows, in the order chosen here (Phase 1).
      { key: 'blueprintIds', label: 'Designs', kind: 'blueprints' },
    ],
    blurb:
      'A homepage content block. Publish one with the slug "home-featured-designs" to control the curated design shelf on the home page.',
  },
  announcement: {
    titleLabel: 'Title',
    contentLabel: 'Message',
    showExcerpt: true,
    showCover: false,
    metaFields: [],
    blurb: 'A short site announcement.',
  },
};

export const typeConfig = (t: string): TypeConfig => TYPE_CONFIG[t as ContentType] ?? TYPE_CONFIG.blog;

// ── slugify ───────────────────────────────────────────────────────────────────
// Lowercase, ASCII-ish, dash-separated. Bounded length; safe for the unique slug column
// and for use as a URL/section key. The server ensures uniqueness on top of this.
export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || 'untitled';
}
