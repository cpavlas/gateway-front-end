import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Download,
  FileText,
  HardDrive,
  KeyRound,
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
  Tv,
  Upload,
  UserPlus,
  Users,
  Wifi,
  X,
  XCircle,
} from 'lucide-react'
import {
  apiClient,
  formatClock24h,
  type AllConnectivityTestResponse,
  type ConfigBackupPayload,
  type ConfigRestoreSummary,
  type ConnectivityTestResponse,
  type DeviceListResponse,
  type HealthLevel,
  type IntegrationSettingsUpdatePayload,
  type NodeConnectivityResult,
  type ServiceHealthStatus,
  type UserRole,
} from '../api/client'
import { AppLayout, type AppTab } from '../components/AppLayout'
import { AutoRefreshSelector, useAutoRefresh } from '../components/AutoRefreshSelector'
import { YouTubeLogoIcon } from '../components/YouTubeLogoIcon'
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

function normalizeNodeUrlKey(rawUrl: string): string {
  return rawUrl.trim().replace(/\/+$/, '')
}

function splitUrlList(rawUrls: string | null | undefined): string[] {
  const parts = (rawUrls ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : ['']
}

function StatusDotIndicator({
  nodeResult,
  testId,
}: {
  nodeResult?: NodeConnectivityResult
  testId: string
}) {
  const statusClass = !nodeResult
    ? 'bg-slate-600'
    : nodeResult.reachable
      ? 'bg-emerald-400 shadow-sm shadow-emerald-400/60'
      : 'bg-rose-500 shadow-sm shadow-rose-500/60'
  const label = !nodeResult
    ? 'Not tested yet'
    : `${nodeResult.reachable ? 'Reachable' : 'Failed'} (${nodeResult.latency_ms} ms): ${nodeResult.message}`
  return (
    <span
      data-testid={testId}
      title={label}
      aria-label={label}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${statusClass}`}
    />
  )
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

const DETAIL_KEY_LABELS: Record<string, string> = {
  arp_entry_count: 'ARP Entries',
  dnsmasq_lease_count: 'DHCP Leases',
  blocked_ip_count: 'Blocked Alias IPs',
  es_version: 'ES Version',
  index_doc_count: 'Indexed Docs',
  cluster_status: 'Cluster Status',
  assigned_shards: 'Assigned Shards',
  unassigned_shards: 'Unassigned Shards',
  relocating_shards: 'Relocating Shards',
  configured_nodes: 'Configured Nodes',
  configured_node_count: 'Configured Node Count',
  cluster_nodes: 'Cluster Data Nodes',
  storage_size_formatted: 'Storage Size',
  total_records: 'Total Records',
  audit_logs_count: 'Audit Events',
  db_path: 'Database Path',
  configured: 'Configured',
  url: 'Endpoint URL',
  active_sessions: 'Active Streams',
  server_name: 'Server Name',
  version: 'Version',
}

function formatDetailLabel(key: string): string {
  if (DETAIL_KEY_LABELS[key]) {
    return DETAIL_KEY_LABELS[key]
  }
  return key
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ')
}

function formatDetailValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(', ')
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  return String(value)
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
  const [showDetails, setShowDetails] = useState(true)
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
          <div className="space-y-1.5">
            <button
              type="button"
              data-testid={`toggle-details-${testId}`}
              aria-expanded={showDetails}
              onClick={() => setShowDetails((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-md border border-slate-800 bg-slate-950/50 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-800/60 cursor-pointer"
            >
              <span>Technical Details ({Object.keys(details).length})</span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
                  showDetails ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </button>
            {showDetails && (
              <dl className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 text-xs">
                {Object.entries(details).map(([key, value]) => (
                  <div key={key} className="truncate">
                    <dt className="text-[11px] text-slate-400" title={key}>
                      {formatDetailLabel(key)}
                    </dt>
                    <dd
                      className="font-semibold text-slate-200 truncate"
                      title={formatDetailValue(value)}
                    >
                      {formatDetailValue(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
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

  const [auditEnabled, setAuditEnabled] = useState(true)
  const [auditActionFilter, setAuditActionFilter] = useState('')
  const [auditLabelFilter, setAuditLabelFilter] = useState('')
  const [auditSearch, setAuditSearch] = useState('')
  const [auditLimit, setAuditLimit] = useState<number>(50)
  const [auditOffset, setAuditOffset] = useState<number>(0)
  const [auditPruneMessage, setAuditPruneMessage] = useState<string | null>(null)
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
  const [esUrls, setEsUrls] = useState<string[]>([''])
  const [esKey, setEsKey] = useState('')
  const [esVerifySsl, setEsVerifySsl] = useState(false)
  const [esCaCertPath, setEsCaCertPath] = useState('')
  const [esIndexPatterns, setEsIndexPatterns] = useState('')
  const [plexUrls, setPlexUrls] = useState<string[]>([''])
  const [plexToken, setPlexToken] = useState('')
  const [plexVerifySsl, setPlexVerifySsl] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [diagnosticResult, setDiagnosticResult] = useState<ConnectivityTestResponse | null>(null)
  const [allDiagnosticResult, setAllDiagnosticResult] =
    useState<AllConnectivityTestResponse | null>(null)
  const [urlTestStatusMap, setUrlTestStatusMap] = useState<Record<string, NodeConnectivityResult>>(
    {},
  )

  const recordNodeStatuses = (
    res: ConnectivityTestResponse,
    fallbackUrls: string[],
  ) => {
    const nodeResults = res.details?.node_results
    setUrlTestStatusMap((prev) => {
      const next = { ...prev }
      if (Array.isArray(nodeResults) && nodeResults.length > 0) {
        for (const nr of nodeResults) {
          const key = normalizeNodeUrlKey(nr.url)
          if (key) {
            next[key] = nr
          }
        }
      } else {
        for (const u of fallbackUrls) {
          const key = normalizeNodeUrlKey(u)
          if (key) {
            next[key] = {
              url: key,
              reachable: res.reachable,
              status: res.status,
              latency_ms: res.latency_ms,
              message: res.message,
            }
          }
        }
      }
      return next
    })
  }

  // Phase 9 (FB-P9-003): Multi-User Management
  const [usersExpanded, setUsersExpanded] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState<UserRole>('operator')
  const [resettingUserId, setResettingUserId] = useState<number | null>(null)
  const [resetPasswordValue, setResetPasswordValue] = useState('')
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
  } = useQuery({
    queryKey: ['integrationSettings'],
    queryFn: async () => {
      const data = await apiClient.getIntegrationSettings()
      setOpnUrl(data.opnsense_base_url)
      setOpnKey(data.opnsense_api_key_masked)
      setOpnSecret(data.opnsense_api_secret_masked)
      setOpnVerifySsl(data.opnsense_verify_ssl)
      setOpnProtectedIps(data.opnsense_protected_ips)
      setEsUrls(splitUrlList(data.elasticsearch_url))
      setEsKey(data.elasticsearch_api_key_masked)
      setEsVerifySsl(data.elasticsearch_verify_ssl)
      setEsCaCertPath(data.elasticsearch_ca_cert_path ?? '')
      setEsIndexPatterns(data.elasticsearch_index_patterns)
      setPlexUrls(splitUrlList(data.plex_base_url))
      setPlexToken(data.plex_api_token_masked ?? '')
      setPlexVerifySsl(Boolean(data.plex_verify_ssl))
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
    queryKey: [
      'auditLogs',
      auditActionFilter,
      auditLabelFilter,
      auditSearch,
      auditOffset,
      auditLimit,
    ],
    queryFn: () =>
      apiClient.getAuditLogs({
        action: auditActionFilter || undefined,
        audit_label: auditLabelFilter || undefined,
        search: auditSearch.trim() || undefined,
        offset: auditOffset,
        limit: auditLimit,
      }),
    enabled: auditEnabled,
  })

  const joinUrlList = (urls: string[]): string =>
    urls
      .map((item) => item.trim())
      .filter(Boolean)
      .join(', ')

  const buildSettingsPayload = (): IntegrationSettingsUpdatePayload => ({
    opnsense_base_url: opnUrl.trim() || undefined,
    opnsense_api_key: opnKey.trim() || undefined,
    opnsense_api_secret: opnSecret.trim() || undefined,
    opnsense_verify_ssl: opnVerifySsl,
    opnsense_protected_ips: opnProtectedIps.trim() || undefined,
    elasticsearch_url: joinUrlList(esUrls) || undefined,
    elasticsearch_api_key: esKey.trim() || undefined,
    elasticsearch_verify_ssl: esVerifySsl,
    elasticsearch_ca_cert_path: esCaCertPath.trim(),
    elasticsearch_index_patterns: esIndexPatterns.trim() || undefined,
    plex_base_url: joinUrlList(plexUrls),
    plex_api_token: plexToken.trim() || undefined,
    plex_verify_ssl: plexVerifySsl,
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
      setAllDiagnosticResult(null)
      setUrlTestStatusMap({})
      setOpnUrl(resetView.opnsense_base_url)
      setOpnKey(resetView.opnsense_api_key_masked)
      setOpnSecret(resetView.opnsense_api_secret_masked)
      setOpnVerifySsl(resetView.opnsense_verify_ssl)
      setOpnProtectedIps(resetView.opnsense_protected_ips)
      setEsUrls(splitUrlList(resetView.elasticsearch_url))
      setEsKey(resetView.elasticsearch_api_key_masked)
      setEsVerifySsl(resetView.elasticsearch_verify_ssl)
      setEsCaCertPath(resetView.elasticsearch_ca_cert_path ?? '')
      setEsIndexPatterns(resetView.elasticsearch_index_patterns)
      setPlexUrls(splitUrlList(resetView.plex_base_url))
      setPlexToken(resetView.plex_api_token_masked ?? '')
      setPlexVerifySsl(Boolean(resetView.plex_verify_ssl))
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
      recordNodeStatuses(res, [opnUrl])
    },
    onError: (err) => {
      setSettingsError(err instanceof Error ? err.message : 'OPNsense connectivity test failed.')
    },
  })

  const testEsMutation = useMutation({
    mutationFn: () => apiClient.testElasticsearchConnectivity(buildSettingsPayload()),
    onSuccess: (res) => {
      setDiagnosticResult(res)
      recordNodeStatuses(res, esUrls)
    },
    onError: (err) => {
      setSettingsError(err instanceof Error ? err.message : 'Elasticsearch connectivity test failed.')
    },
  })

  const testPlexMutation = useMutation({
    mutationFn: () => apiClient.testPlexConnectivity(buildSettingsPayload()),
    onSuccess: (res) => {
      setDiagnosticResult(res)
      recordNodeStatuses(res, plexUrls)
    },
    onError: (err) => {
      setSettingsError(err instanceof Error ? err.message : 'Plex connectivity test failed.')
    },
  })

  const testAllMutation = useMutation({
    mutationFn: () => apiClient.testAllConnectivity(buildSettingsPayload()),
    onSuccess: (res) => {
      setSettingsError(null)
      setAllDiagnosticResult(res)
      if (res.results.opnsense) {
        recordNodeStatuses(res.results.opnsense, [opnUrl])
      }
      if (res.results.elasticsearch) {
        recordNodeStatuses(res.results.elasticsearch, esUrls)
      }
      if (res.results.plex) {
        recordNodeStatuses(res.results.plex, plexUrls)
      }
    },
    onError: (err) => {
      setSettingsError(err instanceof Error ? err.message : 'Unified connectivity check failed.')
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

  const toggleUserRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: UserRole }) =>
      apiClient.updateUser(userId, { role }),
    onSuccess: (updated) => {
      setUserMgmtError(null)
      setUserMgmtMessage(`Updated role for '${updated.username}' to '${updated.role}'.`)
      void queryClient.invalidateQueries({ queryKey: ['usersList'] })
    },
    onError: (err) => {
      setUserMgmtError(err instanceof Error ? err.message : 'Failed to update user role.')
    },
  })

  const resetUserPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: number; password: string }) =>
      apiClient.updateUser(userId, { password }),
    onSuccess: (updated) => {
      setUserMgmtError(null)
      setUserMgmtMessage(`Reset password for '${updated.username}'.`)
      setResettingUserId(null)
      setResetPasswordValue('')
    },
    onError: (err) => {
      setUserMgmtError(err instanceof Error ? err.message : 'Failed to reset user password.')
    },
  })

  const pruneAuditMutation = useMutation({
    mutationFn: () =>
      apiClient.pruneAuditLogs({ retention_days: 7, audit_label: 'PERFORMANCE_ANALYSIS' }),
    onSuccess: (res) => {
      setAuditPruneMessage(
        `Pruned ${res.deleted_count} PERFORMANCE_ANALYSIS audit record(s) older than ${res.retention_days} days.`,
      )
      setAuditOffset(0)
      void queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
      void queryClient.invalidateQueries({ queryKey: ['systemHealth'] })
    },
    onError: (err) => {
      setAuditPruneMessage(
        err instanceof Error ? err.message : 'Failed to prune old performance logs.',
      )
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
  const youtubeBlockedDevices = (deviceList?.devices ?? []).filter((d) =>
    Boolean(d.is_youtube_blocked),
  ).length

  const auditLogs = auditResponse?.items ?? []
  const totalAuditCount = auditResponse?.total_count ?? auditLogs.length
  const lastHealthClock = formatClock24h(healthUpdatedAt)
  const lastAuditClock = formatClock24h(auditUpdatedAt)

  const handleExportAuditCsv = () => {
    const headers = ['id', 'created_at', 'audit_label', 'action', 'actor', 'target', 'status', 'details']
    const escapeCell = (raw: string | undefined | null) =>
      `"${String(raw ?? '').replaceAll('"', '""')}"`
    const rows = [
      headers.join(','),
      ...auditLogs.map((log) =>
        [
          log.id,
          escapeCell(log.created_at),
          escapeCell(log.audit_label ?? 'SYSTEM'),
          escapeCell(log.action),
          escapeCell(log.actor),
          escapeCell(log.target),
          escapeCell(log.status),
          escapeCell(log.details),
        ].join(','),
      ),
    ]
    try {
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `gateway-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      }
    } catch {
      // Ignore download helper errors in headless test environments
    }
  }

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
                aria-label="Refresh Status"
                title="Refresh Status"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-60 cursor-pointer shrink-0"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
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
            Checking OPNsense, Elasticsearch, SQLite, and Plex connectivity...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
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

            <ServiceCard
              testId="service-card-plex"
              title="Plex Media Server"
              subtitle="Optional Watch & Session API"
              icon={<Tv className="h-5 w-5" aria-hidden="true" />}
              health={healthReport?.services?.plex}
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

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
                <span>YouTube Blocked</span>
                <YouTubeLogoIcon className="h-3.5 w-3.5" />
              </div>
              <p
                data-testid="status-youtube-blocked-devices"
                className="mt-1 text-lg font-bold text-rose-300"
              >
                {youtubeBlockedDevices}
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
                    Configure OPNsense, Elasticsearch &amp; Plex Media Server connection parameters and run live connectivity diagnostics
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start">
                {settingsExpanded && (
                  <button
                    type="button"
                    data-testid="test-all-connectivity-btn"
                    onClick={() => testAllMutation.mutate()}
                    disabled={testAllMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-600/20 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-600/30 disabled:opacity-60 cursor-pointer"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${testAllMutation.isPending ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>
                      {testAllMutation.isPending ? 'Testing All...' : 'Test All Connections'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  data-testid="toggle-integration-settings-btn"
                  aria-expanded={settingsExpanded}
                  aria-label={settingsExpanded ? 'Collapse Connection Settings' : 'Configure Connections'}
                  title={settingsExpanded ? 'Collapse Connection Settings' : 'Configure Connections'}
                  onClick={() => setSettingsExpanded((prev) => !prev)}
                  disabled={isFetchingSettings}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60 cursor-pointer"
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      settingsExpanded ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  />
                  <span>{settingsExpanded ? 'Hide Connections' : 'Configure Connections'}</span>
                </button>
              </div>
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
                      <div className="flex items-center gap-2">
                        <StatusDotIndicator
                          testId="opnsense-url-status-dot"
                          nodeResult={urlTestStatusMap[normalizeNodeUrlKey(opnUrl)]}
                        />
                        <input
                          type="text"
                          data-testid="input-opnsense-url"
                          value={opnUrl}
                          onChange={(e) => setOpnUrl(e.target.value)}
                          placeholder="https://192.168.1.1"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
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

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="block text-[11px] text-slate-400">
                          Elasticsearch Node URLs (HA Failover)
                        </label>
                        <button
                          type="button"
                          data-testid="add-es-url-btn"
                          onClick={() => setEsUrls((prev) => [...prev, ''])}
                          className="inline-flex items-center gap-1 rounded border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-200 hover:bg-indigo-500/25 cursor-pointer"
                        >
                          <Plus className="h-3 w-3" aria-hidden="true" />
                          <span>Add URL</span>
                        </button>
                      </div>

                      <div className="space-y-1.5">
                        {esUrls.map((urlVal, idx) => {
                          const nodeStatus = urlTestStatusMap[normalizeNodeUrlKey(urlVal)]
                          return (
                            <div key={`es-url-row-${idx}`} className="flex items-center gap-2">
                              <StatusDotIndicator
                                testId={`es-url-status-dot-${idx}`}
                                nodeResult={nodeStatus}
                              />
                              <input
                                type="text"
                                data-testid={
                                  idx === 0 ? 'input-elasticsearch-url' : `input-elasticsearch-url-${idx}`
                                }
                                value={urlVal}
                                onChange={(e) =>
                                  setEsUrls((prev) =>
                                    prev.map((item, i) => (i === idx ? e.target.value : item)),
                                  )
                                }
                                placeholder="https://192.168.1.10:9200"
                                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                              />
                              <button
                                type="button"
                                data-testid={`remove-es-url-btn-${idx}`}
                                aria-label={`Remove Elasticsearch URL ${idx + 1}`}
                                title="Remove URL"
                                onClick={() =>
                                  setEsUrls((prev) =>
                                    prev.length > 1
                                      ? prev.filter((_, i) => i !== idx)
                                      : [''],
                                  )
                                }
                                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-400 hover:border-rose-500/50 hover:text-rose-300 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                      <p className="text-[10px] text-slate-400">
                        Add multiple Elasticsearch node URLs for automatic failover; status dots show per-node test results.
                      </p>
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

                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Elasticsearch CA Cert Path (Optional PEM Bundle)
                      </label>
                      <input
                        type="text"
                        data-testid="settings-es-ca-cert-input"
                        value={esCaCertPath}
                        onChange={(e) => setEsCaCertPath(e.target.value)}
                        placeholder="/app/certs/es-ca.pem"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                      />
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

                  {/* Plex Media Server Settings (FB-P9-005) */}
                  <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4 lg:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300">
                          Plex Media Server
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          Enables exact active watch minutes &amp; live Now Playing stream detection for same-VLAN Smart TVs that bypass OPNsense
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid="test-plex-btn"
                        onClick={() => testPlexMutation.mutate()}
                        disabled={testPlexMutation.isPending}
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-600/20 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-600/30 disabled:opacity-60 cursor-pointer"
                      >
                        <span>
                          {testPlexMutation.isPending
                            ? 'Testing...'
                            : 'Test Plex Connection'}
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <label className="block text-[11px] text-slate-400">
                            Plex Server URLs
                          </label>
                          <button
                            type="button"
                            data-testid="add-plex-url-btn"
                            onClick={() => setPlexUrls((prev) => [...prev, ''])}
                            className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/25 cursor-pointer"
                          >
                            <Plus className="h-3 w-3" aria-hidden="true" />
                            <span>Add URL</span>
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          {plexUrls.map((urlVal, idx) => {
                            const nodeStatus = urlTestStatusMap[normalizeNodeUrlKey(urlVal)]
                            return (
                              <div key={`plex-url-row-${idx}`} className="flex items-center gap-2">
                                <StatusDotIndicator
                                  testId={`plex-url-status-dot-${idx}`}
                                  nodeResult={nodeStatus}
                                />
                                <input
                                  type="text"
                                  data-testid={
                                    idx === 0 ? 'input-plex-url' : `input-plex-url-${idx}`
                                  }
                                  value={urlVal}
                                  onChange={(e) =>
                                    setPlexUrls((prev) =>
                                      prev.map((item, i) => (i === idx ? e.target.value : item)),
                                    )
                                  }
                                  placeholder="http://192.168.1.100:32400"
                                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  data-testid={`remove-plex-url-btn-${idx}`}
                                  aria-label={`Remove Plex URL ${idx + 1}`}
                                  title="Remove URL"
                                  onClick={() =>
                                    setPlexUrls((prev) =>
                                      prev.length > 1
                                        ? prev.filter((_, i) => i !== idx)
                                        : [''],
                                    )
                                  }
                                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-400 hover:border-rose-500/50 hover:text-rose-300 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-400 mb-1">
                          Plex API Token (X-Plex-Token)
                        </label>
                        <input
                          type="password"
                          data-testid="input-plex-token"
                          value={plexToken}
                          onChange={(e) => setPlexToken(e.target.value)}
                          placeholder="X-Plex-Token"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          data-testid="input-plex-verify-ssl"
                          checked={plexVerifySsl}
                          onChange={(e) => setPlexVerifySsl(e.target.checked)}
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
                          <td className="py-2.5 px-3">
                            <button
                              type="button"
                              data-testid={`toggle-role-user-${u.username}`}
                              disabled={u.is_protected_admin || toggleUserRoleMutation.isPending}
                              title={
                                u.is_protected_admin
                                  ? 'Protected default admin role cannot be demoted'
                                  : `Switch role to ${u.role === 'admin' ? 'operator' : 'admin'}`
                              }
                              onClick={() =>
                                toggleUserRoleMutation.mutate({
                                  userId: u.id,
                                  role: u.role === 'admin' ? 'operator' : 'admin',
                                })
                              }
                              className="rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {u.role}
                            </button>
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
                            <div className="inline-flex flex-wrap items-center justify-end gap-2">
                              {resettingUserId === u.id ? (
                                <div className="inline-flex items-center gap-1">
                                  <input
                                    type="password"
                                    data-testid={`reset-password-input-${u.username}`}
                                    value={resetPasswordValue}
                                    onChange={(e) => setResetPasswordValue(e.target.value)}
                                    placeholder="New password"
                                    className="w-32 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 focus:border-indigo-500 focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    data-testid={`reset-password-submit-${u.username}`}
                                    disabled={
                                      resetUserPasswordMutation.isPending ||
                                      resetPasswordValue.length < 8
                                    }
                                    onClick={() =>
                                      resetUserPasswordMutation.mutate({
                                        userId: u.id,
                                        password: resetPasswordValue,
                                      })
                                    }
                                    className="rounded border border-indigo-500/40 bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setResettingUserId(null)
                                      setResetPasswordValue('')
                                    }}
                                    className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  data-testid={`reset-password-user-${u.username}`}
                                  onClick={() => {
                                    setResettingUserId(u.id)
                                    setResetPasswordValue('')
                                  }}
                                  className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20 cursor-pointer"
                                >
                                  <KeyRound className="h-3 w-3" aria-hidden="true" />
                                  <span>Reset Password</span>
                                </button>
                              )}
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
              <div className="flex flex-wrap items-center gap-2">
                {auditEnabled && (
                  <button
                    type="button"
                    data-testid="audit-export-csv-btn"
                    disabled={auditLogs.length === 0}
                    onClick={handleExportAuditCsv}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Export CSV</span>
                  </button>
                )}

                {auditEnabled && isAdmin && (
                  <button
                    type="button"
                    data-testid="audit-prune-perf-btn"
                    onClick={() => pruneAuditMutation.mutate()}
                    disabled={pruneAuditMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {pruneAuditMutation.isPending
                        ? 'Pruning...'
                        : 'Prune Old Performance Logs'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  data-testid="load-audit-logs-btn"
                  aria-label={auditEnabled ? 'Refresh Audit Logs' : 'Load Audit Logs'}
                  title={auditEnabled ? 'Refresh Audit Logs' : 'Load Audit Logs'}
                  onClick={() => {
                    if (!auditEnabled) {
                      setAuditEnabled(true)
                    } else {
                      void refetchAudit()
                    }
                  }}
                  disabled={isFetchingAudit}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 ${
                    auditEnabled ? 'h-8 w-8' : 'px-3.5 py-2'
                  } text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60 cursor-pointer`}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isFetchingAudit ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  {!auditEnabled && <span>Load Audit Logs</span>}
                </button>
              </div>
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
              {auditPruneMessage && (
                <div
                  data-testid="audit-prune-status"
                  className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-200"
                >
                  {auditPruneMessage}
                </div>
              )}

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
                    onChange={(e) => {
                      setAuditSearch(e.target.value)
                      setAuditOffset(0)
                    }}
                    placeholder="Search audit events by action, actor, or details..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <select
                  aria-label="Filter audit logs by label"
                  data-testid="audit-label-filter"
                  value={auditLabelFilter}
                  onChange={(e) => {
                    setAuditLabelFilter(e.target.value)
                    setAuditOffset(0)
                  }}
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
                  <option value="PERFORMANCE_ANALYSIS">
                    Performance Analysis (PERFORMANCE_ANALYSIS)
                  </option>
                </select>

                <select
                  aria-label="Filter audit logs by action"
                  data-testid="audit-action-filter"
                  value={auditActionFilter}
                  onChange={(e) => {
                    setAuditActionFilter(e.target.value)
                    setAuditOffset(0)
                  }}
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

                <select
                  aria-label="Audit log page size"
                  data-testid="audit-limit-select"
                  value={auditLimit}
                  onChange={(e) => {
                    setAuditLimit(Number(e.target.value))
                    setAuditOffset(0)
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                  <option value={250}>250 / page</option>
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
                                  : log.audit_label === 'PERFORMANCE_ANALYSIS'
                                    ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
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
                            <div>
                              {log.target} ({log.status})
                            </div>
                            {log.details && (
                              <div className="mt-0.5 text-[11px] text-slate-300">
                                {log.details}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-400">
                <span data-testid="audit-pagination-summary" className="font-mono">
                  {totalAuditCount === 0
                    ? 'Showing 0 of 0 events'
                    : `Showing ${auditOffset + 1}-${Math.min(
                        auditOffset + auditLogs.length,
                        totalAuditCount,
                      )} of ${totalAuditCount} events`}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="audit-prev-page-btn"
                    disabled={auditOffset === 0 || isFetchingAudit}
                    onClick={() => setAuditOffset((prev) => Math.max(0, prev - auditLimit))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Prev</span>
                  </button>
                  <button
                    type="button"
                    data-testid="audit-next-page-btn"
                    disabled={auditOffset + auditLimit >= totalAuditCount || isFetchingAudit}
                    onClick={() => setAuditOffset((prev) => prev + auditLimit)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>Next</span>
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Test All Connections Popup Modal */}
      {allDiagnosticResult && (
        <div
          data-testid="test-all-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="test-all-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setAllDiagnosticResult(null)
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
        >
          <div
            data-testid="all-connectivity-diagnostic-result"
            className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <h3
                  id="test-all-modal-title"
                  className="text-sm font-bold uppercase tracking-wide text-slate-100"
                >
                  Unified Connectivity Summary:{' '}
                  <span
                    className={
                      allDiagnosticResult.overall_reachable
                        ? 'text-emerald-300'
                        : 'text-amber-300'
                    }
                  >
                    {allDiagnosticResult.overall_reachable
                      ? 'ALL SERVICES REACHABLE'
                      : 'PARTIAL OR FAILED PROBE'}
                  </span>
                </h3>
                <p className="mt-0.5 text-xs text-slate-400">
                  Live probe results across all configured upstream server URLs
                </p>
              </div>
              <button
                type="button"
                data-testid="close-test-all-modal-x-btn"
                aria-label="Close connectivity results modal"
                onClick={() => setAllDiagnosticResult(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="overflow-y-auto p-5 space-y-3">
              {Object.entries(allDiagnosticResult.results).map(([svcName, res]) => {
                const fallbackUrls =
                  svcName === 'opnsense'
                    ? [opnUrl]
                    : svcName === 'elasticsearch'
                      ? esUrls
                      : plexUrls
                const nodeRows: NodeConnectivityResult[] =
                  Array.isArray(res.details?.node_results) &&
                  res.details.node_results.length > 0
                    ? res.details.node_results
                    : fallbackUrls
                        .map((u) => u.trim())
                        .filter(Boolean)
                        .map((u) => ({
                          url: u,
                          reachable: res.reachable,
                          status: res.status,
                          latency_ms: res.latency_ms,
                          message: res.message,
                        }))

                return (
                  <div
                    key={svcName}
                    data-testid={`test-all-service-${svcName}`}
                    className={`rounded-lg border p-3.5 text-xs space-y-2 ${
                      res.reachable
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-rose-500/30 bg-rose-500/5'
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold uppercase">
                      <span className="text-slate-100">{svcName}</span>
                      <span className={res.reachable ? 'text-emerald-300' : 'text-rose-300'}>
                        {res.reachable ? 'OK' : 'FAIL'} ({res.latency_ms} ms)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300">{res.message}</p>

                    {nodeRows.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                        {nodeRows.map((node, idx) => (
                          <div
                            key={`${svcName}-node-${idx}-${node.url}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950/80 px-2.5 py-1.5"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <StatusDotIndicator
                                testId={`modal-${svcName}-node-dot-${idx}`}
                                nodeResult={node}
                              />
                              <span className="font-mono text-[11px] text-slate-200 truncate">
                                {node.url}
                              </span>
                            </div>
                            <span
                              className={`text-[11px] font-mono font-semibold ${
                                node.reachable ? 'text-emerald-300' : 'text-rose-300'
                              }`}
                            >
                              {node.reachable ? 'REACHABLE' : 'FAILED'} · {node.latency_ms} ms
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {res.error_diagnostic && (
                      <p className="font-mono text-[11px] text-rose-300">
                        Diagnostic: {res.error_diagnostic}
                      </p>
                    )}
                    {res.troubleshooting_hint && (
                      <p className="text-[11px] text-amber-200">
                        Hint: {res.troubleshooting_hint}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-end border-t border-slate-800 px-5 py-3 bg-slate-950/50">
              <button
                type="button"
                data-testid="close-test-all-modal-btn"
                onClick={() => setAllDiagnosticResult(null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700 cursor-pointer"
              >
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
