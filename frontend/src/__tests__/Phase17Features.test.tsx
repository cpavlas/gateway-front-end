import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiClient,
  type DeviceAnalyticsResponse,
  type DeviceItem,
  type DeviceListResponse,
  type GroupAnalyticsResponse,
  type GroupItem,
  type GroupListResponse,
  type ScheduleRule,
  type SystemHealthResponse,
} from '../api/client'
import { DeviceAnalyticsDrawer } from '../components/DeviceAnalyticsDrawer'
import { GroupAnalyticsDrawer } from '../components/GroupAnalyticsDrawer'
import { ScheduleFormModal } from '../components/ScheduleFormModal'
import {
  WeeklyScheduleTimeline,
  buildWeeklyTimelineSegments,
  timeToMinutes,
} from '../components/WeeklyScheduleTimeline'
import { AuthProvider } from '../context/AuthContext'
import { DevicesPage } from '../pages/DevicesPage'
import { SchedulesPage } from '../pages/SchedulesPage'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })
}

const MOCK_HEALTH: SystemHealthResponse = {
  overall_status: 'healthy',
  version: '1.3.0-rc3',
  services: {
    sqlite: { service: 'sqlite', status: 'healthy', latency_ms: 1.1, message: 'OK' },
    opnsense: { service: 'opnsense', status: 'healthy', latency_ms: 12.0, message: 'OK' },
    elasticsearch: { service: 'elasticsearch', status: 'healthy', latency_ms: 8.5, message: 'OK' },
  },
}

const ACTIVE_DEVICES: DeviceItem[] = [
  {
    id: 1,
    mac_address: 'aa:bb:cc:00:01:01',
    ipv4_address: '192.168.1.50',
    hostname: 'zeta-tv',
    display_name: 'Zeta Living Room TV',
    effective_name: 'Zeta Living Room TV',
    vendor: 'Sony',
    interface_name: 'lan',
    lease_type: 'static',
    is_online: true,
    is_blocked: false,
    is_youtube_blocked: false,
    is_protected: false,
    is_archived: false,
    protection_reason: null,
    notes: '',
    groups: [{ id: 10, name: 'Kids Profile', color_badge: 'indigo', icon: 'users' }],
    first_seen_at: '2026-11-01T10:00:00Z',
    last_seen_at: '2026-11-14T15:00:00Z',
    updated_at: '2026-11-14T15:00:00Z',
  },
  {
    id: 2,
    mac_address: 'aa:bb:cc:00:01:02',
    ipv4_address: '192.168.1.10',
    hostname: 'alpha-ipad',
    display_name: 'Alpha Kids iPad',
    effective_name: 'Alpha Kids iPad',
    vendor: 'Apple',
    interface_name: 'lan',
    lease_type: 'dynamic',
    is_online: false,
    is_blocked: false,
    is_youtube_blocked: true,
    is_protected: false,
    is_archived: false,
    protection_reason: null,
    notes: '',
    groups: [],
    first_seen_at: '2026-11-01T10:00:00Z',
    last_seen_at: '2026-11-10T12:00:00Z',
    updated_at: '2026-11-10T12:00:00Z',
  },
  {
    id: 3,
    mac_address: 'aa:bb:cc:00:01:03',
    ipv4_address: '192.168.1.1',
    hostname: 'gateway-host',
    display_name: 'Gateway Core',
    effective_name: 'Gateway Core',
    vendor: 'Protectli',
    interface_name: 'lan',
    lease_type: 'static',
    is_online: true,
    is_blocked: false,
    is_youtube_blocked: false,
    is_protected: true,
    is_archived: false,
    protection_reason: 'Gateway & Infrastructure Safeguard',
    notes: '',
    groups: [],
    first_seen_at: '2026-11-01T10:00:00Z',
    last_seen_at: '2026-11-14T15:00:00Z',
    updated_at: '2026-11-14T15:00:00Z',
  },
]

const ARCHIVED_DEVICES: DeviceItem[] = [
  {
    id: 99,
    mac_address: 'aa:bb:cc:00:01:99',
    ipv4_address: null,
    hostname: 'old-guest-phone',
    display_name: 'Old Guest Phone',
    effective_name: 'Old Guest Phone',
    vendor: 'Samsung',
    interface_name: 'lan',
    lease_type: 'dynamic',
    is_online: false,
    is_blocked: false,
    is_youtube_blocked: false,
    is_protected: false,
    is_archived: true,
    protection_reason: null,
    notes: '',
    groups: [],
    first_seen_at: '2026-10-01T10:00:00Z',
    last_seen_at: '2026-10-02T10:00:00Z',
    updated_at: '2026-11-12T10:00:00Z',
  },
]

