import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import App from '../App'
import type {
  BlockedTargetItem,
  BlockedTargetsListResponse,
  DeviceAnalyticsResponse,
  DeviceItem,
  DeviceListResponse,
  GroupAnalyticsResponse,
  GroupItem,
  NetworkOverviewResponse,
  SystemHealthResponse,
  TargetAttributionResponse,
} from '../api/client'

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

const BASE_HEALTH: SystemHealthResponse = {
  overall_status: 'healthy',
  version: '1.3.0-rc3',
  services: {
    sqlite: {
      service: 'sqlite',
      status: 'healthy',
      latency_ms: 1.5,
      message: 'SQLite connected',
      details: {
        custom_blocked_targets_count: 1,
      },
    },
    opnsense: {
      service: 'opnsense',
      status: 'healthy',
      latency_ms: 14.0,
      message: 'OPNsense reachable',
      details: {},
    },
    elasticsearch: {
      service: 'elasticsearch',
      status: 'healthy',
      latency_ms: 12.0,
      message: 'Elasticsearch 9.4.3 connected',
      details: {},
    },
  },
}

const DEVICES: DeviceItem[] = [
  {
    id: 1,
    mac_address: 'aa:bb:cc:18:00:01',
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
    groups: [{ id: 10, name: 'Kids Profile', color_badge: 'indigo', icon: 'users' }],
    first_seen_at: '2026-11-01T10:00:00Z',
    last_seen_at: '2026-11-15T02:00:00Z',
    updated_at: '2026-11-15T02:00:00Z',
  },
  {
    id: 2,
    mac_address: 'aa:bb:cc:18:00:02',
    ipv4_address: '192.168.1.99',
    hostname: 'sleeping-tablet',
    display_name: 'Offline Tablet',
    effective_name: 'Offline Tablet',
    vendor: 'Apple',
    interface_name: 'lan',
    lease_type: 'dynamic',
    is_online: false,
    is_blocked: false,
    is_youtube_blocked: false,
    is_protected: false,
    is_archived: false,
    protection_reason: null,
    notes: '',
    groups: [],
    first_seen_at: '2026-11-01T10:00:00Z',
    last_seen_at: '2026-11-14T10:00:00Z',
    updated_at: '2026-11-14T10:00:00Z',
  },
]

const GROUPS: GroupItem[] = [
  {
    id: 10,
    name: 'Kids Profile',
    description: 'Kids TVs and tablets',
    color_badge: 'indigo',
    icon: 'users',
    access_status: 'allowed',
    youtube_status: 'blocked',
    youtube_blocked_devices: 1,
    daily_youtube_limit_minutes: 60,
    today_youtube_minutes: 65,
    is_youtube_quota_reached: true,
    total_devices: 1,
    online_devices: 1,
    blocked_devices: 0,
    protected_devices: 0,
    blockable_devices: 1,
    member_device_ids: [1],
    members: [DEVICES[0]],
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-15T02:00:00Z',
  },
]

const INITIAL_BLOCKED_TARGETS: BlockedTargetItem[] = [
  {
    id: 101,
    target_type: 'domain',
    target_value: 'doubleclick.net',
    scope_type: 'global',
    device_id: null,
    device_name: null,
    device_ip: null,
    organization_name: 'Google AdSense',
    reason: 'Ad tracking',
    is_enabled: true,
    created_at: '2026-11-15T01:00:00Z',
    updated_at: '2026-11-15T01:00:00Z',
  },
]

const PLEX_SESSION = {
  session_key: 'sess-901',
  client_ip: '192.168.1.50',
  device_id: 1,
  effective_name: 'Living Room TV',
  player_title: 'LG OLED WebOS',
  player_product: 'Plex for LG',
  player_platform: 'webOS',
  state: 'playing',
  user_name: 'family',
  media_title: 'Inside Out 2',
  media_type: 'movie',
  stream_decision: 'transcode',
  video_resolution: '1080p',
  bandwidth_kbps: 14500,
  transcode_bitrate_kbps: 8400,
  progress_percent: 64.5,
}

