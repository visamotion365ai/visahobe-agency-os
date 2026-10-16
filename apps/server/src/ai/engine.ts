import { randomUUID } from 'node:crypto';
import { WORKFLOW_STEPS, type AgentKey } from '@visahobe/shared';
import { builtinAnswer } from './builtin.js';
import { createProviderRuntime } from './providers/index.js';
import { getTool, TOOLS, type ToolContext } from '../domain/tools.js';
import {
  addMessage,
  addTaskEvent,
  createConversation,
  createTask,
  getAgentByKey,
  getConversation,
  listMessages,
  updateTask,
} from '../domain/agents.js';
import { getCaseWithSteps, listCases } from '../domain/cases.js';
import { listDocuments } from '../domain/documents.js';
import { evaluatePassportValidity } from '../domain/passport.js';
import { listRequirementChecks, listRequirements } from '../domain/requirements.js';
import { getDefaultProvider, getProviderWithSecret } from '../domain/providers.js';
import { activeSkillsForAgent, recordSkillRun, renderSkillsForPrompt } from '../domain/skills.js';
import type { AgentContext, ChatMessage, ToolCallRequest } from './types.js';

/** In-memory registry of running tasks so they can be cancelled or resumed. */
const running = new Map<string, { cancelled: boolean; agentKey: string; input: string; caseId?: string | null }>();

export function isTaskCancelled(taskId: string): boolean {
  return running.get(taskId)?.cancelled === true;
}

export function cancelTask(taskId: string): boolean {
  const entry = running.get(taskId);
  if (!entry) return false;
  entry.cancelled = true;
  return true;
}

export function listRunningTasks(): string[] {
  return [...running.keys()];
}

function detectCaseId(message: string, explicit?: string | null): Promise<string | null> {
  if (explicit) return Promise.resolve(explicit);
  const match = message.match(/\bVM-[A-Z0-9]{4,}\b/i);
  if (!match) return Promise.resolve(null);
  return listCases({ q: match[0], pageSize: 3 }).then(({ items }) => items[0]?.id ?? null);
}

export async function buildContext(
  caseId: string | null,
  agentKey: AgentKey,
): Promise<AgentContext> {
  if (!caseId) return { case: null, providerNote: 'No case in context' };
  const detail = await getCaseWithSteps(caseId);
  const requirements = await listRequirements({
    country: detail.case.country,
    visaCategory: detail.case.visaCategory,
  });
  const checks = await listRequirementChecks(caseId);
  const documents = await listDocuments({ caseId });
  const validity = await evaluatePassportValidity(
    (detail.applicant as any)?.passportExpiryDate ?? null,
    detail.case.country,
    detail.case.visaCategory,
  );
  return {
    case: {
      id: detail.case.id,
      reference: detail.case.reference,
      country: detail.case.country,
      visaCategory: detail.case.visaCategory,
      purpose: detail.case.purpose,
      status: detail.case.status,
      currentStep: detail.case.currentStep,
      priority: detail.case.priority,
    },
    applicant: detail.applicant as any,
    sponsor: detail.sponsor as any,
    steps: detail.steps.map((s) => ({
      stepNumber: s.stepNumber,
      stepKey: s.stepKey,
      title: WORKFLOW_STEPS.find((w) => w.n === s.stepNumber)?.title ?? s.stepKey,
      status: s.status,
      updatedAt: s.updatedAt,
    })),
    requirements: requirements.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      mandatory: r.mandatory,
      status: r.status,
      sourceUrl: r.sourceUrl,
      verifiedAt: r.verifiedAt,
      version: r.version,
    })),
    checks: checks.map((c) => ({ requirementId: c.requirementId, status: c.status, note: c.note })),
    documents: documents.map((d) => ({
      id: d.id,
      filename: d.filename,
      category: d.category,
      kind: d.kind,
      size: d.size,
      ocrStatus: d.ocrStatus,
      uploadedAt: d.uploadedAt,
    })),
    validity: {
      status: validity.status,
      monthsRemaining: validity.monthsRemaining,
      requiredMonths: validity.requiredMonths,
      message: validity.message,
      ruleSource: validity.ruleSource,
      ruleConfigured: validity.ruleConfigured,
    },
  };
}

