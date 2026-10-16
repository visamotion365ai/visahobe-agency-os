import { useRef, useState } from 'react';
import { api } from '../api';
import { useApi } from '../lib/useAsync';
import { Card, EmptyState, Field, Loading, Pill, SectionTitle, Sheet, useToast } from '../components/ui';
import { DownloadIcon, UploadIcon } from '../components/icons';
import { bytes, formatDate } from '../lib/format';

const CATEGORIES = [
  'passport',
  'photo',
  'cv',
  'education',
  'employment',
  'sponsorship',
  'police_clearance',
  'medical',
  'travel',
  'financial',
  'generated',
  'other',
];

export function DocumentsRoute() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [caseId, setCaseId] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [ocrDoc, setOcrDoc] = useState<any>(null);
  const [ocrFields, setOcrFields] = useState<any>({});
  const [busy, setBusy] = useState(false);

  const cases = useApi<{ items: any[] }>('/api/cases?pageSize=50');
  const documents = useApi<{ documents: any[] }>(
    `/api/documents?pageSize=100${query ? `&q=${encodeURIComponent(query)}` : ''}${category ? `&category=${category}` : ''}${caseId ? `&caseId=${caseId}` : ''}`,
    [query, category, caseId],
  );

  const runOcr = async (document: any) => {
    setBusy(true);
    try {
      const result = await api.post<any>(`/api/documents/${document.id}/ocr`);
      setOcrDoc(document);
      setOcrFields(result.ocr?.fields ?? {});
      await documents.reload();
      toast.push('OCR finished. Confirm the extracted values before saving.');
    } catch (error) {
      toast.push((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Document vault</h1>
          <div className="page-sub">Private per-applicant storage. Files are never exposed through public URLs.</div>
        </div>
        <button className="btn small" onClick={() => setUploadOpen(true)}>
          <UploadIcon size={16} /> Upload
        </button>
      </header>

      <div className="row mb" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ flex: '1 1 180px' }}
          placeholder="Search file name or OCR text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select className="select" style={{ width: 150 }} value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 190 }} value={caseId} onChange={(event) => setCaseId(event.target.value)}>
          <option value="">All cases</option>
          {cases.data?.items?.map((item: any) => (
            <option key={item.id} value={item.id}>
              {item.reference}
            </option>
          ))}
        </select>
      </div>

      {documents.loading ? (
        <Loading />
      ) : documents.data?.documents?.length ? (
        <div className="list">
          {documents.data.documents.map((doc: any) => (
            <div key={doc.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <div className="avatar" style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}>
                {doc.kind === 'generated' ? 'G' : 'F'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="item-title truncate">{doc.title || doc.filename}</div>
                <div className="item-sub">
                  {doc.category} · {bytes(doc.size)} · {formatDate(doc.uploadedAt)}
                </div>
                <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <Pill tone={doc.ocrStatus === 'done' ? 'green' : doc.ocrStatus === 'failed' ? 'red' : ''}>
                    OCR {doc.ocrStatus}
                  </Pill>
                  <Pill>{doc.kind}</Pill>
                </div>
                <div className="row" style={{ gap: 6, marginTop: 8 }}>
                  <a className="btn ghost small" href={doc.downloadUrl} target="_blank" rel="noreferrer">
                    <DownloadIcon size={15} /> Download
                  </a>
                  {doc.kind === 'uploaded' && (
                    <button className="btn ghost small" disabled={busy} onClick={() => void runOcr(doc)}>
                      Run OCR
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No documents" hint="Upload passports, photos and supporting evidence to build the case file." />
      )}

      <UploadSheet
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        cases={cases.data?.items ?? []}
        onDone={() => {
          setUploadOpen(false);
          void documents.reload();
        }}
      />

      <Sheet open={!!ocrDoc} onClose={() => setOcrDoc(null)} title="Confirm extracted data">
        <div className="small muted" style={{ marginBottom: 12 }}>
          OCR output is a suggestion. Correct the values, then apply them to the applicant record.
        </div>
        <div className="stack">
          {['fullName', 'passportNumber', 'nationality', 'dateOfBirth', 'gender', 'passportIssueDate', 'passportExpiryDate'].map(
            (field) => (
              <Field key={field} label={field}>
                <input
                  className="input"
                  value={ocrFields[field] ?? ''}
                  onChange={(event) => setOcrFields({ ...ocrFields, [field]: event.target.value })}
                />
              </Field>
            ),
          )}
          <button
            className="btn block"
            onClick={async () => {
              try {
                await api.post(`/api/documents/${ocrDoc.id}/apply-fields`, ocrFields);
                toast.push('Applicant record updated.');
                setOcrDoc(null);
              } catch (error) {
                toast.push((error as Error).message, 'error');
              }
            }}
          >
            Apply to applicant
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function UploadSheet({
  open,
  onClose,
  cases,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  cases: any[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('passport');
  const [caseId, setCaseId] = useState('');
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('category', category);
      if (caseId) form.append('caseId', caseId);
      await api.upload('/api/documents', form);
      toast.push('File uploaded to the private vault.');
      setFile(null);
      onDone();
    } catch (error) {
      toast.push((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Upload document">
      <div className="stack">
        <Field label="File" hint="PDF, DOCX, JPG, PNG, TIFF or TXT. Up to 25 MB.">
          <input
            className="input"
            type="file"
            accept=".pdf,.docx,.jpg,.jpeg,.png,.tif,.tiff,.txt"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Category">
          <select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>
            {CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Link to case">
          <select className="select" value={caseId} onChange={(event) => setCaseId(event.target.value)}>
            <option value="">No case</option>
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.reference} — {item.applicantName}
              </option>
            ))}
          </select>
        </Field>
        <button className="btn block" disabled={!file || busy} onClick={() => void upload()}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </div>
    </Sheet>
  );
}