const APP_USAGE_8 = [
  {
    app_key: 'youtube' as const,
    display_name: 'YouTube',
    active_minutes: 65,
    event_count: 180,
    dns_queries: 150,
    bytes: 52428800,
    last_active_at: '2026-11-15T02:00:00Z',
    top_devices: [],
  },
  {
    app_key: 'plex' as const,
    display_name: 'Plex',
    active_minutes: 45,
    event_count: 14,
    dns_queries: 10,
    bytes: 104857600,
    last_active_at: '2026-11-15T02:00:00Z',
    top_devices: [],
    active_sessions: [PLEX_SESSION],
  },
  {
    app_key: 'netflix' as const,
    display_name: 'Netflix',
    active_minutes: 30,
    event_count: 90,
    dns_queries: 80,
    bytes: 31457280,
    last_active_at: '2026-11-15T01:55:00Z',
    top_devices: [],
  },
  {
    app_key: 'disney_plus' as const,
    display_name: 'Disney+',
    active_minutes: 20,
    event_count: 60,
    dns_queries: 50,
    bytes: 15728640,
    last_active_at: '2026-11-15T01:40:00Z',
    top_devices: [],
  },
  {
    app_key: 'twitch' as const,
    display_name: 'Twitch',
    active_minutes: 15,
    event_count: 40,
    dns_queries: 35,
    bytes: 10485760,
    last_active_at: '2026-11-15T01:30:00Z',
    top_devices: [],
  },
  {
    app_key: 'tiktok' as const,
    display_name: 'TikTok',
    active_minutes: 12,
    event_count: 55,
    dns_queries: 55,
    bytes: 8388608,
    last_active_at: '2026-11-15T01:20:00Z',
    top_devices: [],
  },
  {
    app_key: 'discord' as const,
    display_name: 'Discord',
    active_minutes: 25,
    event_count: 75,
    dns_queries: 70,
    bytes: 4194304,
    last_active_at: '2026-11-15T01:50:00Z',
    top_devices: [],
  },
  {
    app_key: 'gaming' as const,
    display_name: 'Gaming',
    active_minutes: 50,
    event_count: 210,
    dns_queries: 190,
    bytes: 20971520,
    last_active_at: '2026-11-15T01:58:00Z',
    top_devices: [],
  },
]

const MOCK_OVERVIEW: NetworkOverviewResponse = {
  window: 'today',
  generated_at: '2026-11-15T02:00:00Z',
  es_reachable: true,
  warning: null,
  summary: {
    total_events: 9000,
    total_bytes: 268435456,
    dns_query_count: 7500,
    firewall_event_count: 1500,
    allowed_packet_count: 1200,
    blocked_packet_count: 300,
  },
  timeline: [
    {
      timestamp: '2026-11-15T01:00:00Z',
      total_events: 4500,
      bytes: 134217728,
      dns_queries: 3750,
      allowed_packets: 600,
      blocked_packets: 150,
    },
  ],
  top_devices: [
    {
      device_id: 1,
      ipv4_address: '192.168.1.50',
      effective_name: 'Living Room TV',
      mac_address: 'aa:bb:cc:18:00:01',
      vendor: 'LG Electronics',
      is_online: true,
      is_blocked: false,
      is_protected: false,
      total_events: 7200,
      bytes: 209715200,
      dns_queries: 6100,
      allowed_packets: 1000,
      blocked_packets: 100,
      last_seen_at: '2026-11-15T02:00:00Z',
    },
    {
      device_id: 2,
      ipv4_address: '192.168.1.99',
      effective_name: 'Offline Tablet',
      mac_address: 'aa:bb:cc:18:00:02',
      vendor: 'Apple',
      is_online: false,
      is_blocked: false,
      is_protected: false,
      total_events: 1800,
      bytes: 58720256,
      dns_queries: 1400,
      allowed_packets: 200,
      blocked_packets: 200,
      last_seen_at: '2026-11-14T10:00:00Z',
    },
  ],
  top_domains: [
    { domain: 'ads.tiktok.com', query_count: 420 },
    { domain: 'www.youtube.com', query_count: 980 },
  ],
  top_registered_domains: [{ domain: 'tiktok.com', query_count: 610 }],
  top_organizations: [
    { organization: 'META-NET', asn: 32934, packet_count: 540, bytes: 12582912 },
    { organization: 'CLOUDFLARENET', asn: 13335, packet_count: 200, bytes: 4194304 },
  ],
  application_usage: APP_USAGE_8,
}

