import { cn } from '@/shared/lib/cn'

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-[18px] bg-[linear-gradient(90deg,rgba(255,255,255,0.35),rgba(182,214,242,0.4),rgba(255,255,255,0.35))]', className)}
      {...props}
    />
  )
}

export { Skeleton }
