import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Edit2,
  Filter,
  Globe,
  Laptop,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
  Wifi,
  X,
} from 'lucide-react'
import {
  apiClient,
  type DeviceItem,
  type DeviceStatusFilter,
  type GroupItem,
  type TimerStartPayload,
} from '../api/client'
import { AppLayout, type AppTab } from '../components/AppLayout'
import { AutoRefreshSelector, useAutoRefresh } from '../components/AutoRefreshSelector'
import { DeviceAnalyticsDrawer } from '../components/DeviceAnalyticsDrawer'
import { GroupAnalyticsDrawer } from '../components/GroupAnalyticsDrawer'
import { GroupFormModal, getGroupBadgeClasses } from '../components/GroupFormModal'
import { TimerPopoverMenu } from '../components/TimerPopoverMenu'
import { YouTubeLogoIcon } from '../components/YouTubeLogoIcon'

interface DevicesPageProps {
  activeTab?: AppTab
  onSelectTab?: (tab: AppTab) => void
}

export function formatSyncClock24h(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp)
  if (Number.isNaN(parsed.getTime())) {
    return isoTimestamp
  }
  return parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

type DeviceSortField = 'name' | 'ipv4' | 'online' | 'vendor' | 'status'
type SortDirection = 'asc' | 'desc'

const GROUPS_COLLAPSED_STORAGE_KEY = 'gateway_devices_groups_collapsed'
const DEVICES_STATUS_FILTER_STORAGE_KEY = 'gateway_devices_status_filter'
const VALID_DEVICE_STATUS_FILTERS: readonly DeviceStatusFilter[] = [
  'all',
  'online',
  'blocked',
  'protected',
  'unassigned',
  'archived',
]

