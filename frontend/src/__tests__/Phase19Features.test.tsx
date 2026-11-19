import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import {
  ApiError,
  apiClient,
  buildGoogleMapsUrl,
  formatActiveMinutes,
  formatBlockedPercentage,
  formatBytes,
  formatClock24h,
  formatRemainingDuration,
  type AllConnectivityTestResponse,
  type AppUsageItem,
  type DeviceAnalyticsResponse,
  type DeviceItem,
  type FirewallOpenPortSessionsResponse,
  type FirewallOverviewResponse,
  type GroupAnalyticsResponse,
  type GroupItem,
  type IntegrationSettingsView,
  type NetworkOverviewResponse,
  type SystemHealthResponse,
} from '../api/client'
import { AuthProvider } from '../context/AuthContext'
import { DeviceAnalyticsDrawer } from '../components/DeviceAnalyticsDrawer'
import { GroupAnalyticsDrawer } from '../components/GroupAnalyticsDrawer'
import { TimerPopoverMenu } from '../components/TimerPopoverMenu'
import { AnalyticsPage } from '../pages/AnalyticsPage'
import { DevicesPage } from '../pages/DevicesPage'
import { FirewallPage } from '../pages/FirewallPage'
import { StatusPage } from '../pages/StatusPage'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  })
}

const HEALTH_REPORT: SystemHealthResponse = {
  overall_status: 'healthy',
  version: '1.3.0-rc3',
  services: {
    opnsense: {
      service: 'opnsense',
      status: 'healthy',
      latency_ms: 21.4,
      message: 'OPNsense REST API reachable',
      details: { arp_entries: 42, version: '26.7.7' },
    },
    elasticsearch: {
      service: 'elasticsearch',
      status: 'healthy',
      latency_ms: 14.0,
      message: 'Elasticsearch 9.4.3 cluster connected',
      details: { cluster_status: 'green', active_shards: 10, version: '9.4.3' },
    },
    sqlite: {
      service: 'sqlite',
      status: 'healthy',
      latency_ms: 0.4,
      message: 'SQLite reachable',
      details: { storage_bytes: 1048576 },
    },
    plex: {
      service: 'plex',
      status: 'healthy',
      latency_ms: 9.2,
      message: 'Plex Media Server connected',
      details: { configured: true, active_sessions: 1 },
    },
  },
}

const INTEGRATION_SETTINGS: IntegrationSettingsView = {
  source: 'env',
  opnsense_base_url: 'https://router.example.local',
  has_opnsense_api_key: true,
  opnsense_api_key_masked: 'opn***',
  has_opnsense_api_secret: true,
  opnsense_api_secret_masked: 'sec***',
  opnsense_verify_ssl: false,
  opnsense_ca_cert_path: '',
  opnsense_timeout_seconds: 10,
  opnsense_protected_ips: '192.168.1.1',
  elasticsearch_url: 'https://es1.example.local:9200, https://es2.example.local:9200',
  has_elasticsearch_api_key: true,
  elasticsearch_api_key_masked: 'es***',
  elasticsearch_verify_ssl: true,
  elasticsearch_ca_cert_path: '/app/certs/ca.pem',
  elasticsearch_timeout_seconds: 25,
  elasticsearch_index_patterns: 'logs-pfsense.log*',
  plex_base_url: 'http://192.168.1.20:32400',
  has_plex_api_token: true,
  plex_api_token_masked: 'plx***',
  plex_verify_ssl: false,
  plex_timeout_seconds: 10,
  enabled_telemetry_apps: ['youtube', 'plex', 'facebook_threads'],
}

const SAMPLE_DEVICE: DeviceItem = {
  id: 1,
  mac_address: 'aa:bb:cc:19:00:01',
  ipv4_address: '192.168.1.50',
  hostname: 'living-room-tv',
  display_name: 'Living Room TV',
  effective_name: 'Living Room TV',
  vendor: 'LG Electronics',
  interface_name: 'lan',
  lease_type: 'static',
  is_online: true,
  is_blocked: false,
  is_youtube_blocked: false,
  is_protected: false,
  is_archived: false,
  protection_reason: null,
  notes: '',
  first_seen_at: '2026-11-01T00:00:00Z',
  last_seen_at: '2026-11-15T12:00:00Z',
  updated_at: '2026-11-15T12:00:00Z',
  groups: [
    {
      id: 10,
      name: 'Living Room',
      color_badge: 'indigo',
      icon: 'tv',
    },
  ],
  active_override: null,
  active_schedule: null,
}

const APP_USAGE_ITEMS: AppUsageItem[] = [
  {
    app_key: 'youtube',
    display_name: 'YouTube',
    active_minutes: 45,
    event_count: 180,
    dns_queries: 120,
    bytes: 52428800,
    last_active_at: '2026-11-15T12:00:00Z',
    top_devices: [
      {
        device_id: 1,
        ipv4_address: '192.168.1.50',
        effective_name: 'Living Room TV',
        active_minutes: 45,
        event_count: 180,
        dns_queries: 120,
        bytes: 52428800,
      },
    ],
  },
  {
    app_key: 'plex',
    display_name: 'Plex',
    active_minutes: 90,
    event_count: 240,
    dns_queries: 30,
    bytes: 2147483648,
    last_active_at: '2026-11-15T12:00:00Z',
    active_sessions: [
      {
        session_key: 'plex-19',
        client_ip: '192.168.1.50',
        device_id: 1,
        effective_name: 'Living Room TV',
        player_title: 'Apple TV 4K Living Room',
        player_product: 'Plex for tvOS',
        player_platform: 'tvOS',
        state: 'playing',
        user_name: 'christian',
        media_title: 'Severance - S02E03 - Who Is Alive? (Very Long Extended Edition Title)',
        media_type: 'episode',
        stream_decision: 'direct play',
        video_resolution: '4k',
        bandwidth_kbps: 24500,
        transcode_bitrate_kbps: 24500,
        progress_percent: 62.5,
      },
    ],
    top_devices: [
      {
        device_id: 1,
        ipv4_address: '192.168.1.50',
        effective_name: 'Living Room TV',
        active_minutes: 90,
        event_count: 240,
        dns_queries: 30,
        bytes: 2147483648,
      },
    ],
  },
  {
    app_key: 'facebook_threads',
    display_name: 'Facebook & Threads',
    active_minutes: 35,
    event_count: 110,
    dns_queries: 95,
    bytes: 18874368,
    last_active_at: '2026-11-15T11:58:00Z',
    top_devices: [
      {
        device_id: 1,
        ipv4_address: '192.168.1.50',
        effective_name: 'Living Room TV',
        active_minutes: 35,
        event_count: 110,
        dns_queries: 95,
        bytes: 18874368,
      },
    ],
  },
]

