export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy'
export type DeviceStatusFilter = 'all' | 'online' | 'blocked' | 'protected' | 'unassigned'
export type TimeWindow = '1h' | '24h' | '7d' | '30d'
export type GroupColor = 'indigo' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'violet' | 'slate'
export type GroupAccessStatus = 'empty' | 'allowed' | 'partially_blocked' | 'blocked'

export interface AuthUserResponse {
  username: string
  authenticated: boolean
  expires_at: string
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
  is_protected: boolean
  protection_reason: string | null
  notes: string
  groups?: DeviceGroupBadge[]
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
  action: 'block' | 'unblock'
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
  total_devices: number
  online_devices: number
  blocked_devices: number
  protected_devices: number
  blockable_devices: number
  member_device_ids: number[]
  members: DeviceItem[]
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
  action: 'block' | 'unblock'
  affected_device_ids: number[]
  affected_ips: string[]
  skipped_protected_names: string[]
  skipped_no_ip_names: string[]
  states_killed_ips: string[]
  warnings: string[]
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
  recent_queries: RecentDomainQueryItem[]
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exp
  return `${exp === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exp]}`
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
}
