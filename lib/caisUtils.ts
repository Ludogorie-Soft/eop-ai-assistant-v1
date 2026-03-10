/** Extract CAIS/EOP URL from raw text (e.g. "--- CAIS: https://... ---") */
export function extractCaisUrlFromRawText(rawText: string): string | null {
  const m = rawText.match(/--- CAIS:\s*(https?:\/\/[^\s]+)\s*---/);
  return m?.[1] ?? null;
}
  