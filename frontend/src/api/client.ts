export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy'
export type DeviceStatusFilter = 'all' | 'online' | 'blocked' | 'protected' | 'unassigned'
export type TimeWindow = '1h' | '24h' | '7d' | '30d'
export type GroupColor = 'indigo' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'slate'
export type GroupAccessStatus = 'empty' | 'allowed' | 'partially_blocked' | 'blocked'
export type OverrideMode = 'pause' | 'bonus'
export type OverrideTargetType = 'device' | 'group'

export type UserRole = 'admin' | 'operator'

export interface AuthUserResponse {
  username: string
  authenticated: boolean
  expires_at: string
  role?: UserRole
  theme_preference?: string
}

export interface SetupStatusResponse {
  needs_initial_setup: boolean
  admin_username: string
}

export interface SetupAdminPayload {
  password: string
  confirm_password?: string
}

export interface UserItem {
  id: number
  username: string
  role: UserRole
  is_active: boolean
  is_protected_admin: boolean
  theme_preference: string
  created_at: string
  updated_at: string
}

export interface UserListResponse {
  users: UserItem[]
}

export interface UserCreatePayload {
  username: string
  password: string
  role?: UserRole
  is_active?: boolean
  theme_preference?: string
}

export interface UserUpdatePayload {
  password?: string
  role?: UserRole
  is_active?: boolean
  theme_preference?: string
}

export interface IntegrationSettingsView {
  source: 'ui_override' | 'env'
  opnsense_base_url: string
  has_opnsense_api_key: boolean
  opnsense_api_key_masked: string
  has_opnsense_api_secret: boolean
  opnsense_api_secret_masked: string
  opnsense_verify_ssl: boolean
  opnsense_ca_cert_path: string
  opnsense_timeout_seconds: number
  opnsense_protected_ips: string
  elasticsearch_url: string
  has_elasticsearch_api_key: boolean
  elasticsearch_api_key_masked: string
  elasticsearch_verify_ssl: boolean
  elasticsearch_ca_cert_path: string
  elasticsearch_timeout_seconds: number
  elasticsearch_index_patterns: string
  updated_by?: string | null
  updated_at?: string | null
}

export interface IntegrationSettingsUpdatePayload {
  opnsense_base_url?: string
  opnsense_api_key?: string
  opnsense_api_secret?: string
  opnsense_verify_ssl?: boolean
  opnsense_ca_cert_path?: string
  opnsense_timeout_seconds?: number
  opnsense_protected_ips?: string
  elasticsearch_url?: string
  elasticsearch_api_key?: string
  elasticsearch_verify_ssl?: boolean
  elasticsearch_ca_cert_path?: string
  elasticsearch_timeout_seconds?: number
  elasticsearch_index_patterns?: string
}

export interface ConnectivityTestResponse {
  service: 'opnsense' | 'elasticsearch'
  reachable: boolean
  status: HealthLevel
  latency_ms: number
  message: string
  error_diagnostic?: string | null
  troubleshooting_hint?: string | null
  details?: Record<string, unknown>
}

export interface LoginPayload {
  username: string
  password: string
}

export interface ServiceHealthStatus {
  service: string
  status: HealthLevel
  latency_ms: number
  message: string
  details?: Record<string, unknown>
}

export interface SystemHealthResponse {
  overall_status: HealthLevel
  version: string
  services: {
    sqlite: ServiceHealthStatus
    opnsense: ServiceHealthStatus
    elasticsearch: ServiceHealthStatus
    [key: string]: ServiceHealthStatus
  }
}

export interface ActiveOverrideInfo {
  id: number
  target_type: OverrideTargetType
  device_id?: number | null
  group_id?: number | null
  target_name: string
  mode: OverrideMode
  duration_minutes: number
  created_by: string
  reason: string
  is_active: boolean
  created_at: string
  expires_at: string
  remaining_seconds: number
}

export interface ActiveScheduleInfo {
  id: number
  name: string
  target_type: OverrideTargetType
  device_id?: number | null
  group_id?: number | null
  start_time: string
  end_time: string
  timezone: string
}

