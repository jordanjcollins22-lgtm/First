/**
 * The label that goes on the thing.
 *
 * Short, unambiguous, and typeable. A QR code is scanned ninety-nine times
 * out of a hundred, and the hundredth is somebody in the rain with a cracked
 * camera reading it out loud — so the alphabet leaves out the characters that
 * get misread, and the code is short enough to say down a phone.
 */

/** No O/0, no I/1/L, no U (reads as V handwritten). What is left cannot be
 * misheard or mistyped into a different real code. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export const CODE_LENGTH = 6;

export function generateCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return code;
}

/**
 * What somebody typed, as the code it was meant to be.
 *
 * Case does not matter, spaces and dashes do not matter, and the characters
 * left out of the alphabet are folded onto the ones they get confused with —
 * somebody who types O meant zero's replacement, and refusing them over a
 * font is not help.
 */
export function normaliseCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/U/g, "V")
    // Those two do not exist in the alphabet, so map them onto what does.
    .replace(/0/g, "Q")
    .replace(/1/g, "7");
}

export function isValidCode(input: string): boolean {
  const code = normaliseCode(input);
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

/** Where a scan lands. Relative so it works on whatever domain the app is
 * served from, and short so the QR stays coarse enough to scan from a metre
 * away in bad light. */
export function scanPath(code: string): string {
  return `/i/${code}`;
}
