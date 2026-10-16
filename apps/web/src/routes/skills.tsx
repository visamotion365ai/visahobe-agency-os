import { useEffect, useState } from 'react';
import { AGENT_PROFILES, AGENT_KEYS } from '@visahobe/shared';
import { api } from '../api';
import { useApi } from '../lib/useAsync';
import { Card, EmptyState, Field, Loading, Pill, SectionTitle, Sheet, Toggle, useToast } from '../components/ui';
import { PlusIcon, RefreshIcon } from '../components/icons';

interface Skill {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  kind: 'agent' | 'browser';
  instructions: string;
  workflow: Array<{ kind: string; label?: string }> | null;
  triggers: string[] | null;
  tools: string[] | null;
  agentKeys: string[] | null;
  enabled: number;
  builtin: number;
  version: number;
}

const CATEGORIES = ['general', 'documents', 'workflow', 'compliance', 'communication', 'research', 'custom'];

const BLANK = {
  name: '',
  description: '',
  category: 'general',
  kind: 'agent' as 'agent' | 'browser',
  instructions: '',
  triggers: '',
  tools: '',
  agentKeys: [] as string[],
};

export function SkillsRoute() {
  const toast = useToast();
  const skills = useApi<{ skills: Skill[]; tools: string[]; agents: string[] }>('/api/skills');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [previewAgent, setPreviewAgent] = useState<string>('raffi');
  const [previewOpen, setPreviewOpen] = useState(false);

  const preview = useApi<{ skillCount: number; skills: any[]; promptBlock: string; injectedTokensApprox: number }>(
    `/api/skills/preview?agentKey=${previewAgent}`,
    [previewAgent],
  );

  const list = skills.data?.skills ?? [];
  const enabledCount = list.filter((s) => s.enabled === 1).length;
  const [kindFilter, setKindFilter] = useState<'all' | 'agent' | 'browser'>('all');
  const visible = list.filter((s) => (kindFilter === 'all' ? true : s.kind === kindFilter));

  const toggle = async (skill: Skill, enabled: boolean) => {
    try {
      await api.post(`/api/skills/${skill.id}/toggle`, { enabled });
      await skills.reload();
      await preview.reload();
      toast.push(`${skill.name} ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      toast.push((error as Error).message, 'error');
    }
  };

  const remove = async (skill: Skill) => {
    if (!window.confirm(`Delete the skill "${skill.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/skills/${skill.id}`);
      await skills.reload();
      await preview.reload();
      toast.push('Skill deleted.');
    } catch (error) {
      toast.push((error as Error).message, 'error');
    }
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Skills</h1>
          <div className="page-sub">
            Reusable abilities the agents apply automatically. {enabledCount} of {list.length} enabled.
          </div>
        </div>
        <button
          className="btn small"
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          <PlusIcon size={16} /> Add skill
        </button>
      </header>

      <Card glass className="mb">
        <div className="row-between">
          <div>
            <div className="item-title">Live preview</div>
            <div className="item-sub">See exactly what an agent receives with the current skills.</div>
          </div>
          <select
            className="select"
            style={{ width: 150 }}
            value={previewAgent}
            onChange={(event) => setPreviewAgent(event.target.value)}
          >
            {AGENT_KEYS.map((key) => (
              <option key={key} value={key}>
                {AGENT_PROFILES[key].name}
              </option>
            ))}
          </select>
        </div>
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Pill tone="blue">{preview.data?.skillCount ?? 0} skills applied</Pill>
          <Pill tone="teal">~{preview.data?.injectedTokensApprox ?? 0} tokens</Pill>
          <button className="btn ghost small" onClick={() => void preview.reload()}>
            <RefreshIcon size={14} /> Refresh
          </button>
          <button className="btn soft small" onClick={() => setPreviewOpen(true)}>
            Open preview
          </button>
        </div>
      </Card>

      <div className="row mb" style={{ gap: 8, flexWrap: 'wrap' }}>
        {(['all', 'agent', 'browser'] as const).map((kind) => (
          <button
            key={kind}
            className="btn ghost small"
            style={kindFilter === kind ? { background: 'var(--blue)', color: '#fff', borderColor: 'transparent' } : undefined}
            onClick={() => setKindFilter(kind)}
          >
            {kind === 'all' ? 'All skills' : kind === 'agent' ? 'Agent skills' : 'Browser workflows'}
          </button>
        ))}
      </div>

      {skills.loading ? (
        <Loading />
      ) : visible.length ? (
        <div className="list">
          {visible.map((skill) => (
            <Card key={skill.id} glass>
              <div className="row-between">
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="item-title">{skill.name}</span>
                    <Pill tone={skill.kind === 'browser' ? 'teal' : 'blue'}>
                      {skill.kind === 'browser' ? 'browser' : 'agent'}
                    </Pill>
                    {skill.builtin === 1 && <Pill tone="violet">built-in</Pill>}
                    <Pill>v{skill.version}</Pill>
                  </div>
                  <div className="item-sub">{skill.description || 'No description'}</div>
                </div>
                <Toggle checked={skill.enabled === 1} onChange={(value) => void toggle(skill, value)} label={skill.name} />
              </div>

              <div className="row mt" style={{ gap: 6, flexWrap: 'wrap' }}>
                <Pill tone="teal">{skill.category}</Pill>
                {skill.kind === 'browser' && <Pill>{skill.workflow?.length ?? 0} steps</Pill>}
                {(skill.triggers ?? []).map((trigger) => (
                  <Pill key={trigger}>#{trigger}</Pill>
                ))}
                {(skill.agentKeys ?? []).map((key) => (
                  <Pill key={key} tone="blue">
                    {AGENT_PROFILES[key as keyof typeof AGENT_PROFILES]?.name ?? key}
                  </Pill>
                ))}
              </div>

              {skill.kind === 'browser' && skill.workflow?.length ? (
                <div className="chip-row mt">
                  {skill.workflow.map((step, index) => (
                    <span key={index} className="pill">
                      {index + 1}. {step.label || step.kind}
                    </span>
                  ))}
                </div>
              ) : null}
              {skill.enabled !== 1 && (
                <div className="row mt" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn ghost small"
                    onClick={() => {
                      setEditing(skill);
                      setEditorOpen(true);
                    }}
                  >
                    Edit
                  </button>
                  <button className="btn danger small" onClick={() => void remove(skill)}>
                    Delete
                  </button>
                </div>
              )}
              {skill.enabled === 1 && (
                <div className="row mt" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn ghost small"
                    onClick={() => {
                      setEditing(skill);
                      setEditorOpen(true);
                    }}
                  >
                    Edit
                  </button>
                  {skill.builtin !== 1 && (
                    <button className="btn danger small" onClick={() => void remove(skill)}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No skills yet"
          hint="Create a skill to teach the agents a new reusable ability."
          action={
            <button className="btn small" onClick={() => setEditorOpen(true)}>
              Add skill
            </button>
          }
        />
      )}

      <SectionTitle>How skills work</SectionTitle>
      <Card>
        <div className="small" style={{ lineHeight: 1.6 }}>
          An enabled skill is injected into the selected agents&rsquo; system prompt on every turn. Editing a
          skill&rsquo;s instructions bumps its version so changes stay traceable. Built-in skills can be edited and
          disabled but not deleted. When a hosted AI provider is configured, the model applies the skills; with the
          offline Local Engine the enabled set is reported in the task log.
        </div>
      </Card>

      <SkillEditorSheet
        open={editorOpen}
        skill={editing}
        tools={skills.data?.tools ?? []}
        onClose={() => setEditorOpen(false)}
        onDone={async () => {
          setEditorOpen(false);
          await skills.reload();
          await preview.reload();
        }}
      />

      <Sheet open={previewOpen} onClose={() => setPreviewOpen(false)} title={`Live preview — ${AGENT_PROFILES[previewAgent as keyof typeof AGENT_PROFILES]?.name}`}>
        <div className="stack">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Pill tone="blue">{preview.data?.skillCount ?? 0} skills</Pill>
            <Pill tone="teal">~{preview.data?.injectedTokensApprox ?? 0} tokens</Pill>
          </div>
          <div className="log-line" style={{ maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {preview.data?.promptBlock || 'No skills enabled for this agent.'}
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function SkillEditorSheet({
  open,
  skill,
  tools,
  onClose,
  onDone,
}: {
  open: boolean;
  skill: Skill | null;
  tools: string[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ ...BLANK });
  const [busy, setBusy] = useState(false);

  // Load the selected skill into the form whenever the sheet opens.
  useEffect(() => {
    if (!open) return;
    setForm(
      skill
        ? {
            name: skill.name,
            description: skill.description ?? '',
            category: skill.category ?? 'general',
            kind: skill.kind ?? 'agent',
            instructions: skill.instructions,
            triggers: (skill.triggers ?? []).join(', '),
            tools: (skill.tools ?? []).join(', '),
            agentKeys: skill.agentKeys ?? [],
          }
        : { ...BLANK },
    );
  }, [open, skill]);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        category: form.category,
        kind: form.kind,
        instructions: form.instructions,
        triggers: form.triggers
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        tools: form.tools
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        agentKeys: form.agentKeys.length ? form.agentKeys : null,
      };
      if (skill) await api.patch(`/api/skills/${skill.id}`, payload);
      else await api.post('/api/skills', payload);
      toast.push(skill ? 'Skill updated.' : 'Skill created.');
      await onDone();
    } catch (error) {
      toast.push((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={skill ? 'Edit skill' : 'New skill'}>
      <div className="stack">
        <Field label="Name">
          <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Description" hint="One line shown in the skill list.">
          <input
            className="input"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
        <Field label="Skill type" hint="Agent skills shape the AI answer. Browser workflows drive the real browser.">
          <div className="row" style={{ gap: 8 }}>
            {(['agent', 'browser'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className="btn ghost small"
                style={form.kind === kind ? { background: 'var(--blue)', color: '#fff', borderColor: 'transparent' } : undefined}
                onClick={() => setForm({ ...form, kind })}
              >
                {kind === 'agent' ? 'Agent skill' : 'Browser workflow'}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Category">
          <select
            className="select"
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Instructions" hint="What the agent should do when this skill applies. This is what the model receives.">
          <textarea
            className="textarea"
            style={{ minHeight: 150 }}
            value={form.instructions}
            onChange={(event) => setForm({ ...form, instructions: event.target.value })}
          />
        </Field>
        <Field label="Triggers" hint="Comma separated keywords that signal when to apply this skill.">
          <input
            className="input"
            value={form.triggers}
            onChange={(event) => setForm({ ...form, triggers: event.target.value })}
            placeholder="documents, scan, missing"
          />
        </Field>
        <Field label="Tools" hint={`Comma separated. Available: ${tools.slice(0, 8).join(', ')}${tools.length > 8 ? '…' : ''}`}>
          <input
            className="input"
            value={form.tools}
            onChange={(event) => setForm({ ...form, tools: event.target.value })}
            placeholder="get_case, list_documents"
          />
        </Field>
        <Field label="Applies to agents" hint="Leave empty to apply to every agent.">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {AGENT_KEYS.map((agentKey) => {
              const active = form.agentKeys.includes(agentKey);
              return (
                <button
                  key={agentKey}
                  type="button"
                  className="btn ghost small"
                  style={active ? { background: 'var(--blue)', color: '#fff', borderColor: 'transparent' } : undefined}
                  onClick={() =>
                    setForm({
                      ...form,
                      agentKeys: active
                        ? form.agentKeys.filter((k) => k !== agentKey)
                        : [...form.agentKeys, agentKey],
                    })
                  }
                >
                  {AGENT_PROFILES[agentKey].name}
                </button>
              );
            })}
          </div>
        </Field>
        <button className="btn block" disabled={!form.name || form.instructions.length < 4 || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : skill ? 'Save changes' : 'Create skill'}
        </button>
      </div>
    </Sheet>
  );
}
