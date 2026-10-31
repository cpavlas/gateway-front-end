export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy'

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
}

