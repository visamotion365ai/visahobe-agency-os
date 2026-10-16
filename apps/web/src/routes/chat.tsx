import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { AGENT_PROFILES, type AgentKey } from '@visahobe/shared';
import { api } from '../api';
import { useApi } from '../lib/useAsync';
import { Avatar, Card, EmptyState, Loading, Pill, useToast } from '../components/ui';
import { RefreshIcon, SendIcon } from '../components/icons';
import { renderMarkdown, relativeTime } from '../lib/format';

interface MessageDto {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  meta: any;
  createdAt: string;
}

interface CaseDto {
  id: string;
  reference: string;
  country: string;
  visaCategory: string;
  applicantName: string;
}

export function ChatRoute() {
  const search = useSearch({ from: '/chat' }) as { agent?: string };
  const toast = useToast();
  const [agentKey, setAgentKey] = useState<AgentKey>((search.agent as AgentKey) ?? 'raffi');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [caseId, setCaseId] = useState<string>('');
  const [meta, setMeta] = useState<{ provider?: string; model?: string; tools?: string[]; local?: boolean }>({});
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const cases = useApi<{ items: CaseDto[] }>('/api/cases?pageSize=25');
  const conversations = useApi<{ conversations: any[] }>(`/api/agents/${agentKey}/conversations`, [agentKey]);
  const profile = AGENT_PROFILES[agentKey];

  useEffect(() => {
    setConversationId(null);
    setMessages([]);
    setMeta({});
  }, [agentKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const loadMessages = async (id: string) => {
    const { messages: list } = await api.get<{ messages: MessageDto[] }>(`/api/conversations/${id}/messages`);
    setMessages(list);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');
    const optimistic: MessageDto = {
      id: `local-${Date.now()}`,
      conversationId: conversationId ?? '',
      role: 'user',
      content: text,
      meta: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const result = await api.post<any>('/api/agents/chat', {
        agentKey,
        message: text,
        conversationId: conversationId ?? undefined,
        caseId: caseId || undefined,
      });
      setConversationId(result.conversationId);
      setMeta({
        provider: result.providerName,
        model: result.model,
        tools: result.toolsUsed,
        local: result.usedLocalEngine,
      });
      await loadMessages(result.conversationId);
    } catch (error) {
      toast.push((error as Error).message, 'error');
      setMessages((current) => current.filter((m) => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  };

  const openConversation = async (id: string) => {
    setConversationId(id);
    await loadMessages(id);
  };

  const caseOptions = useMemo(() => cases.data?.items ?? [], [cases.data]);

  return (
    <div className="chat-page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Chat</h1>
          <div className="page-sub">Every answer is grounded in the agency database.</div>
        </div>
      </header>

      <div className="scroll-x" style={{ marginBottom: 12 }}>
        {(Object.keys(AGENT_PROFILES) as AgentKey[]).map((key) => {
          const item = AGENT_PROFILES[key];
          const active = key === agentKey;
          return (
            <button
              key={key}
              className="card"
              onClick={() => setAgentKey(key)}
              style={{
                minWidth: 132,
                borderColor: active ? item.accent : 'var(--line)',
                boxShadow: active ? `0 0 0 3px ${item.accent}22` : undefined,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div className="row">
                <Avatar name={item.name} color={item.accent} size={30} />
                <div>
                  <div className="item-title" style={{ fontSize: 14 }}>
                    {item.name}
                  </div>
                  <div className="item-sub" style={{ fontSize: 11 }}>
                    {item.role}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Card glass style={{ padding: 12 }}>
        <div className="row-between" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 8, flex: 1, minWidth: 200 }}>
            <span className="label" style={{ flex: 'none' }}>
              Case
            </span>
            <select className="select" value={caseId} onChange={(event) => setCaseId(event.target.value)}>
              <option value="">No case linked</option>
              {caseOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.reference} — {item.applicantName} ({item.country})
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn ghost small"
            onClick={() => {
              setConversationId(null);
              setMessages([]);
              setMeta({});
            }}
          >
            <RefreshIcon size={15} /> New chat
          </button>
        </div>
      </Card>

      {conversations.data?.conversations?.length ? (
        <div className="scroll-x" style={{ marginTop: 10 }}>
          {conversations.data.conversations.slice(0, 8).map((conversation) => (
            <button
              key={conversation.id}
              className="pill"
              style={{
                border: 'none',
                cursor: 'pointer',
                background: conversationId === conversation.id ? 'var(--blue)' : 'rgba(16,21,31,.06)',
                color: conversationId === conversation.id ? '#fff' : 'var(--ink-2)',
              }}
              onClick={() => void openConversation(conversation.id)}
            >
              {conversation.title?.slice(0, 28) ?? 'Conversation'} · {relativeTime(conversation.updatedAt)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="chat-scroll mt">
        {messages.length === 0 && (
          <EmptyState
            title={`Ask ${profile.name}`}
            hint={profile.focus}
          />
        )}
        {messages.map((message) => (
          <div key={message.id} className={`bubble ${message.role === 'user' ? 'user' : 'assistant'}`}>
            {message.role === 'assistant' ? (
              <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
            ) : (
              message.content
            )}
          </div>
        ))}
        {sending && (
          <div className="bubble assistant">
            <span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {meta.provider && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <Pill tone="blue">{meta.provider}</Pill>
          <Pill>{meta.model}</Pill>
          {meta.tools?.map((tool) => (
            <Pill key={tool} tone="teal">
              {tool}
            </Pill>
          ))}
        </div>
      )}

      <div className="composer">
        <textarea
          className="textarea"
          placeholder={`Message ${profile.name}…`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button className="btn" onClick={() => void send()} disabled={sending || !input.trim()}>
          <SendIcon size={18} />
        </button>
      </div>
    </div>
  );
}
