import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  Edit2,
  Globe,
  Laptop,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  X,
} from 'lucide-react'
import {
  apiClient,
  type DeviceItem,
  type DeviceStatusFilter,
} from '../api/client'
import { AppLayout, type AppTab } from '../components/AppLayout'

interface DevicesPageProps {
  activeTab?: AppTab
  onSelectTab?: (tab: AppTab) => void
}

export const DevicesPage: React.FC<DevicesPageProps> = ({
  activeTab = 'devices',
  onSelectTab,
}) => {
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<DeviceStatusFilter>('all')
  const [editingDeviceId, setEditingDeviceId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'error' | 'warning'
    text: string
  } | null>(null)
  const [pendingActionId, setPendingActionId] = useState<number | null>(null)

  const {
    data: deviceList,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['devices'],
    queryFn: () => apiClient.getDevices(),
    refetchInterval: 30_000,
  })

  const { data: healthReport } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: () => apiClient.getSystemHealth(),
    refetchInterval: 60_000,
  })

  const syncMutation = useMutation({
    mutationFn: () => apiClient.syncDevices(),
    onSuccess: (updated) => {
      queryClient.setQueryData(['devices'], updated)
      setBannerMessage(null)
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to sync devices from OPNsense.',
      })
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, display_name }: { id: number; display_name: string | null }) =>
      apiClient.updateDevice(id, { display_name }),
    onSuccess: () => {
      setEditingDeviceId(null)
      setEditingName('')
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update device name.',
      })
    },
  })

  const protectMutation = useMutation({
    mutationFn: ({ id, is_protected }: { id: number; is_protected: boolean }) =>
      apiClient.updateDevice(id, { is_protected }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update protection status.',
      })
    },
  })

  const accessMutation = useMutation({
    mutationFn: async ({
      device,
      action,
    }: {
      device: DeviceItem
      action: 'block' | 'unblock'
    }) => {
      setPendingActionId(device.id)
      try {
        if (action === 'block') {
          return await apiClient.blockDevice(device.id)
        }
        return await apiClient.unblockDevice(device.id)
      } finally {
        setPendingActionId(null)
      }
    },
    onSuccess: (result) => {
      if (result.warning) {
        setBannerMessage({
          type: 'warning',
          text: result.warning,
        })
      } else {
        setBannerMessage(null)
      }
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['systemHealth'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to change internet access state.',
      })
    },
  })

  const filteredDevices = useMemo(() => {
    const items = deviceList?.devices ?? []
    return items.filter((dev) => {
      if (statusFilter === 'online' && !dev.is_online) return false
      if (statusFilter === 'blocked' && !dev.is_blocked) return false
      if (statusFilter === 'protected' && !dev.is_protected) return false

      const q = searchTerm.trim().toLowerCase()
      if (!q) return true

      return (
        dev.effective_name.toLowerCase().includes(q) ||
        (dev.display_name && dev.display_name.toLowerCase().includes(q)) ||
        (dev.hostname && dev.hostname.toLowerCase().includes(q)) ||
        (dev.ipv4_address && dev.ipv4_address.toLowerCase().includes(q)) ||
        dev.mac_address.toLowerCase().includes(q) ||
        (dev.vendor && dev.vendor.toLowerCase().includes(q)) ||
        (dev.interface_name && dev.interface_name.toLowerCase().includes(q))
      )
    })
  }, [deviceList?.devices, searchTerm, statusFilter])

  const summary = deviceList?.summary ?? {
    total_devices: 0,
    online_devices: 0,
    blocked_devices: 0,
    protected_devices: 0,
  }

  const startEditing = (dev: DeviceItem) => {
    setEditingDeviceId(dev.id)
    setEditingName(dev.display_name ?? dev.hostname ?? '')
  }

  const submitRename = (deviceId: number) => {
    const cleaned = editingName.trim()
    renameMutation.mutate({
      id: deviceId,
      display_name: cleaned.length > 0 ? cleaned : null,
    })
  }

  const isImmutableProtection = (dev: DeviceItem): boolean => {
    if (!dev.protection_reason) return false
    return (
      dev.protection_reason.includes('OPNSENSE_PROTECTED_IPS') ||
      dev.protection_reason.includes('administrator session IP')
    )
  }

  return (
    <AppLayout
      overallStatus={healthReport?.overall_status}
      version={healthReport?.version}
      activeTab={activeTab}
      onSelectTab={onSelectTab}
    >
      <div className="space-y-6">
        {/* Page Header & Sync Button */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">
              Network Device Inventory &amp; Access Control
            </h1>
            <p className="text-sm text-slate-400">
              Manage internet access via OPNsense (`gateway_blocked_devices`) and assign friendly device nicknames
            </p>
          </div>

          <div className="flex items-center gap-3 self-start">
            {deviceList?.last_synced_at && (
              <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                Synced: {new Date(deviceList.last_synced_at).toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-indigo-500/40 bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{syncMutation.isPending ? 'Syncing OPNsense...' : 'Sync from OPNsense'}</span>
            </button>
          </div>
        </div>

        {/* Summary KPI Bar */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div
            data-testid="kpi-total"
            className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Total Discovered</span>
              <Laptop className="h-4 w-4 text-indigo-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-100">{summary.total_devices}</p>
          </div>

          <div
            data-testid="kpi-online"
            className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Online Now (ARP)</span>
              <Wifi className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-emerald-300">{summary.online_devices}</p>
          </div>

          <div
            data-testid="kpi-blocked"
            className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Internet Blocked</span>
              <ShieldAlert className="h-4 w-4 text-rose-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-rose-300">{summary.blocked_devices}</p>
          </div>

          <div
            data-testid="kpi-protected"
            className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Protected Guardrail</span>
              <ShieldCheck className="h-4 w-4 text-amber-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-bold text-amber-300">{summary.protected_devices}</p>
          </div>
        </div>

        {/* Alert / Warning Feedback Banner */}
        {(bannerMessage || isError) && (
          <div
            role="alert"
            className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-sm ${
              bannerMessage?.type === 'warning'
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
                    : 'Failed to load devices.'}
              </span>
            </div>
            {bannerMessage && (
              <button
                type="button"
                aria-label="Dismiss alert"
                onClick={() => setBannerMessage(null)}
                className="text-xs underline opacity-80 hover:opacity-100 cursor-pointer"
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        {/* Search & Filter Toolbar */}
        <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Search devices"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, hostname, IP, MAC, or vendor..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter devices by status">
            {(
              [
                { key: 'all', label: 'All' },
                { key: 'online', label: 'Online' },
                { key: 'blocked', label: 'Blocked' },
                { key: 'protected', label: 'Protected' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                data-testid={`filter-pill-${tab.key}`}
                onClick={() => setStatusFilter(tab.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                  statusFilter === tab.key
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-800 bg-slate-950/70 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Device Inventory Table */}
        {isLoading && !deviceList ? (
          <div
            data-testid="devices-loading"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-10 text-center text-sm text-slate-400"
          >
            Synchronizing network device inventory from OPNsense...
          </div>
        ) : filteredDevices.length === 0 ? (
          <div
            data-testid="devices-empty"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-10 text-center text-sm text-slate-400"
          >
            No devices match your current search or filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/80 shadow-xl">
            <table data-testid="devices-table" className="min-w-full divide-y divide-slate-800 text-left text-sm">
              <thead className="bg-slate-950/70 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-3.5">Device / Friendly Name</th>
                  <th scope="col" className="px-4 py-3.5">IPv4 &amp; MAC</th>
                  <th scope="col" className="px-4 py-3.5">Vendor &amp; Interface</th>
                  <th scope="col" className="px-4 py-3.5">Guardrail</th>
                  <th scope="col" className="px-4 py-3.5 text-right">Internet Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredDevices.map((dev) => {
                  const isEditing = editingDeviceId === dev.id
                  const immutableProt = isImmutableProtection(dev)
                  const isBusy = pendingActionId === dev.id

                  return (
                    <tr
                      key={dev.id}
                      data-testid={`device-row-${dev.id}`}
                      className="hover:bg-slate-800/40 transition"
                    >
                      {/* Column 1: Online Status + Name / Inline Rename */}
                      <td className="px-4 py-3.5 align-middle">
                        <div className="flex items-start gap-3">
                          <span
                            title={dev.is_online ? 'Online in ARP table' : 'Offline'}
                            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                              dev.is_online
                                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
                                : 'bg-slate-600'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  aria-label="Device nickname input"
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') submitRename(dev.id)
                                    if (e.key === 'Escape') setEditingDeviceId(null)
                                  }}
                                  className="w-44 rounded border border-indigo-500 bg-slate-950 px-2.5 py-1 text-xs text-slate-100 focus:outline-none"
                                  placeholder="Friendly nickname..."
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  aria-label="Save nickname"
                                  onClick={() => submitRename(dev.id)}
                                  className="rounded bg-emerald-600 p-1 text-white hover:bg-emerald-500 cursor-pointer"
                                >
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Cancel nickname edit"
                                  onClick={() => setEditingDeviceId(null)}
                                  className="rounded bg-slate-700 p-1 text-slate-200 hover:bg-slate-600 cursor-pointer"
                                >
                                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-100 truncate">
                                  {dev.effective_name}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Edit name for ${dev.effective_name}`}
                                  onClick={() => startEditing(dev)}
                                  className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
                                >
                                  <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            )}

                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                              {dev.hostname && dev.hostname !== dev.effective_name && (
                                <span className="font-mono text-slate-400">{dev.hostname}</span>
                              )}
                              <span className="rounded bg-slate-800/90 px-1.5 py-0.5 text-[10px] font-mono uppercase text-slate-300">
                                {dev.lease_type}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Column 2: IPv4 & MAC */}
                      <td className="px-4 py-3.5 align-middle font-mono text-xs">
                        <div className="font-semibold text-slate-200">
                          {dev.ipv4_address ?? 'No IPv4'}
                        </div>
                        <div className="text-slate-400">{dev.mac_address}</div>
                      </td>

                      {/* Column 3: Vendor & Interface */}
                      <td className="px-4 py-3.5 align-middle text-xs">
                        <div className="text-slate-200 truncate max-w-[180px]">
                          {dev.vendor ?? 'Unknown Vendor'}
                        </div>
                        {dev.interface_name && (
                          <span className="mt-0.5 inline-block rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
                            {dev.interface_name}
                          </span>
                        )}
                      </td>

                      {/* Column 4: Protection Guardrail */}
                      <td className="px-4 py-3.5 align-middle">
                        <button
                          type="button"
                          data-testid={`protect-toggle-${dev.id}`}
                          disabled={immutableProt || protectMutation.isPending}
                          title={
                            dev.protection_reason ??
                            'Click to toggle manual protection from blocking'
                          }
                          onClick={() =>
                            protectMutation.mutate({
                              id: dev.id,
                              is_protected: !dev.is_protected,
                            })
                          }
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                            dev.is_protected
                              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                              : 'border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                          } ${immutableProt ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          {immutableProt ? (
                            <Lock className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          )}
                          <span>{dev.is_protected ? 'Protected' : 'Standard'}</span>
                        </button>
                      </td>

                      {/* Column 5: Instant Internet Access Toggle */}
                      <td className="px-4 py-3.5 align-middle text-right">
                        {dev.is_protected ? (
                          <button
                            type="button"
                            data-testid={`access-toggle-${dev.id}`}
                            disabled
                            title={dev.protection_reason ?? 'Protected device cannot be blocked'}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs font-semibold text-slate-400 opacity-75 cursor-not-allowed"
                          >
                            <Lock className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                            <span>Always Allowed</span>
                          </button>
                        ) : dev.is_blocked ? (
                          <button
                            type="button"
                            data-testid={`access-toggle-${dev.id}`}
                            disabled={isBusy}
                            onClick={() =>
                              accessMutation.mutate({ device: dev, action: 'unblock' })
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-60 cursor-pointer"
                          >
                            <ShieldAlert className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
                            <span>{isBusy ? 'Updating...' : 'Blocked — Click to Allow'}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            data-testid={`access-toggle-${dev.id}`}
                            disabled={isBusy || !dev.ipv4_address}
                            onClick={() =>
                              accessMutation.mutate({ device: dev, action: 'block' })
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50 cursor-pointer"
                          >
                            <Globe className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                            <span>{isBusy ? 'Blocking...' : 'Allowed — Click to Block'}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

