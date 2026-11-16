import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { apiClient, type SystemHealthResponse } from '../api/client'
import { AppLayout } from '../components/AppLayout'
import { AuthProvider } from '../context/AuthContext'
import { StatusPage } from '../pages/StatusPage'

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

const MOCK_HEALTH_WITH_PLEX: SystemHealthResponse = {
  overall_status: 'healthy',
  version: '1.3.0-rc1',
  services: {
    sqlite: {
      service: 'sqlite',
      status: 'healthy',
      latency_ms: 0.9,
      message: 'SQLite healthy',
      details: {
        storage_size_formatted: '128 KB',
        total_records: 420,
        audit_logs_count: 120,
      },
    },
    opnsense: {
      service: 'opnsense',
      status: 'healthy',
      latency_ms: 42.5,
      message: 'OPNsense healthy',
      details: {
        arp_entry_count: 18,
        dnsmasq_lease_count: 24,
        blocked_ip_count: 2,
      },
    },
    elasticsearch: {
      service: 'elasticsearch',
      status: 'healthy',
      latency_ms: 14.2,
      message: 'ES multi-node cluster connected',
      details: {
        es_version: '9.4.3',
        cluster_status: 'green',
        assigned_shards: 64,
        unassigned_shards: 0,
        relocating_shards: 0,
        configured_nodes: ['https://es1.example.local:9200', 'https://es2.example.local:9200'],
      },
    },
    plex: {
      service: 'plex',
      status: 'healthy',
      latency_ms: 11.4,
      message: 'Plex Media Server connected',
      details: {
        configured: true,
        active_sessions: 2,
      },
    },
  },
}