const NETWORK_OVERVIEW: NetworkOverviewResponse = {
  window: 'today',
  generated_at: '2026-11-15T12:00:00Z',
  es_reachable: true,
  warning: null,
  summary: {
    total_events: 1500,
    total_bytes: 2218721280,
    dns_query_count: 900,
    firewall_event_count: 600,
    allowed_packet_count: 550,
    blocked_packet_count: 50,
  },
  timeline: [
    {
      timestamp: '2026-11-15T11:00:00Z',
      total_events: 1500,
      bytes: 2218721280,
      dns_queries: 900,
      allowed_packets: 550,
      blocked_packets: 50,
    },
  ],
  top_domains: [
    {
      domain: 'graph.instagram.com',
      query_count: 64,
    },
  ],
  top_registered_domains: [
    {
      domain: 'threads.net',
      query_count: 42,
    },
  ],
  top_organizations: [
    {
      organization: 'Meta Platforms, Inc.',
      asn: 32934,
      packet_count: 110,
      bytes: 18874368,
    },
  ],
  top_devices: [
    {
      device_id: 1,
      ipv4_address: '192.168.1.50',
      effective_name: 'Living Room TV',
      mac_address: 'aa:bb:cc:19:00:01',
      vendor: 'LG Electronics',
      is_online: true,
      is_blocked: false,
      is_protected: false,
      total_events: 1500,
      bytes: 2218721280,
      dns_queries: 900,
      allowed_packets: 550,
      blocked_packets: 50,
      last_seen_at: '2026-11-15T12:00:00Z',
    },
  ],
  application_usage: APP_USAGE_ITEMS,
}

const SHARED_ANALYTICS_SUMMARY = {
  total_events: 1500,
  total_bytes: 2218721280,
  dns_query_count: 900,
  firewall_event_count: 600,
  allowed_packet_count: 550,
  blocked_packet_count: 50,
  active_hours_in_day: 4,
  first_active_at: '2026-11-15T08:00:00Z',
  last_active_at: '2026-11-15T12:00:00Z',
}

const DEVICE_ANALYTICS: DeviceAnalyticsResponse = {
  device: SAMPLE_DEVICE,
  window: 'today',
  generated_at: '2026-11-15T12:00:00Z',
  es_reachable: true,
  warning: null,
  summary: SHARED_ANALYTICS_SUMMARY,
  timeline: [],
  hourly_access_profile: [],
  top_domains: [],
  top_registered_domains: [],
  top_organizations: [],
  application_usage: APP_USAGE_ITEMS,
  recent_queries: [],
}

const GROUP_ITEM: GroupItem = {
  id: 10,
  name: 'Living Room',
  description: 'TV and streaming devices',
  color_badge: 'indigo',
  icon: 'tv',
  daily_youtube_limit_minutes: 60,
  today_youtube_minutes: 45,
  total_devices: 1,
  online_devices: 1,
  blocked_devices: 0,
  protected_devices: 0,
  blockable_devices: 1,
  member_device_ids: [1],
  youtube_status: 'allowed',
  access_status: 'allowed',
  members: [],
  active_override: null,
  active_schedule: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-15T12:00:00Z',
}

const GROUP_ANALYTICS: GroupAnalyticsResponse = {
  group: GROUP_ITEM,
  tracked_ips: ['192.168.1.50'],
  window: 'today',
  generated_at: '2026-11-15T12:00:00Z',
  es_reachable: true,
  warning: null,
  summary: SHARED_ANALYTICS_SUMMARY,
  member_breakdown: [],
  timeline: [],
  hourly_access_profile: [],
  top_domains: [],
  top_registered_domains: [],
  top_organizations: [],
  application_usage: APP_USAGE_ITEMS,
  recent_queries: [],
}

const FIREWALL_OVERVIEW: FirewallOverviewResponse = {
  window: 'today',
  generated_at: '2026-11-15T12:00:00Z',
  es_reachable: true,
  warning: null,
  summary: {
    total_packets: 1000,
    allowed_packets: 700,
    blocked_packets: 300,
    inbound_packets: 400,
    outbound_packets: 600,
    total_bytes: 67108864,
    open_wan_port_count: 1,
  },
  timeline: [
    {
      timestamp: '2026-11-15T11:00:00Z',
      total_events: 1000,
      bytes: 67108864,
      dns_queries: 0,
      allowed_packets: 700,
      blocked_packets: 300,
    },
  ],
  noisy_lan_devices: [
    {
      device_id: 1,
      ipv4_address: '192.168.1.50',
      effective_name: 'Living Room TV',
      mac_address: 'aa:bb:cc:19:00:01',
      is_online: true,
      is_blocked: false,
      is_protected: false,
      blocked_packets: 75,
      bytes: 1024000,
      target_ports: [443, 8443],
      last_seen_at: '2026-11-15T12:00:00Z',
    },
  ],
  external_scanners: [
    {
      source_ip: '203.0.113.50',
      organization: 'Scanner Net AS',
      country_name: 'Germany',
      country_iso_code: 'DE',
      city_name: 'Frankfurt am Main',
      location_label: 'Frankfurt am Main, Germany',
      latitude: 50.1109,
      longitude: 8.6821,
      is_wan_blocked: false,
      blocked_packets: 140,
      bytes: 28000,
      target_ports: [22, 3389],
      last_seen_at: '2026-11-15T12:00:00Z',
    },
  ],
  open_wan_ports: [
    {
      device_id: 1,
      destination_ip: '192.168.1.50',
      effective_name: 'Living Room TV',
      external_port: 32400,
      destination_port: 32400,
      port_mapping: '32400:32400',
      rule_description: 'Plex Media Server',
      protocol: 'tcp',
      passed_packets: 420,
      bytes: 52428800,
      unique_external_sources: 2,
      last_seen_at: '2026-11-15T11:59:00Z',
    },
  ],
  recent_events: [
    {
      timestamp: '2026-11-15T12:00:00Z',
      action: 'block',
      direction: 'inbound',
      protocol: 'tcp',
      interface: 'vtnet1',
      source_ip: '203.0.113.50',
      source_name: null,
      source_port: 54321,
      source_org: 'Scanner Net AS',
      destination_ip: '192.168.1.1',
      destination_name: 'Router',
      destination_port: 22,
      destination_org: null,
      bytes: 64,
      rule_id: 'wan-drop',
    },
    {
      timestamp: '2026-11-15T11:58:00Z',
      action: 'pass',
      direction: 'outbound',
      protocol: 'udp',
      interface: 'vtnet0',
      source_ip: '192.168.1.50',
      source_name: 'Living Room TV',
      source_port: 51200,
      source_org: null,
      destination_ip: '1.1.1.1',
      destination_name: 'Cloudflare DNS',
      destination_port: 443,
      destination_org: 'Cloudflare',
      bytes: 1280,
      rule_id: 'lan-pass',
    },
  ],
}

