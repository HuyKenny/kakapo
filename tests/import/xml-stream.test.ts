import { describe, expect, it } from 'vitest';
import { decodeXmlStream, parseXmlItems, type XmlNode } from '../../workers/import/src/xml/stream';
import { md5 } from '../../workers/import/src/util/md5';
import { parseWithFormat, toYmd } from '../../workers/import/src/xml/mapper';
import { gzipSync } from 'node:zlib';

async function* chunks(s: string, size = 1_000_000): AsyncGenerator<string> { for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size); }
async function collect(it: AsyncIterable<XmlNode>) { const out: XmlNode[] = []; for await (const n of it) out.push(n); return out; }
const stream = (b: Uint8Array) => new Response(b as unknown as BodyInit).body!;

const DOC = `<?xml version="1.0"?><!-- c --><r:feed xmlns:r="urn:x"><meta><skip>ignored outside</skip></meta><r:item id="1" a='x&amp;y'><name>A &lt; B &amp; &#269;&#x161;</name><d><![CDATA[<b>raw & text</b>]]></d><e/><n><i>1</i><i>2</i></n></r:item><item id="2"><name>Second</name></item></r:feed>`;

describe('streaming XML parser', () => {
  it('emits items with attributes, entities, CDATA, namespaces and self-closing tags', async () => {
    const items = await collect(parseXmlItems(chunks(DOC), 'item'));
    expect(items.map((i) => i.attrs.id)).toEqual(['1', '2']);
    const first = items.find((i) => i.attrs.id === '1')!;
    expect(first.attrs.a).toBe('x&y');
    expect(first.children[0]!.text).toBe('A < B & čš');
    expect(first.children[1]!.text).toBe('<b>raw & text</b>');
    expect(first.children[3]!.children.map((c) => c.text)).toEqual(['1', '2']);
  });
  it('gives the same result for any chunk size (tags, CDATA and entities split across chunks)', async () => {
    const whole = JSON.stringify(await collect(parseXmlItems(chunks(DOC), 'item')));
    for (const size of [1, 2, 3, 7, 13, 50]) expect(JSON.stringify(await collect(parseXmlItems(chunks(DOC, size), 'item')))).toBe(whole);
  });
  it('rejects a truncated document', async () => {
    await expect(collect(parseXmlItems(chunks(DOC.slice(0, DOC.length - 30)), 'item'))).rejects.toMatchObject({ code: 'truncated' });
  });
  it('rejects mismatched tags as malformed', async () => {
    await expect(collect(parseXmlItems(chunks('<a><item><x></y></item></a>'), 'item'))).rejects.toMatchObject({ code: 'malformed' });
  });
  it('rejects empty input', async () => {
    await expect(collect(parseXmlItems(chunks('   '), 'item'))).rejects.toMatchObject({ code: 'empty' });
  });
  it('refuses DOCTYPE with entities (XXE / billion laughs)', async () => {
    const evil = '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "boom">]><a><item>&x;</item></a>';
    await expect(collect(parseXmlItems(chunks(evil), 'item'))).rejects.toMatchObject({ code: 'doctype' });
    // an external id is never fetched (Invia sends one): accepted and ignored
    const ext = '<!DOCTYPE offers SYSTEM "https://example.invalid/x.dtd"><offers><item>ok</item></offers>';
    expect((await collect(parseXmlItems(chunks(ext), 'item'))).length).toBe(1);
  });
  it('does not decode unknown entities and keeps numeric ones', async () => {
    const [n] = await collect(parseXmlItems(chunks('<a><item>&nbsp;&#65;</item></a>'), 'item'));
    expect(n!.text).toBe('&nbsp;A');
  });
  it('enforces depth, item size and node-count limits', async () => {
    const limits = { maxDepth: 5, maxItemChars: 200, maxItemNodes: 10, maxTotalChars: 10_000 };
    await expect(collect(parseXmlItems(chunks('<a>' + '<b>'.repeat(10) + '</b>'.repeat(10) + '</a>'), 'item', limits))).rejects.toMatchObject({ code: 'limit' });
    await expect(collect(parseXmlItems(chunks('<a><item>' + 'x'.repeat(500) + '</item></a>'), 'item', limits))).rejects.toMatchObject({ code: 'limit' });
    await expect(collect(parseXmlItems(chunks('<a><item>' + '<i/>'.repeat(50) + '</item></a>'), 'item', limits))).rejects.toMatchObject({ code: 'limit' });
    await expect(collect(parseXmlItems(chunks('<a>' + '<item/>'.repeat(2000) + '</a>'), 'item', limits))).rejects.toMatchObject({ code: 'limit' });
  });
  it('does not keep memory for content outside items (only item trees are built)', async () => {
    const big = '<a>' + '<other>' + 'y'.repeat(300_000) + '</other>'.repeat(1) + '<item>ok</item></a>';
    const items = await collect(parseXmlItems(chunks(big, 4096), 'item'));
    expect(items).toHaveLength(1);
  });
});

describe('byte decoding', () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><a><item>příliš žluťoučký</item></a>';
  async function decoded(b: Uint8Array) { let s = ''; for await (const c of decodeXmlStream(stream(b), { maxBytes: 1e6 })) s += c; return s; }
  it('reads plain UTF-8', async () => { expect(await decoded(new TextEncoder().encode(xml))).toBe(xml); });
  it('detects and unzips gzip by magic bytes', async () => { expect(await decoded(gzipSync(Buffer.from(xml)))).toBe(xml); });
  it('honours the declared encoding (windows-1250)', async () => {
    const b = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="windows-1250"?><a><item>'), Buffer.from([0xe8, 0x9a, 0x9e]), Buffer.from('</item></a>')]);
    expect(await decoded(b)).toContain('čšž');
  });
  it('fails on invalid bytes for the declared encoding instead of importing mojibake', async () => {
    const b = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="UTF-8"?><a><item>'), Buffer.from([0xff, 0xfe, 0xfd]), Buffer.from('</item></a>')]);
    await expect(decoded(b)).rejects.toMatchObject({ code: 'encoding' });
  });
  it('fails on an empty body', async () => { await expect(decoded(new Uint8Array(0))).rejects.toMatchObject({ code: 'empty' }); });
  it('caps the decompressed size (gzip bomb)', async () => {
    const bomb = gzipSync(Buffer.alloc(5_000_000, 0x61));
    await expect((async () => { for await (const _ of decodeXmlStream(stream(bomb), { maxBytes: 100_000 })) void _; })()).rejects.toMatchObject({ code: 'limit' });
  });
  it('md5 matches the PHP hash used for Invia ids', () => { expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72'); expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e'); });
  it('parses dates like the PHP transforms', () => {
    expect(toYmd('2026-12-05T10:00:00')).toBe('2026-12-05'); expect(toYmd('5. 12. 2026')).toBe('2026-12-05'); expect(toYmd('31.02.2026')).toBeNull();
    expect(parseWithFormat('d.m.Y', '05.12.2026')).toBe('2026-12-05'); expect(parseWithFormat('d.m.Y', 'x')).toBeNull();
  });
});
