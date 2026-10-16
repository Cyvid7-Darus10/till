import { z } from 'zod';
import { SLACK_USER_ID } from './slack/user-id';

/**
 * Every name, id and limit Till uses, validated once at startup. None are secrets.
 * TILL_KMS_ISSUER_ID and TILL_FINANCE_ADMIN_SLACK_IDS are required; the rest have defaults.
 */

const commaList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const SLACK_CHANNEL_ID = /^[CG][A-Z0-9]{5,20}$/;

const slackChannelIds = z
  .string()
  .transform(commaList)
  .pipe(z.array(z.string().regex(SLACK_CHANNEL_ID, 'not a Slack channel id')));

const slackUserIds = z
  .string({ error: 'required (comma-separated Slack user ids)' })
  .transform(commaList)
  .pipe(z.array(z.string().regex(SLACK_USER_ID, 'not a Slack user id')).min(1, 'needs at least one Slack user id'));

const schema = z.object({
  /** Vercel Connect connector for the Slack app. */
  slackConnector: z.string().min(1).default('slack/till'),
  /** Vercel Connect connector for the Airwallex MCP server. */
  airwallexConnector: z.string().min(1).default('airwallex/till-sandbox'),
  /** Login id for the shared, view-only team login. Any stable string works. */
  teamLoginId: z.string().min(1).default('finance-team'),
  /** Slack user ids allowed to create invoices with their own Airwallex login. */
  financeAdminSlackIds: slackUserIds,
  /** Channels Till answers in. Empty means any channel it is invited to. Anyone there can read finance data. */
  allowedChannelIds: slackChannelIds.default([]),
  /** Vercel KMS issuer that signs Airwallex login links (Team Settings > Key Management). */
  kmsIssuerId: z.uuid({ error: 'required (a Vercel KMS issuer id)' }),
  /** How long a signed login link stays valid, in seconds. */
  loginLinkTtlSeconds: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  /** Model, through Vercel AI Gateway. */
  model: z.string().min(1).default('openai/gpt-5'),
  /** Lower effort answers faster; Till's tasks are short lookups. */
  modelReasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).default('low'),
  /** Company name used in Till's instructions. */
  companyName: z.string().min(1).default('the company'),
  /** How many recent thread messages Till reads for context. */
  threadHistoryLimit: z.coerce.number().int().min(1).max(100).default(30),
});

export type Config = z.infer<typeof schema>;

/** The environment variable behind each setting. */
const ENV_NAMES: Record<keyof Config, string> = {
  slackConnector: 'TILL_SLACK_CONNECTOR',
  airwallexConnector: 'TILL_AIRWALLEX_CONNECTOR',
  teamLoginId: 'TILL_TEAM_LOGIN_ID',
  financeAdminSlackIds: 'TILL_FINANCE_ADMIN_SLACK_IDS',
  allowedChannelIds: 'TILL_ALLOWED_CHANNEL_IDS',
  kmsIssuerId: 'TILL_KMS_ISSUER_ID',
  loginLinkTtlSeconds: 'TILL_LOGIN_LINK_TTL_SECONDS',
  model: 'TILL_MODEL',
  modelReasoningEffort: 'TILL_MODEL_REASONING_EFFORT',
  companyName: 'TILL_COMPANY_NAME',
  threadHistoryLimit: 'TILL_THREAD_HISTORY_LIMIT',
};

/** Reads config from an environment object. Throws with every problem listed if anything is invalid. */
export function readConfig(env: Record<string, string | undefined>): Config {
  // An empty variable counts as unset, so its default applies.
  const raw = Object.fromEntries(Object.entries(ENV_NAMES).map(([key, name]) => [key, env[name] || undefined]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${ENV_NAMES[issue.path[0] as keyof Config] ?? issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`invalid Till configuration: ${problems}`);
  }
  return parsed.data;
}

export const config: Config = readConfig(process.env);

export const isFinanceAdmin = (slackUserId: string): boolean => config.financeAdminSlackIds.includes(slackUserId);

/** Chat SDK channel ids look like `slack:C0123ABCD`; the allow-list holds plain Slack ids. */
export const isAllowedChannel = (channelId: string): boolean =>
  config.allowedChannelIds.length === 0 || config.allowedChannelIds.includes(channelId.split(':').at(-1) ?? '');
