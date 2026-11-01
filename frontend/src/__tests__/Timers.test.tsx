import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiClient,
  formatRemainingDuration,
  type ActiveOverrideInfo,
  type DeviceListResponse,
  type GroupListResponse,
  type SystemHealthResponse,
} from '../api/client'
import { AuthProvider } from '../context/AuthContext'
import { DevicesPage } from '../pages/DevicesPage'
import { StatusPage } from '../pages/StatusPage'

const futureIso = (minutesAhead: number): string =>
  new Date(Date.now() + minutesAhead * 60_000).toISOString()

const mockHealth: SystemHealthResponse = {
  overall_status: 'healthy',
  version: '0.6.0',
  services: {
    sqlite: { service: 'sqlite', status: 'healthy', latency_ms: 2, message: 'OK' },
    opnsense: { service: 'opnsense', status: 'healthy', latency_ms: 45, message: 'OK' },
    elasticsearch: {
      service: 'elasticsearch',
      status: 'healthy',
      latency_ms: 12,
      message: 'OK',
    },
  },
}

const mockActivePauseOverride: ActiveOverrideInfo = {
  id: 501,
  target_type: 'device',
  device_id: 2,
  group_id: null,
  target_name: 'Kids iPad',
  mode: 'pause',
  duration_minutes: 30,
  created_by: 'admin',
  reason: 'Dinner',
  is_active: true,
  created_at: new Date().toISOString(),
  expires_at: futureIso(30),
  remaining_seconds: 1800,
}

const mockActiveGroupBonus: ActiveOverrideInfo = {
  id: 502,
  target_type: 'group',
  device_id: null,
  group_id: 10,
  target_name: 'Kids Profile',
  mode: 'bonus',
  duration_minutes: 20,
  created_by: 'admin',
  reason: 'Extra time',
  is_active: true,
  created_at: new Date().toISOString(),
  expires_at: futureIso(20),
  remaining_seconds: 1200,
}

const mockDevices: DeviceListResponse = {
  summary: {
    total_devices: 2,
    online_devices: 2,
    blocked_devices: 1,
    protected_devices: 1,
  },
  last_synced_at: '2026-10-31T21:00:00Z',
  devices: [
    {
      id: 1,
      mac_address: 'aa:bb:cc:00:00:01',
      ipv4_address: '192.168.50.1',
      hostname: 'gateway',
      display_name: 'OPNsense Gateway',
      effective_name: 'OPNsense Gateway',
      vendor: 'Netgate',
      interface_name: 'lan',
      lease_type: 'static',
      is_online: true,
      is_blocked: false,
      is_protected: true,
      protection_reason: 'Protected gateway IP',
      notes: '',
      groups: [],
      active_override: null,
      first_seen_at: '2026-10-31T10:00:00Z',
      last_seen_at: '2026-10-31T21:00:00Z',
      updated_at: '2026-10-31T21:00:00Z',
    },
    {
      id: 2,
      mac_address: 'aa:bb:cc:00:00:02',
      ipv4_address: '192.168.50.55',
      hostname: 'kids-ipad',
      display_name: 'Kids iPad',
      effective_name: 'Kids iPad',
      vendor: 'Apple',
      interface_name: 'lan',
      lease_type: 'dynamic',
      is_online: true,
      is_blocked: true,
      is_protected: false,
      protection_reason: null,
      notes: '',
      groups: [{ id: 10, name: 'Kids Profile', color_badge: 'indigo', icon: 'users' }],
      active_override: mockActivePauseOverride,
      active_schedule: {
        id: 1,
        name: 'School Night Bedtime',
        target_type: 'group',
        group_id: 10,
        start_time: '21:00',
        end_time: '07:00',
        timezone: 'America/Los_Angeles',
      },
      first_seen_at: '2026-10-31T10:00:00Z',
      last_seen_at: '2026-10-31T21:00:00Z',
      updated_at: '2026-10-31T21:00:00Z',
    },
  ],
}

const mockGroups: GroupListResponse = {
  groups: [
    {
      id: 10,
      name: 'Kids Profile',
      description: 'Tablets and consoles',
      color_badge: 'indigo',
      icon: 'users',
      access_status: 'blocked',
      total_devices: 1,
      online_devices: 1,
      blocked_devices: 1,
      protected_devices: 0,
      blockable_devices: 1,
      member_device_ids: [2],
      members: [mockDevices.devices[1]],
      active_override: mockActiveGroupBonus,
      active_schedule: {
        id: 1,
        name: 'School Night Bedtime',
        target_type: 'group',
        group_id: 10,
        start_time: '21:00',
        end_time: '07:00',
        timezone: 'America/Los_Angeles',
      },
      created_at: '2026-10-31T10:00:00Z',
      updated_at: '2026-10-31T21:00:00Z',
    },
  ],
}

