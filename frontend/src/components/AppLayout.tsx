import React, { useEffect, useState } from 'react'
import {
  Activity,
  BarChart3,
  CalendarClock,
  Laptop,
  LogOut,
  Server,
  Shield,
  UserCheck,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { HealthLevel } from '../api/client'

export type AppTab = 'devices' | 'schedules' | 'analytics' | 'status'

interface AppLayoutProps {
  overallStatus?: HealthLevel
  version?: string
  activeTab?: AppTab
  onSelectTab?: (tab: AppTab) => void
  children: React.ReactNode
}

const STATUS_BADGE_STYLES: Record<HealthLevel, string> = {
  healthy: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  degraded: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  unhealthy: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  overallStatus,
  version,
  activeTab = 'devices',
  onSelectTab,
  children,
}) => {
  const { user, logout } = useAuth()
  const [systemClock, setSystemClock] = useState<string>(() =>
    new Date().toLocaleTimeString('en-GB', { hour12: false }),
  )

  useEffect(() => {
    const id = window.setInterval(() => {
      setSystemClock(new Date().toLocaleTimeString('en-GB', { hour12: false }))
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
                <Shield className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold tracking-tight text-slate-100">
                    OPNsense Gateway Control
                  </span>
                  {version && (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-mono text-slate-400">
                      v{version}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  OPNsense 26.7.7 &amp; Elasticsearch 9.4.3 Access &amp; Telemetry Portal
                </p>
              </div>
            </div>

            {onSelectTab && (
              <nav aria-label="Main navigation" className="hidden md:flex items-center gap-1.5 ml-6">
                <button
                  type="button"
                  data-testid="nav-tab-devices"
                  onClick={() => onSelectTab('devices')}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'devices'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                  }`}
                >
                  <Laptop className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Devices &amp; Access Control</span>
                </button>
                <button
                  type="button"
                  data-testid="nav-tab-schedules"
                  onClick={() => onSelectTab('schedules')}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'schedules'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                  }`}
                >
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Schedules &amp; Bedtime</span>
                </button>
                <button
                  type="button"
                  data-testid="nav-tab-analytics"
                  onClick={() => onSelectTab('analytics')}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'analytics'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                  }`}
                >
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Traffic &amp; DNS Analytics</span>
                </button>
                <button
                  type="button"
                  data-testid="nav-tab-status"
                  onClick={() => onSelectTab('status')}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'status'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                  }`}
                >
                  <Server className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>System Connectivity</span>
                </button>
              </nav>
            )}
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-3">
            {onSelectTab && (
              <div className="flex md:hidden items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onSelectTab('devices')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    activeTab === 'devices'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  Devices
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTab('schedules')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    activeTab === 'schedules'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  Schedules
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTab('analytics')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    activeTab === 'analytics'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  Analytics
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTab('status')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    activeTab === 'status'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  System
                </button>
              </div>
            )}

            {overallStatus && (
              <div
                data-testid="overall-health-badge"
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide ${STATUS_BADGE_STYLES[overallStatus]}`}
              >
                <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{overallStatus === 'unhealthy' ? 'DOWN' : overallStatus}</span>
              </div>
            )}

            {user && (
              <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-300">
                <UserCheck className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                <span>{user.username}</span>
              </div>
            )}

            <div className="flex flex-col items-end gap-0.5">
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Logout</span>
              </button>
              <span
                data-testid="header-system-clock"
                className="font-mono text-[11px] tracking-wider text-slate-400"
              >
                {systemClock}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