const MOCK_DEVICE_ANALYTICS: DeviceAnalyticsResponse = {
  device: DEVICES[0],
  window: 'today',
  generated_at: '2026-11-15T02:00:00Z',
  es_reachable: true,
  warning: null,
  summary: {
    total_events: 7200,
    total_bytes: 209715200,
    dns_query_count: 6100,
    firewall_event_count: 1100,
    allowed_packet_count: 1000,
    blocked_packet_count: 100,
    active_hours_in_day: 6,
    first_active_at: '2026-11-15T00:00:00Z',
    last_active_at: '2026-11-15T02:00:00Z',
  },
  timeline: [],
  hourly_access_profile: [],
  top_domains: [{ domain: 'ads.tiktok.com', query_count: 420 }],
  top_registered_domains: [{ domain: 'tiktok.com', query_count: 610 }],
  top_organizations: [
    { organization: 'META-NET', asn: 32934, packet_count: 540, bytes: 12582912 },
    { organization: 'CLOUDFLARENET', asn: 13335, packet_count: 200, bytes: 4194304 },
  ],
  application_usage: APP_USAGE_8,
  recent_queries: [],
}

const MOCK_GROUP_ANALYTICS: GroupAnalyticsResponse = {
  group: GROUPS[0],
  tracked_ips: ['192.168.1.50'],
  window: 'today',
  generated_at: '2026-11-15T02:00:00Z',
  es_reachable: true,
  warning: null,
  summary: {
    total_events: 7200,
    total_bytes: 209715200,
    dns_query_count: 6100,
    firewall_event_count: 1100,
    allowed_packet_count: 1000,
    blocked_packet_count: 100,
    active_hours_in_day: 6,
    first_active_at: '2026-11-15T00:00:00Z',
    last_active_at: '2026-11-15T02:00:00Z',
  },
  member_breakdown: [
    {
      device_id: 1,
      effective_name: 'Living Room TV',
      ipv4_address: '192.168.1.50',
      mac_address: 'aa:bb:cc:18:00:01',
      vendor: 'LG Electronics',
      is_online: true,
      is_blocked: false,
      is_protected: false,
      total_events: 7200,
      bytes: 209715200,
      dns_query_count: 6100,
      allowed_packet_count: 1000,
      blocked_packet_count: 100,
    },
  ],
  timeline: [],
  hourly_access_profile: [],
  top_domains: [{ domain: 'www.youtube.com', query_count: 980 }],
  top_registered_domains: [{ domain: 'youtube.com', query_count: 980 }],
  top_organizations: [
    { organization: 'Google LLC', asn: 15169, packet_count: 880, bytes: 52428800 },
  ],
  application_usage: APP_USAGE_8,
  recent_queries: [],
}

