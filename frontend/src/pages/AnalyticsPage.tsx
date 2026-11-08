import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  Globe,
  HardDrive,
  Laptop,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Tv,
} from 'lucide-react'
import {
  apiClient,
  formatActiveMinutes,
  formatBlockedPercentage,
  formatBytes,
  formatClock24h,
  type TimeWindow,
} from '../api/client'
import { AppLayout, type AppTab } from '../components/AppLayout'
import { AutoRefreshSelector, useAutoRefresh } from '../components/AutoRefreshSelector'
import { DeviceAnalyticsDrawer } from '../components/DeviceAnalyticsDrawer'
import { TelemetryLoadingShell } from '../components/TelemetryLoadingShell'
import { TimelineBarChart } from '../components/TelemetryBarChart'

interface AnalyticsPageProps {
  activeTab?: AppTab
  onSelectTab?: (tab: AppTab) => void
}

const TIME_WINDOWS: { key: TimeWindow; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '1h', label: 'Last 1h' },
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7d' },
  { key: '30d', label: 'Last 30d' },
]

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({
  activeTab = 'analytics',
  onSelectTab,
}) => {
  const queryClient = useQueryClient()
  const [windowKey, setWindowKey] = useState<TimeWindow>('today')
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null)
  const { intervalOption, setIntervalOption, refetchInterval } = useAutoRefresh('30s')

  const {
    data: overview,
    dataUpdatedAt,
    isLoading,
    isFetching,
    isError,
    error,
  } = useQuery({
    queryKey: ['networkOverview', windowKey],
    queryFn: () => apiClient.getNetworkOverview({ window: windowKey }),
    refetchInterval,
    placeholderData: (previousData) => previousData,
  })

  const { data: healthReport } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: () => apiClient.getSystemHealth(),
    refetchInterval: 60_000,
  })

  const refreshMutation = useMutation({
    mutationFn: () => apiClient.getNetworkOverview({ window: windowKey, refresh: true }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(['networkOverview', windowKey], fresh)
    },
  })

  const summary = overview?.summary
  const timeline = overview?.timeline ?? []
  const topDevices = overview?.top_devices ?? []
  const topDomains = overview?.top_domains ?? []
  const topRegDomains = overview?.top_registered_domains ?? []
  const topOrgs = overview?.top_organizations ?? []
  const appUsage = overview?.application_usage ?? []

  const maxDomainCount = Math.max(1, ...topDomains.map((d) => d.query_count))
  const maxRegDomainCount = Math.max(1, ...topRegDomains.map((d) => d.query_count))
  const lastUpdatedClock = formatClock24h(overview?.generated_at || dataUpdatedAt)

  return (
    <AppLayout
      overallStatus={healthReport?.overall_status}
      version={healthReport?.version}
      activeTab={activeTab}
      onSelectTab={onSelectTab}
    >
      <div className="space-y-6">
        {/* Page Header & Time Window Selector */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">
              Network Traffic &amp; DNS Analytics
            </h1>
            <p className="text-sm text-slate-400">
              Live telemetry from Elasticsearch 9.4.3, Unbound DNS resolution and filterlog packet metrics
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-start gap-2 self-start shrink-0">
            <div
              className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1 shrink-0"
              role="group"
              aria-label="Select network analytics time window"
            >
              {TIME_WINDOWS.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  data-testid={`overview-window-${w.key}`}
                  onClick={() => setWindowKey(w.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                    windowKey === w.key
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="overview-refresh-btn"
                  aria-label="Refresh Analytics"
                  title="Refresh Analytics"
                  onClick={() => refreshMutation.mutate()}
                  disabled={isFetching || refreshMutation.isPending}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-500/40 bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60 cursor-pointer shrink-0"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${
                      isFetching || refreshMutation.isPending ? 'animate-spin' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>
                <AutoRefreshSelector
                  value={intervalOption}
                  onChange={setIntervalOption}
                  testId="overview-auto-refresh-select"
                />
              </div>
              {lastUpdatedClock && (
                <span
                  data-testid="overview-last-updated"
                  className="text-[11px] font-mono text-slate-400"
                >
                  Updated: {lastUpdatedClock}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Warning / Error Banner */}
        {(overview?.warning || isError) && (
          <div
            role="alert"
            data-testid="overview-warning-banner"
            className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200"
          >
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {overview?.warning ??
                (error instanceof Error ? error.message : 'Failed to load Elasticsearch analytics.')}
            </span>
          </div>
        )}

        {/* KPI Summary Cards & Main Content Wrapped in TelemetryLoadingShell */}
        <TelemetryLoadingShell
          isLoading={isLoading}
          isFetching={isFetching || refreshMutation.isPending}
          loadingMessage="Refreshing telemetry from Elasticsearch..."
          testId="overview-telemetry-shell"
        >
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div
            data-testid="overview-kpi-events"
            className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Total Telemetry Events</span>
              <Activity className="h-4 w-4 text-indigo-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-100">
              {(summary?.total_events ?? 0).toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Window: {windowKey.toUpperCase()}
            </p>
          </div>

          <div
            data-testid="overview-kpi-bytes"
            className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Firewall Logged Volume</span>
              <HardDrive className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-emerald-300">
              {formatBytes(summary?.total_bytes ?? 0)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {(summary?.firewall_event_count ?? 0).toLocaleString()} filterlog records
            </p>
          </div>

          <div
            data-testid="overview-kpi-dns"
            className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Unbound DNS Queries</span>
              <Globe className="h-4 w-4 text-sky-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-sky-300">
              {(summary?.dns_query_count ?? 0).toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-slate-400">Domain lookups resolved</p>
          </div>

          <div
            data-testid="overview-kpi-blocked"
            className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Blocked Firewall Packets</span>
              <ShieldAlert className="h-4 w-4 text-rose-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-rose-300">
              {(summary?.blocked_packet_count ?? 0).toLocaleString()}{' '}
              <span
                data-testid="overview-kpi-blocked-pct"
                className="text-sm font-semibold text-rose-400"
              >
                ({formatBlockedPercentage(summary?.blocked_packet_count ?? 0, summary?.allowed_packet_count ?? 0)})
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {(summary?.allowed_packet_count ?? 0).toLocaleString()} allowed packets
            </p>
          </div>
        </div>

        {isLoading && !overview ? (
          <div
            data-testid="overview-loading"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-10 text-center text-sm text-slate-400"
          >
            Aggregating network-wide telemetry from Elasticsearch 9.4.3...
          </div>
        ) : (
          <>
            {/* Application Usage Stats (FB-P6-004, FB-P8-001, FB-P8-002, FB-P8-007) */}
            <div
              data-testid="overview-app-usage-panel"
              className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Tv className="h-4 w-4 text-rose-400" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      Application Usage Stats
                    </h2>
                    <p className="text-xs text-slate-400">
                      Estimated active usage time derived from 5-minute client activity buckets across LAN devices
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(['youtube', 'plex'] as const).map((appKey) => {
                  const item = appUsage.find((a) => a.app_key === appKey) ?? {
                    app_key: appKey,
                    display_name: appKey === 'youtube' ? 'YouTube' : 'Plex',
                    active_minutes: 0,
                    event_count: 0,
                    dns_queries: 0,
                    bytes: 0,
                    last_active_at: null,
                    top_devices: [],
                  }
                  const isYoutube = appKey === 'youtube'
                  const appTopDevices = (item.top_devices ?? []).slice(0, 3)
                  const activeSessions = item.active_sessions ?? []

                  return (
                    <div
                      key={appKey}
                      data-testid={`overview-app-card-${appKey}`}
                      className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-bold uppercase tracking-wide ${
                              isYoutube ? 'text-rose-400' : 'text-amber-400'
                            }`}
                          >
                            {item.display_name}
                          </span>
                          {!isYoutube && activeSessions.length > 0 && (
                            <span
                              data-testid="overview-plex-live-badge"
                              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300"
                            >
                              <Play className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                              {activeSessions.length} Now Playing
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">
                          {item.last_active_at
                            ? `Last active ${new Date(item.last_active_at).toLocaleTimeString([], {
                                hour12: false,
                              })}`
                            : 'No recent activity'}
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="block text-[10px] text-slate-500">
                            Active Time
                          </span>
                          <span
                            data-testid={`overview-app-minutes-${appKey}`}
                            className="font-mono text-sm font-bold text-slate-100"
                          >
                            {formatActiveMinutes(item.active_minutes)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-500">
                            DNS Queries
                          </span>
                          <span className="font-mono text-sm font-semibold text-sky-300">
                            {(item.dns_queries ?? 0).toLocaleString()}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[10px] text-slate-500">
                            Bandwidth
                          </span>
                          <span className="font-mono text-sm font-semibold text-emerald-300">
                            {formatBytes(item.bytes ?? 0)}
                          </span>
                        </div>
                      </div>

                      {/* Live Plex Active Sessions (FB-P9-005) */}
                      {!isYoutube && activeSessions.length > 0 && (
                        <div
                          data-testid="overview-plex-now-playing"
                          className="mt-3 rounded-md border border-amber-500/30 bg-amber-950/20 p-2.5 space-y-1.5"
                        >
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                            Active Plex Streams
                          </span>
                          <ul className="space-y-1 text-xs">
                            {activeSessions.map((sess) => (
                              <li
                                key={sess.session_key}
                                className="flex items-center justify-between gap-2 text-[11px]"
                              >
                                <div className="min-w-0 truncate">
                                  <span className="font-semibold text-slate-100">
                                    {sess.effective_name}
                                  </span>
                                  <span className="mx-1 text-slate-500">·</span>
                                  <span className="text-amber-200">{sess.media_title}</span>
                                </div>
                                <span className="shrink-0 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-300">
                                  {sess.state} · {sess.stream_decision}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Top 3 Devices Breakdown (FB-P8-002) */}
                      <div
                        data-testid={`overview-app-top-devices-${appKey}`}
                        className="mt-3 border-t border-slate-800/80 pt-2.5"
                      >
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                          Top 3 Devices ({windowKey})
                        </span>
                        {appTopDevices.length === 0 ? (
                          <p className="text-[11px] text-slate-500">
                            No active client devices in this window.
                          </p>
                        ) : (
                          <ul className="space-y-1 text-xs">
                            {appTopDevices.map((dev, idx) => (
                              <li
                                key={`${dev.ipv4_address}-${idx}`}
                                className="flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0 flex items-center gap-1.5 truncate">
                                  <span className="font-mono text-[10px] text-slate-500">
                                    #{idx + 1}
                                  </span>
                                  {dev.device_id !== null ? (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedDeviceId(dev.device_id)}
                                      className="font-medium text-slate-200 hover:text-indigo-300 truncate cursor-pointer"
                                    >
                                      {dev.effective_name}
                                    </button>
                                  ) : (
                                    <span className="font-medium text-slate-200 truncate">
                                      {dev.effective_name}
                                    </span>
                                  )}
                                  {dev.effective_name !== dev.ipv4_address && (
                                    <span className="font-mono text-[10px] text-slate-500">
                                      ({dev.ipv4_address})
                                    </span>
                                  )}
                                </div>
                                <span className="shrink-0 font-mono text-xs font-semibold text-indigo-300">
                                  {formatActiveMinutes(dev.active_minutes)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Network Activity Timeline (FB-P8-004 & FB-P8-005) */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      Network Activity &amp; DNS Query Timeline ({windowKey})
                    </h2>
                    <p className="text-xs text-slate-400">
                      Combined DNS queries and firewall packet activity across all interfaces
                    </p>
                  </div>
                </div>
              </div>

              <TimelineBarChart
                timeline={timeline}
                windowKey={windowKey}
                prefixTestId="overview-timeline"
                chartTestId="overview-timeline-chart"
                legendTestId="overview-timeline-legend"
              />
            </div>

            {/* Top Active LAN Devices Table */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 shadow overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
                <div className="flex items-center gap-2">
                  <Laptop className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      Top Active LAN Devices (RFC1918)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Enriched with SQLite device inventory, click Inspect to view 24h access hours &amp; domains
                    </p>
                  </div>
                </div>
              </div>

              {topDevices.length === 0 ? (
                <p className="p-8 text-center text-xs text-slate-500">
                  No LAN device traffic found in this window.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    data-testid="overview-top-devices-table"
                    className="min-w-full divide-y divide-slate-800 text-left text-sm"
                  >
                    <thead className="bg-slate-950/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Device</th>
                        <th className="px-4 py-3">IPv4 &amp; Vendor</th>
                        <th className="px-4 py-3 text-right">DNS Queries</th>
                        <th className="px-4 py-3 text-right">Firewall Bytes</th>
                        <th className="px-4 py-3 text-right">Total Events</th>
                        <th className="px-4 py-3 text-right">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {topDevices.map((dev) => (
                        <tr
                          key={dev.ipv4_address}
                          data-testid={`top-device-row-${dev.ipv4_address}`}
                          className="hover:bg-slate-800/40"
                        >
                          <td className="px-4 py-3 font-semibold text-slate-100">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  dev.is_online ? 'bg-emerald-400' : 'bg-slate-600'
                                }`}
                              />
                              <span>{dev.effective_name}</span>
                              {dev.is_blocked && (
                                <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                                  Blocked
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-300">
                            <div>{dev.ipv4_address}</div>
                            {dev.vendor && (
                              <div className="text-[11px] font-sans text-slate-400">
                                {dev.vendor}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-sky-300">
                            {dev.dns_queries.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-emerald-300">
                            {formatBytes(dev.bytes)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-slate-200">
                            {dev.total_events.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {dev.device_id !== null ? (
                              <button
                                type="button"
                                data-testid={`inspect-top-device-${dev.device_id}`}
                                aria-label="Inspect"
                                title={`Inspect ${dev.effective_name}`}
                                onClick={() => setSelectedDeviceId(dev.device_id)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25 cursor-pointer"
                              >
                                <Search className="h-4 w-4" aria-hidden="true" />
                              </button>
                            ) : (
                              <span className="text-xs text-slate-500">Unregistered IP</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Domain & Organization Cards */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Top Queried FQDNs */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow">
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="h-4 w-4 text-sky-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-slate-100">
                    Top Queried Domains (FQDN)
                  </h2>
                </div>
                {topDomains.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">No DNS queries found.</p>
                ) : (
                  <ul data-testid="overview-top-domains" className="space-y-2 text-xs">
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
                          <div className="h-1.5 w-full rounded-full bg-slate-950">
                            <div
                              style={{ width: `${pct}%` }}
                              className="h-1.5 rounded-full bg-sky-500/75"
                            />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              {/* Top Registered Root Domains */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow">
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-slate-100">
                    Top Registered Root Domains
                  </h2>
                </div>
                {topRegDomains.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No registered domains found.
                  </p>
                ) : (
                  <ul data-testid="overview-top-reg-domains" className="space-y-2 text-xs">
                    {topRegDomains.map((item) => {
                      const pct = Math.max(
                        4,
                        Math.round((item.query_count / maxRegDomainCount) * 100),
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
                          <div className="h-1.5 w-full rounded-full bg-slate-950">
                            <div
                              style={{ width: `${pct}%` }}
                              className="h-1.5 rounded-full bg-indigo-500/75"
                            />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              {/* Top Destination ASN Organizations */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow">
                <div className="flex items-center gap-2 mb-3">
                  <Building2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-slate-100">
                    Top Destination Organizations (ASN)
                  </h2>
                </div>
                {topOrgs.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No destination ASN organizations found.
                  </p>
                ) : (
                  <ul data-testid="overview-top-orgs" className="space-y-2.5 text-xs">
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
          </>
        )}
        </TelemetryLoadingShell>

        {/* Per-Device Analytics Slide-Over Drawer */}
        <DeviceAnalyticsDrawer
          deviceId={selectedDeviceId}
          initialWindow={windowKey}
          onClose={() => setSelectedDeviceId(null)}
        />
      </div>
    </AppLayout>
  )
}
