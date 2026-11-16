import type { gmail_v1 } from '@googleapis/gmail';

export interface LabelRef {
  id?: string | null;
  name?: string | null;
  type?: string | null;
}

/**
 * Find one existing label from a user-supplied reference. Never creates anything.
 * Order: exact ID, then system name (case-insensitive), then exact user label name.
 */
export function resolveLabel(labels: LabelRef[], ref: string): { id: string; name: string } | undefined {
  const toResolved = (l: LabelRef) => ({ id: l.id as string, name: l.name || (l.id as string) });
  const byId = labels.find((l) => l.id === ref);
  if (byId?.id) return toResolved(byId);
  const upper = ref.toUpperCase();
  const system = labels.find((l) => l.type === 'system' && l.id && (l.id.toUpperCase() === upper || l.name?.toUpperCase() === upper));
  if (system?.id) return toResolved(system);
  const byName = labels.find((l) => l.id && l.name === ref);
  if (byName?.id) return toResolved(byName);
  return undefined;
}

export async function ensureLabelId(gmail: gmail_v1.Gmail, userId: string, labelName: string): Promise<string> {
  // Built-in system labels: pass through by name
  const builtInLabels: Record<string, string> = {
    INBOX: 'INBOX',
    SPAM: 'SPAM',
    TRASH: 'TRASH',
    UNREAD: 'UNREAD',
    STARRED: 'STARRED',
    IMPORTANT: 'IMPORTANT',
    SENT: 'SENT',
    DRAFT: 'DRAFT',
    CATEGORY_PERSONAL: 'CATEGORY_PERSONAL',
    CATEGORY_SOCIAL: 'CATEGORY_SOCIAL',
    CATEGORY_PROMOTIONS: 'CATEGORY_PROMOTIONS',
    CATEGORY_UPDATES: 'CATEGORY_UPDATES',
    CATEGORY_FORUMS: 'CATEGORY_FORUMS',
  };

  const upper = labelName.toUpperCase();
  if (builtInLabels[upper]) return builtInLabels[upper];

  // Use an existing label when the reference matches one by ID or name
  const listed = await gmail.users.labels.list({ userId });
  const labels = Array.isArray(listed?.data?.labels) ? listed.data.labels : [];
  const existing = resolveLabel(labels, labelName);
  if (existing) return existing.id;

  // Create the label if it doesn't exist
  const created = await gmail.users.labels.create({
    userId,
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  if (!created?.data?.id) throw new Error('Failed to create label');
  return created.data.id as string;
}
