import React, { useState } from 'react'
import { Timer } from 'lucide-react'

export type AutoRefreshOption = 'off' | '5s' | '30s' | '1m' | '5m'

export const AUTO_REFRESH_OPTIONS: {
  key: AutoRefreshOption
  label: string
  ms: number | false
}[] = [
  { key: 'off', label: 'Off', ms: false },
  { key: '5s', label: '5s', ms: 5_000 },
  { key: '30s', label: '30s', ms: 30_000 },
  { key: '1m', label: '1m', ms: 60_000 },
  { key: '5m', label: '5m', ms: 300_000 },
]

const STORAGE_KEY = 'gateway_auto_refresh_interval'

export function resolveRefetchInterval(option: AutoRefreshOption): number | false {
  const found = AUTO_REFRESH_OPTIONS.find((item) => item.key === option)
  return found ? found.ms : 30_000
}

export function useAutoRefresh(defaultOption: AutoRefreshOption = '30s'): {
  intervalOption: AutoRefreshOption
  setIntervalOption: (next: AutoRefreshOption) => void
  refetchInterval: number | false
} {
  const [intervalOption, setState] = useState<AutoRefreshOption>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as AutoRefreshOption | null
      if (saved && AUTO_REFRESH_OPTIONS.some((o) => o.key === saved)) {
        return saved
      }
    } catch {
      // Ignore storage access errors
    }
    return defaultOption
  })

  const setIntervalOption = (next: AutoRefreshOption) => {
    setState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore storage write errors
    }
  }

  return {
    intervalOption,
    setIntervalOption,
    refetchInterval: resolveRefetchInterval(intervalOption),
  }
}

interface AutoRefreshSelectorProps {
  value: AutoRefreshOption
  onChange: (next: AutoRefreshOption) => void
  testId?: string
  compact?: boolean
}

export const AutoRefreshSelector: React.FC<AutoRefreshSelectorProps> = ({
  value,
  onChange,
  testId = 'auto-refresh-select',
  compact = false,
}) => {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs text-slate-200">
      <Timer
        className={`h-3.5 w-3.5 shrink-0 ${
          value === 'off' ? 'text-slate-500' : 'text-indigo-400'
        }`}
        aria-hidden="true"
      />
      <select
        aria-label="Auto refresh interval"
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value as AutoRefreshOption)}
        className={`bg-transparent font-semibold text-slate-200 focus:outline-none cursor-pointer ${
          compact ? 'py-1 text-[11px]' : 'py-2 text-xs'
        }`}
      >
        {AUTO_REFRESH_OPTIONS.map((opt) => (
          <option
            key={opt.key}
            value={opt.key}
            className="bg-slate-900 text-slate-100"
          >
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

