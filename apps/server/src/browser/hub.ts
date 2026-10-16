import type { WebSocket } from 'ws';
import { newId } from '../lib/ids.js';
import { getDb } from '../db/index.js';
import { camelize, nowIso } from '../lib/rows.js';
import { recordAudit } from '../domain/audit.js';
import { redact } from './ssrf.js';
import type { WorkerCommand, WorkerEvent } from './protocol.js';

export interface WorkerState {
  id: string;
  label: string;
  connectedAt: string;
  lastSeenAt: string;
  playwrightVersion?: string;
}

export interface SessionRuntime {
  id: string;
  status: string;
  url?: string;
  title?: string;
  paused: boolean;
  viewport: 'desktop' | 'mobile';
  taskId?: string | null;
  lastScreenshot?: { data: string; width: number; height: number; ts: number };
  lastError?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  sessionId: string;
}

/**
 * Connects the server to the self-hosted browser worker and multiplexes
 * browser sessions, live preview frames and interactive commands.
 */
class WorkerHub {
  private workerSocket: WebSocket | null = null;
  private workerState: WorkerState | null = null;
  private sessions = new Map<string, SessionRuntime>();
  private subscribers = new Map<string, Set<WebSocket>>();
  private pending = new Map<string, PendingRequest>();

  get worker(): WorkerState | null {
    return this.workerState;
  }

  get connected(): boolean {
    return !!this.workerSocket && this.workerSocket.readyState === 1;
  }

  listSessions(): SessionRuntime[] {
    return [...this.sessions.values()];
  }

  getSession(id: string): SessionRuntime | undefined {
    return this.sessions.get(id);
  }

  attachWorker(socket: WebSocket, label: string): void {
    this.workerSocket = socket;
    const now = nowIso();
    this.workerState = { id: newId('wrk'), label, connectedAt: now, lastSeenAt: now };
    socket.on('message', (raw) => {
      this.workerState && (this.workerState.lastSeenAt = nowIso());
      let event: WorkerEvent;
      try {
        event = JSON.parse(String(raw));
      } catch {
        return;
      }
      void this.handleEvent(event);
    });
    socket.on('close', () => {
      this.workerSocket = null;
      this.workerState = null;
      for (const session of this.sessions.values()) {
        session.status = 'disconnected';
        this.broadcast(session.id, { type: 'session_state', sessionId: session.id, status: 'disconnected' });
      }
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Browser worker disconnected'));
      }
      this.pending.clear();
    });
    socket.on('error', () => {
      /* handled by close */
    });
  }

  private async handleEvent(event: WorkerEvent): Promise<void> {
    switch (event.type) {
      case 'ready': {
        if (this.workerState) {
          this.workerState.label = event.label || this.workerState.label;
          this.workerState.playwrightVersion = event.playwrightVersion;
        }
        return;
      }
      case 'session_state': {
        const session = this.sessions.get(event.sessionId);
        if (session) {
          session.status = event.status;
          session.url = event.url ?? session.url;
          session.title = event.title ?? session.title;
          session.paused = !!event.paused;
        }
        await this.persistState(event.sessionId, event);
        this.broadcast(event.sessionId, event);
        return;
      }
      case 'log': {
        await this.logEvent(event.sessionId, event.taskId, event.message, event.level, event.data);
        this.broadcast(event.sessionId ?? '*', event);
        return;
      }
      case 'screenshot': {
        const session = this.sessions.get(event.sessionId);
        if (session) {
          session.lastScreenshot = {
            data: event.data,
            width: event.width,
            height: event.height,
            ts: event.ts,
          };
          session.url = event.url ?? session.url;
          session.title = event.title ?? session.title;
        }
        this.broadcast(event.sessionId, event);
        return;
      }
      case 'action_result': {
        const pending = this.pending.get(event.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(event.requestId);
          if (event.ok) pending.resolve(event.result);
          else pending.reject(new Error(event.error ?? 'Browser action failed'));
        }
        this.broadcast(event.sessionId, event);
        return;
      }
      case 'task_result': {
        const session = this.sessions.get(event.sessionId);
        if (session) {
          session.taskId = null;
          session.status = event.status === 'cancelled' ? 'paused' : 'ready';
        }
        await this.logEvent(event.sessionId, event.taskId, `Task ${event.status}`, 'info', event.result ?? event.error);
        this.broadcast(event.sessionId, event);
        return;
      }
      case 'error': {
        if (event.sessionId) {
          const session = this.sessions.get(event.sessionId);
          if (session) {
            session.lastError = event.message;
            session.status = 'error';
          }
        }
        await this.logEvent(event.sessionId, event.taskId, event.message, 'error');
        this.broadcast(event.sessionId ?? '*', event);
        return;
      }
      case 'pong':
        return;
      default:
        return;
    }
  }

  subscribe(sessionId: string, socket: WebSocket): void {
    const set = this.subscribers.get(sessionId) ?? new Set<WebSocket>();
    set.add(socket);
    this.subscribers.set(sessionId, set);
    socket.on('close', () => {
      set.delete(socket);
      if (!set.size) this.subscribers.delete(sessionId);
    });
  }

  broadcast(sessionId: string, payload: unknown): void {
    const data = JSON.stringify(payload);
    const targets = this.subscribers.get(sessionId);
    targets?.forEach((socket) => {
      if (socket.readyState === 1) socket.send(data);
    });
    if (sessionId !== '*') {
      this.subscribers.get('*')?.forEach((socket) => {
        if (socket.readyState === 1) socket.send(data);
      });
    }
  }

  registerSession(id: string, viewport: 'desktop' | 'mobile', taskId?: string | null): SessionRuntime {
    const runtime: SessionRuntime = {
      id,
      status: 'starting',
      paused: false,
      viewport,
      taskId: taskId ?? null,
    };
    this.sessions.set(id, runtime);
    return runtime;
  }

  endSession(id: string): void {
    this.sessions.delete(id);
  }

  send(command: WorkerCommand): void {
    if (!this.workerSocket || this.workerSocket.readyState !== 1) {
      throw new Error('Browser worker is not connected');
    }
    this.workerSocket.send(JSON.stringify(command));
  }

  request(command: WorkerCommand & { requestId?: string }, timeoutMs = 30_000): Promise<unknown> {
    const requestId = command.requestId ?? newId('req');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Browser worker timed out'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, sessionId: (command as any).sessionId ?? 'unknown' });
      try {
        this.send({ ...command, requestId } as WorkerCommand);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(err as Error);
      }
    });
  }

  private async persistState(sessionId: string, event: Extract<WorkerEvent, { type: 'session_state' }>) {
    await getDb().run(
      `UPDATE browser_sessions SET status = ?, url = ?, title = ? WHERE id = ?`,
      [event.status, event.url ?? null, event.title ?? null, sessionId],
    );
  }

  async logEvent(
    sessionId: string | undefined,
    taskId: string | undefined,
    message: string,
    level = 'info',
    data?: unknown,
  ): Promise<void> {
    const db = getDb();
    await db.run(
      `INSERT INTO browser_task_events (id, session_id, task_id, type, message, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newId('bev'),
        sessionId ?? null,
        taskId ?? null,
        level,
        redact(message),
        data === undefined ? null : JSON.stringify(data).slice(0, 8000),
        nowIso(),
      ],
    );
  }
}

export const hub = new WorkerHub();
export { camelize };
