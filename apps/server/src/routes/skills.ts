import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';
import { AGENT_KEYS } from '@visahobe/shared';
import {
  activeSkillsForAgent,
  createSkill,
  deleteSkill,
  getSkill,
  listSkillRuns,
  listSkills,
  renderSkillsForPrompt,
  updateSkill,
} from '../domain/skills.js';
import { availableToolNames } from '../ai/engine.js';

const workflowStep = z.object({
  kind: z.enum(['navigate', 'click', 'type', 'fill', 'select', 'press', 'extract', 'wait', 'scroll', 'screenshot']),
  label: z.string().max(120).optional(),
  url: z.string().max(2000).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  selector: z.string().max(500).optional(),
  value: z.string().max(4000).optional(),
  key: z.string().max(40).optional(),
  ms: z.number().int().min(0).max(60000).optional(),
});

const skillInput = z.object({
  key: z.string().max(60).optional(),
  name: z.string().min(2).max(120),
  description: z.string().max(600).optional(),
  category: z.string().max(60).optional(),
  kind: z.enum(['agent', 'browser']).optional(),
  instructions: z.string().min(4).max(8000),
  workflow: z.array(workflowStep).max(40).nullable().optional(),
  triggers: z.array(z.string().max(60)).max(20).optional(),
  tools: z.array(z.string().max(60)).max(20).optional(),
  agentKeys: z.array(z.enum(AGENT_KEYS)).max(10).nullable().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const skillPatch = skillInput.partial();

export async function skillRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/skills', { preHandler: app.requireAuth }, async (req) => {
    const query = (req.query ?? {}) as { enabled?: string; agentKey?: string };
    const skills = await listSkills({
      enabledOnly: query.enabled === 'true' || query.enabled === '1',
      agentKey: query.agentKey,
    });
    return { skills, tools: availableToolNames(), agents: AGENT_KEYS };
  });

  app.get('/api/skills/:id', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const skill = await getSkill(id);
    if (!skill) throw notFound('Skill not found');
    return { skill, runs: await listSkillRuns(skill.id, 20) };
  });

  app.post('/api/skills', { preHandler: app.requireRole('staff') }, async (req) => {
    const body = parseBody(skillInput, req.body);
    const skill = await createSkill(body, { id: req.user!.id, email: req.user!.email });
    return { skill };
  });

  app.patch('/api/skills/:id', { preHandler: app.requireRole('staff') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(skillPatch, req.body);
    const skill = await updateSkill(id, body, { id: req.user!.id, email: req.user!.email });
    return { skill };
  });

  app.post('/api/skills/:id/toggle', { preHandler: app.requireRole('staff') }, async (req) => {
    const { id } = req.params as { id: string };
    const existing = await getSkill(id);
    if (!existing) throw notFound('Skill not found');
    const body = (req.body ?? {}) as { enabled?: boolean };
    const enabled = body.enabled === undefined ? existing.enabled !== 1 : body.enabled;
    const skill = await updateSkill(id, { enabled }, { id: req.user!.id, email: req.user!.email });
    return { skill };
  });

  app.delete('/api/skills/:id', { preHandler: app.requireRole('staff') }, async (req) => {
    const { id } = req.params as { id: string };
    return deleteSkill(id, { id: req.user!.id, email: req.user!.email });
  });

  /**
   * Live preview: shows exactly what an agent will receive once the current set
   * of enabled skills is injected into its system prompt. Purely read-only, so
   * it is available to every authenticated role.
   */
  app.get('/api/skills/preview', { preHandler: app.requireAuth }, async (req) => {
    const query = (req.query ?? {}) as { agentKey?: string };
    const agentKey = (query.agentKey ?? 'raffi') as (typeof AGENT_KEYS)[number];
    if (!AGENT_KEYS.includes(agentKey)) throw badRequest('Unknown agent');
    const skills = await activeSkillsForAgent(agentKey);
    const block = renderSkillsForPrompt(skills);
    return {
      agentKey,
      skillCount: skills.length,
      skills: skills.map((s) => ({
        id: s.id,
        key: s.key,
        name: s.name,
        category: s.category,
        version: s.version,
        triggers: s.triggers,
      })),
      promptBlock: block,
      injectedTokensApprox: Math.ceil(block.length / 4),
    };
  });

  app.get('/api/skills/:id/runs', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    return { runs: await listSkillRuns(id, 50) };
  });
}
