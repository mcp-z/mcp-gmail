import type { gmail_v1 } from '@googleapis/gmail';

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

  // Try to find an existing user label by name
  const listed = await gmail.users.labels.list({ userId });
  const labels = Array.isArray(listed?.data?.labels) ? listed.data.labels : [];
  const existing = labels.find((l: unknown) => {
    const label = l as { name?: unknown; id?: unknown };
    return label?.name === labelName;
  });
  const existingTyped = existing as { id?: unknown } | undefined;
  if (existingTyped?.id) return String(existingTyped.id);

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
