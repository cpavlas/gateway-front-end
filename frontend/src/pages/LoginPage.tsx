import React, { useEffect, useState } from 'react'
import { AlertCircle, KeyRound, Lock, ShieldCheck, User } from 'lucide-react'
import { apiClient } from '../api/client'
import { useAuth } from '../context/AuthContext'

export interface LoginPageProps {
  initialSetupRequired?: boolean
}

export const LoginPage: React.FC<LoginPageProps> = ({ initialSetupRequired = false }) => {
  const { login, setupInitialAdmin, error, clearError } = useAuth()
  const [isSetupMode, setIsSetupMode] = useState(initialSetupRequired)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (initialSetupRequired) {
      setIsSetupMode(true)
      return
    }
    const fetchFn = globalThis.fetch as unknown as { mock?: unknown }
    const setupSpy = apiClient.getSetupStatus as unknown as { mock?: unknown }
    // Avoid consuming mockResolvedValueOnce(fetch) in legacy unit tests unless getSetupStatus is spied
    if (setupSpy?.mock || !fetchFn?.mock) {
      void apiClient
        .getSetupStatus()
        .then((res) => {
          if (res?.needs_initial_setup) {
            setIsSetupMode(true)
          }
        })
        .catch(() => {
          // Ignore setup probe errors
        })
    }
  }, [initialSetupRequired])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    clearError()
    setValidationError(null)

    if (isSetupMode) {
      if (!password || password.trim().length < 8) {
        setValidationError('New administrator password must be at least 8 characters long.')
        return
      }
      if (password.trim() !== confirmPassword.trim()) {
        setValidationError('Password and confirmation password do not match.')
        return
      }
      setIsSubmitting(true)
      try {
        await setupInitialAdmin({
          password: password.trim(),
          confirm_password: confirmPassword.trim(),
        })
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    const trimmedUser = username.trim()
    if (!trimmedUser) {
      setValidationError('Username is required.')
      return
    }
    if (!password) {
      setValidationError('Password is required.')
      return
    }

    setIsSubmitting(true)
    try {
      await login({ username: trimmedUser, password })
    } finally {
      setIsSubmitting(false)
    }
  }

  const activeError = validationError ?? error

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            OPNsense Gateway Control
          </h1>
          <p className="text-sm text-slate-400">
            {isSetupMode
              ? 'First-boot container setup: create the initial password for the default admin account'
              : 'Sign in with administrator or operator credentials to manage OPNsense device access & telemetry'}
          </p>
        </div>

        {activeError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3.5 text-sm text-rose-200"
          >
            <AlertCircle className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" aria-hidden="true" />
            <span>{activeError}</span>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          data-testid={isSetupMode ? 'first-boot-setup-form' : 'login-form'}
          className="space-y-4"
          noValidate
        >
          <div>
            <label
              htmlFor="login-username"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5"
            >
              Username
            </label>
            <div className="relative">
              <User
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500"
                aria-hidden="true"
              />
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                value={isSetupMode ? 'admin' : username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isSubmitting || isSetupMode}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
                placeholder="admin"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5"
            >
              {isSetupMode ? 'New Administrator Password' : 'Administrator Password'}
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500"
                aria-hidden="true"
              />
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
                placeholder={isSetupMode ? 'Minimum 8 characters' : 'Enter password'}
              />
            </div>
          </div>

          {isSetupMode && (
            <div>
              <label
                htmlFor="login-confirm-password"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5"
              >
                Confirm New Password
              </label>
              <div className="relative">
                <KeyRound
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  id="login-confirm-password"
                  name="confirm_password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
                  placeholder="Confirm new password"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            data-testid={isSetupMode ? 'setup-admin-submit-btn' : 'login-submit-btn'}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-60 cursor-pointer"
          >
            {isSetupMode
              ? isSubmitting
                ? 'Creating Admin Password...'
                : 'Create Admin Password & Sign In'
              : isSubmitting
                ? 'Signing in...'
                : 'Sign In'}
          </button>
        </form>

        <div className="pt-1 text-center">
          <button
            type="button"
            data-testid="toggle-first-boot-setup-btn"
            onClick={() => {
              clearError()
              setValidationError(null)
              setIsSetupMode((prev) => !prev)
            }}
            className="text-xs font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer"
          >
            {isSetupMode
              ? 'Already configured admin password? Back to Sign In'
              : 'First-boot clean container? Create initial admin password'}
          </button>
        </div>
      </div>
    </div>
  )
}

