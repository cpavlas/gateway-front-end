import React, { useState } from 'react'
import {
  formatBytes,
  type HourlyAccessPoint,
  type TimelineBucketItem,
  type TimeWindow,
} from '../api/client'

export type BarChartMode = 'stacked' | 'total'

export function formatCompactCount(count: number): string {
  const safe = Math.max(0, Math.round(count || 0))
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1)}M`
  if (safe >= 10_000) return `${Math.round(safe / 1_000)}k`
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}k`
  return String(safe)
}

export function formatTimelineAxisTick(isoTimestamp: string, windowKey: TimeWindow): string {
  const parsed = new Date(isoTimestamp)
  if (Number.isNaN(parsed.getTime())) return isoTimestamp
  if (windowKey === '7d' || windowKey === '30d') {
    return parsed.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
    })
  }
  return parsed.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

interface TimelineBarChartProps {
  timeline: TimelineBucketItem[]
  windowKey: TimeWindow
  prefixTestId: string
  chartTestId: string
  legendTestId?: string
  defaultMode?: BarChartMode
  compact?: boolean
}

export const TimelineBarChart: React.FC<TimelineBarChartProps> = ({
  timeline,
  windowKey,
  prefixTestId,
  chartTestId,
  legendTestId,
  defaultMode = 'stacked',
  compact = false,
}) => {
  const [mode, setMode] = useState<BarChartMode>(defaultMode)

  const bucketTotals = timeline.map((b) => {
    const dnsCount = Math.max(0, b.dns_queries)
    const fwCount = Math.max(0, b.total_events - dnsCount)
    return Math.max(b.total_events, dnsCount + fwCount)
  })
  const maxEvents = Math.max(1, ...bucketTotals)
  const midEvents = Math.round(maxEvents / 2)

  // Select up to 5 evenly-spaced X-axis tick indices
  const tickIndices = new Set<number>()
  if (timeline.length > 0) {
    tickIndices.add(0)
    tickIndices.add(timeline.length - 1)
    if (timeline.length >= 4) {
      tickIndices.add(Math.floor((timeline.length - 1) / 3))
      tickIndices.add(Math.floor(((timeline.length - 1) * 2) / 3))
    } else if (timeline.length === 3) {
      tickIndices.add(1)
    }
  }

  return (
    <div className="space-y-2.5">
      {/* Mode Toggle + Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          data-testid={legendTestId ?? `${prefixTestId}-legend`}
          className="flex flex-wrap items-center gap-3 text-xs text-slate-300"
        >
          {mode === 'stacked' ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-cyan-400" />
                <span>DNS Queries</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-indigo-500" />
                <span>Firewall Events</span>
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-indigo-500" />
              <span>Total Events (DNS + Firewall)</span>
            </span>
          )}
        </div>

        <div
          className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-[11px]"
          role="group"
          aria-label="Select bar chart view mode"
        >
          <button
            type="button"
            data-testid={`${prefixTestId}-mode-stacked`}
            aria-pressed={mode === 'stacked'}
            onClick={() => setMode('stacked')}
            className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
              mode === 'stacked'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Stacked
          </button>
          <button
            type="button"
            data-testid={`${prefixTestId}-mode-total`}
            aria-pressed={mode === 'total'}
            onClick={() => setMode('total')}
            className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
              mode === 'total'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Total
          </button>
        </div>
      </div>

      {timeline.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-500">
          No timeline buckets recorded in this window.
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-stretch gap-2">
            {/* Y-Axis Vertical Key & Scale */}
            <div
              data-testid={`${prefixTestId}-y-axis`}
              className="flex shrink-0 items-stretch gap-1.5 select-none"
            >
              <div className="flex items-center justify-center">
                <span className="-rotate-90 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Events
                </span>
              </div>
              <div
                className={`flex flex-col justify-between text-right font-mono text-[10px] text-slate-400 pr-1 border-r border-slate-800 ${
                  compact ? 'h-32' : 'h-36'
                }`}
              >
                <span>{formatCompactCount(maxEvents)}</span>
                <span>{formatCompactCount(midEvents)}</span>
                <span>0</span>
              </div>
            </div>

            {/* Plot Area with Horizontal Grid Lines & Bars */}
            <div className="relative flex-1 min-w-0">
              {/* Background Reference Grid Lines */}
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-0 top-0 flex flex-col justify-between ${
                  compact ? 'h-32' : 'h-36'
                }`}
              >
                <div className="border-b border-dashed border-slate-800/70" />
                <div className="border-b border-dashed border-slate-800/70" />
                <div className="border-b border-slate-800" />
              </div>

              <div
                data-testid={chartTestId}
                className={`relative z-10 flex items-end gap-1 pt-4 ${
                  compact ? 'h-32' : 'h-36'
                }`}
              >
                {timeline.map((bucket, idx) => {
                  const dnsCount = Math.max(0, bucket.dns_queries)
                  const fwCount = Math.max(0, bucket.total_events - dnsCount)
                  const combinedTotal = Math.max(bucket.total_events, dnsCount + fwCount)
                  const heightPct =
                    combinedTotal > 0
                      ? Math.max(6, Math.round((combinedTotal / maxEvents) * 100))
                      : 3
                  const dnsSharePct =
                    combinedTotal > 0 ? Math.round((dnsCount / combinedTotal) * 100) : 50
                  const fwSharePct = Math.max(0, 100 - dnsSharePct)
                  const showValueLabel =
                    combinedTotal > 0 &&
                    (timeline.length <= 16 ||
                      combinedTotal === maxEvents ||
                      tickIndices.has(idx))
                  const tooltipText = `${new Date(bucket.timestamp).toLocaleString()}, Total: ${combinedTotal.toLocaleString()} events | DNS Queries: ${dnsCount.toLocaleString()} | Firewall Events: ${fwCount.toLocaleString()} (${formatBytes(bucket.bytes)})`

                  return (
                    <div
                      key={`${bucket.timestamp}-${idx}`}
                      title={tooltipText}
                      className="group relative flex-1 flex flex-col items-center justify-end h-full min-w-0"
                    >
                      {showValueLabel && (
                        <span
                          data-testid={`${prefixTestId}-bar-label-${idx}`}
                          className="mb-0.5 truncate text-[9px] font-mono text-slate-300 leading-none"
                        >
                          {formatCompactCount(combinedTotal)}
                        </span>
                      )}

                      {mode === 'stacked' ? (
                        <div
                          style={{ height: `${heightPct}%` }}
                          className="w-full flex flex-col overflow-hidden rounded-t transition-all"
                        >
                          <div
                            data-testid="timeline-dns-segment"
                            style={{ height: `${dnsSharePct}%` }}
                            className="w-full bg-cyan-400/85 group-hover:bg-cyan-300"
                          />
                          <div
                            data-testid="timeline-fw-segment"
                            style={{ height: `${fwSharePct}%` }}
                            className="w-full bg-indigo-500/85 group-hover:bg-indigo-400"
                          />
                        </div>
                      ) : (
                        <div
                          data-testid="timeline-total-segment"
                          style={{ height: `${heightPct}%` }}
                          className="w-full rounded-t bg-indigo-500/85 group-hover:bg-indigo-400 transition-all"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* X-Axis Horizontal Key & Timestamp Ticks */}
          <div data-testid={`${prefixTestId}-x-axis`} className="pl-11 space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
              {Array.from(tickIndices)
                .sort((a, b) => a - b)
                .map((idx) => (
                  <span key={idx}>
                    {formatTimelineAxisTick(timeline[idx].timestamp, windowKey)}
                  </span>
                ))}
            </div>
            <div className="text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Time ({windowKey.toUpperCase()} Window)
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface HourlyProfileBarChartProps {
  hourlyProfile: HourlyAccessPoint[]
  prefixTestId: string
  chartTestId: string
  defaultMode?: BarChartMode
  compact?: boolean
}

export const HourlyProfileBarChart: React.FC<HourlyProfileBarChartProps> = ({
  hourlyProfile,
  prefixTestId,
  chartTestId,
  defaultMode = 'stacked',
  compact = false,
}) => {
  const [mode, setMode] = useState<BarChartMode>(defaultMode)
  const maxHourlyEvents = Math.max(1, ...hourlyProfile.map((h) => h.total_events))
  const midHourlyEvents = Math.round(maxHourlyEvents / 2)

  return (
    <div className="space-y-2.5">
      {/* Mode Toggle + Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          data-testid={`${prefixTestId}-legend`}
          className="flex flex-wrap items-center gap-3 text-xs text-slate-300"
        >
          {mode === 'stacked' ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-cyan-400" />
                <span>DNS Queries</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-emerald-500" />
                <span>Firewall Events</span>
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs bg-emerald-500" />
              <span>Total Hourly Events</span>
            </span>
          )}
        </div>

        <div
          className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-[11px]"
          role="group"
          aria-label="Select hourly profile chart view mode"
        >
          <button
            type="button"
            data-testid={`${prefixTestId}-mode-stacked`}
            aria-pressed={mode === 'stacked'}
            onClick={() => setMode('stacked')}
            className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
              mode === 'stacked'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Stacked
          </button>
          <button
            type="button"
            data-testid={`${prefixTestId}-mode-total`}
            aria-pressed={mode === 'total'}
            onClick={() => setMode('total')}
            className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
              mode === 'total'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Total
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-stretch gap-2">
          {/* Y-Axis Vertical Key & Scale */}
          <div
            data-testid={`${prefixTestId}-y-axis`}
            className="flex shrink-0 items-stretch gap-1.5 select-none"
          >
            <div className="flex items-center justify-center">
              <span className="-rotate-90 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Events
              </span>
            </div>
            <div
              className={`flex flex-col justify-between text-right font-mono text-[10px] text-slate-400 pr-1 border-r border-slate-800 ${
                compact ? 'h-28' : 'h-32'
              }`}
            >
              <span>{formatCompactCount(maxHourlyEvents)}</span>
              <span>{formatCompactCount(midHourlyEvents)}</span>
              <span>0</span>
            </div>
          </div>

          {/* 24-Hour Bars + Hour Ticks */}
          <div
            data-testid={chartTestId}
            className="flex-1 grid grid-cols-12 gap-1 sm:grid-cols-24 pt-1"
          >
            {hourlyProfile.map((pt) => {
              const dnsCount = Math.max(0, pt.dns_queries)
              const fwCount = Math.max(0, pt.total_events - dnsCount)
              const combinedTotal = Math.max(pt.total_events, dnsCount + fwCount)
              const heightPct =
                combinedTotal > 0
                  ? Math.max(12, Math.round((combinedTotal / maxHourlyEvents) * 100))
                  : 4
              const dnsSharePct =
                combinedTotal > 0 ? Math.round((dnsCount / combinedTotal) * 100) : 50
              const fwSharePct = Math.max(0, 100 - dnsSharePct)

              return (
                <div
                  key={pt.hour}
                  data-testid={`hourly-bar-${pt.hour}`}
                  title={`${pt.label}: ${combinedTotal.toLocaleString()} events (${dnsCount.toLocaleString()} DNS, ${fwCount.toLocaleString()} FW, ${formatBytes(pt.bytes)})`}
                  className="flex flex-col items-center gap-1 min-w-0"
                >
                  <span className="h-3 text-[9px] font-mono text-slate-400 truncate">
                    {combinedTotal > 0 ? formatCompactCount(combinedTotal) : ''}
                  </span>
                  <div
                    className={`flex w-full items-end rounded bg-slate-900 p-0.5 ${
                      compact ? 'h-20' : 'h-24'
                    }`}
                  >
                    {combinedTotal === 0 ? (
                      <div style={{ height: '4%' }} className="w-full rounded-xs bg-slate-800" />
                    ) : mode === 'stacked' ? (
                      <div
                        style={{ height: `${heightPct}%` }}
                        className="w-full flex flex-col overflow-hidden rounded-xs transition-all"
                      >
                        <div
                          style={{ height: `${dnsSharePct}%` }}
                          className="w-full bg-cyan-400/85 hover:bg-cyan-300"
                        />
                        <div
                          style={{ height: `${fwSharePct}%` }}
                          className="w-full bg-emerald-500/85 hover:bg-emerald-400"
                        />
                      </div>
                    ) : (
                      <div
                        style={{ height: `${heightPct}%` }}
                        className="w-full rounded-xs bg-emerald-500/85 hover:bg-emerald-400 transition-all"
                      />
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    {pt.hour.toString().padStart(2, '0')}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* X-Axis Horizontal Key */}
        <div
          data-testid={`${prefixTestId}-x-axis`}
          className="pl-11 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400"
        >
          Hour of Day (00:00 - 23:00 Local Time)
        </div>
      </div>
    </div>
  )
}

