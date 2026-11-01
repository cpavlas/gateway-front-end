import React, { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Laptop, Moon, Trash2, Users, X } from 'lucide-react'
import {
  apiClient,
  type DeviceItem,
  type GroupItem,
  type OverrideTargetType,
  type ScheduleRule,
} from '../api/client'

export const WEEKDAY_LABELS: Array<{ day: number; short: string; full: string }> = [
  { day: 0, short: 'Mon', full: 'Monday' },
  { day: 1, short: 'Tue', full: 'Tuesday' },
  { day: 2, short: 'Wed', full: 'Wednesday' },
  { day: 3, short: 'Thu', full: 'Thursday' },
  { day: 4, short: 'Fri', full: 'Friday' },
  { day: 5, short: 'Sat', full: 'Saturday' },
  { day: 6, short: 'Sun', full: 'Sunday' },
]

export const DAY_PRESETS: Array<{ label: string; days: number[]; key: string }> = [
  { key: 'school_nights', label: 'School Nights (Sun–Thu)', days: [0, 1, 2, 3, 6] },
  { key: 'weekdays', label: 'Weekdays (Mon–Fri)', days: [0, 1, 2, 3, 4] },
  { key: 'weekends', label: 'Weekends (Fri–Sat)', days: [4, 5] },
  { key: 'every_day', label: 'Every Day', days: [0, 1, 2, 3, 4, 5, 6] },
]

export function formatDaysSummary(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  const key = sorted.join(',')
  if (key === '0,1,2,3,4,5,6') return 'Every Day'
  if (key === '0,1,2,3,6') return 'Sun–Thu (School Nights)'
  if (key === '0,1,2,3,4') return 'Mon–Fri (Weekdays)'
  if (key === '4,5') return 'Fri–Sat (Weekend Nights)'
  if (key === '5,6') return 'Sat–Sun (Weekends)'
  return sorted
    .map((d) => WEEKDAY_LABELS.find((item) => item.day === d)?.short ?? String(d))
    .join(', ')
}

interface ScheduleFormModalProps {
  isOpen: boolean
  editingSchedule: ScheduleRule | null
  groups: GroupItem[]
  devices: DeviceItem[]
  onClose: () => void
}