const MOCK_GROUPS: GroupItem[] = [
  {
    id: 10,
    name: 'Kids Profile',
    description: 'Kids TVs and tablets',
    color_badge: 'indigo',
    icon: 'users',
    access_status: 'allowed',
    youtube_status: 'allowed',
    total_devices: 1,
    online_devices: 1,
    blocked_devices: 0,
    protected_devices: 0,
    blockable_devices: 1,
    member_device_ids: [1],
    members: [ACTIVE_DEVICES[0]],
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-14T15:00:00Z',
  },
  {
    id: 20,
    name: 'Guest Media',
    description: 'Media room devices',
    color_badge: 'emerald',
    icon: 'tv',
    access_status: 'blocked',
    youtube_status: 'blocked',
    total_devices: 1,
    online_devices: 0,
    blocked_devices: 1,
    protected_devices: 0,
    blockable_devices: 1,
    member_device_ids: [2],
    members: [ACTIVE_DEVICES[1]],
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-14T15:00:00Z',
  },
]

const MOCK_SCHEDULES: ScheduleRule[] = [
  {
    id: 1,
    name: 'School Night Bedtime',
    description: 'Full bedtime blackout',
    target_type: 'group',
    group_id: 10,
    device_id: null,
    target_name: 'Kids Profile',
    block_mode: 'internet',
    days_of_week: [0, 1, 2, 3, 6],
    start_time: '21:00',
    end_time: '07:00',
    timezone: 'America/Los_Angeles',
    is_enabled: true,
    is_active_now: true,
    snoozed_until: null,
    is_snoozed: false,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-14T15:00:00Z',
  },
  {
    id: 2,
    name: 'Homework YouTube Lock',
    description: 'Allow research internet, block YouTube only',
    target_type: 'device',
    group_id: null,
    device_id: 2,
    target_name: 'Alpha Kids iPad',
    block_mode: 'youtube',
    days_of_week: [0, 1, 2, 3, 4],
    start_time: '15:00',
    end_time: '17:30',
    timezone: 'America/Los_Angeles',
    is_enabled: true,
    is_active_now: false,
    snoozed_until: null,
    is_snoozed: false,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-14T15:00:00Z',
  },
  {
    id: 3,
    name: 'Weekend Snoozed Rule',
    description: 'Temporarily snoozed',
    target_type: 'group',
    group_id: 20,
    device_id: null,
    target_name: 'Guest Media',
    block_mode: 'internet',
    days_of_week: [5, 6],
    start_time: '00:00',
    end_time: '00:00',
    timezone: 'America/Los_Angeles',
    is_enabled: true,
    is_active_now: false,
    snoozed_until: '2026-11-14T22:30:00Z',
    is_snoozed: true,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-14T15:00:00Z',
  },
]

