import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  apiClient,
  formatActiveMinutes,
  formatBlockedPercentage,
  formatClock24h,
  type DeviceItem,
  type GroupItem,
  type SystemHealthResponse,
} from '../api/client'
import {
  formatCompactCount,
  formatTimelineAxisTick,
} from '../components/TelemetryBarChart'
import { AuthProvider } from '../context/AuthContext'
import { AppLayout } from '../components/AppLayout'
import { ScheduleFormModal } from '../components/ScheduleFormModal'
import { LoginPage } from '../pages/LoginPage'
import { StatusPage } from '../pages/StatusPage'
import { DevicesPage } from '../pages/DevicesPage'
import { AnalyticsPage } from '../pages/AnalyticsPage'
import { FirewallPage } from '../pages/FirewallPage'
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
    ipv4_address: '192.168.1.110',
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
    ipv4_address: '192.168.1.111',
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
          onClose={() => { }}
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
          target: '192.168.1.110',
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
        affected_ips: ['192.168.1.110', '192.168.1.111'],
        skipped_protected_names: [],
        skipped_no_ip_names: [],
        states_killed_ips: ['192.168.1.110', '192.168.1.111'],
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
      tracked_ips: ['192.168.1.110', '192.168.1.111'],
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
        <DeviceAnalyticsDrawer deviceId={10} onClose={() => { }} />
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
        <GroupAnalyticsDrawer groupId={1} onClose={() => { }} />
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('group-drawer-app-usage-panel')).toBeInTheDocument()
    expect(screen.getByTestId('group-drawer-app-minutes-youtube')).toHaveTextContent('30m')
    expect(screen.getByTestId('group-drawer-app-minutes-plex')).toHaveTextContent('1h')
    expect(screen.getByTestId('group-drawer-youtube-toggle')).toHaveTextContent(
      /Block YouTube/i,
    )
  })

  it('Phase 8 (FB-P8-002..007): renders Top 3 App Devices, Blocked %, Stacked/Total Bar Chart toggle & X/Y axes, ES Cluster/Shard Health, and Last Updated clocks', async () => {
    expect(formatBlockedPercentage(0, 0)).toBe('0.0%')
    expect(formatBlockedPercentage(10, 190)).toBe('5.0%')
    expect(formatClock24h(null)).toBe('')
    expect(formatClock24h('2026-11-01T14:05:09Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(formatCompactCount(450)).toBe('450')
    expect(formatCompactCount(2500)).toBe('2.5k')
    expect(formatCompactCount(45000)).toBe('45k')
    expect(formatCompactCount(1500000)).toBe('1.5M')
    expect(formatTimelineAxisTick('2026-11-01T14:00:00Z', '24h')).toMatch(/^\d{2}:\d{2}$/)
    expect(formatTimelineAxisTick('2026-11-01T14:00:00Z', '7d')).toMatch(/^\d{2}\/\d{2}$/)

    vi.spyOn(apiClient, 'getSystemHealth').mockResolvedValue({
      overall_status: 'healthy',
      version: '1.0.2',
      services: {
        sqlite: { service: 'sqlite', status: 'healthy', latency_ms: 1, message: 'OK' },
        opnsense: { service: 'opnsense', status: 'healthy', latency_ms: 10, message: 'OK' },
        elasticsearch: {
          service: 'elasticsearch',
          status: 'healthy',
          latency_ms: 8,
          message: 'Elasticsearch 9.4.3 connected.',
          details: {
            es_version: '9.4.3',
            index_doc_count: 6900000,
            cluster_status: 'green',
            assigned_shards: 1638,
            unassigned_shards: 0,
            relocating_shards: 0,
          },
        },
      },
    })

    vi.spyOn(apiClient, 'getNetworkOverview').mockResolvedValue({
      window: '24h',
      generated_at: '2026-11-01T14:00:00Z',
      es_reachable: true,
      summary: {
        total_events: 500,
        firewall_event_count: 200,
        dns_query_count: 300,
        blocked_packet_count: 50,
        allowed_packet_count: 150,
        total_bytes: 1048576,
      },
      timeline: [
        {
          timestamp: '2026-11-01T12:00:00Z',
          total_events: 250,
          dns_queries: 150,
          allowed_packets: 80,
          blocked_packets: 20,
          bytes: 524288,
        },
        {
          timestamp: '2026-11-01T13:00:00Z',
          total_events: 250,
          dns_queries: 150,
          allowed_packets: 70,
          blocked_packets: 30,
          bytes: 524288,
        },
      ],
      top_devices: [],
      top_domains: [],
      top_registered_domains: [],
      top_organizations: [],
      application_usage: [
        {
          app_key: 'youtube',
          display_name: 'YouTube',
          active_minutes: 80,
          event_count: 240,
          dns_queries: 190,
          bytes: 52428800,
          last_active_at: '2026-11-01T13:50:00Z',
          top_devices: [
            {
              device_id: 10,
              ipv4_address: '192.168.1.110',
              effective_name: 'Living Room Apple TV',
              active_minutes: 60,
              event_count: 180,
              dns_queries: 140,
              bytes: 40000000,
            },
            {
              device_id: 11,
              ipv4_address: '192.168.1.111',
              effective_name: 'Kids iPad',
              active_minutes: 20,
              event_count: 60,
              dns_queries: 50,
              bytes: 12428800,
            },
          ],
        },
        {
          app_key: 'plex',
          display_name: 'Plex',
          active_minutes: 5,
          event_count: 15,
          dns_queries: 10,
          bytes: 10485760,
          last_active_at: '2026-11-01T13:45:00Z',
          top_devices: [],
        },
      ],
      warning: null,
    })

    const user = userEvent.setup()
    const qc = createTestQueryClient()
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <AnalyticsPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    // Wait for overview query to finish loading
    expect(await screen.findByTestId('overview-app-usage-panel')).toBeInTheDocument()

    // Verify Blocked Firewall Packets % (50 / 200 = 25.0%)
    expect(screen.getByTestId('overview-kpi-blocked-pct')).toHaveTextContent('(25.0%)')

    // Verify Top 3 Devices list under YouTube & Plex
    const ytTopDevices = screen.getByTestId('overview-app-top-devices-youtube')
    expect(within(ytTopDevices).getByText('Living Room Apple TV')).toBeInTheDocument()
    expect(within(ytTopDevices).getByText('1h')).toBeInTheDocument()
    expect(within(ytTopDevices).getByText('Kids iPad')).toBeInTheDocument()
    expect(within(ytTopDevices).getByText('20m')).toBeInTheDocument()

    // Verify Last Updated clock below Refresh Analytics button
    expect(screen.getByTestId('overview-last-updated')).toHaveTextContent(/Updated:/i)

    // Verify Bar Chart X/Y Axes and Stacked | Total toggle
    expect(screen.getByTestId('overview-timeline-y-axis')).toHaveTextContent('Events')
    expect(screen.getByTestId('overview-timeline-x-axis')).toHaveTextContent('Time (24H Window)')
    expect(screen.getAllByTestId('timeline-dns-segment').length).toBeGreaterThan(0)
    await user.click(screen.getByTestId('overview-timeline-mode-total'))
    expect(screen.getAllByTestId('timeline-total-segment').length).toBeGreaterThan(0)
    await user.click(screen.getByTestId('overview-timeline-mode-stacked'))

    unmount()

    // Render StatusPage and verify Elasticsearch Cluster Health & Shard breakdown
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <StatusPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('es-cluster-shard-stats')).toBeInTheDocument()
    expect(screen.getByTestId('es-cluster-status')).toHaveTextContent('green')
    expect(screen.getByTestId('es-shards-assigned')).toHaveTextContent('1,638')
    expect(screen.getByTestId('es-shards-unassigned')).toHaveTextContent('0')
    expect(screen.getByTestId('es-shards-relocating')).toHaveTextContent('0')
    expect(screen.getByTestId('status-last-updated')).toHaveTextContent(/Updated:/i)
  })

  it('Phase 9 (FB-P9-001): renders First-Boot admin password creation workflow on LoginPage and submits setupInitialAdmin', async () => {
    vi.spyOn(apiClient, 'getCurrentUser').mockRejectedValue(new Error('401'))
    const setupSpy = vi.spyOn(apiClient, 'setupInitialAdmin').mockResolvedValue({
      username: 'admin',
      authenticated: true,
      expires_at: '2026-11-04T23:59:59Z',
      role: 'admin',
      theme_preference: 'default',
    })

    const user = userEvent.setup()
    const qc = createTestQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <LoginPage initialSetupRequired={true} />
        </AuthProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('first-boot-setup-form')).toBeInTheDocument()

    // Short password triggers validation alert
    await user.type(screen.getByLabelText(/New Administrator Password/i), 'short')
    await user.click(screen.getByTestId('setup-admin-submit-btn'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i)

    // Mismatched confirmation password triggers validation alert
    const pwdInput = screen.getByLabelText(/New Administrator Password/i)
    const confirmInput = screen.getByLabelText(/Confirm New Password/i)
    await user.clear(pwdInput)
    await user.type(pwdInput, 'StrongFirstBoot!2026')
    await user.type(confirmInput, 'DifferentPass!2026')
    await user.click(screen.getByTestId('setup-admin-submit-btn'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i)

    // Matching passwords submit setupInitialAdmin
    await user.clear(confirmInput)
    await user.type(confirmInput, 'StrongFirstBoot!2026')
    await user.click(screen.getByTestId('setup-admin-submit-btn'))
    await waitFor(() => {
      expect(setupSpy).toHaveBeenCalledWith({
        password: 'StrongFirstBoot!2026',
        confirm_password: 'StrongFirstBoot!2026',
      })
    })
  })

  it('Phase 9 (FB-P9-002, FB-P9-003, FB-P9-004): manages Integration Settings, Connectivity Diagnostics, Multi-User Accounts, and Audit Labels on StatusPage', async () => {
    vi.spyOn(apiClient, 'getSystemHealth').mockResolvedValue({
      overall_status: 'healthy',
      version: '1.0.3',
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
    vi.spyOn(apiClient, 'getIntegrationSettings').mockResolvedValue({
      source: 'env',
      opnsense_base_url: 'https://192.168.1.1',
      has_opnsense_api_key: true,
      opnsense_api_key_masked: '••••••••',
      has_opnsense_api_secret: true,
      opnsense_api_secret_masked: '••••••••',
      opnsense_verify_ssl: false,
      opnsense_ca_cert_path: '',
      opnsense_timeout_seconds: 10,
      opnsense_protected_ips: '192.168.1.1',
      elasticsearch_url: 'https://192.168.1.10:9200',
      has_elasticsearch_api_key: true,
      elasticsearch_api_key_masked: '••••••••',
      elasticsearch_verify_ssl: false,
      elasticsearch_ca_cert_path: '',
      elasticsearch_timeout_seconds: 10,
      elasticsearch_index_patterns: 'logs-pfsense.log*',
    })
    const updateSettingsSpy = vi
      .spyOn(apiClient, 'updateIntegrationSettings')
      .mockResolvedValue({
        source: 'ui_override',
        opnsense_base_url: 'https://192.168.1.254',
        has_opnsense_api_key: true,
        opnsense_api_key_masked: '••••••••',
        has_opnsense_api_secret: true,
        opnsense_api_secret_masked: '••••••••',
        opnsense_verify_ssl: false,
        opnsense_ca_cert_path: '',
        opnsense_timeout_seconds: 10,
        opnsense_protected_ips: '192.168.1.1',
        elasticsearch_url: 'https://192.168.1.10:9200',
        has_elasticsearch_api_key: true,
        elasticsearch_api_key_masked: '••••••••',
        elasticsearch_verify_ssl: false,
        elasticsearch_ca_cert_path: '',
        elasticsearch_timeout_seconds: 10,
        elasticsearch_index_patterns: 'logs-pfsense.log*',
      })
    const resetSettingsSpy = vi
      .spyOn(apiClient, 'resetIntegrationSettings')
      .mockResolvedValue({
        source: 'env',
        opnsense_base_url: 'https://192.168.1.1',
        has_opnsense_api_key: true,
        opnsense_api_key_masked: '••••••••',
        has_opnsense_api_secret: true,
        opnsense_api_secret_masked: '••••••••',
        opnsense_verify_ssl: false,
        opnsense_ca_cert_path: '',
        opnsense_timeout_seconds: 10,
        opnsense_protected_ips: '192.168.1.1',
        elasticsearch_url: 'https://192.168.1.10:9200',
        has_elasticsearch_api_key: true,
        elasticsearch_api_key_masked: '••••••••',
        elasticsearch_verify_ssl: false,
        elasticsearch_ca_cert_path: '',
        elasticsearch_timeout_seconds: 10,
        elasticsearch_index_patterns: 'logs-pfsense.log*',
      })
    vi.spyOn(apiClient, 'testOpnsenseConnectivity').mockResolvedValue({
      service: 'opnsense',
      reachable: false,
      status: 'unhealthy',
      latency_ms: 42.5,
      message: 'HTTP 403 Forbidden',
      error_diagnostic: 'HTTP 403 Authentication/Authorization Rejected',
      troubleshooting_hint: 'Verify svc_gateway_ui ACL privileges.',
    })
    vi.spyOn(apiClient, 'testElasticsearchConnectivity').mockResolvedValue({
      service: 'elasticsearch',
      reachable: true,
      status: 'healthy',
      latency_ms: 11.2,
      message: 'Elasticsearch 9.4.3 connected.',
    })

    vi.spyOn(apiClient, 'getUsers').mockResolvedValue({
      users: [
        {
          id: 1,
          username: 'admin',
          role: 'admin',
          is_active: true,
          is_protected_admin: true,
          theme_preference: 'default',
          created_at: '2026-11-01T00:00:00Z',
          updated_at: '2026-11-01T00:00:00Z',
        },
        {
          id: 2,
          username: 'operator_1',
          role: 'operator',
          is_active: true,
          is_protected_admin: false,
          theme_preference: 'default',
          created_at: '2026-11-02T00:00:00Z',
          updated_at: '2026-11-02T00:00:00Z',
        },
      ],
    })
    const createUserSpy = vi.spyOn(apiClient, 'createUser').mockResolvedValue({
      id: 3,
      username: 'operator_2',
      role: 'operator',
      is_active: true,
      is_protected_admin: false,
      theme_preference: 'default',
      created_at: '2026-11-04T00:00:00Z',
      updated_at: '2026-11-04T00:00:00Z',
    })
    const updateUserSpy = vi.spyOn(apiClient, 'updateUser').mockResolvedValue({
      id: 2,
      username: 'operator_1',
      role: 'operator',
      is_active: false,
      is_protected_admin: false,
      theme_preference: 'default',
      created_at: '2026-11-02T00:00:00Z',
      updated_at: '2026-11-04T00:00:00Z',
    })
    const deleteUserSpy = vi.spyOn(apiClient, 'deleteUser').mockResolvedValue({
      deleted_user_id: 2,
      username: 'operator_1',
    })
    vi.spyOn(apiClient, 'getAuditLogs').mockResolvedValue({
      total_count: 1,
      items: [
        {
          id: 901,
          actor: 'admin',
          action: 'diagnostic.opnsense',
          audit_label: 'DIAGNOSTIC_ERROR',
          target: 'https://192.168.1.254',
          status: 'failed',
          details: 'HTTP 403 Forbidden',
          created_at: '2026-11-04T01:00:00Z',
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

    // 1. Expand Integration Settings & Connectivity Diagnostics
    await user.click(await screen.findByTestId('toggle-integration-settings-btn'))
    expect(await screen.findByTestId('input-opnsense-url')).toHaveValue('https://192.168.1.1')

    // Test OPNsense connectivity failure -> displays diagnostic & hint
    await user.click(screen.getByTestId('test-opnsense-btn'))
    expect(await screen.findByTestId('connectivity-diagnostic-result')).toHaveTextContent(
      /FAILED/i,
    )
    expect(screen.getByTestId('diagnostic-error-detail')).toHaveTextContent(/403/i)
    expect(screen.getByTestId('diagnostic-troubleshooting-hint')).toHaveTextContent(
      /svc_gateway_ui/i,
    )

    // Test Elasticsearch connectivity success
    await user.click(screen.getByTestId('test-elasticsearch-btn'))
    await waitFor(() => {
      expect(screen.getByTestId('connectivity-diagnostic-result')).toHaveTextContent(
        /REACHABLE/i,
      )
    })

    // Save Integration Settings & Reset to .env Defaults
    await user.clear(screen.getByTestId('input-opnsense-url'))
    await user.type(screen.getByTestId('input-opnsense-url'), 'https://192.168.1.254')
    await user.click(screen.getByTestId('save-settings-btn'))
    await waitFor(() => {
      expect(updateSettingsSpy).toHaveBeenCalled()
    })
    await user.click(screen.getByTestId('reset-settings-btn'))
    await waitFor(() => {
      expect(resetSettingsSpy).toHaveBeenCalled()
    })

    // 2. Expand User Accounts & Access Management
    await user.click(screen.getByTestId('toggle-user-management-btn'))
    expect(await screen.findByTestId('protected-admin-badge')).toHaveTextContent(
      'Protected Default Admin',
    )
    expect(screen.getByTestId('toggle-user-active-admin')).toBeDisabled()
    expect(screen.getByTestId('delete-user-admin')).toBeDisabled()

    // Create new user
    await user.type(screen.getByTestId('new-user-username'), 'operator_2')
    await user.type(screen.getByTestId('new-user-password'), 'OperatorPass!123')
    await user.click(screen.getByTestId('create-user-submit-btn'))
    await waitFor(() => {
      expect(createUserSpy).toHaveBeenCalled()
    })

    // Toggle active and delete non-admin user
    await user.click(screen.getByTestId('toggle-user-active-operator_1'))
    await waitFor(() => {
      expect(updateUserSpy).toHaveBeenCalledWith(2, { is_active: false })
    })
    await user.click(screen.getByTestId('delete-user-operator_1'))
    await waitFor(() => {
      expect(deleteUserSpy).toHaveBeenCalledWith(2)
    })

    // 3. Load Audit Logs & verify Audit Label badge + filter
    await user.click(screen.getByTestId('load-audit-logs-btn'))
    expect(await screen.findByTestId('audit-label-badge')).toHaveTextContent(
      'DIAGNOSTIC_ERROR',
    )
    await user.selectOptions(
      screen.getByTestId('audit-label-filter'),
      'DIAGNOSTIC_ERROR',
    )
  })

  it('Phase 10 (FB-P10-001): renders Firewall & Security tab, KPIs, timeline, noisy LAN 1-click block, open WAN ports, and log explorer', async () => {
    vi.spyOn(apiClient, 'getSystemHealth').mockResolvedValue({
      overall_status: 'healthy',
      version: '1.0.4',
      services: {
        sqlite: { service: 'sqlite', status: 'healthy', latency_ms: 1, message: 'OK' },
        opnsense: { service: 'opnsense', status: 'healthy', latency_ms: 8, message: 'OK' },
        elasticsearch: {
          service: 'elasticsearch',
          status: 'healthy',
          latency_ms: 6,
          message: 'OK',
        },
      },
    })

    const firewallSpy = vi.spyOn(apiClient, 'getFirewallOverview').mockResolvedValue({
      window: '24h',
      generated_at: '2026-11-04T15:30:00Z',
      es_reachable: true,
      warning: null,
      summary: {
        total_packets: 2500,
        allowed_packets: 2000,
        blocked_packets: 500,
        inbound_packets: 600,
        outbound_packets: 1900,
        total_bytes: 5242880,
        open_wan_port_count: 1,
      },
      timeline: [
        {
          timestamp: '2026-11-04T14:00:00Z',
          total_events: 1500,
          bytes: 3145728,
          dns_queries: 0,
          allowed_packets: 1200,
          blocked_packets: 300,
        },
        {
          timestamp: '2026-11-04T15:00:00Z',
          total_events: 1000,
          bytes: 2097152,
          dns_queries: 0,
          allowed_packets: 800,
          blocked_packets: 200,
        },
      ],
      noisy_lan_devices: [
        {
          device_id: 10,
          ipv4_address: '192.168.1.55',
          effective_name: 'Garage IoT Camera',
          mac_address: 'AA:BB:CC:DD:EE:55',
          is_online: true,
          is_blocked: false,
          is_protected: false,
          blocked_packets: 320,
          bytes: 32000,
          target_ports: [443, 8883],
          last_seen_at: '2026-11-04T15:28:00Z',
        },
      ],
      external_scanners: [
        {
          source_ip: '185.220.101.9',
          organization: 'Tor Exit Node Org',
          blocked_packets: 180,
          bytes: 10800,
          target_ports: [22, 3389],
          last_seen_at: '2026-11-04T15:25:00Z',
        },
      ],
      open_wan_ports: [
        {
          device_id: 20,
          destination_ip: '192.168.1.200',
          effective_name: 'Media NAS Server',
          destination_port: 32400,
          protocol: 'tcp',
          passed_packets: 45,
          bytes: 512000,
          unique_external_sources: 3,
          last_seen_at: '2026-11-04T15:20:00Z',
        },
      ],
      recent_events: [
        {
          timestamp: '2026-11-04T15:28:00Z',
          action: 'block',
          direction: 'outbound',
          protocol: 'tcp',
          interface: 'vtnet1',
          source_ip: '192.168.1.55',
          source_name: 'Garage IoT Camera',
          source_port: 51234,
          source_org: null,
          destination_ip: '93.184.216.34',
          destination_name: null,
          destination_port: 443,
          destination_org: 'Edgecast',
          bytes: 60,
          rule_id: 'rule-101',
        },
      ],
    })

    const blockSpy = vi.spyOn(apiClient, 'blockDevice').mockResolvedValue({
      device: {
        id: 10,
        mac_address: 'AA:BB:CC:DD:EE:55',
        ipv4_address: '192.168.1.55',
        hostname: 'iot-camera',
        display_name: 'Garage IoT Camera',
        effective_name: 'Garage IoT Camera',
        interface_name: 'lan',
        lease_type: 'dynamic',
        protection_reason: null,
        notes: '',
        vendor: null,
        is_online: true,
        is_blocked: true,
        is_youtube_blocked: false,
        is_protected: false,
        first_seen_at: '2026-11-01T00:00:00Z',
        last_seen_at: '2026-11-04T15:28:00Z',
        updated_at: '2026-11-04T15:30:00Z',
      },
      action: 'block',
      // reconciled_ip removed
      states_killed: true,
      warning: null,
    })

    const user = userEvent.setup()
    const qc = createTestQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <FirewallPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    // Verify KPIs
    expect(await screen.findByTestId('firewall-kpi-total-packets')).toHaveTextContent(
      '2,500',
    )
    expect(screen.getByTestId('firewall-kpi-allowed-packets')).toHaveTextContent(
      '2,000',
    )
    expect(screen.getByTestId('firewall-kpi-blocked-pct')).toHaveTextContent('(20.0%)')
    expect(screen.getByTestId('firewall-kpi-open-ports')).toHaveTextContent(
      '1 Open WAN Ports',
    )
    expect(screen.getByTestId('firewall-last-updated')).toHaveTextContent(/Updated:/i)

    // Verify Auto-Refresh Interval Selector (FB-P10-002)
    const autoRefreshSelect = screen.getByTestId('firewall-auto-refresh-select')
    expect(autoRefreshSelect).toHaveValue('30s')
    await user.selectOptions(autoRefreshSelect, '5s')
    expect(autoRefreshSelect).toHaveValue('5s')
    await user.selectOptions(autoRefreshSelect, 'off')
    expect(autoRefreshSelect).toHaveValue('off')
    expect(screen.getByTestId('firewall-open-port-row-32400')).toHaveTextContent(
      '32400:32400 / TCP',
    )

    // Verify Timeline Bar Chart (Allowed vs Blocked segments + Stacked | Total toggle)
    expect(screen.getByTestId('firewall-timeline-y-axis')).toHaveTextContent('Events')
    expect(screen.getAllByTestId('timeline-allowed-segment').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('timeline-blocked-segment').length).toBeGreaterThan(0)
    await user.click(screen.getByTestId('firewall-timeline-mode-total'))
    expect(screen.getAllByTestId('timeline-total-segment').length).toBeGreaterThan(0)

    // Verify Noisy LAN Device & 1-click Block Device button
    expect(
      within(screen.getByTestId('firewall-noisy-lan-list')).getByText(
        'Garage IoT Camera',
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByTestId('firewall-block-device-10'))
    await waitFor(() => {
      expect(blockSpy).toHaveBeenCalledWith(10)
    })
    expect(await screen.findByTestId('firewall-action-banner')).toHaveTextContent(
      /Blocked Garage IoT Camera/i,
    )

    // Verify External Scanners & Open Inbound WAN Exposure table
    expect(
      within(screen.getByTestId('firewall-external-scanners-list')).getByText(
        '185.220.101.9',
      ),
    ).toBeInTheDocument()
    expect(screen.getByTestId('firewall-open-port-row-32400')).toHaveTextContent(
      'Media NAS Server',
    )

    // Verify Searchable & Filterable Firewall Log Explorer
    expect(screen.getByTestId('firewall-events-table')).toHaveTextContent('Edgecast')
    await user.selectOptions(screen.getByTestId('firewall-action-filter'), 'block')
    await user.selectOptions(
      screen.getByTestId('firewall-direction-filter'),
      'outbound',
    )
    await user.selectOptions(screen.getByTestId('firewall-protocol-filter'), 'tcp')
    await user.type(screen.getByTestId('firewall-search-input'), '443')
    await user.click(screen.getByTestId('firewall-refresh-btn'))
    await waitFor(() => {
      expect(firewallSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          window: '24h',
          action: 'block',
          direction: 'outbound',
          protocol: 'tcp',
          search: '443',
          refresh: true,
        }),
      )
    })
  })
})
