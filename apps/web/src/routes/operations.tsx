import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { COUNTRIES } from '@visahobe/shared';
import { api } from '../api';
import { useApi } from '../lib/useAsync';
import { Card, EmptyState, Field, Loading, Pill, SectionTitle, Sheet, useToast } from '../components/ui';
import { PlusIcon, RefreshIcon } from '../components/icons';
import { formatDate, SPONSOR_TONE } from '../lib/format';

/* -------------------------------- More --------------------------------- */

export function MoreRoute() {
  const sections = [
    { to: '/skills', label: 'Skills', hint: 'Create reusable agent abilities and preview them live' },
    { to: '/browser', label: 'Browser automation', hint: 'Live Playwright preview and task runner' },
    { to: '/sponsors', label: 'Sponsor database', hint: 'Search, verify and link employers' },
    { to: '/requirements', label: 'Country requirements', hint: 'Source-linked, versioned rule base' },
    { to: '/reports', label: 'Reports', hint: 'Pipeline, readiness and sponsor statistics' },
    { to: '/integrations', label: 'Integrations', hint: 'Google Workspace and Firecrawl' },
    { to: '/settings', label: 'Settings', hint: 'Providers, passport rules and administration' },
  ];
  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">More</h1>
          <div className="page-sub">Operations tooling, integrations and administration.</div>
        </div>
      </header>
      <div className="list">
        {sections.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="list-item"
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="item-title">{item.label}</div>
              <div className="item-sub">{item.hint}</div>
            </div>
            <span className="muted">›</span>
          </Link>
        ))}
      </div>

      <SectionTitle>About this deployment</SectionTitle>
      <Card glass>
        <div className="small" style={{ lineHeight: 1.6 }}>
          VisaHOBe Agency OS runs entirely on your own infrastructure. The browser automation worker, the AI
          providers and the document store are all self-hosted and optional. No applicant data is sent to a
          third-party service unless you explicitly configure one.
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------ Sponsors -------------------------------- */

