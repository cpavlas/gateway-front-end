import { Clock, PauseCircle, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  formatRemainingDuration,
  type ActiveOverrideInfo,
  type OverrideTargetType,
  type TimerStartPayload,
} from '../api/client'

interface TimerPopoverMenuProps {
  targetType: OverrideTargetType
  targetId: number
  targetName: string
  activeOverride?: ActiveOverrideInfo | null
  disabled?: boolean
  isPending?: boolean
  onStartTimer: (payload: TimerStartPayload) => void
  onCancelTimer: (overrideId: number) => void
}

const PAUSE_PRESETS: Array<{ label: string; preset: string }> = [
  { label: 'Pause 15m', preset: '15m' },
  { label: 'Pause 30m', preset: '30m' },
  { label: 'Pause 1h', preset: '1h' },
  { label: 'Pause 2h', preset: '2h' },
  { label: 'Until 07:00', preset: 'until_tomorrow_0700' },
]

const BONUS_PRESETS: Array<{ label: string; preset: string }> = [
  { label: 'Bonus 15m', preset: '15m' },
  { label: 'Bonus 30m', preset: '30m' },
  { label: 'Bonus 1h', preset: '1h' },
]

export function TimerPopoverMenu({
  targetType,
  targetId,
  targetName,
  activeOverride,
  disabled = false,
  isPending = false,
  onStartTimer,
  onCancelTimer,
}: TimerPopoverMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [customMinutes, setCustomMinutes] = useState('45')
  const [liveRemainingSeconds, setLiveRemainingSeconds] = useState<number>(
    activeOverride?.remaining_seconds ?? 0,
  )

  useEffect(() => {
    if (!activeOverride) {
      setLiveRemainingSeconds(0)
      return
    }
    const computeRemaining = () => {
      const expiresMs = Date.parse(activeOverride.expires_at)
      if (Number.isNaN(expiresMs)) {
        return activeOverride.remaining_seconds
      }
      return Math.max(0, Math.floor((expiresMs - Date.now()) / 1000))
    }
    setLiveRemainingSeconds(computeRemaining())
    const timer = window.setInterval(() => {
      setLiveRemainingSeconds(computeRemaining())
    }, 15000)
    return () => window.clearInterval(timer)
  }, [activeOverride])

  const handleSelectPreset = (mode: 'pause' | 'bonus', preset: string) => {
    onStartTimer({ mode, preset })
    setIsOpen(false)
  }

  const handleCustomSubmit = (mode: 'pause' | 'bonus') => {
    const parsed = Number.parseInt(customMinutes, 10)
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1440) {
      return
    }
    onStartTimer({ mode, duration_minutes: parsed })
    setIsOpen(false)
  }

  const hasActiveOverride = Boolean(
    activeOverride && activeOverride.is_active && liveRemainingSeconds > 0,
  )

  return (
    <div className="relative inline-flex items-center gap-1.5">
      {hasActiveOverride && activeOverride && (
        <div
          data-testid={`active-timer-pill-${targetType}-${targetId}`}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium ${
            activeOverride.mode === 'pause'
              ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
              : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200'
          }`}
        >
          <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            {activeOverride.mode === 'pause' ? 'Paused' : 'Bonus Time'} —{' '}
            {formatRemainingDuration(liveRemainingSeconds)}
          </span>
          <button
            type="button"
            data-testid={`cancel-timer-${targetType}-${targetId}`}
            disabled={isPending}
            onClick={() => onCancelTimer(activeOverride.id)}
            title={`Cancel timer on ${targetName}`}
            className="ml-0.5 rounded p-0.5 hover:bg-slate-900/60 text-current transition"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">Cancel Timer</span>
          </button>
        </div>
      )}

      {!disabled && (
        <button
          type="button"
          data-testid={`open-timer-menu-${targetType}-${targetId}`}
          disabled={isPending}
          onClick={() => setIsOpen((prev) => !prev)}
          title={`Timed Pause / Bonus controls for ${targetName}`}
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
            isOpen
              ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200'
              : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:border-slate-600 hover:text-white'
          } disabled:opacity-50`}
        >
          <Clock className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
          <span>Timer</span>
        </button>
      )}

      {isOpen && (
        <div
          data-testid={`timer-popover-${targetType}-${targetId}`}
          className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-xl border border-slate-700 bg-slate-900 p-3 text-left shadow-2xl"
        >
          <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="text-xs font-semibold text-white truncate">
              Timed Control: {targetName}
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-2.5">
            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-amber-300">
                <PauseCircle className="h-3 w-3" aria-hidden="true" />
                Pause Internet (Temporary Block)
              </p>
              <div className="flex flex-wrap gap-1">
                {PAUSE_PRESETS.map((item) => (
                  <button
                    key={item.preset}
                    type="button"
                    data-testid={`timer-preset-pause-${item.preset}-${targetType}-${targetId}`}
                    onClick={() => handleSelectPreset('pause', item.preset)}
                    className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/25 transition"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-cyan-300">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Bonus Access (Temporary Allow)
              </p>
              <div className="flex flex-wrap gap-1">
                {BONUS_PRESETS.map((item) => (
                  <button
                    key={item.preset}
                    type="button"
                    data-testid={`timer-preset-bonus-${item.preset}-${targetType}-${targetId}`}
                    onClick={() => handleSelectPreset('bonus', item.preset)}
                    className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/25 transition"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-800 pt-2">
              <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-400">
                Custom Duration (Minutes)
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  data-testid={`custom-timer-minutes-${targetType}-${targetId}`}
                  className="w-16 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  data-testid={`custom-timer-pause-${targetType}-${targetId}`}
                  onClick={() => handleCustomSubmit('pause')}
                  className="flex-1 rounded-md border border-amber-500/30 bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/25"
                >
                  Pause
                </button>
                <button
                  type="button"
                  data-testid={`custom-timer-bonus-${targetType}-${targetId}`}
                  onClick={() => handleCustomSubmit('bonus')}
                  className="flex-1 rounded-md border border-cyan-500/30 bg-cyan-500/15 px-2 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/25"
                >
                  Bonus
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

