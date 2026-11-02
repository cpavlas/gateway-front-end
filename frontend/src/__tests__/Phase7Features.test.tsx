import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  apiClient,
  formatActiveMinutes,
  type DeviceItem,
  type GroupItem,
  type SystemHealthResponse,
} from '../api/client'
import { AuthProvider } from '../context/AuthContext'
import { AppLayout } from '../components/AppLayout'
import { ScheduleFormModal } from '../components/ScheduleFormModal'
import { StatusPage } from '../pages/StatusPage'
import { DevicesPage } from '../pages/DevicesPage'
import { AnalyticsPage } from '../pages/AnalyticsPage'
import { DeviceAnalyticsDrawer } from '../components/DeviceAnalyticsDrawer'
import { GroupAnalyticsDrawer } from '../components/GroupAnalyticsDrawer'

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

const SAMPLE_DEVICES: DeviceItem[] = [
  {
    id: 10,
    mac_address: 'AA:BB:CC:DD:EE:10',
    ipv4_address: '192.168.50.110',
    hostname: 'livingroom-appletv',
    display_name: 'Living Room Apple TV',
    effective_name: 'Living Room Apple TV',
    vendor: 'Apple',
    interface_name: 'lan',
    lease_type: 'dynamic',
    is_online: true,
    is_blocked: false,
    is_youtube_blocked: false,
    is_protected: false,
    protection_reason: null,
    notes: '',
    first_seen_at: '2026-11-01T00:00:00Z',
    last_seen_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    groups: [{ id: 1, name: 'Kids Devices', color_badge: 'indigo', icon: 'users' }],
    active_override: null,
  },
  {
    id: 11,
    mac_address: 'AA:BB:CC:DD:EE:11',
    ipv4_address: '192.168.50.111',
    hostname: 'kids-ipad',
    display_name: 'Kids iPad',
    effective_name: 'Kids iPad',
    vendor: 'Apple',
    interface_name: 'lan',
    lease_type: 'dynamic',
    is_online: true,
    is_blocked: false,
    is_youtube_blocked: true,
    is_protected: false,
    protection_reason: null,
    notes: '',
    first_seen_at: '2026-11-01T00:00:00Z',
    last_seen_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    groups: [{ id: 1, name: 'Kids Devices', color_badge: 'indigo', icon: 'users' }],
    active_override: null,
  },
]

const SAMPLE_GROUP: GroupItem = {
  id: 1,
  name: 'Kids Devices',
  description: 'Kids profile',
  color_badge: 'indigo',
  icon: 'users',
  access_status: 'allowed',
  youtube_status: 'partially_blocked',
  youtube_blocked_devices: 1,
  total_devices: 2,
  online_devices: 2,
  blocked_devices: 0,
  protected_devices: 0,
  blockable_devices: 2,
  member_device_ids: [10, 11],
  members: SAMPLE_DEVICES,
  active_override: null,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
}

