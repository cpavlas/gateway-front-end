import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Building2,
  Clock,
  Globe,
  HardDrive,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react'
import {
  apiClient,
  formatBytes,
  type TimeWindow,
} from '../api/client'
import { getGroupBadgeClasses } from './GroupFormModal'

interface GroupAnalyticsDrawerProps {
  groupId: number | null
  initialWindow?: TimeWindow
  onClose: () => void
  onSelectDeviceId?: (deviceId: number) => void
}

const TIME_WINDOWS: { key: TimeWindow; label: string }[] = [
  { key: '1h', label: 'Last 1h' },
  { key: '24h', label: 'Last 24h' },
  { key: '7d', label: 'Last 7d' },
  { key: '30d', label: 'Last 30d' },
]

export const GroupAnalyticsDrawer: React.FC<GroupAnalyticsDrawerProps> = ({
  groupId,
  initialWindow = '24h',
  onClose,
  onSelectDeviceId,
}) => {
  const queryClient = useQueryClient()
  const [windowKey, setWindowKey] = useState<TimeWindow>(initialWindow)
  const [domainSearch, setDomainSearch] = useState('')
  const [actionBanner, setActionBanner] = useState<string | null>(null)

  const {
    data: analytics,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['groupAnalytics', groupId, windowKey, domainSearch.trim()],
    queryFn: () =>
      apiClient.getGroupAnalytics(groupId!, {
        window: windowKey,
        domain_search: domainSearch.trim() || undefined,
      }),
    enabled: groupId !== null,
    placeholderData: (previousData) => previousData,
  })

  const refreshMutation = useMutation({
    mutationFn: () =>
      apiClient.getGroupAnalytics(groupId!, {
        window: windowKey,
        domain_search: domainSearch.trim() || undefined,
        refresh: true,
      }),
    onSuccess: (fresh) => {
      queryClient.setQueryData(
        ['groupAnalytics', groupId, windowKey, domainSearch.trim()],
        fresh,
      )
    },
  })

  const bulkAccessMutation = useMutation({
    mutationFn: async (action: 'block' | 'unblock') => {
      if (!groupId) throw new Error('No group selected')
      return action === 'block'
        ? apiClient.blockGroup(groupId)
        : apiClient.unblockGroup(groupId)
    },
    onSuccess: (res) => {
      setActionBanner(res.warnings.length > 0 ? res.warnings.join(' • ') : null)
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groupAnalytics', groupId] })
    },
    onError: (err: unknown) => {
      setActionBanner(
        err instanceof Error ? err.message : 'Failed to toggle group internet access.',
      )
    },
  })

  if (groupId === null) {
    return null
  }

  const group = analytics?.group
  const summary = analytics?.summary
  const memberBreakdown = analytics?.member_breakdown ?? []
  const timeline = analytics?.timeline ?? []
  const hourlyProfile = analytics?.hourly_access_profile ?? []
  const topDomains = analytics?.top_domains ?? []
  const topOrgs = analytics?.top_organizations ?? []
  const recentQueries = analytics?.recent_queries ?? []

  const maxTimelineEvents = Math.max(1, ...timeline.map((b) => b.total_events))
  const maxHourlyEvents = Math.max(1, ...hourlyProfile.map((h) => h.total_events))
  const maxDomainCount = Math.max(1, ...topDomains.map((d) => d.query_count))
  const maxMemberBytes = Math.max(1, ...memberBreakdown.map((m) => m.bytes))

  return (
    <div
      data-testid="group-analytics-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Group usage and domains analytics"
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/75 backdrop-blur-xs"
    >
      <div className="relative flex h-full w-full max-w-4xl flex-col border-l border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
        {/* Drawer Header */}
        <div className="flex flex-col gap-3 border-b border-slate-800 bg-slate-950/90 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <Users className="h-5 w-5 text-indigo-400 shrink-0" aria-hidden="true" />
              <h2 className="text-lg font-bold text-slate-100 truncate">
                {group ? group.name : `Group #${groupId}`}
              </h2>
              {group && (
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getGroupBadgeClasses(
                    group.color_badge,
                  )}`}
                >
                  {group.total_devices} {group.total_devices === 1 ? 'device' : 'devices'}
                </span>
              )}
              {group && (
                <span
                  data-testid="group-drawer-status-badge"
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                    group.access_status === 'blocked'
                      ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                      : group.access_status === 'partially_blocked'
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                        : group.access_status === 'allowed'
                          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                          : 'border-slate-700 bg-slate-800 text-slate-400'
                  }`}
                >
                  {group.access_status === 'blocked'
                    ? 'All Blocked'
                    : group.access_status === 'partially_blocked'
                      ? 'Partially Blocked'
                      : group.access_status === 'allowed'
                        ? 'All Allowed'
                        : 'Empty / No Blockable IPs'}
                </span>
              )}
            </div>
            {group?.description && (
              <p className="mt-1 text-xs text-slate-400">{group.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2.5 self-start sm:self-center">
            {group && group.blockable_devices > 0 && (
              <>
                {group.access_status === 'blocked' ? (
                  <button
                    type="button"
                    data-testid="group-drawer-access-toggle"
                    disabled={bulkAccessMutation.isPending}
                    onClick={() => bulkAccessMutation.mutate('unblock')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-60 cursor-pointer"
                  >
                    <ShieldAlert className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
                    <span>
                      {bulkAccessMutation.isPending ? 'Updating...' : 'Allow Group Internet'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="group-drawer-access-toggle"
                    disabled={bulkAccessMutation.isPending}
                    onClick={() => bulkAccessMutation.mutate('block')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60 cursor-pointer"
                  >
                    <Globe className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    <span>
                      {bulkAccessMutation.isPending ? 'Blocking...' : 'Block Group Internet'}
                    </span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              aria-label="Close group analytics drawer"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Time Window Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/80 px-6 py-3">
          <div className="flex items-center gap-1.5" role="group" aria-label="Analytics time window">
            {TIME_WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                data-testid={`group-drawer-window-${w.key}`}
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
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending || isFetching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                refreshMutation.isPending || isFetching ? 'animate-spin' : ''
              }`}
              aria-hidden="true"
            />
            <span>Refresh Telemetry</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {(analytics?.warning || actionBanner) && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-200"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{actionBanner ?? analytics?.warning}</span>
            </div>
          )}

          {isLoading && !analytics ? (
            <div
              data-testid="group-drawer-loading"
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-10 text-center text-sm text-slate-400"
            >
              Querying combined group telemetry from Elasticsearch 9.4.3...
            </div>
          ) : (
            <>
              {/* Summary KPI Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Group Bandwidth</span>
                    <HardDrive className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                  </div>
                  <p
                    data-testid="group-drawer-kpi-bytes"
                    className="mt-1.5 text-lg font-bold text-slate-100"
                  >
                    {formatBytes(summary?.total_bytes ?? 0)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {(summary?.firewall_event_count ?? 0).toLocaleString()} filterlog packets
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>DNS Queries</span>
                    <Globe className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  </div>
                  <p
                    data-testid="group-drawer-kpi-dns"
                    className="mt-1.5 text-lg font-bold text-emerald-300"
                  >
                    {(summary?.dns_query_count ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Across {analytics?.tracked_ips.length ?? 0} tracked member IPs
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Allowed / Blocked</span>
                    <Activity className="h-4 w-4 text-rose-400" aria-hidden="true" />
                  </div>
                  <p className="mt-1.5 text-lg font-bold text-slate-100">
                    <span className="text-emerald-300">
                      {(summary?.allowed_packet_count ?? 0).toLocaleString()}
                    </span>
                    {' / '}
                    <span className="text-rose-300">
                      {(summary?.blocked_packet_count ?? 0).toLocaleString()}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">Pass vs Block packets</p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Active Hours</span>
                    <Clock className="h-4 w-4 text-amber-400" aria-hidden="true" />
                  </div>
                  <p
                    data-testid="group-drawer-kpi-hours"
                    className="mt-1.5 text-lg font-bold text-amber-300"
                  >
                    {summary?.active_hours_in_day ?? 0} / 24 hrs
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400 truncate">
                    {summary?.last_active_at
                      ? `Last: ${new Date(summary.last_active_at).toLocaleTimeString()}`
                      : 'No activity in window'}
                  </p>
                </div>
              </div>

              {/* Per-Member Traffic & DNS Contribution Breakdown (Waterfall Update 4A) */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">
                      Per-Member Traffic &amp; DNS Contribution
                    </h3>
                    <p className="text-xs text-slate-400">
                      Individual bandwidth and DNS query breakdown across assigned member devices
                    </p>
                  </div>
                </div>

                {memberBreakdown.length === 0 ? (
                  <p className="mt-4 text-center text-xs text-slate-500">
                    No member devices assigned to this group.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2.5">
                    {memberBreakdown.map((m) => {
                      const pct = Math.max(4, Math.round((m.bytes / maxMemberBytes) * 100))
                      return (
                        <div
                          key={m.device_id}
                          data-testid={`group-member-breakdown-${m.device_id}`}
                          className="rounded-lg border border-slate-800/90 bg-slate-900/70 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  m.is_online ? 'bg-emerald-400' : 'bg-slate-600'
                                }`}
                              />
                              <button
                                type="button"
                                onClick={() => onSelectDeviceId && onSelectDeviceId(m.device_id)}
                                className="font-semibold text-slate-100 hover:text-indigo-300 cursor-pointer"
                              >
                                {m.effective_name}
                              </button>
                              <span className="font-mono text-slate-400">
                                ({m.ipv4_address ?? 'No IP'})
                              </span>
                              {m.is_blocked && (
                                <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                                  Blocked
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 font-mono text-[11px] text-slate-300">
                              <span>{formatBytes(m.bytes)}</span>
                              <span className="text-emerald-300">
                                {m.dns_query_count.toLocaleString()} DNS
                              </span>
                              <span className="text-slate-400">
                                {m.total_events.toLocaleString()} events
                              </span>
                            </div>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-950 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${m.bytes > 0 ? pct : 0}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Usage Timeline & 24-Hour Access Profile */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-200">
                      Group Activity Timeline ({windowKey})
                    </h3>
                    <div
                      data-testid="group-timeline-legend"
                      className="flex items-center gap-2.5 text-[11px] text-slate-300"
                    >
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-xs bg-cyan-400" />
                        <span>DNS Queries</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-xs bg-indigo-500" />
                        <span>Firewall Events</span>
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex h-28 items-end gap-1 pt-2">
                    {timeline.length === 0 ? (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                        No timeline buckets in selected window.
                      </div>
                    ) : (
                      timeline.map((b, idx) => {
                        const dnsCount = Math.max(0, b.dns_queries)
                        const fwCount = Math.max(0, b.total_events - dnsCount)
                        const combinedTotal = Math.max(b.total_events, dnsCount + fwCount)
                        const heightPct = Math.max(
                          6,
                          Math.round((combinedTotal / maxTimelineEvents) * 100),
                        )
                        const dnsSharePct =
                          combinedTotal > 0 ? Math.round((dnsCount / combinedTotal) * 100) : 50
                        const fwSharePct = Math.max(0, 100 - dnsSharePct)
                        const tooltipText = `${new Date(b.timestamp).toLocaleString()} — Total: ${combinedTotal.toLocaleString()} events | DNS Queries: ${dnsCount.toLocaleString()} | Firewall Events: ${fwCount.toLocaleString()} (${formatBytes(b.bytes)})`
                        return (
                          <div
                            key={`${b.timestamp}-${idx}`}
                            title={tooltipText}
                            className="group relative flex-1 flex flex-col items-center justify-end h-full"
                          >
                            <div
                              style={{ height: `${combinedTotal > 0 ? heightPct : 4}%` }}
                              className="w-full flex flex-col overflow-hidden rounded-t transition-all"
                            >
                              <div
                                style={{ height: `${dnsSharePct}%` }}
                                className="w-full bg-cyan-400/85 group-hover:bg-cyan-300"
                              />
                              <div
                                style={{ height: `${fwSharePct}%` }}
                                className="w-full bg-indigo-500/85 group-hover:bg-indigo-400"
                              />
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <h3 className="text-sm font-semibold text-slate-200">
                    24-Hour Group Access Time Profile
                  </h3>
                  <div className="mt-3 grid grid-cols-24 gap-1 items-end h-28 pt-2">
                    {hourlyProfile.map((h) => {
                      const pct =
                        h.total_events > 0
                          ? Math.max(10, Math.round((h.total_events / maxHourlyEvents) * 100))
                          : 4
                      return (
                        <div key={h.hour} className="flex flex-col items-center h-full justify-end">
                          <div
                            title={`${h.label} — ${h.total_events.toLocaleString()} events`}
                            className={`w-full rounded-t transition-all ${
                              h.total_events > 0
                                ? 'bg-amber-400/85 hover:bg-amber-300'
                                : 'bg-slate-800/60'
                            }`}
                            style={{ height: `${pct}%` }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Top Domains & Top Destination Organizations */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <h3 className="text-sm font-semibold text-slate-200">
                    Top Visited Domains (Group DNS)
                  </h3>
                  {topDomains.length === 0 ? (
                    <p className="mt-4 text-xs text-slate-500">
                      No Unbound DNS queries recorded for this group in the selected window.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-xs">
                      {topDomains.slice(0, 8).map((item) => {
                        const widthPct = Math.max(
                          6,
                          Math.round((item.query_count / maxDomainCount) * 100),
                        )
                        return (
                          <li key={item.domain} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-slate-200 truncate">
                                {item.domain}
                              </span>
                              <span className="font-mono text-emerald-300 shrink-0">
                                {item.query_count.toLocaleString()}
                              </span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-900 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-emerald-500/70"
                                style={{ width: `${widthPct}%` }}
                              />
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-slate-200">
                      Top Destination Organizations (ASN)
                    </h3>
                  </div>
                  {topOrgs.length === 0 ? (
                    <p className="mt-4 text-xs text-slate-500">
                      No GeoIP/ASN organization metadata recorded in this window.
                    </p>
                  ) : (
                    <ul className="mt-3 divide-y divide-slate-800/70 text-xs">
                      {topOrgs.slice(0, 8).map((org) => (
                        <li
                          key={org.organization}
                          className="flex items-center justify-between py-2"
                        >
                          <span className="text-slate-200 truncate pr-2">{org.organization}</span>
                          <div className="text-right font-mono text-[11px] shrink-0">
                            <span className="text-indigo-300">{formatBytes(org.bytes)}</span>
                            <span className="ml-2 text-slate-500">
                              ({org.packet_count.toLocaleString()} pkts)
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Chronological Recent DNS Queries Feed */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">
                      Recent Group DNS Queries (Chronological)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Most recent domain lookups across all member devices in this group
                    </p>
                  </div>

                  <div className="relative w-full sm:w-64">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      aria-label="Filter group recent domains"
                      value={domainSearch}
                      onChange={(e) => setDomainSearch(e.target.value)}
                      placeholder="Filter domain substring..."
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                {recentQueries.length === 0 ? (
                  <p className="mt-4 text-center text-xs text-slate-500 py-4">
                    No matching DNS queries found in this window.
                  </p>
                ) : (
                  <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-800">
                    <table className="min-w-full divide-y divide-slate-800 text-left text-xs">
                      <thead className="bg-slate-900/90 font-semibold uppercase text-slate-400">
                        <tr>
                          <th className="px-3 py-2">Time</th>
                          <th className="px-3 py-2">Member Device</th>
                          <th className="px-3 py-2">Queried Domain</th>
                          <th className="px-3 py-2 text-right">Record</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70 font-mono">
                        {recentQueries.map((q, idx) => (
                          <tr key={`${q.timestamp}-${q.domain}-${idx}`} className="hover:bg-slate-900/50">
                            <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                              {q.timestamp ? new Date(q.timestamp).toLocaleTimeString() : '—'}
                            </td>
                            <td className="px-3 py-2 text-indigo-300 font-sans">
                              {q.device_name ?? q.source_ip ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-100 break-all">{q.domain}</td>
                            <td className="px-3 py-2 text-right text-emerald-300">
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

