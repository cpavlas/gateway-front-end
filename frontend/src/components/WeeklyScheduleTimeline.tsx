import React from 'react'
import { Calendar } from 'lucide-react'
import type { ScheduleRule } from '../api/client'
import { WEEKDAY_LABELS } from './ScheduleFormModal'

interface WeeklyScheduleTimelineProps {
  schedules: ScheduleRule[]
  onSelectSchedule?: (rule: ScheduleRule) => void
}

interface TimelineSegment {
  rule: ScheduleRule
  day: number
  startMin: number
  endMin: number
}

export function timeToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':')
  const h = Number.parseInt(hStr ?? '0', 10)
  const m = Number.parseInt(mStr ?? '0', 10)
  if (Number.isNaN(h) || Number.isNaN(m)) return 0
  return Math.max(0, Math.min(1440, h * 60 + m))
}

export function buildWeeklyTimelineSegments(schedules: ScheduleRule[]): TimelineSegment[] {
  const segments: TimelineSegment[] = []
  for (const rule of schedules) {
    if (!rule.is_enabled) continue
    const startMin = timeToMinutes(rule.start_time)
    const endMin = timeToMinutes(rule.end_time)
    for (const day of rule.days_of_week) {
      if (startMin === endMin) {
        segments.push({ rule, day, startMin: 0, endMin: 1440 })
      } else if (startMin < endMin) {
        segments.push({ rule, day, startMin, endMin })
      } else {
        segments.push({ rule, day, startMin, endMin: 1440 })
        segments.push({ rule, day: (day + 1) % 7, startMin: 0, endMin })
      }
    }
  }
  return segments
}

const HOUR_TICKS = [0, 6, 12, 18, 24]

export const WeeklyScheduleTimeline: React.FC<WeeklyScheduleTimelineProps> = ({
  schedules,
  onSelectSchedule,
}) => {
  const segments = buildWeeklyTimelineSegments(schedules)

  return (
    <section
      data-testid="weekly-schedule-timeline"
      className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-indigo-400" aria-hidden="true" />
          <h2 className="text-sm font-bold text-slate-100">
            Weekly 7-Day / 24-Hour Coverage Matrix
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs border border-rose-400/70 bg-rose-500/45" />
            <span>Full Internet Block</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs border border-amber-400/70 bg-amber-500/45" />
            <span>YouTube Only</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs border border-slate-500/70 bg-slate-600/50" />
            <span>Snoozed</span>
          </span>
        </div>
      </div>

      {/* Hour Axis Header */}
      <div className="mt-3 grid grid-cols-[44px_1fr] items-center gap-2 text-[10px] font-mono text-slate-500">
        <span />
        <div className="relative h-4">
          {HOUR_TICKS.map((hour) => (
            <span
              key={hour}
              style={{ left: `${(hour / 24) * 100}%` }}
              className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
            >
              {String(hour).padStart(2, '0')}:00
            </span>
          ))}
        </div>
      </div>

      {/* Mon - Sun Rows */}
      <div className="mt-1 space-y-1.5">
        {WEEKDAY_LABELS.map((dayItem) => {
          const daySegs = segments.filter((s) => s.day === dayItem.day)
          return (
            <div
              key={dayItem.day}
              data-testid={`timeline-day-${dayItem.day}`}
              className="grid grid-cols-[44px_1fr] items-center gap-2"
            >
              <span className="text-xs font-semibold text-slate-400">{dayItem.short}</span>
              <div className="relative h-6 overflow-hidden rounded-md border border-slate-800 bg-slate-950/80">
                {[6, 12, 18].map((h) => (
                  <div
                    key={h}
                    style={{ left: `${(h / 24) * 100}%` }}
                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-slate-800/70"
                  />
                ))}
                {daySegs.map((seg, idx) => {
                  const leftPct = (seg.startMin / 1440) * 100
                  const widthPct = Math.max(1.5, ((seg.endMin - seg.startMin) / 1440) * 100)
                  const colorClasses = seg.rule.is_snoozed
                    ? 'border-slate-500/70 bg-slate-600/50 text-slate-200'
                    : seg.rule.block_mode === 'youtube'
                      ? 'border-amber-400/70 bg-amber-500/40 text-amber-100 hover:bg-amber-500/55'
                      : 'border-rose-400/70 bg-rose-500/40 text-rose-100 hover:bg-rose-500/55'
                  return (
                    <button
                      key={`${seg.rule.id}-${seg.day}-${idx}`}
                      type="button"
                      data-testid={`timeline-segment-${seg.rule.id}-${seg.day}`}
                      onClick={() => onSelectSchedule?.(seg.rule)}
                      title={`${seg.rule.name} (${seg.rule.target_name}) | ${seg.rule.block_mode === 'youtube' ? 'YouTube Only' : 'Full Internet'} | ${seg.rule.start_time} - ${seg.rule.end_time}${seg.rule.is_snoozed ? ' [Snoozed]' : ''}`}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className={`absolute top-0.5 bottom-0.5 truncate rounded-xs border px-1 text-[10px] font-semibold transition cursor-pointer ${colorClasses}`}
                    >
                      {widthPct >= 14 ? seg.rule.name : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
