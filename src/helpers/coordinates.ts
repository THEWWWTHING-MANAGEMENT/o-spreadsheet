//------------------------------------------------------------------------------
// Coordinate
//------------------------------------------------------------------------------

/**
 * Convert a (col) number to the corresponding letter.
 *
 * Examples:
 *     0 => 'A'
 *     25 => 'Z'
 *     26 => 'AA'
 *     27 => 'AB'
 */
export function numberToLetters(n: number): string {
  if (n < 26) {
    return String.fromCharCode(65 + n);
  } else {
    return numberToLetters(Math.floor(n / 26) - 1) + numberToLetters(n % 26);
  }
}

/**
 * Convert a string (describing a column) to its number value.
 *
 * Examples:
 *     'A' => 0
 *     'Z' => 25
 *     'AA' => 26
 */
export function lettersToNumber(letters: string): number {
  let result = 0;
  const l = letters.length;
  for (let i = 0; i < l; i++) {
    let n = letters.charCodeAt(i) - 65 + (i < l - 1 ? 1 : 0);
    result += n * 26 ** (l - i - 1);
  }
  return result;
}

/**
 * Convert a "XC" coordinate to cartesian coordinates.
 *
 * Examples:
 *   A1 => [0,0]
 *   B3 => [1,2]
 *
 * Note: it also accepts lowercase coordinates, but not fixed references
 */
export function toCartesian(xc: string): [number, number] {
  xc = xc.toUpperCase();
  const [m, letters, numbers] = xc.match(/([A-Z]*)([0-9]*)/)!;
  if (m !== xc) {
    throw new Error(`Invalid cell description: ${xc}`);
  }
  const col = lettersToNumber(letters);
  const row = parseInt(numbers, 10) - 1;
  return [col, row];
}

/**
 * Convert from cartesian coordinate to the "XC" coordinate system.
 *
 * Examples:
 *   [0,0] => A1
 *   [1,2] => B3
 *
 * Note: it does not support fixed references
 */
export function toXC(col: number, row: number): string {
  return numberToLetters(col) + String(row + 1);
}