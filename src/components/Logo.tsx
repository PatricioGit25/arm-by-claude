export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-black tracking-tight ${className}`}>
      <span className="text-arm">A</span>RM
      <span className="ml-1.5 align-middle text-[0.45em] font-semibold uppercase tracking-widest text-mute">by Claude</span>
    </span>
  );
}
