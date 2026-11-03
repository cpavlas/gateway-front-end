import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import App from '../App'
import {
  type DeviceActionResponse,
  type DeviceItem,
  type DeviceListResponse,
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
    ipv4_address: '192.168.1.101',
    hostname: 'kids-ipad',
    display_name: null,
    effective_name: 'kids-ipad',
    vendor: 'Apple, Inc.',
    interface_name: 'lan',
    lease_type: 'dynamic',
    is_blocked: false,
    is_online: true,
    is_protected: false,
    protection_reason: null,
    notes: '',
    first_seen_at: '2026-10-31T10:00:00Z',
    last_seen_at: '2026-10-31T15:00:00Z',
    updated_at: '2026-10-31T15:00:00Z',
  },
  {
    id: 2,
    mac_address: 'aa:bb:cc:dd:ee:02',
    ipv4_address: '192.168.1.102',
    hostname: 'livingroom-tv',
    display_name: 'Living Room OLED',
    effective_name: 'Living Room OLED',
    vendor: 'LG Electronics',
    interface_name: 'lan',
    lease_type: 'static',
    is_blocked: true,
    is_online: false,
    is_protected: false,
    protection_reason: null,
    notes: '',
    first_seen_at: '2026-10-31T10:00:00Z',
    last_seen_at: '2026-10-31T14:00:00Z',
    updated_at: '2026-10-31T14:00:00Z',
  },
  {
    id: 3,
    mac_address: 'aa:bb:cc:dd:ee:03',
    ipv4_address: '192.168.1.1',
    hostname: 'gateway',
    display_name: 'OPNsense Gateway',
    effective_name: 'OPNsense Gateway',
    vendor: 'Netgate',
    interface_name: 'lan',
    lease_type: 'static',
    is_blocked: false,
    is_online: true,
    is_protected: true,
    protection_reason: 'Configured in OPNSENSE_PROTECTED_IPS (192.168.1.1)',
    notes: '',
    first_seen_at: '2026-10-31T10:00:00Z',
    last_seen_at: '2026-10-31T15:00:00Z',
    updated_at: '2026-10-31T15:00:00Z',
  },
]

const MOCK_DEVICE_LIST_RESPONSE: DeviceListResponse = {
  devices: MOCK_DEVICES,
  summary: {
    total_devices: 3,
    online_devices: 2,
    blocked_devices: 1,
    protected_devices: 1,
  },
  last_synced_at: '2026-10-31T15:30:00Z',
}

const MOCK_HEALTHY_REPORT: SystemHealthResponse = {
  overall_status: 'healthy',
  version: '0.4.0',
  services: {
    sqlite: {
      service: 'sqlite',
      status: 'healthy',
      latency_ms: 0.42,
      message: 'Local SQLite database operational.',
    },
    opnsense: {
      service: 'opnsense',
      status: 'healthy',
      latency_ms: 150.0,
      message: 'OPNsense API connected.',
    },
    elasticsearch: {
      service: 'elasticsearch',
      status: 'healthy',
      latency_ms: 25.0,
      message: 'Elasticsearch connected.',
    },
  },
}

