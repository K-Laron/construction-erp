export function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div className={`h-4 bg-surface-800 rounded animate-pulse ${className}`} />
  );
}
