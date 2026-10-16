import { describe, expect, it, vi } from 'vitest';

vi.stubEnv('TILL_ALLOWED_CHANNEL_IDS', 'C0FINANCE1');
const { isAllowedChannel } = await import('../lib/config');

describe('a mention', () => {
  it('is answered in an allowed channel', () => {
    expect(isAllowedChannel('slack:C0FINANCE1')).toBe(true);
  });

  it('is ignored anywhere else', () => {
    expect(isAllowedChannel('slack:C0RANDOM01')).toBe(false);
  });
});
