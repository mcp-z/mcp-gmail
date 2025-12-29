export function extractEmails(header?: string): string[] {
  if (!header) return [];
  const matches = header.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return matches.map((s: string) => s.trim());
}

export function extractFrom(header?: string): { address?: string; name?: string } | undefined {
  if (!header) return undefined;
  const m = header.match(/^(.*)<([^>]+)>/);
  if (m) {
    const rawName = m[1];
    const name = rawName ? rawName.replace(/"/g, '').trim() : undefined;
    const addr = m[2] ? m[2].trim() : undefined;
    const result: { address?: string; name?: string } = {};
    if (addr) result.address = addr;
    if (name) result.name = name;
    return result;
  }
  const emails = extractEmails(header);
  if (emails[0]) return { address: emails[0] };
  return { address: header.trim() };
}
