import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useBlocker } from 'react-router-dom'
import { cn } from '@/shared/lib/cn'

type RouteTransitionVariant = 'public' | 'app'
type TransitionPhase = 'idle' | 'covering' | 'revealing'

type RouteTransitionProps = {
  pageKey: string
  children: ReactNode
  variant?: RouteTransitionVariant
  className?: string
}

type TransitionTiming = {
  coverMs: number
  revealMs: number
  contentDuration: number
  contentDelay: number
}

const EASE_EMPHATIC = [0.22, 1, 0.36, 1] as const
const EASE_RETREAT = [0.8, 0, 0.18, 1] as const

function TransitionVoyagerMark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="15 15 90 85"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M60 15L15 100H42L60 62L78 100H105L60 15Z"
        fill="currentColor"
        opacity="0.95"
      />
      <path
        d="M60 62L42 100H78L60 62Z"
        fill="currentColor"
        opacity="0.4"
      />
    </svg>
  )
}

function getTransitionTiming(variant: RouteTransitionVariant): TransitionTiming {
  if (variant === 'public') {
    return {
      coverMs: 420,
      revealMs: 760,
      contentDuration: 700,
      contentDelay: 120,
    }
  }

  return {
    coverMs: 300,
    revealMs: 520,
    contentDuration: 460,
    contentDelay: 70,
  }
}

function getContentMotion({
  direction,
  prefersReducedMotion,
  variant,
  timing,
}: {
  direction: number
  prefersReducedMotion: boolean
  variant: RouteTransitionVariant
  timing: TransitionTiming
}) {
  if (prefersReducedMotion) {
    return {
      initial: { opacity: 1 },
      animate: { opacity: 1 },
      transition: { duration: 0 },
    }
  }

  if (variant === 'public') {
    return {
      initial: {
        opacity: 0,
        y: direction > 0 ? 34 : -24,
        scale: 0.982,
        filter: 'blur(14px)',
      },
      animate: {
        opacity: 1,
        y: 0,
        scale: 1,
        filter: 'blur(0px)',
      },
      transition: {
        duration: timing.contentDuration / 1000,
        delay: timing.contentDelay / 1000,
        ease: EASE_EMPHATIC,
      },
    }
  }

  return {
    initial: {
      opacity: 0,
      y: direction > 0 ? 22 : -16,
      scale: 0.992,
      filter: 'blur(10px)',
    },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      filter: 'blur(0px)',
    },
    transition: {
      duration: timing.contentDuration / 1000,
      delay: timing.contentDelay / 1000,
      ease: EASE_EMPHATIC,
    },
  }
}

function RouteTransitionCurtain({
  direction,
  phase,
  timing,
  variant,
}: {
  direction: number
  phase: TransitionPhase
  timing: TransitionTiming
  variant: RouteTransitionVariant
}) {
  const isPublic = variant === 'public'
  const overlayPointerEventsClassName = phase === 'idle' ? 'pointer-events-none' : 'pointer-events-auto'
  const overlayClassName = isPublic
    ? cn(overlayPointerEventsClassName, 'fixed inset-0 z-[120] overflow-hidden')
    : cn(overlayPointerEventsClassName, 'absolute inset-0 z-20 overflow-hidden')
  const panelClassName = isPublic
    ? 'bg-[linear-gradient(180deg,rgba(226,238,248,0.95)_0%,rgba(246,249,252,0.98)_100%)] backdrop-blur-[18px]'
    : 'bg-[linear-gradient(180deg,rgba(242,245,248,0.96)_0%,rgba(255,255,255,0.98)_100%)] backdrop-blur-[14px]'
  const panelTransition = {
    duration: (phase === 'covering' ? timing.coverMs : timing.revealMs) / 1000,
    ease: phase === 'covering' ? EASE_EMPHATIC : EASE_RETREAT,
  }
  const topState = phase === 'covering' ? { y: '0%' } : { y: '-108%' }
  const bottomState = phase === 'covering' ? { y: '0%' } : { y: '108%' }
  const launchTransition = {
    duration: panelTransition.duration,
    ease: panelTransition.ease,
  }
  const diagonalAngle = direction > 0 ? 86.5 : -86.5
  const launchStart = direction > 0
    ? { left: '10%', top: '50.0%' }
    : { left: '90%', top: '44.7%' }
  const launchMid = direction > 0
    ? { left: '50%', top: '47.4%' }
    : { left: '50%', top: '47.4%' }
  const launchEnd = direction > 0
    ? { left: '90%', top: '44.7%' }
    : { left: '10%', top: '50.0%' }
  const launchState =
    phase === 'covering'
      ? { ...launchMid, opacity: 1 }
      : phase === 'revealing'
        ? { ...launchEnd, opacity: 0 }
        : { ...launchStart, opacity: 0 }

  return (
    <div className={overlayClassName} aria-hidden style={{ visibility: phase === 'idle' ? 'hidden' : 'visible' }}>
      <motion.div
        className={cn(
          'absolute inset-x-0 top-0 h-[56%] origin-top',
          '[clip-path:polygon(0_0,100%_0,100%_88%,0_100%)]',
          panelClassName,
        )}
        initial={false}
        animate={topState}
        transition={panelTransition}
      />

      <motion.div
        className={cn(
          'absolute inset-x-0 bottom-0 h-[56%] origin-bottom',
          '[clip-path:polygon(0_12%,100%_0,100%_100%,0_100%)]',
          panelClassName,
        )}
        initial={false}
        animate={bottomState}
        transition={panelTransition}
      />

      <motion.div
        className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
        initial={false}
        animate={launchState}
        transition={launchTransition}
        style={{ rotate: `${diagonalAngle}deg` }}
      >
        <div className="h-6 w-6">
          <TransitionVoyagerMark className="block h-full w-full text-[#1a1615]" />
        </div>
      </motion.div>
    </div>
  )
}