describe('Phase 18 UI Features (FB-P17-006..008, FB-P18-001..003)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('FB-P17-006/007/008: defaults status filter to Online, persists selection, hides mobile table columns, configures YouTube quota & shows Group Analytics banner', async () => {
    const groupsState: GroupItem[] = GROUPS.map((g) => ({ ...g }))
    let updatedLimitPayload: number | null | undefined

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = (init?.method ?? 'GET').toUpperCase()

      if (url.includes('/api/v1/auth/me')) {
        return new Response(
          JSON.stringify({
            username: 'admin',
            role: 'admin',
            authenticated: true,
            expires_at: '2026-11-16T00:00:00Z',
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/system/health')) {
        return new Response(JSON.stringify(BASE_HEALTH), { status: 200 })
      }
      if (url.includes('/api/v1/devices') && !url.includes('/analytics')) {
        const listResp: DeviceListResponse = {
          summary: {
            total_devices: 2,
            online_devices: 1,
            blocked_devices: 0,
            protected_devices: 0,
            archived_devices: 0,
          },
          devices: DEVICES,
          last_synced_at: '2026-11-15T02:00:00Z',
        }
        return new Response(JSON.stringify(listResp), { status: 200 })
      }
      if (url.includes('/api/v1/groups/10/analytics')) {
        return new Response(JSON.stringify(MOCK_GROUP_ANALYTICS), { status: 200 })
      }
      if (url.match(/\/api\/v1\/groups\/\d+$/) && method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          daily_youtube_limit_minutes?: number | null
        }
        updatedLimitPayload = body.daily_youtube_limit_minutes
        groupsState[0] = {
          ...groupsState[0],
          daily_youtube_limit_minutes: body.daily_youtube_limit_minutes ?? null,
        }
        return new Response(JSON.stringify(groupsState[0]), { status: 200 })
      }
      if (url.includes('/api/v1/groups')) {
        return new Response(JSON.stringify({ groups: groupsState }), { status: 200 })
      }
      if (url.includes('/api/v1/schedules') || url.includes('/api/v1/timers')) {
        return new Response(JSON.stringify({ schedules: [], timers: [] }), { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    })

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} />)

    // FB-P17-008: Defaults to Online only when localStorage is empty
    expect(await screen.findByTestId('device-row-1')).toBeInTheDocument()
    expect(screen.queryByTestId('device-row-2')).not.toBeInTheDocument()

    // FB-P17-007: Secondary columns hidden on small viewports
    expect(screen.getByTestId('sort-col-ipv4').closest('th')).toHaveClass('hidden', 'sm:table-cell')

    // Switch filter to All Devices -> persists to localStorage and reveals offline tablet
    await user.click(screen.getByTestId('filter-pill-all'))
    expect(await screen.findByTestId('device-row-2')).toBeInTheDocument()
    expect(window.localStorage.getItem('gateway_devices_status_filter')).toBe('all')

    // FB-P17-006: Group YouTube Quota Badge visible on Group Card + Edit Quota + GroupAnalyticsDrawer
    expect(screen.getByTestId('group-youtube-quota-badge-10')).toHaveTextContent(
      'YT Today: 65m / 60m',
    )

    await user.click(screen.getByTestId('group-edit-btn-10'))
    const limitSelect = (await screen.findByTestId(
      'group-daily-youtube-limit-select',
    )) as HTMLSelectElement
    await user.selectOptions(limitSelect, '90')
    await user.click(screen.getByTestId('save-group-btn'))
    await waitFor(() => expect(updatedLimitPayload).toBe(90))

    // Open Group Analytics Drawer & verify Quota Banner, 8-app cards, and enhanced Plex Now Playing
    await user.click(screen.getByTestId('group-analytics-btn-10'))
    expect(await screen.findByTestId('group-drawer-youtube-quota-banner')).toHaveTextContent(
      '1h 5m / 1h',
    )
    expect(screen.getByTestId('group-drawer-app-card-netflix')).toBeInTheDocument()
    expect(screen.getByTestId('group-drawer-app-card-gaming')).toBeInTheDocument()
    expect(screen.getByTestId('group-drawer-plex-now-playing')).toHaveTextContent('1080p')
    expect(screen.getByTestId('group-drawer-plex-now-playing')).toHaveTextContent('64.5%')
  })

  it('FB-P18-001/002/003: renders 8 apps & enhanced Plex, searchable Top Active Devices, Client Attribution Modal, and Domain/ASN Blocking controls', async () => {
    let blockedTargets: BlockedTargetItem[] = [...INITIAL_BLOCKED_TARGETS]
    let nextBlockId = 102
    const createPayloads: Array<Record<string, unknown>> = []

    const makeTargetsResp = (): BlockedTargetsListResponse => ({
      total_count: blockedTargets.length,
      enabled_count: blockedTargets.filter((b) => b.is_enabled).length,
      items: blockedTargets,
    })

    const attributionResp: TargetAttributionResponse = {
      target_type: 'domain',
      target_value: 'ads.tiktok.com',
      window: 'today',
      generated_at: '2026-11-15T02:00:00Z',
      es_reachable: true,
      warning: null,
      total_events: 420,
      total_bytes: 12582912,
      clients: [
        {
          device_id: 1,
          ipv4_address: '192.168.1.50',
          effective_name: 'Living Room TV',
          mac_address: 'aa:bb:cc:18:00:01',
          vendor: 'LG Electronics',
          is_online: true,
          is_blocked: false,
          is_protected: false,
          event_count: 420,
          dns_queries: 380,
          bytes: 12582912,
          allowed_packets: 40,
          blocked_packets: 0,
          last_seen_at: '2026-11-15T02:00:00Z',
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = (init?.method ?? 'GET').toUpperCase()

      if (url.includes('/api/v1/auth/me')) {
        return new Response(
          JSON.stringify({
            username: 'admin',
            role: 'admin',
            authenticated: true,
            expires_at: '2026-11-16T00:00:00Z',
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/system/health')) {
        return new Response(JSON.stringify(BASE_HEALTH), { status: 200 })
      }
      if (url.includes('/api/v1/devices/1/analytics')) {
        return new Response(JSON.stringify(MOCK_DEVICE_ANALYTICS), { status: 200 })
      }
      if (url.includes('/api/v1/devices')) {
        return new Response(
          JSON.stringify({
            summary: {
              total_devices: 2,
              online_devices: 1,
              blocked_devices: 0,
              protected_devices: 0,
              archived_devices: 0,
            },
            devices: DEVICES,
            last_synced_at: '2026-11-15T02:00:00Z',
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/groups')) {
        return new Response(JSON.stringify({ groups: GROUPS }), { status: 200 })
      }
      if (url.includes('/api/v1/schedules') || url.includes('/api/v1/timers')) {
        return new Response(JSON.stringify({ schedules: [], timers: [] }), { status: 200 })
      }
      if (url.includes('/api/v1/analytics/overview')) {
        return new Response(JSON.stringify(MOCK_OVERVIEW), { status: 200 })
      }
      if (url.includes('/api/v1/analytics/attribution')) {
        return new Response(JSON.stringify(attributionResp), { status: 200 })
      }
      if (url.match(/\/api\/v1\/analytics\/blocked-targets\/\d+\/toggle/) && method === 'PATCH') {
        const id = Number(url.match(/blocked-targets\/(\d+)\/toggle/)?.[1] ?? '0')
        blockedTargets = blockedTargets.map((b) =>
          b.id === id ? { ...b, is_enabled: !b.is_enabled } : b,
        )
        const item = blockedTargets.find((b) => b.id === id)!
        return new Response(
          JSON.stringify({ item, opnsense_synced: true, warning: null }),
          { status: 200 },
        )
      }
      if (url.match(/\/api\/v1\/analytics\/blocked-targets\/\d+$/) && method === 'DELETE') {
        const id = Number(url.match(/blocked-targets\/(\d+)$/)?.[1] ?? '0')
        blockedTargets = blockedTargets.filter((b) => b.id !== id)
        return new Response(
          JSON.stringify({ deleted_id: id, opnsense_synced: true, warning: null }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/analytics/blocked-targets') && method === 'POST') {
        const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        createPayloads.push(payload)
        const item: BlockedTargetItem = {
          id: nextBlockId++,
          target_type: (payload.target_type as 'domain' | 'asn') ?? 'domain',
          target_value: String(payload.target_value ?? ''),
          scope_type: (payload.scope_type as 'global' | 'device') ?? 'global',
          device_id: (payload.device_id as number | null) ?? null,
          device_name: payload.device_id === 1 ? 'Living Room TV' : null,
          device_ip: payload.device_id === 1 ? '192.168.1.50' : null,
          organization_name: String(payload.organization_name ?? ''),
          reason: String(payload.reason ?? ''),
          is_enabled: true,
          created_at: '2026-11-15T02:01:00Z',
          updated_at: '2026-11-15T02:01:00Z',
        }
        blockedTargets = [item, ...blockedTargets]
        return new Response(
          JSON.stringify({ item, opnsense_synced: true, warning: null }),
          { status: 201 },
        )
      }
      if (url.includes('/api/v1/analytics/blocked-targets')) {
        return new Response(JSON.stringify(makeTargetsResp()), { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    })

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} />)
    await screen.findByTestId('device-row-1')

    await user.click(screen.getByTestId('nav-tab-analytics'))

    // FB-P18-002: All 8 app cards + enhanced Plex Now Playing
    for (const key of [
      'youtube',
      'plex',
      'netflix',
      'disney_plus',
      'twitch',
      'tiktok',
      'discord',
      'gaming',
    ]) {
      expect(await screen.findByTestId(`overview-app-card-${key}`)).toBeInTheDocument()
    }
    const plexCard = screen.getByTestId('overview-plex-now-playing')
    expect(plexCard).toHaveTextContent('Inside Out 2')
    expect(plexCard).toHaveTextContent('1080p')
    expect(plexCard).toHaveTextContent('64.5%')

    // FB-P18-001 KPI count + inline global block + manual block + toggle + unblock
    expect(screen.getByTestId('overview-blocked-targets-count')).toHaveTextContent('1')
    await user.click(screen.getByTestId('block-org-btn-META-NET'))
    await waitFor(() =>
      expect(createPayloads.some((p) => p.target_type === 'asn' && p.target_value === 'AS32934')).toBe(
        true,
      ),
    )

    const panel = screen.getByTestId('blocked-targets-panel')
    expect(within(panel).getByText('doubleclick.net')).toBeInTheDocument()
    expect(within(panel).getByText('AS32934')).toBeInTheDocument()

    // Manual domain add, toggle, and delete
    await user.type(screen.getByTestId('manual-block-value-input'), 'tracker.example.com')
    await user.click(screen.getByTestId('add-blocked-target-btn'))
    await waitFor(() =>
      expect(within(panel).getByText('tracker.example.com')).toBeInTheDocument(),
    )

    await user.click(screen.getByTestId('toggle-blocked-target-btn-101'))
    await waitFor(() => expect(screen.getByTestId('unblock-target-btn-101')).toBeInTheDocument())
    await user.click(screen.getByTestId('unblock-target-btn-101'))
    await waitFor(() =>
      expect(within(panel).queryByText('doubleclick.net')).not.toBeInTheDocument(),
    )

    // FB-P18-003: Search & sort Top Active LAN Devices table
    await user.type(screen.getByTestId('overview-devices-search-input'), 'Tablet')
    expect(screen.queryByTestId('inspect-top-device-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('inspect-top-device-2')).toBeInTheDocument()
    await user.clear(screen.getByTestId('overview-devices-search-input'))
    await user.click(screen.getByTestId('sort-top-devices-dns'))

    // FB-P18-003: Click domain for Client Attribution Drilldown Modal + per-device block
    await user.click(screen.getByTestId('drilldown-domain-ads.tiktok.com'))
    const modal = await screen.findByTestId('attribution-drilldown-modal')
    expect(within(modal).getByText('Living Room TV')).toBeInTheDocument()
    await user.click(screen.getByTestId('attribution-block-device-1'))
    await waitFor(() =>
      expect(
        createPayloads.some(
          (p) => p.target_value === 'ads.tiktok.com' && p.scope_type === 'device' && p.device_id === 1,
        ),
      ).toBe(true),
    )

    // Inspect Device from modal -> opens DeviceAnalyticsDrawer -> verify per-device Block Domain/ASN
    await user.click(screen.getByTestId('attribution-inspect-device-1'))
    expect(await screen.findByTestId('device-analytics-drawer')).toBeInTheDocument()
    expect(await screen.findByTestId('drawer-app-card-netflix')).toBeInTheDocument()
    expect(screen.getByTestId('drawer-plex-now-playing')).toHaveTextContent('1080p')
    await user.click(screen.getByTestId('device-drawer-block-asn-AS13335'))
    await waitFor(() =>
      expect(
        createPayloads.some(
          (p) => p.target_type === 'asn' && p.target_value === 'AS13335' && p.scope_type === 'device',
        ),
      ).toBe(true),
    )
  })
})
