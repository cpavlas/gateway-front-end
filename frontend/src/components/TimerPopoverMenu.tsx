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
  { label: '15m', preset: '15m' },
  { label: '30m', preset: '30m' },
  { label: '1h', preset: '1h' },
  { label: '2h', preset: '2h' },
  { label: 'Until 07:00', preset: 'until_tomorrow_0700' },
]

const BONUS_PRESETS: Array<{ label: string; preset: string }> = [
  { label: '20m', preset: '20m' },
  { label: '40m', preset: '40m' },
  { label: '60m', preset: '60m' },
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

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

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
    <div className="inline-flex items-center">
      {!disabled && (
        <div
          data-testid={
            hasActiveOverride ? `active-timer-pill-${targetType}-${targetId}` : undefined
          }
          className={`inline-flex items-center rounded-lg border text-xs font-semibold transition ${
            hasActiveOverride && activeOverride
              ? activeOverride.mode === 'pause'
                ? 'border-amber-500/50 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                : 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
              : isOpen
                ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200'
                : 'border-slate-700 bg-slate-800/80 text-slate-300 hover:border-slate-600 hover:text-white'
          }`}
        >
          <button
            type="button"
            data-testid={`open-timer-menu-${targetType}-${targetId}`}
            disabled={isPending}
            onClick={() => setIsOpen((prev) => !prev)}
            title={`Timed Pause / Bonus controls for ${targetName}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            <Clock
              className={`h-3.5 w-3.5 shrink-0 ${
                hasActiveOverride && activeOverride
                  ? activeOverride.mode === 'pause'
                    ? 'text-amber-300'
                    : 'text-emerald-300'
                  : 'text-indigo-400'
              }`}
              aria-hidden="true"
            />
            {hasActiveOverride && activeOverride ? (
              <span>
                {activeOverride.mode === 'pause' ? 'Paused' : 'Bonus'} ·{' '}
                {formatRemainingDuration(liveRemainingSeconds)}
              </span>
            ) : (
              <span>Timer</span>
            )}
          </button>

          {hasActiveOverride && activeOverride && (
            <button
              type="button"
              data-testid={`cancel-timer-${targetType}-${targetId}`}
              disabled={isPending}
              onClick={(e) => {
                e.stopPropagation()
                onCancelTimer(activeOverride.id)
              }}
              title={`Cancel timer on ${targetName}`}
              className="mr-1 rounded p-0.5 text-current hover:bg-slate-900/60 transition cursor-pointer"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Cancel Timer</span>
            </button>
          )}
        </div>
      )}

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Timed Control: ${targetName}`}
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
        >
          <div
            data-testid={`timer-popover-${targetType}-${targetId}`}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-4 text-left shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <h3 className="text-sm font-bold text-white truncate">
                  Timed Control: {targetName}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Start a temporary internet pause or bonus access window
                </p>
              </div>
              <button
                type="button"
                aria-label="Close timer dialog"
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {hasActiveOverride && activeOverride && (
              <div
                className={`mb-3 flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${
                  activeOverride.mode === 'pause'
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {activeOverride.mode === 'pause' ? 'Paused' : 'Bonus Time'},{' '}
                    {formatRemainingDuration(liveRemainingSeconds)}
                  </span>
                </div>
                <button
                  type="button"
                  data-testid={`modal-cancel-timer-${targetType}-${targetId}`}
                  disabled={isPending}
                  onClick={() => {
                    onCancelTimer(activeOverride.id)
                    setIsOpen(false)
                  }}
                  className="rounded-md border border-current/30 bg-slate-950/50 px-2 py-0.5 text-[11px] font-semibold hover:bg-slate-950 cursor-pointer"
                >
                  Cancel Timer
                </button>
              </div>
            )}

            <div className="space-y-3.5">
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
                  <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Pause Internet (Temporary Block)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PAUSE_PRESETS.map((item) => (
                    <button
                      key={item.preset}
                      type="button"
                      data-testid={`timer-preset-pause-${item.preset}-${targetType}-${targetId}`}
                      onClick={() => handleSelectPreset('pause', item.preset)}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 transition cursor-pointer"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Bonus Access (Temporary Allow)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {BONUS_PRESETS.map((item) => (
                    <button
                      key={item.preset}
                      type="button"
                      data-testid={`timer-preset-bonus-${item.preset}-${targetType}-${targetId}`}
                      onClick={() => handleSelectPreset('bonus', item.preset)}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 transition cursor-pointer"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Custom Duration (Minutes)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={customMinutes}
                    onChange={(e) => setCustomMinutes(e.target.value)}
                    data-testid={`custom-timer-minutes-${targetType}-${targetId}`}
                    className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    data-testid={`custom-timer-pause-${targetType}-${targetId}`}
                    onClick={() => handleCustomSubmit('pause')}
                    className="flex-1 rounded-lg border border-amber-500/30 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 cursor-pointer"
                  >
                    Pause
                  </button>
                  <button
                    type="button"
                    data-testid={`custom-timer-bonus-${targetType}-${targetId}`}
                    onClick={() => handleCustomSubmit('bonus')}
                    className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                  >
                    Bonus
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
