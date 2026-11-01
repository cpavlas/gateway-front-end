import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../context/AuthContext'
import { DevicesPage } from '../pages/DevicesPage'
import {
  type DeviceItem,
  type DeviceListResponse,
  type GroupAnalyticsResponse,
  type GroupBulkActionResponse,
  type GroupItem,
  type GroupListResponse,
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

const MOCK_DEVICES: DeviceItem[] = [
  {
    id: 1,
    mac_address: 'aa:bb:cc:dd:ee:01',
    ipv4_address: '192.168.50.101',
    hostname: 'kids-ipad',
    display_name: 'Kids iPad',
    effective_name: 'Kids iPad',
    vendor: 'Apple, Inc.',
    interface_name: 'lan',
    lease_type: 'dynamic',
    is_blocked: false,
    is_online: true,
    is_protected: false,
    protection_reason: null,
    notes: '',
    groups: [
      { id: 10, name: 'Kids Profile', color_badge: 'indigo', icon: 'users' },
    ],
    first_seen_at: '2026-10-31T10:00:00Z',
    last_seen_at: '2026-10-31T15:00:00Z',
    updated_at: '2026-10-31T15:00:00Z',
  },
  {
    id: 2,
    mac_address: 'aa:bb:cc:dd:ee:02',
    ipv4_address: '192.168.50.102',
    hostname: 'livingroom-tv',
    display_name: 'Living Room OLED',
    effective_name: 'Living Room OLED',
    vendor: 'LG Electronics',
    interface_name: 'lan',
    lease_type: 'static',
    is_blocked: false,
    is_online: true,
    is_protected: false,
    protection_reason: null,
    notes: '',
    groups: [],
    first_seen_at: '2026-10-31T10:00:00Z',
    last_seen_at: '2026-10-31T14:00:00Z',
    updated_at: '2026-10-31T14:00:00Z',
  },
]

const MOCK_GROUPS: GroupItem[] = [
  {
    id: 10,
    name: 'Kids Profile',
    description: 'Kids tablets and laptops',
    color_badge: 'indigo',
    icon: 'users',
    access_status: 'allowed',
    total_devices: 1,
    online_devices: 1,
    blocked_devices: 0,
    protected_devices: 0,
    blockable_devices: 1,
    member_device_ids: [1],
    members: [MOCK_DEVICES[0]],
    created_at: '2026-10-31T10:00:00Z',
    updated_at: '2026-10-31T15:00:00Z',
  },
]

const MOCK_DEVICE_LIST: DeviceListResponse = {
  devices: MOCK_DEVICES,
  summary: {
    total_devices: 2,
    online_devices: 2,
    blocked_devices: 0,
    protected_devices: 0,
  },
  last_synced_at: '2026-10-31T16:00:00Z',
}

const MOCK_GROUP_LIST: GroupListResponse = {
  groups: MOCK_GROUPS,
}

const MOCK_HEALTH: SystemHealthResponse = {
  overall_status: 'healthy',
  version: '0.4.0',
  services: {
    sqlite: { service: 'sqlite', status: 'healthy', latency_ms: 1, message: 'OK' },
    opnsense: { service: 'opnsense', status: 'healthy', latency_ms: 10, message: 'OK' },
    elasticsearch: { service: 'elasticsearch', status: 'healthy', latency_ms: 5, message: 'OK' },
  },
}

const MOCK_GROUP_ANALYTICS: GroupAnalyticsResponse = {
  group: MOCK_GROUPS[0],
  tracked_ips: ['192.168.50.101'],
  window: '24h',
  generated_at: '2026-10-31T17:30:00Z',
  es_reachable: true,
  warning: null,
  summary: {
    total_events: 1200,
    total_bytes: 52428800,
    dns_query_count: 850,
    firewall_event_count: 350,
    allowed_packet_count: 340,
    blocked_packet_count: 10,
    active_hours_in_day: 7,
    first_active_at: '2026-10-31T08:00:00Z',
    last_active_at: '2026-10-31T17:25:00Z',
  },
  member_breakdown: [
    {
      device_id: 1,
      effective_name: 'Kids iPad',
      ipv4_address: '192.168.50.101',
      mac_address: 'aa:bb:cc:dd:ee:01',
      vendor: 'Apple, Inc.',
      is_online: true,
      is_blocked: false,
      is_protected: false,
      total_events: 1200,
      bytes: 52428800,
      dns_query_count: 850,
      allowed_packet_count: 340,
      blocked_packet_count: 10,
    },
  ],
  timeline: [
    {
      timestamp: '2026-10-31T16:00:00Z',
      total_events: 600,
      bytes: 26214400,
      dns_queries: 400,
      allowed_packets: 195,
      blocked_packets: 5,
    },
  ],
  hourly_access_profile: Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, '0')}:00`,
    total_events: h === 16 ? 600 : 0,
    dns_queries: h === 16 ? 400 : 0,
    bytes: h === 16 ? 26214400 : 0,
    active_hours_count: h === 16 ? 1 : 0,
  })),
  top_domains: [{ domain: 'roblox.com', query_count: 210 }],
  top_registered_domains: [{ domain: 'roblox.com', query_count: 210 }],
  top_organizations: [
    { organization: 'Roblox Corporation', packet_count: 180, bytes: 32000000 },
  ],
  recent_queries: [
    {
      timestamp: '2026-10-31T17:20:00Z',
      domain: 'apis.roblox.com',
      registered_domain: 'roblox.com',
      record_type: 'AAAA',
      source_ip: '192.168.50.101',
      device_name: 'Kids iPad',
    },
  ],
}

describe('Phase 4 Device Groups / Profiles, Bulk Toggles & Group Analytics UI', () => {
  it('renders group cards, filters devices by group and unassigned status, and performs bulk block/unblock', async () => {
    const user = userEvent.setup()
    let groupState: GroupItem = { ...MOCK_GROUPS[0] }

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'

      if (url === '/api/v1/auth/me') {
        return new Response(
          JSON.stringify({
            username: 'admin',
            authenticated: true,
            expires_at: '2026-11-01T00:00:00Z',
          }),
          { status: 200 },
        )
      }
      if (url.startsWith('/api/v1/devices')) {
        return new Response(JSON.stringify(MOCK_DEVICE_LIST), { status: 200 })
      }
      if (url === '/api/v1/groups' && method === 'GET') {
        return new Response(JSON.stringify({ groups: [groupState] }), { status: 200 })
      }
      if (url === '/api/v1/system/health') {
        return new Response(JSON.stringify(MOCK_HEALTH), { status: 200 })
      }
      if (url === '/api/v1/groups/10/block' && method === 'POST') {
        groupState = { ...groupState, access_status: 'blocked', blocked_devices: 1 }
        const resp: GroupBulkActionResponse = {
          group: groupState,
          action: 'block',
          affected_device_ids: [1],
          affected_ips: ['192.168.50.101'],
          skipped_protected_names: ['OPNsense Gateway'],
          skipped_no_ip_names: [],
          states_killed_ips: ['192.168.50.101'],
          warnings: ['Skipped protected device(s): OPNsense Gateway'],
        }
        return new Response(JSON.stringify(resp), { status: 200 })
      }
      if (url === '/api/v1/groups/10/unblock' && method === 'POST') {
        groupState = { ...groupState, access_status: 'allowed', blocked_devices: 0 }
        const resp: GroupBulkActionResponse = {
          group: groupState,
          action: 'unblock',
          affected_device_ids: [1],
          affected_ips: ['192.168.50.101'],
          skipped_protected_names: [],
          skipped_no_ip_names: [],
          states_killed_ips: [],
          warnings: [],
        }
        return new Response(JSON.stringify(resp), { status: 200 })
      }
      return new Response(JSON.stringify({ detail: 'Not mocked' }), { status: 404 })
    })

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthProvider>
          <DevicesPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('group-card-10')).toBeInTheDocument()
    expect(screen.getByTestId('group-status-10')).toHaveTextContent('Allowed')

    // Filter devices by clicking Group Filter button
    await user.click(screen.getByTestId('group-filter-btn-10'))
    expect(screen.getByTestId('device-row-1')).toBeInTheDocument()
    expect(screen.queryByTestId('device-row-2')).not.toBeInTheDocument()

    // Clear group filter and filter by Unassigned
    await user.click(screen.getByLabelText('Clear group filter'))
    await user.click(screen.getByTestId('filter-pill-unassigned'))
    expect(screen.queryByTestId('device-row-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('device-row-2')).toBeInTheDocument()

    // Bulk Block group
    await user.click(screen.getByTestId('group-toggle-10'))
    await waitFor(() => {
      expect(screen.getByTestId('group-status-10')).toHaveTextContent('Blocked')
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Skipped protected device(s): OPNsense Gateway',
    )

    // Bulk Allow group
    await user.click(screen.getByTestId('group-toggle-10'))
    await waitFor(() => {
      expect(screen.getByTestId('group-status-10')).toHaveTextContent('Allowed')
    })
  })

  it('opens GroupFormModal to create, edit, and delete a group and opens GroupAnalyticsDrawer', async () => {
    const user = userEvent.setup()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = init?.method ?? 'GET'

      if (url === '/api/v1/auth/me') {
        return new Response(
          JSON.stringify({
            username: 'admin',
            authenticated: true,
            expires_at: '2026-11-01T00:00:00Z',
          }),
          { status: 200 },
        )
      }
      if (url.startsWith('/api/v1/devices')) {
        return new Response(JSON.stringify(MOCK_DEVICE_LIST), { status: 200 })
      }
      if (url === '/api/v1/groups' && method === 'GET') {
        return new Response(JSON.stringify(MOCK_GROUP_LIST), { status: 200 })
      }
      if (url === '/api/v1/groups' && method === 'POST') {
        return new Response(
          JSON.stringify({
            ...MOCK_GROUPS[0],
            id: 20,
            name: 'Media Room',
            color_badge: 'emerald',
          }),
          { status: 201 },
        )
      }
      if (url === '/api/v1/groups/10' && method === 'PATCH') {
        return new Response(
          JSON.stringify({
            ...MOCK_GROUPS[0],
            name: 'Kids Updated',
          }),
          { status: 200 },
        )
      }
      if (url === '/api/v1/groups/10' && method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      if (url.startsWith('/api/v1/groups/10/analytics')) {
        return new Response(JSON.stringify(MOCK_GROUP_ANALYTICS), { status: 200 })
      }
      if (url === '/api/v1/system/health') {
        return new Response(JSON.stringify(MOCK_HEALTH), { status: 200 })
      }
      return new Response(JSON.stringify({ detail: 'Not mocked' }), { status: 404 })
    })

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <AuthProvider>
          <DevicesPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('group-card-10')).toBeInTheDocument()

    // 1. Open Create Group Modal
    await user.click(screen.getByTestId('new-group-btn'))
    expect(await screen.findByTestId('group-form-modal')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Group \/ Profile Name/i), 'Media Room')
    await user.click(screen.getByTestId('group-color-emerald'))
    await user.click(screen.getByTestId('group-member-option-2'))
    await user.click(screen.getByTestId('save-group-btn'))
    await waitFor(() => {
      expect(screen.queryByTestId('group-form-modal')).not.toBeInTheDocument()
    })

    // 2. Open Edit Group Modal & Delete Group
    await user.click(screen.getByTestId('group-edit-btn-10'))
    expect(await screen.findByTestId('group-form-modal')).toBeInTheDocument()
    await user.click(screen.getByTestId('delete-group-btn'))
    await waitFor(() => {
      expect(screen.queryByTestId('group-form-modal')).not.toBeInTheDocument()
    })

    // Open Group Analytics Drawer & also test drawer bulk toggle
    await user.click(screen.getByTestId('group-analytics-btn-10'))
    expect(await screen.findByTestId('group-analytics-drawer')).toBeInTheDocument()
    expect(await screen.findByTestId('group-drawer-kpi-bytes')).toHaveTextContent('50.0 MB')
    expect(screen.getByTestId('group-drawer-kpi-dns')).toHaveTextContent('850')
    expect(screen.getByTestId('group-member-breakdown-1')).toHaveTextContent('Kids iPad')
    expect(screen.getByText('apis.roblox.com')).toBeInTheDocument()
    expect(screen.getByText('Roblox Corporation')).toBeInTheDocument()

    // Switch time window in drawer
    await user.click(screen.getByTestId('group-drawer-window-7d'))
    await user.type(screen.getByLabelText('Filter group recent domains'), 'roblox')

    // Click member device inside breakdown to switch to DeviceAnalyticsDrawer
    const breakdownCard = screen.getByTestId('group-member-breakdown-1')
    await user.click(within(breakdownCard).getByRole('button', { name: 'Kids iPad' }))
    expect(screen.queryByTestId('group-analytics-drawer')).not.toBeInTheDocument()
  })
})
