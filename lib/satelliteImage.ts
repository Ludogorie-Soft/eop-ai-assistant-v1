/**
 * Fetch a Street View image from Google Maps Street View Static API
 * based on location extracted from tender documentation.
 */

const STREET_VIEW_BASE = "https://maps.googleapis.com/maps/api/streetview";
const IMAGE_WIDTH = 800;
const IMAGE_HEIGHT = 500;

/** All kinds of quotation marks used in Bulgarian documents */
const Q = `[„""«»"\u201C\u201D\u201E\u00AB\u00BB]`;

/**
 * Extract city name from text: "гр. Правец", "град Правец", "община Правец"
 */
function extractCity(text: string): string | null {
  const m = text.match(/гр(?:ад)?\.?\s+([А-Яа-я]{2,25})/i);
  if (m) return m[1].trim();
  const m2 = text.match(/община\s+([А-Яа-я]{2,25})/i);
  if (m2) return m2[1].trim();
  // с. (село / village)
  const m3 = text.match(/с\.\s+([А-Яа-я]{2,25})/i);
  if (m3) return m3[1].trim();
  // общ. (общини)
  const m4 = text.match(/общ(?:ина)?\.?\s+([А-Яа-я]{2,25})/i);
  if (m4) return m4[1].trim();
  return null;
}

const STOP_WORDS =
  /^(е|в|на|от|за|до|по|с|се|и|или|при|като|към|без|след|между|има|може|са|ще|да|не)$/i;

