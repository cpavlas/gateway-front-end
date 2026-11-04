import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  Download,
  FileText,
  HardDrive,
  Laptop,
  RefreshCw,
  Router,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Wifi,
  XCircle,
} from 'lucide-react'
import {
  apiClient,
  formatClock24h,
  type ConfigBackupPayload,
  type ConfigRestoreSummary,
  type DeviceListResponse,
  type HealthLevel,
  type ServiceHealthStatus,
} from '../api/client'
import { AppLayout, type AppTab } from '../components/AppLayout'

interface StatusPageProps {
  activeTab?: AppTab
  onSelectTab?: (tab: AppTab) => void
}

const CARD_BADGE_STYLES: Record<HealthLevel, string> = {
  healthy: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  degraded: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  unhealthy: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
}

function StatusIcon({ status }: { status: HealthLevel }) {
  if (status === 'healthy') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
  }
  if (status === 'degraded') {
    return <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />
  }
  return <XCircle className="h-4 w-4 text-rose-400" aria-hidden="true" />
}

interface ServiceCardProps {
  title: string
  subtitle: string
  icon: React.ReactNode
  health?: ServiceHealthStatus
  testId: string
}

const ServiceCard: React.FC<ServiceCardProps> = ({
  title,
  subtitle,
  icon,
  health,
  testId,
}) => {
  const status: HealthLevel = health?.status ?? 'unhealthy'
  const details = health?.details ?? {}
  const isSqlite = testId === 'service-card-sqlite'
  const isEs = testId === 'service-card-elasticsearch'

  const storageSizeFormatted =
    typeof details.storage_size_formatted === 'string'
      ? details.storage_size_formatted
      : undefined
  const totalRecords =
    typeof details.total_records === 'number' ? details.total_records : undefined

  const clusterStatus =
    typeof details.cluster_status === 'string'
      ? details.cluster_status.toLowerCase()
      : undefined
  const assignedShards =
    typeof details.assigned_shards === 'number' ? details.assigned_shards : undefined
  const unassignedShards =
    typeof details.unassigned_shards === 'number' ? details.unassigned_shards : 0
  const relocatingShards =
    typeof details.relocating_shards === 'number' ? details.relocating_shards : 0

  return (
    <div
      data-testid={testId}
      className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg"
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-indigo-400">
              {icon}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
              <p className="text-xs font-mono text-slate-400">{subtitle}</p>
            </div>
          </div>

          {health && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase ${CARD_BADGE_STYLES[status]}`}
            >
              <StatusIcon status={status} />
              {status}
            </span>
          )}
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          {health ? health.message : 'Probing service status...'}
        </p>

        {/* FB-P8-006: Highlighted Elasticsearch Cluster Health & Shard Breakdown */}
        {isEs && (clusterStatus !== undefined || assignedShards !== undefined) && (
          <div
            data-testid="es-cluster-shard-stats"
            className="space-y-2 rounded-lg border border-indigo-500/30 bg-indigo-950/25 p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-indigo-300">
                Cluster Health
              </span>
              <span
                data-testid="es-cluster-status"
                className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${
                  clusterStatus === 'green'
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : clusterStatus === 'yellow'
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                      : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                }`}
              >
                {clusterStatus ?? 'unknown'}
              </span>
            </div>
            <div
              data-testid="es-shard-counts"
              className="grid grid-cols-3 gap-2 border-t border-indigo-500/20 pt-2 text-center"
            >
              <div>
                <span className="block text-[10px] text-slate-400">Assigned</span>
                <span
                  data-testid="es-shards-assigned"
                  className="font-mono text-sm font-bold text-emerald-300"
                >
                  {(assignedShards ?? 0).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="block text-[10px] text-slate-400">Unassigned</span>
                <span
                  data-testid="es-shards-unassigned"
                  className={`font-mono text-sm font-bold ${
                    unassignedShards > 0 ? 'text-amber-300' : 'text-slate-200'
                  }`}
                >
                  {unassignedShards.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="block text-[10px] text-slate-400">Relocating</span>
                <span
                  data-testid="es-shards-relocating"
                  className={`font-mono text-sm font-bold ${
                    relocatingShards > 0 ? 'text-cyan-300' : 'text-slate-200'
                  }`}
                >
                  {relocatingShards.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* FB-P6-003: Highlighted SQLite Storage Size & Record Count stats */}
        {isSqlite && (storageSizeFormatted !== undefined || totalRecords !== undefined) && (
          <div
            data-testid="sqlite-featured-stats"
            className="grid grid-cols-2 gap-2.5 rounded-lg border border-indigo-500/30 bg-indigo-950/25 p-3"
          >
            <div>
              <span className="block text-[11px] font-medium text-indigo-300">
                Storage Size
              </span>
              <span
                data-testid="sqlite-storage-size"
                className="mt-0.5 block font-mono text-base font-bold text-slate-100"
              >
                {storageSizeFormatted ?? '0 B'}
              </span>
            </div>
            <div>
              <span className="block text-[11px] font-medium text-indigo-300">
                Record Count
              </span>
              <span
                data-testid="sqlite-total-records"
                className="mt-0.5 block font-mono text-base font-bold text-emerald-300"
              >
                {(totalRecords ?? 0).toLocaleString()} records
              </span>
            </div>
          </div>
        )}

        {Object.keys(details).length > 0 && (
          <dl className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 text-xs">
            {Object.entries(details).map(([key, value]) => (
              <div key={key} className="truncate">
                <dt className="text-[11px] text-slate-400 font-mono">{key}</dt>
                <dd className="font-semibold text-slate-200 truncate">
                  {String(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3 text-xs text-slate-400">
        <span>Round-trip Latency</span>
        <span className="font-mono font-semibold text-slate-200">
          {health ? `${health.latency_ms} ms` : '-'}
        </span>
      </div>
    </div>
  )
}

export const StatusPage: React.FC<StatusPageProps> = ({
  activeTab = 'status',
  onSelectTab,
}) => {
  const queryClient = useQueryClient()
  const [auditEnabled, setAuditEnabled] = useState(false)
  const [auditActionFilter, setAuditActionFilter] = useState('')
  const [auditSearch, setAuditSearch] = useState('')
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [restoreSummary, setRestoreSummary] = useState<ConfigRestoreSummary | null>(null)

  const {
    data: healthReport,
    dataUpdatedAt: healthUpdatedAt,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: () => apiClient.getSystemHealth(),
    refetchInterval: 30_000,
  })

  const {
    data: auditResponse,
    dataUpdatedAt: auditUpdatedAt,
    isFetching: isFetchingAudit,
    refetch: refetchAudit,
  } = useQuery({
    queryKey: ['auditLogs', auditActionFilter, auditSearch],
    queryFn: () =>
      apiClient.getAuditLogs({
        action: auditActionFilter || undefined,
        search: auditSearch.trim() || undefined,
        limit: 50,
      }),
    enabled: auditEnabled,
  })

  const exportMutation = useMutation({
    mutationFn: () => apiClient.exportConfigBackup(),
    onSuccess: (payload) => {
      setBackupError(null)
      setBackupMessage(
        `Exported ${payload.devices.length} devices, ${payload.groups.length} groups, and ${payload.schedules.length} schedules.`,
      )
      try {
        if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json',
          })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `gateway-config-backup-${new Date().toISOString().slice(0, 10)}.json`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(url)
        }
      } catch {
        // Ignore download helper errors in headless test environments
      }
    },
    onError: (err) => {
      setBackupError(
        err instanceof Error ? err.message : 'Failed to export configuration backup.',
      )
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (payload: ConfigBackupPayload) =>
      apiClient.restoreConfigBackup(payload),
    onSuccess: (summary) => {
      setBackupError(null)
      setRestoreSummary(summary)
      setBackupMessage(
        `Restored ${summary.devices_updated} devices, ${summary.groups_upserted} groups, and ${summary.schedules_upserted} schedules.`,
      )
      void queryClient.invalidateQueries({ queryKey: ['systemHealth'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
    onError: (err) => {
      setBackupError(
        err instanceof Error ? err.message : 'Failed to restore configuration backup.',
      )
    },
  })

  const handleRestoreFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text =
        typeof file.text === 'function'
          ? await file.text()
          : await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result ?? ''))
              reader.onerror = () => reject(reader.error)
              reader.readAsText(file)
            })
      const parsed = JSON.parse(text) as ConfigBackupPayload
      restoreMutation.mutate(parsed)
    } catch {
      setBackupError('Invalid JSON configuration file.')
    } finally {
      e.target.value = ''
    }
  }

  const deviceList = queryClient.getQueryData<DeviceListResponse>(['devices'])
  const opnsenseDetails = healthReport?.services?.opnsense?.details ?? {}
  const sqliteDetails = healthReport?.services?.sqlite?.details ?? {}
  const summary = deviceList?.summary
  const totalDevices =
    summary?.total_devices ??
    (typeof opnsenseDetails.dnsmasq_lease_count === 'number'
      ? opnsenseDetails.dnsmasq_lease_count
      : 0)
  const onlineDevices =
    summary?.online_devices ??
    (typeof opnsenseDetails.arp_entry_count === 'number'
      ? opnsenseDetails.arp_entry_count
      : 0)
  const blockedDevices =
    summary?.blocked_devices ??
    (typeof opnsenseDetails.blocked_ip_count === 'number'
      ? opnsenseDetails.blocked_ip_count
      : 0)
  const protectedDevices = summary?.protected_devices ?? 2
  const activeTimerCount = (deviceList?.devices ?? []).filter(
    (d) => d.active_override && d.active_override.is_active,
  ).length

  const auditLogs = auditResponse?.items ?? []
  const lastHealthClock = formatClock24h(healthUpdatedAt)
  const lastAuditClock = formatClock24h(auditUpdatedAt)

  return (
    <AppLayout
      overallStatus={healthReport?.overall_status}
      version={healthReport?.version}
      activeTab={activeTab}
      onSelectTab={onSelectTab}
    >
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">
              System Connectivity &amp; Telemetry Status
            </h1>
            <p className="text-sm text-slate-400">
              Live health verification for OPNsense firewall API, Elasticsearch 9.4.3 data stream, and local state storage
            </p>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-1 self-start">
            <button
              type="button"
              data-testid="status-refresh-btn"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isFetching ? 'Refreshing...' : 'Refresh Status'}</span>
            </button>
            {lastHealthClock && (
              <span
                data-testid="status-last-updated"
                className="text-[11px] font-mono text-slate-400"
              >
                Updated: {lastHealthClock}
              </span>
            )}
          </div>
        </div>

        {isError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200"
          >
            Failed to load system health report:{' '}
            {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        )}

        {isLoading && !healthReport ? (
          <div
            data-testid="health-loading"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-400"
          >
            Checking OPNsense, Elasticsearch, and SQLite connectivity...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <ServiceCard
              testId="service-card-opnsense"
              title="OPNsense Firewall"
              subtitle="OPNsense REST API (26.7.7-amd64)"
              icon={<Router className="h-5 w-5" aria-hidden="true" />}
              health={healthReport?.services?.opnsense}
            />

            <ServiceCard
              testId="service-card-elasticsearch"
              title="Elasticsearch 9.4.3"
              subtitle="Elastic pfSense Integration (logs-pfsense.log*)"
              icon={<Database className="h-5 w-5" aria-hidden="true" />}
              health={healthReport?.services?.elasticsearch}
            />

            <ServiceCard
              testId="service-card-sqlite"
              title="Local SQLite Store"
              subtitle="data/gateway.db"
              icon={<HardDrive className="h-5 w-5" aria-hidden="true" />}
              health={healthReport?.services?.sqlite}
            />
          </div>
        )}

        <section
          data-testid="status-enforcement-summary"
          className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Gateway Enforcement &amp; Inventory Synchronization Summary
              </h2>
              <p className="text-xs text-slate-400">
                Live state of OPNsense ARP / Dnsmasq DHCP discovery and{' '}
                <code className="text-indigo-300">gateway_blocked_devices</code> enforcement
                {deviceList?.last_synced_at
                  ? `, Last synced ${new Date(deviceList.last_synced_at).toLocaleString()}`
                  : ''}
              </p>
            </div>
            {onSelectTab && (
              <button
                type="button"
                data-testid="status-open-devices-btn"
                onClick={() => onSelectTab('devices')}
                className="inline-flex items-center gap-1.5 self-start rounded-lg border border-indigo-500/40 bg-indigo-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 cursor-pointer"
              >
                <span>Open Devices &amp; Access Control</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Discovered Devices</span>
                <Laptop className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
              </div>
              <p className="mt-1 text-lg font-bold text-slate-100">
                {totalDevices}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Online in ARP</span>
                <Wifi className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              </div>
              <p className="mt-1 text-lg font-bold text-emerald-300">
                {onlineDevices}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Blocked in Alias</span>
                <ShieldAlert className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
              </div>
              <p className="mt-1 text-lg font-bold text-rose-300">
                {blockedDevices}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Protected IPs</span>
                <ShieldCheck className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              </div>
              <p className="mt-1 text-lg font-bold text-amber-300">
                {protectedDevices}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Active Timers</span>
                <Clock className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
              </div>
              <p className="mt-1 text-lg font-bold text-cyan-300">
                {activeTimerCount}
              </p>
            </div>
          </div>
        </section>

        {/* Configuration Backup & Restore (Phase 7) */}
        <section
          data-testid="status-backup-restore-section"
          className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Configuration Backup &amp; Restore
              </h2>
              <p className="text-xs text-slate-400">
                Export or restore device labels, group memberships, YouTube &amp; internet policies, and recurring schedules
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                data-testid="export-config-btn"
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {exportMutation.isPending ? 'Exporting...' : 'Export Configuration JSON'}
                </span>
              </button>

              <label
                data-testid="restore-config-label"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                <span>
                  {restoreMutation.isPending ? 'Restoring...' : 'Restore Configuration JSON'}
                </span>
                <input
                  type="file"
                  accept="application/json,.json"
                  data-testid="restore-config-input"
                  onChange={(e) => void handleRestoreFileChange(e)}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          {backupMessage && (
            <div
              data-testid="backup-status-message"
              className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200"
            >
              {backupMessage}
              {restoreSummary && (
                <span className="ml-2 font-mono text-emerald-300">
                  (restored at {new Date(restoreSummary.restored_at).toLocaleTimeString([], { hour12: false })})
                </span>
              )}
            </div>
          )}

          {backupError && (
            <div
              data-testid="backup-error-message"
              className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200"
            >
              {backupError}
            </div>
          )}
        </section>

        {/* Audit & Event History (Phase 7) */}
        <section
          data-testid="audit-logs-section"
          className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-2.5">
              <FileText className="h-5 w-5 text-indigo-400" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  Audit &amp; Event History
                </h2>
                <p className="text-xs text-slate-400">
                  Chronological log of administrative actions, YouTube &amp; internet blocks, timers, and schedule transitions
                  {typeof sqliteDetails.audit_logs_count === 'number'
                    ? ` (${sqliteDetails.audit_logs_count} total stored events)`
                    : ''}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-start sm:items-end gap-1 self-start">
              <button
                type="button"
                data-testid="load-audit-logs-btn"
                onClick={() => {
                  if (!auditEnabled) {
                    setAuditEnabled(true)
                  } else {
                    void refetchAudit()
                  }
                }}
                disabled={isFetchingAudit}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60 cursor-pointer"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isFetchingAudit ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>
                  {auditEnabled
                    ? isFetchingAudit
                      ? 'Refreshing...'
                      : 'Refresh Audit Logs'
                    : 'Load Audit Logs'}
                </span>
              </button>
              {auditEnabled && lastAuditClock && (
                <span
                  data-testid="audit-last-updated"
                  className="text-[11px] font-mono text-slate-400"
                >
                  Updated: {lastAuditClock}
                </span>
              )}
            </div>
          </div>

          {auditEnabled && (
            <div className="mt-4 space-y-3">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    data-testid="audit-search-input"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Search audit events by action, actor, or details..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <select
                  aria-label="Filter audit logs by action"
                  data-testid="audit-action-filter"
                  value={auditActionFilter}
                  onChange={(e) => setAuditActionFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">All Actions</option>
                  <option value="device.block">device.block</option>
                  <option value="device.unblock">device.unblock</option>
                  <option value="device.youtube_block">device.youtube_block</option>
                  <option value="device.youtube_unblock">device.youtube_unblock</option>
                  <option value="group.youtube_block">group.youtube_block</option>
                  <option value="group.youtube_unblock">group.youtube_unblock</option>
                  <option value="system.restore">system.restore</option>
                </select>
              </div>

              {auditLogs.length === 0 ? (
                <p
                  data-testid="audit-logs-empty"
                  className="py-6 text-center text-xs text-slate-500"
                >
                  {isFetchingAudit ? 'Loading audit history...' : 'No matching audit log events found.'}
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60">
                  <table
                    data-testid="audit-logs-table"
                    className="w-full text-left border-collapse text-xs"
                  >
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
                        <th className="py-2 px-3">Timestamp</th>
                        <th className="py-2 px-3">Action</th>
                        <th className="py-2 px-3">Actor</th>
                        <th className="py-2 px-3">Target</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-900/50">
                          <td className="py-2 px-3 font-mono text-slate-400">
                            {new Date(log.created_at).toLocaleString([], { hour12: false })}
                          </td>
                          <td className="py-2 px-3 font-mono font-semibold text-indigo-300">
                            {log.action}
                          </td>
                          <td className="py-2 px-3 text-slate-300">{log.actor}</td>
                          <td className="py-2 px-3 font-mono text-slate-400">
                            {log.target} ({log.status})
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  )
}
