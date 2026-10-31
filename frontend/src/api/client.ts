export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy'
export type DeviceStatusFilter = 'all' | 'online' | 'blocked' | 'protected'

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
    sync?: boolean
  }): Promise<DeviceListResponse> {
    const query = new URLSearchParams()
    if (params?.search && params.search.trim()) {
      query.set('search', params.search.trim())
    }
    if (params?.status && params.status !== 'all') {
      query.set('status', params.status)
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
}
