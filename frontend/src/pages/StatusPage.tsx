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
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Router,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wifi,
  XCircle,
} from 'lucide-react'
import {
  apiClient,
  formatClock24h,
  type ConfigBackupPayload,
  type ConfigRestoreSummary,
  type ConnectivityTestResponse,
  type DeviceListResponse,
  type HealthLevel,
  type IntegrationSettingsUpdatePayload,
  type ServiceHealthStatus,
  type UserRole,
} from '../api/client'
import { AppLayout, type AppTab } from '../components/AppLayout'
import { AutoRefreshSelector, useAutoRefresh } from '../components/AutoRefreshSelector'
import { useAuth } from '../context/AuthContext'

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
  const { user } = useAuth()
  const isAdmin = user?.role !== 'operator'

  const [auditEnabled, setAuditEnabled] = useState(false)
  const [auditActionFilter, setAuditActionFilter] = useState('')
  const [auditLabelFilter, setAuditLabelFilter] = useState('')
  const [auditSearch, setAuditSearch] = useState('')
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [restoreSummary, setRestoreSummary] = useState<ConfigRestoreSummary | null>(null)

  // Phase 9 (FB-P9-002): Integration Settings & Live Connectivity Diagnostics
  const [settingsExpanded, setSettingsExpanded] = useState(false)
  const [opnUrl, setOpnUrl] = useState('')
  const [opnKey, setOpnKey] = useState('')
  const [opnSecret, setOpnSecret] = useState('')
  const [opnVerifySsl, setOpnVerifySsl] = useState(false)
  const [opnProtectedIps, setOpnProtectedIps] = useState('')
  const [esUrl, setEsUrl] = useState('')
  const [esKey, setEsKey] = useState('')
  const [esVerifySsl, setEsVerifySsl] = useState(false)
  const [esIndexPatterns, setEsIndexPatterns] = useState('')
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [diagnosticResult, setDiagnosticResult] = useState<ConnectivityTestResponse | null>(null)

  // Phase 9 (FB-P9-003): Multi-User Management
  const [usersExpanded, setUsersExpanded] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState<UserRole>('operator')
  const [userMgmtMessage, setUserMgmtMessage] = useState<string | null>(null)
  const [userMgmtError, setUserMgmtError] = useState<string | null>(null)
  const { intervalOption, setIntervalOption, refetchInterval } = useAutoRefresh('30s')

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
    refetchInterval,
  })

  const {
    data: integrationSettings,
    isFetching: isFetchingSettings,
    refetch: refetchSettings,
  } = useQuery({
    queryKey: ['integrationSettings'],
    queryFn: async () => {
      const data = await apiClient.getIntegrationSettings()
      setOpnUrl(data.opnsense_base_url)
      setOpnKey(data.opnsense_api_key_masked)
      setOpnSecret(data.opnsense_api_secret_masked)
      setOpnVerifySsl(data.opnsense_verify_ssl)
      setOpnProtectedIps(data.opnsense_protected_ips)
      setEsUrl(data.elasticsearch_url)
      setEsKey(data.elasticsearch_api_key_masked)
      setEsVerifySsl(data.elasticsearch_verify_ssl)
      setEsIndexPatterns(data.elasticsearch_index_patterns)
      return data
    },
    enabled: settingsExpanded && isAdmin,
  })

  const {
    data: usersListResponse,
    isFetching: isFetchingUsers,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ['usersList'],
    queryFn: () => apiClient.getUsers(),
    enabled: usersExpanded && isAdmin,
  })

  const {
    data: auditResponse,
    dataUpdatedAt: auditUpdatedAt,
    isFetching: isFetchingAudit,
    refetch: refetchAudit,
  } = useQuery({
    queryKey: ['auditLogs', auditActionFilter, auditLabelFilter, auditSearch],
    queryFn: () =>
      apiClient.getAuditLogs({
        action: auditActionFilter || undefined,
        audit_label: auditLabelFilter || undefined,
        search: auditSearch.trim() || undefined,
        limit: 50,
      }),
    enabled: auditEnabled,
  })

  const buildSettingsPayload = (): IntegrationSettingsUpdatePayload => ({
    opnsense_base_url: opnUrl.trim() || undefined,
    opnsense_api_key: opnKey.trim() || undefined,
    opnsense_api_secret: opnSecret.trim() || undefined,
    opnsense_verify_ssl: opnVerifySsl,
    opnsense_protected_ips: opnProtectedIps.trim() || undefined,
    elasticsearch_url: esUrl.trim() || undefined,
    elasticsearch_api_key: esKey.trim() || undefined,
    elasticsearch_verify_ssl: esVerifySsl,
    elasticsearch_index_patterns: esIndexPatterns.trim() || undefined,
  })

  const saveSettingsMutation = useMutation({
    mutationFn: () => apiClient.updateIntegrationSettings(buildSettingsPayload()),
    onSuccess: (updated) => {
      setSettingsError(null)
      setSettingsMessage(
        `Saved runtime integration settings (Source: ${updated.source === 'ui_override' ? 'UI Override' : '.env'}).`,
      )
      void queryClient.invalidateQueries({ queryKey: ['integrationSettings'] })
      void queryClient.invalidateQueries({ queryKey: ['systemHealth'] })
    },
    onError: (err) => {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save integration settings.')
    },
  })

  const resetSettingsMutation = useMutation({
    mutationFn: () => apiClient.resetIntegrationSettings(),
    onSuccess: (resetView) => {
      setSettingsError(null)
      setDiagnosticResult(null)
      setOpnUrl(resetView.opnsense_base_url)
      setOpnKey(resetView.opnsense_api_key_masked)
      setOpnSecret(resetView.opnsense_api_secret_masked)
      setOpnVerifySsl(resetView.opnsense_verify_ssl)
      setOpnProtectedIps(resetView.opnsense_protected_ips)
      setEsUrl(resetView.elasticsearch_url)
      setEsKey(resetView.elasticsearch_api_key_masked)
      setEsVerifySsl(resetView.elasticsearch_verify_ssl)
      setEsIndexPatterns(resetView.elasticsearch_index_patterns)
      setSettingsMessage('Reset integration settings to .env defaults.')
      void queryClient.invalidateQueries({ queryKey: ['integrationSettings'] })
      void queryClient.invalidateQueries({ queryKey: ['systemHealth'] })
    },
    onError: (err) => {
      setSettingsError(err instanceof Error ? err.message : 'Failed to reset integration settings.')
    },
  })

  const testOpnMutation = useMutation({
    mutationFn: () => apiClient.testOpnsenseConnectivity(buildSettingsPayload()),
    onSuccess: (res) => {
      setDiagnosticResult(res)
    },
    onError: (err) => {
      setSettingsError(err instanceof Error ? err.message : 'OPNsense connectivity test failed.')
    },
  })

  const testEsMutation = useMutation({
    mutationFn: () => apiClient.testElasticsearchConnectivity(buildSettingsPayload()),
    onSuccess: (res) => {
      setDiagnosticResult(res)
    },
    onError: (err) => {
      setSettingsError(err instanceof Error ? err.message : 'Elasticsearch connectivity test failed.')
    },
  })

  const createUserMutation = useMutation({
    mutationFn: () =>
      apiClient.createUser({
        username: newUsername.trim(),
        password: newPassword,
        role: newUserRole,
      }),
    onSuccess: (created) => {
      setUserMgmtError(null)
      setUserMgmtMessage(`Created user '${created.username}' (${created.role}).`)
      setNewUsername('')
      setNewPassword('')
      setNewUserRole('operator')
      void queryClient.invalidateQueries({ queryKey: ['usersList'] })
    },
    onError: (err) => {
      setUserMgmtError(err instanceof Error ? err.message : 'Failed to create user.')
    },
  })

  const toggleUserActiveMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      apiClient.updateUser(userId, { is_active: isActive }),
    onSuccess: (updated) => {
      setUserMgmtError(null)
      setUserMgmtMessage(
        `User '${updated.username}' is now ${updated.is_active ? 'active' : 'disabled'}.`,
      )
      void queryClient.invalidateQueries({ queryKey: ['usersList'] })
    },
    onError: (err) => {
      setUserMgmtError(err instanceof Error ? err.message : 'Failed to update user status.')
    },
  })

  const deleteUserMutation = useMutation({
    mutationFn: (userId: number) => apiClient.deleteUser(userId),
    onSuccess: (deleted) => {
      setUserMgmtError(null)
      setUserMgmtMessage(`Deleted user '${deleted.username}'.`)
      void queryClient.invalidateQueries({ queryKey: ['usersList'] })
    },
    onError: (err) => {
      setUserMgmtError(err instanceof Error ? err.message : 'Failed to delete user.')
    },
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

          <div className="flex flex-col items-start sm:items-end gap-1 self-start shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="status-refresh-btn"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60 cursor-pointer whitespace-nowrap"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{isFetching ? 'Refreshing...' : 'Refresh Status'}</span>
              </button>
              <AutoRefreshSelector
                value={intervalOption}
                onChange={setIntervalOption}
                testId="status-auto-refresh-select"
              />
            </div>
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

        {/* Phase 9 (FB-P9-002): Integration Settings & Connectivity Diagnostics (Admin Only) */}
        {isAdmin && (
          <section
            data-testid="integration-settings-panel"
            className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-2.5">
                <Settings2 className="h-5 w-5 text-indigo-400" aria-hidden="true" />
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-100">
                      Integration Settings &amp; Connectivity Diagnostics
                    </h2>
                    {integrationSettings && (
                      <span
                        data-testid="settings-source-badge"
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                          integrationSettings.source === 'ui_override'
                            ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                            : 'border-slate-700 bg-slate-800 text-slate-300'
                        }`}
                      >
                        {integrationSettings.source === 'ui_override'
                          ? 'Source: UI Override'
                          : 'Source: .env'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Configure OPNsense &amp; Elasticsearch connection parameters and run live connectivity diagnostics
                  </p>
                </div>
              </div>

              <button
                type="button"
                data-testid="toggle-integration-settings-btn"
                onClick={() => {
                  if (!settingsExpanded) {
                    setSettingsExpanded(true)
                  } else {
                    void refetchSettings()
                  }
                }}
                disabled={isFetchingSettings}
                className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60 cursor-pointer"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isFetchingSettings ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>
                  {settingsExpanded
                    ? isFetchingSettings
                      ? 'Loading...'
                      : 'Refresh Settings'
                    : 'Configure Connections'}
                </span>
              </button>
            </div>

            {settingsExpanded && (
              <div className="mt-5 space-y-5">
                {settingsMessage && (
                  <div
                    data-testid="settings-status-message"
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200"
                  >
                    {settingsMessage}
                  </div>
                )}

                {settingsError && (
                  <div
                    data-testid="settings-error-message"
                    className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200"
                  >
                    {settingsError}
                  </div>
                )}

                {diagnosticResult && (
                  <div
                    data-testid="connectivity-diagnostic-result"
                    className={`rounded-lg border p-3.5 text-xs ${
                      diagnosticResult.reachable
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                        : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span className="uppercase">
                        {diagnosticResult.service} Connectivity Check:{' '}
                        {diagnosticResult.reachable ? 'REACHABLE' : 'FAILED'}
                      </span>
                      <span className="font-mono">{diagnosticResult.latency_ms} ms</span>
                    </div>
                    <p className="mt-1">{diagnosticResult.message}</p>
                    {diagnosticResult.error_diagnostic && (
                      <p
                        data-testid="diagnostic-error-detail"
                        className="mt-1.5 font-mono text-[11px] text-rose-300"
                      >
                        Diagnostic: {diagnosticResult.error_diagnostic}
                      </p>
                    )}
                    {diagnosticResult.troubleshooting_hint && (
                      <p
                        data-testid="diagnostic-troubleshooting-hint"
                        className="mt-1 text-[11px] text-amber-200"
                      >
                        Hint: {diagnosticResult.troubleshooting_hint}
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  {/* OPNsense Settings */}
                  <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                        OPNsense 26.7.7 Connection
                      </h3>
                      <button
                        type="button"
                        data-testid="test-opnsense-btn"
                        onClick={() => testOpnMutation.mutate()}
                        disabled={testOpnMutation.isPending}
                        className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-600/20 px-2.5 py-1 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-600/30 disabled:opacity-60 cursor-pointer"
                      >
                        <span>
                          {testOpnMutation.isPending
                            ? 'Testing...'
                            : 'Test OPNsense Connection'}
                        </span>
                      </button>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        OPNsense Base URL
                      </label>
                      <input
                        type="text"
                        data-testid="input-opnsense-url"
                        value={opnUrl}
                        onChange={(e) => setOpnUrl(e.target.value)}
                        placeholder="https://192.168.1.1"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          API Key
                        </label>
                        <input
                          type="password"
                          data-testid="input-opnsense-key"
                          value={opnKey}
                          onChange={(e) => setOpnKey(e.target.value)}
                          placeholder="OPNsense API Key"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          API Secret
                        </label>
                        <input
                          type="password"
                          data-testid="input-opnsense-secret"
                          value={opnSecret}
                          onChange={(e) => setOpnSecret(e.target.value)}
                          placeholder="OPNsense API Secret"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          data-testid="input-opnsense-verify-ssl"
                          checked={opnVerifySsl}
                          onChange={(e) => setOpnVerifySsl(e.target.checked)}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600"
                        />
                        <span>Verify TLS Certificate</span>
                      </label>
                    </div>
                  </div>

                  {/* Elasticsearch Settings */}
                  <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300">
                        Elasticsearch 9.4.3 Connection
                      </h3>
                      <button
                        type="button"
                        data-testid="test-elasticsearch-btn"
                        onClick={() => testEsMutation.mutate()}
                        disabled={testEsMutation.isPending}
                        className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-600/20 px-2.5 py-1 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-600/30 disabled:opacity-60 cursor-pointer"
                      >
                        <span>
                          {testEsMutation.isPending
                            ? 'Testing...'
                            : 'Test Elasticsearch Connection'}
                        </span>
                      </button>
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Elasticsearch URL
                      </label>
                      <input
                        type="text"
                        data-testid="input-elasticsearch-url"
                        value={esUrl}
                        onChange={(e) => setEsUrl(e.target.value)}
                        placeholder="https://192.168.1.10:9200"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Base64 API Key
                        </label>
                        <input
                          type="password"
                          data-testid="input-elasticsearch-key"
                          value={esKey}
                          onChange={(e) => setEsKey(e.target.value)}
                          placeholder="Elasticsearch API Key"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Index Patterns
                        </label>
                        <input
                          type="text"
                          data-testid="input-elasticsearch-index"
                          value={esIndexPatterns}
                          onChange={(e) => setEsIndexPatterns(e.target.value)}
                          placeholder="logs-pfsense.log*"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          data-testid="input-elasticsearch-verify-ssl"
                          checked={esVerifySsl}
                          onChange={(e) => setEsVerifySsl(e.target.checked)}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600"
                        />
                        <span>Verify TLS Certificate</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-800 pt-3">
                  <button
                    type="button"
                    data-testid="reset-settings-btn"
                    onClick={() => resetSettingsMutation.mutate()}
                    disabled={resetSettingsMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60 cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Reset to .env Defaults</span>
                  </button>

                  <button
                    type="button"
                    data-testid="save-settings-btn"
                    onClick={() => saveSettingsMutation.mutate()}
                    disabled={saveSettingsMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
                  >
                    <Save className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {saveSettingsMutation.isPending
                        ? 'Saving...'
                        : 'Save Integration Settings'}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Phase 9 (FB-P9-003): User Accounts & Access Management (Admin Only) */}
        {isAdmin && (
          <section
            data-testid="user-management-panel"
            className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-2.5">
                <Users className="h-5 w-5 text-indigo-400" aria-hidden="true" />
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    User Accounts &amp; Access Management
                  </h2>
                  <p className="text-xs text-slate-400">
                    Add platform users, assign Admin or Standard Operator roles, and enforce default admin protection
                  </p>
                </div>
              </div>

              <button
                type="button"
                data-testid="toggle-user-management-btn"
                onClick={() => {
                  if (!usersExpanded) {
                    setUsersExpanded(true)
                  } else {
                    void refetchUsers()
                  }
                }}
                disabled={isFetchingUsers}
                className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60 cursor-pointer"
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {usersExpanded
                    ? isFetchingUsers
                      ? 'Refreshing...'
                      : 'Refresh Users'
                    : 'Manage Users'}
                </span>
              </button>
            </div>

            {usersExpanded && (
              <div className="mt-5 space-y-4">
                {userMgmtMessage && (
                  <div
                    data-testid="user-mgmt-status-message"
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200"
                  >
                    {userMgmtMessage}
                  </div>
                )}

                {userMgmtError && (
                  <div
                    data-testid="user-mgmt-error-message"
                    className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200"
                  >
                    {userMgmtError}
                  </div>
                )}

                <form
                  data-testid="create-user-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!newUsername.trim() || newPassword.length < 8) {
                      setUserMgmtError(
                        'Username (min 3 chars) and password (min 8 chars) are required.',
                      )
                      return
                    }
                    createUserMutation.mutate()
                  }}
                  className="grid grid-cols-1 gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4 sm:grid-cols-4"
                >
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      data-testid="new-user-username"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="e.g. operator_1"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Initial Password
                    </label>
                    <input
                      type="password"
                      data-testid="new-user-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min 8 characters"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Platform Role
                    </label>
                    <select
                      aria-label="New user role"
                      data-testid="new-user-role"
                      value={newUserRole}
                      onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="operator">Standard User (Operator)</option>
                      <option value="admin">Administrator (Full Access)</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      data-testid="create-user-submit-btn"
                      disabled={createUserMutation.isPending}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {createUserMutation.isPending ? 'Adding...' : 'Add User'}
                      </span>
                    </button>
                  </div>
                </form>

                <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
                  <table
                    data-testid="users-table"
                    className="w-full text-left border-collapse text-xs"
                  >
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
                        <th className="py-2 px-3">Username</th>
                        <th className="py-2 px-3">Role</th>
                        <th className="py-2 px-3">Status</th>
                        <th className="py-2 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {(usersListResponse?.users ?? []).map((u) => (
                        <tr key={u.id} data-testid={`user-row-${u.username}`}>
                          <td className="py-2.5 px-3 font-mono font-semibold text-slate-100">
                            <div className="flex items-center gap-2">
                              <span>{u.username}</span>
                              {u.is_protected_admin && (
                                <span
                                  data-testid="protected-admin-badge"
                                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-sans text-[10px] font-bold uppercase text-amber-300"
                                >
                                  <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                                  Protected Default Admin
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 uppercase text-indigo-300 font-semibold">
                            {u.role}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                                u.is_active
                                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                              }`}
                            >
                              {u.is_active ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                data-testid={`toggle-user-active-${u.username}`}
                                disabled={u.is_protected_admin}
                                onClick={() =>
                                  toggleUserActiveMutation.mutate({
                                    userId: u.id,
                                    isActive: !u.is_active,
                                  })
                                }
                                className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                              >
                                {u.is_active ? 'Disable' : 'Enable'}
                              </button>
                              <button
                                type="button"
                                data-testid={`delete-user-${u.username}`}
                                disabled={u.is_protected_admin}
                                onClick={() => deleteUserMutation.mutate(u.id)}
                                className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Audit & Event History (Phase 7 & Phase 9 FB-P9-004) */}
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
                  aria-label="Filter audit logs by label"
                  data-testid="audit-label-filter"
                  value={auditLabelFilter}
                  onChange={(e) => setAuditLabelFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">All Audit Labels</option>
                  <option value="AUTH_EVENT">AUTH_EVENT</option>
                  <option value="USER_MGMT">USER_MGMT</option>
                  <option value="SETTINGS_CHANGE">SETTINGS_CHANGE</option>
                  <option value="DIAGNOSTIC_ERROR">DIAGNOSTIC_ERROR</option>
                  <option value="DEVICE_CONTROL">DEVICE_CONTROL</option>
                  <option value="YOUTUBE_CONTROL">YOUTUBE_CONTROL</option>
                  <option value="GROUP_CONTROL">GROUP_CONTROL</option>
                  <option value="TIMER_OVERRIDE">TIMER_OVERRIDE</option>
                  <option value="SCHEDULE_CHANGE">SCHEDULE_CHANGE</option>
                  <option value="CONFIG_BACKUP">CONFIG_BACKUP</option>
                </select>

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
                        <th className="py-2 px-3">Audit Label</th>
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
                          <td className="py-2 px-3">
                            <span
                              data-testid="audit-label-badge"
                              className={`inline-flex rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                                log.audit_label === 'DIAGNOSTIC_ERROR'
                                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                                  : log.audit_label === 'USER_MGMT' ||
                                      log.audit_label === 'SETTINGS_CHANGE'
                                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                                    : 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300'
                              }`}
                            >
                              {log.audit_label ?? 'SYSTEM'}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono font-semibold text-indigo-300">
                            {log.action}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-200">
                            {log.actor}
                          </td>
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
