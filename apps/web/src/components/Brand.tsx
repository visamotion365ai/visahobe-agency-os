/**
 * VisaHOBe brand mark — the watchful eye with an approval tick.
 *
 * Rendered inline so it inherits the exact gradient and never depends on a
 * network fetch; the same artwork is shipped as /icons/logo.svg for the PWA.
 */
export function BrandMark({ size = 36, rounded = true }: { size?: number; rounded?: boolean }) {
  const id = `vhm-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="VisaHOBe"
      style={{ flex: 'none', display: 'block' }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5b4dff" />
          <stop offset="55%" stopColor="#2f6bff" />
          <stop offset="100%" stopColor="#0b8f9e" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={rounded ? 16 : 0} fill={`url(#${id})`} />
      <path
        d="M32 20c-8.4 0-15.2 5.2-18.6 11.1a2 2 0 0 0 0 1.8C16.8 38.8 23.6 44 32 44s15.2-5.2 18.6-11.1a2 2 0 0 0 0-1.8C47.2 25.2 40.4 20 32 20Z"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.1"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="32" r="6.6" fill="#e9f0ff" />
      <circle cx="32" cy="32" r="3" fill="#16203a" />
      <circle cx="34.2" cy="29.6" r="1.3" fill="#ffffff" />
      <path
        d="M22.5 47.5l3.6 3.6 7-7.6"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.92"
      />
    </svg>
  );
}

/** The wordmark lockup: mark + "VisaHOBe" + the AGENCY OS descriptor. */
export function BrandLockup({ size = 38 }: { size?: number }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <BrandMark size={size} />
      <div>
        <div className="brand-word">VisaHOBe</div>
        <div className="brand-sub">Agency OS</div>
      </div>
    </div>
  );
}
