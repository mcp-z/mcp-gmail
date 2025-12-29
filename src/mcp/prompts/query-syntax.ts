import type { PromptModule } from '@mcp-z/server';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

export default function createPrompt() {
  const config = {
    description: 'Reference guide for Gmail query syntax',
  };

  const handler = async (_args: { [x: string]: unknown }, _extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
    return {
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `# Gmail Query Syntax Reference

## Logical Operators
- \`$and\`: Array of conditions that ALL must match
- \`$or\`: Array of conditions where ANY must match
- \`$not\`: Condition that must NOT match

## Email Address Fields
- \`from\`, \`to\`, \`cc\`, \`bcc\`: String or field operators

## Content Fields
- \`subject\`: Search subject line
- \`body\`: Search message body
- \`text\`: Search all text content
- \`fuzzyPhrase\`: Approximate phrase matching (words appear together)

## Boolean Flags
- \`hasAttachment\`: true/false
- \`isRead\`: true/false

## Date Range
\`\`\`json
{ "date": { "$gte": "2024-01-01", "$lt": "2024-12-31" } }
\`\`\`

## Gmail-Specific
- \`categories\`: primary, social, promotions, updates, forums
- \`label\`: User labels (case-sensitive, use gmail-labels-list to discover)
- \`rawGmailQuery\`: Escape hatch for advanced Gmail syntax

## Field Operators (for multi-value fields)
- \`$any\`: OR - matches if ANY value matches
- \`$all\`: AND - matches if ALL values match
- \`$none\`: NOT - matches if NONE match

## Example Queries
\`\`\`json
// Unread from specific sender
{ "from": "boss@company.com", "isRead": false }

// Recent with attachment
{ "hasAttachment": true, "date": { "$gte": "2024-01-01" } }

// Multiple senders
{ "from": { "$any": ["alice@example.com", "bob@example.com"] } }

// Complex: promotions OR social, unread
{ "$and": [
  { "categories": { "$any": ["promotions", "social"] } },
  { "isRead": false }
]}
\`\`\``,
          },
        },
      ],
    };
  };

  return {
    name: 'query-syntax',
    config,
    handler,
  } satisfies PromptModule;
}
