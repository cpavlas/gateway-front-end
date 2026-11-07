import React from 'react'
import { Loader2 } from 'lucide-react'

interface TelemetryLoadingShellProps {
  isLoading?: boolean
  isFetching?: boolean
  loadingMessage?: string
  children: React.ReactNode
  className?: string
  testId?: string
}

/**
 * Visual loading & refreshing shell for analytics and telemetry panels (`FB-P11-007`).
 * Applies a slow-pulse dimming state (`opacity-45 saturate-50`) during query refetches
 * and displays a subtle floating status badge.
 */
export const TelemetryLoadingShell: React.FC<TelemetryLoadingShellProps> = ({
  isLoading = false,
  isFetching = false,
  loadingMessage = 'Refreshing telemetry from Elasticsearch...',
  children,
  className = '',
  testId = 'telemetry-loading-shell',
}) => {
  const isRefreshing = isFetching || isLoading

  return (
    <div
      data-testid={testId}
      className={`relative transition-all duration-300 space-y-6 ${className}`}
    >
      {isRefreshing && (
        <div
          data-testid="telemetry-refreshing-badge"
          className="fixed top-28 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 rounded-full border border-indigo-500/50 bg-slate-900/95 px-4 py-2 text-xs font-semibold text-indigo-200 shadow-2xl backdrop-blur-md telemetry-gentle-bounce"
        >
          <Loader2 className="h-4 w-4 animate-spin text-indigo-400" aria-hidden="true" />
          <span>{loadingMessage}</span>
        </div>
      )}
      <div className={`space-y-6 ${isRefreshing ? 'telemetry-loading-pulse' : ''}`}>
        {children}
      </div>
    </div>
  )
}

