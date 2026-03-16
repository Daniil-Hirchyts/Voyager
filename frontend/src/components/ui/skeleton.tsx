import { cn } from '@/shared/lib/cn';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-[20px] bg-[linear-gradient(90deg,rgba(240,240,240,0.4),rgba(230,230,230,0.6),rgba(240,240,240,0.4))]',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
