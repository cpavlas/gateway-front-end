import React, { Suspense, lazy, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { type AppTab } from './components/AppLayout'
import { LoginPage } from './pages/LoginPage'

const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
)
const DevicesPage = lazy(() =>
  import('./pages/DevicesPage').then((m) => ({ default: m.DevicesPage })),
)
const FirewallPage = lazy(() =>
  import('./pages/FirewallPage').then((m) => ({ default: m.FirewallPage })),
)
const SchedulesPage = lazy(() =>
  import('./pages/SchedulesPage').then((m) => ({ default: m.SchedulesPage })),
)
const StatusPage = lazy(() =>
  import('./pages/StatusPage').then((m) => ({ default: m.StatusPage })),
)

const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})

const RouteLoadingFallback: React.FC = () => (
  <div
    data-testid="route-loading"
    className="min-h-screen flex items-center justify-center bg-slate-950 text-sm text-slate-400"
  >
    Loading view...
  </div>
)

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

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      {activeTab === 'schedules' ? (
        <SchedulesPage activeTab={activeTab} onSelectTab={setActiveTab} />
      ) : activeTab === 'analytics' ? (
        <AnalyticsPage activeTab={activeTab} onSelectTab={setActiveTab} />
      ) : activeTab === 'firewall' ? (
        <FirewallPage activeTab={activeTab} onSelectTab={setActiveTab} />
      ) : activeTab === 'status' ? (
        <StatusPage activeTab={activeTab} onSelectTab={setActiveTab} />
      ) : (
        <DevicesPage activeTab={activeTab} onSelectTab={setActiveTab} />
      )}
    </Suspense>
  )
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
