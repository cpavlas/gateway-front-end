import React, { useId } from 'react'

interface UnicornLogoProps {
  className?: string
  testId?: string
}

/**
 * Custom side-profile Unicorn SVG logo with a multi-stop rainbow horn (`FB-P11-001`).
 */
export const UnicornLogo: React.FC<UnicornLogoProps> = ({
  className = 'h-6 w-6',
  testId = 'unicorn-logo',
}) => {
  const uid = useId()
  const hornGradId = `unicorn-horn-${uid}`
  const coatGradId = `unicorn-coat-${uid}`
  const maneGradId = `unicorn-mane-${uid}`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      data-testid={testId}
      aria-label="Unicorn Rainbow Horn Logo"
      role="img"
    >
      <defs>
        <linearGradient
          id={hornGradId}
          x1="35"
          y1="24"
          x2="59"
          y2="4"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="20%" stopColor="#fb923c" />
          <stop offset="40%" stopColor="#facc15" />
          <stop offset="60%" stopColor="#34d399" />
          <stop offset="80%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
        <linearGradient
          id={coatGradId}
          x1="14"
          y1="14"
          x2="50"
          y2="56"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
        <linearGradient
          id={maneGradId}
          x1="8"
          y1="18"
          x2="26"
          y2="56"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="50%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
      </defs>

      {/* Flowing Mane along back of neck */}
      <path
        d="M23 18C15 19 10 24 9 31C13 30 16 31 18 33C11 35 8 40 8 46C12 45 15 46 17 48C13 50 11 53 11 57H21L26 23L23 18Z"
        fill={`url(#${maneGradId})`}
      />

      {/* Side-Profile Rainbow Horn */}
      <path
        data-testid="unicorn-rainbow-horn"
        d="M35 21L59 4L42 27Z"
        fill={`url(#${hornGradId})`}
      />
      <path
        d="M39 18L44 22M45 14L49 17M51 10L54 12"
        stroke="#0f172a"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.45"
      />

      {/* Side-Profile Unicorn Head, Ear, Muzzle & Neck */}
      <path
        d="M19 57L21 36L23 21L21 11L29 17C33 17 37 19 40 22L53 31C55.2 32.5 55.6 35.6 54 37.8L50 41.2C48.2 42.5 45.5 42.3 43.2 40.8L38 38C36.4 40.2 33.8 41.2 31 41.2L33 57H19Z"
        fill={`url(#${coatGradId})`}
        stroke="#e2e8f0"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />

      {/* Eye & Nostril */}
      <circle cx="37.5" cy="28" r="2.2" fill="#0f172a" />
      <circle cx="38.2" cy="27.3" r="0.8" fill="#ffffff" />
      <circle cx="49.5" cy="35" r="1.2" fill="#475569" />
    </svg>
  )
}

