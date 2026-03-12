'use client'

import { createElement, type CSSProperties, type JSX } from 'react'
import { motion, type Transition } from 'motion/react'
import { cn } from '@/shared/lib/cn'

export type TextShimmerWaveProps = {
  children: string
  as?: keyof JSX.IntrinsicElements
  className?: string
  duration?: number
  zDistance?: number
  xDistance?: number
  yDistance?: number
  spread?: number
  scaleDistance?: number
  rotateYDistance?: number
  transition?: Transition
}

export function TextShimmerWave({
  children,
  as: Component = 'p',
  className,
  duration = 1,
  zDistance = 10,
  xDistance = 2,
  yDistance = -2,
  spread = 1,
  scaleDistance = 1.1,
  rotateYDistance = 10,
  transition,
}: TextShimmerWaveProps) {
  const text = children ?? ''
  const charCount = Math.max(text.length, 1)

  return createElement(
    Component,
    {
      className: cn(
        'relative inline-block [perspective:500px]',
        '[--base-color:#a1a1aa] [--base-gradient-color:#000]',
        'dark:[--base-color:#71717a] dark:[--base-gradient-color:#ffffff]',
        className,
      ),
      style: { color: 'var(--base-color)' } as CSSProperties,
    },
    text.split('').map((char, index) => {
      const delay = (index * duration * (1 / spread)) / charCount

      return (
        <motion.span
          key={`${char}-${index}`}
          className="inline-block whitespace-pre [transform-style:preserve-3d]"
          initial={{
            translateZ: 0,
            scale: 1,
            rotateY: 0,
            color: 'var(--base-color)',
          }}
          animate={{
            translateZ: [0, zDistance, 0],
            translateX: [0, xDistance, 0],
            translateY: [0, yDistance, 0],
            scale: [1, scaleDistance, 1],
            rotateY: [0, rotateYDistance, 0],
            color: [
              'var(--base-color)',
              'var(--base-gradient-color)',
              'var(--base-color)',
            ],
          }}
          transition={{
            duration,
            repeat: Infinity,
            repeatDelay: (charCount * 0.05) / spread,
            delay,
            ease: 'easeInOut',
            ...transition,
          }}
        >
          {char}
        </motion.span>
      )
    }),
  )
}
