'use client'

import type { ReactNode } from 'react'
import { SlidingNumber } from '@/components/ui/sliding-number'
import { cn } from '@/shared/lib/cn'

interface AnimatedNumberProps {
  value: number | null | undefined
  className?: string
  fallback?: ReactNode
  locale?: string
  formatOptions?: Intl.NumberFormatOptions
}

interface AnimatedMoneyProps
  extends Omit<AnimatedNumberProps, 'formatOptions'> {
  currency?: string | null
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}

function buildFormatter(
  locale: string | undefined,
  formatOptions: Intl.NumberFormatOptions | undefined,
) {
  try {
    return new Intl.NumberFormat(locale, {
      numberingSystem: 'latn',
      ...formatOptions,
    })
  } catch {
    return new Intl.NumberFormat(locale, { numberingSystem: 'latn' })
  }
}

export function AnimatedNumber({
  value,
  className,
  fallback = null,
  locale,
  formatOptions,
}: AnimatedNumberProps) {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback ? <>{fallback}</> : null
  }

  const formatter = buildFormatter(locale, formatOptions)
  const parts = formatter.formatToParts(value)
  const accessibleText = formatter.format(value)

  return (
    <span className={cn('inline-flex items-baseline tabular-nums', className)}>
      <span className="sr-only">{accessibleText}</span>
      <span aria-hidden="true" className="inline-flex items-baseline">
        {parts.map((part, index) => {
          if (part.type === 'integer' || part.type === 'fraction') {
            return (
              <SlidingNumber
                key={`${part.type}-${index}`}
                value={Number.parseInt(part.value, 10)}
                minimumDigits={part.value.length}
              />
            )
          }

          return <span key={`${part.type}-${index}`}>{part.value}</span>
        })}
      </span>
    </span>
  )
}

export function AnimatedMoney({
  value,
  currency,
  minimumFractionDigits = 0,
  maximumFractionDigits = 0,
  ...props
}: AnimatedMoneyProps) {
  return (
    <AnimatedNumber
      {...props}
      value={value}
      formatOptions={
        currency
          ? {
              style: 'currency',
              currency,
              minimumFractionDigits,
              maximumFractionDigits,
            }
          : {
              minimumFractionDigits,
              maximumFractionDigits,
            }
      }
    />
  )
}
