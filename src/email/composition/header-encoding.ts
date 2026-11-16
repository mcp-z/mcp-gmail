import libmime from 'libmime';
import { addressParser } from 'postal-mime';

// RFC 2047 §2: an encoded-word is at most 75 characters. libmime splits UTF-8 text into several encoded-words no longer than maxLength.
// https://www.rfc-editor.org/rfc/rfc2047#section-2
const ENCODED_WORD_MAX = 75;
// RFC 5322 §2.1.1: lines SHOULD be at most 78 characters. https://www.rfc-editor.org/rfc/rfc5322#section-2.1.1
const LINE_MAX = 78;

const NON_ASCII = /[\u0080-\uFFFF]/;

/** Encode non-ASCII text as RFC 2047 encoded-words (UTF-8, Q encoding). Pure ASCII is returned unchanged. */
export function encodeHeaderText(value: string): string {
  if (!NON_ASCII.test(value)) return value;
  return libmime.encodeWords(value, 'Q', ENCODED_WORD_MAX);
}

/** Build one header line, encoding non-ASCII text and folding per RFC 5322 §2.2.3 (CRLF + whitespace). Pure ASCII short lines are unchanged. */
export function formatHeader(name: string, value: string): string {
  const line = `${name}: ${encodeHeaderText(value)}`;
  if (line.length <= LINE_MAX || !NON_ASCII.test(value)) return line;
  return libmime.foldLines(line, LINE_MAX, false).replace(/\r?\n/g, '\r\n');
}

type ParsedAddress = { name?: string; address?: string; group?: ParsedAddress[] };

/** RFC 5322 §3.2.3 atext plus space: a display name made only of these may be written without quotes. https://www.rfc-editor.org/rfc/rfc5322#section-3.2.3 */
const PLAIN_PHRASE = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/;

/**
 * Display name for a mailbox. A non-ASCII name is encoded as a whole in B encoding, so the phrase holds only encoded-words:
 * RFC 2047 §5(3) allows only letters, digits and "!*+-/=_" inside a phrase encoded-word, and base64 (letters, digits, "+/=") is within that set.
 * https://www.rfc-editor.org/rfc/rfc2047#section-5
 */
function formatName(name: string): string {
  if (NON_ASCII.test(name)) return libmime.encodeWord(name, 'B', ENCODED_WORD_MAX);
  return PLAIN_PHRASE.test(name) ? name : `"${name.replace(/(["\\])/g, '\\$1')}"`;
}

function formatMailbox(m: ParsedAddress): string {
  if (m.group) return `${formatName(m.name ?? '')}: ${m.group.map(formatMailbox).join(', ')};`;
  const addr = m.address ?? '';
  return m.name ? `${formatName(m.name)} <${addr}>` : addr;
}

/** Encode an address list into one string per mailbox, parsed with postal-mime's addressParser: names are encoded whole, addresses stay as written. */
export function encodeAddressList(list: string | string[]): string[] {
  const items = Array.isArray(list) ? list : [list];
  return addressParser(items.join(', ')).map(formatMailbox);
}

/** Address-list header line. A list with no non-ASCII text is written as given; otherwise it is re-serialized and folded between mailboxes (never inside one). */
export function formatAddressHeader(name: string, list: string | string[]): string {
  const raw = Array.isArray(list) ? list.join(', ') : list;
  if (!NON_ASCII.test(raw)) return `${name}: ${raw}`;
  return `${name}: ${encodeAddressList(list).join(',\r\n ')}`;
}
