import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import App from '../App'
import {
  formatBytes,
  type DeviceActionResponse,
  type DeviceAnalyticsResponse,
  type DeviceItem,
  type DeviceListResponse,
  type NetworkOverviewResponse,
  type SystemHealthResponse,
} from '../api/client'

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

const MOCK_DEVICE_1: DeviceItem = {
  id: 1,
  mac_address: 'aa:bb:cc:dd:ee:01',
  ipv4_address: '192.168.1.134',
  hostname: 'office-pc',
  display_name: 'Office Workstation',
  effective_name: 'Office Workstation',
  vendor: 'Intel Corporate',
  interface_name: 'lan',
  lease_type: 'dynamic',
  is_online: true,
  is_blocked: false,
  is_protected: false,
  protection_reason: null,
  notes: '',
  first_seen_at: '2026-10-31T10:00:00Z',
  last_seen_at: '2026-10-31T16:00:00Z',
  updated_at: '2026-10-31T16:00:00Z',
}

const MOCK_DEVICE_LIST: DeviceListResponse = {
  summary: {
    total_devices: 1,
    online_devices: 1,
    blocked_devices: 0,
    protected_devices: 0,
  },
  devices: [MOCK_DEVICE_1],
  last_synced_at: '2026-10-31T16:00:00Z',
}

const MOCK_HEALTH: SystemHealthResponse = {
  overall_status: 'healthy',
  version: '0.4.0',
  services: {
    sqlite: {
      service: 'sqlite',
      status: 'healthy',
      latency_ms: 0.4,
      message: 'SQLite OK',
    },
    opnsense: {
      service: 'opnsense',
      status: 'healthy',
      latency_ms: 120.0,
      message: 'OPNsense OK',
    },
    elasticsearch: {
      service: 'elasticsearch',
      status: 'healthy',
      latency_ms: 25.0,
      message: 'ES OK',
    },
  },
}

