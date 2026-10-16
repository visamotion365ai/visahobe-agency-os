import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const HomeIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M3 10.2 12 3l9 7.2" />
    <path d="M5 9.6V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.6" />
  </svg>
);

export const AgentsIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    <path d="M18.5 5.2 20 4M5.5 5.2 4 4" />
  </svg>
);

export const ChatIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5a9.6 9.6 0 0 1-2.6-.35L4 20.5l1.3-3.6A6.2 6.2 0 0 1 4 12.5C4 8.9 7.6 6 12 6s8 2.9 8 6.5Z" />
  </svg>
);

export const CasesIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <rect x="3" y="6.5" width="18" height="13" rx="2.5" />
    <path d="M8.5 6.5V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3 12h18" />
  </svg>
);

export const DocsIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M6 3h7l5 5v13H6z" />
    <path d="M13 3v5h5M9 13h6M9 17h4" />
  </svg>
);

export const MoreIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" />
  </svg>
);

export const BrowserIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="M3 9h18M6.5 6.8h.01M9 6.8h.01" />
  </svg>
);

export const SponsorsIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M4 20v-1.5A4.5 4.5 0 0 1 8.5 14h7a4.5 4.5 0 0 1 4.5 4.5V20" />
    <circle cx="12" cy="8" r="3.6" />
  </svg>
);

export const GlobeIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.4 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.4-3.3-8.5S9.8 5.9 12 3.5Z" />
  </svg>
);

export const ReportsIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

export const PlugIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V9ZM12 17v4" />
  </svg>
);

export const SettingsIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" />
  </svg>
);

export const ShieldIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 3 5 6v5.5c0 4.2 2.9 7.6 7 8.5 4.1-.9 7-4.3 7-8.5V6l-7-3Z" />
    <path d="m9.2 12.1 2 2 3.6-3.9" />
  </svg>
);

export const SendIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M21 3 10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8 21 3Z" />
  </svg>
);

export const PlayIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M7 4.5 19 12 7 19.5v-15Z" />
  </svg>
);

export const PauseIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M9 4.5v15M15 4.5v15" />
  </svg>
);

export const StopIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </svg>
);

export const RefreshIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M20 11a8 8 0 1 0-1.2 5.3" />
    <path d="M20 4.5V11h-6" />
  </svg>
);

export const PlusIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const BackIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const UploadIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
  </svg>
);

export const DownloadIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 4v12M7.5 11.5 12 16l4.5-4.5M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
  </svg>
);

export const SearchIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);

export const CheckIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const WarningIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 4 2.8 20h18.4L12 4Z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
);

export const TrashIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </svg>
);

export const SkillsIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M12 3.5 13.9 9l5.6 1.9L13.9 13 12 18.5 10.1 13 4.5 11 10.1 9 12 3.5Z" />
    <path d="M18.5 4.5v3M20 6h-3M6.5 17v2.4M7.7 18.2H5.3" />
  </svg>
);

export const ExpandIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5" />
  </svg>
);

export const CollapseIcon = ({ size = 22, ...props }: IconProps) => (
  <svg {...base(size)} {...props}>
    <path d="M9 4v5H4M15 20v-5h5M15 4v5h5M9 20v-5H4" />
  </svg>
);
