import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  Laptop,
  RefreshCw,
  Router,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  XCircle,
} from 'lucide-react'
import {
  apiClient,
  type DeviceListResponse,
  type HealthLevel,
  type ServiceHealthStatus,
} from '../api/client'
import { AppLayout, type AppTab } from '../components/AppLayout'

interface StatusPageProps {
  activeTab?: AppTab
  onSelectTab?: (tab: AppTab) => void
}

const CARD_BADGE_STYLES: Record<HealthLevel, string> = {
  healthy: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  degraded: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  unhealthy: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
}

function StatusIcon({ status }: { status: HealthLevel }) {
  if (status === 'healthy') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
  }
  if (status === 'degraded') {
    return <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />
  }
  return <XCircle className="h-4 w-4 text-rose-400" aria-hidden="true" />
}

interface ServiceCardProps {
  title: string
  subtitle: string
  icon: React.ReactNode
  health?: ServiceHealthStatus
  testId: string
}

const ServiceCard: React.FC<ServiceCardProps> = ({
  title,
  subtitle,
  icon,
  health,
  testId,
}) => {
  const status: HealthLevel = health?.status ?? 'unhealthy'
  const details = health?.details ?? {}

  return (
    <div
      data-testid={testId}
      className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/80 p-5 shadow-lg"
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-indigo-400">
              {icon}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
              <p className="text-xs font-mono text-slate-400">{subtitle}</p>
            </div>
          </div>

          {health && (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase ${CARD_BADGE_STYLES[status]}`}
            >
              <StatusIcon status={status} />
              {status}
            </span>
          )}
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          {health ? health.message : 'Probing service status...'}
        </p>

        {Object.keys(details).length > 0 && (
          <dl className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 text-xs">
            {Object.entries(details).map(([key, value]) => (
              <div key={key} className="truncate">
                <dt className="text-[11px] text-slate-400 font-mono">{key}</dt>
                <dd className="font-semibold text-slate-200 truncate">
                  {String(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-800/80 pt-3 text-xs text-slate-400">
        <span>Round-trip Latency</span>
        <span className="font-mono font-semibold text-slate-200">
          {health ? `${health.latency_ms} ms` : '—'}
        </span>
      </div>
    </div>
  )
}

export const StatusPage: React.FC<StatusPageProps> = ({
  activeTab = 'status',
  onSelectTab,
}) => {
  const queryClient = useQueryClient()
  const {
    data: healthReport,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: () => apiClient.getSystemHealth(),
    refetchInterval: 30_000,
  })

  const deviceList = queryClient.getQueryData<DeviceListResponse>(['devices'])
  const opnsenseDetails = healthReport?.services?.opnsense?.details ?? {}
  const summary = deviceList?.summary
  const totalDevices =
    summary?.total_devices ??
    (typeof opnsenseDetails.dnsmasq_lease_count === 'number'
      ? opnsenseDetails.dnsmasq_lease_count
      : 0)
  const onlineDevices =
    summary?.online_devices ??
    (typeof opnsenseDetails.arp_entry_count === 'number'
      ? opnsenseDetails.arp_entry_count
      : 0)
  const blockedDevices =
    summary?.blocked_devices ??
    (typeof opnsenseDetails.blocked_ip_count === 'number'
      ? opnsenseDetails.blocked_ip_count
      : 0)
  const protectedDevices = summary?.protected_devices ?? 2
  const activeTimerCount = (deviceList?.devices ?? []).filter(
    (d) => d.active_override && d.active_override.is_active,
  ).length

  return (
    <AppLayout
      overallStatus={healthReport?.overall_status}
      version={healthReport?.version}
      activeTab={activeTab}
      onSelectTab={onSelectTab}
    >
      <div className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">
              System Connectivity &amp; Telemetry Status
            </h1>
            <p className="text-sm text-slate-400">
              Live health verification for OPNsense firewall API, Elasticsearch 9.4.3 data stream, and local state storage
            </p>
          </div>

          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{isFetching ? 'Refreshing...' : 'Refresh Status'}</span>
          </button>
        </div>

        {isError && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200"
          >
            Failed to load system health report:{' '}
            {error instanceof Error ? error.message : 'Unknown error'}
          </div>
        )}

        {isLoading && !healthReport ? (
          <div
            data-testid="health-loading"
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-400"
          >
            Checking OPNsense, Elasticsearch, and SQLite connectivity...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <ServiceCard
              testId="service-card-opnsense"
              title="OPNsense Firewall"
              subtitle="gateway.sparkle-pony.com"
              icon={<Router className="h-5 w-5" aria-hidden="true" />}
              health={healthReport?.services?.opnsense}
            />

            <ServiceCard
              testId="service-card-elasticsearch"
              title="Elasticsearch 9.4.3"
              subtitle="es1.sparkle-pony.com (logs-pfsense.log*)"
              icon={<Database className="h-5 w-5" aria-hidden="true" />}
              health={healthReport?.services?.elasticsearch}
            />

            <ServiceCard
              testId="service-card-sqlite"
              title="Local SQLite Store"
              subtitle="data/gateway.db"
              icon={<HardDrive className="h-5 w-5" aria-hidden="true" />}
              health={healthReport?.services?.sqlite}
            />
          </div>
        )}

        <section
          data-testid="status-enforcement-summary"
          className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Gateway Enforcement &amp; Inventory Synchronization Summary
              </h2>
              <p className="text-xs text-slate-400">
                Live state of OPNsense ARP / Dnsmasq DHCP discovery and{' '}
                <code className="text-indigo-300">gateway_blocked_devices</code> enforcement
                {deviceList?.last_synced_at
                  ? ` — Last synced ${new Date(deviceList.last_synced_at).toLocaleString()}`
                  : ''}
              </p>
            </div>
            {onSelectTab && (
              <button
                type="button"
                data-testid="status-open-devices-btn"
                onClick={() => onSelectTab('devices')}
                className="inline-flex items-center gap-1.5 self-start rounded-lg border border-indigo-500/40 bg-indigo-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 cursor-pointer"
              >
                <span>Open Devices &amp; Access Control</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Discovered Devices</span>
                <Laptop className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
              </div>
              <p className="mt-1 text-lg font-bold text-slate-100">
                {totalDevices}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Online in ARP</span>
                <Wifi className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              </div>
              <p className="mt-1 text-lg font-bold text-emerald-300">
                {onlineDevices}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Blocked in Alias</span>
                <ShieldAlert className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
              </div>
              <p className="mt-1 text-lg font-bold text-rose-300">
                {blockedDevices}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Protected IPs</span>
                <ShieldCheck className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              </div>
              <p className="mt-1 text-lg font-bold text-amber-300">
                {protectedDevices}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Active Timers</span>
                <Clock className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
              </div>
              <p className="mt-1 text-lg font-bold text-cyan-300">
                {activeTimerCount}
              </p>
            </div>
          </div>
        </section>
      </div>
    </AppLayout>
  )
}
