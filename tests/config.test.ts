import { describe, expect, it } from 'vitest';
import { readConfig } from '../lib/config';

const required = {
  TILL_KMS_ISSUER_ID: '00000000-0000-4000-8000-000000000000',
  TILL_FINANCE_ADMIN_SLACK_IDS: 'UADMIN0001',
};

function captureError(run: () => unknown): string {
  try {
    run();
  } catch (error: unknown) {
    return String(error);
  }
  throw new Error('expected an error');
}

describe('configuration', () => {
  it('needs only the deployment-specific ids; everything else has a default', () => {
    const config = readConfig(required);
    expect(config.financeAdminSlackIds).toEqual(['UADMIN0001']);
    expect(config.teamLoginId).toBe('finance-team');
    expect(config.loginLinkTtlSeconds).toBe(900);
  });

  it('reads a comma-separated admin list, ignoring spaces and blanks', () => {
    const config = readConfig({ ...required, TILL_FINANCE_ADMIN_SLACK_IDS: ' UADMIN0001, UADMIN0002 ,' });
    expect(config.financeAdminSlackIds).toEqual(['UADMIN0001', 'UADMIN0002']);
  });

  it('turns numeric settings from text into numbers', () => {
    expect(readConfig({ ...required, TILL_THREAD_HISTORY_LIMIT: '12' }).threadHistoryLimit).toBe(12);
  });

  it('treats an empty variable as unset', () => {
    expect(readConfig({ ...required, TILL_MODEL: '' }).model).toBe('openai/gpt-5');
  });

  it('names every missing or invalid variable in one error', () => {
    const error = captureError(() => readConfig({ TILL_THREAD_HISTORY_LIMIT: '0' }));
    for (const name of ['TILL_FINANCE_ADMIN_SLACK_IDS', 'TILL_KMS_ISSUER_ID', 'TILL_THREAD_HISTORY_LIMIT']) {
      expect(error).toContain(name);
    }
  });

  it('rejects an admin entry that is not a Slack user id', () => {
    expect(() => readConfig({ ...required, TILL_FINANCE_ADMIN_SLACK_IDS: 'alex@example.com' })).toThrow(/not a Slack user id/);
  });
});

describe('allowed channels', () => {
  it('default to every channel Till is in', () => {
    expect(readConfig(required).allowedChannelIds).toEqual([]);
  });

  it('accept a comma-separated list and reject anything that is not a channel id', () => {
    expect(readConfig({ ...required, TILL_ALLOWED_CHANNEL_IDS: 'C0FINANCE1, G0PRIVATE1' }).allowedChannelIds).toEqual([
      'C0FINANCE1',
      'G0PRIVATE1',
    ]);
    expect(() => readConfig({ ...required, TILL_ALLOWED_CHANNEL_IDS: '#finance' })).toThrow(/TILL_ALLOWED_CHANNEL_IDS/);
  });
});
