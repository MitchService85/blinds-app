// Turns a dictated sentence into a partially-filled window record.
//
// Speech-to-text is left to the phone (the iOS keyboard's microphone key,
// which runs on-device and so still works in a dead zone). This module only
// parses the resulting TEXT, deliberately with plain rules rather than a
// language model: it must work offline, and a rule-based parser either
// understands a measurement or visibly fails to, where a model can quietly
// turn "95 1/2" into something plausible and wrong. Anything not confidently
// recognised is left blank for the tech to fill in.
//
// Nothing here saves. The caller shows the parse for confirmation first.

import type { ControlOverride, Deduct } from "./types";

export interface ParsedWindow {
  /** Room tag, e.g. "LR". Undefined when no room word was heard. */
  tag_base?: string;
  /** 0 = unnumbered; 2 for "living room 2". */
  tag_index?: number;
  /** Panel widths in integer sixteenths, left to right. */
  widths?: number[];
  /** Height in integer sixteenths. */
  height?: number;
  deduct?: Deduct;
  longer_chain?: boolean;
  control_override?: ControlOverride;
  quantity?: number;
}

export interface ParseResult {
  fields: ParsedWindow;
  /** Field names understood, for the confirmation UI to highlight. */
  matched: string[];
  /** Words left over after every rule ran — usually a misheard phrase. */
  leftover: string;
}

/**
 * Spoken room names to the tag abbreviations used in exports. Values match
 * the default residential/commercial chip sets (see the new-job wizard);
 * a project's own chips are matched separately in `resolveTag`.
 */
const ROOM_WORDS: Array<[RegExp, string]> = [
  [/\bmaster\s*(?:bed\s*room|bedroom|bed)?\b/, "MBR"],
  [/\bliving\s*room\b/, "LR"],
  [/\bbed\s*room\b/, "BR"],
  [/\bboard\s*room\b/, "Boardroom"],
  [/\breception\b/, "Reception"],
  [/\bcorridor\b/, "Corridor"],
  [/\bkitchen\b/, "Kit"],
  [/\bstudio\b/, "Studio"],
  [/\boffice\b/, "Office"],
  [/\bbath\s*room\b/, "Bath"],
  [/\bden\b/, "Den"],
  // Spoken initialisms: dictation renders these with spaces or periods.
  [/\bm\.?\s?b\.?\s?r\b/, "MBR"],
  [/\bl\.?\s?r\b/, "LR"],
  [/\bb\.?\s?r\b/, "BR"],
];

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const UNICODE_FRACTIONS: Record<string, string> = {
  "½": " 1/2", "¼": " 1/4", "¾": " 3/4",
  "⅛": " 1/8", "⅜": " 3/8", "⅝": " 5/8", "⅞": " 7/8",
};

/** Spoken fraction phrases to their ascii form. */
const WORD_FRACTIONS: Array<[RegExp, string]> = [
  [/\b(?:and\s+)?(?:a\s+)?half\b/g, " 1/2"],
  [/\b(?:and\s+)?(?:a\s+)?quarter\b/g, " 1/4"],
  [/\b(?:and\s+)?three\s+quarters\b/g, " 3/4"],
  [/\b(?:and\s+)?(?:an\s+)?eighth\b/g, " 1/8"],
  [/\b(?:and\s+)?three\s+eighths\b/g, " 3/8"],
  [/\b(?:and\s+)?five\s+eighths\b/g, " 5/8"],
  [/\b(?:and\s+)?seven\s+eighths\b/g, " 7/8"],
];

