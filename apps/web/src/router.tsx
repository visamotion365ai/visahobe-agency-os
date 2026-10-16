import { createRootRoute, createRoute, createRouter, Outlet, useRouterState } from '@tanstack/react-router';
import { AppShell } from './components/AppShell';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import { LoginRoute } from './routes/login';
import { HomeRoute } from './routes/dashboard';
import { AgentDetailRoute, AgentsRoute } from './routes/agents';
import { ChatRoute } from './routes/chat';
import { CaseDetailRoute, CasesRoute } from './routes/cases';
import { DocumentsRoute } from './routes/documents';
import {
  IntegrationsRoute,
  MoreRoute,
  ReportsRoute,
  RequirementsRoute,
  SettingsRoute,
  SponsorsRoute,
} from './routes/operations';
import { BrowserRoute } from './routes/browser';
import { SkillsRoute } from './routes/skills';

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => (
    <div className="empty">
      <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>Page not found</div>
      <div className="small mt">The page you asked for does not exist in this deployment.</div>
    </div>
  ),
});

function RootLayout() {
  const { user, loading } = useAuth();
  const routerState = useRouterState();

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <Loading label="Starting VisaHOBe…" />
      </div>
    );
  }
  if (!user) return <LoginRoute />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomeRoute });
const agentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/agents', component: AgentsRoute });
const agentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/$key',
  component: AgentDetailRoute,
});
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ChatRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    agent: typeof search.agent === 'string' ? search.agent : undefined,
  }),
});
const casesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/cases', component: CasesRoute });
const caseDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cases/$id',
  component: CaseDetailRoute,
});
const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documents',
  component: DocumentsRoute,
});
const moreRoute = createRoute({ getParentRoute: () => rootRoute, path: '/more', component: MoreRoute });
const browserRoute = createRoute({ getParentRoute: () => rootRoute, path: '/browser', component: BrowserRoute });
const sponsorsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sponsors', component: SponsorsRoute });
const requirementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/requirements',
  component: RequirementsRoute,
});
const reportsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/reports', component: ReportsRoute });
const integrationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/integrations',
  component: IntegrationsRoute,
});
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsRoute });
const skillsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/skills', component: SkillsRoute });

const routeTree = rootRoute.addChildren([
  indexRoute,
  agentsRoute,
  agentDetailRoute,
  chatRoute,
  casesRoute,
  caseDetailRoute,
  documentsRoute,
  moreRoute,
  browserRoute,
  sponsorsRoute,
  requirementsRoute,
  reportsRoute,
  integrationsRoute,
  settingsRoute,
  skillsRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
