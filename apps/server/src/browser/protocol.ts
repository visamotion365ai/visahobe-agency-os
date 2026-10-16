/** Wire protocol between the VisaHOBe server and the self-hosted browser worker. */

export type WorkerCommand =
  | { type: 'create_session'; sessionId: string; viewport: 'desktop' | 'mobile'; url?: string; allowDomains?: string[] }
  | { type: 'close_session'; sessionId: string }
  | { type: 'navigate'; sessionId: string; url: string; requestId: string; allowDomains?: string[] }
  | {
      type: 'action';
      sessionId: string;
      requestId: string;
      action: BrowserAction;
    }
  | { type: 'run_task'; sessionId: string; taskId: string; steps: BrowserStep[] }
  | { type: 'pause'; sessionId: string }
  | { type: 'resume'; sessionId: string }
  | { type: 'set_viewport'; sessionId: string; viewport: 'desktop' | 'mobile' }
  | { type: 'screenshot_request'; sessionId: string; requestId: string; quality?: number }
  | { type: 'ping' };

export type BrowserAction =
  | { kind: 'click'; selector?: string; text?: string; x?: number; y?: number }
  | { kind: 'scroll'; deltaY?: number; x?: number; y?: number }
  | { kind: 'type'; text: string; selector?: string }
  | { kind: 'fill'; selector?: string; label?: string; name?: string; value: string }
  | { kind: 'select'; selector?: string; label?: string; name?: string; value: string }
  | { kind: 'press'; key: string }
  | { kind: 'screenshot' }
  | { kind: 'refresh' }
  | { kind: 'back' }
  | { kind: 'forward' }
  | { kind: 'extract'; selector?: string; schema?: string }
  | { kind: 'wait'; ms: number };

export interface BrowserStep {
  kind: 'navigate' | 'action' | 'wait' | 'screenshot' | 'extract';
  url?: string;
  action?: BrowserAction;
  ms?: number;
  selector?: string;
  schema?: string;
  note?: string;
}

export type WorkerEvent =
  | { type: 'ready'; workerId: string; label: string; playwrightVersion?: string }
  | { type: 'pong' }
  | {
      type: 'session_state';
      sessionId: string;
      status: string;
      url?: string;
      title?: string;
      paused?: boolean;
    }
  | { type: 'log'; sessionId?: string; taskId?: string; level: string; message: string; data?: unknown }
  | {
      type: 'screenshot';
      sessionId: string;
      taskId?: string;
      data: string;
      width: number;
      height: number;
      url?: string;
      title?: string;
      ts: number;
    }
  | { type: 'action_result'; sessionId: string; taskId?: string; requestId: string; ok: boolean; result?: unknown; error?: string }
  | { type: 'task_result'; sessionId: string; taskId: string; status: 'completed' | 'failed' | 'cancelled'; result?: unknown; error?: string }
  | { type: 'error'; sessionId?: string; taskId?: string; message: string };
