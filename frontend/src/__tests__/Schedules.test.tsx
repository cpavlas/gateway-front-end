import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiClient,
  type DeviceListResponse,
  type GroupListResponse,
  type ScheduleRule,
  type SystemHealthResponse,
} from '../api/client'
import { formatDaysSummary } from '../components/ScheduleFormModal'
import { AuthProvider } from '../context/AuthContext'
import { SchedulesPage } from '../pages/SchedulesPage'

const mockHealth: SystemHealthResponse = {
  overall_status: 'healthy',
  version: '0.6.0',
  services: {
    sqlite: { service: 'sqlite', status: 'healthy', latency_ms: 1, message: 'OK' },
    opnsense: { service: 'opnsense', status: 'healthy', latency_ms: 12, message: 'OK' },
    elasticsearch: { service: 'elasticsearch', status: 'healthy', latency_ms: 8, message: 'OK' },
  },
}

const mockGroups: GroupListResponse = {
  groups: [
    {
      id: 10,
      name: 'Kids Profile',
      description: 'Kids devices',
      color_badge: 'indigo',
      icon: 'users',
      access_status: 'blocked',
      total_devices: 1,
      online_devices: 1,
      blocked_devices: 1,
      protected_devices: 0,
      blockable_devices: 1,
      member_device_ids: [2],
      members: [],
      created_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-01T10:00:00Z',
    },
  ],
}

const mockDevices: DeviceListResponse = {
  summary: {
    total_devices: 1,
    online_devices: 1,
    blocked_devices: 1,
    protected_devices: 0,
  },
  last_synced_at: '2026-11-01T10:00:00Z',
  devices: [
    {
      id: 2,
      mac_address: 'aa:bb:cc:00:00:02',
      ipv4_address: '192.168.1.55',
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
      groups: [],
      first_seen_at: '2026-11-01T10:00:00Z',
      last_seen_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-01T10:00:00Z',
    },
  ],
}

const mockSchedules: ScheduleRule[] = [
  {
    id: 1,
    name: 'School Night Bedtime',
    description: 'Kids bedtime blackout',
    target_type: 'group',
    group_id: 10,
    device_id: null,
    target_name: 'Kids Profile',
    days_of_week: [0, 1, 2, 3, 6],
    start_time: '21:00',
    end_time: '07:00',
    timezone: 'America/Los_Angeles',
    is_enabled: true,
    is_active_now: true,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
  },
  {
    id: 2,
    name: 'Afternoon Study Block',
    description: 'Homework focus hour',
    target_type: 'device',
    group_id: null,
    device_id: 2,
    target_name: 'Kids iPad',
    days_of_week: [0, 1, 2, 3, 4],
    start_time: '15:00',
    end_time: '17:00',
    timezone: 'America/Los_Angeles',
    is_enabled: false,
    is_active_now: false,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
  },
]

describe('Phase 6 Recurring Schedules & Bedtime Rules UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(apiClient, 'getCurrentUser').mockResolvedValue({
      username: 'admin',
      authenticated: true,
      expires_at: '2026-11-02T00:00:00Z',
    })
    vi.spyOn(apiClient, 'getSystemHealth').mockResolvedValue(mockHealth)
    vi.spyOn(apiClient, 'getGroups').mockResolvedValue(mockGroups)
    vi.spyOn(apiClient, 'getDevices').mockResolvedValue(mockDevices)
    vi.spyOn(apiClient, 'getSchedules').mockResolvedValue({ schedules: mockSchedules })
  })

  it('formats day-of-week summaries accurately', () => {
    expect(formatDaysSummary([0, 1, 2, 3, 4, 5, 6])).toBe('Every Day')
    expect(formatDaysSummary([0, 1, 2, 3, 6])).toBe('Sun–Thu (School Nights)')
    expect(formatDaysSummary([0, 1, 2, 3, 4])).toBe('Mon–Fri (Weekdays)')
    expect(formatDaysSummary([4, 5])).toBe('Fri–Sat (Weekend Nights)')
    expect(formatDaysSummary([5, 6])).toBe('Sat–Sun (Weekends)')
    expect(formatDaysSummary([0, 2, 4])).toBe('Mon, Wed, Fri')
  })

  it('renders schedule cards, toggles rules, evaluates policies, and creates/edits/deletes schedules', async () => {
    const toggleSpy = vi
      .spyOn(apiClient, 'toggleSchedule')
      .mockResolvedValue({ ...mockSchedules[0], is_enabled: false, is_active_now: false })
    const reconcileSpy = vi.spyOn(apiClient, 'reconcileSchedules').mockResolvedValue({
      blocked_count: 1,
      unblocked_count: 0,
      ip_drift_healed_count: 0,
      warnings: [],
    })
    const createSpy = vi
      .spyOn(apiClient, 'createSchedule')
      .mockResolvedValue(mockSchedules[0])
    const updateSpy = vi
      .spyOn(apiClient, 'updateSchedule')
      .mockResolvedValue({ ...mockSchedules[0], name: 'Updated Bedtime' })
    const deleteSpy = vi.spyOn(apiClient, 'deleteSchedule').mockResolvedValue(undefined)

    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SchedulesPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    // Verify KPIs & cards
    await waitFor(() => {
      expect(screen.getByTestId('schedule-card-1')).toBeInTheDocument()
      expect(screen.getByTestId('schedule-card-2')).toBeInTheDocument()
    })
    expect(screen.getByTestId('schedules-kpi-total')).toHaveTextContent('2')
    expect(screen.getByTestId('schedules-kpi-active')).toHaveTextContent('1')
    expect(screen.getByTestId('schedule-status-1')).toHaveTextContent(
      'Active Now — Blocking until 07:00',
    )
    expect(screen.getByTestId('schedule-status-2')).toHaveTextContent('Disabled')

    // Click Evaluate Policies Now
    await user.click(screen.getByTestId('reconcile-schedules-btn'))
    await waitFor(() => {
      expect(reconcileSpy).toHaveBeenCalled()
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(/Policy reconciliation complete/i)

    // Toggle Schedule #1
    await user.click(screen.getByTestId('toggle-schedule-1'))
    await waitFor(() => {
      expect(toggleSpy).toHaveBeenCalledWith(1, false)
    })

    // Open New Schedule Modal and create a Device schedule
    await user.click(screen.getByTestId('new-schedule-btn'))
    expect(await screen.findByTestId('schedule-form-modal')).toBeInTheDocument()
    await user.type(screen.getByTestId('schedule-name-input'), 'Weekend Bedtime')
    await user.type(screen.getByTestId('schedule-desc-input'), 'Friday & Saturday night')
    await user.click(screen.getByTestId('schedule-target-device'))
    await user.click(screen.getByTestId('schedule-day-preset-weekends'))
    await user.click(screen.getByTestId('save-schedule-btn'))
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Weekend Bedtime',
          target_type: 'device',
          device_id: 2,
          days_of_week: [4, 5],
        }),
      )
    })

    // Open Edit Schedule Modal on #1 and save changes
    await user.click(screen.getByTestId('edit-schedule-1'))
    expect(await screen.findByTestId('schedule-form-modal')).toBeInTheDocument()
    const nameInput = screen.getByTestId('schedule-name-input')
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated Bedtime')
    await user.click(screen.getByTestId('schedule-day-btn-4'))
    await user.click(screen.getByTestId('save-schedule-btn'))
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          name: 'Updated Bedtime',
        }),
      )
    })

    // Delete Schedule #2 from card button
    await user.click(screen.getByTestId('delete-schedule-card-2'))
    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith(2)
    })
  })
})

