import { Link } from '@tanstack/react-router';
import { AGENT_PROFILES } from '@visahobe/shared';
import { useApi } from '../lib/useAsync';
import { useAuth } from '../lib/auth';
import { Avatar, Card, EmptyState, Loading, Pill, SectionTitle } from '../components/ui';
import { BrowserIcon, ChatIcon, PlusIcon, ReportsIcon, ShieldIcon, SkillsIcon } from '../components/icons';
import { relativeTime } from '../lib/format';
import { useInstall } from '../lib/install';

interface Summary {
  totals: { applicants: number; cases: number; documents: number; sponsors: number; conversations: number };
  byCountry: Array<{ country: string; count: number }>;
  byStep: Array<{ step: number; count: number }>;
  bySponsorStatus: Array<{ status: string; count: number }>;
  docByCategory: Array<{ category: string; count: number }>;
  recentCases: Array<{
    id: string;
    reference: string;
    country: string;
    visaCategory: string;
    status: string;
    currentStep: number;
    createdAt: string;
    fullName: string;
  }>;
}

export function HomeRoute() {
  const { user } = useAuth();
  const summary = useApi<Summary>('/api/reports/summary');
  const browser = useApi<any>('/api/browser/status');
  const providers = useApi<any>('/api/providers/default');
  const install = useInstall();

  const workerConnected = browser.data?.worker?.connected === true;
  const provider = providers.data?.provider;

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Good day, {user?.name?.split(' ')[0] ?? 'there'}</h1>
          <div className="page-sub">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}{' '}
            · VisaHOBe Agency OS
          </div>
        </div>
        <div className="row">
          <Link to="/cases" className="btn small soft">
            <PlusIcon size={16} /> New case
          </Link>
        </div>
      </header>

      {install.canInstall && (
        <div className="install-cta mb">
          <div className="install-mark">
            <ShieldIcon size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="install-title">Install VisaHOBe</div>
            <div className="install-sub">
              {install.isIos
                ? 'Tap Share, then “Add to Home Screen” for the full app.'
                : 'Add the app to your home screen — opens full-screen and works offline.'}
            </div>
          </div>
          {install.canPrompt ? (
            <button className="btn small" onClick={() => void install.promptInstall()}>
              Install
            </button>
          ) : (
            <Link to="/more" className="btn small soft">
              How to
            </Link>
          )}
        </div>
      )}

      <div className="grid-3">
        <div className="stat">
          <div className="stat-value">{summary.data?.totals.applicants ?? '—'}</div>
          <div className="stat-label">Applicants</div>
        </div>
        <div className="stat">
          <div className="stat-value">{summary.data?.totals.cases ?? '—'}</div>
          <div className="stat-label">Visa cases</div>
        </div>
        <div className="stat">
          <div className="stat-value">{summary.data?.totals.documents ?? '—'}</div>
          <div className="stat-label">Documents</div>
        </div>
      </div>

      <SectionTitle>System status</SectionTitle>
      <div className="stack">
        <Card glass>
          <div className="row-between">
            <div className="row">
              <div
                className="avatar"
                style={{
                  background: workerConnected ? 'var(--green-soft)' : 'var(--amber-soft)',
                  color: workerConnected ? 'var(--green)' : 'var(--amber)',
                }}
              >
                <BrowserIcon size={19} />
              </div>
              <div>
                <div className="item-title">Browser worker</div>
                <div className="item-sub">
                  {workerConnected
                    ? `Connected — ${browser.data?.worker?.label ?? 'worker'}`
                    : 'Not connected. The live preview is unavailable until a worker connects.'}
                </div>
              </div>
            </div>
            <Pill tone={workerConnected ? 'green' : 'amber'} dot>
              {workerConnected ? 'online' : 'offline'}
            </Pill>
          </div>
        </Card>

        <Card glass>
          <div className="row-between">
            <div className="row">
              <div
                className="avatar"
                style={{
                  background: 'var(--blue-soft)',
                  color: 'var(--blue-deep)',
                }}
              >
                <ShieldIcon size={19} />
              </div>
              <div>
                <div className="item-title">{provider?.name ?? 'VisaHOBe Local Engine'}</div>
                <div className="item-sub">
                  {provider?.kind === 'builtin'
                    ? 'Offline deterministic engine — always available, no API key required.'
                    : `Model: ${provider?.model ?? '—'}`}
                </div>
              </div>
            </div>
            <Pill tone={providers.data?.health?.ok ? 'green' : 'amber'} dot>
              {providers.data?.health?.ok ? 'ready' : 'unreachable'}
            </Pill>
          </div>
        </Card>
      </div>

      <SectionTitle>AI agents</SectionTitle>
      <div className="scroll-x">
        {(Object.keys(AGENT_PROFILES) as Array<keyof typeof AGENT_PROFILES>).map((key) => {
          const profile = AGENT_PROFILES[key];
          return (
            <Link
              key={key}
              to="/agents/$key"
              params={{ key }}
              className="card tappable"
              style={{ minWidth: 168, textDecoration: 'none', color: 'inherit' }}
            >
              <div className="row">
                <Avatar name={profile.name} color={profile.accent} size={38} />
                <div>
                  <div className="item-title">{profile.name}</div>
                  <div className="item-sub">{profile.role}</div>
                </div>
              </div>
              <div className="small muted" style={{ marginTop: 8, lineHeight: 1.45 }}>
                {profile.focus}
              </div>
            </Link>
          );
        })}
      </div>

      <SectionTitle>Recent cases</SectionTitle>
      {summary.loading ? (
        <Loading />
      ) : summary.data?.recentCases?.length ? (
        <div className="list">
          {summary.data.recentCases.map((item) => (
            <Link
              key={item.id}
              to="/cases/$id"
              params={{ id: item.id }}
              className="list-item"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              <div className="avatar" style={{ background: 'var(--blue)' }}>
                {item.reference.slice(3, 5)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="item-title truncate">{item.fullName}</div>
                <div className="item-sub truncate">
                  {item.reference} · {item.country} · {item.visaCategory}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Pill tone="blue">Step {item.currentStep}/10</Pill>
                <div className="small muted" style={{ marginTop: 4 }}>
                  {relativeTime(item.createdAt)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No cases yet"
          hint="Create your first case to start the ten-step visa workflow."
          action={
            <Link to="/cases" className="btn small">
              Open cases
            </Link>
          }
        />
      )}

      <SectionTitle>Shortcuts</SectionTitle>
      <div className="grid-2">
        <Link to="/chat" search={{ agent: undefined }} className="card tappable" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="row">
            <div className="avatar" style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}>
              <ChatIcon size={19} />
            </div>
            <div>
              <div className="item-title">Ask an agent</div>
              <div className="item-sub">Conversational operations help</div>
            </div>
          </div>
        </Link>
        <Link to="/reports" className="card tappable" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="row">
            <div className="avatar" style={{ background: 'var(--teal-soft)', color: 'var(--teal)' }}>
              <ReportsIcon size={19} />
            </div>
            <div>
              <div className="item-title">Reports</div>
              <div className="item-sub">Pipeline and readiness</div>
            </div>
          </div>
        </Link>
        <Link to="/skills" className="card tappable" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="row">
            <div className="avatar" style={{ background: 'var(--indigo-soft)', color: 'var(--indigo)' }}>
              <SkillsIcon size={19} />
            </div>
            <div>
              <div className="item-title">Skills</div>
              <div className="item-sub">Teach the agents new abilities</div>
            </div>
          </div>
        </Link>
        <Link to="/settings" className="card tappable" style={{ color: 'inherit', textDecoration: 'none' }}>
          <div className="row">
            <div className="avatar" style={{ background: 'var(--blue-soft)', color: 'var(--blue-deep)' }}>
              <ShieldIcon size={19} />
            </div>
            <div>
              <div className="item-title">Add API key</div>
              <div className="item-sub">Bring your own AI provider</div>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
