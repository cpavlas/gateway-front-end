import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  BarChart3,
  Building2,
  Globe,
  HardDrive,
  Laptop,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Tv,
  X,
} from 'lucide-react'
import {
  apiClient,
  formatActiveMinutes,
  formatBlockedPercentage,
  formatBytes,
  formatClock24h,
  type AppUsageKey,
  type AttributionTargetType,
  type BlockedTargetCreatePayload,
  type BlockScopeType,
  type BlockTargetType,
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

type OverviewDeviceSortField = 'name' | 'ipv4' | 'dns' | 'bytes' | 'events'
type SortDirection = 'asc' | 'desc'

const APP_USAGE_CATALOG: ReadonlyArray<{
  key: AppUsageKey
  displayName: string
  colorClass: string
}> = [
  { key: 'youtube', displayName: 'YouTube', colorClass: 'text-rose-400' },
  { key: 'plex', displayName: 'Plex', colorClass: 'text-amber-400' },
  { key: 'netflix', displayName: 'Netflix', colorClass: 'text-red-400' },
  { key: 'disney_plus', displayName: 'Disney+', colorClass: 'text-cyan-400' },
  { key: 'twitch', displayName: 'Twitch', colorClass: 'text-violet-400' },
  { key: 'tiktok', displayName: 'TikTok', colorClass: 'text-pink-400' },
  { key: 'discord', displayName: 'Discord', colorClass: 'text-indigo-400' },
  { key: 'gaming', displayName: 'Gaming', colorClass: 'text-emerald-400' },
]

function parseIpv4Sortable(ip: string | null): number {
  if (!ip) return Number.MAX_SAFE_INTEGER
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return Number.MAX_SAFE_INTEGER
  }
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0)
}

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({
  activeTab = 'analytics',
  onSelectTab,
}) => {
  const queryClient = useQueryClient()
  const [windowKey, setWindowKey] = useState<TimeWindow>('today')
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null)
  const [deviceSearch, setDeviceSearch] = useState('')
  const [sortField, setSortField] = useState<OverviewDeviceSortField>('bytes')
  const [sortDir, setSortDir] = useState<SortDirection>('desc')
  const [drilldownTarget, setDrilldownTarget] = useState<{
    targetType: AttributionTargetType
    targetValue: string
    label: string
    asn?: number | null
    organization?: string
  } | null>(null)
  const [blockBanner, setBlockBanner] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const [manualType, setManualType] = useState<BlockTargetType>('domain')
  const [manualValue, setManualValue] = useState('')
  const [manualScope, setManualScope] = useState<BlockScopeType>('global')
  const [manualDeviceId, setManualDeviceId] = useState<string>('')
  const [manualReason, setManualReason] = useState('')
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

  const { data: blockedTargetsData } = useQuery({
    queryKey: ['blockedTargets'],
    queryFn: () => apiClient.getBlockedTargets(),
  })

  const { data: devicesListData } = useQuery({
    queryKey: ['devices'],
    queryFn: () => apiClient.getDevices(),
  })

  const {
    data: attributionData,
    isLoading: isAttributionLoading,
    isError: isAttributionError,
    error: attributionError,
  } = useQuery({
    queryKey: [
      'targetAttribution',
      drilldownTarget?.targetType,
      drilldownTarget?.targetValue,
      windowKey,
    ],
    queryFn: () =>
      apiClient.getTargetAttribution(
        drilldownTarget!.targetType,
        drilldownTarget!.targetValue,
        windowKey,
      ),
    enabled: drilldownTarget !== null,
  })

  const refreshMutation = useMutation({
    mutationFn: () => apiClient.getNetworkOverview({ window: windowKey, refresh: true }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(['networkOverview', windowKey], fresh)
    },
  })

  const createBlockMutation = useMutation({
    mutationFn: (payload: BlockedTargetCreatePayload) => apiClient.createBlockedTarget(payload),
    onSuccess: (res) => {
      setManualValue('')
      setManualReason('')
      setBlockBanner({
        type: 'success',
        text: res.warning
          ? `Saved ${res.item.target_value}: ${res.warning}`
          : `Blocked ${res.item.target_value} (${res.item.scope_type}) and synchronized OPNsense.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['blockedTargets'] })
      void queryClient.invalidateQueries({ queryKey: ['systemHealth'] })
    },
    onError: (err: unknown) => {
      setBlockBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create custom block rule.',
      })
    },
  })

  const toggleBlockMutation = useMutation({
    mutationFn: (id: number) => apiClient.toggleBlockedTarget(id),
    onSuccess: (res) => {
      setBlockBanner({
        type: 'success',
        text: `${res.item.target_value} is now ${res.item.is_enabled ? 'enabled' : 'paused'}.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['blockedTargets'] })
      void queryClient.invalidateQueries({ queryKey: ['systemHealth'] })
    },
    onError: (err: unknown) => {
      setBlockBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update custom block rule.',
      })
    },
  })

  const deleteBlockMutation = useMutation({
    mutationFn: (id: number) => apiClient.deleteBlockedTarget(id),
    onSuccess: () => {
      setBlockBanner({
        type: 'success',
        text: 'Removed custom block rule and synchronized OPNsense aliases.',
      })
      void queryClient.invalidateQueries({ queryKey: ['blockedTargets'] })
      void queryClient.invalidateQueries({ queryKey: ['systemHealth'] })
    },
    onError: (err: unknown) => {
      setBlockBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to remove custom block rule.',
      })
    },
  })

  const toggleSort = (field: OverviewDeviceSortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir(field === 'name' || field === 'ipv4' ? 'asc' : 'desc')
    }
  }

  const summary = overview?.summary
  const timeline = overview?.timeline ?? []
  const topDevices = overview?.top_devices ?? []
  const topDomains = overview?.top_domains ?? []
  const topRegDomains = overview?.top_registered_domains ?? []
  const topOrgs = overview?.top_organizations ?? []
  const appUsage = overview?.application_usage ?? []
  const blockedTargets = blockedTargetsData?.items ?? []
  const activeCustomBlockCount = Number(
    blockedTargetsData?.enabled_count ??
      healthReport?.services?.sqlite?.details?.custom_blocked_targets_count ??
      0,
  )
  const blockableDevices = (devicesListData?.devices ?? []).filter(
    (d) => !d.is_protected && !d.is_archived,
  )

  const globalBlockedDomains = new Set(
    blockedTargets
      .filter((b) => b.is_enabled && b.target_type === 'domain' && b.scope_type === 'global')
      .map((b) => b.target_value.toLowerCase()),
  )
  const globalBlockedAsns = new Set(
    blockedTargets
      .filter((b) => b.is_enabled && b.target_type === 'asn' && b.scope_type === 'global')
      .map((b) => b.target_value.toUpperCase()),
  )

  const filteredSortedDevices = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase()
    const base = !q
      ? [...topDevices]
      : topDevices.filter(
          (d) =>
            d.effective_name.toLowerCase().includes(q) ||
            d.ipv4_address.toLowerCase().includes(q) ||
            (d.vendor && d.vendor.toLowerCase().includes(q)) ||
            (d.mac_address && d.mac_address.toLowerCase().includes(q)),
        )
    base.sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') {
        cmp = a.effective_name.localeCompare(b.effective_name, undefined, { sensitivity: 'base' })
      } else if (sortField === 'ipv4') {
        cmp = parseIpv4Sortable(a.ipv4_address) - parseIpv4Sortable(b.ipv4_address)
      } else if (sortField === 'dns') {
        cmp = a.dns_queries - b.dns_queries
      } else if (sortField === 'events') {
        cmp = a.total_events - b.total_events
      } else {
        cmp = a.bytes - b.bytes
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return base
  }, [topDevices, deviceSearch, sortField, sortDir])

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
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-bold text-slate-100">
                Network Traffic &amp; DNS Analytics
              </h1>
              <span
                data-testid="overview-blocked-targets-count"
                className="inline-flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-200"
              >
                <Ban className="h-3 w-3" aria-hidden="true" />
                {activeCustomBlockCount} Custom Blocks Active
              </span>
            </div>
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {APP_USAGE_CATALOG.map(({ key: appKey, displayName, colorClass }) => {
                  const item = appUsage.find((a) => a.app_key === appKey) ?? {
                    app_key: appKey,
                    display_name: displayName,
                    active_minutes: 0,
                    event_count: 0,
                    dns_queries: 0,
                    bytes: 0,
                    last_active_at: null,
                    top_devices: [],
                  }
                  const isPlex = appKey === 'plex'
                  const appTopDevices = (item.top_devices ?? []).slice(0, 3)
                  const activeSessions = item.active_sessions ?? []

                  return (
                    <div
                      key={appKey}
                      data-testid={`overview-app-card-${appKey}`}
                      className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-bold uppercase tracking-wide ${colorClass}`}
                          >
                            {item.display_name}
                          </span>
                          {isPlex && activeSessions.length > 0 && (
                            <span
                              data-testid="overview-plex-live-badge"
                              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300"
                            >
                              <Play className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                              {activeSessions.length} Now Playing
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-slate-400 truncate">
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

                      {/* Live Plex Active Sessions (FB-P9-005, FB-P18-002) */}
                      {isPlex && activeSessions.length > 0 && (
                        <div
                          data-testid="overview-plex-now-playing"
                          className="mt-3 rounded-md border border-amber-500/30 bg-amber-950/20 p-2.5 space-y-2"
                        >
                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                            Active Plex Streams
                          </span>
                          <ul className="space-y-2 text-xs">
                            {activeSessions.map((sess) => {
                              const bitrateKbps =
                                sess.transcode_bitrate_kbps ?? sess.bandwidth_kbps ?? 0
                              const pct = Math.max(0, Math.min(100, sess.progress_percent ?? 0))
                              return (
                                <li
                                  key={sess.session_key}
                                  className="space-y-1 text-[11px]"
                                >
                                  <div className="flex items-center justify-between gap-2">
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
                                  </div>
                                  <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-300">
                                    <span>
                                      {sess.user_name ? `User: ${sess.user_name}` : sess.player_title}
                                      {sess.video_resolution ? ` · ${sess.video_resolution}` : ''}
                                    </span>
                                    <span className="font-mono text-amber-300">
                                      {bitrateKbps > 0
                                        ? `${(bitrateKbps / 1000).toFixed(1)} Mbps · `
                                        : ''}
                                      {pct}%
                                    </span>
                                  </div>
                                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-950">
                                    <div
                                      className="h-full rounded-full bg-amber-400"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </li>
                              )
                            })}
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 px-5 py-4">
                <div className="flex items-center gap-2">
                  <Laptop className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      Top Active LAN Devices (RFC1918)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Enriched with SQLite device inventory, click column headers to sort or Inspect to view 24h access hours &amp; domains
                    </p>
                  </div>
                </div>

                <div className="relative w-full sm:w-64">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    data-testid="overview-devices-search-input"
                    aria-label="Filter active LAN devices"
                    value={deviceSearch}
                    onChange={(e) => setDeviceSearch(e.target.value)}
                    placeholder="Filter by name, IP, or vendor..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {filteredSortedDevices.length === 0 ? (
                <p className="p-8 text-center text-xs text-slate-500">
                  {topDevices.length === 0
                    ? 'No LAN device traffic found in this window.'
                    : 'No LAN devices match your search filter.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    data-testid="overview-top-devices-table"
                    className="min-w-full divide-y divide-slate-800 text-left text-sm"
                  >
                    <thead className="bg-slate-950/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="px-4 py-3">
                          <button
                            type="button"
                            data-testid="sort-top-devices-name"
                            onClick={() => toggleSort('name')}
                            className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 cursor-pointer"
                          >
                            <span>Device</span>
                            {sortField === 'name' ? (
                              sortDir === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                            )}
                          </button>
                        </th>
                        <th className="px-4 py-3">
                          <button
                            type="button"
                            data-testid="sort-top-devices-ipv4"
                            onClick={() => toggleSort('ipv4')}
                            className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 cursor-pointer"
                          >
                            <span>IPv4 &amp; Vendor</span>
                            {sortField === 'ipv4' ? (
                              sortDir === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                            )}
                          </button>
                        </th>
                        <th className="px-4 py-3 text-right">
                          <button
                            type="button"
                            data-testid="sort-top-devices-dns"
                            onClick={() => toggleSort('dns')}
                            className="inline-flex items-center justify-end gap-1 uppercase tracking-wider hover:text-slate-200 cursor-pointer"
                          >
                            <span>DNS Queries</span>
                            {sortField === 'dns' ? (
                              sortDir === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                            )}
                          </button>
                        </th>
                        <th className="px-4 py-3 text-right">
                          <button
                            type="button"
                            data-testid="sort-top-devices-bytes"
                            onClick={() => toggleSort('bytes')}
                            className="inline-flex items-center justify-end gap-1 uppercase tracking-wider hover:text-slate-200 cursor-pointer"
                          >
                            <span>Firewall Bytes</span>
                            {sortField === 'bytes' ? (
                              sortDir === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                            )}
                          </button>
                        </th>
                        <th className="px-4 py-3 text-right">
                          <button
                            type="button"
                            data-testid="sort-top-devices-events"
                            onClick={() => toggleSort('events')}
                            className="inline-flex items-center justify-end gap-1 uppercase tracking-wider hover:text-slate-200 cursor-pointer"
                          >
                            <span>Total Events</span>
                            {sortField === 'events' ? (
                              sortDir === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                            )}
                          </button>
                        </th>
                        <th className="px-4 py-3 text-right">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {filteredSortedDevices.map((dev) => (
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
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-sky-400" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-slate-100">
                      Top Queried Domains (FQDN)
                    </h2>
                  </div>
                  <span className="text-[10px] text-slate-500">Click row for clients</span>
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
                      const isBlocked = globalBlockedDomains.has(item.domain.toLowerCase())
                      return (
                        <li key={item.domain} className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              data-testid={`drilldown-domain-${item.domain}`}
                              onClick={() =>
                                setDrilldownTarget({
                                  targetType: 'domain',
                                  targetValue: item.domain,
                                  label: item.domain,
                                })
                              }
                              className="min-w-0 truncate font-mono text-left text-slate-200 hover:text-sky-300 hover:underline cursor-pointer"
                            >
                              {item.domain}
                            </button>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="font-mono text-slate-400">
                                {item.query_count.toLocaleString()}
                              </span>
                              <button
                                type="button"
                                data-testid={`block-domain-btn-${item.domain}`}
                                disabled={createBlockMutation.isPending || isBlocked}
                                onClick={() =>
                                  createBlockMutation.mutate({
                                    target_type: 'domain',
                                    target_value: item.domain,
                                    scope_type: 'global',
                                    reason: 'Blocked from Analytics Top Queried Domains',
                                  })
                                }
                                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer disabled:opacity-60 ${
                                  isBlocked
                                    ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                                    : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-rose-500/50 hover:text-rose-200'
                                }`}
                              >
                                <Ban className="h-2.5 w-2.5" aria-hidden="true" />
                                <span>{isBlocked ? 'Blocked' : 'Block'}</span>
                              </button>
                            </div>
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
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-slate-100">
                      Top Registered Root Domains
                    </h2>
                  </div>
                  <span className="text-[10px] text-slate-500">Click row for clients</span>
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
                      const isBlocked = globalBlockedDomains.has(item.domain.toLowerCase())
                      return (
                        <li key={item.domain} className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              data-testid={`drilldown-reg-domain-${item.domain}`}
                              onClick={() =>
                                setDrilldownTarget({
                                  targetType: 'registered_domain',
                                  targetValue: item.domain,
                                  label: item.domain,
                                })
                              }
                              className="min-w-0 truncate font-mono text-left text-slate-200 hover:text-indigo-300 hover:underline cursor-pointer"
                            >
                              {item.domain}
                            </button>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="font-mono text-slate-400">
                                {item.query_count.toLocaleString()}
                              </span>
                              <button
                                type="button"
                                data-testid={`block-reg-domain-btn-${item.domain}`}
                                disabled={createBlockMutation.isPending || isBlocked}
                                onClick={() =>
                                  createBlockMutation.mutate({
                                    target_type: 'domain',
                                    target_value: item.domain,
                                    scope_type: 'global',
                                    reason: 'Blocked from Analytics Top Registered Domains',
                                  })
                                }
                                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer disabled:opacity-60 ${
                                  isBlocked
                                    ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                                    : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-rose-500/50 hover:text-rose-200'
                                }`}
                              >
                                <Ban className="h-2.5 w-2.5" aria-hidden="true" />
                                <span>{isBlocked ? 'Blocked' : 'Block'}</span>
                              </button>
                            </div>
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
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-slate-100">
                      Top Destination Organizations (ASN)
                    </h2>
                  </div>
                  <span className="text-[10px] text-slate-500">Click row for clients</span>
                </div>
                {topOrgs.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No destination ASN organizations found.
                  </p>
                ) : (
                  <ul data-testid="overview-top-orgs" className="space-y-2.5 text-xs">
                    {topOrgs.map((org) => {
                      const asnTag = org.asn != null ? `AS${org.asn}` : null
                      const isBlocked = asnTag !== null && globalBlockedAsns.has(asnTag)
                      return (
                        <li
                          key={org.organization}
                          className="flex items-center justify-between gap-2 border-b border-slate-800/60 pb-2 last:border-none"
                        >
                          <button
                            type="button"
                            data-testid={`drilldown-org-${org.organization}`}
                            onClick={() =>
                              setDrilldownTarget({
                                targetType: asnTag ? 'asn' : 'organization',
                                targetValue: asnTag ?? org.organization,
                                label: asnTag ? `${org.organization} (${asnTag})` : org.organization,
                                asn: org.asn,
                                organization: org.organization,
                              })
                            }
                            className="min-w-0 truncate text-left text-slate-200 hover:text-emerald-300 hover:underline cursor-pointer"
                          >
                            <span>{org.organization}</span>
                            {asnTag && (
                              <span className="ml-1.5 font-mono text-[10px] text-indigo-300">
                                ({asnTag})
                              </span>
                            )}
                          </button>
                          <div className="flex items-center gap-2 font-mono text-slate-400 shrink-0">
                            <span className="text-slate-200">{formatBytes(org.bytes)}</span>
                            <span className="text-[11px]">
                              ({org.packet_count.toLocaleString()} pkts)
                            </span>
                            {asnTag && (
                              <button
                                type="button"
                                data-testid={`block-org-btn-${org.organization}`}
                                disabled={createBlockMutation.isPending || isBlocked}
                                onClick={() =>
                                  createBlockMutation.mutate({
                                    target_type: 'asn',
                                    target_value: asnTag,
                                    scope_type: 'global',
                                    organization_name: org.organization,
                                    reason: `Blocked ${org.organization} from Analytics`,
                                  })
                                }
                                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-sans text-[10px] font-semibold cursor-pointer disabled:opacity-60 ${
                                  isBlocked
                                    ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                                    : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-rose-500/50 hover:text-rose-200'
                                }`}
                              >
                                <Ban className="h-2.5 w-2.5" aria-hidden="true" />
                                <span>{isBlocked ? 'Blocked' : 'Block'}</span>
                              </button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* Custom Domain & ASN Blocklist Management Panel (FB-P18-001) */}
            <div
              data-testid="blocked-targets-panel"
              className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Ban className="h-4 w-4 text-rose-400" aria-hidden="true" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      Blocked Domains &amp; ASN Organizations
                    </h2>
                    <p className="text-xs text-slate-400">
                      Managed OPNsense block rules enforced across the gateway or per device
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-0.5 font-mono text-xs text-slate-300">
                  {blockedTargetsData?.enabled_count ?? 0} active / {blockedTargets.length} total
                </span>
              </div>

              {blockBanner && (
                <div
                  role="alert"
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                    blockBanner.type === 'error'
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  }`}
                >
                  <span>{blockBanner.text}</span>
                  <button
                    type="button"
                    onClick={() => setBlockBanner(null)}
                    className="ml-3 underline opacity-80 hover:opacity-100 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const trimmed = manualValue.trim()
                  if (!trimmed) return
                  createBlockMutation.mutate({
                    target_type: manualType,
                    target_value: trimmed,
                    scope_type: manualScope,
                    device_id:
                      manualScope === 'device' && manualDeviceId
                        ? Number(manualDeviceId)
                        : null,
                    reason: manualReason.trim() || 'Manual block rule',
                  })
                }}
                className="grid grid-cols-1 gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:grid-cols-12"
              >
                <select
                  aria-label="Block target type"
                  data-testid="manual-block-type-select"
                  value={manualType}
                  onChange={(e) => setManualType(e.target.value as BlockTargetType)}
                  className="sm:col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="domain">Domain / Host</option>
                  <option value="asn">ASN (e.g. AS15169)</option>
                </select>

                <input
                  type="text"
                  data-testid="manual-block-value-input"
                  aria-label="Domain or ASN to block"
                  value={manualValue}
                  onChange={(e) => setManualValue(e.target.value)}
                  placeholder={manualType === 'domain' ? 'ads.tiktok.com' : 'AS15169'}
                  className="sm:col-span-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />

                <select
                  aria-label="Block rule scope"
                  data-testid="manual-block-scope-select"
                  value={manualScope}
                  onChange={(e) => setManualScope(e.target.value as BlockScopeType)}
                  className="sm:col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="global">Global (All LAN)</option>
                  <option value="device">Single Device</option>
                </select>

                {manualScope === 'device' ? (
                  <select
                    aria-label="Select device to block target for"
                    data-testid="manual-block-device-select"
                    value={manualDeviceId}
                    onChange={(e) => setManualDeviceId(e.target.value)}
                    className="sm:col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Choose device...</option>
                    {blockableDevices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.effective_name} ({d.ipv4_address ?? 'No IP'})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    aria-label="Optional block reason"
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                    placeholder="Reason (optional)..."
                    className="sm:col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                )}

                <button
                  type="submit"
                  data-testid="add-blocked-target-btn"
                  disabled={
                    createBlockMutation.isPending ||
                    !manualValue.trim() ||
                    (manualScope === 'device' && !manualDeviceId)
                  }
                  className="sm:col-span-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-60 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Block Rule</span>
                </button>
              </form>

              {blockedTargets.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-500">
                  No custom domain or ASN block rules configured yet. Use any Block button above or add one manually.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                    <thead className="bg-slate-950/70 font-semibold uppercase text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Target</th>
                        <th className="px-3 py-2">Scope</th>
                        <th className="px-3 py-2">Reason / Org</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {blockedTargets.map((rule) => (
                        <tr key={rule.id} data-testid={`blocked-target-row-${rule.id}`}>
                          <td className="px-3 py-2 font-mono uppercase text-slate-300">
                            {rule.target_type}
                          </td>
                          <td className="px-3 py-2 font-mono font-semibold text-slate-100">
                            {rule.target_value}
                          </td>
                          <td className="px-3 py-2 text-slate-300">
                            {rule.scope_type === 'global'
                              ? 'Global LAN'
                              : `${rule.device_name ?? 'Device'} (${rule.device_ip ?? ''})`}
                          </td>
                          <td className="px-3 py-2 text-slate-400">
                            {rule.organization_name || rule.reason || '-'}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              data-testid={`toggle-blocked-target-btn-${rule.id}`}
                              disabled={toggleBlockMutation.isPending}
                              onClick={() => toggleBlockMutation.mutate(rule.id)}
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold cursor-pointer ${
                                rule.is_enabled
                                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                                  : 'border-slate-700 bg-slate-950 text-slate-400'
                              }`}
                            >
                              {rule.is_enabled ? 'Active' : 'Paused'}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              data-testid={`unblock-target-btn-${rule.id}`}
                              disabled={deleteBlockMutation.isPending}
                              onClick={() => deleteBlockMutation.mutate(rule.id)}
                              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:border-emerald-500/50 hover:text-emerald-200 cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" aria-hidden="true" />
                              <span>Unblock</span>
                            </button>
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
        </TelemetryLoadingShell>

        {/* Per-Device Analytics Slide-Over Drawer */}
        <DeviceAnalyticsDrawer
          deviceId={selectedDeviceId}
          initialWindow={windowKey}
          onClose={() => setSelectedDeviceId(null)}
        />

        {/* Client Attribution Drilldown Modal (FB-P18-003) */}
        {drilldownTarget && (
          <div
            data-testid="attribution-drilldown-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Client Attribution for ${drilldownTarget.label}`}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
          >
            <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-5 py-4">
                <div>
                  <h2 className="text-base font-bold text-slate-100">
                    Client Attribution: <span className="font-mono text-indigo-300">{drilldownTarget.label}</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    LAN devices generating telemetry for this target ({windowKey})
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {(drilldownTarget.targetType === 'domain' ||
                    drilldownTarget.targetType === 'registered_domain' ||
                    drilldownTarget.asn != null ||
                    drilldownTarget.targetType === 'asn') && (
                    <button
                      type="button"
                      data-testid="modal-block-global-btn"
                      disabled={createBlockMutation.isPending}
                      onClick={() =>
                        createBlockMutation.mutate({
                          target_type:
                            drilldownTarget.targetType === 'asn' ? 'asn' : 'domain',
                          target_value: drilldownTarget.targetValue,
                          scope_type: 'global',
                          organization_name: drilldownTarget.organization ?? '',
                          reason: 'Blocked via Attribution Drilldown',
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 cursor-pointer"
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Block Globally</span>
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Close attribution modal"
                    onClick={() => setDrilldownTarget(null)}
                    className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {isAttributionLoading ? (
                  <p className="py-8 text-center text-xs text-slate-400">
                    Querying LAN client attribution from Elasticsearch...
                  </p>
                ) : isAttributionError ? (
                  <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                    {attributionError instanceof Error
                      ? attributionError.message
                      : 'Failed to load client attribution.'}
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
                      <span>
                        Total Events:{' '}
                        <strong className="font-mono text-slate-100">
                          {(attributionData?.total_events ?? 0).toLocaleString()}
                        </strong>
                      </span>
                      <span>
                        Total Bytes:{' '}
                        <strong className="font-mono text-emerald-300">
                          {formatBytes(attributionData?.total_bytes ?? 0)}
                        </strong>
                      </span>
                    </div>

                    {(attributionData?.clients ?? []).length === 0 ? (
                      <p className="py-6 text-center text-xs text-slate-500">
                        No LAN client activity recorded for this target in the selected window.
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-slate-800">
                        <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                          <thead className="bg-slate-950/70 font-semibold uppercase text-slate-400">
                            <tr>
                              <th className="px-3 py-2">LAN Device</th>
                              <th className="px-3 py-2 text-right">Events</th>
                              <th className="px-3 py-2 text-right">DNS</th>
                              <th className="px-3 py-2 text-right">Bandwidth</th>
                              <th className="px-3 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {(attributionData?.clients ?? []).map((client) => (
                              <tr key={client.ipv4_address}>
                                <td className="px-3 py-2">
                                  <div className="font-semibold text-slate-100">
                                    {client.effective_name}
                                  </div>
                                  <div className="font-mono text-[11px] text-slate-400">
                                    {client.ipv4_address}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-slate-200">
                                  {client.event_count.toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-sky-300">
                                  {client.dns_queries.toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-emerald-300">
                                  {formatBytes(client.bytes)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="inline-flex items-center gap-1.5">
                                    {client.device_id !== null && (
                                      <button
                                        type="button"
                                        data-testid={`attribution-inspect-device-${client.device_id}`}
                                        onClick={() => {
                                          setSelectedDeviceId(client.device_id)
                                          setDrilldownTarget(null)
                                        }}
                                        className="rounded border border-indigo-500/40 bg-indigo-500/15 px-2 py-1 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-500/25 cursor-pointer"
                                      >
                                        Inspect
                                      </button>
                                    )}
                                    {client.device_id !== null &&
                                      !client.is_protected &&
                                      (drilldownTarget.targetType === 'domain' ||
                                        drilldownTarget.targetType === 'registered_domain' ||
                                        drilldownTarget.targetType === 'asn') && (
                                        <button
                                          type="button"
                                          data-testid={`attribution-block-device-${client.device_id}`}
                                          disabled={createBlockMutation.isPending}
                                          onClick={() =>
                                            createBlockMutation.mutate({
                                              target_type:
                                                drilldownTarget.targetType === 'asn'
                                                  ? 'asn'
                                                  : 'domain',
                                              target_value: drilldownTarget.targetValue,
                                              scope_type: 'device',
                                              device_id: client.device_id,
                                              organization_name:
                                                drilldownTarget.organization ?? '',
                                              reason: `Blocked for ${client.effective_name}`,
                                            })
                                          }
                                          className="rounded border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/25 cursor-pointer"
                                        >
                                          Block Device
                                        </button>
                                      )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