const OPEN_PORT_SESSIONS: FirewallOpenPortSessionsResponse = {
  window: 'today',
  generated_at: '2026-11-15T12:00:00Z',
  es_reachable: true,
  warning: null,
  device_id: 1,
  destination_ip: '192.168.1.50',
  effective_name: 'Living Room TV',
  external_port: 32400,
  destination_port: 32400,
  port_mapping: '32400:32400',
  rule_description: 'Plex Media Server',
  protocol: 'tcp',
  summary: {
    total_passed_packets: 420,
    total_bytes: 52428800,
    unique_external_ips: 2,
    top_country: 'United States',
    country_breakdown: [
      { country_name: 'United States', doc_count: 300 },
      { country_name: 'Canada', doc_count: 120 },
    ],
  },
  external_ips: [
    {
      source_ip: '198.51.100.25',
      organization: 'Example Telecom',
      asn: 64500,
      city_name: 'Seattle',
      region_name: 'Washington',
      country_name: 'United States',
      country_iso_code: 'US',
      continent_name: 'North America',
      location_label: 'Seattle, WA, US',
      latitude: 47.6062,
      longitude: -122.3321,
      is_wan_blocked: false,
      passed_packets: 300,
      bytes: 40000000,
      first_seen_at: '2026-11-15T10:00:00Z',
      last_seen_at: '2026-11-15T12:00:00Z',
      connection_duration_seconds: 7200,
      connection_duration_label: '2h 0m',
      active_duration_minutes: 45,
      source_ports: [51001],
      tcp_flags: 'PA',
      ttl: 52,
    },
    {
      source_ip: '198.51.100.99',
      organization: 'Blocked Scanner Telecom',
      asn: 64510,
      city_name: 'Toronto',
      region_name: 'Ontario',
      country_name: 'Canada',
      country_iso_code: 'CA',
      continent_name: 'North America',
      location_label: 'Toronto, ON, CA',
      latitude: 43.6532,
      longitude: -79.3832,
      is_wan_blocked: true,
      passed_packets: 120,
      bytes: 12428800,
      first_seen_at: '2026-11-15T10:30:00Z',
      last_seen_at: '2026-11-15T11:45:00Z',
      connection_duration_seconds: 4500,
      connection_duration_label: '1h 15m',
      active_duration_minutes: 20,
      source_ports: [51002],
      tcp_flags: 'PA',
      ttl: 50,
    },
  ],
  recent_events: [
    {
      timestamp: '2026-11-15T12:00:00Z',
      source_ip: '198.51.100.25',
      source_port: 51001,
      organization: 'Example Telecom',
      location_label: 'Seattle, WA, US',
      latitude: 47.6062,
      longitude: -122.3321,
      protocol: 'tcp',
      tcp_flags: 'PA',
      ttl: 52,
      bytes: 4096,
      interface: 'vtnet1',
      rule_id: 'plex-nat',
    },
  ],
}

