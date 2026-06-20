/**
 * Signature 3D "bound book" (Claude Design). A perspective-tilted volume — spine +
 * cover (artwork or forest cloth) + page edges — used on the shelf, album details, the
 * format selector and checkout. Pure presentation; hover-lift is CSS only, so it is
 * safe in Server Components.
 */

const SIZES = {
  sm: { h: 'h-[176px]', cover: 'w-[120px]', spine: 'w-3', title: 'text-[15px]' },
  md: { h: 'h-[208px]', cover: 'w-[150px]', spine: 'w-3.5', title: 'text-lg' },
  lg: { h: 'h-[300px]', cover: 'w-[200px]', spine: 'w-5', title: 'text-2xl' },
} as const;

export default function Book({
  title,
  year,
  coverImage = null,
  size = 'md',
  tilt = true,
  thickness = 10,
  className = '',
}: {
  title: string;
  year?: string;
  coverImage?: string | null;
  size?: keyof typeof SIZES;
  /** Shelf books tilt in perspective; the format selector stands them upright. */
  tilt?: boolean;
  /** Page-block width in px — the visible "thickness" of the book. */
  thickness?: number;
  className?: string;
}) {
  const s = SIZES[size];
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
          className={`flex ${s.spine} items-center justify-center rounded-l-[1px] bg-[linear-gradient(90deg,#16271f,#244235)]`}
        >
          <span className="max-h-[88%] overflow-hidden whitespace-nowrap text-[7px] uppercase tracking-[0.14em] text-[#cbb27e] [writing-mode:vertical-rl] [transform:rotate(180deg)]">
            {title}
          </span>
        </div>

        {/* cover */}
        <div className={`relative flex ${s.cover} flex-col items-center justify-center overflow-hidden`}>
          {coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverImage} alt={title} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-[linear-gradient(140deg,#234639,#1a3328)] px-4 text-center">
              <span className="text-[7px] uppercase tracking-[0.2em] text-[#b89a5c]">Malnad Stories</span>
              <span className="my-3 h-px w-6 bg-[#b89a5c]/60" />
              <span className={`font-display leading-tight text-[#ecd9ad] ${s.title}`}>{title}</span>
              {year && <span className="mt-3 text-[8px] uppercase tracking-[0.12em] text-[#b89a5c]">{year}</span>}
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
