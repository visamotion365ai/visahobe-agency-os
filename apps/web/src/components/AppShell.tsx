import { useEffect, useState, type ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  AgentsIcon,
  BrowserIcon,
  CasesIcon,
  ChatIcon,
  DocsIcon,
  GlobeIcon,
  HomeIcon,
  MoreIcon,
  PlugIcon,
  ReportsIcon,
  SettingsIcon,
  ShieldIcon,
  SkillsIcon,
  SponsorsIcon,
} from './icons';
import { useAuth } from '../lib/auth';
import { useInstall } from '../lib/install';
import { BrandMark } from './Brand';
import { Sheet } from './ui';

const PRIMARY_NAV = [
  { to: '/', label: 'Home', Icon: HomeIcon },
  { to: '/agents', label: 'Agents', Icon: AgentsIcon },
  { to: '/chat', label: 'Chat', Icon: ChatIcon },
  { to: '/cases', label: 'Cases', Icon: CasesIcon },
  { to: '/documents', label: 'Documents', Icon: DocsIcon },
  { to: '/more', label: 'More', Icon: MoreIcon },
] as const;

const SECONDARY_NAV = [
  { to: '/skills', label: 'Skills', Icon: SkillsIcon },
  { to: '/browser', label: 'Browser Automation', Icon: BrowserIcon },
  { to: '/sponsors', label: 'Sponsors', Icon: SponsorsIcon },
  { to: '/requirements', label: 'Country Requirements', Icon: GlobeIcon },
  { to: '/reports', label: 'Reports', Icon: ReportsIcon },
  { to: '/integrations', label: 'Integrations', Icon: PlugIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const { user, signOut } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const install = useInstall();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const isActive = (to: string) =>
    to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark size={36} />
          <div>
            <div className="brand-word">VisaHOBe</div>
            <div className="brand-sub">Agency OS</div>
          </div>
        </div>
        {PRIMARY_NAV.map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="side-link" data-active={isActive(to)}>
            <Icon size={19} />
            {label}
          </Link>
        ))}
        <div className="divider" />
        <div className="section-title" style={{ margin: '6px 12px' }}>
          Operations
        </div>
        {SECONDARY_NAV.map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="side-link" data-active={isActive(to)}>
            <Icon size={19} />
            {label}
          </Link>
        ))}
        <div style={{ flex: 1 }} />
        <div className="card" style={{ padding: 12 }}>
          <div className="item-title">{user?.name}</div>
          <div className="item-sub">{user?.email}</div>
          <button className="btn ghost small mt" style={{ width: '100%' }} onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="shell">
        {!online && (
          <div className="install-banner mb" style={{ background: 'var(--amber-soft)', borderColor: 'rgba(178,106,0,.25)' }}>
            You are offline. Changes cannot be saved until the connection returns.
          </div>
        )}
        {children}
      </main>

      <nav className="bottom-nav">
        {PRIMARY_NAV.map(({ to, label, Icon }) => {
          if (to === '/more') {
            return (
              <button
                key={to}
                className="nav-item"
                data-active={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
                style={{ background: 'none', border: 'none' }}
              >
                <MoreIcon size={21} />
                More
              </button>
            );
          }
          return (
            <Link key={to} to={to} className="nav-item" data-active={isActive(to)}>
              <Icon size={21} />
              {label}
            </Link>
          );
        })}
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="list">
          {SECONDARY_NAV.map(({ to, label, Icon }) => (
            <Link
              key={to}
              to={to}
              className="list-item"
              onClick={() => setMoreOpen(false)}
              style={{ color: 'var(--ink)' }}
            >
              <div
                className="avatar"
                style={{ background: 'rgba(10,132,255,.12)', color: 'var(--blue-deep)' }}
              >
                <Icon size={19} />
              </div>
              <div>
                <div className="item-title">{label}</div>
                <div className="item-sub">VisaHOBe operations</div>
              </div>
            </Link>
          ))}
        </div>
        <div className="divider" />
        <div className="row-between">
          <div>
            <div className="item-title">{user?.name}</div>
            <div className="item-sub">{user?.email}</div>
          </div>
          <button className="btn ghost small" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        {install.canInstall && (
          <>
            <div className="divider" />
            {install.canPrompt ? (
              <button
                className="btn block"
                onClick={() => void install.promptInstall()}
              >
                Install VisaHOBe on this device
              </button>
            ) : (
              <div className="install-guide">
                <div className="install-title">Install VisaHOBe</div>
                <div className="install-sub">
                  {install.isIos
                    ? 'Safari: tap the Share button, then “Add to Home Screen”.'
                    : 'Open the browser menu (⋮) and choose “Install app” or “Add to Home screen”.'}
                </div>
              </div>
            )}
          </>
        )}
      </Sheet>
    </div>
  );
}
