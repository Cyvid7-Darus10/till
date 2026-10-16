import { createSlackAdapter } from '@chat-adapter/slack';
import { createMemoryState } from '@chat-adapter/state-memory';
import { startAuthorization } from '@vercel/connect';
import { connectSlackAdapter } from '@vercel/connect/chat';
import { type ActionEvent, type Author, Chat, type Thread } from 'chat';
import { toAiMessages } from 'chat/ai';
import { answer, createInvoice } from '../agent/jobs';
import { signLoginLink } from '../airwallex/login-link';
import { forCreating, forQuestions } from '../airwallex/logins';
import { isConnected, openAirwallex } from '../airwallex/session';
import { SCOPES } from '../airwallex/tool-policy';
import { config, isAllowedChannel, isFinanceAdmin } from '../config';
import { COPY } from '../copy';
import { type CustomerMatch, findCustomer } from '../invoices/customer-match';
import { checkDecision, decodePending, type InvoiceRequest, type PendingInvoice } from '../invoices/request';
import { log } from '../log';
import { ACTIONS, approvalCard, connectCard, reply, resolvedCard } from './cards';
import { plainText } from './text';

/** Where the Airwallex login sends people back to. Paths are defined by the route files under app/api/. */
export const CALLBACK_PATH = '/api/airwallex/connected';
export const CALLBACK_PARAM = { token: 't', team: 'team' } as const;

// No database: memory state only covers dedupe and locks within one instance.
// Everything Till needs to remember travels in the Slack thread, button values and signed links.
export const bot = new Chat({
  userName: 'Till',
  adapters: { slack: createSlackAdapter({ ...connectSlackAdapter(config.slackConnector), userName: 'Till' }) },
  state: createMemoryState(),
}).registerSingleton();

const displayName = (author: Author): string => author.fullName || author.userName;

// Private messages stay in the thread: if Slack can't show one, skip it rather than send a DM.
const PRIVATE = { fallbackToDM: false } as const;

/** The thread so far, with each person's name in front of their message, for the model. */
async function threadHistory(thread: Thread) {
  const { messages } = await thread.adapter.fetchMessages(thread.id, { limit: config.threadHistoryLimit });
  return toAiMessages(messages, {
    transformMessage: (ai, source) =>
      ai.role === 'user' && typeof ai.content === 'string' ? { ...ai, content: `[${displayName(source.author)}] ${ai.content}` } : ai,
  });
}

/** Public base URL of this deployment (Vercel system variables), for the login callback. */
function publicOrigin(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (!host) throw new Error('no deployment url to send the Airwallex login back to');
  return `https://${host}`;
}

async function handOff(thread: Thread): Promise<void> {
  const admins = config.financeAdminSlackIds.map((id) => thread.mentionUser(id)).join(', ');
  await thread.post(reply(COPY.handOff(admins), COPY.teamLoginLabel));
}

/** Finds the exact Airwallex client with the view-only team login, so the card can name it. */
async function resolveClient(request: InvoiceRequest): Promise<CustomerMatch> {
  const airwallex = await openAirwallex(forQuestions(), SCOPES.questions, 'view');
  try {
    return await findCustomer(airwallex, request.customer);
  } finally {
    await airwallex.close();
  }
}

/**
 * An admin wants an invoice. Till first resolves the exact client, then posts the approval card if the
 * admin's own login is connected, otherwise a private login button first.
 */
async function askAdmin(thread: Thread, admin: Author, request: InvoiceRequest): Promise<void> {
  const match = await resolveClient(request);
  if (!match.ok) {
    await thread.post(reply(COPY.notCreated(match.problem), COPY.teamLoginLabel));
    return;
  }
  const pending: PendingInvoice = {
    request,
    client: match.customer,
    threadId: thread.id,
    adminId: admin.userId,
    adminName: displayName(admin),
  };
  if (await isConnected(forCreating(admin.userId), SCOPES.creating)) {
    await thread.post(approvalCard(pending));
    return;
  }
  const callbackUrl = new URL(CALLBACK_PATH, publicOrigin());
  callbackUrl.searchParams.set(CALLBACK_PARAM.token, await signLoginLink(pending));
  const { url } = await startAuthorization(
    config.airwallexConnector,
    { subject: forCreating(admin.userId), scopes: [...SCOPES.creating] },
    { callbackUrl: callbackUrl.toString() },
  );
  await thread.postEphemeral(admin, connectCard(url, 'own'), PRIVATE);
}