export interface ScheduleRule {
  id: number
  name: string
  description: string
  target_type: OverrideTargetType
  device_id?: number | null
  group_id?: number | null
  target_name: string
  days_of_week: number[]
  start_time: string
  end_time: string
  timezone: string
  is_enabled: boolean
  is_active_now: boolean
  created_at: string
  updated_at: string
}

export interface ScheduleCreatePayload {
  name: string
  description?: string
  target_type: OverrideTargetType
  device_id?: number | null
  group_id?: number | null
  days_of_week: number[]
  start_time: string
  end_time: string
  timezone?: string | null
  is_enabled?: boolean
}

export interface ScheduleUpdatePayload {
  name?: string
  description?: string
  days_of_week?: number[]
  start_time?: string
  end_time?: string
  timezone?: string | null
  is_enabled?: boolean
}

export interface ScheduleListResponse {
  schedules: ScheduleRule[]
}

export interface ScheduleReconcileResponse {
  blocked_count: number
  unblocked_count: number
  ip_drift_healed_count: number
  warnings: string[]
}

export interface TimerStartPayload {
  mode: OverrideMode
  duration_minutes?: number
  preset?: string
  reason?: string
}

export interface TimerListResponse {
  timers: ActiveOverrideInfo[]
}

export interface TimerCancelResponse {
  cancelled_override_id: number
  target_type: OverrideTargetType
  device_id?: number | null
  group_id?: number | null
  mode: OverrideMode
  reverted_state: boolean
  warnings: string[]
}

export interface DeviceGroupBadge {
  id: number
  name: string
  color_badge: string
  icon: string
}

export interface DeviceItem {
  id: number
  mac_address: string
  ipv4_address: string | null
  hostname: string | null
  display_name: string | null
  effective_name: string
  vendor: string | null
  interface_name: string | null
  lease_type: string
  is_online: boolean
  is_blocked: boolean
  is_manually_blocked?: boolean
  is_youtube_blocked?: boolean
  is_protected: boolean
  protection_reason: string | null
  notes: string
  groups?: DeviceGroupBadge[]
  active_override?: ActiveOverrideInfo | null
  active_schedule?: ActiveScheduleInfo | null
  first_seen_at: string
  last_seen_at: string
  updated_at: string
}

export interface DeviceSummaryStats {
  total_devices: number
  online_devices: number
  blocked_devices: number
  protected_devices: number
}

export interface DeviceListResponse {
  summary: DeviceSummaryStats
  devices: DeviceItem[]
  last_synced_at: string | null
}

export interface DeviceUpdatePayload {
  display_name?: string | null
  notes?: string | null
  is_protected?: boolean
}

export interface DeviceActionResponse {
  device: DeviceItem
  action: 'block' | 'unblock' | 'youtube_block' | 'youtube_unblock'
  states_killed: boolean
  warning: string | null
}

export interface GroupItem {
  id: number
  name: string
  description: string
  color_badge: string
  icon: string
  access_status: GroupAccessStatus
  youtube_status?: GroupAccessStatus
  youtube_blocked_devices?: number
  total_devices: number
  online_devices: number
  blocked_devices: number
  protected_devices: number
  blockable_devices: number
  member_device_ids: number[]
  members: DeviceItem[]
  active_override?: ActiveOverrideInfo | null
  active_schedule?: ActiveScheduleInfo | null
  created_at: string
  updated_at: string
}

export interface GroupListResponse {
  groups: GroupItem[]
}

export interface GroupCreatePayload {
  name: string
  description?: string
  color_badge?: string
  icon?: string
  device_ids?: number[]
}

export interface GroupUpdatePayload {
  name?: string
  description?: string
  color_badge?: string
  icon?: string
  device_ids?: number[]
}

export interface GroupBulkActionResponse {
  group: GroupItem
  action: 'block' | 'unblock' | 'youtube_block' | 'youtube_unblock'
  affected_device_ids: number[]
  affected_ips: string[]
  skipped_protected_names: string[]
  skipped_no_ip_names: string[]
  states_killed_ips: string[]
  warnings: string[]
}

