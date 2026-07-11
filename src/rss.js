/** Minimal RSS 2.0 item extraction — enough for the feeds we consume. */

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function tagContent(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  let content = m[1].trim();
  const cdata = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) return cdata[1].trim();
  return decodeEntities(content);
}

export function parseRss(xml) {
  const items = [];
  const re = /<item[\s>][\s\S]*?<\/item>/gi;
  for (const m of xml.matchAll(re)) {
    const block = m[0];
    items.push({
      title: tagContent(block, 'title'),
      link: tagContent(block, 'link'),
      guid: tagContent(block, 'guid') || tagContent(block, 'link'),
      pubDate: tagContent(block, 'pubDate'),
      description: tagContent(block, 'description'),
    });
  }
  return items;
}