/** No team login yet. Everyone hears that; a finance admin also gets a private button to connect it, once. */
async function noAccess(thread: Thread, author: Author): Promise<void> {
  await thread.post(COPY.noAccess);
  if (!isFinanceAdmin(author.userId)) return;
  const callbackUrl = new URL(CALLBACK_PATH, publicOrigin());
  callbackUrl.searchParams.set(CALLBACK_PARAM.team, '1');
  const { url } = await startAuthorization(
    config.airwallexConnector,
    { subject: forQuestions(), scopes: [...SCOPES.questions] },
    { callbackUrl: callbackUrl.toString() },
  );
  await thread.postEphemeral(author, connectCard(url, 'team'), PRIVATE);
}

bot.onNewMention(async (thread, message) => {
  if (!isAllowedChannel(thread.channelId)) {
    log.info('ignored mention outside allowed channels', { channelId: thread.channelId });
    return;
  }
  try {
    if (!(await isConnected(forQuestions(), SCOPES.questions))) {
      await noAccess(thread, message.author);
      return;
    }
    await thread.startTyping();
    const result = await answer(await threadHistory(thread));
    if (result.kind === 'text') {
      await thread.post(reply(plainText(result.text), COPY.teamLoginLabel));
    } else if (isFinanceAdmin(message.author.userId)) {
      await askAdmin(thread, message.author, result.request);
    } else {
      await handOff(thread);
    }
  } catch (error: unknown) {
    log.error('failed to answer mention', { threadId: thread.id, error });
    await thread.post(COPY.somethingWrong);
  }
});

/** True once the shared team login is connected. Called by the login callback. */
export async function teamLoginConnected(): Promise<boolean> {
  return isConnected(forQuestions(), SCOPES.questions);
}

/** Posts the approval card once an admin finishes the Airwallex login. Called by the login callback. */
export async function resumeAfterLogin(pending: PendingInvoice): Promise<boolean> {
  // This runs from a browser callback, not a Slack event, so the adapter isn't set up yet.
  await bot.initialize();
  if (!(await isConnected(forCreating(pending.adminId), SCOPES.creating))) return false;
  await bot.thread(pending.threadId).post(approvalCard(pending));
  return true;
}

/** One approval card creates at most one invoice: the request id is derived from the card's message id. */
const requestIdFor = (messageId: string): string => `till-${messageId.replace(/[^\w.-]/g, '')}`;

// Approve and Cancel carry the whole request. Only the admin named on the card may press them;
// anything else that fails the check (stale or tampered) is ignored.
async function decide(event: ActionEvent, approved: boolean): Promise<void> {
  const pending = event.value ? decodePending(event.value) : null;
  const thread = event.thread;
  const decision = checkDecision(pending, event.user.userId, event.threadId);
  if (!thread || !pending || !decision.ok) {
    if (thread && pending && !decision.ok && decision.reason === 'not-approver') {
      await thread.postEphemeral(event.user, COPY.onlyApprover(pending.adminName), PRIVATE);
    }
    return;
  }
  const outcome = approved ? COPY.approved(pending.adminName) : COPY.cancelled;
  // Remove the buttons before the slow create, so the card can't be pressed again meanwhile.
  await event.adapter.editMessage(event.threadId, event.messageId, resolvedCard(pending, outcome));
  if (!approved) return;
  try {
    const result = await createInvoice(pending, requestIdFor(event.messageId));
    const text = result.ok ? COPY.created(result.number, pending.client.name, result.url) : COPY.notCreated(result.problem);
    await thread.post(reply(text, pending.adminName));
  } catch (error: unknown) {
    log.error('failed to create invoice', { threadId: thread.id, error });
    await thread.post(COPY.somethingWrong);
  }
}

bot.onAction(ACTIONS.approve, (event) => decide(event, true));
bot.onAction(ACTIONS.cancel, (event) => decide(event, false));
