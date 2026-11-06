import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Edit2,
  Laptop,
  Moon,
  PauseCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import { apiClient, formatClock24h, type ScheduleRule } from '../api/client'
import { AppLayout, type AppTab } from '../components/AppLayout'
import {
  ScheduleFormModal,
  WEEKDAY_LABELS,
  formatDaysSummary,
} from '../components/ScheduleFormModal'

interface SchedulesPageProps {
  activeTab?: AppTab
  onSelectTab?: (tab: AppTab) => void
}

export const SchedulesPage: React.FC<SchedulesPageProps> = ({
  activeTab = 'schedules',
  onSelectTab,
}) => {
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<ScheduleRule | null>(null)
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'info' | 'warning' | 'error'
    text: string
  } | null>(null)

  const {
    data: scheduleList,
    dataUpdatedAt: schedulesUpdatedAt,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => apiClient.getSchedules(),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  })

  const { data: groupList } = useQuery({
    queryKey: ['groups'],
    queryFn: () => apiClient.getGroups(),
    refetchInterval: 60_000,
  })

  const { data: deviceList } = useQuery({
    queryKey: ['devices'],
    queryFn: () => apiClient.getDevices(),
    refetchInterval: 60_000,
  })

  const { data: healthReport } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: () => apiClient.getSystemHealth(),
    refetchInterval: 60_000,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isEnabled }: { id: number; isEnabled: boolean }) =>
      apiClient.toggleSchedule(id, isEnabled),
    onSuccess: () => {
      setBannerMessage(null)
      void queryClient.invalidateQueries({ queryKey: ['schedules'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to toggle schedule rule.',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.deleteSchedule(id),
    onSuccess: () => {
      setBannerMessage(null)
      void queryClient.invalidateQueries({ queryKey: ['schedules'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete schedule rule.',
      })
    },
  })

  const reconcileMutation = useMutation({
    mutationFn: () => apiClient.reconcileSchedules(),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['schedules'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      if (res.warnings.length > 0) {
        setBannerMessage({ type: 'warning', text: res.warnings.join(' • ') })
      } else {
        setBannerMessage({
          type: 'info',
          text: `Policy reconciliation complete (${res.blocked_count} newly blocked, ${res.unblocked_count} restored, ${res.ip_drift_healed_count} IP drift updates).`,
        })
      }
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to reconcile schedules.',
      })
    },
  })

  const schedules = scheduleList?.schedules ?? []
  const activeCount = schedules.filter((s) => s.is_active_now).length
  const enabledCount = schedules.filter((s) => s.is_enabled).length
  const lastSchedulesClock = formatClock24h(schedulesUpdatedAt)

  const openCreateModal = () => {
    setEditingSchedule(null)
    setIsModalOpen(true)
  }

  const openEditModal = (rule: ScheduleRule) => {
    setEditingSchedule(rule)
    setIsModalOpen(true)
  }

  return (
    <AppLayout
      overallStatus={healthReport?.overall_status}
      version={healthReport?.version}
      activeTab={activeTab}
      onSelectTab={onSelectTab}
    >
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">
              Recurring Access Schedules &amp; Bedtime Rules
            </h1>
            <p className="text-sm text-slate-400">
              Automate daily and overnight internet blackouts for device groups or individual devices with 5-tier policy precedence
            </p>
          </div>

          <div className="flex flex-wrap items-start gap-2 self-start shrink-0">
            <div className="flex flex-col items-start sm:items-end gap-1">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="reconcile-schedules-btn"
                  onClick={() => reconcileMutation.mutate()}
                  disabled={reconcileMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      reconcileMutation.isPending ? 'animate-spin' : ''
                    }`}
                    aria-hidden="true"
                  />
                  <span>
                    {reconcileMutation.isPending
                      ? 'Evaluating...'
                      : 'Evaluate Policies Now'}
                  </span>
                </button>
              </div>
              {lastSchedulesClock && (
                <span
                  data-testid="schedules-last-updated"
                  className="text-[11px] font-mono text-slate-400"
                >
                  Updated: {lastSchedulesClock}
                </span>
              )}
            </div>

            <button
              type="button"
              data-testid="new-schedule-btn"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>New Schedule Rule</span>
            </button>
          </div>
        </div>

        {/* Summary KPI Bar */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            data-testid="schedules-kpi-total"
            className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Configured Schedules</span>
              <CalendarClock className="h-4 w-4 text-indigo-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-100">{schedules.length}</p>
          </div>

          <div
            data-testid="schedules-kpi-active"
            className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Active Window Now</span>
              <ShieldAlert className="h-4 w-4 text-rose-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-rose-300">{activeCount}</p>
          </div>

          <div
            data-testid="schedules-kpi-enabled"
            className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Enabled Rules</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-emerald-300">{enabledCount}</p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Policy Precedence Order</span>
              <ShieldCheck className="h-4 w-4 text-amber-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              1. Protected &rarr; 2. Bonus/Pause Timer &rarr; 3. Manual Block &rarr; 4. Schedule
              &rarr; 5. Allowed
            </p>
          </div>
        </div>

        {/* Feedback Banner */}
        {(bannerMessage || isError) && (
          <div
            role="alert"
            className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-sm ${
              bannerMessage?.type === 'info'
                ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200'
                : bannerMessage?.type === 'warning'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                {bannerMessage
                  ? bannerMessage.text
                  : error instanceof Error
                    ? error.message
                    : 'Failed to load schedules.'}
              </span>
            </div>
            {bannerMessage && (
              <button
                type="button"
                onClick={() => setBannerMessage(null)}
                className="text-xs underline opacity-80 hover:opacity-100 cursor-pointer"
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        {/* Schedule Cards Grid */}
        {isLoading && !scheduleList ? (
          <div
            data-testid="schedules-loading"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-10 text-center text-sm text-slate-400"
          >
            Loading recurring access schedules...
          </div>
        ) : schedules.length === 0 ? (
          <div
            data-testid="schedules-empty"
            className="rounded-xl border border-dashed border-slate-800 bg-slate-900/50 p-10 text-center"
          >
            <CalendarClock
              className="mx-auto h-8 w-8 text-indigo-400/80"
              aria-hidden="true"
            />
            <h2 className="mt-3 text-sm font-bold text-slate-200">
              No Recurring Schedules Configured
            </h2>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
              Create a recurring bedtime or study-hour rule (e.g., School Nights 21:00 to 07:00)
              for any device group or single device.
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Create First Schedule</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {schedules.map((rule) => {
              const isOvernight = rule.start_time > rule.end_time
              return (
                <div
                  key={rule.id}
                  data-testid={`schedule-card-${rule.id}`}
                  className={`flex flex-col justify-between rounded-xl border p-4 shadow transition ${
                    !rule.is_enabled
                      ? 'border-slate-800/80 bg-slate-900/40 opacity-75'
                      : rule.is_active_now
                        ? 'border-rose-500/50 bg-slate-900/90'
                        : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-100 truncate">
                            {rule.name}
                          </h3>
                          <span
                            data-testid={`schedule-status-${rule.id}`}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                              !rule.is_enabled
                                ? 'border-slate-700 bg-slate-800 text-slate-400'
                                : rule.is_active_now
                                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                                  : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            }`}
                          >
                            {!rule.is_enabled ? (
                              <>
                                <PauseCircle className="h-3 w-3" aria-hidden="true" />
                                <span>Disabled</span>
                              </>
                            ) : rule.is_active_now ? (
                              <>
                                <ShieldAlert className="h-3 w-3 text-rose-400" aria-hidden="true" />
                                <span>Active Now, Blocking until {rule.end_time}</span>
                              </>
                            ) : (
                              <>
                                <Clock className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                                <span>Standby</span>
                              </>
                            )}
                          </span>
                        </div>
                        {rule.description && (
                          <p className="mt-1 text-xs text-slate-400">{rule.description}</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          data-testid={`edit-schedule-${rule.id}`}
                          aria-label={`Edit schedule ${rule.name}`}
                          onClick={() => openEditModal(rule)}
                          className="rounded-lg border border-slate-800 bg-slate-950 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
                        >
                          <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          data-testid={`delete-schedule-card-${rule.id}`}
                          aria-label={`Delete schedule ${rule.name}`}
                          onClick={() => deleteMutation.mutate(rule.id)}
                          className="rounded-lg border border-slate-800 bg-slate-950 p-1.5 text-slate-400 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {/* Target & Time Window Row */}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 font-semibold text-indigo-200">
                        {rule.target_type === 'group' ? (
                          <Users className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                        ) : (
                          <Laptop className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                        )}
                        <span>
                          {rule.target_type === 'group' ? 'Group' : 'Device'}: {rule.target_name}
                        </span>
                      </span>

                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 font-mono font-semibold text-slate-200">
                        {isOvernight ? (
                          <Moon className="h-3.5 w-3.5 text-violet-400" aria-hidden="true" />
                        ) : (
                          <Clock className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                        )}
                        <span>
                          {rule.start_time} &rarr; {rule.end_time}
                        </span>
                        {isOvernight && (
                          <span className="text-[10px] font-sans text-violet-300">
                            (Overnight)
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Weekday Pills */}
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        {WEEKDAY_LABELS.map((item) => {
                          const activeDay = rule.days_of_week.includes(item.day)
                          return (
                            <span
                              key={item.day}
                              title={item.full}
                              className={`inline-flex h-6 w-7 items-center justify-center rounded text-[11px] font-bold ${
                                activeDay
                                  ? 'border border-indigo-500/50 bg-indigo-600/30 text-indigo-200'
                                  : 'border border-slate-800 bg-slate-950/60 text-slate-600'
                              }`}
                            >
                              {item.short.slice(0, 2)}
                            </span>
                          )
                        })}
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {formatDaysSummary(rule.days_of_week)}
                      </span>
                    </div>
                  </div>

                  {/* Card Footer: Enable / Disable Toggle */}
                  <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3 text-xs">
                    <span className="text-slate-400 font-mono text-[11px]">
                      TZ: {rule.timezone}
                    </span>
                    <button
                      type="button"
                      data-testid={`toggle-schedule-${rule.id}`}
                      disabled={toggleMutation.isPending}
                      onClick={() =>
                        toggleMutation.mutate({ id: rule.id, isEnabled: !rule.is_enabled })
                      }
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                        rule.is_enabled
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                          : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                      }`}
                    >
                      <span>{rule.is_enabled ? 'Disable Rule' : 'Enable Rule'}</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <ScheduleFormModal
          isOpen={isModalOpen}
          editingSchedule={editingSchedule}
          groups={groupList?.groups ?? []}
          devices={deviceList?.devices ?? []}
          onClose={() => setIsModalOpen(false)}
        />
      </div>
    </AppLayout>
  )
}