describe('Phase 17 UI Enhancements (FB-P17-001 through FB-P17-005)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    localStorage.setItem('gateway_devices_status_filter', 'all')
    vi.spyOn(apiClient, 'getCurrentUser').mockResolvedValue({
      username: 'admin',
      authenticated: true,
      expires_at: '2026-11-15T23:59:59Z',
    })
    vi.spyOn(apiClient, 'getSystemHealth').mockResolvedValue(MOCK_HEALTH)
    vi.spyOn(apiClient, 'getGroups').mockResolvedValue({ groups: MOCK_GROUPS } as GroupListResponse)
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: MOCK_SCHEDULES })
    vi.spyOn(apiClient, 'getDevices').mockImplementation(async (params) => {
      if (params?.status === 'archived') {
        return {
          summary: {
            total_devices: 3,
            online_devices: 2,
            blocked_devices: 0,
            protected_devices: 1,
            archived_devices: 1,
          },
          last_synced_at: '2026-11-14T15:00:00Z',
          devices: ARCHIVED_DEVICES,
        } satisfies DeviceListResponse
      }
      return {
        summary: {
          total_devices: 3,
          online_devices: 2,
          blocked_devices: 0,
          protected_devices: 1,
          archived_devices: 1,
        },
        last_synced_at: '2026-11-14T15:00:00Z',
        devices: ACTIVE_DEVICES,
      } satisfies DeviceListResponse
    })
  })

  it('FB-P17-001 & FB-P17-002: collapses/persists Device Groups, sorts columns, assigns inline + Group, and archives/restores/deletes offline devices', async () => {
    const user = userEvent.setup()
    const updateDevSpy = vi
      .spyOn(apiClient, 'updateDevice')
      .mockResolvedValue({
        ...ACTIVE_DEVICES[1],
        groups: [{ id: 10, name: 'Kids Profile', color_badge: 'indigo', icon: 'users' }],
      })
    const archiveSpy = vi
      .spyOn(apiClient, 'archiveDevice')
      .mockResolvedValue({ ...ACTIVE_DEVICES[1], is_archived: true })
    const restoreSpy = vi
      .spyOn(apiClient, 'restoreDevice')
      .mockResolvedValue({ ...ARCHIVED_DEVICES[0], is_archived: false })
    const deleteSpy = vi.spyOn(apiClient, 'deleteDevice').mockResolvedValue(undefined)
    const blockGroupYtSpy = vi
      .spyOn(apiClient, 'blockGroupYoutube')
      .mockResolvedValue({
        group: { ...MOCK_GROUPS[0], youtube_status: 'blocked' },
        action: 'youtube_block',
        affected_device_ids: [1],
        affected_ips: ['192.168.1.50'],
        skipped_protected_names: [],
        skipped_no_ip_names: [],
        states_killed_ips: ['192.168.1.50'],
        warnings: [],
      })

    const qc = createTestQueryClient()
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <DevicesPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    // Group cards present with compact icon controls (no "Filter Devices" text label)
    expect(await screen.findByTestId('group-card-10')).toBeInTheDocument()
    const filterBtn = screen.getByTestId('group-filter-btn-10')
    expect(filterBtn).toHaveAttribute('aria-label', 'Filter')
    expect(filterBtn).toHaveAttribute('title', 'Filter table by Kids Profile')
    await user.click(screen.getByTestId('group-youtube-toggle-10'))
    expect(blockGroupYtSpy).toHaveBeenCalledWith(10)

    // Collapse Device Groups & verify localStorage persistence across remount
    await user.click(screen.getByTestId('toggle-groups-section-btn'))
    expect(screen.queryByTestId('group-card-10')).not.toBeInTheDocument()
    expect(localStorage.getItem('gateway_devices_groups_collapsed')).toBe('true')

    unmount()
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthProvider>
          <DevicesPage />
        </AuthProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByTestId('devices-table')).toBeInTheDocument()
    expect(screen.queryByTestId('group-card-10')).not.toBeInTheDocument()

    // Expand groups back
    await user.click(screen.getByTestId('toggle-groups-section-btn'))
    expect(await screen.findByTestId('group-card-10')).toBeInTheDocument()
    expect(localStorage.getItem('gateway_devices_groups_collapsed')).toBe('false')

    // Default sort is Name ascending (Alpha first); clicking toggles desc (Zeta) -> asc (Alpha)
    const rowsInitial = screen.getAllByTestId(/^device-row-/)
    expect(rowsInitial[0]).toHaveAttribute('data-testid', 'device-row-2') // Alpha Kids iPad
    await user.click(screen.getByTestId('sort-col-name'))
    const rowsDesc = screen.getAllByTestId(/^device-row-/)
    expect(rowsDesc[0]).toHaveAttribute('data-testid', 'device-row-1') // Zeta Living Room TV
    await user.click(screen.getByTestId('sort-col-name'))
    const rowsAsc = screen.getAllByTestId(/^device-row-/)
    expect(rowsAsc[0]).toHaveAttribute('data-testid', 'device-row-2') // Alpha Kids iPad

    // Sort by IPv4 numerical order, Vendor, Online, and Status
    await user.click(screen.getByTestId('sort-col-ipv4'))
    const rowsIp = screen.getAllByTestId(/^device-row-/)
    expect(rowsIp[0]).toHaveAttribute('data-testid', 'device-row-3') // 192.168.1.1
    await user.click(screen.getByTestId('sort-col-vendor'))
    await user.click(screen.getByTestId('sort-col-status'))
    await user.click(screen.getByTestId('sort-col-online'))

    // Inline + Group assignment popover on device 2
    await user.click(screen.getByTestId('quick-group-btn-2'))
    const popover = await screen.findByTestId('quick-group-popover-2')
    await user.click(within(popover).getByTestId('quick-group-option-2-10'))
    expect(updateDevSpy).toHaveBeenCalledWith(2, { group_ids: [10] })

    // Offline non-archived device (id=2) shows Archive button; online devices do not
    expect(screen.queryByTestId('archive-device-btn-1')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('archive-device-btn-2'))
    expect(archiveSpy).toHaveBeenCalledWith(2)

    // Archived filter pill loads archived devices and offers Restore & Delete
    await user.click(screen.getByTestId('filter-pill-archived'))
    expect(await screen.findByTestId('device-row-99')).toBeInTheDocument()
    await user.click(screen.getByTestId('restore-device-btn-99'))
    expect(restoreSpy).toHaveBeenCalledWith(99)
    await user.click(screen.getByTestId('delete-device-btn-99'))
    expect(deleteSpy).toHaveBeenCalledWith(99)
  })

  it('FB-P17-003: renders compact header icon controls (YT, Timer, Access) in Device & Group Analytics Drawers', async () => {
    const user = userEvent.setup()
    const blockYtSpy = vi
      .spyOn(apiClient, 'blockDeviceYoutube')
      .mockResolvedValue({
        device: { ...ACTIVE_DEVICES[0], is_youtube_blocked: true },
        action: 'youtube_block',
        states_killed: true,
        warning: null,
      })
    const unblockDevSpy = vi
      .spyOn(apiClient, 'blockDevice')
      .mockResolvedValue({
        device: { ...ACTIVE_DEVICES[0], is_blocked: true },
        action: 'block',
        states_killed: true,
        warning: null,
      })
    const blockGrpYtSpy = vi
      .spyOn(apiClient, 'blockGroupYoutube')
      .mockResolvedValue({
        group: { ...MOCK_GROUPS[0], youtube_status: 'blocked' },
        action: 'youtube_block',
        affected_device_ids: [1],
        affected_ips: ['192.168.1.50'],
        skipped_protected_names: [],
        skipped_no_ip_names: [],
        states_killed_ips: ['192.168.1.50'],
        warnings: [],
      })
    const blockGrpSpy = vi.spyOn(apiClient, 'blockGroup').mockResolvedValue({
      group: { ...MOCK_GROUPS[0], access_status: 'blocked' },
      action: 'block',
      affected_device_ids: [1],
      affected_ips: ['192.168.1.50'],
      skipped_protected_names: [],
      skipped_no_ip_names: [],
      states_killed_ips: ['192.168.1.50'],
      warnings: [],
    })

    const devAnalytics: DeviceAnalyticsResponse = {
      device: ACTIVE_DEVICES[0],
      window: '24h',
      generated_at: '2026-11-14T15:00:00Z',
      es_reachable: true,
      summary: {
        total_events: 100,
        firewall_event_count: 50,
        dns_query_count: 50,
        blocked_packet_count: 0,
        allowed_packet_count: 50,
        total_bytes: 102400,
        active_hours_in_day: 2,
        first_active_at: '2026-11-14T10:00:00Z',
        last_active_at: '2026-11-14T14:50:00Z',
      },
      timeline: [],
      hourly_access_profile: [],
      top_domains: [],
      top_registered_domains: [],
      top_organizations: [],
      recent_queries: [],
      application_usage: [],
      warning: null,
    }
    vi.spyOn(apiClient, 'getDeviceAnalytics').mockResolvedValue(devAnalytics)

    const grpAnalytics: GroupAnalyticsResponse = {
      group: MOCK_GROUPS[0],
      tracked_ips: ['192.168.1.50'],
      window: '24h',
      generated_at: '2026-11-14T15:00:00Z',
      es_reachable: true,
      summary: devAnalytics.summary,
      timeline: [],
      hourly_access_profile: [],
      top_domains: [],
      top_registered_domains: [],
      top_organizations: [],
      member_breakdown: [],
      recent_queries: [],
      application_usage: [],
      warning: null,
    }
    vi.spyOn(apiClient, 'getGroupAnalytics').mockResolvedValue(grpAnalytics)

    const qc = createTestQueryClient()
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <DeviceAnalyticsDrawer deviceId={1} onClose={() => { }} />
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('drawer-youtube-toggle')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('YouTube Allowed'),
    )
    expect(screen.getByTestId('drawer-open-timer-menu-device-1')).toBeInTheDocument()
    expect(screen.getByTestId('drawer-access-toggle')).toHaveAttribute(
      'aria-label',
      'Allowed, Click to Block',
    )

    await user.click(screen.getByTestId('drawer-youtube-toggle'))
    expect(blockYtSpy).toHaveBeenCalledWith(1)
    await user.click(screen.getByTestId('drawer-access-toggle'))
    expect(unblockDevSpy).toHaveBeenCalledWith(1)

    unmount()

    render(
      <QueryClientProvider client={qc}>
        <GroupAnalyticsDrawer groupId={10} onClose={() => { }} />
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('group-drawer-youtube-toggle')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('YouTube Allowed'),
    )
    expect(screen.getByTestId('drawer-open-timer-menu-group-10')).toBeInTheDocument()
    await user.click(screen.getByTestId('group-drawer-youtube-toggle'))
    expect(blockGrpYtSpy).toHaveBeenCalledWith(10)
    await user.click(screen.getByTestId('group-drawer-access-toggle'))
    expect(blockGrpSpy).toHaveBeenCalledWith(10)
  })

  it('FB-P17-004 & FB-P17-005: renders 7-day weekly timeline, clones/snoozes rules, supports auto-refresh, and edits target + block_mode', async () => {
    const user = userEvent.setup()
    const cloneSpy = vi.spyOn(apiClient, 'cloneSchedule').mockResolvedValue({
      ...MOCK_SCHEDULES[0],
      id: 4,
      name: 'School Night Bedtime (Copy)',
    })
    const snoozeSpy = vi.spyOn(apiClient, 'snoozeSchedule').mockResolvedValue({
      ...MOCK_SCHEDULES[0],
      is_snoozed: true,
      snoozed_until: '2026-11-14T22:00:00Z',
    })
    const updateSchedSpy = vi.spyOn(apiClient, 'updateSchedule').mockResolvedValue({
      ...MOCK_SCHEDULES[1],
      block_mode: 'youtube',
      target_type: 'group',
      group_id: 10,
      device_id: null,
    })

    // Pure helper unit checks for WeeklyScheduleTimeline
    expect(timeToMinutes('21:30')).toBe(1290)
    expect(timeToMinutes('bad')).toBe(0)
    const segments = buildWeeklyTimelineSegments([
      ...MOCK_SCHEDULES,
      { ...MOCK_SCHEDULES[1], id: 99, is_enabled: false },
    ])
    // Overnight rule splits into day N and (day + 1) % 7
    expect(segments.some((s) => s.rule.id === 1 && s.day === 0 && s.endMin === 1440)).toBe(true)
    expect(segments.some((s) => s.rule.id === 1 && s.day === 1 && s.startMin === 0)).toBe(true)
    // Disabled rules are excluded
    expect(segments.some((s) => s.rule.id === 99)).toBe(false)

    const qc = createTestQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <SchedulesPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('weekly-schedule-timeline')).toBeInTheDocument()
    for (let d = 0; d < 7; d += 1) {
      expect(screen.getByTestId(`timeline-day-${d}`)).toBeInTheDocument()
    }
    expect(screen.getByTestId('schedules-auto-refresh-select')).toBeInTheDocument()
    expect(screen.getByTestId('schedule-mode-badge-2')).toHaveTextContent('YouTube Only')
    expect(screen.getByTestId('schedule-snoozed-badge-3')).toHaveTextContent(/Snoozed/i)

    // Clone schedule
    await user.click(screen.getByTestId('clone-schedule-1'))
    expect(cloneSpy).toHaveBeenCalledWith(1)

    // Snooze schedule for 30m & Clear snooze on rule 3
    await user.click(screen.getByTestId('snooze-schedule-30m-1'))
    expect(snoozeSpy).toHaveBeenCalledWith(1, { duration_minutes: 30 })
    await user.click(screen.getByTestId('snooze-schedule-window-1'))
    expect(snoozeSpy).toHaveBeenCalledWith(1, { until_end_of_window: true })
    await user.click(screen.getByTestId('clear-snooze-btn-3'))
    expect(snoozeSpy).toHaveBeenCalledWith(3, { clear: true })

    // Open Edit modal via clicking rule segment on timeline & verify target type + block_mode editable
    await user.click(screen.getByTestId('timeline-segment-2-0'))
    expect(await screen.findByTestId('schedule-form-modal')).toBeInTheDocument()
    expect(screen.getByTestId('schedule-mode-youtube')).toBeInTheDocument()
    expect(screen.getByTestId('schedule-target-group')).toBeInTheDocument()
    await user.click(screen.getByTestId('schedule-target-group'))
    await user.selectOptions(screen.getByTestId('schedule-group-select'), '10')
    await user.click(screen.getByTestId('save-schedule-btn'))
    await waitFor(() => {
      expect(updateSchedSpy).toHaveBeenCalledWith(
        2,
        expect.objectContaining({
          block_mode: 'youtube',
          target_type: 'group',
          group_id: 10,
          device_id: null,
        }),
      )
    })

    // Standalone timeline & modal edge render check
    render(
      <WeeklyScheduleTimeline schedules={[]} />,
    )
    render(
      <QueryClientProvider client={qc}>
        <ScheduleFormModal
          isOpen
          editingSchedule={null}
          groups={MOCK_GROUPS}
          devices={ACTIVE_DEVICES}
          onClose={() => { }}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('schedule-mode-internet')).toBeInTheDocument()
  })
})
