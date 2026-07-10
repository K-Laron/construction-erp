export function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div className={`h-4 bg-surface-800 rounded animate-pulse ${className}`} />
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`p-5 rounded-2xl glass-panel-dense space-y-3 ${className}`}>
      <SkeletonLine className="w-1/3" />
      <SkeletonLine className="w-2/3" />
      <SkeletonLine className="w-1/2" />
    </div>
  );
}

export function SkeletonTable({ rows = 3, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="border border-surface-800 rounded-xl overflow-hidden bg-surface-950/40">
      <div className="bg-surface-900 border-b border-surface-800 p-3 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonLine key={i} className={`flex-1 ${i === 0 ? 'w-1/4' : ''}`} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="border-b border-surface-800 p-3 flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonLine key={c} className={`flex-1 ${c === 0 ? 'w-1/3' : ''}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
