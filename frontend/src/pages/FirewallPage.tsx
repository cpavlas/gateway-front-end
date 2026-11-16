import React, { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Download,
  ExternalLink,
  Filter,
  Globe,
  Lock,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react'
import {
  apiClient,
  buildGoogleMapsUrl,
  formatBlockedPercentage,
  formatBytes,
  formatClock24h,
  type FirewallLogEventItem,
  type FirewallOpenWanPortItem,
  type FirewallOverviewResponse,
  type TimeWindow,
} from '../api/client'
import { AppLayout, type AppTab } from '../components/AppLayout'
import { AutoRefreshSelector, useAutoRefresh } from '../components/AutoRefreshSelector'
import { DeviceAnalyticsDrawer } from '../components/DeviceAnalyticsDrawer'
import { FirewallOpenPortSessionsDrawer } from '../components/FirewallOpenPortSessionsDrawer'
import { TelemetryLoadingShell } from '../components/TelemetryLoadingShell'
import { TimelineBarChart } from '../components/TelemetryBarChart'

interface FirewallPageProps {
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

interface PacketCellFilterChip {
  kind: 'source_ip' | 'destination_ip' | 'port' | 'interface'
  label: string
  value: string
}

function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function escapeCsvField(val: string | number | null | undefined): string {
  const str = val === null || val === undefined ? '' : String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replaceAll('"', '""')}"`
  }
  return str
}