function renderContextForModel(ctx: AgentContext): string {
  if (!ctx.case) return 'No case is currently linked to this conversation.';
  const lines: string[] = [];
  lines.push(`Case ${ctx.case.reference} — ${ctx.case.country} / ${ctx.case.visaCategory}`);
  const applicant = ctx.applicant as any;
  if (applicant) {
    lines.push(
      `Applicant: ${applicant.fullName}; passport ${applicant.passportNumber ?? 'n/a'} (${applicant.nationality ?? 'n/a'}); expiry ${
        applicant.passportExpiryDate ?? 'n/a'
      }`,
    );
  }
  if (ctx.sponsor) lines.push(`Sponsor: ${(ctx.sponsor as any).name ?? 'n/a'}`);
  if (ctx.steps?.length) {
    lines.push('Workflow:');
    for (const s of ctx.steps) lines.push(`  ${s.stepNumber}. ${s.title} — ${s.status}`);
  }
  if (ctx.requirements?.length) {
    lines.push('Requirements on record (with source and verification state):');
    for (const r of ctx.requirements) {
      lines.push(
        `  - ${r.title} [${r.category}] status=${r.status} verified=${r.verifiedAt ?? 'no'} source=${r.sourceUrl ?? 'none'} v${r.version}`,
      );
    }
  }
  if (ctx.checks?.length) {
    lines.push('Per-case requirement status:');
    for (const c of ctx.checks) lines.push(`  - ${c.requirementId}: ${c.status}`);
  }
  if (ctx.documents?.length) {
    lines.push('Documents on file:');
    for (const d of ctx.documents) {
      lines.push(`  - ${d.filename} (${d.category}, ${d.kind}, ocr=${d.ocrStatus}, ${d.size} bytes)`);
    }
  }
  if (ctx.validity) {
    lines.push(
      `Passport validity: ${ctx.validity.status} — ${ctx.validity.message} (rule ${ctx.validity.requiredMonths} months, source: ${ctx.validity.ruleSource})`,
    );
  }
  return lines.join('\n');
}

export interface TurnResult {
  conversationId: string;
  taskId: string;
  agentKey: AgentKey;
  providerName: string;
  providerKind: string;
  model: string;
  usedLocalEngine: boolean;
  content: string;
  toolsUsed: string[];
  skillsUsed: string[];
  taskStatus: string;
}

