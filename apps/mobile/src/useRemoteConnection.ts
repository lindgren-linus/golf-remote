import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createMessage, DisplayInfo, Envelope } from './protocol'

const SAVED_HOST_KEY = 'golf-remote.last-host'
const SAVED_PORT_KEY = 'golf-remote.last-port'
const CLIENT_ID_KEY = 'golf-remote.client-id'
const TOKEN_KEY_PREFIX = 'golf-remote.agent-token.'

export type ConnectionStatus = 'frånkopplad' | 'ansluter' | 'parkoppling krävs' | 'ansluten' | 'fel'

function tokenKey(agentId: string) {
  return `${TOKEN_KEY_PREFIX}${agentId}`
}

async function getOrCreateClientId() {
  const existing = await SecureStore.getItemAsync(CLIENT_ID_KEY)
  if (existing) return existing

  const bytes = await Crypto.getRandomBytesAsync(16)
  const clientId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  await SecureStore.setItemAsync(CLIENT_ID_KEY, clientId)
  return clientId
}

export function useRemoteConnection() {
  const socket = useRef<WebSocket | null>(null)
  const sequence = useRef(0)
  const clientId = useRef<string | null>(null)
  const agentId = useRef<string | null>(null)
  const pairingRequested = useRef(false)
  const retriedStoredToken = useRef(false)
  const [host, setHost] = useState('')
  const [port, setPort] = useState('56789')
  const [status, setStatus] = useState<ConnectionStatus>('frånkopplad')
  const [error, setError] = useState<string | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [activeDisplayId, setActiveDisplayId] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([AsyncStorage.getItem(SAVED_HOST_KEY), AsyncStorage.getItem(SAVED_PORT_KEY)]).then(([savedHost, savedPort]) => {
      if (savedHost) setHost(savedHost)
      if (savedPort) setPort(savedPort)
    })
    return () => socket.current?.close()
  }, [])

  const send = useCallback((type: string, payload: Record<string, unknown> = {}, includeSequence = false) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false
    const nextSequence = includeSequence ? ++sequence.current : undefined
    socket.current.send(JSON.stringify(createMessage(type, payload, nextSequence)))
    return true
  }, [])

  const connectTo = useCallback(async (targetHost: string, targetPort: string | number, discoveredAgentId?: string) => {
    const cleanHost = targetHost.trim()
    const cleanPort = String(targetPort).trim()
    if (!cleanHost || !cleanPort) {
      setStatus('fel')
      setError('Skriv in datorns lokala IP-adress och port.')
      return
    }

    try {
      const currentClientId = await getOrCreateClientId()
      const knownAgentId = discoveredAgentId ?? null
      const knownToken = knownAgentId ? await SecureStore.getItemAsync(tokenKey(knownAgentId)) : null
      clientId.current = currentClientId
      agentId.current = knownAgentId
      pairingRequested.current = false
      retriedStoredToken.current = false
      setHost(cleanHost)
      setPort(cleanPort)
      socket.current?.close()
      setStatus('ansluter')
      setError(null)
      const ws = new WebSocket(`ws://${cleanHost}:${cleanPort}/ws`)
      socket.current = ws

      const sendHello = (token: string | null) => {
        ws.send(JSON.stringify(createMessage('client.hello', {
          clientId: currentClientId,
          ...(token ? { token } : {}),
        })))
      }

      ws.onopen = () => {
        if (socket.current !== ws) return
        void AsyncStorage.multiSet([[SAVED_HOST_KEY, cleanHost], [SAVED_PORT_KEY, cleanPort]])
        sendHello(knownToken)
      }
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Envelope
          if (message.version !== 1) return
          if (message.type === 'auth.authenticated') {
            setStatus('ansluten')
          }
          if (message.type === 'auth.required') {
            const receivedAgentId = typeof message.payload.agentId === 'string' ? message.payload.agentId : null
            if (!receivedAgentId) {
              setStatus('fel')
              setError('Agenten saknar ett giltigt enhets-ID för parkoppling.')
              return
            }
            agentId.current = receivedAgentId
            setStatus('parkoppling krävs')
            setError('Godkänn parkopplingen i dialogrutan på datorn.')
            if (pairingRequested.current) return
            void SecureStore.getItemAsync(tokenKey(receivedAgentId)).then((storedToken) => {
              if (socket.current !== ws || pairingRequested.current) return
              if (storedToken && !retriedStoredToken.current) {
                retriedStoredToken.current = true
                setStatus('ansluter')
                setError(null)
                sendHello(storedToken)
                return
              }
              pairingRequested.current = true
              ws.send(JSON.stringify(createMessage('client.pair.request', { clientId: currentClientId, clientName: 'Golf Remote Mobile' })))
            }).catch(() => {
              setStatus('fel')
              setError('Kunde inte läsa den säkra parkopplingen på telefonen.')
            })
          }
          if (message.type === 'client.pair.confirm' && typeof message.payload.agentId === 'string' && typeof message.payload.token === 'string') {
            const receivedAgentId = message.payload.agentId
            const receivedToken = message.payload.token
            agentId.current = receivedAgentId
            setStatus('ansluter')
            setError(null)
            void SecureStore.setItemAsync(tokenKey(receivedAgentId), receivedToken).then(() => sendHello(receivedToken)).catch(() => {
              setStatus('fel')
              setError('Kunde inte spara parkopplingen säkert på telefonen.')
            })
          }
          if (message.type === 'client.pair.denied') {
            setStatus('fel')
            setError('Parkopplingen nekades på datorn.')
          }
          if (message.type === 'display.list' && Array.isArray(message.payload.displays)) {
            setDisplays(message.payload.displays as DisplayInfo[])
          }
          if (message.type === 'display.selected' && typeof message.payload.displayId === 'string') {
            setActiveDisplayId(message.payload.displayId)
          }
          if (message.type === 'protocol.error' && typeof message.payload.message === 'string') {
            setError(message.payload.message)
          }
        } catch {
          setError('Agenten skickade ett ogiltigt svar.')
        }
      }
      ws.onerror = () => setError('Kunde inte ansluta. Kontrollera IP-adress, brandvägg och att båda enheterna är på samma nätverk.')
      ws.onclose = () => {
        if (socket.current === ws) setStatus('frånkopplad')
      }
    } catch {
      setStatus('fel')
      setError('Kunde inte förbereda den säkra parkopplingen på telefonen.')
    }
  }, [])

  const connect = useCallback(() => void connectTo(host, port), [connectTo, host, port])

  const disconnect = useCallback(() => {
    socket.current?.close()
    socket.current = null
    setStatus('frånkopplad')
  }, [])

  const selectDisplay = useCallback((display: DisplayInfo) => {
    if (send('display.select', { displayId: display.id })) setActiveDisplayId(display.id)
  }, [send])

  return { host, setHost, port, setPort, status, error, displays, activeDisplayId, connect, connectTo, disconnect, selectDisplay, send }
}
