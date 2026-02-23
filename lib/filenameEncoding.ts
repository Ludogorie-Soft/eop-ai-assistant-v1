/**
 * Fix UTF-8 mojibake in filenames
 * When UTF-8 bytes are incorrectly interpreted as Latin-1, we can recover
 */

export function fixFilenameEncoding(filename: string): string {
  if (!filename || /[\u0400-\u04FF]/.test(filename)) {
    return filename;
  }
  try {
    const fixed = Buffer.from(filename, 'latin1').toString('utf8');
    if (fixed && !/�/.test(fixed)) {
      return fixed;
    }
  } catch {
    // ignore
  }
  return filename;
}
