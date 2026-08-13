// Pure functions on integer sixteenths of an inch.
// Widths/heights are stored as integer sixteenths so raw 1/16" laser
// readings survive without float drift (see spec: Data model).

/**
 * Convert a whole/numerator/denominator measurement into integer sixteenths.
 * `den` must evenly divide 16 (1, 2, 4, 8, or 16) — the UI only ever offers
 * eighths or sixteenths, so this holds for all real input.
 */
export function toSixteenths(whole: number, num: number, den: number): number {
  if (den <= 0 || !Number.isInteger(den)) {
    throw new Error(`Invalid denominator: ${den}`);
  }
  const scale = 16 / den;
  if (!Number.isInteger(scale)) {
    throw new Error(`Denominator ${den} does not evenly divide 16`);
  }
  return whole * 16 + num * scale;
}

/**
 * Round a sixteenths value DOWN to the nearest eighth (nearest even number
 * of sixteenths). Used to display/export laser-precise (1/16) readings as
 * the eighth-inch values the factory works from.
 */
export function floorToEighth(sixteenths: number): number {
  const sign = sixteenths < 0 ? -1 : 1;
  const abs = Math.abs(sixteenths);
  return sign * (abs - (abs % 2));
}

/**
 * Format a sixteenths value as "74 7/8" style text, reducing the fractional
 * part to lowest terms (4/8 -> 1/2, 8/16 -> 1/2, etc). Whole numbers render
 * with no fraction ("74").
 */
export function formatFraction(sixteenths: number): string {
  const sign = sixteenths < 0 ? "-" : "";
  const abs = Math.abs(sixteenths);
  const whole = Math.floor(abs / 16);
  const remainder = abs % 16;

  if (remainder === 0) {
    return `${sign}${whole}`;
  }

  const divisor = gcd(remainder, 16);
  const num = remainder / divisor;
  const den = 16 / divisor;

  return whole === 0 ? `${sign}${num}/${den}` : `${sign}${whole} ${num}/${den}`;
}

/** Convert integer sixteenths to a decimal number, e.g. 1198 -> 74.875. */
export function toDecimal(sixteenths: number): number {
  return sixteenths / 16;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
