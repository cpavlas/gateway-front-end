import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Filter,
  Globe,
  Lock,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Unlock,
} from 'lucide-react'
import {
  apiClient,
  formatBlockedPercentage,
  formatBytes,
  formatClock24h,
  type FirewallOverviewResponse,
  type TimeWindow,
} from '../api/client'
import { AppLayout, type AppTab } from '../components/AppLayout'
import { AutoRefreshSelector, useAutoRefresh } from '../components/AutoRefreshSelector'
import { TelemetryLoadingShell } from '../components/TelemetryLoadingShell'
import { TimelineBarChart } from '../components/TelemetryBarChart'

interface FirewallPageProps {
  activeTab?: AppTab
  onSelectTab?: (tab: AppTab) => void
}

const TIME_WINDOWS: { key: TimeWindow; label: string }[] = [
  { key: '1h', label: 'Last 1h' },
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7d' },
  { key: '30d', label: 'Last 30d' },
]

export const FirewallPage: React.FC<FirewallPageProps> = ({
  activeTab = 'firewall',
  onSelectTab,
}) => {
  const queryClient = useQueryClient()
  const [windowKey, setWindowKey] = useState<TimeWindow>('24h')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [directionFilter, setDirectionFilter] = useState<string>('all')
  const [protocolFilter, setProtocolFilter] = useState<string>('all')
  const [searchInput, setSearchInput] = useState<string>('')
  const [actionBanner, setActionBanner] = useState<string | null>(null)
  const [windowSnapshots, setWindowSnapshots] = useState<
    Partial<Record<TimeWindow, FirewallOverviewResponse>>
  >({})
  const { intervalOption, setIntervalOption, refetchInterval } = useAutoRefresh('30s')

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
      searchInput,
    ],
    queryFn: () =>
      apiClient.getFirewallOverview({
        window: windowKey,
        action: actionFilter,
        direction: directionFilter,
        protocol: protocolFilter,
        search: searchInput,
      }),
    refetchInterval,
    placeholderData: (previousData) => previousData,
  })

  useEffect(() => {
    if (overview && overview.window === windowKey && !windowSnapshots[windowKey]) {
      setWindowSnapshots((prev) => ({
        ...prev,
        [windowKey]: overview,
      }))
    }
  }, [overview, windowKey, windowSnapshots])

  const { data: healthReport } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: () => apiClient.getSystemHealth(),
    refetchInterval: 60_000,
  })

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiClient.getFirewallOverview({
        window: windowKey,
        action: actionFilter,
        direction: directionFilter,
        protocol: protocolFilter,
        search: searchInput,
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
          searchInput,
        ],
        fresh,
      )
    },
  })

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

  const lockedWindowOverview = windowSnapshots[windowKey] ?? overview
  const summary = lockedWindowOverview?.summary
  const timeline = lockedWindowOverview?.timeline ?? []
  const noisyLanDevices = lockedWindowOverview?.noisy_lan_devices ?? []
  const externalScanners = lockedWindowOverview?.external_scanners ?? []
  const openWanPorts = lockedWindowOverview?.open_wan_ports ?? []
  const recentEvents = overview?.recent_events ?? []
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
                  onClick={() => refreshMutation.mutate()}
                  disabled={isFetching || refreshMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      isFetching || refreshMutation.isPending ? 'animate-spin' : ''
                    }`}
                    aria-hidden="true"
                  />
                  <span>Refresh Firewall</span>
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

                          {dev.device_id !== null && !dev.is_protected && (
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
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                                dev.is_blocked
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                                  : 'border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                              }`}
                            >
                              {dev.is_blocked ? (
                                <>
                                  <Unlock className="h-3.5 w-3.5" />
                                  <span>Unblock Device</span>
                                </>
                              ) : (
                                <>
                                  <Ban className="h-3.5 w-3.5" />
                                  <span>Block Device</span>
                                </>
                              )}
                            </button>
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
                      className="space-y-1.5 max-h-56 overflow-y-auto pr-1"
                    >
                      {externalScanners.map((scanner) => (
                        <div
                          key={scanner.source_ip}
                          data-testid={`firewall-scanner-${scanner.source_ip}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800/70 bg-slate-950/50 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-amber-300">
                                {scanner.source_ip}
                              </span>
                              {scanner.organization && (
                                <span className="truncate text-[11px] text-slate-400">
                                  ({scanner.organization})
                                </span>
                              )}
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
                          <div className="text-right font-mono">
                            <span className="font-semibold text-rose-300">
                              {scanner.blocked_packets.toLocaleString()} blocked
                            </span>
                            <p className="text-[10px] text-slate-500">
                              {formatBytes(scanner.bytes)}
                            </p>
                          </div>
                        </div>
                      ))}
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
                            <td className="py-2.5 pl-3 text-right font-mono text-amber-300">
                              {wp.unique_external_sources.toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

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
                      Recent matching OPNsense filterlog entries ({recentEvents.length} shown)
                    </p>
                  </div>
                </div>

                {/* Search & Filter Controls */}
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
                </div>
              </div>

              {recentEvents.length === 0 ? (
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
                      {recentEvents.map((ev, idx) => {
                        const isBlocked = ev.action === 'block'
                        const isInbound =
                          ev.direction === 'inbound' || ev.direction === 'in'
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
                              {ev.interface || 'N/A'}
                            </td>
                            <td className="py-2 px-2 font-mono text-[11px] uppercase text-slate-300">
                              {ev.protocol}
                            </td>
                            <td className="py-2 px-3">
                              <div className="font-mono text-slate-200">
                                {ev.source_ip}
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
                                {ev.destination_ip}
                                {ev.destination_port !== null
                                  ? `:${ev.destination_port}`
                                  : ''}
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
      </div>
    </AppLayout>
  )
}