describe('Phase 2 Devices & Internet Access Control Dashboard', () => {
  it('renders KPI summary cards, device list, client-side search, and status filter pills', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
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
        return new Response(JSON.stringify(MOCK_HEALTHY_REPORT), { status: 200 })
      }
      if (url.includes('/api/v1/devices')) {
        return new Response(JSON.stringify(MOCK_DEVICE_LIST_RESPONSE), { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    })

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} />)

    expect(
      await screen.findByRole('heading', { name: /Network Device Inventory & Access Control/i }),
    ).toBeInTheDocument()

    // Wait for devices query to resolve
    expect(await screen.findByTestId('device-row-1')).toBeInTheDocument()

    // Check KPI summary cards
    expect(within(screen.getByTestId('kpi-total')).getByText('3')).toBeInTheDocument()
    expect(within(screen.getByTestId('kpi-online')).getByText('2')).toBeInTheDocument()
    expect(within(screen.getByTestId('kpi-blocked')).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByTestId('kpi-protected')).getByText('1')).toBeInTheDocument()

    // Check all 3 rows rendered
    expect(screen.getByTestId('device-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('device-row-2')).toBeInTheDocument()
    expect(screen.getByTestId('device-row-3')).toBeInTheDocument()

    // Filter by "Blocked" pill
    await user.click(screen.getByTestId('filter-pill-blocked'))
    expect(screen.queryByTestId('device-row-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('device-row-2')).toBeInTheDocument()

    // Filter by "Protected" pill
    await user.click(screen.getByTestId('filter-pill-protected'))
    expect(screen.queryByTestId('device-row-2')).not.toBeInTheDocument()
    expect(screen.getByTestId('device-row-3')).toBeInTheDocument()

    // Filter by "Online" pill
    await user.click(screen.getByTestId('filter-pill-online'))
    expect(screen.getByTestId('device-row-1')).toBeInTheDocument()
    expect(screen.queryByTestId('device-row-2')).not.toBeInTheDocument()

    // Back to "All" pill and test search bar
    await user.click(screen.getByTestId('filter-pill-all'))
    const searchInput = screen.getByLabelText(/Search devices/i)
    await user.type(searchInput, 'OLED')
    expect(screen.queryByTestId('device-row-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('device-row-2')).toBeInTheDocument()

    // Search for non-existent string -> empty state
    await user.clear(searchInput)
    await user.type(searchInput, 'non-existent-device-xyz')
    expect(screen.getByTestId('devices-empty')).toBeInTheDocument()
  })

  it('supports inline nickname editing, protection toggling, and manual OPNsense sync', async () => {
    let currentDevices: DeviceItem[] = [...MOCK_DEVICES]

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
        return new Response(JSON.stringify(MOCK_HEALTHY_REPORT), { status: 200 })
      }
      if (url.endsWith('/api/v1/devices/1') && method === 'PATCH') {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          display_name?: string | null
          is_protected?: boolean
        }
        const updated: DeviceItem = {
          ...currentDevices[0],
          ...(body.display_name !== undefined
            ? {
                display_name: body.display_name,
                effective_name: body.display_name ?? currentDevices[0].hostname ?? 'Unknown',
              }
            : {}),
          ...(body.is_protected !== undefined
            ? {
                is_protected: body.is_protected,
                protection_reason: body.is_protected ? 'Marked protected by administrator' : null,
              }
            : {}),
        }
        currentDevices = [updated, currentDevices[1], currentDevices[2]]
        return new Response(JSON.stringify(updated), { status: 200 })
      }
      if (url.includes('/api/v1/devices/sync') && method === 'POST') {
        return new Response(
          JSON.stringify({
            ...MOCK_DEVICE_LIST_RESPONSE,
            devices: currentDevices,
          }),
          { status: 200 },
        )
      }
      if (url.includes('/api/v1/devices')) {
        return new Response(
          JSON.stringify({
            ...MOCK_DEVICE_LIST_RESPONSE,
            devices: currentDevices,
          }),
          { status: 200 },
        )
      }
      return new Response('Not Found', { status: 404 })
    })

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} />)

    await screen.findByTestId('device-row-1')

    // Click edit nickname on device 1, then cancel first to test cancel button
    await user.click(screen.getByLabelText(/Edit name for kids-ipad/i))
    const nameInput = screen.getByLabelText(/Device nickname input/i)
    await user.type(nameInput, 'Temp Name')
    await user.click(screen.getByLabelText(/Cancel nickname edit/i))
    expect(screen.queryByLabelText(/Device nickname input/i)).not.toBeInTheDocument()

    // Edit nickname and save
    await user.click(screen.getByLabelText(/Edit name for kids-ipad/i))
    const nameInput2 = screen.getByLabelText(/Device nickname input/i)
    await user.clear(nameInput2)
    await user.type(nameInput2, 'Kids iPad Pro')
    await user.click(screen.getByLabelText(/Save nickname/i))

    await waitFor(() => {
      expect(within(screen.getByTestId('device-row-1')).getByText('Kids iPad Pro')).toBeInTheDocument()
    })

    // Toggle protection on device 1
    await user.click(screen.getByTestId('protect-toggle-1'))
    await waitFor(() => {
      expect(screen.getByTestId('protect-toggle-1')).toHaveTextContent('Protected')
    })

    // Verify immutable infrastructure IP (device 3) protection button is disabled
    expect(screen.getByTestId('protect-toggle-3')).toBeDisabled()
    expect(screen.getByTestId('access-toggle-3')).toBeDisabled()

    // Trigger manual OPNsense sync
    await user.click(screen.getByRole('button', { name: /Sync from OPNsense/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/devices/sync',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('blocks and unblocks internet access, displays partial kill_states warnings, and navigates tabs', async () => {
    let currentDevices: DeviceItem[] = [...MOCK_DEVICES]

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
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
        return new Response(JSON.stringify(MOCK_HEALTHY_REPORT), { status: 200 })
      }
      if (url.endsWith('/api/v1/devices/1/block') && method === 'POST') {
        const blockedDevice1: DeviceItem = {
          ...currentDevices[0],
          is_blocked: true,
        }
        currentDevices = [blockedDevice1, currentDevices[1], currentDevices[2]]
        const blockActionResp: DeviceActionResponse = {
          device: blockedDevice1,
          action: 'block',
          states_killed: false,
          warning: 'IP was added to blocked_devices, but active states could not be flushed.',
        }
        return new Response(JSON.stringify(blockActionResp), { status: 200 })
      }
      if (url.endsWith('/api/v1/devices/2/unblock') && method === 'POST') {
        const unblockedDevice2: DeviceItem = {
          ...currentDevices[1],
          is_blocked: false,
        }
        currentDevices = [currentDevices[0], unblockedDevice2, currentDevices[2]]
        const unblockActionResp: DeviceActionResponse = {
          device: unblockedDevice2,
          action: 'unblock',
          states_killed: false,
          warning: null,
        }
        return new Response(JSON.stringify(unblockActionResp), { status: 200 })
      }
      if (url.includes('/api/v1/devices')) {
        return new Response(
          JSON.stringify({
            ...MOCK_DEVICE_LIST_RESPONSE,
            devices: currentDevices,
          }),
          { status: 200 },
        )
      }
      return new Response('Not Found', { status: 404 })
    })

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} />)

    await screen.findByTestId('device-row-1')

    // Click Block on Device 1 (currently Allowed)
    await user.click(screen.getByTestId('access-toggle-1'))

    // Should display partial warning banner
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'IP was added to blocked_devices, but active states could not be flushed.',
    )

    // Dismiss alert banner
    await user.click(screen.getByLabelText(/Dismiss alert/i))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Click Allow on Device 2 (currently Blocked)
    await user.click(screen.getByTestId('access-toggle-2'))
    await waitFor(() => {
      expect(screen.getByTestId('access-toggle-2')).toHaveTextContent('Allowed')
    })

    // Navigate to System Connectivity tab and back to Devices tab
    await user.click(screen.getByTestId('nav-tab-status'))
    expect(
      await screen.findByRole('heading', { name: /System Connectivity & Telemetry Status/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByTestId('nav-tab-devices'))
    expect(
      await screen.findByRole('heading', { name: /Network Device Inventory & Access Control/i }),
    ).toBeInTheDocument()
  })
})
