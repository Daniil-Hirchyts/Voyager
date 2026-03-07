import * as React from "react"

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
