/**
 * Debug script: Parse DOCX files and output diagnostic information
 * about SMR technology extraction using the FIXED logic.
 *
 * Usage: npx tsx scripts/debug-docx.ts <path-to-docx>
 */

import * as fs from "fs";
import mammoth from "mammoth";
import { htmlToPlainText } from "../lib/offerParser";

function findTableEnd(html: string, tableStartPos: number): number {
  const tagRe = /<(\/?)table[^>]*>/gi;
  tagRe.lastIndex = tableStartPos;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    if (match[1] === "/") {
      depth--;
      if (depth === 0) return match.index + match[0].length;
    } else {
      depth++;
    }
  }
  return Math.min(tableStartPos + 8000, html.length);
}

function findAllTables(html: string) {
  const tableStartRe = /<table(?:\s[^>]*)?>/gi;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = tableStartRe.exec(html)) !== null) {
    starts.push(m.index);
  }
  return starts;
}

const subTablePatterns = [
  /роля\s+(на\s+)?отговорн/i,
  /експерт\s*[\/\\|,]\s*(длъжност|роля)/i,
  /длъжност\s*[\/\\|,]\s*експерт/i,
  /^отговорен\s+експерт$/i,
  /^отговорност/i,
  /^експерт$/i,
  /^длъжност$/i,
  /^специалист$/i,
  /^роля$/i,
  /^(№|No\.?|#)\s*$/i,
  /^задача$/i,
  /^етап$/i,
  /^показател$/i,
  /^параметър$/i,
  /^материал$/i,
  /^машина$/i,
  /^механизация$/i,
  /^вид\s+контрол$/i,
  /^коефициент$/i,
  /^категория\s+персонал/i,
  /^изпитване$/i,
  /^контролиран\s+елемент$/i,
  /^контролен\s+параметър$/i,
  /^машина\s*[\/\\|]\s*съоръжение/i,
  /^съоръжение\s*[\/\\|]\s*машина/i,
  /^клас(ове)?\s+на\s+улиц/i,
  /^група\s+по\s+тс/i,
  /^брой\s+на\s+пътните\s+знаци/i,
  /^член\s+на\s+екип/i,
];

function analyzeTableFixed(html: string, pos: number) {
  const tableEnd = findTableEnd(html, pos);
  const preview = html.slice(pos, tableEnd);
  const previewLower = preview.toLowerCase();

  let kwCount = 0;
  const kwFound: string[] = [];
  if (previewLower.includes("ангажирани")) { kwCount++; kwFound.push("ангажирани"); }
  if (previewLower.includes("строителни лица")) { kwCount++; kwFound.push("строителни лица"); }
  if (previewLower.includes("технически ресурси")) { kwCount++; kwFound.push("технически ресурси"); }
  if (previewLower.includes("механизация")) { kwCount++; kwFound.push("механизация"); }

  const firstCellMatch = preview.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i);
  const rawName = firstCellMatch ? htmlToPlainText(firstCellMatch[1]).trim() : "";

  const isSubTable = rawName ? subTablePatterns.some((re) => re.test(rawName)) : false;
  const nameOk = rawName.length > 3 && rawName.length < 300;
  const isSMR = kwCount >= 2 && !isSubTable && nameOk;

  return {
    pos,
    tableEnd,
    tableSize: tableEnd - pos,
    kwCount,
    kwFound,
    firstCell: rawName.slice(0, 150),
    firstCellLen: rawName.length,
    isSubTable,
    nameOk,
    isSMR,
  };
}

async function debugDocx(filePath: string) {
  const buffer = fs.readFileSync(filePath);

  const { value: fullHtml } = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async () => ({ src: "IMG_PLACEHOLDER" })),
    }
  );

  const fullPlainText = htmlToPlainText(fullHtml);

  console.log("=".repeat(80));
  console.log(`FILE: ${filePath}`);
  console.log(`HTML length: ${fullHtml.length}`);
  console.log(`Plain text length: ${fullPlainText.length}`);
  console.log("=".repeat(80));

  const tableStarts = findAllTables(fullHtml);
  const smrTables: { pos: number; name: string }[] = [];
  let falsePositivesFixed = 0;

  for (const pos of tableStarts) {
    const info = analyzeTableFixed(fullHtml, pos);
    if (info.isSMR) {
      smrTables.push({ pos, name: info.firstCell });
    }
    // Show tables that would have been detected with old 4000-char window but aren't now
    if (!info.isSMR && info.kwCount >= 1) {
      // Check old method
      const oldPreview = fullHtml.slice(pos, pos + 4000).toLowerCase();
      let oldKw = 0;
      if (oldPreview.includes("ангажирани")) oldKw++;
      if (oldPreview.includes("строителни лица")) oldKw++;
      if (oldPreview.includes("технически ресурси")) oldKw++;
      if (oldPreview.includes("механизация")) oldKw++;
      const oldWouldDetect = oldKw >= 2 && !info.isSubTable && info.nameOk;
      if (oldWouldDetect && !info.isSMR) {
        falsePositivesFixed++;
        console.log(`  [FIXED FALSE POSITIVE] @ ${pos} | Old kw: ${oldKw}, New kw: ${info.kwCount} | Table size: ${info.tableSize} | "${info.firstCell}"`);
      }
    }
  }

  console.log(`\nTotal tables: ${tableStarts.length}`);
  console.log(`SMR tables detected (FIXED): ${smrTables.length}`);
  console.log(`False positives eliminated: ${falsePositivesFixed}`);

  // Show SMR sections
  if (smrTables.length > 0) {
    console.log("\n--- SMR TECHNOLOGY SECTIONS (FIXED) ---");
    for (let i = 0; i < smrTables.length; i++) {
      const start = smrTables[i].pos;
      const end = i + 1 < smrTables.length ? smrTables[i + 1].pos : fullHtml.length;
      const sectionHtml = fullHtml.slice(start, end);
      const sectionText = htmlToPlainText(sectionHtml);

      console.log(`\n  SMR #${i + 1}: "${smrTables[i].name.slice(0, 100)}"`);
      console.log(`    HTML range: ${start} - ${end} (${end - start} chars)`);
      console.log(`    Plain text length: ${sectionText.length}`);
      // Show if it contains "Материали:" and content after
      const matIdx = sectionText.indexOf("Материали:");
      if (matIdx !== -1) {
        const afterMat = sectionText.slice(matIdx, matIdx + 200).replace(/\n/g, " | ");
        console.log(`    Materials section: "${afterMat}"`);
      }
    }
    console.log("\n--- END SMR SECTIONS ---");
  }
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx tsx scripts/debug-docx.ts <path-to-docx>");
  process.exit(1);
}

debugDocx(filePath).catch(console.error);
