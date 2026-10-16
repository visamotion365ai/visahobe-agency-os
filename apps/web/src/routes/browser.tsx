import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getWsToken } from '../api';
import { useApi } from '../lib/useAsync';
import { Card, EmptyState, Loading, Pill, SectionTitle, useToast } from '../components/ui';
import { BrowserIcon, BackIcon, ExpandIcon, PauseIcon, PlayIcon, RefreshIcon, StopIcon } from '../components/icons';

interface LogLine {
  id: string;
  level: string;
  message: string;
  at: string;
}

interface Frame {
  data: string;
  width: number;
  height: number;
  url?: string;
  title?: string;
  ts: number;
}

export function BrowserRoute() {
  const toast = useToast();
  const status = useApi<any>('/api/browser/status');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [pageUrl, setPageUrl] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [sessionStatus, setSessionStatus] = useState('idle');
  const [paused, setPaused] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [url, setUrl] = useState('');
  const [instruction, setInstruction] = useState('');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [quality, setQuality] = useState(70);
  const [interval, setIntervalMs] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [typeText, setTypeText] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fullImageRef = useRef<HTMLImageElement | null>(null);

  const workerConnected = status.data?.worker?.connected === true;

  useEffect(() => {
    const timer = setInterval(() => void status.reload(), 6000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt a session that already exists on the server (for example one started
  // from another device) so the live preview connects to the real browser
  // instead of pretending the viewport is empty.
  useEffect(() => {
    if (sessionId) return;
    const sessions = status.data?.sessions as any[] | undefined;
    if (!sessions?.length) return;
    const latest = [...sessions]
      .filter((session) => session.status !== 'stopped' && session.status !== 'closed')
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0];
    if (latest) {
      setSessionId(latest.id);
      if (latest.url) setPageUrl(latest.url);
      if (latest.title) setPageTitle(latest.title);
      setSessionStatus(latest.status ?? 'ready');
    }
  }, [status.data, sessionId]);

  const connectStream = useCallback(async (id: string) => {
    try {
      const token = await getWsToken();
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(
        `${protocol}://${window.location.host}/api/browser/stream?sessionId=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`,
      );
      socketRef.current = socket;
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string);
        if (message.type === 'screenshot') {
          setFrame({
            data: message.data,
            width: message.width,
            height: message.height,
            url: message.url,
            title: message.title,
            ts: message.ts,
          });
          if (message.url) setPageUrl(message.url);
          if (message.title !== undefined) setPageTitle(message.title ?? '');
        } else if (message.type === 'session_state') {
          setSessionStatus(message.status);
          setPaused(Boolean(message.paused));
          if (message.url) setPageUrl(message.url);
          if (message.title !== undefined) setPageTitle(message.title ?? '');
        } else if (message.type === 'log') {
          setLogs((current) =>
            [
              ...current,
              { id: `${Date.now()}-${current.length}`, level: message.level ?? 'info', message: message.message, at: new Date().toISOString() },
            ].slice(-200),
          );
        } else if (message.type === 'task_result') {
          setLogs((current) => [
            ...current,
            {
              id: `${Date.now()}-${current.length}`,
              level: message.status === 'completed' ? 'info' : 'error',
              message: `Task ${message.status}${message.error ? `: ${message.error}` : ''}`,
              at: new Date().toISOString(),
            },
          ]);
        }
      };
      socket.onclose = () => {
        socketRef.current = null;
      };
    } catch (error) {
      toast.push(`Could not open the preview stream: ${(error as Error).message}`, 'error');
    }
  }, [toast]);

  useEffect(() => {
    if (sessionId) void connectStream(sessionId);
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [sessionId, connectStream]);

  const createSession = async () => {
    setBusy(true);
    try {
      const result = await api.post<any>('/api/browser/sessions', { label: 'Session', viewport });
      setSessionId(result.session.id);
      setLogs([]);
      await status.reload();
      toast.push('Browser session started.');
    } catch (error) {
      toast.push((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const stopSession = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await api.post(`/api/browser/sessions/${sessionId}/stop`);
      setSessionId(null);
      setFrame(null);
      setSessionStatus('stopped');
      await status.reload();
      toast.push('Browser session stopped.');
    } catch (error) {
      toast.push((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const navigate = async () => {
    if (!sessionId || !url) return;
    setBusy(true);
    try {
      await api.post(`/api/browser/sessions/${sessionId}/navigate`, { url });
      setHistory((current) => [url, ...current.filter((item) => item !== url)].slice(0, 20));
      toast.push('Navigation completed.');
    } catch (error) {
      toast.push((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const runTask = async () => {
    if (!instruction) return;
    setBusy(true);
    try {
      const result = await api.post<any>('/api/browser/tasks', {
        sessionId: sessionId ?? undefined,
        instruction,
        viewport,
        mode: paused ? 'human_takeover' : 'assisted',
      });
      if (result.sessionId && result.sessionId !== sessionId) {
        setSessionId(result.sessionId);
      }
      setLogs((current) => [
        ...current,
        {
          id: `${Date.now()}-plan`,
          level: 'info',
          message: `Planned ${result.steps.length} step(s) with ${result.planner}`,
          at: new Date().toISOString(),
        },
      ]);
      toast.push('Task started.');
    } catch (error) {
      toast.push((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendAction = async (action: any) => {
    if (!sessionId) return;
    try {
      await api.post(`/api/browser/sessions/${sessionId}/actions`, { action });
    } catch (error) {
      toast.push((error as Error).message, 'error');
    }
  };

  const handleImageClick = async (
    event: React.MouseEvent<HTMLImageElement>,
    ref: React.RefObject<HTMLImageElement | null> = imageRef,
  ) => {
    const image = ref.current;
    if (!image || !frame) return;
    const rect = image.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * frame.width;
    const y = ((event.clientY - rect.top) / rect.height) * frame.height;
    await sendAction({ kind: 'click', x: Math.round(x), y: Math.round(y) });
  };

  const handleWheel = async (event: React.WheelEvent<HTMLImageElement>) => {
    await sendAction({ kind: 'scroll', deltaY: event.deltaY });
  };

  const typeIntoPage = async () => {
    if (!typeText) return;
    await sendAction({ kind: 'type', text: typeText });
    setTypeText('');
  };

  const pressKey = async (key: string) => {
    await sendAction({ kind: 'press', key });
  };

  const togglePause = async () => {
    if (!sessionId) return;
    const next = !paused;
    try {
      await api.post(`/api/browser/sessions/${sessionId}/${next ? 'pause' : 'resume'}`);
      setPaused(next);
      toast.push(next ? 'Human takeover: session paused.' : 'Session resumed.');
    } catch (error) {
      toast.push((error as Error).message, 'error');
    }
  };

  const requestScreenshot = async () => {
    if (!sessionId) return;
    try {
      await api.post(`/api/browser/sessions/${sessionId}/screenshot`, { quality });
    } catch (error) {
      toast.push((error as Error).message, 'error');
    }
  };

  const changeViewport = async (next: 'desktop' | 'mobile') => {
    setViewport(next);
    if (sessionId) {
      try {
        await api.post(`/api/browser/sessions/${sessionId}/viewport`, { viewport: next });
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div>
      <header className="page-head">
        <div>
          <h1 className="page-title">Browser automation</h1>
          <div className="page-sub">
            A self-hosted Playwright worker drives a real Chromium instance. The PWA is the remote control.
          </div>
        </div>
        <Pill tone={workerConnected ? 'green' : 'red'} dot>
          {workerConnected ? 'worker online' : 'worker offline'}
        </Pill>
      </header>

      {!workerConnected && (
        <Card glass style={{ marginBottom: 14, background: 'var(--amber-soft)', borderColor: 'rgba(178,106,0,.25)' }}>
          <div className="item-title">No browser worker is connected</div>
          <div className="small" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Start the self-hosted worker on the machine that should run the browser:
            <code className="mono" style={{ display: 'block', marginTop: 6 }}>
              npm run dev -w @visahobe/browser-worker
            </code>
            The preview stays offline until the worker authenticates with the shared worker token.
          </div>
        </Card>
      )}

      <div className="row mb" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn small" disabled={!workerConnected || busy} onClick={() => void createSession()}>
          <PlayIcon size={15} /> Start browser
        </button>
        <button className="btn ghost small" disabled={!sessionId || busy} onClick={() => void stopSession()}>
          <StopIcon size={15} /> Stop browser
        </button>
        <button className="btn ghost small" disabled={!sessionId} onClick={() => void requestScreenshot()}>
          <RefreshIcon size={15} /> Screenshot
        </button>
        <button className="btn ghost small" disabled={!sessionId} onClick={() => void togglePause()}>
          {paused ? <PlayIcon size={15} /> : <PauseIcon size={15} />} {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          className="btn ghost small"
          disabled={!frame}
          onClick={() => setFullscreen(true)}
        >
          <ExpandIcon size={15} /> Full screen
        </button>
        <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
          <button
            className="pill"
            style={{ border: 'none', cursor: 'pointer', background: viewport === 'desktop' ? 'var(--blue)' : 'rgba(16,21,31,.06)', color: viewport === 'desktop' ? '#fff' : 'var(--ink-2)' }}
            onClick={() => void changeViewport('desktop')}
          >
            Desktop
          </button>
          <button
            className="pill"
            style={{ border: 'none', cursor: 'pointer', background: viewport === 'mobile' ? 'var(--blue)' : 'rgba(16,21,31,.06)', color: viewport === 'mobile' ? '#fff' : 'var(--ink-2)' }}
            onClick={() => void changeViewport('mobile')}
          >
            Mobile
          </button>
        </div>
      </div>

      <div className="browser-frame">
        <div className="browser-chrome">
          <BrowserIcon size={15} />
          <span className="browser-url">{pageUrl || 'No page loaded'}</span>
          <Pill tone={sessionStatus === 'ready' ? 'green' : sessionStatus === 'busy' ? 'blue' : ''} dot>
            {paused ? 'paused' : sessionStatus}
          </Pill>
        </div>
        {frame ? (
          <img
            ref={imageRef}
            src={`data:image/jpeg;base64,${frame.data}`}
            alt="Live browser preview"
            onClick={(event) => void handleImageClick(event)}
            onWheel={(event) => void handleWheel(event)}
            style={{ cursor: paused ? 'pointer' : 'not-allowed' }}
          />
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,.65)' }}>
            {sessionId ? 'Waiting for the first frame…' : 'Start the browser to see the live preview here.'}
          </div>
        )}
      </div>

      {pageTitle && <div className="small muted mt">{pageTitle}</div>}

      {fullscreen && (
        <div className="browser-full">
          <div className="browser-full-bar">
            <button className="btn on-dark small" onClick={() => setFullscreen(false)}>
              <BackIcon size={15} /> Exit
            </button>
            <BrowserIcon size={15} />
            <span className="browser-url truncate">{pageUrl || 'No page loaded'}</span>
            <Pill tone={paused ? 'amber' : sessionStatus === 'ready' ? 'green' : 'blue'} dot>
              {paused ? 'paused' : sessionStatus}
            </Pill>
          </div>
          <div className="browser-cut">
            {frame ? (
              <img
                ref={fullImageRef}
                src={`data:image/jpeg;base64,${frame.data}`}
                alt="Live browser preview"
                onClick={(event) => void handleImageClick(event, fullImageRef)}
                style={{ cursor: paused ? 'pointer' : 'default' }}
              />
            ) : (
              <div style={{ color: 'rgba(255,255,255,.7)', padding: 40 }}>Waiting for a frame…</div>
            )}
          </div>
          <div className="browser-actions">
            <button className="btn on-dark small" onClick={() => void sendAction({ kind: 'back' })}>
              Back
            </button>
            <button className="btn on-dark small" onClick={() => void sendAction({ kind: 'forward' })}>
              Forward
            </button>
            <button className="btn on-dark small" onClick={() => void sendAction({ kind: 'refresh' })}>
              Reload
            </button>
            <button className="btn on-dark small" onClick={() => void sendAction({ kind: 'scroll', deltaY: -500 })}>
              ↑
            </button>
            <button className="btn on-dark small" onClick={() => void sendAction({ kind: 'scroll', deltaY: 500 })}>
              ↓
            </button>
            <input
              className="type-input"
              placeholder="Type into the focused field…"
              value={typeText}
              onChange={(event) => setTypeText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void typeIntoPage();
              }}
            />
            <button className="btn on-dark small primary" disabled={!typeText} onClick={() => void typeIntoPage()}>
              Type
            </button>
            <button className="btn on-dark small" onClick={() => void pressKey('Enter')}>
              ⏎
            </button>
            <button className="btn on-dark small" onClick={() => void pressKey('Tab')}>
              Tab
            </button>
            <button className="btn on-dark small" onClick={() => void togglePause()}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
      )}

      <SectionTitle>Navigate</SectionTitle>
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input"
          placeholder="https://official-portal.example/apply"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
        />
        <button className="btn" disabled={!sessionId || !url || busy} onClick={() => void navigate()}>
          Go
        </button>
      </div>
      <div className="small muted mt">
        Only http/https destinations are allowed. Private, loopback and cloud-metadata addresses are refused
        unless the operator allow-lists them.
      </div>

      <SectionTitle>Task instruction</SectionTitle>
      <textarea
        className="textarea"
        placeholder="e.g. open the local test portal, fill the full name field with Ayesha Rahman and take a screenshot"
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
      />
      <div className="row mt" style={{ gap: 8 }}>
        <button className="btn" disabled={!workerConnected || !instruction || busy} onClick={() => void runTask()}>
          Run task
        </button>
        <button className="btn ghost" disabled={!sessionId} onClick={() => void togglePause()}>
          {paused ? 'Resume' : 'Pause (human takeover)'}
        </button>
      </div>
      <div className="small muted mt">
        In takeover mode the agent pauses so a human can complete 2FA or CAPTCHA by hand. The agent never
        bypasses challenges, and it never submits a form without an explicit confirmation.
      </div>

      <SectionTitle>Remote control</SectionTitle>
      <Card glass>
        <div className="small muted" style={{ marginBottom: 10 }}>
          Click the preview to click the page. Scrolling and typing are mapped to the live browser session.
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost small" disabled={!sessionId} onClick={() => void sendAction({ kind: 'scroll', deltaY: -500 })}>
            Scroll up
          </button>
          <button className="btn ghost small" disabled={!sessionId} onClick={() => void sendAction({ kind: 'scroll', deltaY: 500 })}>
            Scroll down
          </button>
          <button className="btn ghost small" disabled={!sessionId} onClick={() => void sendAction({ kind: 'back' })}>
            Back
          </button>
          <button className="btn ghost small" disabled={!sessionId} onClick={() => void sendAction({ kind: 'forward' })}>
            Forward
          </button>
          <button className="btn ghost small" disabled={!sessionId} onClick={() => void sendAction({ kind: 'refresh' })}>
            Reload
          </button>
        </div>
      </Card>

      <SectionTitle>Execution log</SectionTitle>
      {logs.length ? (
        <div className="stack" style={{ gap: 6, maxHeight: 320, overflowY: 'auto' }}>
          {logs
            .slice()
            .reverse()
            .map((line) => (
              <div key={line.id} className={`log-line ${line.level}`}>
                {line.message}
              </div>
            ))}
        </div>
      ) : (
        <EmptyState title="No activity yet" hint="Browser actions and errors appear here as they happen." />
      )}

      <SectionTitle>Navigation history</SectionTitle>
      {history.length ? (
        <div className="list">
          {history.map((item) => (
            <button
              key={item}
              className="list-item"
              style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => {
                setUrl(item);
                void navigate();
              }}
            >
              <span className="mono truncate">{item}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="small muted">No navigation recorded in this session.</div>
      )}

      <SectionTitle>Preview settings</SectionTitle>
      <Card glass>
        <label className="field">
          <span className="label">Screenshot quality ({quality})</span>
          <input
            type="range"
            min={30}
            max={95}
            value={quality}
            onChange={(event) => setQuality(Number(event.target.value))}
          />
        </label>
        <label className="field mt">
          <span className="label">Preview refresh interval ({interval} ms)</span>
          <input
            type="range"
            min={250}
            max={3000}
            step={250}
            value={interval}
            onChange={(event) => setIntervalMs(Number(event.target.value))}
          />
        </label>
        <div className="hint mt">
          The refresh rate is applied by the worker (PREVIEW_INTERVAL_MS). Screenshots are streamed over an
          authenticated WebSocket — this is a frame-based preview, not a full remote desktop.
        </div>
      </Card>
    </div>
  );
}
