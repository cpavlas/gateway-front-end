import React from 'react'
import { Clock, Play, Search, Tv, X } from 'lucide-react'
import {
  formatActiveMinutes,
  formatBytes,
  type AppUsageItem,
  type TimeWindow,
} from '../api/client'

interface AppUsageDetailModalProps {
  item: AppUsageItem | null
  windowKey: TimeWindow
  onClose: () => void
  onSelectDevice?: (deviceId: number) => void
}

export const AppUsageDetailModal: React.FC<AppUsageDetailModalProps> = ({
  item,
  windowKey,
  onClose,
  onSelectDevice,
}) => {
  if (!item) return null

  const isPlex = item.app_key === 'plex'
  const activeSessions = item.active_sessions ?? []
  const topDevices = item.top_devices ?? []

  return (
    <div
      data-testid="app-usage-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-usage-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-500/15 text-indigo-300">
              <Tv className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="app-usage-modal-title" className="text-base font-bold text-slate-100">
                {item.display_name} Telemetry Details
              </h2>
              <p className="text-xs text-slate-400">
                Window: <span className="font-mono uppercase">{windowKey}</span>
                {item.last_active_at
                  ? ` · Last active: ${new Date(item.last_active_at).toLocaleString()}`
                  : ' · No recent activity'}
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="close-app-usage-modal-btn"
            aria-label="Close application telemetry details"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Summary KPI Strip */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <Clock className="h-3 w-3 text-indigo-400" aria-hidden="true" />
                Active Time
              </span>
              <p className="mt-1 font-mono text-lg font-bold text-indigo-300">
                {formatActiveMinutes(item.active_minutes)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <span className="block text-[11px] text-slate-400">DNS Queries</span>
              <p className="mt-1 font-mono text-lg font-bold text-sky-300">
                {(item.dns_queries ?? 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <span className="block text-[11px] text-slate-400">Logged Bandwidth</span>
              <p className="mt-1 font-mono text-lg font-bold text-emerald-300">
                {formatBytes(item.bytes ?? 0)}
              </p>
            </div>
          </div>

          {/* Full Untruncated Live Plex Sessions */}
          {isPlex && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300">
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  Live Plex Sessions ({activeSessions.length})
                </span>
              </div>

              {activeSessions.length === 0 ? (
                <p className="text-xs text-slate-400">
                  No active Plex Media Server streams are currently playing.
                </p>
              ) : (
                <div className="space-y-3">
                  {activeSessions.map((sess) => {
                    const bitrateKbps =
                      sess.transcode_bitrate_kbps ?? sess.bandwidth_kbps ?? 0
                    const pct = Math.max(0, Math.min(100, sess.progress_percent ?? 0))
                    return (
                      <div
                        key={sess.session_key}
                        data-testid={`modal-plex-session-${sess.session_key}`}
                        className="rounded-lg border border-amber-500/20 bg-slate-950/80 p-3 space-y-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="text-sm font-semibold text-amber-200 break-words">
                              {sess.media_title}
                            </p>
                            <p className="text-xs text-slate-300">
                              <span className="font-semibold text-slate-100">
                                {sess.effective_name}
                              </span>
                              {sess.client_ip ? (
                                <span className="ml-1.5 font-mono text-[11px] text-slate-400">
                                  ({sess.client_ip})
                                </span>
                              ) : null}
                            </p>
                          </div>
                          <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase text-amber-200">
                            {sess.state} · {sess.stream_decision}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
                          <div>
                            <span className="block text-[10px] text-slate-500">User</span>
                            <span>{sess.user_name || 'Local'}</span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-slate-500">Player</span>
                            <span>
                              {sess.player_title}
                              {sess.player_platform ? ` (${sess.player_platform})` : ''}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-slate-500">Resolution</span>
                            <span>{sess.video_resolution || 'Auto'}</span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-slate-500">Bitrate</span>
                            <span className="font-mono text-amber-300">
                              {bitrateKbps > 0
                                ? `${(bitrateKbps / 1000).toFixed(1)} Mbps`
                                : '—'}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-slate-400">
                            <span>Playback Progress</span>
                            <span className="font-mono text-amber-300">{pct}%</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-900">
                            <div
                              className="h-full rounded-full bg-amber-400 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Top Contributing LAN Devices */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Top Contributing Devices
            </h3>
            {topDevices.length === 0 ? (
              <p className="text-xs text-slate-500">
                No per-device sessions recorded in this time window.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800/80 text-xs">
                {topDevices.map((dev, idx) => (
                  <li
                    key={`${dev.ipv4_address}-${idx}`}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-500">#{idx + 1}</span>
                      <span className="font-semibold text-slate-100 truncate">
                        {dev.effective_name}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        ({dev.ipv4_address})
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono font-semibold text-indigo-300">
                        {formatActiveMinutes(dev.active_minutes)}
                      </span>
                      {dev.device_id !== null && onSelectDevice && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose()
                            onSelectDevice(dev.device_id!)
                          }}
                          title={`Inspect ${dev.effective_name}`}
                          className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2 py-1 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-500/25 cursor-pointer"
                        >
                          <Search className="h-3 w-3" aria-hidden="true" />
                          <span>Inspect</span>
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