describe('Phase 16 Frontend Features: Navigation, Themes, Passwords, Plex Card & Audit Controls', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(apiClient, 'getCurrentUser').mockResolvedValue({
      username: 'admin',
      authenticated: true,
      expires_at: '2026-11-15T23:59:59Z',
      role: 'admin',
      theme_preference: 'default',
    })
  })

  it('FB-P16-005 & FB-P16-004: renders 5 themes, clickable health badge, Ctrl+K quick search, mobile bottom nav, and self password change', async () => {
    const onSelectTab = vi.fn()
    const updatePrefSpy = vi
      .spyOn(apiClient, 'updateUserPreferences')
      .mockImplementation(async ({ theme_preference }) => ({
        username: 'admin',
        authenticated: true,
        expires_at: '2026-11-15T23:59:59Z',
        role: 'admin',
        theme_preference,
      }))
    const changePwdSpy = vi
      .spyOn(apiClient, 'changeOwnPassword')
      .mockResolvedValue({ status: 'password_updated', message: 'Password updated successfully.' })
    vi.spyOn(apiClient, 'getDevices').mockResolvedValue({
      summary: { total_devices: 1, online_devices: 1, blocked_devices: 0, protected_devices: 0 },
      last_synced_at: '2026-11-14T18:00:00Z',
      devices: [
        {
          id: 10,
          mac_address: 'aa:bb:cc:dd:ee:01',
          ipv4_address: '192.168.1.50',
          hostname: 'living-room-tv',
          display_name: 'Living Room TV',
          effective_name: 'Living Room TV',
          vendor: 'LG Electronics',
          interface_name: 'lan',
          lease_type: 'static',
          is_online: true,
          is_blocked: false,
          is_youtube_blocked: true,
          is_protected: false,
          protection_reason: null,
          notes: '',
          first_seen_at: '2026-11-01T00:00:00Z',
          last_seen_at: '2026-11-14T18:00:00Z',
          updated_at: '2026-11-14T18:00:00Z',
        },
      ],
    })
    vi.spyOn(apiClient, 'getGroups').mockResolvedValue({
      groups: [
        {
          id: 3,
          name: 'Media Devices',
          description: 'TVs & streaming boxes',
          color_badge: 'indigo',
          icon: 'tv',
          total_devices: 1,
          online_devices: 1,
          blocked_devices: 0,
          protected_devices: 0,
          blockable_devices: 1,
          member_device_ids: [10],
          youtube_status: 'allowed',
          access_status: 'allowed',
          members: [],
          active_override: null,
          active_schedule: null,
          created_at: '2026-11-01T00:00:00Z',
          updated_at: '2026-11-01T00:00:00Z',
        },
      ],
    })

    const user = userEvent.setup()
    const qc = createTestQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <AppLayout overallStatus="healthy" version="1.3.0-rc1" activeTab="devices" onSelectTab={onSelectTab}>
            <div>Workspace Body</div>
          </AppLayout>
        </AuthProvider>
      </QueryClientProvider>,
    )

    // Clickable health badge navigates to System ('status') & no header Quick Search button clutters the top bar
    expect(screen.queryByTestId('header-quick-search-btn')).not.toBeInTheDocument()
    const badge = await screen.findByTestId('overall-health-badge')
    await user.click(badge)
    expect(onSelectTab).toHaveBeenCalledWith('status')

    // Mobile sticky bottom nav navigates
    expect(screen.getByTestId('mobile-bottom-nav')).toBeInTheDocument()
    await user.click(screen.getByTestId('mobile-nav-tab-analytics'))
    expect(onSelectTab).toHaveBeenCalledWith('analytics')

    // User Menu: 5 themes + Change My Password
    await user.click(screen.getByTestId('header-user-menu-button'))
    expect(screen.getByTestId('theme-option-emerald')).toBeInTheDocument()
    expect(screen.getByTestId('theme-option-amber')).toBeInTheDocument()
    await user.click(screen.getByTestId('theme-option-emerald'))
    await waitFor(() => {
      expect(updatePrefSpy).toHaveBeenCalledWith({ theme_preference: 'emerald' })
    })

    await user.click(screen.getByTestId('user-menu-change-password-toggle'))
    await user.type(screen.getByTestId('current-password-input'), 'OldStrongPass!123')
    await user.type(screen.getByTestId('new-password-input'), 'NewStrongPass!456')
    await user.type(screen.getByTestId('confirm-password-input'), 'MismatchPass!456')
    await user.click(screen.getByTestId('submit-change-password-btn'))
    expect(await screen.findByTestId('change-password-error')).toHaveTextContent(
      /do not match/i,
    )

    await user.clear(screen.getByTestId('confirm-password-input'))
    await user.type(screen.getByTestId('confirm-password-input'), 'NewStrongPass!456')
    await user.click(screen.getByTestId('submit-change-password-btn'))
    await waitFor(() => {
      expect(changePwdSpy).toHaveBeenCalledWith({
        current_password: 'OldStrongPass!123',
        new_password: 'NewStrongPass!456',
        confirm_password: 'NewStrongPass!456',
      })
      expect(screen.getByTestId('change-password-success')).toBeInTheDocument()
    })

    // Ctrl+K Quick Search Modal
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const searchInput = await screen.findByTestId('global-quick-search-input')
    await user.type(searchInput, 'Living Room')
    const devResult = await screen.findByTestId('quick-search-result-device-10')
    expect(devResult).toHaveTextContent('Living Room TV')
    await user.click(devResult)
    expect(onSelectTab).toHaveBeenCalledWith('devices')
    expect(screen.queryByTestId('global-quick-search-modal')).not.toBeInTheDocument()
  })

  it('FB-P16-002, FB-P16-003 & FB-P16-004: renders Plex card, collapsible ServiceCard details, Test All, CA Cert Path, RBAC inline actions, and paginated/prunable Audit logs', async () => {
    vi.spyOn(apiClient, 'getSystemHealth').mockResolvedValue(MOCK_HEALTH_WITH_PLEX)
    vi.spyOn(apiClient, 'getIntegrationSettings').mockResolvedValue({
      source: 'env',
      opnsense_base_url: 'https://192.168.1.1',
      has_opnsense_api_key: true,
      opnsense_api_key_masked: '****',
      has_opnsense_api_secret: true,
      opnsense_api_secret_masked: '****',
      opnsense_verify_ssl: false,
      opnsense_ca_cert_path: '',
      opnsense_timeout_seconds: 10,
      opnsense_protected_ips: '192.168.1.1',
      elasticsearch_url: 'https://es1.example.local:9200, https://es2.example.local:9200',
      has_elasticsearch_api_key: true,
      elasticsearch_api_key_masked: '****',
      elasticsearch_verify_ssl: true,
      elasticsearch_ca_cert_path: '/app/certs/es-ca.pem',
      elasticsearch_timeout_seconds: 25,
      elasticsearch_index_patterns: 'logs-pfsense.log*',
      plex_base_url: 'http://192.168.1.99:32400',
      has_plex_api_token: true,
      plex_api_token_masked: '****',
      plex_verify_ssl: false,
      plex_timeout_seconds: 10,
    })
    const testAllSpy = vi.spyOn(apiClient, 'testAllConnectivity').mockResolvedValue({
      overall_reachable: true,
      results: {
        opnsense: {
          service: 'opnsense',
          reachable: true,
          status: 'healthy',
          latency_ms: 15,
          message: 'OK',
          details: {
            node_results: [
              { url: 'https://192.168.1.1', reachable: true, status: 'healthy', latency_ms: 15, message: 'OK' },
            ],
          },
        },
        elasticsearch: {
          service: 'elasticsearch',
          reachable: true,
          status: 'healthy',
          latency_ms: 9,
          message: 'OK',
          details: {
            node_results: [
              { url: 'https://es1.example.local:9200', reachable: true, status: 'healthy', latency_ms: 8, message: 'OK' },
              { url: 'https://es2.example.local:9200', reachable: false, status: 'unhealthy', latency_ms: 9, message: 'Timeout' },
            ],
          },
        },
        plex: {
          service: 'plex',
          reachable: true,
          status: 'healthy',
          latency_ms: 7,
          message: 'OK',
          details: {
            node_results: [
              { url: 'http://192.168.1.99:32400', reachable: true, status: 'healthy', latency_ms: 7, message: 'OK' },
            ],
          },
        },
      },
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
    const updateUserSpy = vi.spyOn(apiClient, 'updateUser').mockResolvedValue({
      id: 2,
      username: 'operator_1',
      role: 'admin',
      is_active: true,
      is_protected_admin: false,
      theme_preference: 'default',
      created_at: '2026-11-02T00:00:00Z',
      updated_at: '2026-11-14T18:00:00Z',
    })
    const auditSpy = vi.spyOn(apiClient, 'getAuditLogs').mockResolvedValue({
      total_count: 120,
      offset: 0,
      limit: 50,
      items: [
        {
          id: 1,
          actor: 'admin',
          action: 'device.youtube_block',
          audit_label: 'YOUTUBE_CONTROL',
          target: '192.168.1.50',
          status: 'success',
          details: 'Blocked YouTube',
          created_at: '2026-11-14T18:00:00Z',
        },
      ],
    })
    const pruneSpy = vi.spyOn(apiClient, 'pruneAuditLogs').mockResolvedValue({
      deleted_count: 14,
      retention_days: 7,
      audit_label: 'PERFORMANCE_ANALYSIS',
    })

    const qc = createTestQueryClient()
    qc.setQueryData(['devices'], {
      summary: { total_devices: 3, online_devices: 2, blocked_devices: 1, protected_devices: 1 },
      last_synced_at: '2026-11-14T18:00:00Z',
      devices: [
        { id: 1, is_youtube_blocked: true },
        { id: 2, is_youtube_blocked: true },
        { id: 3, is_youtube_blocked: false },
      ],
    })

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <StatusPage />
        </AuthProvider>
      </QueryClientProvider>,
    )

    // 4th ServiceCard for Plex + collapsible formatted details (FB-P18-010 omits redundant message)
    const plexCard = await screen.findByTestId('service-card-plex')
    expect(within(plexCard).getByText('Plex Media Server')).toBeInTheDocument()
    expect(within(plexCard).getByText('Active Streams')).toBeInTheDocument()
    expect(within(plexCard).queryByText('Plex Media Server connected')).not.toBeInTheDocument()
    const opnCard = screen.getByTestId('service-card-opnsense')
    expect(within(opnCard).getByText('ARP Entries')).toBeInTheDocument()
    await user.click(screen.getByTestId('toggle-details-service-card-opnsense'))
    expect(within(opnCard).queryByText('ARP Entries')).not.toBeInTheDocument()

    // KPI YouTube Blocked count
    expect(screen.getByTestId('status-youtube-blocked-devices')).toHaveTextContent('2')

    // Integration settings: Multi-URL rows, status dots, Test All popup modal, and expand/collapse toggle
    await user.click(screen.getByTestId('toggle-integration-settings-btn'))
    expect(await screen.findByTestId('settings-es-ca-cert-input')).toHaveValue('/app/certs/es-ca.pem')
    expect(screen.getByTestId('input-elasticsearch-url')).toHaveValue('https://es1.example.local:9200')
    expect(screen.getByTestId('input-elasticsearch-url-1')).toHaveValue('https://es2.example.local:9200')

    // Add & remove Plex URL row dynamically
    await user.click(screen.getByTestId('add-plex-url-btn'))
    expect(screen.getByTestId('input-plex-url-1')).toBeInTheDocument()
    await user.click(screen.getByTestId('remove-plex-url-btn-1'))
    expect(screen.queryByTestId('input-plex-url-1')).not.toBeInTheDocument()

    // Add & remove ES URL row dynamically
    await user.click(screen.getByTestId('add-es-url-btn'))
    expect(screen.getByTestId('input-elasticsearch-url-2')).toBeInTheDocument()
    await user.click(screen.getByTestId('remove-es-url-btn-2'))
    expect(screen.queryByTestId('input-elasticsearch-url-2')).not.toBeInTheDocument()

    // Test All opens popup modal & records green/red status dots on URL rows
    await user.click(screen.getByTestId('test-all-connectivity-btn'))
    await waitFor(() => {
      expect(testAllSpy).toHaveBeenCalled()
      expect(screen.getByTestId('all-connectivity-diagnostic-result')).toHaveTextContent(
        /ALL SERVICES REACHABLE/i,
      )
    })
    expect(screen.getByTestId('modal-elasticsearch-node-dot-0')).toHaveClass('bg-emerald-400')
    expect(screen.getByTestId('modal-elasticsearch-node-dot-1')).toHaveClass('bg-rose-500')
    expect(screen.getByTestId('es-url-status-dot-0')).toHaveClass('bg-emerald-400')
    expect(screen.getByTestId('es-url-status-dot-1')).toHaveClass('bg-rose-500')
    expect(screen.getByTestId('plex-url-status-dot-0')).toHaveClass('bg-emerald-400')

    // Close Test All modal & collapse Integration Settings via toggle button
    await user.click(screen.getByTestId('close-test-all-modal-btn'))
    expect(screen.queryByTestId('all-connectivity-diagnostic-result')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('toggle-integration-settings-btn'))
    expect(screen.queryByTestId('save-settings-btn')).not.toBeInTheDocument()

    // User Management: inline Role switch & Reset Password
    await user.click(screen.getByTestId('toggle-user-management-btn'))
    await user.click(await screen.findByTestId('toggle-role-user-operator_1'))
    await waitFor(() => {
      expect(updateUserSpy).toHaveBeenCalledWith(2, { role: 'admin' })
    })
    await user.click(screen.getByTestId('reset-password-user-operator_1'))
    await user.type(screen.getByTestId('reset-password-input-operator_1'), 'ResetStrongPass!9')
    await user.click(screen.getByTestId('reset-password-submit-operator_1'))
    await waitFor(() => {
      expect(updateUserSpy).toHaveBeenCalledWith(2, { password: 'ResetStrongPass!9' })
    })

    // Audit Logs: auto-loaded on mount, pagination, CSV export, prune
    expect(await screen.findByTestId('audit-logs-table')).toBeInTheDocument()
    expect(screen.getByTestId('audit-pagination-summary')).toHaveTextContent('Showing 1-1 of 120 events')
    await user.click(screen.getByTestId('audit-next-page-btn'))
    await waitFor(() => {
      expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ offset: 50, limit: 50 }))
    })
    await user.selectOptions(screen.getByTestId('audit-limit-select'), '100')
    await waitFor(() => {
      expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, limit: 100 }))
    })
    await user.click(screen.getByTestId('audit-export-csv-btn'))
    await user.click(screen.getByTestId('audit-prune-perf-btn'))
    await waitFor(() => {
      expect(pruneSpy).toHaveBeenCalledWith({
        retention_days: 7,
        audit_label: 'PERFORMANCE_ANALYSIS',
      })
      expect(screen.getByTestId('audit-prune-status')).toHaveTextContent(/Pruned 14/i)
    })
  })
})
