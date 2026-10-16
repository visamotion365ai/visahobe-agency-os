import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { WORKFLOW_STEPS } from '@visahobe/shared';
import { api } from '../api';
import { useApi, useMutation } from '../lib/useAsync';
import { Card, EmptyState, Field, Loading, Pill, SectionTitle, Sheet, StatusPill, useToast } from '../components/ui';
import { BrowserIcon, DownloadIcon, PlusIcon, RefreshIcon } from '../components/icons';
import { DOC_TONE, formatDate, initials } from '../lib/format';

interface CaseDto {
  id: string;
  reference: string;
  country: string;
  visaCategory: string;
  purpose: string | null;
  status: string;
  currentStep: number;
  priority: string;
  applicantName: string;
  applicantPassport: string | null;
  sponsorName: string | null;
  createdAt: string;
}

export function CasesRoute() {
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const cases = useApi<{ items: CaseDto[]; total: number }>(
    `/api/cases?pageSize=50${query ? `&q=${encodeURIComponent(query)}` : ''}${country ? `&country=${country}` : ''}`,
    [query, country],
  );
  const applicants = useApi<{ items: any[] }>('/api/applicants?pageSize=100');
  const sponsors = useApi<{ sponsors: any[] }>('/api/sponsors');

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Cases</h1>
          <div className="page-sub">{cases.data?.total ?? 0} visa cases in the pipeline</div>
        </div>
        <button className="btn small" onClick={() => setCreateOpen(true)}>
          <PlusIcon size={16} /> New
        </button>
      </header>

      <div className="row mb" style={{ gap: 8 }}>
        <input
          className="input"
          placeholder="Search by name or reference"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select className="select" style={{ width: 150 }} value={country} onChange={(event) => setCountry(event.target.value)}>
          <option value="">All countries</option>
          {['Australia', 'Serbia', 'Russia', 'Turkey', 'Singapore', 'Malaysia', 'Saudi Arabia', 'Bahrain'].map(
            (item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ),
          )}
        </select>
      </div>

      {cases.loading ? (
        <Loading />
      ) : cases.data?.items?.length ? (
        <div className="list">
          {cases.data.items.map((item) => (
            <Link
              key={item.id}
              to="/cases/$id"
              params={{ id: item.id }}
              className="list-item"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              <div className="avatar" style={{ background: 'var(--blue)' }}>
                {initials(item.applicantName)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="item-title truncate">{item.applicantName}</div>
                <div className="item-sub truncate">
                  {item.reference} · {item.country} · {item.visaCategory}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Pill tone="blue">Step {item.currentStep}/10</Pill>
                {item.priority === 'high' || item.priority === 'urgent' ? (
                  <div className="small" style={{ color: 'var(--red)', marginTop: 4 }}>
                    {item.priority}
                  </div>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No cases found" hint="Adjust the filters or create a new visa case." />
      )}

      <NewCaseSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        applicants={applicants.data?.items ?? []}
        sponsors={sponsors.data?.sponsors ?? []}
        onCreated={() => {
          setCreateOpen(false);
          void cases.reload();
          void applicants.reload();
        }}
      />
    </div>
  );
}

function NewCaseSheet({
  open,
  onClose,
  applicants,
  sponsors,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  applicants: any[];
  sponsors: any[];
  onCreated: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const [applicantId, setApplicantId] = useState('');
  const [sponsorId, setSponsorId] = useState('');
  const [country, setCountry] = useState('Turkey');
  const [visaCategory, setVisaCategory] = useState('Work Visa');
  const [purpose, setPurpose] = useState('');
  const { run, loading } = useMutation(async () => {
    const result = await api.post<any>('/api/cases', {
      applicantId,
      sponsorId: sponsorId || undefined,
      country,
      visaCategory,
      purpose,
      priority: 'normal',
    });
    return result;
  });

  return (
    <Sheet open={open} onClose={onClose} title="New visa case">
      <div className="stack">
        <Field label="Applicant">
          <select className="select" value={applicantId} onChange={(event) => setApplicantId(event.target.value)}>
            <option value="">Select an applicant</option>
            {applicants.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fullName} ({item.reference})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Destination country">
          <select className="select" value={country} onChange={(event) => setCountry(event.target.value)}>
            {['Australia', 'Serbia', 'Russia', 'Turkey', 'Singapore', 'Malaysia', 'Saudi Arabia', 'Bahrain'].map(
              (item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="Visa category">
          <input
            className="input"
            value={visaCategory}
            onChange={(event) => setVisaCategory(event.target.value)}
            placeholder="e.g. Work Visa, Student Visa, Employment Pass"
          />
        </Field>
        <Field label="Sponsor / employer" hint="Only verified sponsors should be attached to a submission.">
          <select className="select" value={sponsorId} onChange={(event) => setSponsorId(event.target.value)}>
            <option value="">No sponsor</option>
            {sponsors.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {item.verificationStatus}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Purpose of travel">
          <textarea
            className="textarea"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="Short description"
          />
        </Field>
        <button
          className="btn block"
          disabled={!applicantId || loading}
          onClick={async () => {
            const result = await run();
            if (result) {
              toast.push('Case created.');
              onCreated();
              navigate({ to: '/cases/$id', params: { id: result.case.id } });
            } else {
              toast.push('Could not create the case.', 'error');
            }
          }}
        >
          {loading ? 'Creating…' : 'Create case'}
        </button>
      </div>
    </Sheet>
  );
}

export function CaseDetailRoute() {
  const { id } = useParams({ from: '/cases/$id' });
  const toast = useToast();
  const [tab, setTab] = useState<'workflow' | 'documents' | 'requirements'>('workflow');
  const detail = useApi<any>(`/api/cases/${id}`, [id]);
  const validity = useApi<any>(`/api/cases/${id}/passport-validity`, [id]);
  const requirements = useApi<any>(`/api/requirements?country=${detail.data?.case?.country ?? ''}`, [
    detail.data?.case?.country,
  ]);
  const documents = useApi<any>(`/api/documents?caseId=${id}`, [id]);
  const templates = useApi<{ templates: { key: string; label: string }[] }>('/api/documents/templates');
  const [generating, setGenerating] = useState<string | null>(null);

  const caseData = detail.data?.case;
  const steps = detail.data?.steps ?? [];
  const checks = detail.data?.checks ?? [];
  const applicant = detail.data?.applicant;
  const sponsor = detail.data?.sponsor;

  const requirementRows = useMemo(() => {
    const list = requirements.data?.requirements ?? [];
    return list.map((requirement: any) => {
      const check = checks.find((item: any) => item.requirementId === requirement.id);
      return { requirement, status: check?.status ?? 'missing' };
    });
  }, [requirements.data, checks]);

  const setStep = async (stepNumber: number, status: string) => {
    try {
      await api.post(`/api/cases/${id}/steps/${stepNumber}`, { status });
      await detail.reload();
      toast.push('Workflow updated.');
    } catch (error) {
      toast.push((error as Error).message, 'error');
    }
  };

  const generate = async (template: string) => {
    setGenerating(template);
    try {
      const result = await api.post<any>(`/api/cases/${id}/documents/generate`, { template });
      toast.push(`Generated ${result.documents.length} file(s).`);
      await documents.reload();
    } catch (error) {
      toast.push((error as Error).message, 'error');
    } finally {
      setGenerating(null);
    }
  };

  if (detail.loading) return <Loading />;
  if (!caseData) return <EmptyState title="Case not found" hint="This case reference does not exist." />;

  return (
    <div>
      <header className="page-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <div className="avatar" style={{ background: 'var(--blue)' }}>
              {initials(applicant?.fullName)}
            </div>
            <div>
              <h1 className="page-title" style={{ fontSize: 23 }}>
                {applicant?.fullName ?? 'Applicant'}
              </h1>
              <div className="page-sub">
                {caseData.reference} · {caseData.country} · {caseData.visaCategory}
              </div>
            </div>
          </div>
        </div>
        <Pill tone="blue">Step {caseData.currentStep}/10</Pill>
      </header>

      <div className="scroll-x mb">
        {(['workflow', 'documents', 'requirements'] as const).map((item) => (
          <button
            key={item}
            className="pill"
            onClick={() => setTab(item)}
            style={{
              border: 'none',
              cursor: 'pointer',
              background: tab === item ? 'var(--blue)' : 'rgba(16,21,31,.06)',
              color: tab === item ? '#fff' : 'var(--ink-2)',
            }}
          >
            {item === 'workflow' ? 'Workflow' : item === 'documents' ? 'Documents' : 'Requirements'}
          </button>
        ))}
      </div>

      {tab === 'workflow' && (
        <div className="stack">
          <Card glass>
            <div className="row-between mb">
              <div className="item-title">Passport validity</div>
              <StatusPill status={validity.data?.validity?.status ?? 'unknown'} />
            </div>
            <div className="small" style={{ lineHeight: 1.5 }}>
              {validity.data?.validity?.message ?? 'Not evaluated yet.'}
            </div>
            {validity.data?.validity?.ruleSource && (
              <div className="small muted mt">
                Rule: {validity.data.validity.requiredMonths} month(s) — {validity.data.validity.ruleSource}
                {validity.data.validity.ruleConfigured ? '' : ' (agency default, not a legal determination)'}
              </div>
            )}
          </Card>

          <div className="list">
            {WORKFLOW_STEPS.map((step) => {
              const record = steps.find((item: any) => item.stepNumber === step.n);
              const status = record?.status ?? 'pending';
              return (
                <div key={step.n} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div
                    className="avatar"
                    style={{
                      background:
                        status === 'completed'
                          ? 'var(--green-soft)'
                          : status === 'in_progress'
                            ? 'var(--blue-soft)'
                            : 'rgba(16,21,31,.06)',
                      color:
                        status === 'completed'
                          ? 'var(--green)'
                          : status === 'in_progress'
                            ? 'var(--blue-deep)'
                            : 'var(--ink-3)',
                      fontSize: 13,
                    }}
                  >
                    {step.n}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="item-title">{step.title}</div>
                    <div className="item-sub">{step.titleBn}</div>
                    <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
                      <StatusPill status={status} />
                      {status !== 'completed' && (
                        <button className="btn ghost small" onClick={() => void setStep(step.n, 'completed')}>
                          Mark done
                        </button>
                      )}
                      {status === 'completed' && (
                        <button className="btn ghost small" onClick={() => void setStep(step.n, 'in_progress')}>
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Link to="/browser" className="btn soft block" style={{ textDecoration: 'none' }}>
            <BrowserIcon size={17} /> Assisted portal submission
          </Link>
        </div>
      )}

      {tab === 'documents' && (
        <div className="stack">
          <SectionTitle>Generate case documents</SectionTitle>
          <div className="grid-2">
            {templates.data?.templates?.map((template) => (
              <button
                key={template.key}
                className="card tappable"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => void generate(template.key)}
                disabled={generating !== null}
              >
                <div className="item-title">{template.label}</div>
                <div className="item-sub">
                  {generating === template.key ? 'Generating…' : 'PDF + DOCX (marked as draft)'}
                </div>
              </button>
            ))}
          </div>

          <SectionTitle>Files on this case</SectionTitle>
          {documents.data?.documents?.length ? (
            <div className="list">
              {documents.data.documents.map((doc: any) => (
                <div key={doc.id} className="list-item">
                  <div className="avatar" style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}>
                    {doc.kind === 'generated' ? 'G' : 'F'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="item-title truncate">{doc.title || doc.filename}</div>
                    <div className="item-sub">
                      {doc.category} · {formatDate(doc.uploadedAt)}
                    </div>
                  </div>
                  <a className="btn ghost small" href={doc.downloadUrl} target="_blank" rel="noreferrer">
                    <DownloadIcon size={15} />
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No documents" hint="Upload files in the Documents tab of the app." />
          )}
        </div>
      )}

      {tab === 'requirements' && (
        <div className="stack">
          <div className="small muted">
            Requirements come from the versioned, source-linked database. Items marked “unverified” have no
            confirmation date and must be checked against the official source.
          </div>
          {requirementRows.length ? (
            <div className="list">
              {requirementRows.map(({ requirement, status }: any) => (
                <div key={requirement.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="item-title">{requirement.title}</div>
                    <div className="item-sub">
                      {requirement.category} · v{requirement.version} ·{' '}
                      {requirement.verifiedAt ? `verified ${formatDate(requirement.verifiedAt)}` : 'unverified'}
                    </div>
                    {requirement.sourceUrl && (
                      <a className="small" href={requirement.sourceUrl} target="_blank" rel="noreferrer">
                        {requirement.sourceUrl}
                      </a>
                    )}
                    <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
                      {(['available', 'missing', 'needs_review', 'expired', 'preparation_required'] as const).map(
                        (option) => (
                          <button
                            key={option}
                            className="btn ghost small"
                            style={
                              status === option
                                ? { background: 'var(--blue)', color: '#fff', borderColor: 'transparent' }
                                : undefined
                            }
                            onClick={async () => {
                              await api.put(`/api/cases/${id}/requirements/${requirement.id}`, { status: option });
                              await detail.reload();
                            }}
                          >
                            {option.replace(/_/g, ' ')}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                  <Pill tone={DOC_TONE[status] ?? ''}>{status.replace(/_/g, ' ')}</Pill>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No requirements stored" hint="Add source-linked requirements for this route." />
          )}
          <button className="btn ghost small" onClick={() => void requirements.reload()}>
            <RefreshIcon size={15} /> Refresh
          </button>
        </div>
      )}

      <SectionTitle>Applicant & sponsor</SectionTitle>
      <Card glass>
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Passport</dt>
          <dd>{applicant?.passportNumber ?? '—'}</dd>
          <dt>Nationality</dt>
          <dd>{applicant?.nationality ?? '—'}</dd>
          <dt>Date of birth</dt>
          <dd>{applicant?.dateOfBirth ?? '—'}</dd>
          <dt>Passport expiry</dt>
          <dd>{applicant?.passportExpiryDate ?? '—'}</dd>
          <dt>Sponsor</dt>
          <dd>{sponsor?.name ?? '—'}</dd>
          <dt>Sponsor status</dt>
          <dd>{sponsor?.verificationStatus ?? '—'}</dd>
          <dt>Created</dt>
          <dd>{formatDate(caseData.createdAt)}</dd>
        </dl>
      </Card>
    </div>
  );
}