function parseIpv4Sortable(ip: string | null): number {
  if (!ip) return Number.MAX_SAFE_INTEGER
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return Number.MAX_SAFE_INTEGER
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

export const DevicesPage: React.FC<DevicesPageProps> = ({
  activeTab = 'devices',
  onSelectTab,
}) => {
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<DeviceStatusFilter>(() => {
    try {
      const saved = window.localStorage.getItem(DEVICES_STATUS_FILTER_STORAGE_KEY)
      if (saved && VALID_DEVICE_STATUS_FILTERS.includes(saved as DeviceStatusFilter)) {
        return saved as DeviceStatusFilter
      }
      return 'online'
    } catch {
      return 'online'
    }
  })
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [sortField, setSortField] = useState<DeviceSortField>('name')
  const [sortDir, setSortDir] = useState<SortDirection>('asc')
  const [isGroupsCollapsed, setIsGroupsCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(GROUPS_COLLAPSED_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [openQuickGroupDeviceId, setOpenQuickGroupDeviceId] = useState<number | null>(null)
  const [editingDeviceId, setEditingDeviceId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'error' | 'warning'
    text: string
  } | null>(null)
  const [pendingActionId, setPendingActionId] = useState<number | null>(null)
  const [pendingGroupActionId, setPendingGroupActionId] = useState<number | null>(null)
  const [selectedAnalyticsDeviceId, setSelectedAnalyticsDeviceId] = useState<number | null>(null)
  const [selectedAnalyticsGroupId, setSelectedAnalyticsGroupId] = useState<number | null>(null)
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<GroupItem | null>(null)
  const { intervalOption, setIntervalOption, refetchInterval } = useAutoRefresh('30s')

  const isViewingArchived = statusFilter === 'archived'

  const {
    data: deviceList,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: isViewingArchived ? ['devices', 'archived'] : ['devices'],
    queryFn: () =>
      isViewingArchived ? apiClient.getDevices({ status: 'archived' }) : apiClient.getDevices(),
    refetchInterval,
    placeholderData: (previousData) => previousData,
  })

  const { data: groupList } = useQuery({
    queryKey: ['groups'],
    queryFn: () => apiClient.getGroups(),
    refetchInterval,
    placeholderData: (previousData) => previousData,
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
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
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
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
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
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
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
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['systemHealth'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to change internet access state.',
      })
    },
  })

  const groupAccessMutation = useMutation({
    mutationFn: async ({
      group,
      action,
    }: {
      group: GroupItem
      action: 'block' | 'unblock'
    }) => {
      setPendingGroupActionId(group.id)
      try {
        if (action === 'block') {
          return await apiClient.blockGroup(group.id)
        }
        return await apiClient.unblockGroup(group.id)
      } finally {
        setPendingGroupActionId(null)
      }
    },
    onSuccess: (result) => {
      if (result.warnings && result.warnings.length > 0) {
        setBannerMessage({
          type: 'warning',
          text: result.warnings.join(' • '),
        })
      } else {
        setBannerMessage(null)
      }
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['systemHealth'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to change group internet access.',
      })
    },
  })

  const deviceYoutubeMutation = useMutation({
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
          return await apiClient.blockDeviceYoutube(device.id)
        }
        return await apiClient.unblockDeviceYoutube(device.id)
      } finally {
        setPendingActionId(null)
      }
    },
    onSuccess: () => {
      setBannerMessage(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to change YouTube access state.',
      })
    },
  })

  const groupYoutubeMutation = useMutation({
    mutationFn: async ({
      group,
      action,
    }: {
      group: GroupItem
      action: 'block' | 'unblock'
    }) => {
      setPendingGroupActionId(group.id)
      try {
        if (action === 'block') {
          return await apiClient.blockGroupYoutube(group.id)
        }
        return await apiClient.unblockGroupYoutube(group.id)
      } finally {
        setPendingGroupActionId(null)
      }
    },
    onSuccess: () => {
      setBannerMessage(null)
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to change group YouTube state.',
      })
    },
  })

  const deviceTimerMutation = useMutation({
    mutationFn: ({ deviceId, payload }: { deviceId: number; payload: TimerStartPayload }) =>
      apiClient.startDeviceTimer(deviceId, payload),
    onSuccess: () => {
      setBannerMessage(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to start device timer.',
      })
    },
  })

  const groupTimerMutation = useMutation({
    mutationFn: ({ groupId, payload }: { groupId: number; payload: TimerStartPayload }) =>
      apiClient.startGroupTimer(groupId, payload),
    onSuccess: () => {
      setBannerMessage(null)
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to start group timer.',
      })
    },
  })

  const cancelTimerMutation = useMutation({
    mutationFn: (overrideId: number) => apiClient.cancelTimer(overrideId, true),
    onSuccess: () => {
      setBannerMessage(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to cancel active timer.',
      })
    },
  })

  const quickGroupsMutation = useMutation({
    mutationFn: ({ deviceId, groupIds }: { deviceId: number; groupIds: number[] }) =>
      apiClient.updateDevice(deviceId, { group_ids: groupIds }),
    onSuccess: () => {
      setBannerMessage(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update device groups.',
      })
    },
  })

  const archiveDeviceMutation = useMutation({
    mutationFn: async ({ deviceId, action }: { deviceId: number; action: 'archive' | 'restore' }) =>
      action === 'archive' ? apiClient.archiveDevice(deviceId) : apiClient.restoreDevice(deviceId),
    onSuccess: () => {
      setBannerMessage(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to archive or restore device.',
      })
    },
  })

  const deleteDeviceMutation = useMutation({
    mutationFn: (deviceId: number) => apiClient.deleteDevice(deviceId),
    onSuccess: () => {
      setBannerMessage(null)
      void queryClient.invalidateQueries({ queryKey: ['devices'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (err: unknown) => {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete offline device.',
      })
    },
  })

  const handleStatusFilterChange = (nextFilter: DeviceStatusFilter) => {
    setStatusFilter(nextFilter)
    try {
      window.localStorage.setItem(DEVICES_STATUS_FILTER_STORAGE_KEY, nextFilter)
    } catch {
      // Ignore storage errors
    }
  }

  const toggleGroupsCollapsed = () => {
    setIsGroupsCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(GROUPS_COLLAPSED_STORAGE_KEY, String(next))
      } catch {
        // Ignore storage errors
      }
      return next
    })
  }

  const toggleSort = (field: DeviceSortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const groups = groupList?.groups ?? []
  const activeFilterGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  )

  const filteredDevices = useMemo(() => {
    const items = deviceList?.devices ?? []
    const filtered = items.filter((dev) => {
      const devGroups = dev.groups ?? []
      if (statusFilter === 'online' && !dev.is_online) return false
      if (statusFilter === 'blocked' && !dev.is_blocked && !dev.is_youtube_blocked) return false
      if (statusFilter === 'protected' && !dev.is_protected) return false
      if (statusFilter === 'unassigned' && devGroups.length > 0) return false
      if (statusFilter === 'archived' && !dev.is_archived) return false
      if (statusFilter !== 'archived' && dev.is_archived) return false

      if (selectedGroupId !== null && !devGroups.some((g) => g.id === selectedGroupId)) {
        return false
      }

      const q = searchTerm.trim().toLowerCase()
      if (!q) return true

      return (
        dev.effective_name.toLowerCase().includes(q) ||
        (dev.display_name && dev.display_name.toLowerCase().includes(q)) ||
        (dev.hostname && dev.hostname.toLowerCase().includes(q)) ||
        (dev.ipv4_address && dev.ipv4_address.toLowerCase().includes(q)) ||
        dev.mac_address.toLowerCase().includes(q) ||
        (dev.vendor && dev.vendor.toLowerCase().includes(q)) ||
        (dev.interface_name && dev.interface_name.toLowerCase().includes(q)) ||
        devGroups.some((g) => g.name.toLowerCase().includes(q))
      )
    })

    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') {
        cmp = a.effective_name.localeCompare(b.effective_name, undefined, { sensitivity: 'base' })
      } else if (sortField === 'ipv4') {
        cmp = parseIpv4Sortable(a.ipv4_address) - parseIpv4Sortable(b.ipv4_address)
      } else if (sortField === 'online') {
        cmp = (b.is_online ? 1 : 0) - (a.is_online ? 1 : 0)
        if (cmp === 0) {
          cmp = a.effective_name.localeCompare(b.effective_name, undefined, { sensitivity: 'base' })
        }
      } else if (sortField === 'vendor') {
        cmp = (a.vendor ?? '').localeCompare(b.vendor ?? '', undefined, { sensitivity: 'base' })
      } else if (sortField === 'status') {
        const rank = (d: DeviceItem) => (d.is_protected ? 0 : d.is_blocked ? 1 : d.is_youtube_blocked ? 2 : 3)
        cmp = rank(a) - rank(b)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return sorted
  }, [deviceList?.devices, searchTerm, statusFilter, selectedGroupId, sortField, sortDir])

  const summary = deviceList?.summary ?? {
    total_devices: 0,
    online_devices: 0,
    blocked_devices: 0,
    protected_devices: 0,
    archived_devices: 0,
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

  const openCreateGroupModal = () => {
    setEditingGroup(null)
    setIsGroupModalOpen(true)
  }

  const openEditGroupModal = (group: GroupItem) => {
    setEditingGroup(group)
    setIsGroupModalOpen(true)
  }

  return (
    <AppLayout
      overallStatus={healthReport?.overall_status}
      version={healthReport?.version}
      activeTab={activeTab}
      onSelectTab={onSelectTab}
    >
      <div className="space-y-6">
        {/* Page Header & Sync Button (FB-P5-008 & FB-P5-009) */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">
              Network Device Inventory &amp; Access Control
            </h1>
            <p className="text-sm text-slate-400">
              Manage internet access via OPNsense, organize profiles &amp; groups, and inspect per-device or per-group usage &amp; DNS domains
            </p>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-1 self-start shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="sync-devices-btn"
                aria-label="Sync from OPNsense"
                title="Sync from OPNsense"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-500/40 bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60 cursor-pointer shrink-0"
              >
                <RefreshCw
                  className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
              </button>
              <AutoRefreshSelector
                value={intervalOption}
                onChange={setIntervalOption}
                testId="devices-auto-refresh-select"
              />
            </div>
            {deviceList?.last_synced_at && (
              <span
                data-testid="last-synced-clock"
                className="text-[11px] text-slate-400 font-mono whitespace-nowrap"
              >
                Synced: {formatSyncClock24h(deviceList.last_synced_at)}
              </span>
            )}
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

        {/* Device Groups / Profiles Section */}
        <section
          data-testid="groups-section"
          className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 shadow"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                data-testid="toggle-groups-section-btn"
                aria-expanded={!isGroupsCollapsed}
                aria-label={
                  isGroupsCollapsed
                    ? 'Expand Device Groups & Profiles'
                    : 'Collapse Device Groups & Profiles'
                }
                onClick={toggleGroupsCollapsed}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-950/70 text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
              >
                {isGroupsCollapsed ? (
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <Users className="h-4 w-4 text-indigo-400 shrink-0" aria-hidden="true" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-100">
                    Device Groups &amp; Profiles ({groups.length})
                  </h2>
                  {isGroupsCollapsed && activeFilterGroup && (
                    <span className="rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[11px] font-semibold text-indigo-200">
                      Filtered: {activeFilterGroup.name}
                    </span>
                  )}
                </div>
                {!isGroupsCollapsed && (
                  <p className="text-xs text-slate-400">
                    Group related devices (e.g., Kids Devices, Media, IoT) for one-click bulk internet control and combined usage analytics
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              data-testid="new-group-btn"
              onClick={openCreateGroupModal}
              className="inline-flex items-center gap-1.5 self-start rounded-lg border border-indigo-500/40 bg-indigo-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>New Group / Profile</span>
            </button>
          </div>

          {!isGroupsCollapsed &&
            (groups.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 p-4 text-center text-xs text-slate-400">
                No device groups created yet. Click <strong>New Group / Profile</strong> to create a group and assign devices.
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {groups.map((grp) => {
                  const isGroupBusy = pendingGroupActionId === grp.id
                  const isFilterSelected = selectedGroupId === grp.id
                  return (
                    <div
                      key={grp.id}
                      data-testid={`group-card-${grp.id}`}
                      className={`flex flex-col justify-between rounded-xl border p-3.5 transition ${isFilterSelected
                        ? 'border-indigo-500 bg-indigo-950/20'
                        : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                        }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${getGroupBadgeClasses(
                                  grp.color_badge,
                                )}`}
                              >
                                {grp.name}
                              </span>
                              <span
                                data-testid={`group-status-${grp.id}`}
                                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${grp.access_status === 'blocked'
                                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                                  : grp.access_status === 'partially_blocked'
                                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                                    : grp.access_status === 'allowed'
                                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                      : 'border-slate-700 bg-slate-800 text-slate-400'
                                  }`}
                              >
                                {grp.access_status === 'blocked'
                                  ? 'Blocked'
                                  : grp.access_status === 'partially_blocked'
                                    ? 'Partially Blocked'
                                    : grp.access_status === 'allowed'
                                      ? 'Allowed'
                                      : 'Empty'}
                              </span>
                              {grp.active_schedule && (
                                <span
                                  data-testid={`group-schedule-badge-${grp.id}`}
                                  className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-200"
                                >
                                  <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
                                  <span>
                                    {grp.active_schedule.name} (until {grp.active_schedule.end_time})
                                  </span>
                                </span>
                              )}
                            </div>
                            {grp.description && (
                              <p className="mt-1 text-xs text-slate-400 truncate">
                                {grp.description}
                              </p>
                            )}
                          </div>

                          <button
                            type="button"
                            data-testid={`group-edit-btn-${grp.id}`}
                            aria-label={`Edit group ${grp.name}`}
                            onClick={() => openEditGroupModal(grp)}
                            className="rounded-lg border border-slate-800 bg-slate-900 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
                          >
                            <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>

                        <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                          <span>
                            <strong className="text-slate-200">{grp.total_devices}</strong> members
                          </span>
                          <span>
                            <strong className="text-emerald-300">{grp.online_devices}</strong> online
                          </span>
                          <span>
                            <strong className="text-rose-300">{grp.blocked_devices}</strong> blocked
                          </span>
                        </div>
                        {grp.daily_youtube_limit_minutes != null &&
                          grp.daily_youtube_limit_minutes > 0 && (
                            <div
                              data-testid={`group-youtube-quota-badge-${grp.id}`}
                              className={`mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${grp.is_youtube_quota_reached
                                ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
                                : 'border-indigo-500/35 bg-indigo-500/10 text-indigo-200'
                                }`}
                            >
                              <YouTubeLogoIcon className="h-3 w-3 shrink-0" />
                              <span className="font-mono">
                                YT Today: {grp.today_youtube_minutes ?? 0}m /{' '}
                                {grp.daily_youtube_limit_minutes}m
                              </span>
                              {grp.is_youtube_quota_reached && (
                                <span className="rounded bg-rose-500/25 px-1 text-[10px] font-bold uppercase text-rose-100">
                                  Quota Reached
                                </span>
                              )}
                            </div>
                          )}
                      </div>

                      <div className="mt-3 flex flex-nowrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
                        <div className="flex flex-nowrap items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`group-filter-btn-${grp.id}`}
                            aria-pressed={isFilterSelected}
                            aria-label="Filter"
                            title={
                              isFilterSelected
                                ? `Clear group filter (${grp.name})`
                                : `Filter table by ${grp.name}`
                            }
                            onClick={() =>
                              setSelectedGroupId((prev) => (prev === grp.id ? null : grp.id))
                            }
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition cursor-pointer ${isFilterSelected
                              ? 'border-indigo-400 bg-indigo-500/25 text-indigo-100 shadow-xs'
                              : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
                              }`}
                          >
                            <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          </button>

                          <button
                            type="button"
                            data-testid={`group-analytics-btn-${grp.id}`}
                            aria-label="Analytics"
                            title={`Analytics for ${grp.name}`}
                            onClick={() => setSelectedAnalyticsGroupId(grp.id)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 cursor-pointer"
                          >
                            <BarChart3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          </button>
                        </div>

                        {grp.blockable_devices > 0 ? (
                          <div className="flex flex-nowrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              data-testid={`group-youtube-toggle-${grp.id}`}
                              disabled={isGroupBusy}
                              aria-label={
                                grp.youtube_status === 'blocked'
                                  ? `YouTube Blocked for ${grp.name}. Click to allow YouTube`
                                  : `YouTube Allowed for ${grp.name}. Click to block YouTube`
                              }
                              title={
                                grp.youtube_status === 'blocked'
                                  ? 'YouTube blocked for group (Plex allowed), Click to allow YouTube'
                                  : 'Block YouTube for group (keeps Plex & general internet allowed)'
                              }
                              onClick={() =>
                                groupYoutubeMutation.mutate({
                                  group: grp,
                                  action: grp.youtube_status === 'blocked' ? 'unblock' : 'block',
                                })
                              }
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition cursor-pointer disabled:opacity-60 ${grp.youtube_status === 'blocked'
                                ? 'border-slate-800 bg-slate-950/60 text-slate-500 opacity-60 hover:opacity-90 hover:border-slate-700'
                                : 'border-red-500/50 bg-red-500/15 text-red-500 shadow-xs hover:bg-red-500/25 hover:border-red-500/70'
                                }`}
                            >
                              <YouTubeLogoIcon
                                className="h-3.5 w-3.5"
                                testId={`group-yt-icon-${grp.id}`}
                              />
                            </button>

                            <TimerPopoverMenu
                              targetType="group"
                              targetId={grp.id}
                              targetName={grp.name}
                              activeOverride={grp.active_override}
                              iconOnly
                              isPending={groupTimerMutation.isPending || cancelTimerMutation.isPending}
                              onStartTimer={(payload) =>
                                groupTimerMutation.mutate({ groupId: grp.id, payload })
                              }
                              onCancelTimer={(ovId) => cancelTimerMutation.mutate(ovId)}
                            />

                            {grp.access_status === 'blocked' ? (
                              <button
                                type="button"
                                data-testid={`group-toggle-${grp.id}`}
                                disabled={isGroupBusy}
                                aria-label="Allow Group"
                                title="Blocked - Click to Allow Group Internet"
                                onClick={() =>
                                  groupAccessMutation.mutate({ group: grp, action: 'unblock' })
                                }
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25 disabled:opacity-60 cursor-pointer"
                              >
                                <ShieldAlert className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-testid={`group-toggle-${grp.id}`}
                                disabled={isGroupBusy}
                                aria-label="Block Group"
                                title="Allowed - Click to Block Group Internet"
                                onClick={() =>
                                  groupAccessMutation.mutate({ group: grp, action: 'block' })
                                }
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60 cursor-pointer"
                              >
                                <Globe className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">No blockable IPs</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
        </section>

        {/* Alert / Warning Feedback Banner */}
        {(bannerMessage || isError) && (
          <div
            role="alert"
            className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-sm ${bannerMessage?.type === 'warning'
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
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search devices"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by name, group, hostname, IP, MAC, or vendor..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {activeFilterGroup && (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1.5 text-xs font-semibold text-indigo-200">
                <span>Group: {activeFilterGroup.name}</span>
                <button
                  type="button"
                  aria-label="Clear group filter"
                  onClick={() => setSelectedGroupId(null)}
                  className="rounded p-0.5 hover:bg-indigo-500/30 cursor-pointer"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter devices by status">
            {(
              [
                { key: 'all', label: 'All' },
                { key: 'online', label: 'Online' },
                { key: 'blocked', label: 'Blocked' },
                { key: 'protected', label: 'Protected' },
                { key: 'unassigned', label: 'Unassigned' },
                {
                  key: 'archived',
                  label: summary.archived_devices
                    ? `Archived (${summary.archived_devices})`
                    : 'Archived',
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                data-testid={`filter-pill-${tab.key}`}
                onClick={() => handleStatusFilterChange(tab.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${statusFilter === tab.key
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
                  <th scope="col" className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid="sort-col-online"
                        onClick={() => toggleSort('online')}
                        title="Sort by Online status"
                        className="inline-flex items-center gap-1 hover:text-slate-200 cursor-pointer"
                      >
                        <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        data-testid="sort-col-name"
                        onClick={() => toggleSort('name')}
                        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 cursor-pointer"
                      >
                        <span>Device / Friendly Name</span>
                        {sortField === 'name' ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </th>
                  <th scope="col" className="hidden sm:table-cell px-4 py-3.5">
                    <button
                      type="button"
                      data-testid="sort-col-ipv4"
                      onClick={() => toggleSort('ipv4')}
                      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 cursor-pointer"
                    >
                      <span>IPv4 &amp; MAC</span>
                      {sortField === 'ipv4' ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                      )}
                    </button>
                  </th>
                  <th scope="col" className="hidden sm:table-cell px-4 py-3.5">
                    <button
                      type="button"
                      data-testid="sort-col-vendor"
                      onClick={() => toggleSort('vendor')}
                      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 cursor-pointer"
                    >
                      <span>Vendor &amp; Interface</span>
                      {sortField === 'vendor' ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                      )}
                    </button>
                  </th>
                  <th scope="col" className="hidden sm:table-cell px-4 py-3.5">
                    <button
                      type="button"
                      data-testid="sort-col-status"
                      onClick={() => toggleSort('status')}
                      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-200 cursor-pointer"
                    >
                      <span>Guardrail</span>
                      {sortField === 'status' ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                      )}
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredDevices.map((dev) => {
                  const isEditing = editingDeviceId === dev.id
                  const immutableProt = isImmutableProtection(dev)
                  const isBusy = pendingActionId === dev.id
                  const devGroups = dev.groups ?? []
                  const devGroupIdSet = new Set(devGroups.map((g) => g.id))

                  return (
                    <tr
                      key={dev.id}
                      data-testid={`device-row-${dev.id}`}
                      className="hover:bg-slate-800/40 transition"
                    >
                      {/* Column 1: Online Status + Name / Inline Rename + Group Badges */}
                      <td className="px-4 py-3.5 align-middle">
                        <div className="flex items-start gap-3">
                          <span
                            title={dev.is_online ? 'Online in ARP table' : 'Offline'}
                            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dev.is_online
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
                              <div className="relative flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedAnalyticsDeviceId(dev.id)}
                                  className="font-semibold text-slate-100 hover:text-indigo-300 truncate text-left cursor-pointer"
                                >
                                  {dev.effective_name}
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Edit name for ${dev.effective_name}`}
                                  onClick={() => startEditing(dev)}
                                  className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
                                >
                                  <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                {devGroups.map((badge) => (
                                  <button
                                    key={badge.id}
                                    type="button"
                                    onClick={() => setSelectedGroupId(badge.id)}
                                    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer ${getGroupBadgeClasses(
                                      badge.color_badge,
                                    )}`}
                                  >
                                    {badge.name}
                                  </button>
                                ))}
                                {groups.length > 0 && (
                                  <button
                                    type="button"
                                    data-testid={`quick-group-btn-${dev.id}`}
                                    aria-label={`Assign groups for ${dev.effective_name}`}
                                    onClick={() =>
                                      setOpenQuickGroupDeviceId((prev) =>
                                        prev === dev.id ? null : dev.id,
                                      )
                                    }
                                    className="inline-flex items-center gap-0.5 rounded border border-dashed border-slate-700 bg-slate-950/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 hover:border-indigo-500/60 hover:text-indigo-200 cursor-pointer"
                                  >
                                    <Plus className="h-2.5 w-2.5" aria-hidden="true" />
                                    <span>Group</span>
                                  </button>
                                )}
                                {openQuickGroupDeviceId === dev.id && (
                                  <div
                                    data-testid={`quick-group-popover-${dev.id}`}
                                    className="absolute left-0 top-full z-30 mt-1.5 w-56 rounded-xl border border-slate-700 bg-slate-900 p-2.5 shadow-xl"
                                  >
                                    <div className="mb-1.5 flex items-center justify-between border-b border-slate-800 pb-1 text-[11px] font-semibold text-slate-300">
                                      <span>Assign Groups</span>
                                      <button
                                        type="button"
                                        aria-label="Close group popover"
                                        onClick={() => setOpenQuickGroupDeviceId(null)}
                                        className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 cursor-pointer"
                                      >
                                        <X className="h-3 w-3" aria-hidden="true" />
                                      </button>
                                    </div>
                                    <div className="space-y-1 max-h-40 overflow-y-auto">
                                      {groups.map((grp) => {
                                        const isMember = devGroupIdSet.has(grp.id)
                                        return (
                                          <label
                                            key={grp.id}
                                            className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-200 hover:bg-slate-800 cursor-pointer"
                                          >
                                            <input
                                              type="checkbox"
                                              data-testid={`quick-group-option-${dev.id}-${grp.id}`}
                                              checked={isMember}
                                              disabled={quickGroupsMutation.isPending}
                                              onChange={() => {
                                                const nextIds = isMember
                                                  ? devGroups
                                                    .filter((g) => g.id !== grp.id)
                                                    .map((g) => g.id)
                                                  : [...devGroups.map((g) => g.id), grp.id]
                                                quickGroupsMutation.mutate({
                                                  deviceId: dev.id,
                                                  groupIds: nextIds,
                                                })
                                              }}
                                              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 text-indigo-600"
                                            />
                                            <span className="truncate">{grp.name}</span>
                                          </label>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}
                                {dev.active_schedule && (
                                  <span
                                    data-testid={`device-schedule-badge-${dev.id}`}
                                    className="inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200"
                                  >
                                    <CalendarClock className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                                    <span>
                                      {dev.active_schedule.name} (until {dev.active_schedule.end_time})
                                    </span>
                                  </span>
                                )}
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
                      <td className="hidden sm:table-cell px-4 py-3.5 align-middle font-mono text-xs">
                        <div className="font-semibold text-slate-200">
                          {dev.ipv4_address ?? 'No IPv4'}
                        </div>
                        <div className="text-slate-400">{dev.mac_address}</div>
                      </td>

                      {/* Column 3: Vendor & Interface */}
                      <td className="hidden sm:table-cell px-4 py-3.5 align-middle text-xs">
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
                      <td className="hidden sm:table-cell px-4 py-3.5 align-middle">
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
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${dev.is_protected
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

                      {/* Column 5: Unified Right-Aligned Actions Column */}
                      <td className="px-4 py-3.5 align-middle text-right">
                        <div className="inline-flex flex-nowrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            data-testid={`view-analytics-btn-${dev.id}`}
                            aria-label="Analytics"
                            title={`View analytics for ${dev.effective_name}`}
                            onClick={() => setSelectedAnalyticsDeviceId(dev.id)}
                            className="inline-flex h-9 w-9 min-h-9 min-w-9 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-2 text-indigo-300 hover:bg-indigo-500/20 cursor-pointer"
                          >
                            <BarChart3 className="h-4 w-4" aria-hidden="true" />
                          </button>

                          {!dev.is_protected && (
                            <button
                              type="button"
                              data-testid={`youtube-toggle-${dev.id}`}
                              disabled={isBusy || !dev.ipv4_address}
                              aria-label={
                                dev.is_youtube_blocked
                                  ? `YouTube Blocked for ${dev.effective_name}. Click to allow YouTube`
                                  : `YouTube Allowed for ${dev.effective_name}. Click to block YouTube`
                              }
                              title={
                                dev.is_youtube_blocked
                                  ? 'YouTube Blocked (Plex & Internet allowed) - Click to allow YouTube'
                                  : 'YouTube Allowed - Click to block YouTube only (keeps Plex & Internet allowed)'
                              }
                              onClick={() =>
                                deviceYoutubeMutation.mutate({
                                  device: dev,
                                  action: dev.is_youtube_blocked ? 'unblock' : 'block',
                                })
                              }
                              className={`inline-flex h-9 w-9 min-h-9 min-w-9 items-center justify-center rounded-lg border p-2 transition cursor-pointer disabled:opacity-50 ${dev.is_youtube_blocked
                                ? 'border-slate-800 bg-slate-950/60 text-slate-500 opacity-60 hover:opacity-90 hover:border-slate-700'
                                : 'border-red-500/50 bg-red-500/15 text-red-500 shadow-xs hover:bg-red-500/25 hover:border-red-500/70'
                                }`}
                            >
                              <YouTubeLogoIcon className="h-4 w-4" testId={`yt-icon-${dev.id}`} />
                            </button>
                          )}

                          <TimerPopoverMenu
                            targetType="device"
                            targetId={dev.id}
                            targetName={dev.effective_name}
                            activeOverride={dev.active_override}
                            disabled={dev.is_protected || !dev.ipv4_address}
                            iconOnly
                            isPending={
                              deviceTimerMutation.isPending || cancelTimerMutation.isPending
                            }
                            onStartTimer={(payload) =>
                              deviceTimerMutation.mutate({ deviceId: dev.id, payload })
                            }
                            onCancelTimer={(ovId) => cancelTimerMutation.mutate(ovId)}
                          />

                          {dev.is_protected ? (
                            <button
                              type="button"
                              data-testid={`access-toggle-${dev.id}`}
                              disabled
                              aria-label="Always Allowed"
                              title={dev.protection_reason ?? 'Protected device cannot be blocked'}
                              className="inline-flex h-9 w-9 min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/50 p-2 text-slate-400 opacity-75 cursor-not-allowed"
                            >
                              <Lock className="h-4 w-4 text-amber-400" aria-hidden="true" />
                            </button>
                          ) : dev.is_blocked ? (
                            <button
                              type="button"
                              data-testid={`access-toggle-${dev.id}`}
                              disabled={isBusy}
                              aria-label="Blocked"
                              title="Internet Blocked - Click to restore internet access"
                              onClick={() =>
                                accessMutation.mutate({ device: dev, action: 'unblock' })
                              }
                              className="inline-flex h-9 w-9 min-h-9 min-w-9 items-center justify-center rounded-lg border border-rose-500/40 bg-rose-500/15 p-2 text-rose-200 hover:bg-rose-500/25 disabled:opacity-60 cursor-pointer"
                            >
                              <ShieldAlert className="h-4 w-4 text-rose-400" aria-hidden="true" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              data-testid={`access-toggle-${dev.id}`}
                              disabled={isBusy || !dev.ipv4_address}
                              aria-label="Allowed"
                              title="Internet Allowed - Click to block internet access"
                              onClick={() =>
                                accessMutation.mutate({ device: dev, action: 'block' })
                              }
                              className="inline-flex h-9 w-9 min-h-9 min-w-9 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/15 p-2 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50 cursor-pointer"
                            >
                              <Globe className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                            </button>
                          )}

                          {!dev.is_online && (
                            <>
                              {dev.is_archived ? (
                                <button
                                  type="button"
                                  data-testid={`restore-device-btn-${dev.id}`}
                                  aria-label={`Restore ${dev.effective_name}`}
                                  title="Restore archived device to inventory"
                                  disabled={archiveDeviceMutation.isPending}
                                  onClick={() =>
                                    archiveDeviceMutation.mutate({
                                      deviceId: dev.id,
                                      action: 'restore',
                                    })
                                  }
                                  className="inline-flex h-9 w-9 min-h-9 min-w-9 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 cursor-pointer"
                                >
                                  <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  data-testid={`archive-device-btn-${dev.id}`}
                                  aria-label={`Archive ${dev.effective_name}`}
                                  title="Archive offline device"
                                  disabled={archiveDeviceMutation.isPending}
                                  onClick={() =>
                                    archiveDeviceMutation.mutate({
                                      deviceId: dev.id,
                                      action: 'archive',
                                    })
                                  }
                                  className="inline-flex h-9 w-9 min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-300 hover:bg-slate-800 hover:text-amber-300 disabled:opacity-50 cursor-pointer"
                                >
                                  <Archive className="h-4 w-4" aria-hidden="true" />
                                </button>
                              )}

                              <button
                                type="button"
                                data-testid={`delete-device-btn-${dev.id}`}
                                aria-label={`Delete offline device ${dev.effective_name}`}
                                title={
                                  dev.is_protected
                                    ? 'Protected devices cannot be deleted'
                                    : 'Delete offline device permanently'
                                }
                                disabled={dev.is_protected || deleteDeviceMutation.isPending}
                                onClick={() => deleteDeviceMutation.mutate(dev.id)}
                                className="inline-flex h-9 w-9 min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 p-2 text-slate-400 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300 disabled:opacity-40 cursor-pointer"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Group Create / Edit Modal */}
        <GroupFormModal
          isOpen={isGroupModalOpen}
          editingGroup={editingGroup}
          allDevices={deviceList?.devices ?? []}
          onClose={() => setIsGroupModalOpen(false)}
          onDeleted={(deletedId) => {
            if (selectedGroupId === deletedId) setSelectedGroupId(null)
            if (selectedAnalyticsGroupId === deletedId) setSelectedAnalyticsGroupId(null)
          }}
        />

        {/* Per-Group Analytics Slide-Over Drawer */}
        <GroupAnalyticsDrawer
          groupId={selectedAnalyticsGroupId}
          onClose={() => setSelectedAnalyticsGroupId(null)}
          onSelectDeviceId={(devId) => {
            setSelectedAnalyticsGroupId(null)
            setSelectedAnalyticsDeviceId(devId)
          }}
        />

        {/* Per-Device Analytics Slide-Over Drawer */}
        <DeviceAnalyticsDrawer
          deviceId={selectedAnalyticsDeviceId}
          onClose={() => setSelectedAnalyticsDeviceId(null)}
        />
      </div>
    </AppLayout>
  )
}