describe('Phase 7 Features & Phase 6 Backlog Items (FB-P6-001 through FB-P6-005)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(apiClient, 'getCurrentUser').mockResolvedValue({
      username: 'admin',
      authenticated: true,
      expires_at: '2026-11-01T23:59:59Z',
    })
  })

  it('formats active application usage minutes accurately (formatActiveMinutes)', () => {
    expect(formatActiveMinutes(0)).toBe('0m')
    expect(formatActiveMinutes(45)).toBe('45m')
    expect(formatActiveMinutes(60)).toBe('1h')
    expect(formatActiveMinutes(135)).toBe('2h 15m')
  })

  it('FB-P6-002: renders the live 24-hour system clock below the Logout button in AppLayout', async () => {
    const qc = createTestQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <AppLayout overallStatus="healthy" version="1.0.0">
            <div>Body Content</div>
          </AppLayout>
        </AuthProvider>
      </QueryClientProvider>,
    )

    const clockEl = await screen.findByTestId('header-system-clock')
    expect(clockEl).toBeInTheDocument()
    expect(clockEl.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('FB-P6-001: filters the Target Device dropdown using the single-device search input in ScheduleFormModal', async () => {
    const user = userEvent.setup()
    const qc = createTestQueryClient()

    render(
      <QueryClientProvider client={qc}>
        <ScheduleFormModal
          isOpen={true}
          editingSchedule={null}
          groups={[SAMPLE_GROUP]}
          devices={SAMPLE_DEVICES}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    )

    // Switch target type from Group to Single Device
    await user.click(screen.getByTestId('schedule-target-device'))

    const searchInput = screen.getByTestId('schedule-device-search')
    expect(searchInput).toBeInTheDocument()

    // Filter for "ipad"
    await user.type(searchInput, 'ipad')

    const deviceSelect = screen.getByTestId('schedule-device-select')
    expect(within(deviceSelect).queryByText(/Living Room Apple TV/i)).not.toBeInTheDocument()
    expect(within(deviceSelect).getByText(/Kids iPad/i)).toBeInTheDocument()

    // Filter for non-existent device
    await user.clear(searchInput)
    await user.type(searchInput, 'no-such-device-xyz')
    expect(within(deviceSelect).queryByText(/Kids iPad/i)).not.toBeInTheDocument()
  })

  it('FB-P6-003 + Backup/Restore + Audit Logs: displays SQLite Storage Size & Record Count, exports/restores config, and loads audit history on StatusPage', async () => {
    const healthWithSqliteStats: SystemHealthResponse = {
      overall_status: 'healthy',
      version: '1.0.0',
      services: {
        sqlite: {
          service: 'sqlite',
          status: 'healthy',
          latency_ms: 0.5,
          message: 'Local SQLite database operational.',
          details: {
            storage_bytes: 65536,
            storage_size_formatted: '64.0 KB',
            total_records: 142,
            devices_count: 61,
            groups_count: 3,
            timers_count: 2,
            schedules_count: 4,
            audit_logs_count: 72,
          },
        },
        opnsense: {
          service: 'opnsense',
          status: 'healthy',
          latency_ms: 120.4,
          message: 'OPNsense API connected.',
          details: { arp_entry_count: 58, dnsmasq_lease_count: 61, blocked_ip_count: 1 },
        },
        elasticsearch: {
          service: 'elasticsearch',
          status: 'healthy',
          latency_ms: 25.1,
          message: 'Elasticsearch connected.',
          details: { es_version: '9.4.3', index_doc_count: 6700000 },
        },
      },
    }

    vi.spyOn(apiClient, 'getSystemHealth').mockResolvedValue(healthWithSqliteStats)
    vi.spyOn(apiClient, 'exportConfigBackup').mockResolvedValue({
      schema_version: '1.0.0',
      exported_at: '2026-11-01T14:00:00Z',
      devices: [
        {
          mac_address: 'AA:BB:CC:DD:EE:10',
          display_name: 'Living Room Apple TV',
          is_youtube_blocked: false,
        },
        {
          mac_address: 'AA:BB:CC:DD:EE:11',
          display_name: 'Kids iPad',
          is_youtube_blocked: true,
        },
      ],
      groups: [],
      schedules: [],
    })
    const restoreSpy = vi.spyOn(apiClient, 'restoreConfigBackup').mockResolvedValue({
      restored_at: '2026-11-01T14:01:00Z',
      devices_updated: 2,
      groups_upserted: 1,
      schedules_upserted: 1,
    })
    vi.spyOn(apiClient, 'getAuditLogs').mockResolvedValue({
      total_count: 1,
      items: [
        {
          id: 501,
          action: 'device.youtube_block',
          actor: 'admin',
          target: '192.168.50.110',
          status: 'success',
          details: 'Blocked YouTube',
          created_at: '2026-11-01T13:55:00Z',
        },
      ],
    })

    const user = userEvent.setup()
    const qc = createTestQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <StatusPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    // Verify FB-P6-003 SQLite Storage Size & Record Count
    expect(await screen.findByTestId('sqlite-storage-size')).toHaveTextContent('64.0 KB')
    expect(screen.getByTestId('sqlite-total-records')).toHaveTextContent('142 records')

    // Click Export Configuration JSON
    await user.click(screen.getByTestId('export-config-btn'))
    expect(await screen.findByTestId('backup-status-message')).toHaveTextContent(
      /Exported 2 devices/i,
    )

    // Upload a JSON file to Restore Configuration JSON
    const fileInput = screen.getByTestId('restore-config-input')
    const validFile = new File(
      [
        JSON.stringify({
          schema_version: '1.0.0',
          exported_at: '2026-11-01T14:00:00Z',
          devices: [],
          groups: [],
          schedules: [],
        }),
      ],
      'backup.json',
      { type: 'application/json' },
    )
    await user.upload(fileInput, validFile)
    await waitFor(() => {
      expect(restoreSpy).toHaveBeenCalled()
      expect(screen.getByTestId('backup-status-message')).toHaveTextContent(
        /Restored 2 devices, 1 groups, and 1 schedules/i,
      )
    })

    // Click Load Audit Logs
    await user.click(screen.getByTestId('load-audit-logs-btn'))
    const auditTable = await screen.findByTestId('audit-logs-table')
    expect(within(auditTable).getByText('device.youtube_block')).toBeInTheDocument()

    // Filter audit logs
    await user.type(screen.getByTestId('audit-search-input'), 'youtube')
    await user.selectOptions(
      screen.getByTestId('audit-action-filter'),
      'device.youtube_block',
    )
  })

  it('FB-P6-004 & FB-P6-005: toggles YouTube blocking on DevicesPage and displays YouTube & Plex usage in AnalyticsPage and Drawers', async () => {
    vi.spyOn(apiClient, 'getSystemHealth').mockResolvedValue({
      overall_status: 'healthy',
      version: '1.0.0',
      services: {
        sqlite: { service: 'sqlite', status: 'healthy', latency_ms: 1, message: 'OK' },
        opnsense: { service: 'opnsense', status: 'healthy', latency_ms: 10, message: 'OK' },
        elasticsearch: {
          service: 'elasticsearch',
          status: 'healthy',
          latency_ms: 8,
          message: 'OK',
        },
      },
    })
    vi.spyOn(apiClient, 'getDevices').mockResolvedValue({
      summary: {
        total_devices: 2,
        online_devices: 2,
        blocked_devices: 0,
        protected_devices: 0,
      },
      last_synced_at: '2026-11-01T14:00:00Z',
      devices: SAMPLE_DEVICES,
    })
    vi.spyOn(apiClient, 'getGroups').mockResolvedValue({
      groups: [SAMPLE_GROUP],
    })
    const blockDeviceYtSpy = vi
      .spyOn(apiClient, 'blockDeviceYoutube')
      .mockResolvedValue({
        device: { ...SAMPLE_DEVICES[0], is_youtube_blocked: true },
        action: 'youtube_block',
        states_killed: true,
        warning: null,
      })
    const blockGroupYtSpy = vi
      .spyOn(apiClient, 'blockGroupYoutube')
      .mockResolvedValue({
        group: { ...SAMPLE_GROUP, youtube_status: 'blocked', youtube_blocked_devices: 2 },
        action: 'youtube_block',
        affected_device_ids: [10, 11],
        affected_ips: ['192.168.50.110', '192.168.50.111'],
        skipped_protected_names: [],
        skipped_no_ip_names: [],
        states_killed_ips: ['192.168.50.110', '192.168.50.111'],
        warnings: [],
      })
    vi.spyOn(apiClient, 'getNetworkOverview').mockResolvedValue({
      window: '24h',
      generated_at: '2026-11-01T14:00:00Z',
      es_reachable: true,
      summary: {
        total_events: 500,
        firewall_event_count: 200,
        dns_query_count: 300,
        blocked_packet_count: 10,
        allowed_packet_count: 190,
        total_bytes: 1048576,
      },
      timeline: [],
      top_devices: [],
      top_domains: [],
      top_registered_domains: [],
      top_organizations: [],
      application_usage: [
        {
          app_key: 'youtube',
          display_name: 'YouTube',
          active_minutes: 95,
          event_count: 240,
          dns_queries: 190,
          bytes: 52428800,
          last_active_at: '2026-11-01T13:50:00Z',
        },
        {
          app_key: 'plex',
          display_name: 'Plex',
          active_minutes: 45,
          event_count: 110,
          dns_queries: 40,
          bytes: 104857600,
          last_active_at: '2026-11-01T13:45:00Z',
        },
      ],
      warning: null,
    })

    const user = userEvent.setup()
    const qc = createTestQueryClient()

    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <DevicesPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    // Verify device YouTube toggle button renders and triggers block mutation
    const deviceYtBtn = await screen.findByTestId('youtube-toggle-10')
    expect(deviceYtBtn).toHaveTextContent('YT Allowed')
    await user.click(deviceYtBtn)
    expect(blockDeviceYtSpy).toHaveBeenCalledWith(10)

    // Verify group YouTube toggle button renders and triggers group block mutation
    const groupYtBtn = await screen.findByTestId('group-youtube-toggle-1')
    expect(groupYtBtn).toHaveTextContent('YT Allowed')
    await user.click(groupYtBtn)
    expect(blockGroupYtSpy).toHaveBeenCalledWith(1)

    unmount()

    // Render AnalyticsPage and verify overview-app-usage-panel shows 1h 35m for YouTube and 45m for Plex
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <AnalyticsPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('overview-app-usage-panel')).toBeInTheDocument()
    expect(screen.getByTestId('overview-app-minutes-youtube')).toHaveTextContent('1h 35m')
    expect(screen.getByTestId('overview-app-minutes-plex')).toHaveTextContent('45m')
  })

  it('renders YouTube & Plex application usage and selective YouTube toggle inside DeviceAnalyticsDrawer and GroupAnalyticsDrawer', async () => {
    vi.spyOn(apiClient, 'getDeviceAnalytics').mockResolvedValue({
      device: SAMPLE_DEVICES[0],
      window: '24h',
      generated_at: '2026-11-01T14:00:00Z',
      es_reachable: true,
      summary: {
        total_events: 100,
        firewall_event_count: 40,
        dns_query_count: 60,
        blocked_packet_count: 0,
        allowed_packet_count: 40,
        total_bytes: 204800,
        active_hours_in_day: 3,
        first_active_at: '2026-11-01T10:00:00Z',
        last_active_at: '2026-11-01T13:30:00Z',
      },
      timeline: [],
      hourly_access_profile: [],
      top_domains: [],
      top_registered_domains: [],
      top_organizations: [],
      recent_queries: [],
      application_usage: [
        {
          app_key: 'youtube',
          display_name: 'YouTube',
          active_minutes: 30,
          event_count: 50,
          dns_queries: 40,
          bytes: 102400,
          last_active_at: '2026-11-01T13:30:00Z',
        },
        {
          app_key: 'plex',
          display_name: 'Plex',
          active_minutes: 60,
          event_count: 80,
          dns_queries: 20,
          bytes: 204800,
          last_active_at: '2026-11-01T13:00:00Z',
        },
      ],
      warning: null,
    })

    vi.spyOn(apiClient, 'getGroupAnalytics').mockResolvedValue({
      group: SAMPLE_GROUP,
      tracked_ips: ['192.168.50.110', '192.168.50.111'],
      window: '24h',
      generated_at: '2026-11-01T14:00:00Z',
      es_reachable: true,
      summary: {
        total_events: 100,
        firewall_event_count: 40,
        dns_query_count: 60,
        blocked_packet_count: 0,
        allowed_packet_count: 40,
        total_bytes: 204800,
        active_hours_in_day: 3,
        first_active_at: '2026-11-01T10:00:00Z',
        last_active_at: '2026-11-01T13:30:00Z',
      },
      timeline: [],
      hourly_access_profile: [],
      top_domains: [],
      top_registered_domains: [],
      top_organizations: [],
      member_breakdown: [],
      recent_queries: [],
      application_usage: [
        {
          app_key: 'youtube',
          display_name: 'YouTube',
          active_minutes: 30,
          event_count: 50,
          dns_queries: 40,
          bytes: 102400,
          last_active_at: '2026-11-01T13:30:00Z',
        },
        {
          app_key: 'plex',
          display_name: 'Plex',
          active_minutes: 60,
          event_count: 80,
          dns_queries: 20,
          bytes: 204800,
          last_active_at: '2026-11-01T13:00:00Z',
        },
      ],
      warning: null,
    })

    const qc = createTestQueryClient()
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <DeviceAnalyticsDrawer deviceId={10} onClose={() => {}} />
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('drawer-app-usage-panel')).toBeInTheDocument()
    expect(screen.getByTestId('drawer-app-minutes-youtube')).toHaveTextContent('30m')
    expect(screen.getByTestId('drawer-app-minutes-plex')).toHaveTextContent('1h')
    expect(screen.getByTestId('drawer-youtube-toggle')).toHaveTextContent(
      /Block YouTube/i,
    )

    unmount()

    render(
      <QueryClientProvider client={qc}>
        <GroupAnalyticsDrawer groupId={1} onClose={() => {}} />
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('group-drawer-app-usage-panel')).toBeInTheDocument()
    expect(screen.getByTestId('group-drawer-app-minutes-youtube')).toHaveTextContent('30m')
    expect(screen.getByTestId('group-drawer-app-minutes-plex')).toHaveTextContent('1h')
    expect(screen.getByTestId('group-drawer-youtube-toggle')).toHaveTextContent(
      /Block YouTube/i,
    )
  })
})