describe('Phase 5 & Phase 6 Timed Temporary Controls & UI Backlog Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(apiClient, 'getCurrentUser').mockResolvedValue({
      username: 'admin',
      authenticated: true,
      expires_at: futureIso(60),
    })
    vi.spyOn(apiClient, 'getSystemHealth').mockResolvedValue(mockHealth)
    vi.spyOn(apiClient, 'getDevices').mockResolvedValue(mockDevices)
    vi.spyOn(apiClient, 'getGroups').mockResolvedValue(mockGroups)
  })

  it('formats remaining countdown durations accurately', () => {
    expect(formatRemainingDuration(0)).toBe('0m left')
    expect(formatRemainingDuration(900)).toBe('15m left')
    expect(formatRemainingDuration(3600)).toBe('1h left')
    expect(formatRemainingDuration(5400)).toBe('1h 30m left')
  })

  it('renders unified active timer buttons, centered modal, duration-only presets (20m/40m/60m bonus), and 24h sync clock', async () => {
    const startDeviceSpy = vi
      .spyOn(apiClient, 'startDeviceTimer')
      .mockResolvedValue(mockActivePauseOverride)
    const startGroupSpy = vi
      .spyOn(apiClient, 'startGroupTimer')
      .mockResolvedValue(mockActiveGroupBonus)
    const cancelSpy = vi.spyOn(apiClient, 'cancelTimer').mockResolvedValue({
      cancelled_override_id: 501,
      target_type: 'device',
      device_id: 2,
      group_id: null,
      mode: 'pause',
      reverted_state: true,
      warnings: [],
    })

    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <DevicesPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    // Verify active countdown buttons on Device #2 and Group #10 (FB-P5-002)
    await waitFor(() => {
      expect(screen.getByTestId('active-timer-pill-device-2')).toBeInTheDocument()
      expect(screen.getByTestId('active-timer-pill-group-10')).toBeInTheDocument()
    })
    expect(screen.getByTestId('active-timer-pill-device-2')).toHaveTextContent(/Paused/i)
    expect(screen.getByTestId('active-timer-pill-group-10')).toHaveTextContent(/Bonus/i)

    // Verify 24h sync clock underneath Sync from OPNsense button (FB-P5-009)
    expect(screen.getByTestId('last-synced-clock')).toHaveTextContent(/Synced:/i)
    expect(screen.getByTestId('last-synced-clock').textContent).not.toMatch(/AM|PM/i)

    // Verify active schedule badges on Device #2 and Group #10
    expect(screen.getByTestId('device-schedule-badge-2')).toHaveTextContent(
      'School Night Bedtime (until 07:00)',
    )
    expect(screen.getByTestId('group-schedule-badge-10')).toHaveTextContent(
      'School Night Bedtime (until 07:00)',
    )

    // Cancel Device #2 timer via inline X button
    await user.click(screen.getByTestId('cancel-timer-device-2'))
    await waitFor(() => {
      expect(cancelSpy).toHaveBeenCalledWith(501, true)
    })

    // Open Device #2 centered timer modal (FB-P5-001) and verify duration-only labels (FB-P5-003) & 20m/40m/60m bonus (FB-P5-004)
    await user.click(screen.getByTestId('open-timer-menu-device-2'))
    expect(screen.getByTestId('timer-popover-device-2')).toBeInTheDocument()
    expect(screen.getByTestId('timer-preset-pause-30m-device-2')).toHaveTextContent('30m')
    expect(screen.getByTestId('timer-preset-bonus-20m-device-2')).toHaveTextContent('20m')
    expect(screen.getByTestId('timer-preset-bonus-40m-device-2')).toHaveTextContent('40m')
    expect(screen.getByTestId('timer-preset-bonus-60m-device-2')).toHaveTextContent('60m')

    await user.click(screen.getByTestId('timer-preset-pause-30m-device-2'))
    await waitFor(() => {
      expect(startDeviceSpy).toHaveBeenCalledWith(2, { mode: 'pause', preset: '30m' })
    })

    // Open Device #2 timer modal and submit custom 45m bonus
    await user.click(screen.getByTestId('open-timer-menu-device-2'))
    await user.click(screen.getByTestId('custom-timer-bonus-device-2'))
    await waitFor(() => {
      expect(startDeviceSpy).toHaveBeenCalledWith(2, {
        mode: 'bonus',
        duration_minutes: 45,
      })
    })

    // Open Group #10 timer modal and click 40m bonus preset
    await user.click(screen.getByTestId('open-timer-menu-group-10'))
    await user.click(screen.getByTestId('timer-preset-bonus-40m-group-10'))
    await waitFor(() => {
      expect(startGroupSpy).toHaveBeenCalledWith(10, {
        mode: 'bonus',
        preset: '40m',
      })
    })
  })

  it('renders live Gateway Enforcement & Inventory Summary on StatusPage (FB-P4-011)', async () => {
    const onSelectTab = vi.fn()
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusPage activeTab="status" onSelectTab={onSelectTab} />
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status-enforcement-summary')).toBeInTheDocument()
    })
    expect(
      screen.getByText(/Gateway Enforcement & Inventory Synchronization Summary/i),
    ).toBeInTheDocument()

    await user.click(screen.getByTestId('status-open-devices-btn'))
    expect(onSelectTab).toHaveBeenCalledWith('devices')
  })
})