export interface AppUsageDeviceItem {
  device_id: number | null
  ipv4_address: string
  effective_name: string
  active_minutes: number
  event_count: number
  dns_queries: number
  bytes: number
}

export interface AppUsageItem {
  app_key: 'youtube' | 'plex'
  display_name: string
  active_minutes: number
  event_count: number
  dns_queries: number
  bytes: number
  last_active_at: string | null
  top_devices?: AppUsageDeviceItem[]
}

export interface AuditLogItem {
  id: number
  actor: string
  action: string
  audit_label?: string
  target: string
  status: string
  details: string
  created_at: string
}

export interface AuditLogListResponse {
  total_count: number
  items: AuditLogItem[]
}

export interface ConfigBackupPayload {
  schema_version: string
  exported_at: string
  devices: Array<{
    mac_address: string
    display_name?: string | null
    notes?: string
    is_protected?: boolean
    is_manually_blocked?: boolean
    is_youtube_blocked?: boolean
  }>
  groups: Array<{
    name: string
    description?: string
    color_badge?: string
    icon?: string
    member_macs?: string[]
  }>
  schedules: Array<{
    name: string
    description?: string
    target_type: 'device' | 'group'
    device_mac?: string | null
    group_name?: string | null
    days_of_week: number[]
    start_time: string
    end_time: string
    timezone?: string
    is_enabled?: boolean
  }>
}

export interface ConfigRestoreSummary {
  devices_updated: number
  groups_upserted: number
  schedules_upserted: number
  restored_at: string
}

export interface TimelineBucketItem {
  timestamp: string
  total_events: number
  bytes: number
  dns_queries: number
  allowed_packets: number
  blocked_packets: number
}

export interface TopDomainItem {
  domain: string
  query_count: number
}

export interface TopOrganizationItem {
  organization: string
  packet_count: number
  bytes: number
}

export interface TopDeviceTrafficItem {
  device_id: number | null
  ipv4_address: string
  effective_name: string
  mac_address: string | null
  vendor: string | null
  is_online: boolean
  is_blocked: boolean
  is_protected: boolean
  total_events: number
  bytes: number
  dns_queries: number
  allowed_packets: number
  blocked_packets: number
  last_seen_at: string | null
}

export interface NetworkOverviewSummary {
  total_events: number
  total_bytes: number
  dns_query_count: number
  firewall_event_count: number
  allowed_packet_count: number
  blocked_packet_count: number
}

export interface NetworkOverviewResponse {
  window: TimeWindow
  generated_at: string
  es_reachable: boolean
  warning: string | null
  summary: NetworkOverviewSummary
  timeline: TimelineBucketItem[]
  top_devices: TopDeviceTrafficItem[]
  top_domains: TopDomainItem[]
  top_registered_domains: TopDomainItem[]
  top_organizations: TopOrganizationItem[]
  application_usage?: AppUsageItem[]
}

export interface HourlyAccessPoint {
  hour: number
  label: string
  total_events: number
  dns_queries: number
  bytes: number
  active_hours_count: number
}

export interface RecentDomainQueryItem {
  timestamp: string
  domain: string
  registered_domain: string | null
  record_type: string
  source_ip?: string | null
  device_name?: string | null
}

export interface DeviceAnalyticsSummary {
  total_events: number
  total_bytes: number
  dns_query_count: number
  firewall_event_count: number
  allowed_packet_count: number
  blocked_packet_count: number
  active_hours_in_day: number
  first_active_at: string | null
  last_active_at: string | null
}

export interface DeviceAnalyticsResponse {
  device: DeviceItem
  window: TimeWindow
  generated_at: string
  es_reachable: boolean
  warning: string | null
  summary: DeviceAnalyticsSummary
  timeline: TimelineBucketItem[]
  hourly_access_profile: HourlyAccessPoint[]
  top_domains: TopDomainItem[]
  top_registered_domains: TopDomainItem[]
  top_organizations: TopOrganizationItem[]
  application_usage?: AppUsageItem[]
  recent_queries: RecentDomainQueryItem[]
}

