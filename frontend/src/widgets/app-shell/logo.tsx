import * as React from "react"
import { motion } from "motion/react"

export function VoyagerLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 120"
      fill="none"
      {...props}
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

export function VoyagerLoader(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 120"
      fill="none"
      {...props}
    >
      {/* Soft pulsing background base */}
      <motion.g
        animate={{ opacity: [0.15, 0.4, 0.15] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <path
          d="M60 15L15 100H42L60 62L78 100H105L60 15Z"
          fill="currentColor"
          opacity="0.8"
        />
        <path
          d="M60 62L42 100H78L60 62Z"
          fill="currentColor"
          opacity="0.3"
        />
      </motion.g>

      {/* Outer path racing comet effect */}
      <motion.path
        d="M60 15L15 100H42L60 62L78 100H105L60 15Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={{ pathLength: 0, pathOffset: 0 }}
        animate={{ 
          pathLength: [0, 0.4, 0],
          pathOffset: [0, 0.6, 1]
        }}
        transition={{
          duration: 2.5,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />

      {/* Inner path racing comet effect */}
      <motion.path
        d="M60 62L42 100H78L60 62Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={{ pathLength: 0, pathOffset: 0 }}
        animate={{ 
          pathLength: [0, 0.4, 0],
          pathOffset: [0, 0.6, 1]
        }}
        transition={{
          duration: 2.5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.25
        }}
      />
    </svg>
  )
}
