import React, { useEffect, useState } from 'react'
import {
  Activity,
  BarChart3,
  CalendarClock,
  Check,
  ChevronDown,
  Laptop,
  LogOut,
  Palette,
  Server,
  ShieldAlert,
  UserCheck,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import type { HealthLevel, ThemePreference } from '../api/client'
import { UnicornLogo } from './UnicornLogo'

export type AppTab = 'devices' | 'schedules' | 'analytics' | 'firewall' | 'status'

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

const THEME_OPTIONS: {
  key: ThemePreference
  label: string
  description: string
  bgSwatch: string
  accentSwatch: string
}[] = [
  {
    key: 'default',
    label: 'Default Slate',
    description: 'Deep slate & soft indigo accents',
    bgSwatch: '#0f172a',
    accentSwatch: '#6366f1',
  },
  {
    key: 'crimson',
    label: 'Crimson & Obsidian',
    description: 'Soft light/dark red & black surfaces',
    bgSwatch: '#120a0d',
    accentSwatch: '#be3453',
  },
  {
    key: 'ocean',
    label: 'Ocean & Navy',
    description: 'Soft light/dark blue & deep navy',
    bgSwatch: '#091326',
    accentSwatch: '#2b7ad9',
  },
]

export const AppLayout: React.FC<AppLayoutProps> = ({
  overallStatus,
  version,
  activeTab = 'devices',
  onSelectTab,
  children,
}) => {
  const { user, themePreference, updateThemePreference, logout } = useAuth()
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
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
      <header className="relative z-30 border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
                <UnicornLogo className="h-6 w-6" testId="header-unicorn-logo" />
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
                  data-testid="nav-tab-firewall"
                  onClick={() => onSelectTab('firewall')}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    activeTab === 'firewall'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
                  }`}
                >
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Firewall &amp; Security</span>
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
                  onClick={() => onSelectTab('firewall')}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                    activeTab === 'firewall'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  Firewall
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
              <div className="relative">
                <button
                  type="button"
                  data-testid="header-user-menu-button"
                  aria-expanded={isUserMenuOpen}
                  aria-label="User settings and color theme menu"
                  onClick={() => setIsUserMenuOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-indigo-500/50 hover:bg-slate-800/80 transition cursor-pointer"
                >
                  <UserCheck className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                  <span>{user.username}</span>
                  <ChevronDown className="h-3 w-3 text-slate-400" aria-hidden="true" />
                </button>

                {isUserMenuOpen && (
                  <div
                    data-testid="header-user-menu-popover"
                    className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-700 bg-slate-900 p-3.5 shadow-2xl z-50 space-y-3"
                  >
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                      <div>
                        <div className="text-xs font-semibold text-slate-100">
                          {user.username}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          User Preferences &amp; View Theme
                        </div>
                      </div>
                      <span className="rounded bg-indigo-500/20 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-semibold uppercase text-indigo-300">
                        {user.role || 'admin'}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        <Palette className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                        <span>Color Theme</span>
                      </div>

                      <div className="space-y-1.5">
                        {THEME_OPTIONS.map((opt) => {
                          const isSelected = themePreference === opt.key
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              data-testid={`theme-option-${opt.key}`}
                              onClick={() => {
                                void updateThemePreference(opt.key)
                              }}
                              className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left transition cursor-pointer ${
                                isSelected
                                  ? 'border-indigo-500/60 bg-indigo-500/15 text-slate-100'
                                  : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700 hover:bg-slate-800/60'
                              }`}
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="inline-flex items-center rounded-md border border-slate-700 p-0.5">
                                  <span
                                    className="h-3.5 w-3.5 rounded-l-xs"
                                    style={{ backgroundColor: opt.bgSwatch }}
                                  />
                                  <span
                                    className="h-3.5 w-3.5 rounded-r-xs"
                                    style={{ backgroundColor: opt.accentSwatch }}
                                  />
                                </span>
                                <div>
                                  <div className="text-xs font-semibold">
                                    {opt.label}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {opt.description}
                                  </div>
                                </div>
                              </div>
                              {isSelected && (
                                <Check
                                  className="h-4 w-4 text-indigo-400 shrink-0"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
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
