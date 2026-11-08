import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Clock,
  Globe,
  MapPin,
  Network,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  apiClient,
  formatActiveMinutes,
  formatBytes,
  formatClock24h,
  type FirewallOpenWanPortItem,
  type TimeWindow,
} from '../api/client'
import { AutoRefreshSelector, useAutoRefresh } from './AutoRefreshSelector'
import { TelemetryLoadingShell } from './TelemetryLoadingShell'

interface FirewallOpenPortSessionsDrawerProps {
  openPort: FirewallOpenWanPortItem | null
  initialWindow?: TimeWindow
  onClose: () => void
}

const TIME_WINDOWS: { key: TimeWindow; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '1h', label: 'Last 1h' },
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7d' },
  { key: '30d', label: 'Last 30d' },
]

export const FirewallOpenPortSessionsDrawer: React.FC<
  FirewallOpenPortSessionsDrawerProps
> = ({ openPort, initialWindow = 'today', onClose }) => {
  const queryClient = useQueryClient()
  const [windowKey, setWindowKey] = useState<TimeWindow>(initialWindow)
  const [searchInput, setSearchInput] = useState<string>('')
  const { intervalOption, setIntervalOption, refetchInterval } = useAutoRefresh('30s')

  const destinationIp = openPort?.destination_ip ?? ''
  const destinationPort = openPort?.destination_port ?? 0
  const externalPort = openPort?.external_port ?? openPort?.destination_port ?? 0
  const protocol = openPort?.protocol ?? 'tcp'

  const queryKey = [
    'firewallOpenPortSessions',
    destinationIp,
    destinationPort,
    externalPort,
    protocol,
    windowKey,
    searchInput.trim(),
  ]

  const {
    data: sessions,
    dataUpdatedAt,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey,
    queryFn: () =>
      apiClient.getFirewallOpenPortSessions({
        destination_ip: destinationIp,
        destination_port: destinationPort,
        external_port: externalPort,
        protocol,
        window: windowKey,
        search: searchInput.trim() || undefined,
      }),
    enabled: openPort !== null,
    refetchInterval,
    placeholderData: (previousData) => previousData,
  })

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiClient.getFirewallOpenPortSessions({
        destination_ip: destinationIp,
        destination_port: destinationPort,
        external_port: externalPort,
        protocol,
        window: windowKey,
        search: searchInput.trim() || undefined,
        refresh: true,
      }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(queryKey, fresh)
    },
  })

  if (openPort === null) {
    return null
  }

  const effectiveName = sessions?.effective_name || openPort.effective_name
  const portMapping =
    sessions?.port_mapping ||
    openPort.port_mapping ||
    `${externalPort}:${destinationPort}`
  const summary = sessions?.summary
  const connectedIps = sessions?.external_ips ?? []
  const recentEvents = sessions?.recent_events ?? []
  const lastUpdatedClock = formatClock24h(sessions?.generated_at || dataUpdatedAt)

  return (
    <div
      data-testid="firewall-open-port-sessions-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Open WAN port connected external IPs inspector"
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/75 backdrop-blur-xs"
    >
      <div className="relative flex h-full w-full max-w-5xl flex-col border-l border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Drawer Header */}
        <div className="flex flex-col gap-3 border-b border-slate-800 bg-slate-950/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Globe className="h-4 w-4 text-amber-400" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-100">{effectiveName}</h2>
              <span className="rounded bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 font-mono text-xs font-semibold text-amber-300">
                {portMapping} / {protocol.toUpperCase()}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-slate-400">
              Target LAN Host: {destinationIp} • Inbound WAN Permitted Sessions Inspector
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="close-open-port-drawer-btn"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
              aria-label="Close open port sessions drawer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Time Window & Refresh Bar (matches DeviceAnalyticsDrawer layout) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/90 px-6 py-3">
          <div
            className="flex items-center gap-1.5"
            role="group"
            aria-label="Open port sessions time window"
          >
            {TIME_WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                data-testid={`open-port-drawer-window-${w.key}`}
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

          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="open-port-drawer-refresh-btn"
                aria-label="Refresh Telemetry"
                title="Refresh Telemetry"
                onClick={() => refreshMutation.mutate()}
                disabled={isFetching || refreshMutation.isPending}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-60 cursor-pointer shrink-0"
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
                testId="open-port-drawer-auto-refresh-select"
                compact
              />
            </div>
            {lastUpdatedClock && (
              <span
                data-testid="open-port-drawer-last-updated"
                className="text-[10px] font-mono text-slate-400"
              >
                Updated: {lastUpdatedClock}
              </span>
            )}
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {sessions?.warning && (
            <div
              data-testid="open-port-drawer-warning"
              className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-200"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <span>{sessions.warning}</span>
            </div>
          )}

          {isLoading && !sessions ? (
            <div
              data-testid="open-port-drawer-loading"
              className="py-12 text-center text-sm text-slate-400"
            >
              Loading inbound WAN sessions and GeoIP telemetry...
            </div>
          ) : (
            <TelemetryLoadingShell
              isFetching={isFetching || refreshMutation.isPending}
              isLoading={isLoading && !sessions}
              testId="open-port-drawer-loading-shell"
              className="space-y-5"
            >
              {/* Summary KPIs */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Connected External IPs</span>
                    <Globe className="h-3.5 w-3.5 text-amber-400" />
                  </div>
                  <p
                    data-testid="open-port-kpi-external-ips"
                    className="mt-1 font-mono text-lg font-bold text-amber-300"
                  >
                    {(summary?.unique_external_ips ?? 0).toLocaleString()}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Passed Inbound Packets</span>
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  <p
                    data-testid="open-port-kpi-passed-packets"
                    className="mt-1 font-mono text-lg font-bold text-emerald-300"
                  >
                    {(summary?.total_passed_packets ?? 0).toLocaleString()}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Inbound Volume</span>
                    <Activity className="h-3.5 w-3.5 text-cyan-400" />
                  </div>
                  <p
                    data-testid="open-port-kpi-bytes"
                    className="mt-1 font-mono text-lg font-bold text-cyan-300"
                  >
                    {formatBytes(summary?.total_bytes ?? 0)}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Top Source Country</span>
                    <MapPin className="h-3.5 w-3.5 text-indigo-400" />
                  </div>
                  <p
                    data-testid="open-port-kpi-top-country"
                    className="mt-1 truncate text-sm font-bold text-indigo-300"
                  >
                    {summary?.top_country || 'None'}
                  </p>
                </div>
              </div>

              {/* Search Filter */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Connected External IP Addresses ({connectedIps.length})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Public WAN hosts permitted inbound to {destinationIp}:{destinationPort}{' '}
                    with GeoIP location, ASN/ISP, and connection duration
                  </p>
                </div>

                <div className="relative min-w-[260px]">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    data-testid="open-port-sessions-search-input"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Filter by external IP, city, country, or ISP"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Connected External IPs Table */}
              {connectedIps.length === 0 ? (
                <div
                  data-testid="open-port-no-external-ips"
                  className="rounded-xl border border-slate-800 bg-slate-950/50 py-8 text-center text-xs text-slate-400"
                >
                  No connected external WAN IP addresses matched the current window or filter.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
                  <table
                    data-testid="open-port-external-ips-table"
                    className="w-full text-left text-xs"
                  >
                    <thead className="border-b border-slate-800 bg-slate-900/80 text-[11px] uppercase text-slate-400">
                      <tr>
                        <th className="py-2.5 px-3">External IP &amp; ISP / ASN</th>
                        <th className="py-2.5 px-3">GeoIP Location</th>
                        <th className="py-2.5 px-3">Connection Length &amp; Activity</th>
                        <th className="py-2.5 px-3 text-right">Packets &amp; Volume</th>
                        <th className="py-2.5 px-3">Session Telemetry</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {connectedIps.map((item) => (
                        <tr
                          key={item.source_ip}
                          data-testid={`open-port-ext-ip-row-${item.source_ip}`}
                          className="hover:bg-slate-800/40"
                        >
                          <td className="py-3 px-3 align-top">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-amber-300">
                                {item.source_ip}
                              </span>
                              {item.asn !== null && (
                                <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                                  AS{item.asn}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                              <Server className="h-3 w-3 shrink-0 text-slate-500" />
                              <span className="truncate max-w-[220px]">
                                {item.organization || 'Unknown ISP / ASN'}
                              </span>
                            </div>
                          </td>

                          <td className="py-3 px-3 align-top">
                            <div className="flex items-center gap-1.5 font-medium text-slate-200">
                              <MapPin className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                              <span>{item.location_label}</span>
                              {item.country_iso_code && (
                                <span className="rounded bg-indigo-500/20 border border-indigo-500/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-indigo-300">
                                  {item.country_iso_code}
                                </span>
                              )}
                            </div>
                            {item.latitude !== null && item.longitude !== null && (
                              <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                                Coords: {item.latitude.toFixed(3)},{' '}
                                {item.longitude.toFixed(3)}
                              </p>
                            )}
                          </td>

                          <td className="py-3 px-3 align-top">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">
                                <Clock className="h-3 w-3" />
                                {item.connection_duration_label}
                              </span>
                              <span className="font-mono text-[11px] text-cyan-300">
                                ({formatActiveMinutes(item.active_duration_minutes)} active)
                              </span>
                            </div>
                            <div className="mt-1 space-y-0.5 font-mono text-[10px] text-slate-400">
                              {item.first_seen_at && (
                                <div>
                                  First:{' '}
                                  {new Date(item.first_seen_at).toLocaleString([], {
                                    hour12: false,
                                  })}
                                </div>
                              )}
                              {item.last_seen_at && (
                                <div>
                                  Last:{' '}
                                  {new Date(item.last_seen_at).toLocaleString([], {
                                    hour12: false,
                                  })}
                                </div>
                              )}
                            </div>
                          </td>

                          <td className="py-3 px-3 text-right align-top font-mono">
                            <div className="font-bold text-emerald-300">
                              {item.passed_packets.toLocaleString()} pkts
                            </div>
                            <div className="text-[11px] text-slate-300">
                              {formatBytes(item.bytes)}
                            </div>
                          </td>

                          <td className="py-3 px-3 align-top text-[11px]">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {item.tcp_flags && (
                                <span className="rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
                                  Flags: {item.tcp_flags}
                                </span>
                              )}
                              {item.ttl !== null && (
                                <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                                  TTL {item.ttl}
                                </span>
                              )}
                            </div>
                            {item.source_ports.length > 0 && (
                              <div className="mt-1 font-mono text-[10px] text-slate-400">
                                Src Ports:{' '}
                                {item.source_ports
                                  .slice(0, 6)
                                  .map((p) => `:${p}`)
                                  .join(', ')}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Recent Inbound Packet Events Table */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-2">
                  <Network className="h-4 w-4 text-indigo-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Recent Permitted Inbound Packet Events ({recentEvents.length})
                  </h3>
                </div>

                {recentEvents.length === 0 ? (
                  <p className="rounded-xl border border-slate-800 bg-slate-950/40 py-6 text-center text-xs text-slate-500">
                    No recent inbound packet logs recorded for this port in the selected window.
                  </p>
                ) : (
                  <div className="max-h-72 overflow-x-auto overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60">
                    <table
                      data-testid="open-port-recent-events-table"
                      className="w-full text-left text-xs"
                    >
                      <thead className="sticky top-0 border-b border-slate-800 bg-slate-900 text-[11px] uppercase text-slate-400">
                        <tr>
                          <th className="py-2 px-3">Timestamp</th>
                          <th className="py-2 px-3">External Source</th>
                          <th className="py-2 px-3">Location</th>
                          <th className="py-2 px-3">Flags / TTL</th>
                          <th className="py-2 px-3">Interface</th>
                          <th className="py-2 px-3 text-right">Bytes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {recentEvents.map((ev, idx) => (
                          <tr
                            key={`${ev.timestamp}-${ev.source_ip}-${idx}`}
                            className="hover:bg-slate-800/40"
                          >
                            <td className="py-2 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                              {new Date(ev.timestamp).toLocaleString([], {
                                hour12: false,
                              })}
                            </td>
                            <td className="py-2 px-3">
                              <div className="font-mono text-amber-300">
                                {ev.source_ip}
                                {ev.source_port !== null ? `:${ev.source_port}` : ''}
                              </div>
                              {ev.organization && (
                                <div className="truncate max-w-[180px] text-[10px] text-slate-400">
                                  {ev.organization}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-3 text-[11px] text-slate-300">
                              {ev.location_label}
                            </td>
                            <td className="py-2 px-3 font-mono text-[11px] text-slate-300">
                              {ev.tcp_flags ? `Flags: ${ev.tcp_flags}` : '—'}
                              {ev.ttl !== null ? ` • TTL ${ev.ttl}` : ''}
                            </td>
                            <td className="py-2 px-3 font-mono text-[11px] text-slate-400">
                              {ev.interface}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-300">
                              {formatBytes(ev.bytes)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </TelemetryLoadingShell>
          )}
        </div>
      </div>
    </div>
  )
}
