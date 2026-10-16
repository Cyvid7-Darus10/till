import { after } from 'next/server';
import { log } from '@/lib/log';
import { bot } from '@/lib/slack/bot';
import { duplicateReason } from '@/lib/slack/events';

export async function POST(request: Request): Promise<Response> {
  const skipped = await duplicateReason(request);
  if (skipped) {
    log.info('skipped slack event', { reason: skipped });
    return new Response(null, { status: 200 });
  }
  return bot.webhooks.slack(request, { waitUntil: (task) => after(() => task) });
}
