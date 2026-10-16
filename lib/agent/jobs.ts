import { generateText, hasToolCall, type ModelMessage, stepCountIs, type ToolSet, tool } from 'ai';
import { z } from 'zod';
import { forCreating, forQuestions } from '../airwallex/logins';
import { openAirwallex } from '../airwallex/session';
import { CREATE_TOOLS_FOR_MODEL, SCOPES } from '../airwallex/tool-policy';
import { config } from '../config';
import { checkCreatedInvoice } from '../invoices/check';
import { formatAmount, type InvoiceRequest, invoiceRequestSchema, type PendingInvoice } from '../invoices/request';
import { log } from '../log';
import { answerInstructions, createInstructions, LOCAL_TOOL } from './instructions';

const MAX_ANSWER_STEPS = 10;
const MAX_CREATE_STEPS = 12;

export type Answer = { kind: 'text'; text: string } | { kind: 'invoice'; request: InvoiceRequest };
export type CreateResult = { ok: true; number: string; url: string } | { ok: false; problem: string };

const modelSettings = () => ({
  model: config.model,
  providerOptions: { openai: { reasoningEffort: config.modelReasoningEffort } },
});

// Till must look at Airwallex before it says anything, so the first step always calls a tool.
const lookFirst = ({ stepNumber }: { stepNumber: number }) => (stepNumber === 0 ? { toolChoice: 'required' as const } : {});

const logTools =
  (job: string) =>
  ({ toolCalls }: { toolCalls: { toolName: string }[] }) => {
    if (toolCalls.length > 0) log.info('airwallex tools called', { job, tools: toolCalls.map((c) => c.toolName) });
  };

const pick = (tools: ToolSet, names: readonly string[]): ToolSet =>
  Object.fromEntries(Object.entries(tools).filter(([name]) => names.includes(name)));

/** Answers a thread with the shared, view-only team login. An invoice request comes back as data, never created. */
export async function answer(history: ModelMessage[]): Promise<Answer> {
  const airwallex = await openAirwallex(forQuestions(), SCOPES.questions, 'view');
  try {
    const result = await generateText({
      ...modelSettings(),
      system: answerInstructions(),
      messages: history,
      tools: {
        ...airwallex.tools,
        [LOCAL_TOOL.requestInvoice]: tool({
          description: 'Hand an invoice request to a finance admin. Call once all details are known.',
          inputSchema: invoiceRequestSchema,
        }),
      },
      stopWhen: [hasToolCall(LOCAL_TOOL.requestInvoice), stepCountIs(MAX_ANSWER_STEPS)],
      prepareStep: lookFirst,
      onStepFinish: logTools('answer'),
    });
    const call = result.toolCalls.find((c) => c.toolName === LOCAL_TOOL.requestInvoice);
    if (call) return { kind: 'invoice', request: invoiceRequestSchema.parse(call.input) };
    return { kind: 'text', text: result.text.trim() };
  } finally {
    await airwallex.close();
  }
}

const reportSchema = z.object({
  invoiceId: z.string().max(80).describe('Airwallex invoice id (inv_...), empty if nothing was created'),
  problem: z.string().max(300).describe('Plain-English reason if the invoice was not created, else empty'),
});

/**
 * Creates one approved invoice with the approving admin's own Airwallex login, then checks the result.
 * The client was resolved and shown on the card before approval; the model only builds the invoice. `requestId` is fixed per
 * approval, so Airwallex creates at most one invoice for it.
 */
export async function createInvoice(pending: PendingInvoice, requestId: string): Promise<CreateResult> {
  const airwallex = await openAirwallex(forCreating(pending.adminId), SCOPES.creating, 'create');
  const { request } = pending;
  try {
    const result = await generateText({
      ...modelSettings(),
      system: createInstructions(requestId, pending.client.id),
      prompt: [
        `Client: ${pending.client.name}`,
        `Line item: ${request.description}`,
        `Amount: ${formatAmount(request)} (${request.amount} in major units)`,
        `Currency: ${request.currency}`,
        `Days until due: ${request.daysUntilDue}`,
      ].join('\n'),
      tools: {
        ...pick(airwallex.tools, CREATE_TOOLS_FOR_MODEL),
        [LOCAL_TOOL.reportInvoice]: tool({ description: 'Report the finished invoice.', inputSchema: reportSchema }),
      },
      stopWhen: [hasToolCall(LOCAL_TOOL.reportInvoice), stepCountIs(MAX_CREATE_STEPS)],
      prepareStep: lookFirst,
      onStepFinish: logTools('create invoice'),
    });
    const call = result.toolCalls.find((c) => c.toolName === LOCAL_TOOL.reportInvoice);
    const report = call ? reportSchema.parse(call.input) : { invoiceId: '', problem: 'I could not confirm the invoice was created.' };
    if (!report.invoiceId) return { ok: false, problem: report.problem || 'No invoice was created.' };
    return await checkCreatedInvoice(airwallex, report.invoiceId, request, pending.client);
  } finally {
    await airwallex.close();
  }
}