export const ScheduleFormModal: React.FC<ScheduleFormModalProps> = ({
  isOpen,
  editingSchedule,
  groups,
  devices,
  onClose,
}) => {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [targetType, setTargetType] = useState<OverrideTargetType>('group')
  const [selectedGroupId, setSelectedGroupId] = useState<number | ''>('')
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | ''>('')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([0, 1, 2, 3, 6])
  const [startTime, setStartTime] = useState('21:00')
  const [endTime, setEndTime] = useState('07:00')
  const [isEnabled, setIsEnabled] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const blockableDevices = devices.filter((d) => !d.is_protected)

  useEffect(() => {
    if (!isOpen) return
    setErrorMsg(null)
    if (editingSchedule) {
      setName(editingSchedule.name)
      setDescription(editingSchedule.description ?? '')
      setTargetType(editingSchedule.target_type)
      setSelectedGroupId(editingSchedule.group_id ?? '')
      setSelectedDeviceId(editingSchedule.device_id ?? '')
      setDaysOfWeek([...editingSchedule.days_of_week].sort((a, b) => a - b))
      setStartTime(editingSchedule.start_time)
      setEndTime(editingSchedule.end_time)
      setIsEnabled(editingSchedule.is_enabled)
    } else {
      setName('')
      setDescription('')
      if (groups.length > 0) {
        setTargetType('group')
        setSelectedGroupId(groups[0].id)
        setSelectedDeviceId(blockableDevices[0]?.id ?? '')
      } else {
        setTargetType('device')
        setSelectedGroupId('')
        setSelectedDeviceId(blockableDevices[0]?.id ?? '')
      }
      setDaysOfWeek([0, 1, 2, 3, 6])
      setStartTime('21:00')
      setEndTime('07:00')
      setIsEnabled(true)
    }
  }, [isOpen, editingSchedule, groups.length])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim()
      if (!trimmedName) {
        throw new Error('Schedule name is required.')
      }
      if (daysOfWeek.length === 0) {
        throw new Error('Select at least one day of the week.')
      }
      if (startTime === endTime) {
        throw new Error('Start time and end time cannot be identical.')
      }

      if (editingSchedule) {
        return await apiClient.updateSchedule(editingSchedule.id, {
          name: trimmedName,
          description: description.trim(),
          days_of_week: daysOfWeek,
          start_time: startTime,
          end_time: endTime,
          is_enabled: isEnabled,
        })
      }

      if (targetType === 'group') {
        if (!selectedGroupId) {
          throw new Error('Please select a target device group.')
        }
        return await apiClient.createSchedule({
          name: trimmedName,
          description: description.trim(),
          target_type: 'group',
          group_id: Number(selectedGroupId),
          days_of_week: daysOfWeek,
          start_time: startTime,
          end_time: endTime,
          is_enabled: isEnabled,
        })
      }

      if (!selectedDeviceId) {
        throw new Error('Please select a target device.')
      }
      return await apiClient.createSchedule({
        name: trimmedName,
        description: description.trim(),
        target_type: 'device',
        device_id: Number(selectedDeviceId),
        days_of_week: daysOfWeek,
        start_time: startTime,
        end_time: endTime,
        is_enabled: isEnabled,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedules'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      onClose()
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save schedule.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!editingSchedule) return
      await apiClient.deleteSchedule(editingSchedule.id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schedules'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      onClose()
    },
    onError: (err: unknown) => {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete schedule.')
    },
  })

  if (!isOpen) return null

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    )
  }

  const isOvernight = startTime > endTime

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editingSchedule ? `Edit Schedule ${editingSchedule.name}` : 'New Schedule Rule'}
      data-testid="schedule-form-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-500/15 text-indigo-400">
              <CalendarClock className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                {editingSchedule ? `Edit Schedule: ${editingSchedule.name}` : 'New Recurring Schedule / Bedtime Rule'}
              </h2>
              <p className="text-xs text-slate-400">
                Automatically block internet access during recurring daily or overnight windows
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close schedule modal"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate()
          }}
          className="mt-4 space-y-4"
        >
          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
            >
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="schedule-name-input"
                className="block text-xs font-semibold text-slate-300"
              >
                Rule Name
              </label>
              <input
                id="schedule-name-input"
                data-testid="schedule-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., School Night Bedtime"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label
                htmlFor="schedule-desc-input"
                className="block text-xs font-semibold text-slate-300"
              >
                Description (Optional)
              </label>
              <input
                id="schedule-desc-input"
                data-testid="schedule-desc-input"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Kids devices off at 9 PM"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Target Type & Target Selector */}
          {!editingSchedule ? (
            <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
              <span className="block text-xs font-semibold text-slate-300">
                Apply Schedule To
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="schedule-target-group"
                  onClick={() => setTargetType('group')}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                    targetType === 'group'
                      ? 'border-indigo-500 bg-indigo-600/25 text-indigo-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Device Group / Profile</span>
                </button>
                <button
                  type="button"
                  data-testid="schedule-target-device"
                  onClick={() => setTargetType('device')}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition cursor-pointer ${
                    targetType === 'device'
                      ? 'border-indigo-500 bg-indigo-600/25 text-indigo-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Laptop className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Single Device</span>
                </button>
              </div>

              {targetType === 'group' ? (
                <div>
                  <label
                    htmlFor="schedule-group-select"
                    className="block text-[11px] font-medium text-slate-400"
                  >
                    Target Group
                  </label>
                  <select
                    id="schedule-group-select"
                    data-testid="schedule-group-select"
                    value={selectedGroupId}
                    onChange={(e) =>
                      setSelectedGroupId(e.target.value ? Number(e.target.value) : '')
                    }
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Select a group...</option>
                    {groups.map((grp) => (
                      <option key={grp.id} value={grp.id}>
                        {grp.name} ({grp.total_devices} devices)
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="schedule-device-select"
                    className="block text-[11px] font-medium text-slate-400"
                  >
                    Target Device
                  </label>
                  <select
                    id="schedule-device-select"
                    data-testid="schedule-device-select"
                    value={selectedDeviceId}
                    onChange={(e) =>
                      setSelectedDeviceId(e.target.value ? Number(e.target.value) : '')
                    }
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Select a device...</option>
                    {blockableDevices.map((dev) => (
                      <option key={dev.id} value={dev.id}>
                        {dev.effective_name} ({dev.ipv4_address ?? dev.mac_address})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 text-xs text-slate-300">
              Target:{' '}
              <strong className="text-white">
                {editingSchedule.target_type === 'group' ? 'Group' : 'Device'} —{' '}
                {editingSchedule.target_name}
              </strong>
            </div>
          )}

          {/* Days of Week Picker & Presets */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-300">Active Days of Week</span>
              <div className="flex flex-wrap gap-1">
                {DAY_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    data-testid={`schedule-day-preset-${preset.key}`}
                    onClick={() => setDaysOfWeek(preset.days)}
                    className="rounded border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:border-indigo-500/50 hover:text-indigo-200 cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {WEEKDAY_LABELS.map((item) => {
                const isSelected = daysOfWeek.includes(item.day)
                return (
                  <button
                    key={item.day}
                    type="button"
                    data-testid={`schedule-day-btn-${item.day}`}
                    aria-pressed={isSelected}
                    onClick={() => toggleDay(item.day)}
                    className={`rounded-lg border py-2 text-xs font-bold transition cursor-pointer ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-600 text-white shadow-xs'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {item.short}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 24-Hour Time Window */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="schedule-start-time"
                className="block text-xs font-semibold text-slate-300"
              >
                Block Starts (24h)
              </label>
              <input
                id="schedule-start-time"
                data-testid="schedule-start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-slate-100 focus:border-indigo-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label
                htmlFor="schedule-end-time"
                className="block text-xs font-semibold text-slate-300"
              >
                Block Ends / Unblocks (24h)
              </label>
              <input
                id="schedule-end-time"
                data-testid="schedule-end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono text-slate-100 focus:border-indigo-500 focus:outline-none"
                required
              />
            </div>
          </div>

          {isOvernight && (
            <div className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <Moon className="h-3.5 w-3.5 shrink-0 text-violet-300" aria-hidden="true" />
              <span>
                Overnight window: blocks at <strong>{startTime}</strong> on each selected day and
                automatically restores internet at <strong>{endTime}</strong> the following morning.
              </span>
            </div>
          )}

          {/* Enable Toggle */}
          <label className="flex items-center gap-2.5 text-xs font-medium text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              data-testid="schedule-enabled-checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500"
            />
            <span>Enable schedule immediately</span>
          </label>

          <div className="flex items-center justify-between border-t border-slate-800 pt-4">
            {editingSchedule ? (
              <button
                type="button"
                data-testid="delete-schedule-btn"
                disabled={deleteMutation.isPending || saveMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{deleteMutation.isPending ? 'Deleting...' : 'Delete Rule'}</span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="save-schedule-btn"
                disabled={saveMutation.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
              >
                {saveMutation.isPending
                  ? 'Saving...'
                  : editingSchedule
                    ? 'Save Changes'
                    : 'Create Schedule'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

