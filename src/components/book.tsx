/**
 * Signature 3D "bound book" (Claude Design). A perspective-tilted volume — spine +
 * cover (artwork or coloured cloth) + page edges — used on the shelf, album details, the
 * format selector and checkout. Pure presentation; hover-lift is CSS only, so it is
 * safe in Server Components.
 *
 * `cover` selects one of the Foundations cloth palettes (forest/night/clay/sage/plum) so
 * a shelf of albums reads with real variety. The palette hexes are intentional ARTWORK
 * (they depict a physical bound book), the one place literal colour is correct.
 */

const SIZES = {
  sm: { h: 'h-[176px]', cover: 'w-[120px]', spine: 'w-3', title: 'text-[15px]' },
  md: { h: 'h-[208px]', cover: 'w-[150px]', spine: 'w-3.5', title: 'text-lg' },
  lg: { h: 'h-[300px]', cover: 'w-[200px]', spine: 'w-5', title: 'text-2xl' },
} as const;

export const COVER_PALETTES = {
  forest: { cover: 'linear-gradient(140deg,#234639,#1a3328)', spine: 'linear-gradient(90deg,#16271f,#244235)', accent: '#b89a5c', title: '#ecd9ad' },
  night: { cover: 'linear-gradient(140deg,#2c3340,#1c2129)', spine: 'linear-gradient(90deg,#161a20,#2c3340)', accent: '#9fb0c4', title: '#e8edf3' },
  clay: { cover: 'linear-gradient(140deg,#7c4a39,#5f3527)', spine: 'linear-gradient(90deg,#4a281d,#7c4a39)', accent: '#e3b98f', title: '#f3e2d2' },
  sage: { cover: 'linear-gradient(140deg,#5a6b54,#43503f)', spine: 'linear-gradient(90deg,#39432f,#5a6b54)', accent: '#d8caa0', title: '#eef0e4' },
  plum: { cover: 'linear-gradient(140deg,#4a3a52,#352a3c)', spine: 'linear-gradient(90deg,#2a2030,#4a3a52)', accent: '#c5a9cf', title: '#ece2f0' },
} as const;

export type CoverPalette = keyof typeof COVER_PALETTES;

/** Stable palette for an id/string so each album keeps the same cloth colour across views. */
export function paletteFor(seed: string): CoverPalette {
  const keys = Object.keys(COVER_PALETTES) as CoverPalette[];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return keys[h % keys.length];
}

export default function Book({
  title,
  year,
  coverImage = null,
  cover = 'forest',
  size = 'md',
  tilt = true,
  thickness = 10,
  className = '',
}: {
  title: string;
  year?: string;
  coverImage?: string | null;
  cover?: CoverPalette;
  size?: keyof typeof SIZES;
  /** Shelf books tilt in perspective; the format selector stands them upright. */
  tilt?: boolean;
  /** Page-block width in px — the visible "thickness" of the book. */
  thickness?: number;
  className?: string;
}) {
  const s = SIZES[size];
  const p = COVER_PALETTES[cover] ?? COVER_PALETTES.forest;
  return (
    <div className={`[perspective:900px] ${className}`}>
      <div
        className={`relative flex ${s.h} origin-left transition-transform duration-500 ease-premium ${
          tilt
            ? '[transform:rotateY(-13deg)] group-hover:[transform:rotateY(-5deg)_translateY(-6px)]'
            : 'group-hover:[transform:translateY(-6px)]'
        }`}
        style={{ filter: 'drop-shadow(0 18px 26px rgb(44 39 31 / 0.26))' }}
      >
        {/* spine */}
        <div
          className={`flex ${s.spine} items-center justify-center rounded-l-[1px]`}
          style={{ background: p.spine }}
        >
          <span
            className="max-h-[88%] overflow-hidden whitespace-nowrap text-[7px] uppercase tracking-[0.14em] [writing-mode:vertical-rl] [transform:rotate(180deg)]"
            style={{ color: p.accent }}
          >
            {title}
          </span>
        </div>

        {/* cover */}
        <div className={`relative flex ${s.cover} flex-col items-center justify-center overflow-hidden`}>
          {coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverImage} alt={title} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div
              className="flex h-full w-full flex-col items-center justify-center px-4 text-center"
              style={{ background: p.cover }}
            >
              <span className="text-[7px] uppercase tracking-[0.2em]" style={{ color: p.accent }}>
                Malnad Stories
              </span>
              <span className="my-3 h-px w-6" style={{ background: p.accent, opacity: 0.6 }} />
              <span className={`font-display leading-tight ${s.title}`} style={{ color: p.title }}>
                {title}
              </span>
              {year && (
                <span className="mt-3 text-[8px] uppercase tracking-[0.12em]" style={{ color: p.accent }}>
                  {year}
                </span>
              )}
            </div>
          )}
        </div>

        {/* page edges */}
        <div
          className="rounded-r-[1px] bg-[repeating-linear-gradient(90deg,#f3ecdd,#f3ecdd_1px,#e3d8c2_1px,#e3d8c2_3px)]"
          style={{ width: thickness }}
        />
      </div>
    </div>
  );
}
