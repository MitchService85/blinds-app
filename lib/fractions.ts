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

/**
 * Format a value in integer THIRTY-SECONDS, e.g. 2247 -> "70 7/32".
 *
 * Only for showing a laser reading back as it was entered (Mike's laser
 * reads 32nds). Nothing is stored in this unit — see
 * thirtySecondsToStoredSixteenths.
 */
export function formatThirtySeconds(thirtySeconds: number): string {
  const sign = thirtySeconds < 0 ? "-" : "";
  const abs = Math.abs(thirtySeconds);
  const whole = Math.floor(abs / 32);
  const remainder = abs % 32;

  if (remainder === 0) {
    return `${sign}${whole}`;
  }

  const divisor = gcd(remainder, 32);
  return whole === 0
    ? `${sign}${remainder / divisor}/${32 / divisor}`
    : `${sign}${whole} ${remainder / divisor}/${32 / divisor}`;
}

/**
 * A 1/32 reading as the integer sixteenths everything is stored in, rounded
 * DOWN to the sixteenth.
 *
 * Storage stays in sixteenths on purpose: every width and height already
 * recorded on every job and every phone is in that unit, and changing the
 * base would double or halve a measurement on any device still running an
 * older bundle — a whole floor of wrong blinds.
 *
 * Nothing is lost at the factory, because the eighth that reaches the sheet
 * is the same either way: 8, 16 and 32 are nested grids, so flooring to a
 * sixteenth and then to an eighth lands exactly where flooring the 32nd
 * straight to an eighth would (every multiple of 1/8 is a multiple of 1/16,
 * so no eighth can hide between x and its sixteenth). The odd 1/32 only
 * ever lived between two values the factory cannot cut to.
 */
export function thirtySecondsToStoredSixteenths(thirtySeconds: number): number {
  return Math.floor(thirtySeconds / 2);
}

/** Convert integer sixteenths to a decimal number, e.g. 1198 -> 74.875. */
export function toDecimal(sixteenths: number): number {
  return sixteenths / 16;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
