import fs from 'fs';
import { parseSmrTemplateDocx } from './lib/smrTemplateParser';

async function test() {
  const buf = fs.readFileSync('Шаблони СМР.docx');
  const templates = await parseSmrTemplateDocx(buf);

  // Find the asphalt section
  const t = templates.find(t => t.title.includes('плътен асфалтобетон'));
  if (!t) { console.log('Not found'); return; }

  // Show a portion of the HTML body to understand the structure
  // Look for the pattern around bullet icons
  const html = t.htmlBody;

  // Find image-containing paragraphs
  const pRegex = /<p[^>]*>[\s\S]*?<\/p\s*>/gi;
  let m;
  let count = 0;
  while ((m = pRegex.exec(html)) !== null) {
    const p = m[0];
    const hasImg = /<img/i.test(p);
    const textOnly = p.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

    if (hasImg || (count > 0 && count < 5)) {
      count++;
      const imgCount = (p.match(/<img/gi) || []).length;
      const truncated = p.length > 200 ? p.substring(0, 200) + '...' : p;
      console.log(`\n--- Paragraph ${count} (imgs: ${imgCount}, text: ${textOnly.length} chars) ---`);
      console.log(truncated);
      if (textOnly.length > 0 && textOnly.length < 200) {
        console.log('TEXT:', textOnly.substring(0, 100));
      }
    }
    if (count >= 15) break;
  }

  // Also check: how many images are in tables vs outside
  const tableRegex = /<table[\s\S]*?<\/table\s*>/gi;
  let imgsInTables = 0;
  let imgsOutside = 0;
  let tm;
  const tableRanges: {start: number, end: number}[] = [];
  while ((tm = tableRegex.exec(html)) !== null) {
    tableRanges.push({ start: tm.index, end: tm.index + tm[0].length });
  }

  const imgRegex = /<img[^>]*>/gi;
  let im;
  while ((im = imgRegex.exec(html)) !== null) {
    const inTable = tableRanges.some(r => im!.index >= r.start && im!.index < r.end);
    if (inTable) imgsInTables++;
    else imgsOutside++;
  }
  console.log(`\n\nImages in tables: ${imgsInTables}`);
  console.log(`Images outside tables: ${imgsOutside}`);
  console.log(`Total tables in this section: ${tableRanges.length}`);
}
test();