export const FirewallPage: React.FC<FirewallPageProps> = ({
  activeTab = 'firewall',
  onSelectTab,
}) => {
  const queryClient = useQueryClient()
  const [windowKey, setWindowKey] = useState<TimeWindow>('today')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [directionFilter, setDirectionFilter] = useState<string>('all')
  const [protocolFilter, setProtocolFilter] = useState<string>('all')
  const [searchInput, setSearchInput] = useState<string>('')
  const [logLimit, setLogLimit] = useState<number>(100)
  const [cellFilters, setCellFilters] = useState<PacketCellFilterChip[]>([])
  const [actionBanner, setActionBanner] = useState<string | null>(null)
  const [selectedOpenPort, setSelectedOpenPort] =
    useState<FirewallOpenWanPortItem | null>(null)
  const [selectedLanDeviceId, setSelectedLanDeviceId] = useState<number | null>(null)
  const [manualWanIp, setManualWanIp] = useState('')
  const [manualWanReason, setManualWanReason] = useState('')
  const [wanBlockError, setWanBlockError] = useState<string | null>(null)
  const [windowSnapshots, setWindowSnapshots] = useState<
    Partial<Record<TimeWindow, FirewallOverviewResponse>>
  >({})
  const { intervalOption, setIntervalOption, refetchInterval } = useAutoRefresh('30s')

  const effectiveSearch = searchInput.trim() || (cellFilters[0]?.value ?? '')

  const {
    data: overview,
    dataUpdatedAt,
    isLoading,
    isFetching,
    isError,
    error,
  } = useQuery({
    queryKey: [
      'firewallOverview',
      windowKey,
      actionFilter,
      directionFilter,
      protocolFilter,
      effectiveSearch,
      logLimit,
    ],
    queryFn: () =>
      apiClient.getFirewallOverview({
        window: windowKey,
        action: actionFilter,
        direction: directionFilter,
        protocol: protocolFilter,
        search: effectiveSearch,
        limit: logLimit,
      }),
    refetchInterval: false,
    placeholderData: (previousData) => previousData,
  })

  useEffect(() => {
    if (overview && overview.window === windowKey) {
      setWindowSnapshots((prev) => ({
        ...prev,
        [windowKey]: overview,
      }))
    }
  }, [overview, windowKey])

  const { data: healthReport } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: () => apiClient.getSystemHealth(),
    refetchInterval: 60_000,
  })

  const {
    data: wanBlockedIpsData,
    isFetching: isFetchingWanBlockedIps,
    refetch: refetchWanBlockedIps,
  } = useQuery({
    queryKey: ['wanBlockedIps'],
    queryFn: () => apiClient.getWanBlockedIps(),
  })
  const wanBlockedIps = wanBlockedIpsData?.ips ?? []
  const wanBlockAliasName = wanBlockedIpsData?.alias_name ?? 'gateway_wan_blocked_ips'

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiClient.getFirewallOverview({
        window: windowKey,
        action: actionFilter,
        direction: directionFilter,
        protocol: protocolFilter,
        search: effectiveSearch,
        limit: logLimit,
        refresh: true,
      }),
    onSuccess: (fresh) => {
      setWindowSnapshots((prev) => ({
        ...prev,
        [windowKey]: fresh,
      }))
      queryClient.setQueryData(
        [
          'firewallOverview',
          windowKey,
          actionFilter,
          directionFilter,
          protocolFilter,
          effectiveSearch,
          logLimit,
        ],
        fresh,
      )
    },
  })

  const refreshFnRef = useRef<() => void>(() => {})
  refreshFnRef.current = () => {
    refreshMutation.mutate()
    void refetchWanBlockedIps()
  }

  useEffect(() => {
    if (typeof refetchInterval !== 'number' || refetchInterval <= 0) {
      return undefined
    }
    const timerId = window.setInterval(() => {
      refreshFnRef.current()
    }, refetchInterval)
    return () => window.clearInterval(timerId)
  }, [refetchInterval])

  const toggleBlockMutation = useMutation({
    mutationFn: async ({
      deviceId,
      currentlyBlocked,
    }: {
      deviceId: number
      currentlyBlocked: boolean
    }) => {
      if (currentlyBlocked) {
        return apiClient.unblockDevice(deviceId)
      }
      return apiClient.blockDevice(deviceId)
    },
    onSuccess: (res) => {
      const actionVerb = res.action === 'block' ? 'Blocked' : 'Unblocked'
      setActionBanner(
        `${actionVerb} ${res.device.effective_name} (${res.device.ipv4_address ?? 'unknown IP'}) in OPNsense.`,
      )
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      refreshMutation.mutate()
    },
  })

  const wanBlockMutation = useMutation({
    mutationFn: async (vars: { ip: string; block: boolean; note?: string }) => {
      if (vars.block) {
        return apiClient.blockExternalWanIp({
          ip_address: vars.ip,
          reason: vars.note,
        })
      }
      return apiClient.unblockExternalWanIp(vars.ip)
    },
    onSuccess: (res) => {
      const verb = res.blocked ? 'Blocked' : 'Unblocked'
      const warnText = res.warning ? ` (${res.warning})` : ''
      setWanBlockError(null)
      if (res.blocked && manualWanIp.trim() === res.ip_address) {
        setManualWanIp('')
        setManualWanReason('')
      }
      setActionBanner(
        `${verb} external WAN IP ${res.ip_address} in OPNsense alias ${res.alias_name}.${warnText}`,
      )
      void queryClient.invalidateQueries({ queryKey: ['wanBlockedIps'] })
      void queryClient.invalidateQueries({ queryKey: ['firewallOpenPortSessions'] })
      refreshMutation.mutate()
    },
    onError: (err) => {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to update OPNsense WAN blocklist.'
      setWanBlockError(msg)
      setActionBanner(msg)
    },
  })

  const addCellFilterChip = (chip: PacketCellFilterChip) => {
    setCellFilters((prev) => {
      const filtered = prev.filter((item) => item.kind !== chip.kind)
      return [...filtered, chip]
    })
  }

  const removeCellFilterChip = (kind: PacketCellFilterChip['kind']) => {
    setCellFilters((prev) => prev.filter((item) => item.kind !== kind))
  }

  const clearAllPacketFilters = () => {
    setSearchInput('')
    setActionFilter('all')
    setDirectionFilter('all')
    setProtocolFilter('all')
    setCellFilters([])
  }

  const lockedWindowOverview = windowSnapshots[windowKey] ?? overview
  const summary = lockedWindowOverview?.summary
  const timeline = lockedWindowOverview?.timeline ?? []
  const noisyLanDevices = lockedWindowOverview?.noisy_lan_devices ?? []
  const externalScanners = lockedWindowOverview?.external_scanners ?? []
  const openWanPorts = lockedWindowOverview?.open_wan_ports ?? []
  const recentEvents = overview?.recent_events ?? []
  const filteredEvents = recentEvents.filter((ev) => {
    for (const chip of cellFilters) {
      if (chip.kind === 'source_ip' && ev.source_ip !== chip.value) {
        return false
      }
      if (chip.kind === 'destination_ip' && ev.destination_ip !== chip.value) {
        return false
      }
      if (
        chip.kind === 'port' &&
        String(ev.destination_port ?? '') !== chip.value &&
        String(ev.source_port ?? '') !== chip.value
      ) {
        return false
      }
      if (chip.kind === 'interface' && (ev.interface || 'N/A') !== chip.value) {
        return false
      }
    }
    return true
  })

  const hasActiveFilters =
    searchInput.trim().length > 0 ||
    actionFilter !== 'all' ||
    directionFilter !== 'all' ||
    protocolFilter !== 'all' ||
    cellFilters.length > 0

  const handleExportCsv = () => {
    const header = [
      'timestamp',
      'action',
      'direction',
      'interface',
      'protocol',
      'source_ip',
      'source_port',
      'source_name',
      'destination_ip',
      'destination_port',
      'destination_name',
      'bytes',
      'rule_id',
    ].join(',')
    const lines = filteredEvents.map((ev: FirewallLogEventItem) =>
      [
        escapeCsvField(ev.timestamp),
        escapeCsvField(ev.action),
        escapeCsvField(ev.direction),
        escapeCsvField(ev.interface),
        escapeCsvField(ev.protocol),
        escapeCsvField(ev.source_ip),
        escapeCsvField(ev.source_port),
        escapeCsvField(ev.source_name || ev.source_org),
        escapeCsvField(ev.destination_ip),
        escapeCsvField(ev.destination_port),
        escapeCsvField(ev.destination_name || ev.destination_org),
        escapeCsvField(ev.bytes),
        escapeCsvField(ev.rule_id),
      ].join(','),
    )
    triggerFileDownload(
      `firewall-packet-logs-${windowKey}.csv`,
      [header, ...lines].join('\n'),
      'text/csv;charset=utf-8',
    )
  }

  const handleExportJson = () => {
    triggerFileDownload(
      `firewall-packet-logs-${windowKey}.json`,
      JSON.stringify(filteredEvents, null, 2),
      'application/json;charset=utf-8',
    )
  }

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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-100">
              Firewall &amp; Security Telemetry
            </h1>
            <p className="text-sm text-slate-400">
              Live OPNsense filterlog packet inspection, noisy LAN device blocking, perimeter WAN scanners, and inbound open port exposure
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-start gap-2 self-start shrink-0">
            <div
              className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1 shrink-0"
              role="group"
              aria-label="Select firewall telemetry time window"
            >
              {TIME_WINDOWS.map((w) => (
                <button
                  key={w.key}
                  type="button"
                  data-testid={`firewall-window-${w.key}`}
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
                  data-testid="firewall-refresh-btn"
                  aria-label="Refresh Firewall"
                  title="Refresh Firewall"
                  onClick={() => {
                    refreshMutation.mutate()
                    void refetchWanBlockedIps()
                  }}
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
                  testId="firewall-auto-refresh-select"
                />
              </div>
              {lastUpdatedClock && (
                <span
                  data-testid="firewall-last-updated"
                  className="text-[11px] font-mono text-slate-400"
                >
                  Updated: {lastUpdatedClock}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Feedback Banner */}
        {actionBanner && (
          <div
            data-testid="firewall-action-banner"
            className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{actionBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionBanner(null)}
              className="text-emerald-300 hover:text-white cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Warning / Error Banner */}
        {overview?.warning && (
          <div
            data-testid="firewall-warning-banner"
            className="flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>{overview.warning}</span>
          </div>
        )}

        {isError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200"
          >
            {error instanceof Error ? error.message : 'Failed to load firewall telemetry.'}
          </div>
        )}

        {isLoading && !overview ? (
          <div
            data-testid="firewall-loading"
            className="rounded-2xl border border-slate-800 bg-slate-900/60 p-10 text-center text-sm text-slate-400"
          >
            Querying Elasticsearch 9.4.3 firewall filterlog indices...
          </div>
        ) : (
          <TelemetryLoadingShell
            isLoading={isLoading}
            isFetching={isFetching || refreshMutation.isPending}
            loadingMessage="Refreshing firewall telemetry from Elasticsearch..."
            testId="firewall-telemetry-shell"
          >
            {/* 4 KPI Summary Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Total Firewall Packets</span>
                  <Activity className="h-4 w-4 text-indigo-400" />
                </div>
                <p
                  data-testid="firewall-kpi-total-packets"
                  className="mt-1.5 text-2xl font-bold text-slate-100"
                >
                  {(summary?.total_packets ?? 0).toLocaleString()}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Volume: {formatBytes(summary?.total_bytes ?? 0)} ({windowKey} window)
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Passed Firewall Packets</span>
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                </div>
                <p
                  data-testid="firewall-kpi-allowed-packets"
                  className="mt-1.5 text-2xl font-bold text-emerald-300"
                >
                  {(summary?.allowed_packets ?? 0).toLocaleString()}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Permitted by OPNsense filterlog rules
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Blocked Firewall Packets</span>
                  <ShieldAlert className="h-4 w-4 text-rose-400" />
                </div>
                <p
                  data-testid="firewall-kpi-blocked-packets"
                  className="mt-1.5 flex items-baseline gap-2 text-2xl font-bold text-rose-300"
                >
                  <span>{(summary?.blocked_packets ?? 0).toLocaleString()}</span>
                  <span
                    data-testid="firewall-kpi-blocked-pct"
                    className="text-sm font-semibold text-rose-400/90"
                  >
                    (
                    {formatBlockedPercentage(
                      summary?.blocked_packets ?? 0,
                      summary?.allowed_packets ?? 0,
                    )}
                    )
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Dropped at LAN/WAN firewall rules
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Direction Split &amp; Open WAN Ports</span>
                  <Globe className="h-4 w-4 text-amber-400" />
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <p
                    data-testid="firewall-kpi-open-ports"
                    className={`text-2xl font-bold ${
                      (summary?.open_wan_port_count ?? 0) > 0
                        ? 'text-amber-300'
                        : 'text-emerald-300'
                    }`}
                  >
                    {summary?.open_wan_port_count ?? 0} Open WAN Ports
                  </p>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  In: {(summary?.inbound_packets ?? 0).toLocaleString()} | Out:{' '}
                  {(summary?.outbound_packets ?? 0).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Firewall Activity Timeline Chart */}
            <section
              data-testid="firewall-timeline-panel"
              aria-label="Firewall packet timeline"
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4"
            >
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  Firewall Packet Timeline ({windowKey.toUpperCase()})
                </h2>
                <p className="text-xs text-slate-400">
                  Allowed vs. Blocked filterlog packet volume over time
                </p>
              </div>

              <TimelineBarChart
                timeline={timeline}
                windowKey={windowKey}
                prefixTestId="firewall-timeline"
                chartTestId="firewall-timeline-chart"
                variant="firewall"
              />
            </section>

            {/* Side-by-Side Security Insights Panels */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Left Panel: Noisy / Blocked LAN Devices & External Scanners */}
              <section
                data-testid="firewall-bad-actors-panel"
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-rose-400" />
                    <h2 className="text-sm font-semibold text-slate-100">
                      Noisy LAN Devices &amp; External Scanners
                    </h2>
                  </div>
                  <span className="text-xs text-slate-400">
                    Top blocked packet sources
                  </span>
                </div>

                {/* Internal LAN Sources */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Internal LAN Devices Generating Blocked Packets
                  </h3>
                  {noisyLanDevices.length === 0 ? (
                    <p className="rounded-xl border border-slate-800/80 bg-slate-950/40 py-4 text-center text-xs text-slate-500">
                      No internal LAN devices recorded blocked firewall packets in this window.
                    </p>
                  ) : (
                    <div
                      data-testid="firewall-noisy-lan-list"
                      className="space-y-2 max-h-64 overflow-y-auto pr-1"
                    >
                      {noisyLanDevices.map((dev) => (
                        <div
                          key={dev.ipv4_address}
                          data-testid={`firewall-noisy-lan-${dev.ipv4_address}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3.5 py-2.5 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-100 truncate">
                                {dev.effective_name}
                              </span>
                              <span className="font-mono text-[11px] text-slate-400">
                                ({dev.ipv4_address})
                              </span>
                              {dev.is_blocked && (
                                <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                                  BLOCKED
                                </span>
                              )}
                              {dev.is_protected && (
                                <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                                  PROTECTED
                                </span>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                              <span className="font-mono text-rose-300 font-semibold">
                                {dev.blocked_packets.toLocaleString()} blocked pkts
                              </span>
                              <span>{formatBytes(dev.bytes)}</span>
                              {dev.target_ports.length > 0 && (
                                <span>
                                  Target Ports:{' '}
                                  <span className="font-mono text-slate-300">
                                    {dev.target_ports.map((p) => `:${p}`).join(', ')}
                                  </span>
                                </span>
                              )}
                            </div>
                          </div>

                          {dev.device_id !== null && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                data-testid={`firewall-inspect-device-${dev.device_id}`}
                                onClick={() => setSelectedLanDeviceId(dev.device_id)}
                                aria-label={`Inspect ${dev.effective_name}`}
                                title={`Inspect analytics for ${dev.effective_name}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 text-slate-200 transition hover:border-indigo-500/50 hover:bg-indigo-500/20 hover:text-indigo-200 cursor-pointer"
                              >
                                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              {!dev.is_protected && (
                                <button
                                  type="button"
                                  data-testid={`firewall-block-device-${dev.device_id}`}
                                  disabled={toggleBlockMutation.isPending}
                                  onClick={() =>
                                    toggleBlockMutation.mutate({
                                      deviceId: dev.device_id!,
                                      currentlyBlocked: dev.is_blocked,
                                    })
                                  }
                                  aria-label={dev.is_blocked ? 'Unblock Device' : 'Block Device'}
                                  title={dev.is_blocked ? 'Unblock Device' : 'Block Device'}
                                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition cursor-pointer ${
                                    dev.is_blocked
                                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                      : 'border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                                  }`}
                                >
                                  {dev.is_blocked ? (
                                    <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                                  ) : (
                                    <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                                  )}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* External WAN Scanners */}
                <div className="space-y-2 pt-2 border-t border-slate-800/80">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Top Blocked External WAN Scanners
                  </h3>
                  {externalScanners.length === 0 ? (
                    <p className="rounded-xl border border-slate-800/80 bg-slate-950/40 py-4 text-center text-xs text-slate-500">
                      No external WAN scanner probes recorded in this window.
                    </p>
                  ) : (
                    <div
                      data-testid="firewall-external-scanners-list"
                      className="space-y-1.5 max-h-64 overflow-y-auto pr-1"
                    >
                      {externalScanners.map((scanner) => {
                        const scannerMapUrl = buildGoogleMapsUrl(
                          scanner.latitude,
                          scanner.longitude,
                          scanner.location_label,
                        )
                        const geoLabel =
                          scanner.location_label &&
                          scanner.location_label !== 'Unknown Location'
                            ? scanner.location_label
                            : scanner.country_name || null
                        return (
                          <div
                            key={scanner.source_ip}
                            data-testid={`firewall-scanner-${scanner.source_ip}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800/70 bg-slate-950/50 px-3 py-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  data-testid={`firewall-scanner-filter-${scanner.source_ip}`}
                                  onClick={() => setSearchInput(scanner.source_ip)}
                                  title={`Filter packet logs by ${scanner.source_ip}`}
                                  className="font-mono font-semibold text-amber-300 hover:text-amber-200 hover:underline cursor-pointer"
                                >
                                  {scanner.source_ip}
                                </button>
                                {scanner.organization && (
                                  <span className="truncate text-[11px] text-slate-400">
                                    ({scanner.organization})
                                  </span>
                                )}
                                {geoLabel &&
                                  (scannerMapUrl ? (
                                    <a
                                      href={scannerMapUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      data-testid={`firewall-scanner-map-${scanner.source_ip}`}
                                      title="Open GeoIP location in Google Maps"
                                      className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300 hover:bg-indigo-500/20 hover:underline"
                                    >
                                      <MapPin className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                                      <span>{geoLabel}</span>
                                      <ExternalLink className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                                    </a>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300">
                                      <MapPin className="h-2.5 w-2.5 shrink-0 text-indigo-400" aria-hidden="true" />
                                      <span>{geoLabel}</span>
                                    </span>
                                  ))}
                              </div>
                              {scanner.target_ports.length > 0 && (
                                <p className="mt-0.5 text-[11px] text-slate-400">
                                  Probed Ports:{' '}
                                  <span className="font-mono text-slate-300">
                                    {scanner.target_ports.map((p) => `:${p}`).join(', ')}
                                  </span>
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2.5 shrink-0">
                              <div className="text-right font-mono">
                                <span className="font-semibold text-rose-300">
                                  {scanner.blocked_packets.toLocaleString()} blocked
                                </span>
                                <p className="text-[10px] text-slate-500">
                                  {formatBytes(scanner.bytes)}
                                </p>
                              </div>
                              <button
                                type="button"
                                data-testid={`firewall-wan-block-${scanner.source_ip}`}
                                disabled={wanBlockMutation.isPending}
                                onClick={() =>
                                  wanBlockMutation.mutate({
                                    ip: scanner.source_ip,
                                    block: !scanner.is_wan_blocked,
                                    note: scanner.organization
                                      ? `WAN Scanner (${scanner.organization})`
                                      : 'WAN Scanner',
                                  })
                                }
                                title={
                                  scanner.is_wan_blocked
                                    ? `Remove ${scanner.source_ip} from OPNsense WAN blocklist`
                                    : `Block ${scanner.source_ip} at OPNsense WAN`
                                }
                                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition cursor-pointer disabled:opacity-60 ${
                                  scanner.is_wan_blocked
                                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                    : 'border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                                }`}
                              >
                                {scanner.is_wan_blocked ? (
                                  <>
                                    <Unlock className="h-3 w-3" aria-hidden="true" />
                                    <span>Blocked at WAN</span>
                                  </>
                                ) : (
                                  <>
                                    <Ban className="h-3 w-3" aria-hidden="true" />
                                    <span>Block at WAN</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </section>

              {/* Right Panel: Active Inbound WAN Exposure (Open Ports) */}
              <section
                data-testid="firewall-open-ports-panel"
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-amber-400" />
                    <h2 className="text-sm font-semibold text-slate-100">
                      Active Inbound WAN Exposure (Open Ports)
                    </h2>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      openWanPorts.length > 0
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    }`}
                  >
                    {openWanPorts.length === 0
                      ? 'No Open WAN Ports Detected'
                      : `${openWanPorts.length} Exposed Port${openWanPorts.length === 1 ? '' : 's'}`}
                  </span>
                </div>

                <p className="text-xs text-slate-400">
                  Inbound traffic from public non-RFC1918 WAN addresses permitted (`pass`) to destination ports on your network. Verify that any listed port forwards or WAN services are intentional.
                </p>

                {openWanPorts.length === 0 ? (
                  <div
                    data-testid="firewall-no-open-ports"
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 py-10 text-center"
                  >
                    <Shield className="h-7 w-7 text-emerald-400" />
                    <p className="text-xs font-semibold text-emerald-300">
                      Zero Inbound Public WAN Connections Passed
                    </p>
                    <p className="max-w-md text-[11px] text-slate-400">
                      No external non-RFC1918 source IP addresses were permitted inbound through the firewall during the selected {windowKey} window.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table
                      data-testid="firewall-open-ports-table"
                      className="w-full text-left text-xs"
                    >
                      <thead>
                        <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
                          <th className="pb-2 pr-3">Target Device / IP</th>
                          <th className="pb-2 px-3">Open Port</th>
                          <th className="pb-2 px-3 text-right">Passed Pkts</th>
                          <th className="pb-2 px-3 text-right">Volume</th>
                          <th className="pb-2 pl-3 text-right">External IPs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {openWanPorts.map((wp) => (
                          <tr
                            key={`${wp.destination_ip}-${wp.external_port ?? wp.destination_port}-${wp.destination_port}-${wp.protocol}`}
                            data-testid={`firewall-open-port-row-${wp.destination_port}`}
                            className="hover:bg-slate-800/40"
                          >
                            <td className="py-2.5 pr-3">
                              <div className="font-semibold text-slate-100">
                                {wp.effective_name}
                              </div>
                              <div className="font-mono text-[11px] text-slate-400">
                                {wp.destination_ip}
                              </div>
                              {wp.rule_description && (
                                <div
                                  data-testid={`firewall-open-port-desc-${wp.destination_port}`}
                                  className="mt-0.5 text-[11px] font-medium text-indigo-300"
                                >
                                  {wp.rule_description}
                                </div>
                              )}
                              {wp.last_seen_at && (
                                <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                                  Last seen: {formatClock24h(wp.last_seen_at)}
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 font-mono font-semibold text-amber-300">
                                {wp.port_mapping ||
                                  `${wp.external_port ?? wp.destination_port}:${wp.destination_port}`}{' '}
                                / {wp.protocol.toUpperCase()}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-300">
                              {wp.passed_packets.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-300">
                              {formatBytes(wp.bytes)}
                            </td>
                            <td className="py-2.5 pl-3 text-right">
                              <button
                                type="button"
                                data-testid={`firewall-open-port-ext-ips-${wp.destination_port}`}
                                onClick={() => setSelectedOpenPort(wp)}
                                title={`Inspect ${wp.unique_external_sources} connected external WAN IP${wp.unique_external_sources === 1 ? '' : 's'} for port ${wp.destination_port}`}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 font-mono text-xs font-semibold text-amber-300 transition hover:bg-amber-500/25 hover:border-amber-400 cursor-pointer"
                              >
                                <span>{wp.unique_external_sources.toLocaleString()}</span>
                                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            {/* Blocked External WAN IPs Panel (FB-P19-005) */}
            {(() => {
              const scannerByIp = new Map(
                externalScanners.map((scanner) => [scanner.source_ip, scanner]),
              )
              const handleManualWanBlockSubmit = (e: React.FormEvent) => {
                e.preventDefault()
                const cleanedIp = manualWanIp.trim()
                const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(cleanedIp)
                const validOctets =
                  ipv4Match !== null &&
                  ipv4Match.slice(1).every((part) => Number(part) >= 0 && Number(part) <= 255)
                if (!validOctets) {
                  setWanBlockError('Enter a valid external IPv4 address (e.g. 203.0.113.50).')
                  return
                }
                setWanBlockError(null)
                wanBlockMutation.mutate({
                  ip: cleanedIp,
                  block: true,
                  note: manualWanReason.trim() || 'Manual WAN IP Block',
                })
              }
              return (
                <section
                  data-testid="firewall-wan-blocked-ips-panel"
                  className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-rose-400" aria-hidden="true" />
                      <div>
                        <h2 className="text-sm font-semibold text-slate-100">
                          Blocked External WAN IPs
                        </h2>
                        <p className="text-xs text-slate-400">
                          Persistent OPNsense alias{' '}
                          <code className="font-mono text-rose-300">{wanBlockAliasName}</code>{' '}
                          managed by Gateway Controller
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isFetchingWanBlockedIps && (
                        <span className="text-[11px] text-slate-400">Syncing...</span>
                      )}
                      <span
                        data-testid="firewall-wan-blocked-count"
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                          wanBlockedIps.length > 0
                            ? 'border-rose-500/30 bg-rose-500/15 text-rose-300'
                            : 'border-slate-700 bg-slate-800/70 text-slate-300'
                        }`}
                      >
                        {wanBlockedIps.length} Blocked IP{wanBlockedIps.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>

                  <form
                    onSubmit={handleManualWanBlockSubmit}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center"
                  >
                    <input
                      type="text"
                      data-testid="firewall-wan-manual-ip-input"
                      value={manualWanIp}
                      onChange={(e) => {
                        setManualWanIp(e.target.value)
                        if (wanBlockError) setWanBlockError(null)
                      }}
                      placeholder="External public IPv4 (e.g. 203.0.113.50)"
                      aria-label="External public IPv4 address to block"
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-rose-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      data-testid="firewall-wan-manual-reason-input"
                      value={manualWanReason}
                      onChange={(e) => setManualWanReason(e.target.value)}
                      placeholder="Reason / note (optional)"
                      aria-label="Reason for blocking external IP"
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-rose-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      data-testid="firewall-wan-manual-block-btn"
                      disabled={wanBlockMutation.isPending}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-600/90 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-60 cursor-pointer shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Block WAN IP
                    </button>
                  </form>

                  {wanBlockError && (
                    <div
                      data-testid="firewall-wan-manual-error"
                      className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
                    >
                      {wanBlockError}
                    </div>
                  )}

                  {wanBlockedIps.length === 0 ? (
                    <div
                      data-testid="firewall-wan-blocked-empty"
                      className="rounded-xl border border-slate-800/80 bg-slate-950/50 px-4 py-5 text-center text-xs text-slate-400"
                    >
                      No external WAN IPs are currently blocked in{' '}
                      <code className="font-mono text-slate-300">{wanBlockAliasName}</code>. Block an IP above or from Top Blocked External WAN Scanners / Open Port Sessions.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/70 rounded-xl border border-slate-800 bg-slate-950/40">
                      {wanBlockedIps.map((ip) => {
                        const matched = scannerByIp.get(ip)
                        const mapsUrl = matched
                          ? buildGoogleMapsUrl(
                              matched.latitude,
                              matched.longitude,
                              matched.location_label,
                            )
                          : null
                        const geoLabel =
                          matched?.location_label &&
                          matched.location_label !== 'Unknown Location'
                            ? matched.location_label
                            : matched?.country_name || null
                        return (
                          <div
                            key={ip}
                            data-testid={`firewall-wan-blocked-row-${ip}`}
                            className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs"
                          >
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  data-testid={`firewall-wan-blocked-filter-${ip}`}
                                  onClick={() => setSearchInput(ip)}
                                  title={`Filter Packet Log Explorer for ${ip}`}
                                  className="font-mono text-xs font-semibold text-rose-300 hover:text-indigo-300 hover:underline cursor-pointer"
                                >
                                  {ip}
                                </button>
                                {geoLabel && (
                                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                                    {geoLabel}
                                  </span>
                                )}
                                {mapsUrl && (
                                  <a
                                    href={mapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Open approximate IP geolocation in Google Maps"
                                    className="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300 hover:bg-sky-500/20"
                                  >
                                    <MapPin className="h-2.5 w-2.5" aria-hidden="true" />
                                    Map
                                    <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                                  </a>
                                )}
                              </div>
                              {matched?.organization && (
                                <p className="truncate text-[11px] text-slate-400">
                                  {matched.organization}
                                  {matched.blocked_packets
                                    ? ` · ${matched.blocked_packets.toLocaleString()} blocked pkts in window`
                                    : ''}
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              data-testid={`firewall-unblock-wan-ip-${ip}`}
                              disabled={wanBlockMutation.isPending}
                              onClick={() => wanBlockMutation.mutate({ ip, block: false })}
                              title={`Remove ${ip} from OPNsense ${wanBlockAliasName}`}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-60 cursor-pointer shrink-0"
                            >
                              <Unlock className="h-3 w-3" aria-hidden="true" />
                              Unblock
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })()}

            {/* Searchable & Filterable Firewall Log Explorer */}
            <section
              data-testid="firewall-logs-panel"
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-indigo-400" />
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      Searchable Firewall Packet Log Explorer
                    </h2>
                    <p className="text-xs text-slate-400">
                      Recent matching OPNsense filterlog entries ({filteredEvents.length} shown)
                    </p>
                  </div>
                </div>

                {/* Search, Filter, Limit & Export Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[230px] flex-1 sm:flex-initial">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      data-testid="firewall-search-input"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Search IP, port, interface, ASN..."
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <select
                    aria-label="Filter by firewall action"
                    data-testid="firewall-action-filter"
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="all">All Actions</option>
                    <option value="pass">Passed Only</option>
                    <option value="block">Blocked Only</option>
                  </select>

                  <select
                    aria-label="Filter by traffic direction"
                    data-testid="firewall-direction-filter"
                    value={directionFilter}
                    onChange={(e) => setDirectionFilter(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="all">All Directions</option>
                    <option value="inbound">Inbound</option>
                    <option value="outbound">Outbound</option>
                  </select>

                  <select
                    aria-label="Filter by transport protocol"
                    data-testid="firewall-protocol-filter"
                    value={protocolFilter}
                    onChange={(e) => setProtocolFilter(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="all">All Protocols</option>
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="icmp">ICMP</option>
                    <option value="ipv6-icmp">IPv6-ICMP</option>
                    <option value="igmp">IGMP</option>
                  </select>

                  <select
                    aria-label="Packet log row limit"
                    data-testid="firewall-limit-select"
                    value={logLimit}
                    onChange={(e) => setLogLimit(Number(e.target.value))}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value={50}>50 rows</option>
                    <option value={100}>100 rows</option>
                    <option value={250}>250 rows</option>
                  </select>

                  <button
                    type="button"
                    data-testid="firewall-export-csv-btn"
                    onClick={handleExportCsv}
                    disabled={filteredEvents.length === 0}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>CSV</span>
                  </button>

                  <button
                    type="button"
                    data-testid="firewall-export-json-btn"
                    onClick={handleExportJson}
                    disabled={filteredEvents.length === 0}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>JSON</span>
                  </button>
                </div>
              </div>

              {hasActiveFilters && (
                <div
                  data-testid="firewall-active-filter-chips"
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Active Filters:
                  </span>
                  {searchInput.trim() && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-0.5 text-[11px] text-indigo-200">
                      <span>Search: {searchInput.trim()}</span>
                      <button
                        type="button"
                        data-testid="firewall-chip-remove-search"
                        aria-label="Remove Search filter"
                        onClick={() => setSearchInput('')}
                        className="rounded-full p-0.5 hover:bg-indigo-500/30 cursor-pointer"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  )}
                  {actionFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-0.5 text-[11px] text-indigo-200">
                      <span>Action: {actionFilter}</span>
                      <button
                        type="button"
                        data-testid="firewall-chip-remove-action"
                        aria-label="Remove Action filter"
                        onClick={() => setActionFilter('all')}
                        className="rounded-full p-0.5 hover:bg-indigo-500/30 cursor-pointer"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  )}
                  {directionFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-0.5 text-[11px] text-indigo-200">
                      <span>Direction: {directionFilter}</span>
                      <button
                        type="button"
                        data-testid="firewall-chip-remove-direction"
                        aria-label="Remove Direction filter"
                        onClick={() => setDirectionFilter('all')}
                        className="rounded-full p-0.5 hover:bg-indigo-500/30 cursor-pointer"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  )}
                  {protocolFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-0.5 text-[11px] text-indigo-200">
                      <span>Proto: {protocolFilter.toUpperCase()}</span>
                      <button
                        type="button"
                        data-testid="firewall-chip-remove-protocol"
                        aria-label="Remove Proto filter"
                        onClick={() => setProtocolFilter('all')}
                        className="rounded-full p-0.5 hover:bg-indigo-500/30 cursor-pointer"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  )}
                  {cellFilters.map((chip) => (
                    <span
                      key={`${chip.kind}-${chip.value}`}
                      data-testid={`firewall-chip-${chip.kind}`}
                      className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-0.5 text-[11px] text-cyan-200"
                    >
                      <span>
                        {chip.label}: {chip.value}
                      </span>
                      <button
                        type="button"
                        data-testid={`firewall-chip-remove-${chip.kind}`}
                        aria-label={`Remove ${chip.label} filter`}
                        onClick={() => removeCellFilterChip(chip.kind)}
                        className="rounded-full p-0.5 hover:bg-cyan-500/30 cursor-pointer"
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    data-testid="firewall-clear-filters-btn"
                    onClick={clearAllPacketFilters}
                    className="ml-auto text-[11px] font-medium text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    Clear all
                  </button>
                </div>
              )}

              {filteredEvents.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  No firewall packet logs matched the current filters in this time window.
                </p>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table
                    data-testid="firewall-events-table"
                    className="w-full text-left text-xs"
                  >
                    <thead className="sticky top-0 bg-slate-900">
                      <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
                        <th className="py-2 pr-3">Timestamp</th>
                        <th className="py-2 px-2">Action</th>
                        <th className="py-2 px-2">Dir</th>
                        <th className="py-2 px-2">Interface</th>
                        <th className="py-2 px-2">Proto</th>
                        <th className="py-2 px-3">Source</th>
                        <th className="py-2 px-3">Destination</th>
                        <th className="py-2 pl-3 text-right">Bytes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredEvents.map((ev, idx) => {
                        const isBlocked = ev.action === 'block'
                        const isInbound =
                          ev.direction === 'inbound' || ev.direction === 'in'
                        const ifaceValue = ev.interface || 'N/A'
                        return (
                          <tr
                            key={`${ev.timestamp}-${ev.source_ip}-${ev.destination_ip}-${idx}`}
                            className="hover:bg-slate-800/40"
                          >
                            <td className="py-2 pr-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                              {new Date(ev.timestamp).toLocaleString()}
                            </td>
                            <td className="py-2 px-2">
                              <span
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                  isBlocked
                                    ? 'bg-rose-500/20 text-rose-300'
                                    : 'bg-emerald-500/20 text-emerald-300'
                                }`}
                              >
                                {isBlocked ? (
                                  <Lock className="h-2.5 w-2.5" />
                                ) : (
                                  <ShieldCheck className="h-2.5 w-2.5" />
                                )}
                                {ev.action}
                              </span>
                            </td>
                            <td className="py-2 px-2">
                              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-300">
                                {isInbound ? (
                                  <ArrowDownLeft className="h-3 w-3 text-amber-400" />
                                ) : (
                                  <ArrowUpRight className="h-3 w-3 text-cyan-400" />
                                )}
                                {ev.direction}
                              </span>
                            </td>
                            <td className="py-2 px-2 font-mono text-[11px] text-slate-300">
                              <button
                                type="button"
                                data-testid={`firewall-cell-iface-${idx}`}
                                onClick={() =>
                                  addCellFilterChip({
                                    kind: 'interface',
                                    label: 'Interface',
                                    value: ifaceValue,
                                  })
                                }
                                title={`Filter by interface ${ifaceValue}`}
                                className="hover:text-indigo-300 hover:underline cursor-pointer"
                              >
                                {ifaceValue}
                              </button>
                            </td>
                            <td className="py-2 px-2 font-mono text-[11px] uppercase text-slate-300">
                              <button
                                type="button"
                                data-testid={`firewall-cell-proto-${idx}`}
                                onClick={() =>
                                  setProtocolFilter(ev.protocol.toLowerCase())
                                }
                                title={`Filter by protocol ${ev.protocol.toUpperCase()}`}
                                className="hover:text-indigo-300 hover:underline cursor-pointer"
                              >
                                {ev.protocol}
                              </button>
                            </td>
                            <td className="py-2 px-3">
                              <div className="font-mono text-slate-200">
                                <button
                                  type="button"
                                  data-testid={`firewall-cell-src-${idx}`}
                                  onClick={() =>
                                    addCellFilterChip({
                                      kind: 'source_ip',
                                      label: 'Source IP',
                                      value: ev.source_ip,
                                    })
                                  }
                                  title={`Filter by source IP ${ev.source_ip}`}
                                  className="hover:text-indigo-300 hover:underline cursor-pointer"
                                >
                                  {ev.source_ip}
                                </button>
                                {ev.source_port !== null ? `:${ev.source_port}` : ''}
                              </div>
                              {(ev.source_name || ev.source_org) && (
                                <div className="text-[11px] text-slate-400 truncate max-w-[200px]">
                                  {ev.source_name || ev.source_org}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              <div className="font-mono text-slate-200">
                                <button
                                  type="button"
                                  data-testid={`firewall-cell-dst-${idx}`}
                                  onClick={() =>
                                    addCellFilterChip({
                                      kind: 'destination_ip',
                                      label: 'Dest IP',
                                      value: ev.destination_ip,
                                    })
                                  }
                                  title={`Filter by destination IP ${ev.destination_ip}`}
                                  className="hover:text-indigo-300 hover:underline cursor-pointer"
                                >
                                  {ev.destination_ip}
                                </button>
                                {ev.destination_port !== null && (
                                  <>
                                    :
                                    <button
                                      type="button"
                                      data-testid={`firewall-cell-port-${idx}`}
                                      onClick={() =>
                                        addCellFilterChip({
                                          kind: 'port',
                                          label: 'Port',
                                          value: String(ev.destination_port),
                                        })
                                      }
                                      title={`Filter by port ${ev.destination_port}`}
                                      className="hover:text-indigo-300 hover:underline cursor-pointer"
                                    >
                                      {ev.destination_port}
                                    </button>
                                  </>
                                )}
                              </div>
                              {(ev.destination_name || ev.destination_org) && (
                                <div className="text-[11px] text-slate-400 truncate max-w-[200px]">
                                  {ev.destination_name || ev.destination_org}
                                </div>
                              )}
                            </td>
                            <td className="py-2 pl-3 text-right font-mono text-slate-300">
                              {formatBytes(ev.bytes)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </TelemetryLoadingShell>
        )}

        <FirewallOpenPortSessionsDrawer
          openPort={selectedOpenPort}
          initialWindow={windowKey}
          onClose={() => setSelectedOpenPort(null)}
        />

        <DeviceAnalyticsDrawer
          deviceId={selectedLanDeviceId}
          initialWindow={windowKey}
          onClose={() => setSelectedLanDeviceId(null)}
        />
      </div>
    </AppLayout>
  )
}

