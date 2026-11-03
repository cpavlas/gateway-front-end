import React, { useState } from 'react'
import { AlertCircle, Lock, ShieldCheck, User } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export const LoginPage: React.FC = () => {
  const { login, error, clearError } = useAuth()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    clearError()
    setValidationError(null)

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
            Sign in with administrator credentials to manage OPNsense device access &amp; telemetry
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

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isSubmitting}
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
              Administrator Password
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
                placeholder="Enter password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-60 cursor-pointer"
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

