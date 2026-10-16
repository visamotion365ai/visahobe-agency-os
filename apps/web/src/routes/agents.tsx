import { useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useApi } from '../lib/useAsync';
import { api } from '../api';
import { Avatar, Card, EmptyState, Loading, Pill, SectionTitle, useToast } from '../components/ui';
import { ChatIcon, PauseIcon, PlayIcon, RefreshIcon, StopIcon } from '../components/icons';
import { relativeTime, renderMarkdown } from '../lib/format';

interface AgentDto {
  id: string;
  key: string;
  name: string;
  role: string;
  focus: string;
  description: string;
  avatar: string;
  accent: string;
  enabled: number;
  running: boolean;
  provider: { id: string; name: string; kind: string; model: string; status?: string; statusMessage?: string };
}

interface TaskDto {
  id: string;
  agentId: string;
  status: string;
  title: string;
  progress: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  result: any;
}

export function AgentsRoute() {
  const { data, loading } = useApi<{ agents: AgentDto[] }>('/api/agents');
  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">AI agents</h1>
          <div className="page-sub">
            Each agent has its own profile, conversation history, tools and task state.
          </div>
        </div>
      </header>

      {loading ? (
        <Loading />
      ) : (
        <div className="list">
          {data?.agents?.map((agent) => (
            <Link
              key={agent.id}
              to="/agents/$key"
              params={{ key: agent.key }}
              className="card tappable"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              <div className="row">
                <Avatar name={agent.name} color={agent.accent} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row-between">
                    <div className="item-title">{agent.name}</div>
                    <Pill tone={agent.running ? 'blue' : 'green'} dot>
                      {agent.running ? 'busy' : 'online'}
                    </Pill>
                  </div>
                  <div className="item-sub">{agent.role}</div>
                  <div className="small muted" style={{ marginTop: 6, lineHeight: 1.45 }}>
                    {agent.focus}
                  </div>
                  <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
                    <Pill tone="blue">{agent.provider.name}</Pill>
                    <Pill>{agent.provider.model}</Pill>
                    {agent.provider.status === 'unreachable' && <Pill tone="red">unreachable</Pill>}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentDetailRoute() {
  const { key } = useParams({ from: '/agents/$key' });
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const agents = useApi<{ agents: AgentDto[] }>('/api/agents');
  const tasks = useApi<{ tasks: TaskDto[] }>(`/api/tasks?agentId=${key}`, [key]);
  const agent = agents.data?.agents?.find((item) => item.key === key);

  const latest = useMemo(() => tasks.data?.tasks?.[0] ?? null, [tasks.data]);

  const act = async (action: 'cancel' | 'retry' | 'resume') => {
    if (!latest) return;
    setBusy(action);
    try {
      await api.post(`/api/tasks/${latest.id}/${action}`);
      toast.push(`Task ${action} request sent.`);
      await tasks.reload();
    } catch (error) {
      toast.push((error as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (agents.loading) return <Loading />;
  if (!agent) return <EmptyState title="Agent not found" hint="This agent is not registered in the database." />;

  return (
    <div>
      <header className="page-head">
        <div className="row">
          <Avatar name={agent.name} color={agent.accent} size={52} />
          <div>
            <h1 className="page-title" style={{ fontSize: 24 }}>
              {agent.name}
            </h1>
            <div className="page-sub">{agent.role}</div>
          </div>
        </div>
      </header>

      <Card glass>
        <div className="small" style={{ lineHeight: 1.55 }}>
          {agent.focus}
        </div>
        <div className="divider" />
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Provider</dt>
          <dd>{agent.provider.name}</dd>
          <dt>Model</dt>
          <dd>{agent.provider.model}</dd>
          <dt>Runtime state</dt>
          <dd>
            <Pill tone={agent.running ? 'blue' : 'green'} dot>
              {agent.running ? 'busy' : 'online'}
            </Pill>
          </dd>
          <dt>Provider check</dt>
          <dd className="small">{agent.provider.statusMessage ?? 'Not probed yet'}</dd>
        </dl>
      </Card>

      <div className="row mt" style={{ flexWrap: 'wrap' }}>
        <Link to="/chat" search={{ agent: agent.key }} className="btn small">
          <ChatIcon size={16} /> Start chat
        </Link>
        <button className="btn ghost small" disabled={!latest || busy !== null} onClick={() => void act('retry')}>
          <RefreshIcon size={16} /> Retry
        </button>
        <button className="btn ghost small" disabled={!latest || busy !== null} onClick={() => void act('resume')}>
          <PlayIcon size={16} /> Resume
        </button>
        <button className="btn danger small" disabled={!latest || busy !== null} onClick={() => void act('cancel')}>
          <StopIcon size={16} /> Stop task
        </button>
      </div>

      <SectionTitle>Latest task</SectionTitle>
      {tasks.loading ? (
        <Loading />
      ) : latest ? (
        <Card glass>
          <div className="row-between">
            <div className="item-title">{latest.title || 'Task'}</div>
            <Pill tone={latest.status === 'completed' ? 'green' : latest.status === 'failed' ? 'red' : 'blue'} dot>
              {latest.status}
            </Pill>
          </div>
          <div className="progress-track mt">
            <span style={{ width: `${latest.progress}%` }} />
          </div>
          <div className="small muted mt">
            Started {relativeTime(latest.createdAt)}
            {latest.finishedAt ? ` · finished ${relativeTime(latest.finishedAt)}` : ''}
          </div>
          {latest.error && (
            <div className="log-line error mt">{latest.error}</div>
          )}
          {latest.result?.content && (
            <div
              className="md log-line mt"
              style={{ maxHeight: 260, overflow: 'auto' }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(String(latest.result.content).slice(0, 2000)) }}
            />
          )}
        </Card>
      ) : (
        <EmptyState title="No task yet" hint="Start a conversation to create a task for this agent." />
      )}

      <SectionTitle>Activity</SectionTitle>
      {tasks.data?.tasks?.length ? (
        <div className="list">
          {tasks.data.tasks.slice(0, 12).map((task) => (
            <div key={task.id} className="list-item">
              <div className="avatar" style={{ background: 'var(--blue-soft)', color: 'var(--blue-deep)' }}>
                {task.status.slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="item-title truncate">{task.title || 'Task'}</div>
                <div className="item-sub">
                  {task.status} · {relativeTime(task.createdAt)}
                </div>
              </div>
              <Pill tone={task.status === 'completed' ? 'green' : task.status === 'failed' ? 'red' : 'blue'}>
                {task.status}
              </Pill>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="Nothing recorded yet" hint="Task history for this agent will appear here." />
      )}
    </div>
  );
}
