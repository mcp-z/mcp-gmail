import { LoopbackOAuthProvider } from '@mcp-z/oauth-google';
import pThrottle from 'p-throttle';

const interval = 1_200;
let authorizations = 0;
const reserve = pThrottle({ limit: 1, interval, strict: true })(() => {
  authorizations++;
});

export class PacedOAuthProvider extends LoopbackOAuthProvider {
  override async getAccessToken(accountId?: string): Promise<string> {
    await reserve();
    return super.getAccessToken(accountId);
  }
}

export function pacingSummary(): { authorizations: number; intervalMs: number } {
  return { authorizations, intervalMs: interval };
}
