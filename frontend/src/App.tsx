import React, { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { type AppTab } from './components/AppLayout'
import { DevicesPage } from './pages/DevicesPage'
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

export const AuthenticatedRouter: React.FC<{ initialTab?: AppTab }> = ({
  initialTab = 'devices',
}) => {
  const { user, isLoading } = useAuth()
  const [activeTab, setActiveTab] = useState<AppTab>(initialTab)

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

  if (activeTab === 'status') {
    return <StatusPage activeTab={activeTab} onSelectTab={setActiveTab} />
  }

  return <DevicesPage activeTab={activeTab} onSelectTab={setActiveTab} />
}

export const App: React.FC<{
  queryClient?: QueryClient
  initialTab?: AppTab
}> = ({ queryClient, initialTab = 'devices' }) => {
  const activeQueryClient = queryClient ?? defaultQueryClient
  return (
    <QueryClientProvider client={activeQueryClient}>
      <AuthProvider>
        <AuthenticatedRouter initialTab={initialTab} />
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
