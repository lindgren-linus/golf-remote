import { NativeModules, TurboModuleRegistry } from 'react-native'
import { useEffect, useState } from 'react'

type ServiceDiscoveryModule = typeof import('@inthepocket/react-native-service-discovery')

export type DiscoveredAgent = {
  id: string
  name: string
  host: string
  port: number
  protocolVersion: number
}

export type DiscoveryStatus = 'searching' | 'ready' | 'unsupported' | 'error'

const SERVICE_TYPE = 'golfremote'

function getServiceDiscoveryModule(): ServiceDiscoveryModule | null {
  // Expo Go does not contain this project's custom mDNS native module. Check
  // before requiring it: on the new architecture the module otherwise throws
  // during import rather than letting the manual-IP fallback render.
  const moduleIsInstalled = NativeModules.ServiceDiscovery != null || TurboModuleRegistry.get('ServiceDiscovery') != null
  if (!moduleIsInstalled) return null
  return require('@inthepocket/react-native-service-discovery') as ServiceDiscoveryModule
}

function toAgent(service: { name: string; addresses: string[]; port: number; txt: Record<string, string> }): DiscoveredAgent | null {
  const protocolVersion = Number(service.txt.version)
  const host = service.addresses.find((address) => address.includes('.')) ?? service.addresses[0]
  if (!host || !service.port || protocolVersion !== 1) return null

  return {
    id: service.txt.id || `${service.name}-${host}-${service.port}`,
    name: service.txt.name || service.name,
    host,
    port: service.port,
    protocolVersion,
  }
}

export function useServiceDiscovery() {
  const [agents, setAgents] = useState<DiscoveredAgent[]>([])
  const [status, setStatus] = useState<DiscoveryStatus>('searching')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let foundSubscription: { remove: () => void } | undefined
    let lostSubscription: { remove: () => void } | undefined
    const serviceDiscovery = getServiceDiscoveryModule()
    if (!serviceDiscovery) {
      setStatus('unsupported')
      setError('Expo Go saknar stöd för automatisk nätverksupptäckt. Anslut med datorns IP-adress nedan.')
      return () => { active = false }
    }

    try {
      foundSubscription = serviceDiscovery.addEventListener('serviceFound', (service) => {
        const agent = toAgent(service)
        if (!active || !agent) return
        setAgents((current) => [...current.filter((item) => item.id !== agent.id), agent].sort((a, b) => a.name.localeCompare(b.name)))
        setStatus('ready')
      })
      lostSubscription = serviceDiscovery.addEventListener('serviceLost', (service) => {
        const agent = toAgent(service)
        if (active && agent) setAgents((current) => current.filter((item) => item.id !== agent.id))
      })
      void serviceDiscovery.startSearch(SERVICE_TYPE).catch(() => {
        if (!active) return
        setStatus('unsupported')
        setError('Automatisk upptäckt är inte tillgänglig. Anslut med datorns IP-adress.')
      })
    } catch {
      setStatus('unsupported')
      setError('Automatisk upptäckt är inte tillgänglig. Anslut med datorns IP-adress.')
    }

    return () => {
      active = false
      foundSubscription?.remove()
      lostSubscription?.remove()
      void serviceDiscovery.stopSearch(SERVICE_TYPE).catch(() => undefined)
    }
  }, [])

  return { agents, status, error }
}