export interface GroupMemberTrafficItem {
  device_id: number
  effective_name: string
  ipv4_address: string | null
  mac_address: string
  vendor: string | null
  is_online: boolean
  is_blocked: boolean
  is_protected: boolean
  total_events: number
  bytes: number
  dns_query_count: number
  allowed_packet_count: number
  blocked_packet_count: number
}

export interface GroupAnalyticsResponse {
  group: GroupItem
  tracked_ips: string[]
  window: TimeWindow
  generated_at: string
  es_reachable: boolean
  warning: string | null
  summary: DeviceAnalyticsSummary
  member_breakdown: GroupMemberTrafficItem[]
  timeline: TimelineBucketItem[]
  hourly_access_profile: HourlyAccessPoint[]
  top_domains: TopDomainItem[]
  top_registered_domains: TopDomainItem[]
  top_organizations: TopOrganizationItem[]
  application_usage?: AppUsageItem[]
  recent_queries: RecentDomainQueryItem[]
}

export interface FirewallOverviewSummary {
  total_packets: number
  allowed_packets: number
  blocked_packets: number
  inbound_packets: number
  outbound_packets: number
  total_bytes: number
  open_wan_port_count: number
}

export interface FirewallNoisyLanDeviceItem {
  device_id: number | null
  ipv4_address: string
  effective_name: string
  mac_address: string | null
  is_online: boolean
  is_blocked: boolean
  is_protected: boolean
  blocked_packets: number
  bytes: number
  target_ports: number[]
  last_seen_at: string | null
}

export interface FirewallExternalScannerItem {
  source_ip: string
  organization: string | null
  blocked_packets: number
  bytes: number
  target_ports: number[]
  last_seen_at: string | null
}

export interface FirewallOpenWanPortItem {
  device_id: number | null
  destination_ip: string
  effective_name: string
  external_port?: number
  destination_port: number
  port_mapping?: string
  protocol: string
  passed_packets: number
  bytes: number
  unique_external_sources: number
  last_seen_at: string | null
}

export interface FirewallLogEventItem {
  timestamp: string
  action: string
  direction: string
  protocol: string
  interface: string
  source_ip: string
  source_name: string | null
  source_port: number | null
  source_org: string | null
  destination_ip: string
  destination_name: string | null
  destination_port: number | null
  destination_org: string | null
  bytes: number
  rule_id: string
}

export interface FirewallOverviewResponse {
  window: TimeWindow
  generated_at: string
  es_reachable: boolean
  warning: string | null
  summary: FirewallOverviewSummary
  timeline: TimelineBucketItem[]
  noisy_lan_devices: FirewallNoisyLanDeviceItem[]
  external_scanners: FirewallExternalScannerItem[]
  open_wan_ports: FirewallOpenWanPortItem[]
  recent_events: FirewallLogEventItem[]
}

export function formatActiveMinutes(minutes: number): string {
  const safe = Math.max(0, Math.floor(minutes || 0))
  if (safe <= 0) return '0m'
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }
  return `${mins}m`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exp
  return `${exp === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exp]}`
}

