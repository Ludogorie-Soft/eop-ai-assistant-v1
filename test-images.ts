
import fs from 'fs';
import { parseSmrTemplateDocx } from './lib/smrTemplateParser';
import { htmlToDocxElements } from './lib/htmlToDocxBody';

async function test() {
  const buf = fs.readFileSync('Шаблони СМР.docx');
  const templates = await parseSmrTemplateDocx(buf);

  // Find the template with 43 images (asphalt one)
  const t = templates.find(t => t.title.includes('плътен асфалтобетон'));
  if (!t) { console.log('Not found'); return; }

  console.log('Template:', t.title);
  const imgCount = [...t.htmlBody.matchAll(/<img[^>]*>/gi)].length;
  console.log('Images in htmlBody:', imgCount);

  // Check what types of images are present
  for (const m of t.htmlBody.matchAll(/<img[^>]*src="(data:image\/[^;]+;base64,[A-Za-z0-9+/=]{0,40})[^"]*"/gi)) {
    const srcPrefix = m[1];
    console.log('  img src prefix:', srcPrefix.substring(0, 50));
  }

  const elements = htmlToDocxElements(t.htmlBody);
  console.log('Total paragraphs from htmlToDocxElements:', elements.length);

  // Serialize to check for w:drawing (ImageRun indicator)
  let imageRunCount = 0;
  for (const el of elements) {
    const json = JSON.stringify(el);
    const drawings = json.match(/"w:drawing"/g);
    if (drawings) imageRunCount += drawings.length;
  }
  console.log('Paragraphs with ImageRun:', imageRunCount);
}
test();