export async function runAgentTurn(input: {
  agentKey: AgentKey;
  userMessage: string;
  conversationId?: string;
  caseId?: string | null;
  userId: string;
  resumed?: boolean;
}): Promise<TurnResult> {
  const agent = await getAgentByKey(input.agentKey);
  if (!agent) throw new Error(`Unknown agent ${input.agentKey}`);

  let conversation = input.conversationId ? await getConversation(input.conversationId) : undefined;
  if (!conversation) {
    conversation = await createConversation({
      agentId: agent.id,
      userId: input.userId,
      title: input.userMessage.slice(0, 60),
      caseId: input.caseId ?? null,
    });
  }

  const caseId = await detectCaseId(input.userMessage, input.caseId ?? conversation.caseId);

  const task = await createTask({
    agentId: agent.id,
    conversationId: conversation.id,
    userId: input.userId,
    caseId,
    kind: input.resumed ? 'chat.resume' : 'chat',
    title: input.userMessage.slice(0, 80),
    input: input.userMessage,
  });
  running.set(task.id, {
    cancelled: false,
    agentKey: input.agentKey,
    input: input.userMessage,
    caseId,
  });

  await addTaskEvent({
    taskId: task.id,
    type: 'plan',
    message: `Prepared a plan for ${agent.name} (${agent.role}).`,
    data: { steps: ['load context', 'select provider', 'run tools', 'compose answer'] },
  });
  await updateTask(task.id, { progress: 10 });

  try {
    const context = await buildContext(caseId, input.agentKey);
    await addTaskEvent({
      taskId: task.id,
      type: 'context',
      message: caseId
        ? `Loaded case ${context.case?.reference} with ${context.steps?.length ?? 0} workflow steps.`
        : 'No case linked to this conversation.',
      data: { caseId },
    });

    const providerRecord = agent.providerId
      ? await getProviderWithSecret(agent.providerId)
      : await getDefaultProvider();
    const useProvider = providerRecord && providerRecord.enabled && providerRecord.kind !== 'builtin';

    const history = await listMessages(conversation.id, 12);
    const toolsUsed: string[] = [];
    const skillsUsed: string[] = [];
    let content = '';
    let providerName = 'VisaHOBe Local Engine';
    let providerKind = 'builtin';
    let model = 'deterministic-ops-engine';

    if (useProvider && providerRecord) {
      const runtime = createProviderRuntime({ ...providerRecord, model: agent.model || providerRecord.model });
      providerName = runtime.name;
      providerKind = runtime.kind;
      model = runtime.model;
      const toolDefs = (agent.tools ?? []).map((name) => {
        const tool = getTool(name);
        return tool
          ? { name: tool.name, description: tool.description, parameters: tool.parameters }
          : null;
      }).filter(Boolean) as { name: string; description: string; parameters: Record<string, unknown> }[];

      const messages: ChatMessage[] = [
        ...history.map((m) => ({ role: m.role as ChatMessage['role'], content: m.content })),
        { role: 'user' as const, content: input.userMessage },
      ];

      const skills = await activeSkillsForAgent(input.agentKey);
      const skillsBlock = renderSkillsForPrompt(skills);
      if (skills.length) {
        skillsUsed.push(...skills.map((s) => s.key));
        await addTaskEvent({
          taskId: task.id,
          type: 'skills',
          message: `Applied ${skills.length} enabled skill(s): ${skills.map((s) => s.name).join(', ')}`,
          data: { skills: skills.map((s) => ({ key: s.key, name: s.name, version: s.version })) },
        });
      }

      const system = [
        agent.systemPrompt,
        '',
        'Context from the agency database (use it as the only source of truth):',
        renderContextForModel(context),
        '',
        skillsBlock,
        '',
        'Rules: never invent official requirements, receipts, approvals or government outcomes. ' +
          'If something is not in the context, say it is not recorded. ' +
          'For consequential actions (portal submission, payments, account changes) ask for human approval.',
      ].join('\n');

      let iterations = 0;
      while (iterations < 4) {
        iterations += 1;
        if (isTaskCancelled(task.id)) throw new Error('Task cancelled by operator');
        let result: Awaited<ReturnType<typeof runtime.chat>>;
        try {
          result = await runtime.chat({
            messages,
            system,
            temperature: agent.temperature ?? 0.2,
            tools: toolDefs,
            maxTokens: 1500,
          });
        } catch (err) {
          const message = (err as Error).message;
          await addTaskEvent({
            taskId: task.id,
            type: 'provider_error',
            message: `Provider ${runtime.name} failed: ${message}`,
          });
          const fallback = builtinAnswer(input.agentKey, input.userMessage, context);
          content = `${fallback.content}\n\n> _The configured provider (${runtime.name}) was unreachable, so the VisaHOBe Local Engine answered instead: ${message}_`;
          toolsUsed.push(...fallback.toolsUsed);
          providerName = 'VisaHOBe Local Engine (provider unreachable)';
          providerKind = 'builtin';
          model = 'deterministic-ops-engine';
          break;
        }
        content = result.content ?? '';
        await addTaskEvent({
          taskId: task.id,
          type: 'provider',
          message: `${runtime.name} (${runtime.model}) responded.`,
          data: { usage: result.usage },
        });

        const calls: ToolCallRequest[] = result.toolCalls ?? [];
        if (!calls.length) break;

        const toolCtx: ToolContext = { userId: input.userId, agentKey: input.agentKey, caseId };
        for (const call of calls) {
          const tool = getTool(call.name);
          await addTaskEvent({
            taskId: task.id,
            type: 'tool_call',
            message: `Calling ${call.name}`,
            data: call.arguments,
          });
          if (!tool) {
            messages.push({
              role: 'tool',
              content: `Unknown tool ${call.name}`,
              toolCallId: call.id,
              name: call.name,
            });
            continue;
          }
          let output: unknown;
          try {
            output = await tool.execute(call.arguments ?? {}, toolCtx);
          } catch (err) {
            output = { error: (err as Error).message };
          }
          toolsUsed.push(tool.name);
          await addTaskEvent({
            taskId: task.id,
            type: 'tool_result',
            message: `${tool.name} completed`,
            data: output,
          });
          messages.push({
            role: 'tool',
            content: JSON.stringify(output).slice(0, 12000),
            toolCallId: call.id,
            name: tool.name,
          });
        }
        messages.push({ role: 'assistant', content: content || '(tool calls requested)' });
      }
    } else {
      const answer = builtinAnswer(input.agentKey, input.userMessage, context);
      content = answer.content;
      toolsUsed.push(...answer.toolsUsed);
      providerName = 'VisaHOBe Local Engine';
      providerKind = 'builtin';
      model = 'deterministic-ops-engine';
      // The deterministic engine cannot consume free-text skills, but the enabled
      // set is still reported so the operator sees what would be applied.
      const localSkills = await activeSkillsForAgent(input.agentKey);
      if (localSkills.length) {
        await addTaskEvent({
          taskId: task.id,
          type: 'skills',
          message: `${localSkills.length} enabled skill(s) available to this agent (Local Engine answers deterministically).`,
          data: { skills: localSkills.map((s) => ({ key: s.key, name: s.name, version: s.version })) },
        });
      }
      await addTaskEvent({
        taskId: task.id,
        type: 'provider',
        message: 'No external AI provider is configured — answered with the VisaHOBe Local Engine.',
        data: { provider: 'builtin' },
      });
    }

    if (isTaskCancelled(task.id)) throw new Error('Task cancelled by operator');

    for (const skillKey of skillsUsed) {
      const skill = (await activeSkillsForAgent(input.agentKey)).find((s) => s.key === skillKey);
      if (skill) {
        await recordSkillRun({
          skillId: skill.id,
          agentKey: input.agentKey,
          caseId,
          input: input.userMessage,
          output: content.slice(0, 4000),
          status: 'completed',
          createdBy: input.userId,
        }).catch(() => undefined);
      }
    }

    await addMessage({
      conversationId: conversation.id,
      agentId: agent.id,
      role: 'user',
      content: input.userMessage,
      taskId: task.id,
    });
    const message = await addMessage({
      conversationId: conversation.id,
      agentId: agent.id,
      role: 'assistant',
      content,
      taskId: task.id,
      meta: { provider: providerName, providerKind, model, toolsUsed, skillsUsed },
    });
    await addTaskEvent({
      taskId: task.id,
      type: 'answer',
      message: 'Answer delivered.',
      data: { messageId: message.id },
    });
    await updateTask(task.id, {
      status: 'completed',
      progress: 100,
      result: { content, toolsUsed, skillsUsed, provider: providerName, model },
    });
    running.delete(task.id);

    return {
      conversationId: conversation.id,
      taskId: task.id,
      agentKey: input.agentKey,
      providerName,
      providerKind,
      model,
      usedLocalEngine: providerKind === 'builtin',
      content,
      toolsUsed,
      skillsUsed,
      taskStatus: 'completed',
    };
  } catch (err) {
    const message = (err as Error).message;
    await addTaskEvent({ taskId: task.id, type: 'error', message });
    await updateTask(task.id, { status: 'failed', error: message, progress: 100 });
    running.delete(task.id);
    throw err;
  }
}

export function availableToolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

export const newRunId = (): string => randomUUID();
