export function formatDate(value?: string | null, withTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function relativeTime(value?: string | null): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function bytes(size?: number | null): string {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export const STEP_TONE: Record<string, string> = {
  completed: 'green',
  in_progress: 'blue',
  waiting_approval: 'amber',
  blocked: 'red',
  pending: '',
  locked: '',
  skipped: '',
};

export const DOC_TONE: Record<string, string> = {
  available: 'green',
  missing: 'red',
  needs_review: 'amber',
  expired: 'red',
  preparation_required: 'violet',
};

export const SPONSOR_TONE: Record<string, string> = {
  verified: 'green',
  pending_verification: 'amber',
  unverified: '',
  inactive: '',
};

/** Minimal, dependency-free Markdown renderer for agent answers. */
export function renderMarkdown(markdown: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocks = markdown.split(/\n{2,}/);
  const html = blocks
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return `<ul>${lines
          .map((l) => `<li>${escape(l.replace(/^\s*[-*]\s+/, ''))}</li>`)
          .join('')}</ul>`;
      }
      if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
        return `<ul>${lines
          .map((l) => `<li>${escape(l.replace(/^\s*\d+\.\s+/, ''))}</li>`)
          .join('')}</ul>`;
      }
      let out = `<p>${lines.map(escape).join('<br/>')}</p>`;
      out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
      out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      out = out.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1<em>$2</em>');
      return out;
    })
    .join('');
  return html;
}
