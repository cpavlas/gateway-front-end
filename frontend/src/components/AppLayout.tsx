import React, { useEffect, useState } from 'react'
import {
  Activity,
  BarChart3,
  CalendarClock,
  Check,
  ChevronDown,
  KeyRound,
  Laptop,
  LogOut,
  Palette,
  Server,
  ShieldAlert,
  UserCheck,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiClient, type HealthLevel, type ThemePreference } from '../api/client'
import { GlobalQuickSearchModal } from './GlobalQuickSearchModal'
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
  {
    key: 'emerald',
    label: 'Emerald & Forest',
    description: 'Deep pine surfaces & soft mint accents',
    bgSwatch: '#081e15',
    accentSwatch: '#10b981',
  },
  {
    key: 'amber',
    label: 'Amber & Carbon',
    description: 'Warm carbon surfaces & soft gold accents',
    bgSwatch: '#1c1508',
    accentSwatch: '#f59e0b',
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
  const [isQuickSearchOpen, setIsQuickSearchOpen] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null)
  const [pwdError, setPwdError] = useState<string | null>(null)
  const [systemClock, setSystemClock] = useState<string>(() =>
    new Date().toLocaleTimeString('en-GB', { hour12: false }),
  )

  useEffect(() => {
    const id = window.setInterval(() => {
      setSystemClock(new Date().toLocaleTimeString('en-GB', { hour12: false }))
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setIsQuickSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwdError(null)
    setPwdSuccess(null)
    if (!currentPassword || !newPassword) {
      setPwdError('Current and new passwords are required.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwdError('New password and confirmation do not match.')
      return
    }
    setPwdSaving(true)
    try {
      const resp = await apiClient.changeOwnPassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      })
      setPwdSuccess(resp.message || 'Password updated successfully.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : 'Failed to update password.')
    } finally {
      setPwdSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="relative z-30 border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950/90 border-2 border-indigo-400/60 shadow-md shadow-indigo-500/10 text-indigo-400 shrink-0">
                <UnicornLogo className="h-8 w-8" testId="header-unicorn-logo" />
              </div>
              <div className="grid grid-cols-[auto_auto] items-center justify-items-start gap-x-2.5 gap-y-0.5">
                <span className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap leading-tight">
                  Gateway Control
                </span>
                {version ? (
                  <span className="inline-flex w-full items-center justify-center rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-mono tabular-nums text-slate-300 whitespace-nowrap leading-none">
                    v{version}
                  </span>
                ) : (
                  <span />
                )}
                <span className="text-xs text-slate-400 whitespace-nowrap leading-tight">
                  Access &amp; Telemetry Portal
                </span>
                <span
                  data-testid="header-system-clock"
                  className="inline-flex w-full items-center justify-center px-1.5 py-0.5 text-[11px] font-mono tabular-nums tracking-[0.1em] text-slate-300 whitespace-nowrap leading-none"
                >
                  {systemClock}
                </span>
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
                  <Laptop className="h-4.5 w-4.5" aria-hidden="true" />
                  <span>Devices</span>
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
                  <CalendarClock className="h-4.5 w-4.5" aria-hidden="true" />
                  <span>Schedules</span>
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
                  <BarChart3 className="h-4.5 w-4.5" aria-hidden="true" />
                  <span>Analytics</span>
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
                  <ShieldAlert className="h-4.5 w-4.5" aria-hidden="true" />
                  <span>Firewall</span>
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
                  <Server className="h-4.5 w-4.5" aria-hidden="true" />
                  <span>System</span>
                </button>
              </nav>
            )}
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-3">
            {overallStatus && (
              <button
                type="button"
                data-testid="overall-health-badge"
                onClick={() => onSelectTab?.('status')}
                title="View System Connectivity & Health"
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-wide transition hover:opacity-90 cursor-pointer ${STATUS_BADGE_STYLES[overallStatus]}`}
              >
                <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{overallStatus === 'unhealthy' ? 'DOWN' : overallStatus}</span>
              </button>
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
                    className="absolute right-0 mt-2 w-72 max-h-[80vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-3.5 shadow-2xl z-50 space-y-3"
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

                    <div className="border-t border-slate-800 pt-2.5 space-y-2">
                      <button
                        type="button"
                        data-testid="user-menu-change-password-toggle"
                        onClick={() => {
                          setShowChangePassword((prev) => !prev)
                          setPwdError(null)
                          setPwdSuccess(null)
                        }}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-2 text-xs font-semibold text-slate-200 hover:border-indigo-500/40 cursor-pointer"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <KeyRound className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                          <span>Change My Password</span>
                        </span>
                        <ChevronDown
                          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
                            showChangePassword ? 'rotate-180' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>

                      {showChangePassword && (
                        <form
                          onSubmit={(e) => {
                            void handlePasswordSubmit(e)
                          }}
                          className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/70 p-2.5"
                        >
                          <input
                            type="password"
                            data-testid="current-password-input"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Current password"
                            className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                          />
                          <input
                            type="password"
                            data-testid="new-password-input"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="New password (min 12 chars)"
                            className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                          />
                          <input
                            type="password"
                            data-testid="confirm-password-input"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm new password"
                            className="w-full rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                          />
                          {pwdError && (
                            <p
                              data-testid="change-password-error"
                              className="text-[11px] text-rose-300"
                            >
                              {pwdError}
                            </p>
                          )}
                          {pwdSuccess && (
                            <p
                              data-testid="change-password-success"
                              className="text-[11px] text-emerald-300"
                            >
                              {pwdSuccess}
                            </p>
                          )}
                          <button
                            type="submit"
                            data-testid="submit-change-password-btn"
                            disabled={pwdSaving}
                            className="w-full rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
                          >
                            {pwdSaving ? 'Updating...' : 'Update Password'}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-8 pb-20 sm:px-6 md:pb-8 lg:px-8">
        {children}
      </main>

      {onSelectTab && (
        <nav
          data-testid="mobile-bottom-nav"
          aria-label="Mobile navigation"
          className="md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 border-t border-slate-800 bg-slate-900/95 backdrop-blur px-1 py-1.5"
        >
          <button
            type="button"
            data-testid="mobile-nav-tab-devices"
            onClick={() => onSelectTab('devices')}
            className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[10px] font-semibold ${
              activeTab === 'devices' ? 'text-indigo-300 bg-indigo-500/15' : 'text-slate-400'
            }`}
          >
            <Laptop className="h-4 w-4" aria-hidden="true" />
            <span>Devices</span>
          </button>
          <button
            type="button"
            data-testid="mobile-nav-tab-schedules"
            onClick={() => onSelectTab('schedules')}
            className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[10px] font-semibold ${
              activeTab === 'schedules' ? 'text-indigo-300 bg-indigo-500/15' : 'text-slate-400'
            }`}
          >
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            <span>Schedules</span>
          </button>
          <button
            type="button"
            data-testid="mobile-nav-tab-analytics"
            onClick={() => onSelectTab('analytics')}
            className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[10px] font-semibold ${
              activeTab === 'analytics' ? 'text-indigo-300 bg-indigo-500/15' : 'text-slate-400'
            }`}
          >
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            <span>Analytics</span>
          </button>
          <button
            type="button"
            data-testid="mobile-nav-tab-firewall"
            onClick={() => onSelectTab('firewall')}
            className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[10px] font-semibold ${
              activeTab === 'firewall' ? 'text-indigo-300 bg-indigo-500/15' : 'text-slate-400'
            }`}
          >
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            <span>Firewall</span>
          </button>
          <button
            type="button"
            data-testid="mobile-nav-tab-status"
            onClick={() => onSelectTab('status')}
            className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[10px] font-semibold ${
              activeTab === 'status' ? 'text-indigo-300 bg-indigo-500/15' : 'text-slate-400'
            }`}
          >
            <Server className="h-4 w-4" aria-hidden="true" />
            <span>System</span>
          </button>
        </nav>
      )}

      <GlobalQuickSearchModal
        isOpen={isQuickSearchOpen}
        onClose={() => setIsQuickSearchOpen(false)}
        onSelectTab={onSelectTab}
      />
    </div>
  )
}
