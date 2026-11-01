import React, { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Search, Trash2, Users, X } from 'lucide-react'
import {
  apiClient,
  type DeviceItem,
  type GroupColor,
  type GroupItem,
} from '../api/client'

interface GroupFormModalProps {
  isOpen: boolean
  editingGroup: GroupItem | null
  allDevices: DeviceItem[]
  onClose: () => void
  onDeleted?: (deletedGroupId: number) => void
}

const COLOR_OPTIONS: { key: GroupColor; label: string; dotClass: string; badgeClass: string }[] = [
  {
    key: 'indigo',
    label: 'Indigo',
    dotClass: 'bg-indigo-400',
    badgeClass: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200',
  },
  {
    key: 'emerald',
    label: 'Emerald',
    dotClass: 'bg-emerald-400',
    badgeClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  },
  {
    key: 'amber',
    label: 'Amber',
    dotClass: 'bg-amber-400',
    badgeClass: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  },
  {
    key: 'rose',
    label: 'Rose',
    dotClass: 'bg-rose-400',
    badgeClass: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  },
  {
    key: 'cyan',
    label: 'Cyan',
    dotClass: 'bg-cyan-400',
    badgeClass: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200',
  },
  {
    key: 'violet',
    label: 'Violet',
    dotClass: 'bg-violet-400',
    badgeClass: 'border-violet-500/40 bg-violet-500/15 text-violet-200',
  },
  {
    key: 'slate',
    label: 'Slate',
    dotClass: 'bg-slate-400',
    badgeClass: 'border-slate-500/40 bg-slate-500/15 text-slate-200',
  },
]

export function getGroupBadgeClasses(color: string): string {
  const found = COLOR_OPTIONS.find((c) => c.key === color)
  return found ? found.badgeClass : COLOR_OPTIONS[0].badgeClass
}

export const GroupFormModal: React.FC<GroupFormModalProps> = ({
  isOpen,
  editingGroup,
  allDevices,
  onClose,
  onDeleted,
}) => {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [colorBadge, setColorBadge] = useState<GroupColor>('indigo')
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<number[]>([])
  const [memberSearch, setMemberSearch] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    if (editingGroup) {
      setName(editingGroup.name)
      setDescription(editingGroup.description ?? '')
      setColorBadge((editingGroup.color_badge as GroupColor) || 'indigo')
      setSelectedDeviceIds(editingGroup.member_device_ids ?? [])
    } else {
      setName('')
      setDescription('')
      setColorBadge('indigo')
      setSelectedDeviceIds([])
    }
    setMemberSearch('')
    setErrorMessage(null)
  }, [isOpen, editingGroup])

  const filteredDevices = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    if (!q) return allDevices
    return allDevices.filter(
      (d) =>
        d.effective_name.toLowerCase().includes(q) ||
        (d.ipv4_address && d.ipv4_address.toLowerCase().includes(q)) ||
        d.mac_address.toLowerCase().includes(q) ||
        (d.vendor && d.vendor.toLowerCase().includes(q)),
    )
  }, [allDevices, memberSearch])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanedName = name.trim()
      if (!cleanedName) {
        throw new Error('Group name is required.')
      }
      if (editingGroup) {
        return await apiClient.updateGroup(editingGroup.id, {
          name: cleanedName,
          description: description.trim(),
          color_badge: colorBadge,
          device_ids: selectedDeviceIds,
        })
      }
      return await apiClient.createGroup({
        name: cleanedName,
        description: description.trim(),
        color_badge: colorBadge,
        device_ids: selectedDeviceIds,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      onClose()
    },
    onError: (err: unknown) => {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save group.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!editingGroup) return
      await apiClient.deleteGroup(editingGroup.id)
      return editingGroup.id
    },
    onSuccess: (deletedId) => {
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      if (deletedId !== undefined && onDeleted) {
        onDeleted(deletedId)
      }
      onClose()
    },
    onError: (err: unknown) => {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete group.')
    },
  })

  if (!isOpen) return null

  const toggleDeviceSelection = (deviceId: number) => {
    setSelectedDeviceIds((prev) =>
      prev.includes(deviceId) ? prev.filter((id) => id !== deviceId) : [...prev, deviceId],
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={editingGroup ? `Edit Group ${editingGroup.name}` : 'Create Device Group'}
      data-testid="group-form-modal"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Users className="h-5 w-5 text-indigo-400" aria-hidden="true" />
            <h2 className="text-base font-bold text-slate-100">
              {editingGroup ? `Edit Profile: ${editingGroup.name}` : 'Create Device Group / Profile'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close group modal"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate()
          }}
          className="flex-1 space-y-5 overflow-y-auto p-6"
        >
          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
            >
              {errorMessage}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="group-name-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                Group / Profile Name *
              </label>
              <input
                id="group-name-input"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Kids Devices, Living Room Media"
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="group-desc-input"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                Description (Optional)
              </label>
              <input
                id="group-desc-input"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Phones, tablets, and consoles..."
                className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Color Badge Selector */}
          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
              Badge Color
            </span>
            <div className="mt-2 flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  data-testid={`group-color-${c.key}`}
                  onClick={() => setColorBadge(c.key)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                    colorBadge === c.key
                      ? `${c.badgeClass} ring-2 ring-indigo-400/60`
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${c.dotClass}`} />
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Member Devices Assignment */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Assigned Member Devices ({selectedDeviceIds.length} selected)
              </span>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDeviceIds(
                      Array.from(
                        new Set([...selectedDeviceIds, ...filteredDevices.map((d) => d.id)]),
                      ),
                    )
                  }
                  className="text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                >
                  Select All Shown
                </button>
                <span className="text-slate-600">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedDeviceIds([])}
                  className="text-slate-400 hover:text-slate-200 underline cursor-pointer"
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="relative mt-2">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Filter member devices"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Filter devices by name, IP, MAC, or vendor..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="mt-2 max-h-56 divide-y divide-slate-800/80 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60">
              {filteredDevices.length === 0 ? (
                <p className="p-4 text-center text-xs text-slate-500">
                  No devices match your filter.
                </p>
              ) : (
                filteredDevices.map((dev) => {
                  const isSelected = selectedDeviceIds.includes(dev.id)
                  return (
                    <label
                      key={dev.id}
                      data-testid={`group-member-option-${dev.id}`}
                      className={`flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs transition cursor-pointer ${
                        isSelected ? 'bg-indigo-500/10' : 'hover:bg-slate-900/70'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleDeviceSelection(dev.id)}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            dev.is_online ? 'bg-emerald-400' : 'bg-slate-600'
                          }`}
                        />
                        <div className="truncate">
                          <span className="font-semibold text-slate-100">
                            {dev.effective_name}
                          </span>
                          {dev.vendor && (
                            <span className="ml-2 text-slate-400">({dev.vendor})</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400 shrink-0">
                        <span>{dev.ipv4_address ?? 'No IP'}</span>
                        {dev.is_protected && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                            Protected
                          </span>
                        )}
                      </div>
                    </label>
                  )
                })
              )}
            </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-between border-t border-slate-800 pt-4">
            {editingGroup ? (
              <button
                type="button"
                data-testid="delete-group-btn"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-60 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{deleteMutation.isPending ? 'Deleting...' : 'Delete Group'}</span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="save-group-btn"
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {saveMutation.isPending
                    ? 'Saving...'
                    : editingGroup
                      ? 'Save Changes'
                      : 'Create Group'}
                </span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

