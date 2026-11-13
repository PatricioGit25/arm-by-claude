export function Logo({ className = "", withBy = true }: { className?: string; withBy?: boolean }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 font-semibold tracking-tight ${className}`}>
      <span className="inline-flex items-center gap-1.5">
        <svg viewBox="0 0 24 24" aria-hidden className="h-[1.05em] w-[1.05em] text-arm" fill="none">
          <path d="M3 19 L12 5 L21 19" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7.5 14 H16.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        ARM
      </span>
      {withBy && <span className="text-[0.5em] font-medium uppercase tracking-[0.18em] text-mute">by VistaAlta</span>}
    </span>
  );
}