describe('Phase 19 Frontend Features (v1.3.0 Final Release)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    vi.spyOn(apiClient, 'getCurrentUser').mockResolvedValue({
      username: 'admin',
      authenticated: true,
      expires_at: '2026-11-16T00:00:00Z',
      role: 'admin',
      theme_preference: 'default',
    })
    vi.spyOn(apiClient, 'getSystemHealth').mockResolvedValue(HEALTH_REPORT)
    vi.spyOn(apiClient, 'getDevices').mockResolvedValue({
      summary: {
        total_devices: 1,
        online_devices: 1,
        blocked_devices: 0,
        protected_devices: 0,
        archived_devices: 0,
      },
      devices: [SAMPLE_DEVICE],
      last_synced_at: '2026-11-15T12:00:00Z',
    })
    vi.spyOn(apiClient, 'getGroups').mockResolvedValue({ groups: [GROUP_ITEM] })
    vi.spyOn(apiClient, 'getNetworkOverview').mockResolvedValue(NETWORK_OVERVIEW)
    vi.spyOn(apiClient, 'getDeviceAnalytics').mockResolvedValue(DEVICE_ANALYTICS)
    vi.spyOn(apiClient, 'getGroupAnalytics').mockResolvedValue(GROUP_ANALYTICS)
    vi.spyOn(apiClient, 'getBlockedTargets').mockResolvedValue({
      total_count: 0,
      enabled_count: 0,
      items: [],
    })
    vi.spyOn(apiClient, 'getEnabledTelemetryApps').mockResolvedValue({
      enabled_telemetry_apps: ['youtube', 'plex', 'facebook_threads'],
      available_telemetry_apps: [
        'youtube',
        'plex',
        'netflix',
        'disney_plus',
        'twitch',
        'tiktok',
        'discord',
        'facebook_threads',
        'gaming',
      ],
      source: 'ui_override',
    })
    vi.spyOn(apiClient, 'getWanBlockedIps').mockResolvedValue({
      alias_name: 'gateway_wan_blocked_ips',
      ips: ['198.51.100.99'],
      total_count: 1,
    })
  })

  it('FB-P18-009 & FB-P18-011: renders sticky header and opens centered Change My Password modal', async () => {
    const changePwdSpy = vi
      .spyOn(apiClient, 'changeOwnPassword')
      .mockResolvedValue({ status: 'ok', message: 'Password changed.' })

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} initialTab="analytics" />)

    const logoutBtn = await screen.findByRole('button', { name: /Logout/i })
    const header = logoutBtn.closest('header')
    expect(header).toHaveClass('sticky', 'top-0', 'z-40')

    await user.click(screen.getByTestId('header-user-menu-button'))
    await user.click(screen.getByTestId('user-menu-change-password-toggle'))

    const modal = await screen.findByTestId('change-password-modal')
    expect(modal).toBeInTheDocument()

    await user.type(within(modal).getByTestId('current-password-input'), 'CurrentPass1!')
    await user.type(within(modal).getByTestId('new-password-input'), 'UpdatedPass2@')
    await user.type(within(modal).getByTestId('confirm-password-input'), 'UpdatedPass2@')
    await user.click(within(modal).getByTestId('submit-change-password-btn'))

    await waitFor(() => {
      expect(changePwdSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          current_password: 'CurrentPass1!',
          new_password: 'UpdatedPass2@',
        }),
      )
    })
  })

  it('FB-P18-005, FB-P18-006 & FB-P18-008: displays Facebook & Threads, opens AppUsageDetailModal from Analytics & Drawers, and hides mobile columns', async () => {
    const blockYtSpy = vi
      .spyOn(apiClient, 'blockDeviceYoutube')
      .mockResolvedValue({
        device: { ...SAMPLE_DEVICE, is_youtube_blocked: true },
        action: 'youtube_block',
        states_killed: true,
        warning: null,
      })

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} initialTab="analytics" />)

    // Verify dynamic Facebook & Threads card + mobile table cell hiding
    expect(
      await screen.findByTestId('overview-app-card-facebook_threads'),
    ).toHaveTextContent('Facebook & Threads')
    const table = screen.getByTestId('overview-top-devices-table')
    expect(within(table).getByText('IPv4 & Vendor').closest('th')).toHaveClass(
      'hidden',
      'sm:table-cell',
    )
    expect(within(table).getByText('DNS Queries').closest('th')).toHaveClass(
      'hidden',
      'sm:table-cell',
    )
    expect(within(table).getByText('Firewall Bytes').closest('th')).toHaveClass(
      'hidden',
      'sm:table-cell',
    )

    // Click Plex card to expand full untruncated modal
    await user.click(screen.getByTestId('overview-app-card-plex'))
    const modal = await screen.findByTestId('app-usage-detail-modal')
    expect(modal).toHaveTextContent(
      'Severance - S02E03 - Who Is Alive? (Very Long Extended Edition Title)',
    )
    expect(modal).toHaveTextContent('christian')
    expect(modal).toHaveTextContent('24.5 Mbps')
    await user.click(screen.getByTestId('close-app-usage-modal-btn'))
    expect(screen.queryByTestId('app-usage-detail-modal')).not.toBeInTheDocument()

    // Open DeviceAnalyticsDrawer and click card vs YouTube toggle stopPropagation
    await user.click(screen.getByTestId('inspect-top-device-1'))
    const ytCard = await screen.findByTestId('drawer-app-card-youtube')
    expect(screen.getByTestId('drawer-app-card-facebook_threads')).toBeInTheDocument()

    await user.click(screen.getByTestId('drawer-app-youtube-toggle'))
    await waitFor(() => {
      expect(blockYtSpy).toHaveBeenCalledWith(1)
    })
    expect(screen.queryByTestId('app-usage-detail-modal')).not.toBeInTheDocument()

    await user.click(ytCard)
    expect(await screen.findByTestId('app-usage-detail-modal')).toHaveTextContent('YouTube')
    await user.click(screen.getByTestId('close-app-usage-modal-btn'))
    await user.click(screen.getByTestId('close-analytics-drawer'))

    // Group drawer card expansion
    await user.click(screen.getByTestId('nav-tab-devices'))
    await user.click(await screen.findByTestId('group-analytics-btn-10'))
    const groupPlexCard = await screen.findByTestId('group-drawer-app-card-plex')
    await user.click(groupPlexCard)
    expect(await screen.findByTestId('app-usage-detail-modal')).toHaveTextContent('Apple TV 4K')
  })

  it('FB-P18-008, FB-P18-010, FB-P18-012 & FB-P19-006: StatusPage shows dynamic versions, averaged multi-node latency, and syncs 9-app telemetry checkboxes', async () => {
    vi.spyOn(apiClient, 'getIntegrationSettings').mockResolvedValue(INTEGRATION_SETTINGS)
    const getAppsSpy = vi.spyOn(apiClient, 'getEnabledTelemetryApps')
    const updateTelemetrySpy = vi
      .spyOn(apiClient, 'updateEnabledTelemetryApps')
      .mockImplementation(async (apps) => {
        const nextResp = {
          enabled_telemetry_apps: apps,
          available_telemetry_apps: [
            'youtube',
            'plex',
            'netflix',
            'disney_plus',
            'twitch',
            'tiktok',
            'discord',
            'facebook_threads',
            'gaming',
          ] as IntegrationSettingsView['enabled_telemetry_apps'] & string[],
          source: 'ui_override' as const,
        }
        getAppsSpy.mockResolvedValue(nextResp as Awaited<ReturnType<typeof apiClient.getEnabledTelemetryApps>>)
        return nextResp as Awaited<ReturnType<typeof apiClient.updateEnabledTelemetryApps>>
      })
    const updateSettingsSpy = vi
      .spyOn(apiClient, 'updateIntegrationSettings')
      .mockResolvedValue({
        ...INTEGRATION_SETTINGS,
        enabled_telemetry_apps: ['youtube', 'plex', 'facebook_threads', 'netflix'],
      })
    vi.spyOn(apiClient, 'getAuditLogs').mockResolvedValue({
      total_count: 0,
      offset: 0,
      limit: 50,
      items: [],
    })
    const diagResp: AllConnectivityTestResponse = {
      overall_reachable: true,
      results: {
        opnsense: {
          service: 'opnsense',
          reachable: true,
          status: 'healthy',
          latency_ms: 21.4,
          message: 'OK',
          details: {
            node_results: [
              {
                url: 'https://router.example.local',
                reachable: true,
                status: 'healthy',
                latency_ms: 21.4,
                message: 'OK',
              },
            ],
          },
        },
        elasticsearch: {
          service: 'elasticsearch',
          reachable: true,
          status: 'healthy',
          latency_ms: 10.0,
          message: 'OK',
          details: {
            node_results: [
              {
                url: 'https://es1.example.local:9200',
                reachable: true,
                status: 'healthy',
                latency_ms: 10.0,
                message: 'OK',
              },
              {
                url: 'https://es2.example.local:9200',
                reachable: true,
                status: 'healthy',
                latency_ms: 30.0,
                message: 'OK',
              },
            ],
          },
        },
        plex: {
          service: 'plex',
          reachable: true,
          status: 'healthy',
          latency_ms: 9.2,
          message: 'OK',
          details: {
            node_results: [
              {
                url: 'http://192.168.1.20:32400',
                reachable: true,
                status: 'healthy',
                latency_ms: 9.2,
                message: 'OK',
              },
            ],
          },
        },
      },
    }
    vi.spyOn(apiClient, 'testAllConnectivity').mockResolvedValue(diagResp)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthProvider>
          <StatusPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    // Verify FB-P18-010 removed subtitle & message, plus FB-P19-006 dynamic version header
    const esCard = await screen.findByTestId('service-card-elasticsearch')
    expect(
      within(esCard).queryByText('Elasticsearch 9.4.3 cluster connected'),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('status-page-header-description')).toHaveTextContent(
      /OPNsense 26\.7\.7.*Elasticsearch 9\.4\.3/,
    )

    // Check multi-node avg ping latency in Test All modal
    await user.click(screen.getByTestId('toggle-integration-settings-btn'))
    await user.click(await screen.findByTestId('test-all-connectivity-btn'))
    const diagModal = await screen.findByTestId('all-connectivity-diagnostic-result')
    expect(within(diagModal).getByTestId('test-all-service-elasticsearch')).toHaveTextContent(
      'OK (20 ms avg)',
    )
    expect(within(diagModal).getByTestId('test-all-service-opnsense')).toHaveTextContent(
      'OK (21.4 ms)',
    )
    await user.click(screen.getByTestId('close-test-all-modal-btn'))

    // Configure telemetry visibility checkboxes -> persists immediately & via Save Settings
    expect(screen.getByTestId('telemetry-visibility-settings')).toBeInTheDocument()
    const netflixCheckbox = screen.getByTestId('settings-telemetry-app-netflix')
    expect(netflixCheckbox).not.toBeChecked()
    await user.click(netflixCheckbox)
    expect(netflixCheckbox).toBeChecked()
    await waitFor(() => {
      expect(updateTelemetrySpy).toHaveBeenCalledWith([
        'youtube',
        'plex',
        'facebook_threads',
        'netflix',
      ])
    })

    await user.click(screen.getByTestId('save-settings-btn'))
    await waitFor(() => {
      expect(updateSettingsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled_telemetry_apps: expect.arrayContaining([
            'youtube',
            'plex',
            'facebook_threads',
            'netflix',
          ]),
        }),
      )
    })
  })

  it('FB-P19-001, FB-P19-002 & FB-P19-003: renders Firewall GeoIP Google Maps links, WAN IP block/unblock, Noisy LAN inspect drawer, and Packet Log chips/limits/export', async () => {
    vi.spyOn(apiClient, 'getFirewallOverview').mockResolvedValue(FIREWALL_OVERVIEW)
    vi.spyOn(apiClient, 'getFirewallOpenPortSessions').mockResolvedValue(OPEN_PORT_SESSIONS)
    const wanBlockSpy = vi
      .spyOn(apiClient, 'blockExternalWanIp')
      .mockResolvedValue({
        alias_name: 'gateway_wan_blocked_ips',
        ip_address: '203.0.113.50',
        blocked: true,
        ips: ['203.0.113.50'],
        opnsense_synced: true,
        warning: null,
      })
    const wanUnblockSpy = vi
      .spyOn(apiClient, 'unblockExternalWanIp')
      .mockResolvedValue({
        alias_name: 'gateway_wan_blocked_ips',
        ip_address: '198.51.100.99',
        blocked: false,
        ips: [],
        opnsense_synced: true,
        warning: null,
      })

    const createObjectUrlMock = vi.fn(() => 'blob:mock-url')
    const revokeObjectUrlMock = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectUrlMock,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectUrlMock,
      writable: true,
      configurable: true,
    })

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthProvider>
          <FirewallPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    // FB-P19-001: Noisy LAN inspect button & Open WAN port description
    const inspectBtn = await screen.findByTestId('firewall-inspect-device-1')
    expect(screen.getByTestId('firewall-block-device-1')).toHaveClass('h-8', 'w-8')
    expect(screen.getByTestId('firewall-open-port-desc-32400')).toHaveTextContent(
      'Plex Media Server',
    )

    await user.click(inspectBtn)
    expect(await screen.findByTestId('drawer-app-card-youtube')).toBeInTheDocument()
    await user.click(screen.getByTestId('close-analytics-drawer'))

    // FB-P19-002: Scanner GeoIP Google Maps link + WAN block
    const mapLink = screen.getByTestId('firewall-scanner-map-203.0.113.50')
    expect(mapLink).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=50.1109,8.6821',
    )
    expect(mapLink).toHaveAttribute('target', '_blank')

    await user.click(screen.getByTestId('firewall-wan-block-203.0.113.50'))
    await waitFor(() => {
      expect(wanBlockSpy).toHaveBeenCalledWith(
        expect.objectContaining({ ip_address: '203.0.113.50' }),
      )
    })

    // Open Port Drawer: rule desc, Country breakdown, Google Maps link, WAN block & unblock
    await user.click(screen.getByTestId('firewall-open-port-ext-ips-32400'))
    expect(await screen.findByTestId('open-port-drawer-rule-desc')).toHaveTextContent(
      'Plex Media Server',
    )
    expect(screen.getByTestId('open-port-country-breakdown')).toHaveTextContent('United States')
    expect(screen.getByTestId('open-port-geo-map-198.51.100.25')).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=47.6062,-122.3321',
    )
    await user.click(screen.getByTestId('open-port-wan-block-198.51.100.25'))
    await waitFor(() => {
      expect(wanBlockSpy).toHaveBeenCalledWith(
        expect.objectContaining({ ip_address: '198.51.100.25' }),
      )
    })
    await user.click(screen.getByTestId('open-port-wan-block-198.51.100.99'))
    await waitFor(() => {
      expect(wanUnblockSpy).toHaveBeenCalledWith('198.51.100.99')
    })
    await user.click(screen.getByTestId('close-open-port-drawer-btn'))

    // FB-P19-003: Clickable Packet Log cells, removable filter chips, limit select, export CSV/JSON
    await user.click(screen.getByTestId('firewall-cell-src-1'))
    expect(await screen.findByTestId('firewall-chip-source_ip')).toHaveTextContent('192.168.1.50')
    expect(screen.queryByText('203.0.113.50:54321')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('firewall-cell-iface-0'))
    expect(await screen.findByTestId('firewall-chip-interface')).toHaveTextContent('vtnet0')

    await user.click(screen.getByTestId('firewall-chip-remove-source_ip'))
    expect(screen.queryByTestId('firewall-chip-source_ip')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('firewall-clear-filters-btn'))

    await user.selectOptions(screen.getByTestId('firewall-limit-select'), '250')
    await waitFor(() => {
      expect(apiClient.getFirewallOverview).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 250 }),
      )
    })

    await user.click(screen.getByTestId('firewall-export-csv-btn'))
    await user.click(screen.getByTestId('firewall-export-json-btn'))
    expect(createObjectUrlMock).toHaveBeenCalledTimes(2)
    expect(revokeObjectUrlMock).toHaveBeenCalledTimes(2)
  })

  it('FB-P18-007: Auto-refresh timer ticks invoke syncDevices on Devices and refresh=true on Analytics & Firewall', async () => {
    localStorage.setItem('gateway_auto_refresh_interval', '5s')
    const syncSpy = vi.spyOn(apiClient, 'syncDevices').mockResolvedValue({
      summary: {
        total_devices: 1,
        online_devices: 1,
        blocked_devices: 0,
        protected_devices: 0,
        archived_devices: 0,
      },
      devices: [SAMPLE_DEVICE],
      last_synced_at: '2026-11-15T12:05:00Z',
    })
    const overviewSpy = vi
      .spyOn(apiClient, 'getNetworkOverview')
      .mockResolvedValue(NETWORK_OVERVIEW)
    const fwSpy = vi
      .spyOn(apiClient, 'getFirewallOverview')
      .mockResolvedValue(FIREWALL_OVERVIEW)

    const scheduledCallbacks: Array<() => void> = []
    const originalSetInterval = window.setInterval
    vi.spyOn(window, 'setInterval').mockImplementation(((
      fn: TimerHandler,
      ms?: number,
    ) => {
      if (ms === 5000 && typeof fn === 'function') {
        scheduledCallbacks.push(fn as () => void)
      }
      return originalSetInterval(() => {}, ms)
    }) as typeof window.setInterval)

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthProvider>
          <DevicesPage />
          <AnalyticsPage />
          <FirewallPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(scheduledCallbacks.length).toBeGreaterThanOrEqual(3)
    })

    act(() => {
      for (const cb of scheduledCallbacks) {
        cb()
      }
    })

    await waitFor(() => {
      expect(syncSpy).toHaveBeenCalled()
      expect(overviewSpy).toHaveBeenCalledWith(expect.objectContaining({ refresh: true }))
      expect(fwSpy).toHaveBeenCalledWith(expect.objectContaining({ refresh: true }))
    })
  })

  it('FB-P19-004: Analytics Configure Apps modal opens, syncs checkboxes, saves via PUT /system/telemetry-apps, and refreshes', async () => {
    const updateAppsSpy = vi
      .spyOn(apiClient, 'updateEnabledTelemetryApps')
      .mockResolvedValue({
        enabled_telemetry_apps: ['youtube', 'plex', 'facebook_threads', 'netflix'],
        available_telemetry_apps: [
          'youtube',
          'plex',
          'netflix',
          'disney_plus',
          'twitch',
          'tiktok',
          'discord',
          'facebook_threads',
          'gaming',
        ],
        source: 'ui_override',
      })
    const overviewSpy = vi
      .spyOn(apiClient, 'getNetworkOverview')
      .mockResolvedValue(NETWORK_OVERVIEW)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthProvider>
          <AnalyticsPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    const configBtn = await screen.findByTestId('open-telemetry-apps-modal-btn')
    await user.click(configBtn)

    const modal = await screen.findByTestId('telemetry-apps-modal')
    expect(within(modal).getByTestId('telemetry-apps-checkbox-youtube')).toBeChecked()
    expect(within(modal).getByTestId('telemetry-apps-checkbox-netflix')).not.toBeChecked()

    await user.click(within(modal).getByTestId('telemetry-apps-checkbox-netflix'))
    expect(within(modal).getByTestId('telemetry-apps-checkbox-netflix')).toBeChecked()

    await user.click(within(modal).getByTestId('telemetry-apps-save-btn'))
    await waitFor(() => {
      expect(updateAppsSpy).toHaveBeenCalledWith([
        'youtube',
        'plex',
        'facebook_threads',
        'netflix',
      ])
      expect(overviewSpy).toHaveBeenCalledWith(expect.objectContaining({ refresh: true }))
    })
    expect(screen.queryByTestId('telemetry-apps-modal')).not.toBeInTheDocument()
  })

  it('FB-P19-005: Firewall Blocked External WAN IPs panel supports manual add, validation, filter click, and 1-click Unblock', async () => {
    vi.spyOn(apiClient, 'getFirewallOverview').mockResolvedValue(FIREWALL_OVERVIEW)
    const blockSpy = vi.spyOn(apiClient, 'blockExternalWanIp').mockResolvedValue({
      alias_name: 'gateway_wan_blocked_ips',
      ip_address: '203.0.113.77',
      blocked: true,
      ips: ['198.51.100.99', '203.0.113.77'],
      opnsense_synced: true,
      warning: null,
    })
    const unblockSpy = vi.spyOn(apiClient, 'unblockExternalWanIp').mockResolvedValue({
      alias_name: 'gateway_wan_blocked_ips',
      ip_address: '198.51.100.99',
      blocked: false,
      ips: ['203.0.113.77'],
      opnsense_synced: true,
      warning: null,
    })

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthProvider>
          <FirewallPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    const panel = await screen.findByTestId('firewall-wan-blocked-ips-panel')
    expect(within(panel).getByTestId('firewall-wan-blocked-row-198.51.100.99')).toBeInTheDocument()

    // Invalid IP shows inline validation error
    await user.type(within(panel).getByTestId('firewall-wan-manual-ip-input'), 'not-an-ip')
    await user.click(within(panel).getByTestId('firewall-wan-manual-block-btn'))
    expect(within(panel).getByTestId('firewall-wan-manual-error')).toBeInTheDocument()

    // Valid external IP triggers blockExternalWanIp
    await user.clear(within(panel).getByTestId('firewall-wan-manual-ip-input'))
    await user.type(within(panel).getByTestId('firewall-wan-manual-ip-input'), '203.0.113.77')
    await user.type(
      within(panel).getByTestId('firewall-wan-manual-reason-input'),
      'Port scanner',
    )
    await user.click(within(panel).getByTestId('firewall-wan-manual-block-btn'))
    await waitFor(() => {
      expect(blockSpy).toHaveBeenCalledWith({
        ip_address: '203.0.113.77',
        reason: 'Port scanner',
      })
    })

    // 1-click Unblock button in panel calls unblockExternalWanIp
    await user.click(within(panel).getByTestId('firewall-unblock-wan-ip-198.51.100.99'))
    await waitFor(() => {
      expect(unblockSpy).toHaveBeenCalledWith('198.51.100.99')
    })
  })

  it('FB-P19-007 & FB-P19-008: Devices group buttons match Timer dimensions and GroupFormModal renders Current Group Members card with 1-click remove', async () => {
    const updateGroupSpy = vi.spyOn(apiClient, 'updateGroup').mockResolvedValue({
      ...GROUP_ITEM,
      member_device_ids: [],
      total_devices: 0,
      blockable_devices: 0,
      members: [],
    })

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthProvider>
          <DevicesPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    const filterBtn = await screen.findByTestId('group-filter-btn-10')
    const analyticsBtn = screen.getByTestId('group-analytics-btn-10')
    const ytBtn = screen.getByTestId('group-youtube-toggle-10')
    const internetBtn = screen.getByTestId('group-toggle-10')

    for (const btn of [filterBtn, analyticsBtn, ytBtn, internetBtn]) {
      expect(btn).toHaveClass('h-9', 'w-9', 'min-h-9', 'min-w-9', 'p-2')
    }

    // Open Edit Group modal -> verify Current Group Members card & 1-click Remove
    await user.click(screen.getByTestId('group-edit-btn-10'))
    const modal = await screen.findByTestId('group-form-modal')
    const currentMembersCard = within(modal).getByTestId('group-current-members-card')
    expect(currentMembersCard).toHaveTextContent('Current Group Members (1)')
    expect(within(currentMembersCard).getByText('Living Room TV')).toBeInTheDocument()

    await user.click(within(currentMembersCard).getByTestId('group-remove-member-1'))
    expect(currentMembersCard).toHaveTextContent('Current Group Members (0)')

    await user.click(within(modal).getByTestId('save-group-btn'))
    await waitFor(() => {
      expect(updateGroupSpy).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ device_ids: [] }),
      )
    })
  })

  it('Exercises GroupFormModal member search, Select All, quota presets, Remove All, and Delete', async () => {
    const user = userEvent.setup()
    const qc = createTestQueryClient()
    const deleteGroupSpy = vi
      .spyOn(apiClient, 'deleteGroup')
      .mockResolvedValue(undefined)

    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <DevicesPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await user.click(await screen.findByTestId('group-edit-btn-10'))
    const modal = await screen.findByTestId('group-form-modal')

    const quotaSelect = within(modal).getByTestId('group-daily-youtube-limit-select')
    await user.selectOptions(quotaSelect, 'none')
    expect(within(modal).getByTestId('group-daily-youtube-limit-input')).toHaveValue(null)
    await user.selectOptions(quotaSelect, '90')
    expect(within(modal).getByTestId('group-daily-youtube-limit-input')).toHaveValue(90)

    const filterInput = within(modal).getByLabelText('Filter member devices')
    await user.type(filterInput, 'NoSuchDeviceXYZ')
    expect(within(modal).getByText('No devices match your filter.')).toBeInTheDocument()
    await user.clear(filterInput)

    await user.click(within(modal).getByText('Remove All'))
    expect(within(modal).getByTestId('group-current-members-card')).toHaveTextContent(
      'Current Group Members (0)',
    )
    await user.click(within(modal).getByText('Select All Shown'))
    expect(within(modal).getByTestId('group-current-members-card')).toHaveTextContent(
      'Current Group Members (1)',
    )
    await user.click(within(modal).getByText('Clear All'))
    expect(within(modal).getByTestId('group-current-members-card')).toHaveTextContent(
      'Current Group Members (0)',
    )

    const optionCheckbox = within(within(modal).getByTestId('group-member-option-1')).getByRole(
      'checkbox',
    )
    await user.click(optionCheckbox)
    expect(within(modal).getByTestId('group-current-members-card')).toHaveTextContent(
      'Current Group Members (1)',
    )

    await user.click(within(modal).getByTestId('delete-group-btn'))
    await waitFor(() => {
      expect(deleteGroupSpy).toHaveBeenCalledWith(10)
    })
  })

  it('Exercises GroupAnalyticsDrawer controls, member breakdown, recent DNS search, and TimerPopoverMenu', async () => {
    const user = userEvent.setup()
    const qc = createTestQueryClient()
    const onSelectDevice = vi.fn()
    const onClose = vi.fn()
    const futureExpiry = new Date(Date.now() + 20 * 60 * 1000).toISOString()

    const richGroup: GroupItem = {
      ...GROUP_ITEM,
      active_override: {
        id: 77,
        target_type: 'group',
        device_id: null,
        group_id: 10,
        target_name: 'Living Room',
        mode: 'bonus',
        duration_minutes: 30,
        expires_at: futureExpiry,
        remaining_seconds: 1200,
        reason: 'Homework bonus',
        is_active: true,
        created_by: 'admin',
        created_at: '2026-11-15T11:40:00Z',
      },
    }

    const richGroupAnalytics: GroupAnalyticsResponse = {
      ...GROUP_ANALYTICS,
      group: richGroup,
      member_breakdown: [
        {
          device_id: 1,
          effective_name: 'Living Room TV',
          ipv4_address: '192.168.1.50',
          mac_address: 'aa:bb:cc:19:00:01',
          vendor: 'LG Electronics',
          is_online: true,
          is_blocked: false,
          is_protected: false,
          total_events: 1500,
          bytes: 2218721280,
          dns_query_count: 900,
          allowed_packet_count: 550,
          blocked_packet_count: 50,
        },
      ],
      timeline: NETWORK_OVERVIEW.timeline,
      hourly_access_profile: [
        { hour: 11, label: '11:00', total_events: 100, dns_queries: 60, bytes: 1024000, active_hours_count: 1 },
      ],
      top_domains: [{ domain: 'www.youtube.com', query_count: 150 }],
      top_organizations: [{ organization: 'Google LLC', asn: 15169, packet_count: 300, bytes: 5000000 }],
      recent_queries: [
        {
          timestamp: '2026-11-15T12:00:00Z',
          source_ip: '192.168.1.50',
          device_name: 'Living Room TV',
          domain: 'www.youtube.com',
          registered_domain: 'youtube.com',
          record_type: 'A',
        },
      ],
    }

    const getGroupSpy = vi
      .spyOn(apiClient, 'getGroupAnalytics')
      .mockResolvedValue(richGroupAnalytics)
    const blockYtSpy = vi
      .spyOn(apiClient, 'blockGroupYoutube')
      .mockResolvedValue({
        group: { ...richGroup, youtube_status: 'blocked' },
        action: 'youtube_block',
        affected_device_ids: [1],
        affected_ips: ['192.168.1.50'],
        skipped_protected_names: [],
        skipped_no_ip_names: [],
        states_killed_ips: ['192.168.1.50'],
        warnings: [],
      })
    const blockGroupSpy = vi
      .spyOn(apiClient, 'blockGroup')
      .mockResolvedValue({
        group: { ...richGroup, access_status: 'blocked' },
        action: 'block',
        affected_device_ids: [1],
        affected_ips: ['192.168.1.50'],
        skipped_protected_names: [],
        skipped_no_ip_names: [],
        states_killed_ips: ['192.168.1.50'],
        warnings: ['Router sync OK'],
      })
    const startTimerSpy = vi.fn()
    const cancelTimerSpy = vi.fn()

    render(
      <QueryClientProvider client={qc}>
        <GroupAnalyticsDrawer
          groupId={10}
          onClose={onClose}
          onSelectDeviceId={onSelectDevice}
        />
        <TimerPopoverMenu
          targetType="device"
          targetId={1}
          targetName="Living Room TV"
          activeOverride={richGroup.active_override}
          onStartTimer={startTimerSpy}
          onCancelTimer={cancelTimerSpy}
        />
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('group-member-breakdown-1')).toBeInTheDocument()
    expect(screen.getByText('Google LLC')).toBeInTheDocument()
    expect(screen.getAllByText('www.youtube.com').length).toBeGreaterThanOrEqual(1)

    await user.click(screen.getByTestId('group-drawer-window-7d'))
    await user.click(screen.getByTestId('group-drawer-refresh-btn'))
    await waitFor(() => {
      expect(getGroupSpy).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ window: '7d', refresh: true }),
      )
    })

    await user.type(screen.getByLabelText('Filter group recent domains'), 'youtube')
    await waitFor(() => {
      expect(getGroupSpy).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ domain_search: 'youtube' }),
      )
    })

    await user.click(screen.getByTestId('group-drawer-app-youtube-toggle'))
    await waitFor(() => expect(blockYtSpy).toHaveBeenCalledWith(10))

    await user.click(screen.getByTestId('group-drawer-access-toggle'))
    await waitFor(() => expect(blockGroupSpy).toHaveBeenCalledWith(10))

    const youtubeCard = screen.getByTestId('group-drawer-app-card-youtube')
    youtubeCard.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByTestId('app-usage-detail-modal')).toBeInTheDocument()
    await user.click(screen.getByTestId('close-app-usage-modal-btn'))

    // Member click propagates device selection
    await user.click(within(screen.getByTestId('group-member-breakdown-1')).getByRole('button'))
    expect(onSelectDevice).toHaveBeenCalledWith(1)

    // TimerPopoverMenu custom duration + active override cancel + Escape close
    await user.click(screen.getByTestId('open-timer-menu-device-1'))
    const timerPopover = await screen.findByTestId('timer-popover-device-1')
    const minsInput = within(timerPopover).getByTestId('custom-timer-minutes-device-1')
    await user.clear(minsInput)
    await user.type(minsInput, '25')
    await user.click(within(timerPopover).getByTestId('custom-timer-pause-device-1'))
    expect(startTimerSpy).toHaveBeenCalledWith({ mode: 'pause', duration_minutes: 25 })

    await user.click(screen.getByTestId('open-timer-menu-device-1'))
    await user.click(await screen.findByTestId('modal-cancel-timer-device-1'))
    expect(cancelTimerSpy).toHaveBeenCalledWith(77)

    await user.click(screen.getByTestId('open-timer-menu-device-1'))
    expect(await screen.findByTestId('timer-popover-device-1')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('timer-popover-device-1')).not.toBeInTheDocument()
  })

  it('Exercises AnalyticsPage app visibility modal and DeviceAnalyticsDrawer keyboard/refresh flows', async () => {
    const user = userEvent.setup()
    const qc = createTestQueryClient()
    const getDeviceSpy = vi
      .spyOn(apiClient, 'getDeviceAnalytics')
      .mockResolvedValue(DEVICE_ANALYTICS)
    const updateAppsSpy = vi
      .spyOn(apiClient, 'updateEnabledTelemetryApps')
      .mockResolvedValue({
        enabled_telemetry_apps: ['youtube', 'plex', 'facebook_threads', 'twitch'],
        available_telemetry_apps: [
          'youtube',
          'plex',
          'netflix',
          'disney_plus',
          'twitch',
          'tiktok',
          'discord',
          'facebook_threads',
          'gaming',
        ],
        source: 'ui_override',
      })

    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <AnalyticsPage />
          <DeviceAnalyticsDrawer deviceId={1} onClose={() => {}} />
        </AuthProvider>
      </QueryClientProvider>,
    )

    // AnalyticsPage configure telemetry apps modal
    await user.click(await screen.findByTestId('open-telemetry-apps-modal-btn'))
    const appsModal = await screen.findByTestId('telemetry-apps-modal')
    await user.click(within(appsModal).getByTestId('telemetry-apps-checkbox-twitch'))
    await user.click(within(appsModal).getByTestId('telemetry-apps-save-btn'))
    await waitFor(() => {
      expect(updateAppsSpy).toHaveBeenCalledWith([
        'youtube',
        'plex',
        'facebook_threads',
        'twitch',
      ])
    })

    await user.click(screen.getByTestId('open-telemetry-apps-modal-btn'))
    await user.click(await screen.findByTestId('telemetry-apps-cancel-btn'))
    expect(screen.queryByTestId('telemetry-apps-modal')).not.toBeInTheDocument()

    // DeviceAnalyticsDrawer window change + refresh + keyboard Enter on app card
    await user.click(await screen.findByTestId('drawer-window-7d'))
    await user.click(screen.getByTestId('drawer-refresh-btn'))
    await waitFor(() => {
      expect(getDeviceSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ window: '7d', refresh: true }),
      )
    })

    const drawerYtCard = await screen.findByTestId('drawer-app-card-youtube')
    drawerYtCard.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByTestId('app-usage-detail-modal')).toBeInTheDocument()
  })

  it('Exercises apiClient fetch wrappers, query builders, 204/error handling, and formatting helpers', async () => {
    expect(buildGoogleMapsUrl(47.6, -122.3, null)).toContain('47.6,-122.3')
    expect(buildGoogleMapsUrl(null, null, 'Unknown Location')).toBeNull()
    expect(buildGoogleMapsUrl(null, null, 'Seattle, WA')).toContain('Seattle')
    expect(formatActiveMinutes(0)).toBe('0m')
    expect(formatActiveMinutes(60)).toBe('1h')
    expect(formatActiveMinutes(95)).toBe('1h 35m')
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBlockedPercentage(0, 0)).toBe('0.0%')
    expect(formatRemainingDuration(0)).toBe('0m left')
    expect(formatRemainingDuration(7200)).toBe('2h left')
    expect(formatClock24h(null)).toBe('')
    expect(formatClock24h('not-a-date')).toBe('not-a-date')

    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/err-json')) {
        return new Response(JSON.stringify({ detail: 'Bad request detail' }), { status: 400 })
      }
      if (url.includes('/204')) {
        return new Response(null, { status: 204 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      await apiClient.getCurrentUser()
      await apiClient.getSetupStatus()
      await apiClient.blockDevice(1)
      await apiClient.unblockDevice(1)
      await apiClient.blockDeviceYoutube(1)
      await apiClient.unblockDeviceYoutube(1)
      await apiClient.archiveDevice(1)
      await apiClient.restoreDevice(1)
      await apiClient.getGroups()
      await apiClient.blockGroup(10)
      await apiClient.unblockGroup(10)
      await apiClient.blockGroupYoutube(10)
      await apiClient.unblockGroupYoutube(10)
      await apiClient.getGroupAnalytics(10, {
        window: '30d',
        domain_search: 'youtube',
        refresh: true,
      })
      await apiClient.getActiveTimers()
      await apiClient.startDeviceTimer(1, { mode: 'pause', duration_minutes: 30 })
      await apiClient.startGroupTimer(10, { mode: 'bonus', preset: '20m' })
      await apiClient.cancelTimer(77, true)
      await apiClient.getSchedules()
      await apiClient.toggleSchedule(1, true)
      await apiClient.reconcileSchedules()
      await apiClient.getAuditLogs({
        action: 'login',
        audit_label: 'MANUAL',
        search: 'admin',
        offset: 10,
        limit: 25,
      })
      await apiClient.pruneAuditLogs({ retention_days: 7, audit_label: 'MANUAL' })
      await apiClient.getUsers()
      await apiClient.getIntegrationSettings()
      await apiClient.resetIntegrationSettings()
      await apiClient.getEnabledTelemetryApps()
      await apiClient.updateEnabledTelemetryApps(['youtube', 'plex'])
      await apiClient.testOpnsenseConnectivity()
      await apiClient.testAllConnectivity({})
      await apiClient.exportConfigBackup()
      await apiClient.getNetworkOverview({ window: '30d', refresh: true })
      await apiClient.getBlockedTargets()
      await apiClient.toggleBlockedTarget(5)
      await apiClient.getTargetAttribution('domain', 'youtube.com', '7d')
      await apiClient.getDeviceAnalytics(1, {
        window: '7d',
        domain_search: 'plex',
        refresh: true,
      })
      await apiClient.getFirewallOverview({
        window: '24h',
        action: 'block',
        direction: 'in',
        protocol: 'tcp',
        search: '203.0',
        limit: 50,
        refresh: true,
      })
      await apiClient.getWanBlockedIps()
      await apiClient.blockExternalWanIp({ ip_address: '203.0.113.50', reason: 'Scanner' })
      await apiClient.unblockExternalWanIp('203.0.113.50')
      await apiClient.getFirewallOpenPortSessions({
        destination_ip: '192.168.1.50',
        destination_port: 32400,
        external_port: 32400,
        protocol: 'tcp',
        window: '7d',
        search: '198.51',
        refresh: true,
      })

      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
      expect(await apiClient.deleteDevice(1)).toBeUndefined()

      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Denied' }), { status: 403 }),
      )
      await expect(apiClient.deleteGroup(10)).rejects.toThrow(ApiError)

      fetchMock.mockResolvedValueOnce(new Response('Server error', { status: 500 }))
      await expect(apiClient.deleteSchedule(1)).rejects.toThrow('Request failed with status 500')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
