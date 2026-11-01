import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Building2,
  Clock,
  Globe,
  HardDrive,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react'
import {
  apiClient,
  formatBytes,
  type TimeWindow,
} from '../api/client'

interface DeviceAnalyticsDrawerProps {
  deviceId: number | null
  initialWindow?: TimeWindow
  onClose: () => void
}

const TIME_WINDOWS: { key: TimeWindow; label: string }[] = [
  { key: '1h', label: 'Last 1h' },
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7d' },
  { key: '30d', label: 'Last 30d' },
]

export const DeviceAnalyticsDrawer: React.FC<DeviceAnalyticsDrawerProps> = ({
  deviceId,
  initialWindow = '24h',
  onClose,
}) => {
  const queryClient = useQueryClient()
  const [windowKey, setWindowKey] = useState<TimeWindow>(initialWindow)
  const [domainSearch, setDomainSearch] = useState('')
  const [actionBanner, setActionBanner] = useState<string | null>(null)

  const {
    data: analytics,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['deviceAnalytics', deviceId, windowKey, domainSearch.trim()],
    queryFn: () =>
      apiClient.getDeviceAnalytics(deviceId!, {
        window: windowKey,
        domain_search: domainSearch.trim() || undefined,
      }),
    enabled: deviceId !== null,
    placeholderData: (previousData) => previousData,
  })

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiClient.getDeviceAnalytics(deviceId!, {
        window: windowKey,
        domain_search: domainSearch.trim() || undefined,
        refresh: true,
      }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(
        ['deviceAnalytics', deviceId, windowKey, domainSearch.trim()],
        fresh,
      )
    },
  })

  const accessMutation = useMutation({
    mutationFn: async (action: 'block' | 'unblock') => {
      if (!deviceId) throw new Error('No device selected')
      return action === 'block'
        ? apiClient.blockDevice(deviceId)
        : apiClient.unblockDevice(deviceId)
    },
    onSuccess: (res) => {
      setActionBanner(res.warning ?? null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['deviceAnalytics', deviceId] })
      void queryClient.invalidateQueries({ queryKey: ['networkOverview'] })
    },
    onError: (err: unknown) => {
      setActionBanner(
        err instanceof Error ? err.message : 'Failed to toggle device internet access.',
      )
    },
  })

  if (deviceId === null) {
    return null
  }

  const device = analytics?.device
  const summary = analytics?.summary
  const timeline = analytics?.timeline ?? []
  const hourlyProfile = analytics?.hourly_access_profile ?? []
  const topDomains = analytics?.top_domains ?? []
  const topOrgs = analytics?.top_organizations ?? []
  const recentQueries = analytics?.recent_queries ?? []

  const maxTimelineEvents = Math.max(1, ...timeline.map((b) => b.total_events))
  const maxHourlyEvents = Math.max(1, ...hourlyProfile.map((h) => h.total_events))
  const maxDomainCount = Math.max(1, ...topDomains.map((d) => d.query_count))

  return (
    <div
      data-testid="device-analytics-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Device usage and domains analytics"
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/75 backdrop-blur-xs"
    >
      <div className="relative flex h-full w-full max-w-4xl flex-col border-l border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Drawer Header */}
        <div className="flex flex-col gap-3 border-b border-slate-800 bg-slate-950/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  device?.is_online
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
                    : 'bg-slate-600'
                }`}
              />
              <h2 className="text-lg font-bold text-slate-100">
                {device ? device.effective_name : `Device #${deviceId}`}
              </h2>
              {device?.ipv4_address && (
                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-indigo-300">
                  {device.ipv4_address}
                </span>
              )}
            </div>
            {device && (
              <p className="mt-1 text-xs text-slate-400 font-mono">
                MAC: {device.mac_address}
                {device.vendor ? ` • ${device.vendor}` : ''}
                {device.interface_name ? ` • ${device.interface_name}` : ''}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {device && (
              <>
                {device.is_protected ? (
                  <span
                    data-testid="drawer-access-protected"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300"
                  >
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Protected (Always Allowed)</span>
                  </span>
                ) : device.is_blocked ? (
                  <button
                    type="button"
                    data-testid="drawer-access-toggle"
                    disabled={accessMutation.isPending}
                    onClick={() => accessMutation.mutate('unblock')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 cursor-pointer"
                  >
                    <ShieldAlert className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
                    <span>
                      {accessMutation.isPending ? 'Updating...' : 'Blocked — Click to Allow'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="drawer-access-toggle"
                    disabled={accessMutation.isPending || !device.ipv4_address}
                    onClick={() => accessMutation.mutate('block')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                  >
                    <Globe className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    <span>
                      {accessMutation.isPending ? 'Blocking...' : 'Allowed — Click to Block'}
                    </span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              data-testid="close-analytics-drawer"
              aria-label="Close analytics drawer"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Time Window & Refresh Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/90 px-6 py-3">
          <div className="flex items-center gap-1.5" role="group" aria-label="Select analytics time window">
            {TIME_WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                data-testid={`drawer-window-${w.key}`}
                onClick={() => setWindowKey(w.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  windowKey === w.key
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-800 bg-slate-950/70 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            data-testid="drawer-refresh-btn"
            onClick={() => {
              refreshMutation.mutate()
              void refetch()
            }}
            disabled={isFetching || refreshMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                isFetching || refreshMutation.isPending ? 'animate-spin' : ''
              }`}
              aria-hidden="true"
            />
            <span>Refresh Telemetry</span>
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {(analytics?.warning || actionBanner) && (
            <div
              role="alert"
              data-testid="drawer-warning-banner"
              className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{actionBanner ?? analytics?.warning}</span>
            </div>
          )}

          {isLoading && !analytics ? (
            <div
              data-testid="drawer-loading"
              className="rounded-xl border border-slate-800 bg-slate-950/50 p-10 text-center text-sm text-slate-400"
            >
              Querying Elasticsearch 9.4.3 (`logs-pfsense.log*`) for device telemetry...
            </div>
          ) : (
            <>
              {/* Summary KPI Row */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div
                  data-testid="drawer-kpi-events"
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Total Events</span>
                    <Activity className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                  </div>
                  <p className="mt-1.5 text-xl font-bold text-slate-100">
                    {(summary?.total_events ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {summary?.allowed_packet_count ?? 0} pass / {summary?.blocked_packet_count ?? 0}{' '}
                    block
                  </p>
                </div>

                <div
                  data-testid="drawer-kpi-bytes"
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Firewall Bytes</span>
                    <HardDrive className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  </div>
                  <p className="mt-1.5 text-xl font-bold text-emerald-300">
                    {formatBytes(summary?.total_bytes ?? 0)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {summary?.firewall_event_count ?? 0} filterlog packets
                  </p>
                </div>

                <div
                  data-testid="drawer-kpi-dns"
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>DNS Queries</span>
                    <Globe className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                  </div>
                  <p className="mt-1.5 text-xl font-bold text-sky-300">
                    {(summary?.dns_query_count ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">Unbound resolver logs</p>
                </div>

                <div
                  data-testid="drawer-kpi-active-hours"
                  className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Active Hours</span>
                    <Clock className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                  </div>
                  <p className="mt-1.5 text-xl font-bold text-amber-300">
                    {summary?.active_hours_in_day ?? 0} / 24h
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">Distinct hours active</p>
                </div>
              </div>

              {/* Usage & Activity Timeline */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      Usage &amp; Activity Timeline ({windowKey})
                    </h3>
                    <p className="text-xs text-slate-400">
                      Combined Unbound DNS lookups and filterlog firewall events over time
                    </p>
                  </div>
                </div>

                {timeline.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No timeline buckets recorded in this window.
                  </p>
                ) : (
                  <div
                    data-testid="drawer-timeline-chart"
                    className="flex h-32 items-end gap-1 pt-4 border-b border-slate-800/80"
                  >
                    {timeline.map((bucket) => {
                      const heightPct = Math.max(
                        4,
                        Math.round((bucket.total_events / maxTimelineEvents) * 100),
                      )
                      return (
                        <div
                          key={bucket.timestamp}
                          title={`${new Date(bucket.timestamp).toLocaleString()}: ${bucket.total_events} events (${bucket.dns_queries} DNS, ${formatBytes(bucket.bytes)})`}
                          className="group flex-1 flex flex-col items-center justify-end h-full"
                        >
                          <div
                            style={{ height: `${heightPct}%` }}
                            className="w-full rounded-t bg-indigo-500/80 group-hover:bg-indigo-400 transition-all"
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 24-Hour Access Time Profile */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      24-Hour Access Time Profile (Local Time)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Hourly online activity distribution from 00:00 to 23:00
                    </p>
                  </div>
                  {summary?.last_active_at && (
                    <span className="text-[11px] font-mono text-slate-400">
                      Last active: {new Date(summary.last_active_at).toLocaleString()}
                    </span>
                  )}
                </div>

                <div
                  data-testid="drawer-hourly-profile"
                  className="grid grid-cols-12 gap-1.5 sm:grid-cols-24 pt-2"
                >
                  {hourlyProfile.map((pt) => {
                    const heightPct =
                      pt.total_events > 0
                        ? Math.max(12, Math.round((pt.total_events / maxHourlyEvents) * 100))
                        : 4
                    return (
                      <div
                        key={pt.hour}
                        data-testid={`hourly-bar-${pt.hour}`}
                        title={`${pt.label}: ${pt.total_events.toLocaleString()} events (${pt.dns_queries.toLocaleString()} DNS, ${formatBytes(pt.bytes)})`}
                        className="flex flex-col items-center gap-1"
                      >
                        <div className="flex h-20 w-full items-end rounded bg-slate-900 p-0.5">
                          <div
                            style={{ height: `${heightPct}%` }}
                            className={`w-full rounded-xs transition-all ${
                              pt.total_events > 0
                                ? 'bg-emerald-500/80 hover:bg-emerald-400'
                                : 'bg-slate-800'
                            }`}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">
                          {pt.hour.toString().padStart(2, '0')}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Top Visited Domains & Destination Organizations */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Top Visited Domains */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Globe className="h-4 w-4 text-sky-400" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-slate-100">
                      Top Visited Domains (`dns.question.name`)
                    </h3>
                  </div>

                  {topDomains.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-500">
                      No DNS domain queries recorded for this device in this window.
                    </p>
                  ) : (
                    <ul data-testid="drawer-top-domains" className="space-y-2 text-xs">
                      {topDomains.map((item) => {
                        const pct = Math.max(
                          4,
                          Math.round((item.query_count / maxDomainCount) * 100),
                        )
                        return (
                          <li key={item.domain} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-slate-200 truncate">
                                {item.domain}
                              </span>
                              <span className="font-mono text-slate-400 shrink-0">
                                {item.query_count.toLocaleString()}
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-900">
                              <div
                                style={{ width: `${pct}%` }}
                                className="h-1.5 rounded-full bg-sky-500/70"
                              />
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                {/* Top Destination ASN Organizations */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-slate-100">
                      Top Destination Organizations (ASN)
                    </h3>
                  </div>

                  {topOrgs.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-500">
                      No external ASN organization packets logged in this window.
                    </p>
                  ) : (
                    <ul data-testid="drawer-top-orgs" className="space-y-2.5 text-xs">
                      {topOrgs.map((org) => (
                        <li
                          key={org.organization}
                          className="flex items-center justify-between border-b border-slate-800/60 pb-2 last:border-none"
                        >
                          <span className="text-slate-200 truncate">{org.organization}</span>
                          <div className="text-right font-mono text-slate-400 shrink-0">
                            <span className="text-slate-200">{formatBytes(org.bytes)}</span>
                            <span className="ml-2 text-[11px]">
                              ({org.packet_count.toLocaleString()} pkts)
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Chronological Recent Domain Queries Feed */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      Chronological Recent DNS Queries
                    </h3>
                    <p className="text-xs text-slate-400">
                      Most recent Unbound DNS lookups from this device
                    </p>
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      aria-label="Filter recent domains"
                      value={domainSearch}
                      onChange={(e) => setDomainSearch(e.target.value)}
                      placeholder="Filter domain (e.g. discord)..."
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                {recentQueries.length === 0 ? (
                  <p
                    data-testid="drawer-recent-empty"
                    className="py-6 text-center text-xs text-slate-500"
                  >
                    No recent DNS queries match the current filter.
                  </p>
                ) : (
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800">
                    <table
                      data-testid="drawer-recent-domains-table"
                      className="min-w-full divide-y divide-slate-800 text-left text-xs"
                    >
                      <thead className="bg-slate-900/90 font-semibold uppercase text-slate-400">
                        <tr>
                          <th className="px-3 py-2">Time</th>
                          <th className="px-3 py-2">Queried Domain</th>
                          <th className="px-3 py-2">Registered Domain</th>
                          <th className="px-3 py-2 text-right">Type</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {recentQueries.map((q, idx) => (
                          <tr key={`${q.timestamp}-${q.domain}-${idx}`}>
                            <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                              {new Date(q.timestamp).toLocaleTimeString()}
                            </td>
                            <td className="px-3 py-2 text-slate-100 break-all">{q.domain}</td>
                            <td className="px-3 py-2 text-slate-400">
                              {q.registered_domain ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-right text-indigo-300">
                              {q.record_type}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
