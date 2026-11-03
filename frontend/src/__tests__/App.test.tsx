import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient } from '@tanstack/react-query'
import App from '../App'
import { type SystemHealthResponse } from '../api/client'

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

const MOCK_HEALTHY_REPORT: SystemHealthResponse = {
  overall_status: 'healthy',
  version: '0.6.0',
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
      latency_ms: 348.3,
      message: 'OPNsense API connected (ARP, Dnsmasq leases, and block alias verified).',
      details: {
        arp_entry_count: 59,
        dnsmasq_lease_count: 61,
        blocked_ip_count: 0,
      },
    },
    elasticsearch: {
      service: 'elasticsearch',
      status: 'healthy',
      latency_ms: 38.71,
      message: 'Elasticsearch 9.4.3 connected (6,672,331 docs in logs-pfsense.log*).',
      details: {
        es_version: '9.4.3',
        index_doc_count: 6672331,
      },
    },
  },
}

describe('Phase 1 Frontend SPA Shell, Auth & Health Dashboard', () => {
  it('renders the Login page when /api/v1/auth/me returns 401 and validates empty fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Authentication required.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} initialTab="status" />)

    expect(await screen.findByRole('heading', { name: /OPNsense Gateway Control/i })).toBeInTheDocument()

    // Submit with empty password -> should show client-side validation error without calling fetch
    await user.click(screen.getByRole('button', { name: /Sign In/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Password is required.')

    // Clear username and submit -> should show username required
    const usernameInput = screen.getByLabelText(/Username/i)
    await user.clear(usernameInput)
    await user.click(screen.getByRole('button', { name: /Sign In/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Username is required.')
  })

  it('displays server 401 and 429 error alerts when login fails', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    // 1. Initial /me check -> 401
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Authentication required.' }), { status: 401 }),
    )
    // 2. First login attempt -> 401 invalid credentials
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Invalid username or password.' }), { status: 401 }),
    )
    // 3. Second login attempt -> 429 rate limit
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ detail: 'Too many failed login attempts. Please try again later.' }),
        { status: 429 },
      ),
    )

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} initialTab="status" />)

    const passwordInput = await screen.findByLabelText(/Administrator Password/i)
    await user.type(passwordInput, 'wrong-password')
    await user.click(screen.getByRole('button', { name: /Sign In/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.')

    await user.click(screen.getByRole('button', { name: /Sign In/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many failed login attempts. Please try again later.',
    )
  })

  it('logs in, renders live OPNsense/Elasticsearch/SQLite health cards, refreshes, and logs out', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    // 1. Initial /me check -> 401
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Authentication required.' }), { status: 401 }),
    )
    // 2. POST /api/v1/auth/login -> 200
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          username: 'admin',
          authenticated: true,
          expires_at: '2026-11-01T00:00:00Z',
        }),
        { status: 200 },
      ),
    )
    // 3. GET /api/v1/system/health -> 200 healthy
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(MOCK_HEALTHY_REPORT), { status: 200 }),
    )
    // 4. Manual refresh GET /api/v1/system/health -> degraded OPNsense
    const degradedReport: SystemHealthResponse = {
      ...MOCK_HEALTHY_REPORT,
      overall_status: 'degraded',
      services: {
        ...MOCK_HEALTHY_REPORT.services,
        opnsense: {
          ...MOCK_HEALTHY_REPORT.services.opnsense,
          status: 'degraded',
          message: 'Alias warning',
        },
      },
    }
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(degradedReport), { status: 200 }),
    )
    // 5. POST /api/v1/auth/logout -> 200
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'logged_out' }), { status: 200 }),
    )

    const user = userEvent.setup()
    render(<App queryClient={createTestQueryClient()} initialTab="status" />)

    const passwordInput = await screen.findByLabelText(/Administrator Password/i)
    await user.type(passwordInput, 'correct-horse-battery-staple')
    await user.click(screen.getByRole('button', { name: /Sign In/i }))

    // Verify StatusPage renders with all 3 service cards
    expect(
      await screen.findByRole('heading', { name: /System Connectivity & Telemetry Status/i }),
    ).toBeInTheDocument()

    expect(await screen.findByTestId('overall-health-badge')).toHaveTextContent('healthy')

    const opnsenseCard = screen.getByTestId('service-card-opnsense')
    expect(within(opnsenseCard).getByText('OPNsense REST API (26.7.7-amd64)')).toBeInTheDocument()
    expect(within(opnsenseCard).getByText('348.3 ms')).toBeInTheDocument()
    expect(within(opnsenseCard).getByText('59')).toBeInTheDocument()

    const esCard = screen.getByTestId('service-card-elasticsearch')
    expect(within(esCard).getByText('9.4.3')).toBeInTheDocument()
    expect(within(esCard).getByText('6672331')).toBeInTheDocument()

    const sqliteCard = screen.getByTestId('service-card-sqlite')
    expect(within(sqliteCard).getByText('0.42 ms')).toBeInTheDocument()

    // Click Refresh Status -> should update overall badge to degraded
    await user.click(screen.getByRole('button', { name: /Refresh Status/i }))
    await waitFor(() => {
      expect(screen.getByTestId('overall-health-badge')).toHaveTextContent('degraded')
    })

    // Click Logout (FB-P5-006) -> should return to LoginPage
    await user.click(screen.getByRole('button', { name: /Logout/i }))
    expect(await screen.findByRole('button', { name: /Sign In/i })).toBeInTheDocument()
  })

  it('restores an existing authenticated session and handles health API errors gracefully', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    // 1. Initial /me check -> 200 already authenticated
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          username: 'admin',
          authenticated: true,
          expires_at: '2026-11-01T00:00:00Z',
        }),
        { status: 200 },
      ),
    )
    // 2. GET /api/v1/system/health -> 500 error
    fetchMock.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    )

    render(<App queryClient={createTestQueryClient()} initialTab="status" />)

    expect(
      await screen.findByRole('heading', { name: /System Connectivity & Telemetry Status/i }),
    ).toBeInTheDocument()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load system health report: Request failed with status 500',
    )
  })
})
