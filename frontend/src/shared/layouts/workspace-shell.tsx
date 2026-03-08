import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

type WorkspacePageProps = {
  children: React.ReactNode
  className?: string
}

type WorkspaceHeaderProps = {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
  meta?: React.ReactNode
  className?: string
}

type WorkspaceStatCardProps = {
  label: string
  value: React.ReactNode
  detail?: React.ReactNode
  icon?: LucideIcon
  className?: string
}

export function WorkspacePage({ children, className }: WorkspacePageProps) {
  return <div className={cn('voyager-page flex flex-col gap-8', className)}>{children}</div>
}

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: WorkspaceHeaderProps) {
  return (
    <section className={cn('voyager-panel-strong voyager-noise overflow-hidden p-6 md:p-8', className)}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="flex flex-col gap-4">
          {eyebrow ? <span className="voyager-eyebrow w-fit">{eyebrow}</span> : null}
          <div className="flex flex-col gap-3">
            <h1 className="voyager-heading-lg max-w-3xl">{title}</h1>
            {description ? <p className="voyager-copy max-w-2xl">{description}</p> : null}
          </div>
          {meta ? <div className="flex flex-wrap gap-3">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3 lg:justify-end">{actions}</div> : null}
      </div>
    </section>
  )
}

export function WorkspaceStatGrid({ children, className }: WorkspacePageProps) {
  return <div className={cn('voyager-status-grid', className)}>{children}</div>
}

export function WorkspaceStatCard({
  label,
  value,
  detail,
  icon: Icon,
  className,
}: WorkspaceStatCardProps) {
  return (
    <div className={cn('voyager-status-card flex flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
          {label}
        </span>
        {Icon ? (
          <span className="flex size-9 items-center justify-center rounded-full bg-[rgba(114,174,230,0.14)] text-[var(--color-primary-foreground)]">
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
      <div className="text-2xl font-semibold tracking-[-0.04em] text-[var(--color-text)]">{value}</div>
      {detail ? <div className="text-sm text-[var(--color-text-muted)]">{detail}</div> : null}
    </div>
  )
}