export function formatRemainingDuration(remainingSeconds: number): string {
  const clamped = Math.max(0, Math.floor(remainingSeconds))
  if (clamped <= 0) return '0m left'
  const hours = Math.floor(clamped / 3600)
  const mins = Math.ceil((clamped % 3600) / 60)
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`
  }
  return `${Math.max(1, mins)}m left`
}

export function formatBlockedPercentage(blocked: number, allowed: number): string {
  const safeBlocked = Math.max(0, blocked || 0)
  const total = safeBlocked + Math.max(0, allowed || 0)
  if (total <= 0) return '0.0%'
  return `${((safeBlocked / total) * 100).toFixed(1)}%`
}

export function formatClock24h(timestamp?: number | string | null): string {
  if (!timestamp) return ''
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return String(timestamp)
  return parsed.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export class ApiError extends Error {
  public readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`
    try {
      const body = (await response.json()) as { detail?: string }
      if (typeof body?.detail === 'string' && body.detail.trim().length > 0) {
        errorMessage = body.detail
      }
    } catch {
      // Fallback to status text when response body is not JSON
    }
    throw new ApiError(errorMessage, response.status)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export const apiClient = {
  getCurrentUser(): Promise<AuthUserResponse> {
    return requestJson<AuthUserResponse>('/api/v1/auth/me', {
      method: 'GET',
    })
  },

  getSetupStatus(): Promise<SetupStatusResponse> {
    return requestJson<SetupStatusResponse>('/api/v1/auth/setup-status', {
      method: 'GET',
    })
  },

  setupInitialAdmin(payload: SetupAdminPayload): Promise<AuthUserResponse> {
    return requestJson<AuthUserResponse>('/api/v1/auth/setup-admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  login(payload: LoginPayload): Promise<AuthUserResponse> {
    return requestJson<AuthUserResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  logout(): Promise<{ status: string }> {
    return requestJson<{ status: string }>('/api/v1/auth/logout', {
      method: 'POST',
    })
  },

  getSystemHealth(): Promise<SystemHealthResponse> {
    return requestJson<SystemHealthResponse>('/api/v1/system/health', {
      method: 'GET',
    })
  },

  getDevices(params?: {
    search?: string
    status?: DeviceStatusFilter
    group_id?: number
    sync?: boolean
  }): Promise<DeviceListResponse> {
    const query = new URLSearchParams()
    if (params?.search && params.search.trim()) {
      query.set('search', params.search.trim())
    }
    if (params?.status && params.status !== 'all') {
      query.set('status', params.status)
    }
    if (params?.group_id !== undefined) {
      query.set('group_id', String(params.group_id))
    }
    if (params?.sync) {
      query.set('sync', 'true')
    }
    const qs = query.toString()
    return requestJson<DeviceListResponse>(`/api/v1/devices${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    })
  },

  syncDevices(): Promise<DeviceListResponse> {
    return requestJson<DeviceListResponse>('/api/v1/devices/sync', {
      method: 'POST',
    })
  },

  updateDevice(deviceId: number, payload: DeviceUpdatePayload): Promise<DeviceItem> {
    return requestJson<DeviceItem>(`/api/v1/devices/${deviceId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },

  blockDevice(deviceId: number): Promise<DeviceActionResponse> {
    return requestJson<DeviceActionResponse>(`/api/v1/devices/${deviceId}/block`, {
      method: 'POST',
    })
  },

  unblockDevice(deviceId: number): Promise<DeviceActionResponse> {
    return requestJson<DeviceActionResponse>(`/api/v1/devices/${deviceId}/unblock`, {
      method: 'POST',
    })
  },

  blockDeviceYoutube(deviceId: number): Promise<DeviceActionResponse> {
    return requestJson<DeviceActionResponse>(`/api/v1/devices/${deviceId}/youtube/block`, {
      method: 'POST',
    })
  },

  unblockDeviceYoutube(deviceId: number): Promise<DeviceActionResponse> {
    return requestJson<DeviceActionResponse>(`/api/v1/devices/${deviceId}/youtube/unblock`, {
      method: 'POST',
    })
  },

  getGroups(): Promise<GroupListResponse> {
    return requestJson<GroupListResponse>('/api/v1/groups', {
      method: 'GET',
    })
  },

  createGroup(payload: GroupCreatePayload): Promise<GroupItem> {
    return requestJson<GroupItem>('/api/v1/groups', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  updateGroup(groupId: number, payload: GroupUpdatePayload): Promise<GroupItem> {
    return requestJson<GroupItem>(`/api/v1/groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },

  deleteGroup(groupId: number): Promise<void> {
    return requestJson<void>(`/api/v1/groups/${groupId}`, {
      method: 'DELETE',
    })
  },

  blockGroup(groupId: number): Promise<GroupBulkActionResponse> {
    return requestJson<GroupBulkActionResponse>(`/api/v1/groups/${groupId}/block`, {
      method: 'POST',
    })
  },

  unblockGroup(groupId: number): Promise<GroupBulkActionResponse> {
    return requestJson<GroupBulkActionResponse>(`/api/v1/groups/${groupId}/unblock`, {
      method: 'POST',
    })
  },

  blockGroupYoutube(groupId: number): Promise<GroupBulkActionResponse> {
    return requestJson<GroupBulkActionResponse>(`/api/v1/groups/${groupId}/youtube/block`, {
      method: 'POST',
    })
  },

  unblockGroupYoutube(groupId: number): Promise<GroupBulkActionResponse> {
    return requestJson<GroupBulkActionResponse>(`/api/v1/groups/${groupId}/youtube/unblock`, {
      method: 'POST',
    })
  },

  getGroupAnalytics(
    groupId: number,
    params?: {
      window?: TimeWindow
      domain_search?: string
      refresh?: boolean
    },
  ): Promise<GroupAnalyticsResponse> {
    const query = new URLSearchParams()
    query.set('window', params?.window ?? '24h')
    if (params?.domain_search && params.domain_search.trim()) {
      query.set('domain_search', params.domain_search.trim())
    }
    if (params?.refresh) {
      query.set('refresh', 'true')
    }
    return requestJson<GroupAnalyticsResponse>(
      `/api/v1/groups/${groupId}/analytics?${query.toString()}`,
      { method: 'GET' },
    )
  },

  getActiveTimers(): Promise<TimerListResponse> {
    return requestJson<TimerListResponse>('/api/v1/timers', {
      method: 'GET',
    })
  },

  startDeviceTimer(
    deviceId: number,
    payload: TimerStartPayload,
  ): Promise<ActiveOverrideInfo> {
    return requestJson<ActiveOverrideInfo>(`/api/v1/timers/devices/${deviceId}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  startGroupTimer(
    groupId: number,
    payload: TimerStartPayload,
  ): Promise<ActiveOverrideInfo> {
    return requestJson<ActiveOverrideInfo>(`/api/v1/timers/groups/${groupId}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  cancelTimer(overrideId: number, revertState = true): Promise<TimerCancelResponse> {
    return requestJson<TimerCancelResponse>(
      `/api/v1/timers/${overrideId}?revert_state=${revertState ? 'true' : 'false'}`,
      { method: 'DELETE' },
    )
  },

  getSchedules(): Promise<ScheduleListResponse> {
    return requestJson<ScheduleListResponse>('/api/v1/schedules', {
      method: 'GET',
    })
  },

  createSchedule(payload: ScheduleCreatePayload): Promise<ScheduleRule> {
    return requestJson<ScheduleRule>('/api/v1/schedules', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  updateSchedule(scheduleId: number, payload: ScheduleUpdatePayload): Promise<ScheduleRule> {
    return requestJson<ScheduleRule>(`/api/v1/schedules/${scheduleId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },

  toggleSchedule(scheduleId: number, isEnabled: boolean): Promise<ScheduleRule> {
    return requestJson<ScheduleRule>(`/api/v1/schedules/${scheduleId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ is_enabled: isEnabled }),
    })
  },

  deleteSchedule(scheduleId: number): Promise<void> {
    return requestJson<void>(`/api/v1/schedules/${scheduleId}`, {
      method: 'DELETE',
    })
  },

  reconcileSchedules(): Promise<ScheduleReconcileResponse> {
    return requestJson<ScheduleReconcileResponse>('/api/v1/schedules/reconcile', {
      method: 'POST',
    })
  },

  getAuditLogs(params?: {
    action?: string
    audit_label?: string
    search?: string
    limit?: number
  }): Promise<AuditLogListResponse> {
    const query = new URLSearchParams()
    if (params?.action && params.action !== 'all') {
      query.set('action', params.action)
    }
    if (params?.audit_label && params.audit_label !== 'all') {
      query.set('audit_label', params.audit_label)
    }
    if (params?.search && params.search.trim()) {
      query.set('search', params.search.trim())
    }
    if (params?.limit) {
      query.set('limit', String(params.limit))
    }
    const qs = query.toString()
    return requestJson<AuditLogListResponse>(`/api/v1/audit-logs${qs ? `?${qs}` : ''}`, {
      method: 'GET',
    })
  },

  getUsers(): Promise<UserListResponse> {
    return requestJson<UserListResponse>('/api/v1/users', {
      method: 'GET',
    })
  },

  createUser(payload: UserCreatePayload): Promise<UserItem> {
    return requestJson<UserItem>('/api/v1/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  updateUser(userId: number, payload: UserUpdatePayload): Promise<UserItem> {
    return requestJson<UserItem>(`/api/v1/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
  },

  deleteUser(userId: number): Promise<{ deleted_user_id: number; username: string }> {
    return requestJson<{ deleted_user_id: number; username: string }>(
      `/api/v1/users/${userId}`,
      { method: 'DELETE' },
    )
  },

  getIntegrationSettings(): Promise<IntegrationSettingsView> {
    return requestJson<IntegrationSettingsView>('/api/v1/system/settings', {
      method: 'GET',
    })
  },

  updateIntegrationSettings(
    payload: IntegrationSettingsUpdatePayload,
  ): Promise<IntegrationSettingsView> {
    return requestJson<IntegrationSettingsView>('/api/v1/system/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  },

  resetIntegrationSettings(): Promise<IntegrationSettingsView> {
    return requestJson<IntegrationSettingsView>('/api/v1/system/settings', {
      method: 'DELETE',
    })
  },

  testOpnsenseConnectivity(
    payload?: IntegrationSettingsUpdatePayload,
  ): Promise<ConnectivityTestResponse> {
    return requestJson<ConnectivityTestResponse>(
      '/api/v1/system/settings/test-opnsense',
      {
        method: 'POST',
        body: JSON.stringify(payload ?? {}),
      },
    )
  },

  testElasticsearchConnectivity(
    payload?: IntegrationSettingsUpdatePayload,
  ): Promise<ConnectivityTestResponse> {
    return requestJson<ConnectivityTestResponse>(
      '/api/v1/system/settings/test-elasticsearch',
      {
        method: 'POST',
        body: JSON.stringify(payload ?? {}),
      },
    )
  },

  exportConfigBackup(): Promise<ConfigBackupPayload> {
    return requestJson<ConfigBackupPayload>('/api/v1/system/backup', {
      method: 'GET',
    })
  },

  restoreConfigBackup(payload: ConfigBackupPayload): Promise<ConfigRestoreSummary> {
    return requestJson<ConfigRestoreSummary>('/api/v1/system/restore', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  getNetworkOverview(params?: {
    window?: TimeWindow
    refresh?: boolean
  }): Promise<NetworkOverviewResponse> {
    const query = new URLSearchParams()
    query.set('window', params?.window ?? '24h')
    if (params?.refresh) {
      query.set('refresh', 'true')
    }
    return requestJson<NetworkOverviewResponse>(
      `/api/v1/analytics/overview?${query.toString()}`,
      { method: 'GET' },
    )
  },

  getDeviceAnalytics(
    deviceId: number,
    params?: {
      window?: TimeWindow
      domain_search?: string
      refresh?: boolean
    },
  ): Promise<DeviceAnalyticsResponse> {
    const query = new URLSearchParams()
    query.set('window', params?.window ?? '24h')
    if (params?.domain_search && params.domain_search.trim()) {
      query.set('domain_search', params.domain_search.trim())
    }
    if (params?.refresh) {
      query.set('refresh', 'true')
    }
    return requestJson<DeviceAnalyticsResponse>(
      `/api/v1/devices/${deviceId}/analytics?${query.toString()}`,
      { method: 'GET' },
    )
  },

  getFirewallOverview(params?: {
    window?: TimeWindow
    action?: string
    direction?: string
    protocol?: string
    search?: string
    refresh?: boolean
  }): Promise<FirewallOverviewResponse> {
    const query = new URLSearchParams()
    query.set('window', params?.window ?? '24h')
    if (params?.action && params.action !== 'all') {
      query.set('action', params.action)
    }
    if (params?.direction && params.direction !== 'all') {
      query.set('direction', params.direction)
    }
    if (params?.protocol && params.protocol !== 'all') {
      query.set('protocol', params.protocol)
    }
    if (params?.search && params.search.trim()) {
      query.set('search', params.search.trim())
    }
    if (params?.refresh) {
      query.set('refresh', 'true')
    }
    return requestJson<FirewallOverviewResponse>(
      `/api/v1/firewall/overview?${query.toString()}`,
      { method: 'GET' },
    )
  },
}