/** Remove trailing stop-words from a street name */
function trimStopWords(name: string): string {
  const words = name.split(/\s+/);
  while (words.length > 1 && STOP_WORDS.test(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

/**
 * Search a single text block for a location.
 * Returns a short string like "ул. Христо Ботев, Правец" or null.
 */
function findLocationIn(
  text: string,
): { address: string; city: string | null } | null {
  const city = extractCity(text);

  // ул. (street, quoted) – ПРЕДПОЧИТАМЕ УЛИЦА ПРЕД БУЛЕВАРД
  const streetQuoted = text.match(
    new RegExp(`(?<!б)ул\\.\\s*${Q}([^„""«»"\\n]{2,40})${Q}`, "i"),
  );
  if (streetQuoted) {
    return {
      address: `ул. ${streetQuoted[1].replace(/\s+/g, " ").trim()}`,
      city,
    };
  }

  // ул. (street, unquoted, 1-4 Cyrillic words)
  const streetPlain = text.match(
    /(?<!б)ул\.\s+([А-Яа-я]+(?:\s+[А-Яа-я]+){0,3})/i,
  );
  if (streetPlain) {
    const name = trimStopWords(streetPlain[1].replace(/\s+/g, " ").trim());
    if (name.length >= 2) {
      return { address: `ул. ${name}`, city };
    }
  }

  // улица (full word, no abbreviation)
  const streetFullQuoted = text.match(
    new RegExp(`улица\\s+${Q}([^„""«»"\\n]{2,40})${Q}`, "i"),
  );
  if (streetFullQuoted) {
    return {
      address: `ул. ${streetFullQuoted[1].replace(/\s+/g, " ").trim()}`,
      city,
    };
  }
  const streetFullPlain = text.match(
    /улица\s+([А-Яа-я]+(?:\s+[А-Яа-я]+){0,3})/i,
  );
  if (streetFullPlain) {
    const name = trimStopWords(streetFullPlain[1].replace(/\s+/g, " ").trim());
    if (name.length >= 2) return { address: `ул. ${name}`, city };
  }

  // автомагистрала / АМ (motorway)
  const amMatch = text.match(
    /(?:автомагистрала|АМ)\s+[„"«»"]?([А-Яа-яA-Za-z\s]{3,30}?)[„"«»"]?(?:\s*[,.]|\s+от\s+|\s+в\s+|$)/i,
  );
  if (amMatch) {
    return { address: `АМ ${amMatch[1].replace(/\s+/g, " ").trim()}`, city };
  }

  // /I-1/, /II-61/, /III-806/ road codes (common in BG road tenders)
  const roadCodeMatch = text.match(/\/([IV]+[-–]\d{1,3})\//);
  if (roadCodeMatch) {
    return { address: `Път ${roadCodeMatch[1]}`, city };
  }

  // път / пътен участък (road)
  const roadMatch = text.match(
    /(?:път|пътен\s+участък)\s+([A-ZА-Яа-я\d\s–-]{3,40}?)(?:\s*[,.]|\s+от\s+|\s+в\s+)/i,
  );
  if (roadMatch) {
    return { address: roadMatch[1].replace(/\s+/g, " ").trim(), city };
  }

  // бул. (boulevard) – ако НЯМА ул. или път, ползваме булевард
  const blvdQuoted = text.match(
    new RegExp(`бул\\.\\s*${Q}([^„""«»"\\n]{2,40})${Q}`, "i"),
  );
  if (blvdQuoted) {
    return {
      address: `бул. ${blvdQuoted[1].replace(/\s+/g, " ").trim()}`,
      city,
    };
  }
  const blvdPlain = text.match(/бул\.\s+([А-Яа-я]+(?:\s+[А-Яа-я]+){0,3})/i);
  if (blvdPlain) {
    return {
      address: `бул. ${trimStopWords(blvdPlain[1].replace(/\s+/g, " ").trim())}`,
      city,
    };
  }

  // булевард (full word)
  const blvdFullPlain = text.match(
    /булевард\s+([А-Яа-я]+(?:\s+[А-Яа-я]+){0,3})/i,
  );
  if (blvdFullPlain) {
    const name = trimStopWords(blvdFullPlain[1].replace(/\s+/g, " ").trim());
    if (name.length >= 2) return { address: `бул. ${name}`, city };
  }

  // кв. (квартал / district)
  const kvMatch = text.match(
    /кв(?:артал)?\.\s+([А-Яа-я]+(?:\s+[А-Яа-я]+){0,2})/i,
  );
  if (kvMatch) {
    const name = trimStopWords(kvMatch[1].replace(/\s+/g, " ").trim());
    if (name.length >= 2) return { address: `кв. ${name}`, city };
  }

  // Only city found
  if (city) {
    return { address: city, city };
  }

  return null;
}

/**
 * Try to extract a meaningful location query from the introduction or raw text.
 * Searches the introduction FIRST (it has the main subject), then falls back to rawText.
 */
export function extractLocation(
  introductionText: string,
  rawText?: string,
): string | null {
  const fromIntro = findLocationIn(introductionText);
  const fromRaw = rawText ? findLocationIn(rawText) : null;

  // Ако уводът съдържа конкретна улица/булевард/път (не само град),
  // ползваме него, защото е най-близо до реалния описан обект.
  // Ако в увода имаме само град, но в rawText има улица, падаме обратно към rawText.
  const introHasOnlyCity =
    fromIntro && fromIntro.city && fromIntro.address === fromIntro.city;
  const result =
    (fromIntro && !introHasOnlyCity ? fromIntro : null) ?? fromRaw ?? fromIntro;
  if (!result) return null;

  const city = fromIntro?.city ?? fromRaw?.city;
  if (city && !result.address.includes(city)) {
    return `${result.address}, ${city}, България`;
  }
  return `${result.address}, България`;
}

/**
 * Fetch a Street View image from Google Maps Street View Static API.
 * Returns the JPEG buffer, or null if the API key is missing, no coverage, or request fails.
 */
export async function fetchStreetViewImage(
  location: string,
): Promise<Buffer | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn(
      "[streetView] GOOGLE_MAPS_API_KEY not set, skipping Street View image",
    );
    return null;
  }

  const metaParams = new URLSearchParams({
    location,
    key: apiKey,
  });
  try {
    const metaRes = await fetch(
      `${STREET_VIEW_BASE}/metadata?${metaParams.toString()}`,
    );
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as { status?: string };
      if (meta.status !== "OK") {
        console.warn(
          `[streetView] No Street View coverage for "${location}" (status: ${meta.status})`,
        );
        return null;
      }
    }
  } catch {
    // metadata check failed, try fetching anyway
  }

  const params = new URLSearchParams({
    location,
    size: `${IMAGE_WIDTH}x${IMAGE_HEIGHT}`,
    fov: "90",
    pitch: "0",
    key: apiKey,
  });

  const url = `${STREET_VIEW_BASE}?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(
        `[streetView] Google Street View API error: ${res.status} ${res.statusText}`,
      );
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error("[streetView] Failed to fetch Street View image:", err);
    return null;
  }
}

export const STREET_VIEW_IMAGE_WIDTH = IMAGE_WIDTH;
export const STREET_VIEW_IMAGE_HEIGHT = IMAGE_HEIGHT;