export function RouteTransition({
  pageKey,
  children,
  variant = 'app',
  className,
}: RouteTransitionProps) {
  const prefersReducedMotion = useReducedMotion() ?? false
  const timing = useMemo(() => getTransitionTiming(variant), [variant])
  const [phase, setPhase] = useState<TransitionPhase>('idle')
  const [transitionDirection, setTransitionDirection] = useState(1)
  const pendingDirectionRef = useRef(1)
  const blocker = useBlocker(({ currentLocation, nextLocation, historyAction }) => {
    const shouldBlock =
      !prefersReducedMotion &&
      phase === 'idle' &&
      currentLocation.pathname !== nextLocation.pathname

    if (shouldBlock) {
      pendingDirectionRef.current = historyAction === 'POP' ? -1 : 1
    }

    return shouldBlock
  })

  useEffect(() => {
    if (prefersReducedMotion) {
      if (blocker.state === 'blocked') {
        blocker.proceed()
      }
      setPhase('idle')
      return
    }

    if (blocker.state === 'blocked' && phase === 'idle') {
      setTransitionDirection(pendingDirectionRef.current)
      setPhase('covering')
    }
  }, [blocker.proceed, blocker.state, phase, prefersReducedMotion])

  useEffect(() => {
    if (phase !== 'covering' || blocker.state !== 'blocked') {
      return
    }

    const coverTimer = window.setTimeout(() => {
      blocker.proceed()
      setPhase('revealing')
    }, timing.coverMs)

    return () => {
      window.clearTimeout(coverTimer)
    }
  }, [blocker.proceed, blocker.state, phase, timing.coverMs])

  useEffect(() => {
    if (phase !== 'revealing') {
      return
    }

    const revealTimer = window.setTimeout(() => {
      setPhase('idle')
    }, timing.revealMs)

    return () => {
      window.clearTimeout(revealTimer)
    }
  }, [phase, timing.revealMs])

  const contentMotion = getContentMotion({
    direction: transitionDirection,
    prefersReducedMotion,
    variant,
    timing,
  })

  return (
    <div
      className={cn(
        'relative isolate',
        variant === 'public' ? 'min-h-[100dvh]' : 'min-h-full',
        className,
      )}
    >
      <motion.div
        key={pageKey}
        initial={contentMotion.initial}
        animate={contentMotion.animate}
        transition={contentMotion.transition}
        className={cn(
          'relative isolate',
          variant === 'public' ? 'min-h-[100dvh]' : 'min-h-full',
        )}
      >
        {children}
      </motion.div>

      {!prefersReducedMotion ? (
        <RouteTransitionCurtain
          direction={transitionDirection}
          phase={phase}
          timing={timing}
          variant={variant}
        />
      ) : null}
    </div>
  )
}
