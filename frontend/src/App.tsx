import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LoginPage } from './pages/LoginPage'
import { StatusPage } from './pages/StatusPage'

const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})

export const AuthenticatedRouter: React.FC = () => {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div
        data-testid="auth-loading"
        className="min-h-screen flex items-center justify-center bg-slate-950 text-sm text-slate-400"
      >
        Verifying session...
      </div>
    )
  }

  if (!user?.authenticated) {
    return <LoginPage />
  }

  return <StatusPage />
}

export const App: React.FC<{ queryClient?: QueryClient }> = ({ queryClient }) => {
  const activeQueryClient = queryClient ?? defaultQueryClient
  return (
    <QueryClientProvider client={activeQueryClient}>
      <AuthProvider>
        <AuthenticatedRouter />
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App

