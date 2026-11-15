import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Ban,
  Building2,
  Clock,
  Globe,
  HardDrive,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  Tv,
  VideoOff,
  X,
} from 'lucide-react'
import {
  apiClient,
  formatActiveMinutes,
  formatBlockedPercentage,
  formatBytes,
  formatClock24h,
  type AppUsageItem,
  type BlockedTargetCreatePayload,
  type TimeWindow,
  type TimerStartPayload,
} from '../api/client'
import { AutoRefreshSelector, useAutoRefresh } from './AutoRefreshSelector'
import { HourlyProfileBarChart, TimelineBarChart } from './TelemetryBarChart'
import { TelemetryLoadingShell } from './TelemetryLoadingShell'
import { TimerPopoverMenu } from './TimerPopoverMenu'
import { YouTubeLogoIcon } from './YouTubeLogoIcon'

interface DeviceAnalyticsDrawerProps {
  deviceId: number | null
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

export const DeviceAnalyticsDrawer: React.FC<DeviceAnalyticsDrawerProps> = ({
  deviceId,
  initialWindow = 'today',
  onClose,
}) => {
  const queryClient = useQueryClient()
  const [windowKey, setWindowKey] = useState<TimeWindow>(initialWindow)
  const [domainSearch, setDomainSearch] = useState('')
  const [actionBanner, setActionBanner] = useState<string | null>(null)
  const { intervalOption, setIntervalOption, refetchInterval } = useAutoRefresh('30s')

  const {
    data: analytics,
    dataUpdatedAt,
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
    refetchInterval,
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

  const youtubeMutation = useMutation({
    mutationFn: async (action: 'block' | 'unblock') => {
      if (!deviceId) throw new Error('No device selected')
      return action === 'block'
        ? apiClient.blockDeviceYoutube(deviceId)
        : apiClient.unblockDeviceYoutube(deviceId)
    },
    onSuccess: () => {
      setActionBanner(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['deviceAnalytics', deviceId] })
    },
    onError: (err: unknown) => {
      setActionBanner(
        err instanceof Error ? err.message : 'Failed to toggle YouTube access.',
      )
    },
  })

  const timerMutation = useMutation({
    mutationFn: (payload: TimerStartPayload) => {
      if (!deviceId) throw new Error('No device selected')
      return apiClient.startDeviceTimer(deviceId, payload)
    },
    onSuccess: () => {
      setActionBanner(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['deviceAnalytics', deviceId] })
    },
    onError: (err: unknown) => {
      setActionBanner(
        err instanceof Error ? err.message : 'Failed to start device timer.',
      )
    },
  })

