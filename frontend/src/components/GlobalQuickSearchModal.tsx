import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderKanban, Laptop, Search, ShieldAlert, X } from 'lucide-react'
import {
  apiClient,
  type DeviceListResponse,
  type GroupListResponse,
} from '../api/client'
import type { AppTab } from './AppLayout'

interface GlobalQuickSearchModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectTab?: (tab: AppTab) => void
}

interface SearchEntry {
  kind: 'tab' | 'device' | 'group'
  id: string
  label: string
  subtitle: string
  tab: AppTab
}

const TAB_ENTRIES: SearchEntry[] = [
  {
    kind: 'tab',
    id: 'devices',
    label: 'Devices & Groups',
    subtitle: 'Manage LAN devices, access control & YouTube filtering',
    tab: 'devices',
  },
  {
    kind: 'tab',
    id: 'schedules',
    label: 'Schedules',
    subtitle: 'Automated internet & YouTube recurring schedules',
    tab: 'schedules',
  },
  {
    kind: 'tab',
    id: 'analytics',
    label: 'Analytics',
    subtitle: 'Network traffic, top domains, and app watch telemetry',
    tab: 'analytics',
  },
  {
    kind: 'tab',
    id: 'firewall',
    label: 'Firewall & Security',
    subtitle: 'Inbound WAN ports, noisy scanners, and live packet log explorer',
    tab: 'firewall',
  },
  {
    kind: 'tab',
    id: 'status',
    label: 'System',
    subtitle: 'Service health, HA settings, users, backup & audit history',
    tab: 'status',
  },
]

const QuickSearchBody: React.FC<{
  onClose: () => void
  onSelectTab?: (tab: AppTab) => void
}> = ({ onClose, onSelectTab }) => {
  const [queryText, setQueryText] = useState('')
  const queryClient = useQueryClient()

  const { data: devicesData } = useQuery({
    queryKey: ['devices'],
    queryFn: () => apiClient.getDevices(),
    initialData: () => queryClient.getQueryData<DeviceListResponse>(['devices']),
    staleTime: 30_000,
  })

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: () => apiClient.getGroups(),
    initialData: () => queryClient.getQueryData<GroupListResponse>(['groups']),
    staleTime: 30_000,
  })

  const results = useMemo(() => {
    const q = queryText.trim().toLowerCase()
    const deviceEntries: SearchEntry[] = (devicesData?.devices ?? []).map((dev) => ({
      kind: 'device',
      id: String(dev.id),
      label: dev.effective_name,
      subtitle: `${dev.ipv4_address ?? 'No IP'} · ${dev.mac_address}${dev.vendor ? ` · ${dev.vendor}` : ''}`,
      tab: 'devices',
    }))
    const groupEntries: SearchEntry[] = (groupsData?.groups ?? []).map((grp) => ({
      kind: 'group',
      id: String(grp.id),
      label: grp.name,
      subtitle: grp.description || `${grp.total_devices} member device(s)`,
      tab: 'devices',
    }))
    const all = [...TAB_ENTRIES, ...deviceEntries, ...groupEntries]
    if (!q) {
      return all.slice(0, 12)
    }
    return all
      .filter(
        (entry) =>
          entry.label.toLowerCase().includes(q) ||
          entry.subtitle.toLowerCase().includes(q) ||
          entry.kind.includes(q),
      )
      .slice(0, 15)
  }, [queryText, devicesData, groupsData])

  const handleSelect = (entry: SearchEntry) => {
    onSelectTab?.(entry.tab)
    onClose()
  }

  return (
    <div
      data-testid="global-quick-search-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Global quick search"
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 px-4 pt-20 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-slate-800 px-4 py-3">
          <Search className="h-4 w-4 text-indigo-400 shrink-0" aria-hidden="true" />
          <input
            type="text"
            autoFocus
            data-testid="global-quick-search-input"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onClose()
              } else if (e.key === 'Enter' && results.length > 0) {
                e.preventDefault()
                handleSelect(results[0])
              }
            }}
            placeholder="Jump to tab, device name, IP, MAC, or group..."
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="button"
            data-testid="global-quick-search-close"
            aria-label="Close quick search"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800 p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/60">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-400">
              No matching tabs, devices, or groups found.
            </div>
          ) : (
            results.map((entry) => (
              <button
                key={`${entry.kind}-${entry.id}`}
                type="button"
                data-testid={`quick-search-result-${entry.kind}-${entry.id}`}
                onClick={() => handleSelect(entry)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-800/80 transition cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {entry.kind === 'device' ? (
                    <Laptop className="h-4 w-4 text-indigo-400 shrink-0" aria-hidden="true" />
                  ) : entry.kind === 'group' ? (
                    <FolderKanban
                      className="h-4 w-4 text-emerald-400 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-100">
                      {entry.label}
                    </div>
                    <div className="truncate text-[11px] text-slate-400 font-mono">
                      {entry.subtitle}
                    </div>
                  </div>
                </div>
                <span className="shrink-0 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-300">
                  {entry.kind}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export const GlobalQuickSearchModal: React.FC<GlobalQuickSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectTab,
}) => {
  if (!isOpen) {
    return null
  }
  return <QuickSearchBody onClose={onClose} onSelectTab={onSelectTab} />
}
