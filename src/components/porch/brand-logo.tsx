// Stage 4e: the Porchbook logos from brand/, used exactly as they are (never recoloured, stretched
// or redrawn). They are drawn in "currentColor", so they take the colour of the text around them:
// white on olive, olive on cream or white, night olive on dark (brand/BRAND.md).
import tileSvg from "../../../brand/porchbook-logo-tile.svg?raw";
import markSvg from "../../../brand/porchbook-mark.svg?raw";

const FILES = { tile: tileSvg, mark: markSvg } as const;
// The tile logo is 2084.6 x 536.7; the mark is 466.9 x 444.2. Sizes keep these proportions.
const RATIO = { tile: 2084.6 / 536.7, mark: 466.9 / 444.2 } as const;

/**
 * - "tile": the main logo (people in a rounded tile + the word). Welcome, sign-in, light screens.
 * - "mark": the circle of people alone. Loading screen and the Public porch header.
 */
export function BrandLogo({ kind, height, className = "", label = "Porchbook" }: { kind: "tile" | "mark"; height: number; className?: string; label?: string }) {
  return (
    <span
      className={`brand-logo ${className}`}
      role="img"
      aria-label={label}
      style={{ height, width: Math.round(height * RATIO[kind]) }}
      dangerouslySetInnerHTML={{ __html: FILES[kind] }}
    />
  );
}

/** The loading screen: the circle of people, gently breathing. */
export function BrandLoading() {
  return (
    <div className="brand-loading" aria-label="Opening Porchbook" role="status">
      <BrandLogo kind="mark" height={72} />
    </div>
  );
}
