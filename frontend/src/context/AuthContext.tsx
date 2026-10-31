import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { apiClient, ApiError, type AuthUserResponse, type LoginPayload } from '../api/client'

interface AuthContextValue {
  user: AuthUserResponse | null
  isLoading: boolean
  error: string | null
  login: (payload: LoginPayload) => Promise<boolean>
  logout: () => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUserResponse | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const checkSession = useCallback(async () => {
    setIsLoading(true)
    try {
      const currentUser = await apiClient.getCurrentUser()
      setUser(currentUser)
      setError(null)
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  const login = useCallback(async (payload: LoginPayload): Promise<boolean> => {
    setError(null)
    try {
      const authenticatedUser = await apiClient.login(payload)
      setUser(authenticatedUser)
      return true
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError('Unable to reach gateway backend. Please try again.')
      }
      return false
    }
  }, [])

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
        login,
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

