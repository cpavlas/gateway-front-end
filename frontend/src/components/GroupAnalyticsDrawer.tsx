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
  Tv,
  VideoOff,
  Users,
  X,
} from 'lucide-react'
import {
  apiClient,
  formatActiveMinutes,
  formatBlockedPercentage,
  formatBytes,
  formatClock24h,
  type TimeWindow,
} from '../api/client'
import { getGroupBadgeClasses } from './GroupFormModal'
import { HourlyProfileBarChart, TimelineBarChart } from './TelemetryBarChart'

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
    dataUpdatedAt,
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

  const youtubeMutation = useMutation({
    mutationFn: async (action: 'block' | 'unblock') => {
      if (!groupId) throw new Error('No group selected')
      return action === 'block'
        ? apiClient.blockGroupYoutube(groupId)
        : apiClient.unblockGroupYoutube(groupId)
    },
    onSuccess: () => {
      setActionBanner(null)
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groupAnalytics', groupId] })
    },
    onError: (err: unknown) => {
      setActionBanner(
        err instanceof Error ? err.message : 'Failed to toggle group YouTube access.',
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
  const appUsage = analytics?.application_usage ?? [
    { app_key: 'youtube' as const, display_name: 'YouTube', active_minutes: 0, event_count: 0, dns_queries: 0, bytes: 0, last_active_at: null, top_devices: [] },
    { app_key: 'plex' as const, display_name: 'Plex', active_minutes: 0, event_count: 0, dns_queries: 0, bytes: 0, last_active_at: null, top_devices: [] },
  ]

  const maxDomainCount = Math.max(1, ...topDomains.map((d) => d.query_count))
  const maxMemberBytes = Math.max(1, ...memberBreakdown.map((m) => m.bytes))
  const lastUpdatedClock = formatClock24h(analytics?.generated_at || dataUpdatedAt)

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

          <div className="flex flex-col items-end gap-0.5">
            <button
              type="button"
              data-testid="group-drawer-refresh-btn"
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
            {lastUpdatedClock && (
              <span
                data-testid="group-drawer-last-updated"
                className="text-[10px] font-mono text-slate-400"
              >
                Updated: {lastUpdatedClock}
              </span>
            )}
          </div>
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
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Pass vs Block ({formatBlockedPercentage(summary?.blocked_packet_count ?? 0, summary?.allowed_packet_count ?? 0)})
                  </p>
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

              {/* Application Usage & Control (FB-P6-004, FB-P6-005, FB-P8-002) */}
              <div
                data-testid="group-drawer-app-usage-panel"
                className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-200">
                    Application Usage &amp; Group Control
                  </h3>
                  <p className="text-xs text-slate-400">
                    Combined group streaming duration and one-click YouTube blocking across group members
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {appUsage.map((app) => {
                    const isYoutube = app.app_key === 'youtube'
                    const appTopDevices = (app.top_devices ?? []).slice(0, 3)
                    return (
                      <div
                        key={app.app_key}
                        data-testid={`group-drawer-app-card-${app.app_key}`}
                        className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/90 p-3.5"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Tv
                                className={`h-4 w-4 ${isYoutube ? 'text-rose-400' : 'text-amber-400'}`}
                                aria-hidden="true"
                              />
                              <div>
                                <span className="text-sm font-bold text-slate-100">
                                  {app.display_name}
                                </span>
                                <p className="text-[11px] text-slate-400">
                                  {(app.dns_queries ?? 0).toLocaleString()} DNS queries •{' '}
                                  {formatBytes(app.bytes ?? 0)}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <span
                                data-testid={`group-drawer-app-minutes-${app.app_key}`}
                                className="text-base font-bold text-indigo-300 font-mono"
                              >
                                {formatActiveMinutes(app.active_minutes)}
                              </span>
                              <p className="text-[10px] text-slate-400">Active time ({windowKey})</p>
                            </div>
                          </div>

                          {appTopDevices.length > 0 && (
                            <div
                              data-testid={`group-drawer-app-top-devices-${app.app_key}`}
                              className="mt-2.5 border-t border-slate-800/70 pt-2"
                            >
                              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                                Top Group Devices
                              </span>
                              <ul className="space-y-1 text-xs">
                                {appTopDevices.map((dev, idx) => (
                                  <li
                                    key={`${dev.ipv4_address}-${idx}`}
                                    className="flex items-center justify-between gap-2"
                                  >
                                    <span className="truncate text-slate-300">
                                      #{idx + 1} {dev.effective_name}
                                    </span>
                                    <span className="font-mono text-indigo-300">
                                      {formatActiveMinutes(dev.active_minutes)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>

                        {isYoutube && group && group.blockable_devices > 0 && (
                          <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2.5">
                            <span className="text-[11px] text-slate-400">
                              {group.youtube_status === 'blocked'
                                ? 'YouTube blocked for group'
                                : 'YouTube allowed for group'}
                            </span>
                            <button
                              type="button"
                              data-testid="group-drawer-youtube-toggle"
                              disabled={youtubeMutation.isPending}
                              onClick={() =>
                                youtubeMutation.mutate(
                                  group.youtube_status === 'blocked' ? 'unblock' : 'block',
                                )
                              }
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer disabled:opacity-50 ${
                                group.youtube_status === 'blocked'
                                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
                                  : 'border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800'
                              }`}
                            >
                              <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>
                                {group.youtube_status === 'blocked'
                                  ? 'Allow YouTube'
                                  : 'Block YouTube'}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
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

              {/* Usage Timeline & 24-Hour Access Profile (FB-P8-004 & FB-P8-005) */}
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-slate-200">
                      Group Activity Timeline ({windowKey})
                    </h3>
                    <p className="text-xs text-slate-400">
                      Combined DNS queries and firewall packets across group members
                    </p>
                  </div>
                  <TimelineBarChart
                    timeline={timeline}
                    windowKey={windowKey}
                    prefixTestId="group-timeline"
                    chartTestId="group-timeline-chart"
                    legendTestId="group-timeline-legend"
                    compact={true}
                  />
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-slate-200">
                      24-Hour Group Access Time Profile
                    </h3>
                    <p className="text-xs text-slate-400">
                      Hourly online activity distribution across group members (00:00 - 23:00)
                    </p>
                  </div>
                  <HourlyProfileBarChart
                    hourlyProfile={hourlyProfile}
                    prefixTestId="group-hourly"
                    chartTestId="group-hourly-profile"
                    compact={true}
                  />
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
                              {q.timestamp ? new Date(q.timestamp).toLocaleTimeString() : '-'}
                            </td>
                            <td className="px-3 py-2 text-indigo-300 font-sans">
                              {q.device_name ?? q.source_ip ?? '-'}
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