function normalize(input: string): string {
  let s = input.toLowerCase();
  for (const [glyph, ascii] of Object.entries(UNICODE_FRACTIONS)) {
    s = s.split(glyph).join(ascii);
  }
  for (const [re, ascii] of WORD_FRACTIONS) s = s.replace(re, ascii);
  // Dictation punctuation carries no meaning here; commas and "plus" do
  // separate panels, so keep them as spaces and rely on ordering.
  s = s.replace(/[.!?;:]/g, " ");
  s = s.replace(/\bby\b|\bx\b|×/g, " by ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Parse "95 1/2" / "95.5" / "95" into integer sixteenths. Returns null when
 * the text is not a measurement.
 */
export function parseMeasurement(text: string): number | null {
  const m = text
    .trim()
    .match(/^(\d+)(?:\s+(\d+)\s*\/\s*(\d+))?$/) ?? text.trim().match(/^(\d+)\.(\d+)$/);
  if (!m) return null;

  if (text.includes("/")) {
    const whole = parseInt(m[1], 10);
    const num = m[2] ? parseInt(m[2], 10) : 0;
    const den = m[3] ? parseInt(m[3], 10) : 1;
    if (!den || 16 % den !== 0) return null;
    return whole * 16 + (num * 16) / den;
  }

  const decimal = parseFloat(text.trim());
  if (Number.isNaN(decimal)) return null;
  const sixteenths = Math.round(decimal * 16);
  // Reject values that were not expressible in sixteenths (e.g. "95.33"):
  // better to leave the field blank than to record a rounded guess.
  return Math.abs(decimal * 16 - sixteenths) < 1e-6 ? sixteenths : null;
}

/** Pull every "<whole> [n/d]" measurement out of a phrase, in order. */
function extractMeasurements(text: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const piece = m[2] ? `${m[1]} ${m[2]}/${m[3]}` : m[1];
    const value = parseMeasurement(piece);
    if (value !== null) out.push(value);
  }
  return out;
}

/**
 * Build a matcher for a project chip. Short chips are initialisms that
 * dictation renders with spaces or periods ("BR2" heard as "b r 2"), so
 * allow an optional separator between characters; longer names ("Boardroom")
 * match literally.
 */
function chipPattern(chip: string): RegExp {
  const escaped = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lower = chip.toLowerCase();
  if (lower.length > 4) return new RegExp(`\\b${escaped(lower)}\\b`);
  const body = lower
    .split("")
    .map(escaped)
    .join("\\.?\\s?");
  return new RegExp(`\\b${body}\\b`);
}

function resolveTag(
  text: string,
  chips: string[]
): { tag_base: string; tag_index: number; rest: string } | null {
  // A project's own chips win over the built-in room words, so a custom
  // chip (e.g. "BR2") is still reachable by saying it directly.
  for (const chip of [...chips].sort((a, b) => b.length - a.length)) {
    const re = chipPattern(chip);
    const hit = text.match(re);
    if (hit) {
      const rest = text.replace(re, " ");
      return { ...withIndex(chip, rest), tag_base: chip };
    }
  }

  for (const [re, tag] of ROOM_WORDS) {
    const hit = text.match(re);
    if (!hit) continue;
    const rest = text.replace(re, " ");
    return withIndex(tag, rest);
  }
  return null;
}

/**
 * A number immediately after the room word is its index ("living room 2"),
 * not a measurement. Only single digits count, so "living room 95 1/2 wide"
 * cannot swallow a width.
 */
function withIndex(
  tag_base: string,
  rest: string
): { tag_base: string; tag_index: number; rest: string } {
  const trimmed = rest.replace(/^\s+/, "");
  const m = trimmed.match(/^(?:number\s+)?(\d|one|two|three|four|five|six|seven|eight|nine)\b(?!\s*\/)/);
  if (!m) return { tag_base, tag_index: 0, rest };

  // "living room 1 95 1/2" — a following measurement confirms this digit is
  // the index. A lone number after the tag is treated as a width instead.
  const after = trimmed.slice(m[0].length).trim();
  if (!/^\d/.test(after) && !/^(?:wide|width|by)/.test(after)) {
    return { tag_base, tag_index: 0, rest };
  }
  const index = WORD_NUMBERS[m[1]] ?? parseInt(m[1], 10);
  return { tag_base, tag_index: index, rest: trimmed.slice(m[0].length) };
}

/**
 * Parse a dictated window description.
 *
 * @param input Raw text from dictation.
 * @param tagChips The project's room-tag chips, matched ahead of the
 *   built-in room words so custom tags are reachable.
 */
export function parseSpokenWindow(input: string, tagChips: string[] = []): ParseResult {
  const fields: ParsedWindow = {};
  const matched: string[] = [];
  let text = normalize(input);

  const tag = resolveTag(text, tagChips);
  if (tag) {
    fields.tag_base = tag.tag_base;
    fields.tag_index = tag.tag_index;
    matched.push("tag");
    text = normalize(tag.rest);
  }

  // Flags are consumed before dimensions so their numbers ("times 13")
  // cannot be mistaken for a measurement.
  const quantity = text.match(/\b(?:times|quantity|qty|by a quantity of)\s+(\d+)\b/);
  if (quantity) {
    fields.quantity = parseInt(quantity[1], 10);
    matched.push("quantity");
    text = text.replace(quantity[0], " ");
  }

  // Control side is matched before deducts: "deduct left, left control"
  // contains two "left"s, and the deduct rule clears the word once matched.
  if (/\bleft\s+(?:control|drive)\b|\bcontrol\s+left\b/.test(text)) {
    fields.control_override = "L";
    matched.push("left control");
    text = text.replace(/\bleft\s+(?:control|drive)\b|\bcontrol\s+left\b/g, " ");
  } else if (/\bright\s+(?:control|drive)\b|\bcontrol\s+right\b/.test(text)) {
    fields.control_override = "R";
    matched.push("right control");
    text = text.replace(/\bright\s+(?:control|drive)\b|\bcontrol\s+right\b/g, " ");
  }

  if (/\bdeduct(?:ion)?s?\b[^.]*\bboth\b|\bboth\b[^.]*\bdeduct/.test(text)) {
    fields.deduct = "D";
    matched.push("deduct");
    text = text.replace(/\bdeduct(?:ion)?s?\b|\bboth\s*(?:sides?)?\b/g, " ");
  } else if (/\bdeduct(?:ion)?s?\b[^.]*\bleft\b|\bleft\b[^.]*\bdeduct/.test(text)) {
    fields.deduct = "Dl";
    matched.push("deduct");
    text = text.replace(/\bdeduct(?:ion)?s?\b|\bleft\s*(?:side)?\b/g, " ");
  } else if (/\bdeduct(?:ion)?s?\b[^.]*\bright\b|\bright\b[^.]*\bdeduct/.test(text)) {
    fields.deduct = "Dr";
    matched.push("deduct");
    text = text.replace(/\bdeduct(?:ion)?s?\b|\bright\s*(?:side)?\b/g, " ");
  }

  if (/\b(?:longer|long)\s+chain\b/.test(text)) {
    fields.longer_chain = true;
    matched.push("longer chain");
    text = text.replace(/\b(?:longer|long)\s+chain\b/g, " ");
  }

  // Dimensions. "by" splits width(s) from height; explicit "wide"/"tall"
  // labels win over position when both appear.
  const [widthPart, heightPart] = splitDimensions(text);
  const widths = extractMeasurements(widthPart);
  const heights = extractMeasurements(heightPart);

  if (widths.length > 0) {
    fields.widths = widths;
    matched.push(widths.length > 1 ? `${widths.length} panel widths` : "width");
  }
  if (heights.length > 0) {
    fields.height = heights[0];
    matched.push("height");
  }

  const leftover = text
    .replace(/\d+(?:\s+\d+\s*\/\s*\d+)?/g, " ")
    .replace(/\b(?:wide|width|tall|high|height|by|and|inches|inch|panels?)\b/g, " ")
    .replace(/[,\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { fields, matched, leftover };
}

/**
 * Split a phrase into the width side and the height side. Honours explicit
 * "tall"/"high" labels wherever they fall, so "87 tall by 95 wide" is not
 * read backwards.
 */
function splitDimensions(text: string): [string, string] {
  const parts = text.split(/\bby\b/);
  if (parts.length < 2) return [text, ""];

  const first = parts[0];
  const rest = parts.slice(1).join(" by ");

  const firstIsHeight = /\b(?:tall|high|height)\b/.test(first);
  const restIsWidth = /\b(?:wide|width)\b/.test(rest);
  if (firstIsHeight && restIsWidth) return [rest, first];
  return [first, rest];
}