const MOCK_DEVICE_ANALYTICS: DeviceAnalyticsResponse = {
  device: MOCK_DEVICE_1,
  window: '24h',
  generated_at: '2026-10-31T16:30:00Z',
  es_reachable: true,
  warning: null,
  summary: {
    total_events: 61912,
    total_bytes: 1048576,
    dns_query_count: 61225,
    firewall_event_count: 687,
    allowed_packet_count: 489,
    blocked_packet_count: 198,
    active_hours_in_day: 14,
    first_active_at: '2026-10-31T01:00:00Z',
    last_active_at: '2026-10-31T16:29:00Z',
  },
  timeline: [
    {
      timestamp: '2026-10-31T15:00:00-07:00',
      total_events: 5274,
      bytes: 524288,
      dns_queries: 5207,
      allowed_packets: 67,
      blocked_packets: 0,
    },
    {
      timestamp: '2026-10-31T16:00:00-07:00',
      total_events: 3407,
      bytes: 524288,
      dns_queries: 3232,
      allowed_packets: 175,
      blocked_packets: 0,
    },
  ],
  hourly_access_profile: Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${h.toString().padStart(2, '0')}:00`,
    total_events: h < 14 ? 2500 : 0,
    dns_queries: h < 14 ? 2400 : 0,
    bytes: h < 14 ? 65536 : 0,
    active_hours_count: h < 14 ? 1 : 0,
  })),
  top_domains: [
    { domain: 'discord.com', query_count: 1294 },
    { domain: 'telemetry.macrium.com', query_count: 850 },
  ],
  top_registered_domains: [
    { domain: 'discord.com', query_count: 1294 },
    { domain: 'macrium.com', query_count: 850 },
  ],
  top_organizations: [
    { organization: 'Cloudflare, Inc.', packet_count: 320, bytes: 524288 },
    { organization: 'Google LLC', packet_count: 169, bytes: 524288 },
  ],
  recent_queries: [
    {
      timestamp: '2026-10-31T16:29:00Z',
      domain: 'gateway.discord.gg',
      registered_domain: 'discord.gg',
      record_type: 'AAAA',
    },
    {
      timestamp: '2026-10-31T16:28:30Z',
      domain: 'telemetry.macrium.com',
      registered_domain: 'macrium.com',
      record_type: 'A',
    },
  ],
}

const MOCK_OVERVIEW: NetworkOverviewResponse = {
  window: '24h',
  generated_at: '2026-10-31T16:30:00Z',
  es_reachable: true,
  warning: null,
  summary: {
    total_events: 450000,
    total_bytes: 52428800,
    dns_query_count: 380000,
    firewall_event_count: 70000,
    allowed_packet_count: 55000,
    blocked_packet_count: 15000,
  },
  timeline: [
    {
      timestamp: '2026-10-31T15:00:00-07:00',
      total_events: 22000,
      bytes: 2097152,
      dns_queries: 18000,
      allowed_packets: 3000,
      blocked_packets: 1000,
    },
  ],
  top_devices: [
    {
      device_id: 1,
      ipv4_address: '192.168.1.134',
      effective_name: 'Office Workstation',
      mac_address: 'aa:bb:cc:dd:ee:01',
      vendor: 'Intel Corporate',
      is_online: true,
      is_blocked: false,
      is_protected: false,
      total_events: 61912,
      bytes: 1048576,
      dns_queries: 61225,
      allowed_packets: 489,
      blocked_packets: 198,
      last_seen_at: '2026-10-31T16:29:00Z',
    },
    {
      device_id: null,
      ipv4_address: '192.168.88.1',
      effective_name: '192.168.88.1',
      mac_address: null,
      vendor: null,
      is_online: false,
      is_blocked: false,
      is_protected: false,
      total_events: 2874,
      bytes: 594918,
      dns_queries: 0,
      allowed_packets: 0,
      blocked_packets: 2874,
      last_seen_at: '2026-10-31T16:25:00Z',
    },
  ],
  top_domains: [
    { domain: 'elasticsearch.example.local', query_count: 143480 },
    { domain: 'discord.com', query_count: 1294 },
  ],
  top_registered_domains: [
    { domain: 'example.local', query_count: 168217 },
    { domain: 'google.com', query_count: 27878 },
  ],
  top_organizations: [
    { organization: 'Google LLC', packet_count: 167955, bytes: 25165824 },
    { organization: 'Amazon.com, Inc.', packet_count: 67861, bytes: 12582912 },
  ],
}

describe('Phase 3 Elasticsearch 9.4.3 Traffic & DNS Analytics UI', () => {
  it('formats byte values cleanly across B, KB, MB, GB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-50)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
  })

  it('opens DeviceAnalyticsDrawer from DevicesPage, displays 24h profile and domains, filters queries, and blocks device', async () => {
    let currentDevice = { ...MOCK_DEVICE_1 }

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'

      if (url.includes('/api/v1/auth/me')) {
        return new Response(
          JSON.stringify({
            username: 'admin',
            authenticated: true,
            expires_at: '2026-11-01T00:00:00Z',
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/system/health')) {
        return new Response(JSON.stringify(MOCK_HEALTH), { status: 200 })
      }
      if (url.endsWith('/api/v1/devices/1/block') && method === 'POST') {
        currentDevice = { ...currentDevice, is_blocked: true }
        const resp: DeviceActionResponse = {
          device: currentDevice,
          action: 'block',
          states_killed: true,
          warning: null,
        }
        return new Response(JSON.stringify(resp), { status: 200 })
      }
      if (url.includes('/api/v1/devices/1/analytics')) {
        const filteredQueries = url.includes('domain_search=discord')
          ? [MOCK_DEVICE_ANALYTICS.recent_queries[0]]
          : MOCK_DEVICE_ANALYTICS.recent_queries
        return new Response(
          JSON.stringify({
            ...MOCK_DEVICE_ANALYTICS,
            device: currentDevice,
            recent_queries: filteredQueries,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/devices')) {
        return new Response(
          JSON.stringify({
            ...MOCK_DEVICE_LIST,
            devices: [currentDevice],
          }),
          { status: 200 },
        )
      }
      return new Response('Not Found', { status: 404 })
    })

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} />)

    await screen.findByTestId('device-row-1')

    // Click "Analytics" button on device 1
    await user.click(screen.getByTestId('view-analytics-btn-1'))

    const drawer = await screen.findByTestId('device-analytics-drawer')
    expect(within(drawer).getByText('Office Workstation')).toBeInTheDocument()

    // Check KPI cards inside drawer
    expect(await screen.findByTestId('drawer-kpi-events')).toHaveTextContent('61,912')
    expect(screen.getByTestId('drawer-kpi-bytes')).toHaveTextContent('1.0 MB')
    expect(screen.getByTestId('drawer-kpi-dns')).toHaveTextContent('61,225')
    expect(screen.getByTestId('drawer-kpi-active-hours')).toHaveTextContent('14 / 24h')

    // Check 24-hour profile and top domains/orgs
    expect(screen.getByTestId('drawer-hourly-profile')).toBeInTheDocument()
    expect(screen.getByTestId('hourly-bar-10')).toBeInTheDocument()
    expect(within(screen.getByTestId('drawer-top-domains')).getByText('discord.com')).toBeInTheDocument()
    expect(within(screen.getByTestId('drawer-top-orgs')).getByText('Cloudflare, Inc.')).toBeInTheDocument()

    // Filter recent domains by "discord"
    const domainFilterInput = screen.getByLabelText(/Filter recent domains/i)
    await user.type(domainFilterInput, 'discord')
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('domain_search=discord'),
        expect.anything(),
      )
    })

    // Switch time window to 7d and click Refresh Telemetry
    await user.click(screen.getByTestId('drawer-window-7d'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('window=7d'),
        expect.anything(),
      )
    })
    await user.click(screen.getByTestId('drawer-refresh-btn'))

    // Toggle block inside the drawer
    await user.click(screen.getByTestId('drawer-access-toggle'))
    await waitFor(() => {
      expect(screen.getByTestId('drawer-access-toggle')).toHaveTextContent('Blocked')
    })

    // Close drawer
    await user.click(screen.getByTestId('close-analytics-drawer'))
    expect(screen.queryByTestId('device-analytics-drawer')).not.toBeInTheDocument()
  })

  it('renders Network Overview tab, switches time windows, and opens DeviceAnalyticsDrawer from Top Devices table', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()

      if (url.includes('/api/v1/auth/me')) {
        return new Response(
          JSON.stringify({
            username: 'admin',
            authenticated: true,
            expires_at: '2026-11-01T00:00:00Z',
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/system/health')) {
        return new Response(JSON.stringify(MOCK_HEALTH), { status: 200 })
      }
      if (url.includes('/api/v1/analytics/overview')) {
        return new Response(JSON.stringify(MOCK_OVERVIEW), { status: 200 })
      }
      if (url.includes('/api/v1/devices/1/analytics')) {
        return new Response(JSON.stringify(MOCK_DEVICE_ANALYTICS), { status: 200 })
      }
      if (url.includes('/api/v1/devices')) {
        return new Response(JSON.stringify(MOCK_DEVICE_LIST), { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    })

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} />)

    await screen.findByTestId('device-row-1')

    // Click "Traffic & DNS Analytics" navigation tab
    await user.click(screen.getByTestId('nav-tab-analytics'))

    expect(
      await screen.findByRole('heading', { name: /Network Traffic & DNS Analytics/i }),
    ).toBeInTheDocument()

    // Wait for overview data to resolve
    expect(await screen.findByTestId('overview-top-devices-table')).toBeInTheDocument()
    expect(screen.getByTestId('overview-kpi-events')).toHaveTextContent('450,000')
    expect(screen.getByTestId('overview-kpi-bytes')).toHaveTextContent('50.0 MB')
    expect(screen.getByTestId('overview-kpi-dns')).toHaveTextContent('380,000')
    expect(screen.getByTestId('overview-kpi-blocked')).toHaveTextContent('15,000')

    // Verify Top Domains, Registered Domains, and ASN Organizations cards
    expect(
      within(screen.getByTestId('overview-top-domains')).getByText('elasticsearch.example.local'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('overview-top-reg-domains')).getByText('example.local'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('overview-top-orgs')).getByText('Google LLC'),
    ).toBeInTheDocument()

    // Switch window to 1h and click Refresh Analytics
    await user.click(screen.getByTestId('overview-window-1h'))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/analytics/overview?window=1h'),
        expect.anything(),
      )
    })
    await user.click(screen.getByTestId('overview-refresh-btn'))

    // Click "Inspect" on row 1 in Top Active LAN Devices table -> opens drawer
    expect(screen.getByTestId('inspect-top-device-1')).toHaveAttribute('aria-label', 'Inspect')
    await user.click(screen.getByTestId('inspect-top-device-1'))
    expect(await screen.findByTestId('device-analytics-drawer')).toBeInTheDocument()
  })

  it('renders Phase 15 Plex Now Playing streams and Plex Integration Settings connectivity test (FB-P9-005 & FB-P14-001..004)', async () => {
    const overviewWithPlex: NetworkOverviewResponse = {
      ...MOCK_OVERVIEW,
      application_usage: [
        {
          app_key: 'youtube',
          display_name: 'YouTube',
          active_minutes: 35,
          event_count: 120,
          dns_queries: 100,
          bytes: 5242880,
          last_active_at: '2026-10-31T16:20:00Z',
          top_devices: [],
        },
        {
          app_key: 'plex',
          display_name: 'Plex',
          active_minutes: 95,
          event_count: 14,
          dns_queries: 12,
          bytes: 104857600,
          last_active_at: '2026-10-31T16:29:00Z',
          top_devices: [
            {
              device_id: 1,
              ipv4_address: '192.168.1.134',
              effective_name: 'LG OLED TV',
              active_minutes: 95,
              event_count: 14,
              dns_queries: 12,
              bytes: 104857600,
            },
          ],
          active_sessions: [
            {
              session_key: 'sess-55',
              client_ip: '192.168.1.134',
              device_id: 1,
              effective_name: 'LG OLED TV',
              player_title: 'LGwebOSTV',
              player_product: 'Plex for LG',
              player_platform: 'webOS',
              state: 'playing',
              user_name: 'family',
              media_title: 'Bluey · S03E01 · Bedroom',
              media_type: 'episode',
              stream_decision: 'direct play',
              bandwidth_kbps: 12000,
              progress_percent: 52.0,
            },
          ],
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'

      if (url.includes('/api/v1/auth/me')) {
        return new Response(
          JSON.stringify({
            username: 'admin',
            role: 'admin',
            authenticated: true,
            expires_at: '2026-11-01T00:00:00Z',
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/system/health')) {
        return new Response(JSON.stringify(MOCK_HEALTH), { status: 200 })
      }
      if (url.includes('/api/v1/analytics/overview')) {
        return new Response(JSON.stringify(overviewWithPlex), { status: 200 })
      }
      if (url.includes('/api/v1/devices/1/analytics')) {
        return new Response(
          JSON.stringify({
            ...MOCK_DEVICE_ANALYTICS,
            application_usage: overviewWithPlex.application_usage,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/system/settings/test-plex') && method === 'POST') {
        return new Response(
          JSON.stringify({
            service: 'plex',
            reachable: true,
            status: 'healthy',
            latency_ms: 11.4,
            message: "Plex Media Server 'HomePlex' (1.41.2) connected (1 active stream(s)).",
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/system/settings')) {
        return new Response(
          JSON.stringify({
            source: 'ui_override',
            opnsense_base_url: 'https://192.168.1.1',
            has_opnsense_api_key: true,
            opnsense_api_key_masked: '••••••••••••',
            has_opnsense_api_secret: true,
            opnsense_api_secret_masked: '••••••••••••',
            opnsense_verify_ssl: false,
            opnsense_ca_cert_path: '',
            opnsense_timeout_seconds: 10,
            opnsense_protected_ips: '192.168.1.1',
            elasticsearch_url: 'https://192.168.1.10:9200',
            has_elasticsearch_api_key: true,
            elasticsearch_api_key_masked: '••••••••••••',
            elasticsearch_verify_ssl: false,
            elasticsearch_ca_cert_path: '',
            elasticsearch_timeout_seconds: 15,
            elasticsearch_index_patterns: 'logs-pfsense.log*',
            plex_base_url: 'http://192.168.1.250:32400',
            has_plex_api_token: true,
            plex_api_token_masked: '••••••••••••',
            plex_verify_ssl: false,
            plex_timeout_seconds: 8,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/devices')) {
        return new Response(JSON.stringify(MOCK_DEVICE_LIST), { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    })

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} />)
    await screen.findByTestId('device-row-1')

    // Navigate to Analytics and verify Plex Now Playing badge & active stream details
    await user.click(screen.getByTestId('nav-tab-analytics'))
    expect(await screen.findByTestId('overview-plex-live-badge')).toHaveTextContent('1 Now Playing')
    expect(screen.getByTestId('overview-plex-now-playing')).toHaveTextContent(
      'Bluey · S03E01 · Bedroom',
    )

    // Open DeviceAnalyticsDrawer and verify drawer Plex Now Playing stream details
    await user.click(screen.getByTestId('inspect-top-device-1'))
    expect(await screen.findByTestId('drawer-plex-now-playing')).toHaveTextContent(
      'Now Playing: Bluey · S03E01 · Bedroom',
    )
    await user.click(screen.getByTestId('close-analytics-drawer'))

    // Navigate to System Status -> Integration Settings and test Plex connection
    await user.click(screen.getByTestId('nav-tab-status'))
    await user.click(await screen.findByTestId('toggle-integration-settings-btn'))
    expect(await screen.findByTestId('input-plex-url')).toHaveValue('http://192.168.1.250:32400')
    await user.click(screen.getByTestId('test-plex-btn'))
    expect(await screen.findByTestId('connectivity-diagnostic-result')).toHaveTextContent(
      'HomePlex',
    )
  })
})

