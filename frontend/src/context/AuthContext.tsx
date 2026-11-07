import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import {
  apiClient,
  ApiError,
  type AuthUserResponse,
  type LoginPayload,
  type SetupAdminPayload,
  type ThemePreference,
} from '../api/client'

const THEME_STORAGE_KEY = 'gateway_theme_preference'

export function normalizeThemePreference(raw?: string | null): ThemePreference {
  const cleaned = (raw || '').trim().toLowerCase()
  if (cleaned === 'crimson' || cleaned === 'ocean') {
    return cleaned
  }
  return 'default'
}

function readStoredTheme(): ThemePreference {
  try {
    return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'default'
  }
}

function applyThemeToDocument(theme: ThemePreference): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.theme = theme
    document.documentElement.setAttribute('data-theme', theme)
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Ignore storage errors
  }
}

interface AuthContextValue {
  user: AuthUserResponse | null
  isLoading: boolean
  error: string | null
  themePreference: ThemePreference
  login: (payload: LoginPayload) => Promise<boolean>
  setupInitialAdmin: (payload: SetupAdminPayload) => Promise<boolean>
  updateThemePreference: (theme: ThemePreference) => Promise<void>
  logout: () => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUserResponse | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readStoredTheme(),
  )

  useEffect(() => {
    applyThemeToDocument(themePreference)
  }, [themePreference])

  const syncUserAndTheme = useCallback((nextUser: AuthUserResponse | null) => {
    setUser(nextUser)
    if (nextUser?.theme_preference) {
      const normalized = normalizeThemePreference(nextUser.theme_preference)
      setThemePreference(normalized)
      applyThemeToDocument(normalized)
    }
  }, [])

  const checkSession = useCallback(async () => {
    setIsLoading(true)
    try {
      const currentUser = await apiClient.getCurrentUser()
      syncUserAndTheme(currentUser)
      setError(null)
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [syncUserAndTheme])

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  const login = useCallback(
    async (payload: LoginPayload): Promise<boolean> => {
      setError(null)
      try {
        const authenticatedUser = await apiClient.login(payload)
        syncUserAndTheme(authenticatedUser)
        return true
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message)
        } else {
          setError('Unable to reach gateway backend. Please try again.')
        }
        return false
      }
    },
    [syncUserAndTheme],
  )

  const setupInitialAdmin = useCallback(
    async (payload: SetupAdminPayload): Promise<boolean> => {
      setError(null)
      try {
        const authenticatedUser = await apiClient.setupInitialAdmin(payload)
        syncUserAndTheme(authenticatedUser)
        return true
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message)
        } else {
          setError('Unable to complete initial administrator setup. Please try again.')
        }
        return false
      }
    },
    [syncUserAndTheme],
  )

  const updateThemePreference = useCallback(
    async (theme: ThemePreference): Promise<void> => {
      const normalized = normalizeThemePreference(theme)
      setThemePreference(normalized)
      applyThemeToDocument(normalized)
      setUser((prev) =>
        prev ? { ...prev, theme_preference: normalized } : prev,
      )
      try {
        const updatedUser = await apiClient.updateUserPreferences({
          theme_preference: normalized,
        })
        syncUserAndTheme(updatedUser)
      } catch {
        // Keep immediate client-side theme change even if offline
      }
    },
    [syncUserAndTheme],
  )

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiClient.logout()
    } catch {
      // Clear client state even if server cookie expired
    } finally {
      setUser(null)
      setError(null)
    }
  }, [])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        error,
        themePreference,
        login,
        setupInitialAdmin,
        updateThemePreference,
        logout,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
