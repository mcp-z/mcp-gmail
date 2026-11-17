import '../../../lib/env-loader.ts';
import type { gmail_v1 } from '@googleapis/gmail';
import assert from 'assert';
import { parse } from 'node-html-parser';
import { extractBodyFromPayload } from '../../../../src/email/parsing/html-processing.ts';

function htmlPayload(html: string): gmail_v1.Schema$MessagePart {
  return { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64') } }] };
}

const DEEP = 5000;
const deep = (inner: string) => `${'<div>'.repeat(DEEP)}${inner}${'</div>'.repeat(DEEP)}`;

describe('extractBodyFromPayload', () => {
  describe('text from HTML', () => {
    const samples = [
      '<p>Hello World</p>',
      '<div>a &amp; b &lt;c&gt; &nbsp;d &quot;q&quot; &#169; &eacute;</div>',
      '<p>line1<br>line2<br/>line3</p>',
      '<div>one</div><div>two</div><p>three</p>',
      '<ul><li>a</li><li>b</li></ul>',
      '<table><tr><td>x</td><td>y</td></tr></table>',
      '<p>hi</p><script>var a=1;</script><style>p{}</style>',
      '<p>a<!-- c -->b</p>',
      '<div><span>a</span> <b>b</b><i>c</i></div>',
    ];

    it('matches the html parser text for ordinary HTML', () => {
      for (const html of samples) assert.strictEqual(extractBodyFromPayload(htmlPayload(html)), parse(html).text, html);
    });

    it('trims the ends and uses LF line breaks', () => {
      assert.strictEqual(extractBodyFromPayload(htmlPayload('\n  <p>a\r\nb</p>\n  ')), 'a\nb');
    });

    it('returns the text for 5000-deep nesting', () => {
      assert.strictEqual(extractBodyFromPayload(htmlPayload(deep('text'))), 'text');
    });

    it('returns the text for 5000-deep nesting without thread history', () => {
      const html = deep('text<blockquote>old</blockquote>');
      assert.strictEqual(extractBodyFromPayload(htmlPayload(html), { excludeThreadHistory: true }), 'text');
    });
  });

  describe('html', () => {
    it('returns 5000-deep HTML as it is', () => {
      const html = deep('text');
      assert.strictEqual(extractBodyFromPayload(htmlPayload(html), { contentType: 'html' }), html);
    });
  });
});