  const cancelTimerMutation = useMutation({
    mutationFn: (overrideId: number) => apiClient.cancelTimer(overrideId, true),
    onSuccess: () => {
      setActionBanner(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['deviceAnalytics', deviceId] })
    },
    onError: (err: unknown) => {
      setActionBanner(
        err instanceof Error ? err.message : 'Failed to cancel active timer.',
      )
    },
  })

  const { data: blockedTargetsData } = useQuery({
    queryKey: ['blockedTargets'],
    queryFn: () => apiClient.getBlockedTargets(),
    enabled: deviceId !== null,
  })

  const blockTargetMutation = useMutation({
    mutationFn: (payload: BlockedTargetCreatePayload) => apiClient.createBlockedTarget(payload),
    onSuccess: (res) => {
      setActionBanner(
        res.warning ?? `Blocked ${res.item.target_value} (${res.item.scope_type}).`,
      )
      void queryClient.invalidateQueries({ queryKey: ['blockedTargets'] })
      void queryClient.invalidateQueries({ queryKey: ['systemHealth'] })
    },
    onError: (err: unknown) => {
      setActionBanner(err instanceof Error ? err.message : 'Failed to block domain/ASN target.')
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
  const appUsage: AppUsageItem[] = analytics?.application_usage ?? [
    { app_key: 'youtube', display_name: 'YouTube', active_minutes: 0, event_count: 0, dns_queries: 0, bytes: 0, last_active_at: null },
    { app_key: 'plex', display_name: 'Plex', active_minutes: 0, event_count: 0, dns_queries: 0, bytes: 0, last_active_at: null },
    { app_key: 'netflix', display_name: 'Netflix', active_minutes: 0, event_count: 0, dns_queries: 0, bytes: 0, last_active_at: null },
    { app_key: 'disney_plus', display_name: 'Disney+', active_minutes: 0, event_count: 0, dns_queries: 0, bytes: 0, last_active_at: null },
    { app_key: 'twitch', display_name: 'Twitch', active_minutes: 0, event_count: 0, dns_queries: 0, bytes: 0, last_active_at: null },
    { app_key: 'tiktok', display_name: 'TikTok', active_minutes: 0, event_count: 0, dns_queries: 0, bytes: 0, last_active_at: null },
    { app_key: 'discord', display_name: 'Discord', active_minutes: 0, event_count: 0, dns_queries: 0, bytes: 0, last_active_at: null },
    { app_key: 'gaming', display_name: 'Gaming', active_minutes: 0, event_count: 0, dns_queries: 0, bytes: 0, last_active_at: null },
  ]
  const activeBlockedForDevice = (blockedTargetsData?.items ?? []).filter(
    (b) => b.is_enabled && (b.scope_type === 'global' || b.device_id === device?.id),
  )
  const blockedDomainSet = new Set(
    activeBlockedForDevice
      .filter((b) => b.target_type === 'domain')
      .map((b) => b.target_value.toLowerCase()),
  )
  const blockedAsnSet = new Set(
    activeBlockedForDevice
      .filter((b) => b.target_type === 'asn')
      .map((b) => b.target_value.toUpperCase()),
  )

  const maxDomainCount = Math.max(1, ...topDomains.map((d) => d.query_count))
  const lastUpdatedClock = formatClock24h(analytics?.generated_at || dataUpdatedAt)

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

          <div className="flex flex-wrap items-center gap-1.5">
            {device && (
              <>
                {!device.is_protected && (
                  <button
                    type="button"
                    data-testid="drawer-youtube-toggle"
                    disabled={youtubeMutation.isPending || !device.ipv4_address}
                    aria-label={
                      device.is_youtube_blocked
                        ? `YouTube Blocked for ${device.effective_name}. Click to allow YouTube`
                        : `YouTube Allowed for ${device.effective_name}. Click to block YouTube`
                    }
                    title={
                      device.is_youtube_blocked
                        ? 'YouTube Blocked (Plex & Internet allowed) - Click to allow YouTube'
                        : 'YouTube Allowed - Click to block YouTube only'
                    }
                    onClick={() =>
                      youtubeMutation.mutate(device.is_youtube_blocked ? 'unblock' : 'block')
                    }
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border p-2 transition cursor-pointer disabled:opacity-50 ${
                      device.is_youtube_blocked
                        ? 'border-slate-800 bg-slate-950/60 text-slate-500 opacity-60 hover:opacity-90 hover:border-slate-700'
                        : 'border-red-500/50 bg-red-500/15 text-red-500 shadow-xs hover:bg-red-500/25 hover:border-red-500/70'
                    }`}
                  >
                    <YouTubeLogoIcon className="h-4 w-4" testId="drawer-yt-icon" />
                  </button>
                )}

                <TimerPopoverMenu
                  testIdPrefix="drawer-"
                  targetType="device"
                  targetId={device.id}
                  targetName={device.effective_name}
                  activeOverride={device.active_override}
                  disabled={device.is_protected || !device.ipv4_address}
                  iconOnly
                  isPending={timerMutation.isPending || cancelTimerMutation.isPending}
                  onStartTimer={(payload) => timerMutation.mutate(payload)}
                  onCancelTimer={(ovId) => cancelTimerMutation.mutate(ovId)}
                />

                {device.is_protected ? (
                  <span
                    data-testid="drawer-access-protected"
                    aria-label="Protected (Always Allowed)"
                    title={device.protection_reason ?? 'Protected (Always Allowed)'}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300"
                  >
                    <Lock className="h-4 w-4" aria-hidden="true" />
                  </span>
                ) : device.is_blocked ? (
                  <button
                    type="button"
                    data-testid="drawer-access-toggle"
                    disabled={accessMutation.isPending}
                    aria-label={accessMutation.isPending ? 'Updating...' : 'Blocked, Click to Allow'}
                    title="Blocked, Click to Allow"
                    onClick={() => accessMutation.mutate('unblock')}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 cursor-pointer disabled:opacity-60"
                  >
                    <ShieldAlert className="h-4 w-4 text-rose-400" aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="drawer-access-toggle"
                    disabled={accessMutation.isPending || !device.ipv4_address}
                    aria-label={accessMutation.isPending ? 'Blocking...' : 'Allowed, Click to Block'}
                    title="Allowed, Click to Block"
                    onClick={() => accessMutation.mutate('block')}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 cursor-pointer disabled:opacity-50"
                  >
                    <Globe className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              data-testid="close-analytics-drawer"
              aria-label="Close analytics drawer"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white cursor-pointer"
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

          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="drawer-refresh-btn"
                aria-label="Refresh Telemetry"
                title="Refresh Telemetry"
                onClick={() => {
                  refreshMutation.mutate()
                  void refetch()
                }}
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
                testId="drawer-auto-refresh-select"
                compact
              />
            </div>
            {lastUpdatedClock && (
              <span
                data-testid="drawer-last-updated"
                className="text-[10px] font-mono text-slate-400"
              >
                Updated: {lastUpdatedClock}
              </span>
            )}
          </div>
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
            <TelemetryLoadingShell
              isLoading={isLoading}
              isFetching={isFetching || refreshMutation.isPending}
              loadingMessage="Refreshing device telemetry..."
              testId="drawer-telemetry-shell"
            >
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
                    block ({formatBlockedPercentage(summary?.blocked_packet_count ?? 0, summary?.allowed_packet_count ?? 0)})
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

              {/* Application Usage & Control (FB-P6-004 & FB-P6-005) */}
              <div
                data-testid="drawer-app-usage-panel"
                className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      Application Usage &amp; Selective Control
                    </h3>
                    <p className="text-xs text-slate-400">
                      Active streaming time (5-minute activity windows) and selective YouTube blocking (keeps Plex &amp; general internet allowed)
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {appUsage.map((app) => {
                    const isYoutube = app.app_key === 'youtube'
                    const isPlex = app.app_key === 'plex'
                    const activeSessions = app.active_sessions ?? []
                    const iconColor =
                      isYoutube
                        ? 'text-rose-400'
                        : isPlex
                          ? 'text-amber-400'
                          : app.app_key === 'netflix'
                            ? 'text-red-400'
                            : app.app_key === 'disney_plus'
                              ? 'text-cyan-400'
                              : app.app_key === 'twitch'
                                ? 'text-violet-400'
                                : app.app_key === 'tiktok'
                                  ? 'text-pink-400'
                                  : app.app_key === 'discord'
                                    ? 'text-indigo-400'
                                    : 'text-emerald-400'
                    return (
                      <div
                        key={app.app_key}
                        data-testid={`drawer-app-card-${app.app_key}`}
                        className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/90 p-3.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Tv
                              className={`h-4 w-4 ${iconColor}`}
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
                              data-testid={`drawer-app-minutes-${app.app_key}`}
                              className="text-base font-bold text-indigo-300 font-mono"
                            >
                              {formatActiveMinutes(app.active_minutes)}
                            </span>
                            <p className="text-[10px] text-slate-400">Active time ({windowKey})</p>
                          </div>
                        </div>

                        {isPlex && activeSessions.length > 0 && (
                          <div
                            data-testid="drawer-plex-now-playing"
                            className="mt-2.5 rounded-md border border-amber-500/30 bg-amber-950/20 p-2 text-[11px] space-y-2"
                          >
                            {activeSessions.map((sess) => {
                              const bitrateKbps =
                                sess.transcode_bitrate_kbps ?? sess.bandwidth_kbps ?? 0
                              const pct = Math.max(0, Math.min(100, sess.progress_percent ?? 0))
                              return (
                                <div key={sess.session_key} className="space-y-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate font-semibold text-amber-200">
                                      Now Playing: {sess.media_title}
                                    </span>
                                    <span className="shrink-0 font-mono text-[10px] uppercase text-slate-300">
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
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {isYoutube && device && !device.is_protected && (
                          <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2.5">
                            <span className="text-[11px] text-slate-400">
                              {device.is_youtube_blocked
                                ? 'YouTube blocked (Plex allowed)'
                                : 'YouTube currently allowed'}
                            </span>
                            <button
                              type="button"
                              data-testid="drawer-app-youtube-toggle"
                              disabled={youtubeMutation.isPending || !device.ipv4_address}
                              onClick={() =>
                                youtubeMutation.mutate(
                                  device.is_youtube_blocked ? 'unblock' : 'block',
                                )
                              }
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer disabled:opacity-50 ${
                                device.is_youtube_blocked
                                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
                                  : 'border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800'
                              }`}
                            >
                              <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>
                                {device.is_youtube_blocked ? 'Allow YouTube' : 'Block YouTube'}
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Usage & Activity Timeline (FB-P4-006, FB-P8-004, FB-P8-005) */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-100">
                    Usage &amp; Activity Timeline ({windowKey})
                  </h3>
                  <p className="text-xs text-slate-400">
                    DNS lookups and firewall packet events over time
                  </p>
                </div>

                <TimelineBarChart
                  timeline={timeline}
                  windowKey={windowKey}
                  prefixTestId="drawer-timeline"
                  chartTestId="drawer-timeline-chart"
                  legendTestId="drawer-timeline-legend"
                />
              </div>

              {/* 24-Hour Access Time Profile (FB-P8-004, FB-P8-005) */}
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

                <HourlyProfileBarChart
                  hourlyProfile={hourlyProfile}
                  prefixTestId="drawer-hourly"
                  chartTestId="drawer-hourly-profile"
                />
              </div>

              {/* Top Visited Domains & Destination Organizations */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Top Visited Domains */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Globe className="h-4 w-4 text-sky-400" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-slate-100">
                      Top Visited Domains
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
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono text-slate-400">
                                  {item.query_count.toLocaleString()}
                                </span>
                                {device && !device.is_protected && (
                                  <button
                                    type="button"
                                    data-testid={`device-drawer-block-domain-${item.domain}`}
                                    disabled={
                                      blockTargetMutation.isPending ||
                                      blockedDomainSet.has(item.domain.toLowerCase())
                                    }
                                    onClick={() =>
                                      blockTargetMutation.mutate({
                                        target_type: 'domain',
                                        target_value: item.domain,
                                        scope_type: 'device',
                                        device_id: device.id,
                                        reason: `Blocked from ${device.effective_name} telemetry`,
                                      })
                                    }
                                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer disabled:opacity-60 ${
                                      blockedDomainSet.has(item.domain.toLowerCase())
                                        ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-rose-500/50 hover:text-rose-200'
                                    }`}
                                  >
                                    <Ban className="h-2.5 w-2.5" aria-hidden="true" />
                                    <span>
                                      {blockedDomainSet.has(item.domain.toLowerCase())
                                        ? 'Blocked'
                                        : 'Block'}
                                    </span>
                                  </button>
                                )}
                              </div>
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
                      {topOrgs.map((org) => {
                        const asnTag = org.asn != null ? `AS${org.asn}` : null
                        const isBlocked = asnTag !== null && blockedAsnSet.has(asnTag)
                        return (
                          <li
                            key={org.organization}
                            className="flex items-center justify-between gap-2 border-b border-slate-800/60 pb-2 last:border-none"
                          >
                            <div className="min-w-0 truncate">
                              <span className="text-slate-200">{org.organization}</span>
                              {asnTag && (
                                <span className="ml-1.5 font-mono text-[10px] text-indigo-300">
                                  ({asnTag})
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 font-mono text-slate-400 shrink-0">
                              <span className="text-slate-200">{formatBytes(org.bytes)}</span>
                              <span className="text-[11px]">
                                ({org.packet_count.toLocaleString()} pkts)
                              </span>
                              {device && !device.is_protected && asnTag && (
                                <button
                                  type="button"
                                  data-testid={`device-drawer-block-asn-${asnTag}`}
                                  disabled={blockTargetMutation.isPending || isBlocked}
                                  onClick={() =>
                                    blockTargetMutation.mutate({
                                      target_type: 'asn',
                                      target_value: asnTag,
                                      scope_type: 'device',
                                      device_id: device.id,
                                      organization_name: org.organization,
                                      reason: `Blocked ${org.organization} from ${device.effective_name}`,
                                    })
                                  }
                                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-sans text-[10px] font-semibold cursor-pointer disabled:opacity-60 ${
                                    isBlocked
                                      ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-rose-500/50 hover:text-rose-200'
                                  }`}
                                >
                                  <Ban className="h-2.5 w-2.5" aria-hidden="true" />
                                  <span>{isBlocked ? 'Blocked' : 'Block ASN'}</span>
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
                              {q.registered_domain ?? '-'}
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
            </TelemetryLoadingShell>
          )}
        </div>
      </div>
    </div>
  )
}