export function SponsorsRoute() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const sponsors = useApi<{ sponsors: any[] }>(`/api/sponsors${query ? `?q=${encodeURIComponent(query)}` : ''}`, [query]);
  const [statusFilter, setStatusFilter] = useState('');

  const list = (sponsors.data?.sponsors ?? []).filter((item: any) =>
    statusFilter ? item.verificationStatus === statusFilter : true,
  );

  const setVerification = async (id: string, status: string) => {
    try {
      await api.post(`/api/sponsors/${id}/verification`, { status });
      await sponsors.reload();
      toast.push('Verification state updated.');
    } catch (error) {
      toast.push((error as Error).message, 'error');
    }
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Sponsors</h1>
          <div className="page-sub">A sponsor is only “verified” after an evidence-based review.</div>
        </div>
        <button className="btn small" onClick={() => setCreateOpen(true)}>
          <PlusIcon size={16} /> Add
        </button>
      </header>

      <div className="row mb" style={{ gap: 8 }}>
        <input
          className="input"
          placeholder="Search name, legal name or registration id"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select className="select" style={{ width: 170 }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">All states</option>
          <option value="unverified">Unverified</option>
          <option value="pending_verification">Pending verification</option>
          <option value="verified">Verified</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {sponsors.loading ? (
        <Loading />
      ) : list.length ? (
        <div className="list">
          {list.map((sponsor: any) => (
            <Card key={sponsor.id} glass>
              <div className="row-between">
                <div className="item-title">{sponsor.name}</div>
                <Pill tone={SPONSOR_TONE[sponsor.verificationStatus] ?? ''} dot>
                  {sponsor.verificationStatus.replace(/_/g, ' ')}
                </Pill>
              </div>
              <dl className="kv" style={{ margin: '10px 0 0' }}>
                <dt>Country</dt>
                <dd>{sponsor.country}</dd>
                <dt>Legal name</dt>
                <dd>{sponsor.legalName || '—'}</dd>
                <dt>Registration</dt>
                <dd>{sponsor.registrationId || '—'}</dd>
                <dt>Website</dt>
                <dd className="truncate" style={{ maxWidth: 200 }}>
                  {sponsor.website ? (
                    <a href={sponsor.website} target="_blank" rel="noreferrer">
                      {sponsor.website}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Last verified</dt>
                <dd>{sponsor.lastVerifiedAt ? formatDate(sponsor.lastVerifiedAt) : 'never'}</dd>
              </dl>
              {sponsor.notes && <div className="small muted mt">{sponsor.notes}</div>}
              <div className="row mt" style={{ gap: 6, flexWrap: 'wrap' }}>
                {(['unverified', 'pending_verification', 'verified', 'inactive'] as const).map((option) => (
                  <button
                    key={option}
                    className="btn ghost small"
                    style={
                      sponsor.verificationStatus === option
                        ? { background: 'var(--blue)', color: '#fff', borderColor: 'transparent' }
                        : undefined
                    }
                    onClick={() => void setVerification(sponsor.id, option)}
                  >
                    {option.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No sponsors" hint="Add the employers that will sponsor applicants." />
      )}

      <SponsorSheet open={createOpen} onClose={() => setCreateOpen(false)} onDone={() => {
        setCreateOpen(false);
        void sponsors.reload();
      }} />
    </div>
  );
}

function SponsorSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    legalName: '',
    country: '',
    jurisdiction: '',
    registrationId: '',
    website: '',
    sourceUrl: '',
    contactPerson: '',
    email: '',
    phone: '',
    sponsorType: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);

  return (
    <Sheet open={open} onClose={onClose} title="Add sponsor">
      <div className="stack">
        {Object.entries({ name: 'Trade name', legalName: 'Legal name', country: 'Country', jurisdiction: 'Jurisdiction', registrationId: 'Registration id', website: 'Website', sourceUrl: 'Source URL', contactPerson: 'Contact person', email: 'Email', phone: 'Phone', sponsorType: 'Sponsor type' }).map(
          ([key, label]) => (
            <Field key={key} label={label}>
              <input
                className="input"
                value={(form as any)[key]}
                onChange={(event) => setForm({ ...form, [key]: event.target.value })}
              />
            </Field>
          ),
        )}
        <Field label="Notes" hint="Never invent registration details. Record what has actually been confirmed.">
          <textarea
            className="textarea"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </Field>
        <button
          className="btn block"
          disabled={!form.name || !form.country || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post('/api/sponsors', { ...form, verificationStatus: 'unverified' });
              toast.push('Sponsor added as unverified.');
              onDone();
            } catch (error) {
              toast.push((error as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Add sponsor
        </button>
      </div>
    </Sheet>
  );
}

/* ----------------------------- Requirements ----------------------------- */

export function RequirementsRoute() {
  const toast = useToast();
  const [country, setCountry] = useState<string>('Turkey');
  const [category, setCategory] = useState('*');
  const requirements = useApi<{ requirements: any[] }>(
    `/api/requirements?country=${country}&visaCategory=${encodeURIComponent(category)}`,
    [country, category],
  );
  const [addOpen, setAddOpen] = useState(false);

  const verify = async (id: string) => {
    const sourceUrl = window.prompt('Source URL for this requirement (official page):');
    if (!sourceUrl) return;
    try {
      await api.post(`/api/requirements/${id}/verify`, { sourceUrl });
      await requirements.reload();
      toast.push('Requirement marked as verified.');
    } catch (error) {
      toast.push((error as Error).message, 'error');
    }
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Country requirements</h1>
          <div className="page-sub">
            Versioned and source-linked. Unverified records are flagged everywhere they are used.
          </div>
        </div>
        <button className="btn small" onClick={() => setAddOpen(true)}>
          <PlusIcon size={16} /> Add
        </button>
      </header>

      <div className="row mb" style={{ gap: 8 }}>
        <select className="select" value={country} onChange={(event) => setCountry(event.target.value)}>
          {COUNTRIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="*">All categories</option>
          <option value="Work Visa">Work Visa</option>
          <option value="Student Visa">Student Visa</option>
          <option value="Employment Pass">Employment Pass</option>
          <option value="Visit Visa">Visit Visa</option>
        </select>
        <button className="btn ghost small" onClick={() => void requirements.reload()}>
          <RefreshIcon size={15} />
        </button>
      </div>

      {requirements.loading ? (
        <Loading />
      ) : requirements.data?.requirements?.length ? (
        <div className="list">
          {requirements.data.requirements.map((requirement: any) => (
            <Card key={requirement.id} glass>
              <div className="row-between">
                <div className="item-title">{requirement.title}</div>
                <Pill tone={requirement.verifiedAt ? 'green' : 'amber'} dot>
                  {requirement.verifiedAt ? 'verified' : 'unverified'}
                </Pill>
              </div>
              <div className="small muted mt">
                {requirement.category} · {requirement.visaCategory} · v{requirement.version}
                {requirement.mandatory ? ' · mandatory' : ''}
              </div>
              {requirement.description && (
                <div className="small mt" style={{ lineHeight: 1.5 }}>
                  {requirement.description}
                </div>
              )}
              {requirement.sourceUrl && (
                <a className="small" href={requirement.sourceUrl} target="_blank" rel="noreferrer">
                  {requirement.sourceUrl}
                </a>
              )}
              <div className="row mt" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="small muted">
                  {requirement.verifiedAt ? `Verified ${formatDate(requirement.verifiedAt)}` : 'No verification date'}
                </span>
                <button className="btn ghost small" onClick={() => void verify(requirement.id)}>
                  Mark verified
                </button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No requirements stored" hint="Add requirements from an official government source." />
      )}

      <AddRequirementSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultCountry={country}
        onDone={() => {
          setAddOpen(false);
          void requirements.reload();
        }}
      />
    </div>
  );
}

function AddRequirementSheet({
  open,
  onClose,
  defaultCountry,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  defaultCountry: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    country: defaultCountry,
    visaCategory: '*',
    title: '',
    description: '',
    category: 'general',
    mandatory: true,
    sourceUrl: '',
    sourceTitle: '',
  });
  const [busy, setBusy] = useState(false);

  return (
    <Sheet open={open} onClose={onClose} title="Add requirement">
      <div className="stack">
        <Field label="Country">
          <select className="select" value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })}>
            {COUNTRIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Visa category" hint="Use * to apply the rule to every category of that country.">
          <input className="input" value={form.visaCategory} onChange={(event) => setForm({ ...form, visaCategory: event.target.value })} />
        </Field>
        <Field label="Title">
          <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </Field>
        <Field label="Description">
          <textarea className="textarea" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <Field label="Source URL" hint="Link the exact official page or clause.">
          <input className="input" value={form.sourceUrl} onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })} />
        </Field>
        <button
          className="btn block"
          disabled={!form.title || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.post('/api/requirements', form);
              toast.push('Requirement added (unverified until a reviewer confirms the source).');
              onDone();
            } catch (error) {
              toast.push((error as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Add requirement
        </button>
      </div>
    </Sheet>
  );
}

/* ------------------------------- Reports -------------------------------- */

export function ReportsRoute() {
  const summary = useApi<any>('/api/reports/summary');
  const data = summary.data;

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Reports</h1>
          <div className="page-sub">Live counts from the operational database.</div>
        </div>
      </header>

      {summary.loading ? (
        <Loading />
      ) : (
        <>
          <div className="grid-3">
            <div className="stat">
              <div className="stat-value">{data?.totals?.applicants ?? 0}</div>
              <div className="stat-label">Applicants</div>
            </div>
            <div className="stat">
              <div className="stat-value">{data?.totals?.cases ?? 0}</div>
              <div className="stat-label">Cases</div>
            </div>
            <div className="stat">
              <div className="stat-value">{data?.totals?.documents ?? 0}</div>
              <div className="stat-label">Documents</div>
            </div>
          </div>

          <SectionTitle>Cases by country</SectionTitle>
          <Card glass>
            {data?.byCountry?.length ? (
              data.byCountry.map((row: any) => {
                const max = Math.max(...data.byCountry.map((item: any) => item.count));
                return (
                  <div key={row.country} style={{ marginBottom: 10 }}>
                    <div className="row-between small">
                      <span>{row.country}</span>
                      <span className="muted">{row.count}</span>
                    </div>
                    <div className="bar mt" style={{ marginTop: 4 }}>
                      <span style={{ width: `${(row.count / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="small muted">No case data yet.</div>
            )}
          </Card>

          <SectionTitle>Active cases by workflow step</SectionTitle>
          <Card glass>
            {data?.byStep?.length ? (
              <div className="row" style={{ gap: 6, alignItems: 'flex-end', height: 120 }}>
                {data.byStep.map((row: any) => {
                  const max = Math.max(...data.byStep.map((item: any) => item.count));
                  return (
                    <div key={row.step} style={{ flex: 1, textAlign: 'center' }}>
                      <div className="small muted">{row.count}</div>
                      <div
                        style={{
                          height: `${(row.count / max) * 90}px`,
                          background: 'linear-gradient(180deg,var(--blue),rgba(10,132,255,.55))',
                          borderRadius: 8,
                        }}
                      />
                      <div className="small muted" style={{ marginTop: 6 }}>
                        {row.step}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="small muted">No active cases.</div>
            )}
          </Card>

          <SectionTitle>Sponsor verification</SectionTitle>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {data?.bySponsorStatus?.map((row: any) => (
              <Pill key={row.status} tone={SPONSOR_TONE[row.status] ?? ''}>
                {row.status.replace(/_/g, ' ')}: {row.count}
              </Pill>
            ))}
          </div>

          <SectionTitle>Documents by category</SectionTitle>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {data?.docByCategory?.map((row: any) => (
              <Pill key={row.category}>
                {row.category}: {row.count}
              </Pill>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------- Integrations ----------------------------- */

export function IntegrationsRoute() {
  const toast = useToast();
  const integrations = useApi<any>('/api/integrations');
  const [url, setUrl] = useState('');
  const [scrape, setScrape] = useState<any>(null);

  const runScrape = async () => {
    if (!url) return;
    try {
      const result = await api.post<any>('/api/integrations/scrape', { url });
      setScrape(result.page);
      toast.push('Page extracted.');
    } catch (error) {
      toast.push((error as Error).message, 'error');
    }
  };

  const google = integrations.data?.google;
  const firecrawl = integrations.data?.firecrawl;

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Integrations</h1>
          <div className="page-sub">Optional connectors. The platform stays fully usable when they are off.</div>
        </div>
      </header>

      <SectionTitle>Google Workspace</SectionTitle>
      <Card glass>
        <div className="row-between">
          <div>
            <div className="item-title">Drive · Docs · Gmail</div>
            <div className="item-sub">
              {google?.connected
                ? `Connected${google.accountEmail ? ` as ${google.accountEmail}` : ''}`
                : google?.configured
                  ? 'Configured but not connected yet.'
                  : 'Not configured on this server.'}
            </div>
          </div>
          <Pill tone={google?.connected ? 'green' : 'amber'} dot>
            {google?.status ?? 'disconnected'}
          </Pill>
        </div>
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          {google?.connected ? (
            <button
              className="btn ghost small"
              onClick={async () => {
                await api.post('/api/integrations/google/disconnect');
                await integrations.reload();
                toast.push('Google disconnected.');
              }}
            >
              Disconnect
            </button>
          ) : (
            <a className="btn small" href="/api/integrations/google/start">
              Connect Google
            </a>
          )}
        </div>
        <div className="small muted mt">
          Dossiers can be exported to Drive, editable drafts to Docs, and client emails drafted in Gmail. Emails
          are never sent automatically — a human confirms and sends.
        </div>
      </Card>

      <SectionTitle>Firecrawl / web intelligence</SectionTitle>
      <Card glass>
        <div className="row-between">
          <div>
            <div className="item-title">Self-hosted Firecrawl</div>
            <div className="item-sub">{firecrawl?.note}</div>
          </div>
          <Pill tone={firecrawl?.configured ? 'green' : ''} dot>
            {firecrawl?.configured ? 'configured' : 'fallback'}
          </Pill>
        </div>
        <div className="row mt" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="https://official-immigration.gov/requirements"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            inputMode="url"
            autoCapitalize="none"
          />
          <button className="btn" onClick={() => void runScrape()}>
            Extract
          </button>
        </div>
        {scrape && (
          <div className="mt">
            <div className="small muted">
              {scrape.title} · {scrape.source} · retrieved {formatDate(scrape.retrievedAt, true)}
            </div>
            <div className="log-line mt" style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {String(scrape.text).slice(0, 3000)}
            </div>
          </div>
        )}
        <div className="small muted mt">
          Extracted pages are evidence for a human review. They never replace an approved requirement
          automatically.
        </div>
      </Card>

      <SectionTitle>Local AI</SectionTitle>
      <Card glass>
        <div className="row-between">
          <div>
            <div className="item-title">Ollama</div>
            <div className="item-sub">{integrations.data?.ollama?.note}</div>
          </div>
          <Pill tone="teal" dot>
            {integrations.data?.ollama?.baseUrl}
          </Pill>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------- Settings ------------------------------- */

export function SettingsRoute() {
  const toast = useToast();
  const providers = useApi<{ providers: any[] }>('/api/providers');
  const settings = useApi<any>('/api/admin/settings');
  const [providerOpen, setProviderOpen] = useState(false);
  const [rules, setRules] = useState<Record<string, { months: number; source?: string }>>({});

  const months = settings.data?.passportValidityRules ?? {};
  const [defaultMonths, setDefaultMonths] = useState<number>(6);
  const [rulesText, setRulesText] = useState('');

  const init = () => {
    const value = months['*|*']?.months ?? 6;
    setDefaultMonths(value);
    setRulesText(
      Object.entries(months)
        .filter(([key]) => key !== '*|*')
        .map(([key, rule]) => `${key} = ${(rule as any).months}`)
        .join('\n'),
    );
  };

  const saveRules = async () => {
    const parsed: Record<string, { months: number; source: string }> = {
      '*|*': { months: defaultMonths, source: 'agency default policy' },
    };
    for (const line of rulesText.split('\n')) {
      const [key, value] = line.split('=').map((part) => part.trim());
      if (!key || !value) continue;
      const amount = Number(value);
      if (!Number.isFinite(amount)) continue;
      parsed[key] = { months: amount, source: 'agency configuration' };
    }
    try {
      await api.put('/api/admin/settings', { passport_validity_rules: parsed });
      toast.push('Passport validity rules updated.');
      await settings.reload();
    } catch (error) {
      toast.push((error as Error).message, 'error');
    }
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">Providers, policy rules and administration.</div>
        </div>
      </header>

      <SectionTitle>AI providers &amp; API keys</SectionTitle>
      <Card glass className="mb">
        <div className="small" style={{ lineHeight: 1.6 }}>
          Bring your own key (BYOK) for any OpenAI-compatible, Anthropic, Gemini, DeepSeek or custom endpoint, or run
          a local model with Ollama. Keys are encrypted at rest and only ever shown as a masked indicator. With no
          provider configured the built-in <strong>VisaHOBe Local Engine</strong> answers, offline and free.
        </div>
      </Card>
      <div className="list">
        {providers.data?.providers?.map((provider: any) => (
          <Card key={provider.id} glass>
            <div className="row-between">
              <div style={{ minWidth: 0 }}>
                <div className="item-title">{provider.name}</div>
                <div className="item-sub">
                  {provider.kind} · {provider.model}
                  {provider.baseUrl ? ` · ${provider.baseUrl}` : ''}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {provider.isDefault ? <Pill tone="blue">default</Pill> : null}
                <Pill tone={provider.hasApiKey ? 'green' : ''}>
                  {provider.hasApiKey ? 'key •••• stored' : 'no key'}
                </Pill>
              </div>
            </div>
            <div className="small muted mt">
              {provider.hasApiKey
                ? 'API key is encrypted at rest and never leaves the server.'
                : 'No API key stored — this provider cannot authenticate yet.'}
            </div>
            <div className="row mt" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button
                className="btn ghost small"
                onClick={async () => {
                  const result = await api.post<any>(`/api/providers/${provider.id}/test`);
                  toast.push(result.ok ? `Connected: ${result.message}` : `Not reachable: ${result.message}`, result.ok ? 'info' : 'error');
                }}
              >
                Test connection
              </button>
              {!provider.isDefault && provider.kind !== 'builtin' && (
                <button
                  className="btn ghost small"
                  onClick={async () => {
                    await api.patch(`/api/providers/${provider.id}`, { isDefault: true });
                    await providers.reload();
                    toast.push('Default provider updated.');
                  }}
                >
                  Make default
                </button>
              )}
              {provider.kind !== 'builtin' && (
                <button
                  className="btn danger small"
                  onClick={async () => {
                    if (!window.confirm(`Delete the provider "${provider.name}"?`)) return;
                    await api.delete(`/api/providers/${provider.id}`);
                    await providers.reload();
                    toast.push('Provider deleted.');
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </Card>
        ))}
        <button className="btn small" onClick={() => setProviderOpen(true)}>
          <PlusIcon size={16} /> Add provider / API key
        </button>
      </div>

      <SectionTitle>Passport validity rules</SectionTitle>
      <Card glass>
        <div className="small muted" style={{ marginBottom: 10 }}>
          The six month figure is an agency default, not a universal legal rule. Configure the requirement per
          country and visa category, and record where the number comes from.
        </div>
        <Field label="Default months (applies to every country)">
          <input
            className="input"
            type="number"
            min={0}
            value={defaultMonths}
            onChange={(event) => setDefaultMonths(Number(event.target.value))}
          />
        </Field>
        <Field label="Overrides" hint="One per line: Turkey|Work Visa = 6">
          <textarea className="textarea" value={rulesText} onChange={(event) => setRulesText(event.target.value)} />
        </Field>
        <button className="btn block mt" onClick={() => void saveRules()}>
          Save rules
        </button>
      </Card>

      <ProviderSheet
        open={providerOpen}
        onClose={() => setProviderOpen(false)}
        onDone={() => {
          setProviderOpen(false);
          void providers.reload();
        }}
      />
    </div>
  );
}

const PROVIDER_PRESETS: Record<
  string,
  { label: string; kind: string; baseUrl: string; model: string; keyHint: string }
> = {
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyHint: 'sk-…',
  },
  anthropic: {
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-5-sonnet-latest',
    keyHint: 'sk-ant-…',
  },
  gemini: {
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-1.5-flash',
    keyHint: 'AIza…',
  },
  deepseek: {
    label: 'DeepSeek',
    kind: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyHint: 'sk-…',
  },
  openrouter: {
    label: 'OpenRouter',
    kind: 'custom',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    keyHint: 'sk-or-…',
  },
  groq: {
    label: 'Groq',
    kind: 'custom',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyHint: 'gsk_…',
  },
  ollama: {
    label: 'Ollama (local)',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.2',
    keyHint: 'no key needed',
  },
  custom: {
    label: 'Custom endpoint',
    kind: 'custom',
    baseUrl: '',
    model: '',
    keyHint: 'your provider key',
  },
};

function ProviderSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
  });
  const [busy, setBusy] = useState(false);

  const applyPreset = (key: string) => {
    const preset = PROVIDER_PRESETS[key];
    setForm({
      name: preset.label,
      kind: preset.kind,
      baseUrl: preset.baseUrl,
      model: preset.model,
      apiKey: '',
    });
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add AI provider">
      <div className="stack">
        <Field label="Quick preset" hint="Pick a provider to fill the endpoint and a sensible model.">
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(PROVIDER_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                className="btn ghost small"
                style={form.kind === preset.kind && form.baseUrl === preset.baseUrl ? { background: 'var(--blue)', color: '#fff', borderColor: 'transparent' } : undefined}
                onClick={() => applyPreset(key)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Name">
          <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Kind">
          <select className="select" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
            <option value="ollama">Ollama (local)</option>
            <option value="openai">OpenAI compatible</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Google Gemini</option>
            <option value="deepseek">DeepSeek</option>
            <option value="custom">Custom OpenAI-compatible endpoint</option>
          </select>
        </Field>
        <Field label="Base URL" hint="The API endpoint, e.g. https://api.openai.com/v1">
          <input className="input" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
        </Field>
        <Field label="Model">
          <input className="input" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
        </Field>
        <Field label="API key" hint="Stored encrypted (AES-256-GCM) on the server. It is never returned to the browser.">
          <input
            className="input"
            type="password"
            autoComplete="off"
            placeholder={PROVIDER_PRESETS[form.kind === 'custom' ? 'custom' : form.kind]?.keyHint ?? 'your key'}
            value={form.apiKey}
            onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
          />
        </Field>
        <button
          className="btn block"
          disabled={!form.name || !form.model || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const created = await api.post<any>('/api/providers', form);
              toast.push('Provider saved. Use “Test connection” to verify it.');
              onDone();
              // Immediately test the new provider so the operator gets feedback.
              if (created?.provider?.id) {
                const result = await api.post<any>(`/api/providers/${created.provider.id}/test`);
                toast.push(result.ok ? `Connected: ${result.message}` : `Not reachable: ${result.message}`, result.ok ? 'info' : 'error');
              }
            } catch (error) {
              toast.push((error as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Save provider
        </button>
      </div>
    </Sheet>
  );
}
