import { StatusBar } from 'expo-status-bar'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Gyroscope } from 'expo-sensors'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import {
  GestureResponderEvent,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { DisplayInfo } from './src/protocol'
import { AirMouseFilter, defaultAirMouseSettings } from './src/airMouse'
import { useRemoteConnection } from './src/useRemoteConnection'
import { DiscoveredAgent, useServiceDiscovery } from './src/useServiceDiscovery'

type TouchState = { x: number; y: number; startedAt: number; lastMovedAt: number; moved: boolean; twoFinger: boolean }
const SENSITIVITY_KEY = 'golf-remote.touch-sensitivity-v2'
const DEFAULT_SENSITIVITY = 3
const MIN_SENSITIVITY = 0.5
const MAX_SENSITIVITY = 12
const SENSITIVITY_STEP = 0.25
const AIR_SENSITIVITY_KEY = 'golf-remote.air-sensitivity-v1'
const DEFAULT_AIR_SENSITIVITY = defaultAirMouseSettings.sensitivity
const MIN_AIR_SENSITIVITY = 0.3
const MAX_AIR_SENSITIVITY = 4
const AIR_SENSITIVITY_STEP = 0.05
const RADIANS_TO_DEGREES = 180 / Math.PI

// Sensitivity is the maximum gain for a quick swipe. Slow movement is deliberately
// dampened, so placing the cursor precisely does not require changing settings.
function motionGainForSpeed(pointsPerMillisecond: number) {
  const normalizedSpeed = Math.min(1, Math.max(0, (pointsPerMillisecond - 0.05) / 0.95))
  return 0.22 + 0.78 * normalizedSpeed * normalizedSpeed
}

export default function App() {
  const remote = useRemoteConnection()
  const discovery = useServiceDiscovery()
  const touch = useRef<TouchState>({ x: 0, y: 0, startedAt: 0, lastMovedAt: 0, moved: false, twoFinger: false })
  const lastTap = useRef(0)
  const filteredSpeed = useRef(0)
  const pendingMove = useRef({ dx: 0, dy: 0, frame: null as number | null })
  const automaticConnectionAttempt = useRef<string | null>(null)
  const airGyroscopeSubscription = useRef<ReturnType<typeof Gyroscope.addListener> | null>(null)
  const airFilter = useRef(new AirMouseFilter())
  const airHeld = useRef(false)
  const airLastSampleAt = useRef(0)
  const airTouchStartedAt = useRef(0)
  const airMoved = useRef(false)
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENSITIVITY)
  const [airSensitivity, setAirSensitivity] = useState(DEFAULT_AIR_SENSITIVITY)
  const [controlMode, setControlMode] = useState<'touchpad' | 'airmouse'>('touchpad')
  const [airMouseError, setAirMouseError] = useState<string | null>(null)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [keyboardText, setKeyboardText] = useState('')
  const [manualConnection, setManualConnection] = useState(false)
  const [connectedAgentName, setConnectedAgentName] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([AsyncStorage.getItem(SENSITIVITY_KEY), AsyncStorage.getItem(AIR_SENSITIVITY_KEY)]).then(([saved, savedAir]) => {
      const value = Number(saved)
      if (Number.isFinite(value) && value >= MIN_SENSITIVITY && value <= MAX_SENSITIVITY) setSensitivity(value)
      const airValue = Number(savedAir)
      if (Number.isFinite(airValue) && airValue >= MIN_AIR_SENSITIVITY && airValue <= MAX_AIR_SENSITIVITY) setAirSensitivity(airValue)
    })
  }, [])

  useEffect(() => () => airGyroscopeSubscription.current?.remove(), [])

  useEffect(() => {
    if (discovery.agents.length !== 1) {
      if (discovery.agents.length === 0) automaticConnectionAttempt.current = null
      return
    }
    const agent = discovery.agents[0]
    if (remote.status !== 'frånkopplad' || automaticConnectionAttempt.current === agent.id) return
    automaticConnectionAttempt.current = agent.id
    setConnectedAgentName(agent.name)
    void remote.connectTo(agent.host, agent.port, agent.id)
  }, [discovery.agents, remote.connectTo, remote.status])

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => remote.status === 'ansluten',
    onMoveShouldSetPanResponder: () => remote.status === 'ansluten',
    onPanResponderGrant: (event) => beginTouch(event),
    onPanResponderMove: (event) => moveTouch(event),
    onPanResponderRelease: () => endTouch(),
    onPanResponderTerminate: () => undefined,
  }), [remote.status, remote.send, sensitivity])

  function updateSensitivity(next: number) {
    const clamped = Math.round(Math.min(MAX_SENSITIVITY, Math.max(MIN_SENSITIVITY, next)) * 10) / 10
    setSensitivity(clamped)
    void AsyncStorage.setItem(SENSITIVITY_KEY, String(clamped))
  }

  function updateAirSensitivity(next: number) {
    const clamped = Math.round(Math.min(MAX_AIR_SENSITIVITY, Math.max(MIN_AIR_SENSITIVITY, next)) * 100) / 100
    setAirSensitivity(clamped)
    void AsyncStorage.setItem(AIR_SENSITIVITY_KEY, String(clamped))
  }

  function sendKeyboardText(next: string) {
    if (next.startsWith(keyboardText)) {
      for (const character of Array.from(next.slice(keyboardText.length))) remote.send('keyboard.key', { key: character })
    } else if (keyboardText.startsWith(next)) {
      for (let i = 0; i < keyboardText.length - next.length; i++) remote.send('keyboard.key', { key: 'Backspace' })
    } else if (next.length > 0) {
      // A mobile keyboard can replace a word through autocorrect. Send the newly inserted characters.
      for (const character of Array.from(next)) remote.send('keyboard.key', { key: character })
    }
    setKeyboardText(next)
  }

  function sendKeyboardKey(key: string) {
    remote.send('keyboard.key', { key })
    if (key === 'Backspace') setKeyboardText((current) => current.slice(0, -1))
  }

  function connectToAgent(agent: DiscoveredAgent) {
    automaticConnectionAttempt.current = agent.id
    setConnectedAgentName(agent.name)
    setManualConnection(false)
    void remote.connectTo(agent.host, agent.port, agent.id)
  }

  async function enableAirMouse() {
    try {
      const available = await Gyroscope.isAvailableAsync()
      if (!available) {
        setAirMouseError('Den här telefonen saknar rörelsesensor för air mouse.')
        return
      }
      // Android exposes the raw gyroscope without a runtime permission. Expo
      // Go can report a denied permission response there even though the
      // sensor itself is available, so only gate iOS/web on the request.
      if (Platform.OS !== 'android') {
        const permission = await Gyroscope.requestPermissionsAsync()
        if (permission.status !== 'granted') {
          setAirMouseError('Rörelseåtkomst nekades. Tillåt rörelse i telefonens inställningar.')
          return
        }
      }
      airGyroscopeSubscription.current?.remove()
      Gyroscope.setUpdateInterval(20)
      airFilter.current.reset()
      airLastSampleAt.current = Date.now()
      const selectedDisplay = remote.displays.find((display) => display.id === remote.activeDisplayId)
      const shortestDisplaySide = selectedDisplay ? Math.min(selectedDisplay.width, selectedDisplay.height) : 1
      const horizontalScale = selectedDisplay ? selectedDisplay.width / shortestDisplaySide : 1
      const verticalScale = selectedDisplay ? selectedDisplay.height / shortestDisplaySide : 1
      airGyroscopeSubscription.current = Gyroscope.addListener((sample) => {
        if (!airHeld.current) return
        const now = Date.now()
        const move = airFilter.current.update({
          // Pitch (X) is the natural up/down motion for an upright phone;
          // roll (Z), not yaw (Y), is the natural left/right tilt.
          beta: sample.x * RADIANS_TO_DEGREES,
          gamma: sample.z * RADIANS_TO_DEGREES,
        }, now - airLastSampleAt.current, {
          ...defaultAirMouseSettings,
          sensitivity: airSensitivity,
          horizontalScale,
          verticalScale,
        })
        airLastSampleAt.current = now
        if (move.dx !== 0 || move.dy !== 0) {
          if (Math.hypot(move.dx, move.dy) > 1) airMoved.current = true
          queuePointerMove(move.dx, move.dy)
        }
      })
      setAirMouseError(null)
      setControlMode('airmouse')
    } catch {
      setAirMouseError('Kunde inte starta rörelsesensorn.')
    }
  }

  function enableTouchpad() {
    airHeld.current = false
    airFilter.current.reset()
    airGyroscopeSubscription.current?.remove()
    airGyroscopeSubscription.current = null
    setControlMode('touchpad')
  }

  function beginAirControl() {
    if (!connected) return
    airFilter.current.reset()
    airLastSampleAt.current = Date.now()
    airTouchStartedAt.current = Date.now()
    airMoved.current = false
    airHeld.current = true
  }

  function endAirControl() {
    const wasTap = !airMoved.current && Date.now() - airTouchStartedAt.current < 250
    airHeld.current = false
    airFilter.current.reset()
    flushPointerMove()
    if (wasTap) remote.send('pointer.click')
  }

  function point(event: GestureResponderEvent) {
    const native = event.nativeEvent
    const first = native.touches[0] ?? native
    return { x: first.pageX, y: first.pageY, touchCount: native.touches.length }
  }

  function beginTouch(event: GestureResponderEvent) {
    const current = point(event)
    const now = Date.now()
    filteredSpeed.current = 0
    touch.current = { x: current.x, y: current.y, startedAt: now, lastMovedAt: now, moved: false, twoFinger: current.touchCount >= 2 }
  }

  function moveTouch(event: GestureResponderEvent) {
    const current = point(event)
    const dx = current.x - touch.current.x
    const dy = current.y - touch.current.y
    const now = Date.now()
    const elapsed = Math.max(1, now - touch.current.lastMovedAt)
    const rawSpeed = Math.hypot(dx, dy) / elapsed
    filteredSpeed.current = filteredSpeed.current * 0.65 + rawSpeed * 0.35
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) touch.current.moved = true
    if (current.touchCount >= 2 || touch.current.twoFinger) {
      remote.send('pointer.scroll', { delta: -dy * 12 })
      touch.current.twoFinger = true
    } else {
      const gain = motionGainForSpeed(filteredSpeed.current)
      queuePointerMove(dx * sensitivity * gain, dy * sensitivity * gain)
    }
    touch.current.x = current.x
    touch.current.y = current.y
    touch.current.lastMovedAt = now
  }

  function endTouch() {
    flushPointerMove()
    const wasTap = !touch.current.moved && !touch.current.twoFinger && Date.now() - touch.current.startedAt < 250
    if (!wasTap) return
    const now = Date.now()
    if (now - lastTap.current < 300) {
      remote.send('pointer.doubleClick')
      lastTap.current = 0
    } else {
      remote.send('pointer.click')
      lastTap.current = now
    }
  }

  function queuePointerMove(dx: number, dy: number) {
    pendingMove.current.dx += dx
    pendingMove.current.dy += dy
    if (pendingMove.current.frame !== null) return

    pendingMove.current.frame = requestAnimationFrame(() => {
      const queued = pendingMove.current
      queued.frame = null
      const move = { dx: queued.dx, dy: queued.dy }
      queued.dx = 0
      queued.dy = 0
      if (move.dx !== 0 || move.dy !== 0) remote.send('pointer.move', move, true)
    })
  }

  function flushPointerMove() {
    const queued = pendingMove.current
    if (queued.frame !== null) cancelAnimationFrame(queued.frame)
    queued.frame = null
    const move = { dx: queued.dx, dy: queued.dy }
    queued.dx = 0
    queued.dy = 0
    if (move.dx !== 0 || move.dy !== 0) remote.send('pointer.move', move, true)
  }

  const connected = remote.status === 'ansluten'
  const usesManualOnly = discovery.status === 'unsupported'

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'right', 'bottom', 'left']}>
        <StatusBar style="light" />
        <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Golf Remote</Text>
          <TouchableOpacity style={styles.settingsButton} onPress={() => setSettingsVisible(true)}>
            <Text style={styles.settingsButtonText}>Inställningar</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.status, remote.status === 'ansluten' ? styles.connected : styles.disconnected]}>{remote.status.toUpperCase()}</Text>

        {connected ? <View style={styles.connectionRow}>
          <Text style={styles.connectionName}>Ansluten till {connectedAgentName ?? remote.host}</Text>
          <TouchableOpacity style={styles.connectButton} onPress={remote.disconnect}><Text style={styles.connectText}>Koppla från</Text></TouchableOpacity>
        </View> : (manualConnection || usesManualOnly) ? <View style={styles.manualConnection}>
          {usesManualOnly ? <View style={styles.expoGoInfo}>
            <Text style={styles.expoGoTitle}>Expo Go-läge</Text>
            <Text style={styles.discoveryText}>Automatisk sökning fungerar inte i Expo Go. Starta Windows-agenten och skriv in IPv4-adressen från raden “Mobilanslutning: ws://…”. Porten är normalt 56789.</Text>
          </View> : null}
          <View style={styles.connectionRow}>
            <TextInput value={remote.host} onChangeText={remote.setHost} placeholder="Datorns IP-adress" placeholderTextColor="#8b95a5" keyboardType="numbers-and-punctuation" autoCapitalize="none" style={[styles.input, styles.hostInput]} />
            <TextInput value={remote.port} onChangeText={remote.setPort} placeholder="Port" placeholderTextColor="#8b95a5" keyboardType="number-pad" style={[styles.input, styles.portInput]} />
            <TouchableOpacity style={styles.connectButton} onPress={remote.connect}><Text style={styles.connectText}>Anslut</Text></TouchableOpacity>
          </View>
          {!usesManualOnly ? <TouchableOpacity onPress={() => setManualConnection(false)}><Text style={styles.manualLink}>Tillbaka till automatisk sökning</Text></TouchableOpacity> : null}
        </View> : <View style={styles.discoveryPanel}>
          <Text style={styles.discoveryText}>{discovery.status === 'searching' ? 'Söker efter simulator-datorer på nätverket…' : discovery.status === 'unsupported' ? 'Automatisk upptäckt är inte tillgänglig i Expo Go.' : discovery.agents.length === 0 ? 'Ingen simulator-dator hittades på nätverket.' : discovery.agents.length === 1 ? 'Simulator-dator hittad — ansluter…' : 'Välj simulator-dator:'}</Text>
          {discovery.agents.length > 1 ? discovery.agents.map((agent) => <AgentButton key={agent.id} agent={agent} onPress={() => connectToAgent(agent)} />) : null}
          <TouchableOpacity onPress={() => setManualConnection(true)}><Text style={styles.manualLink}>Anslut manuellt med IP-adress</Text></TouchableOpacity>
        </View>}

        {remote.error ? <Text style={styles.error}>{remote.error}</Text> : null}

        <View style={styles.displayRow}>
          {remote.displays.length === 0 ? <Text style={styles.helper}>{connected ? 'Hämtar skärmar…' : 'Anslut för att välja skärm.'}</Text> : remote.displays.map((display) => (
            <DisplayButton key={display.id} display={display} active={display.id === remote.activeDisplayId} onPress={() => remote.selectDisplay(display)} />
          ))}
        </View>

        {controlMode === 'touchpad' ? <View {...panResponder.panHandlers} style={[styles.touchpad, !connected && styles.touchpadDisabled]}>
          <Text style={styles.touchpadText}>{connected ? 'TOUCHPAD\nDra för att flytta · tryck för klick\nTvå fingrar för scroll' : 'Anslut till agenten för att börja'}</Text>
        </View> : <TouchableOpacity
          disabled={!connected}
          activeOpacity={0.82}
          onPressIn={beginAirControl}
          onPressOut={endAirControl}
          style={[styles.touchpad, styles.airMousePad, !connected && styles.touchpadDisabled]}
        >
          <Text style={styles.touchpadText}>{connected ? 'AIR MOUSE\nDutta för vänsterklick · håll ned och vrid för att styra\nSläpp för att frysa och återcentrera' : 'Anslut till agenten för att börja'}</Text>
        </TouchableOpacity>}

        <View style={styles.modeRow}>
          <TouchableOpacity style={[styles.modeButton, controlMode === 'touchpad' && styles.modeButtonActive]} onPress={enableTouchpad}><Text style={styles.modeButtonText}>Touchpad</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.modeButton, controlMode === 'airmouse' && styles.modeButtonActive]} onPress={() => void enableAirMouse()}><Text style={styles.modeButtonText}>Air mouse</Text></TouchableOpacity>
        </View>
        {airMouseError ? <Text style={styles.error}>{airMouseError}</Text> : null}

        <View style={styles.buttonRow}>
          <TouchableOpacity disabled={!connected} style={[styles.mouseButton, !connected && styles.buttonDisabled]} onPress={() => remote.send('pointer.click')}><Text style={styles.mouseText}>Vänsterklick</Text></TouchableOpacity>
          <TouchableOpacity disabled={!connected} style={[styles.mouseButton, !connected && styles.buttonDisabled]} onPress={() => remote.send('pointer.click', { button: 'right' })}><Text style={styles.mouseText}>Högerklick</Text></TouchableOpacity>
        </View>
        <TouchableOpacity disabled={!connected} style={[styles.keyboardButton, !connected && styles.buttonDisabled]} onPress={() => setKeyboardVisible(true)}><Text style={styles.keyboardButtonText}>Tangentbord</Text></TouchableOpacity>
        <Text style={styles.footer}>Lokal WebSocket · Touch {sensitivity.toFixed(2).replace('.', ',')}× · Air {airSensitivity.toFixed(2).replace('.', ',')}×</Text>
        </View>
        <SettingsModal
          visible={settingsVisible}
          sensitivity={sensitivity}
          airSensitivity={airSensitivity}
          onChange={updateSensitivity}
          onChangeAir={updateAirSensitivity}
          onClose={() => setSettingsVisible(false)}
        />
        <KeyboardModal
          visible={keyboardVisible}
          value={keyboardText}
          onChangeText={sendKeyboardText}
          onKey={sendKeyboardKey}
          onClose={() => { setKeyboardVisible(false); setKeyboardText('') }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

function DisplayButton({ display, active, onPress }: { display: DisplayInfo; active: boolean; onPress: () => void }) {
  return <TouchableOpacity style={[styles.displayButton, active && styles.displayButtonActive]} onPress={onPress}>
    <Text style={styles.displayName}>{display.name.replace('\\\\.\\\\', '')}</Text>
    <Text style={styles.displayMeta}>{display.width} × {display.height}{display.isPrimary ? ' · Primär' : ''}</Text>
  </TouchableOpacity>
}

function AgentButton({ agent, onPress }: { agent: DiscoveredAgent; onPress: () => void }) {
  return <TouchableOpacity style={styles.agentButton} onPress={onPress}>
    <Text style={styles.agentName}>{agent.name}</Text>
    <Text style={styles.agentMeta}>{agent.host}:{agent.port}</Text>
  </TouchableOpacity>
}

function SettingsModal({ visible, sensitivity, airSensitivity, onChange, onChangeAir, onClose }: { visible: boolean; sensitivity: number; airSensitivity: number; onChange: (value: number) => void; onChangeAir: (value: number) => void; onClose: () => void }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.modalBackdrop}>
      <View style={styles.settingsPanel}>
        <Text style={styles.settingsTitle}>Inställningar</Text>
        <Text style={styles.settingLabel}>Touchkänslighet</Text>
        <Text style={styles.settingHelp}>Påverkar hur långt musen rör sig för varje fingerdragning.</Text>
        <View style={styles.sensitivityRow}>
          <TouchableOpacity style={styles.stepButton} onPress={() => onChange(sensitivity - SENSITIVITY_STEP)}><Text style={styles.stepButtonText}>−</Text></TouchableOpacity>
          <Text style={styles.sensitivityValue}>{sensitivity.toFixed(2).replace('.', ',')}×</Text>
          <TouchableOpacity style={styles.stepButton} onPress={() => onChange(sensitivity + SENSITIVITY_STEP)}><Text style={styles.stepButtonText}>+</Text></TouchableOpacity>
        </View>
        <Text style={styles.settingRange}>0,50× till 12,00× · steg om 0,25</Text>
        <Text style={styles.settingPrecision}>Adaptiv precision är på: långsamma dragningar blir finare, snabba svep använder full känslighet.</Text>
        <TouchableOpacity style={styles.resetButton} onPress={() => onChange(DEFAULT_SENSITIVITY)}><Text style={styles.resetButtonText}>Återställ till 3,00×</Text></TouchableOpacity>
        <View style={styles.settingDivider} />
        <Text style={styles.settingLabel}>Air mouse-känslighet</Text>
        <Text style={styles.settingHelp}>Påverkar hur snabbt pekaren rör sig när du vrider telefonen medan du håller ned air mouse-ytan.</Text>
        <View style={styles.sensitivityRow}>
          <TouchableOpacity style={styles.stepButton} onPress={() => onChangeAir(airSensitivity - AIR_SENSITIVITY_STEP)}><Text style={styles.stepButtonText}>−</Text></TouchableOpacity>
          <Text style={styles.sensitivityValue}>{airSensitivity.toFixed(2).replace('.', ',')}×</Text>
          <TouchableOpacity style={styles.stepButton} onPress={() => onChangeAir(airSensitivity + AIR_SENSITIVITY_STEP)}><Text style={styles.stepButtonText}>+</Text></TouchableOpacity>
        </View>
        <Text style={styles.settingRange}>0,30× till 4,00× · steg om 0,05</Text>
        <Text style={styles.settingPrecision}>Små rörelser filtreras bort och resterande rörelse mjukas ut. Släpp ytan för att återcentrera utan att flytta pekaren.</Text>
        <TouchableOpacity style={styles.resetButton} onPress={() => onChangeAir(DEFAULT_AIR_SENSITIVITY)}><Text style={styles.resetButtonText}>Återställ air mouse</Text></TouchableOpacity>
        <TouchableOpacity style={styles.doneButton} onPress={onClose}><Text style={styles.doneButtonText}>Klar</Text></TouchableOpacity>
      </View>
    </View>
  </Modal>
}

function KeyboardModal({ visible, value, onChangeText, onKey, onClose }: { visible: boolean; value: string; onChangeText: (value: string) => void; onKey: (key: string) => void; onClose: () => void }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.modalBackdrop}>
      <View style={styles.settingsPanel}>
        <Text style={styles.settingsTitle}>Tangentbord</Text>
        <Text style={styles.settingHelp}>Skriv i fältet för att skicka tecken till den aktiva datorn.</Text>
        <TextInput
          autoFocus
          autoCorrect={false}
          value={value}
          onChangeText={onChangeText}
          placeholder="Skriv här…"
          placeholderTextColor="#8b95a5"
          style={styles.keyboardInput}
        />
        <View style={styles.shortcutRow}>
          <Shortcut label="Esc" onPress={() => onKey('Escape')} />
          <Shortcut label="←" onPress={() => onKey('ArrowLeft')} />
          <Shortcut label="↑" onPress={() => onKey('ArrowUp')} />
          <Shortcut label="↓" onPress={() => onKey('ArrowDown')} />
          <Shortcut label="→" onPress={() => onKey('ArrowRight')} />
        </View>
        <View style={styles.shortcutRow}>
          <Shortcut label="⌫" onPress={() => onKey('Backspace')} />
          <Shortcut label="Mellanslag" wide onPress={() => onKey('Space')} />
          <Shortcut label="Enter" onPress={() => onKey('Enter')} />
        </View>
        <TouchableOpacity style={styles.doneButton} onPress={onClose}><Text style={styles.doneButtonText}>Klar</Text></TouchableOpacity>
      </View>
    </View>
  </Modal>
}

function Shortcut({ label, wide = false, onPress }: { label: string; wide?: boolean; onPress: () => void }) {
  return <TouchableOpacity style={[styles.shortcutButton, wide && styles.shortcutButtonWide]} onPress={onPress}><Text style={styles.shortcutText}>{label}</Text></TouchableOpacity>
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b1018' },
  container: { flex: 1, padding: 18, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#f4f7fb', fontSize: 28, fontWeight: '800' },
  settingsButton: { borderWidth: 1, borderColor: '#38526d', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  settingsButtonText: { color: '#c6d9ed', fontSize: 13, fontWeight: '700' },
  status: { alignSelf: 'flex-start', borderRadius: 20, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: '800' },
  connected: { color: '#081f14', backgroundColor: '#69d99b' },
  disconnected: { color: '#3b2b09', backgroundColor: '#f2bf63' },
  connectionRow: { flexDirection: 'row', gap: 7 },
  manualConnection: { gap: 8 },
  connectionName: { flex: 1, color: '#c6d9ed', alignSelf: 'center', fontWeight: '700' },
  discoveryPanel: { gap: 9, backgroundColor: '#121c29', borderRadius: 10, padding: 12 },
  expoGoInfo: { gap: 5, backgroundColor: '#1b2d41', borderRadius: 10, padding: 12 },
  expoGoTitle: { color: '#81c5ff', fontWeight: '800', fontSize: 15 },
  discoveryText: { color: '#c6d9ed', lineHeight: 19 },
  manualLink: { color: '#7dbbff', alignSelf: 'center', paddingVertical: 5, fontSize: 13, fontWeight: '700' },
  agentButton: { backgroundColor: '#27435f', borderRadius: 10, padding: 12 },
  agentName: { color: 'white', fontWeight: '800', fontSize: 16 },
  agentMeta: { color: '#b7c9dc', marginTop: 3, fontSize: 12 },
  input: { color: '#eef4ff', backgroundColor: '#172231', borderColor: '#293b51', borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, height: 44 },
  hostInput: { flex: 1 },
  portInput: { width: 66 },
  connectButton: { backgroundColor: '#2e7eea', borderRadius: 9, justifyContent: 'center', paddingHorizontal: 12 },
  connectText: { color: 'white', fontWeight: '800' },
  error: { color: '#ff9a96', fontSize: 13 },
  helper: { color: '#aeb9c7', paddingVertical: 12 },
  displayRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  displayButton: { flexGrow: 1, minWidth: 145, backgroundColor: '#172231', borderColor: '#2c4056', borderWidth: 1, borderRadius: 12, padding: 15 },
  displayButtonActive: { backgroundColor: '#124b7b', borderColor: '#4fa6ff', borderWidth: 2 },
  displayName: { color: 'white', fontWeight: '800', fontSize: 18 },
  displayMeta: { color: '#b3c0d1', marginTop: 4, fontSize: 12 },
  touchpad: { flex: 1, minHeight: 230, borderRadius: 18, borderWidth: 2, borderColor: '#3a536c', backgroundColor: '#121c29', alignItems: 'center', justifyContent: 'center' },
  airMousePad: { borderColor: '#4b7cab', backgroundColor: '#13283b' },
  touchpadDisabled: { opacity: 0.55 },
  touchpadText: { color: '#c2cedc', textAlign: 'center', lineHeight: 22 },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeButton: { flex: 1, minHeight: 43, borderRadius: 10, borderWidth: 1, borderColor: '#38526d', alignItems: 'center', justifyContent: 'center', backgroundColor: '#172231' },
  modeButtonActive: { borderColor: '#4fa6ff', backgroundColor: '#174b78' },
  modeButtonText: { color: '#eaf2fc', fontWeight: '800' },
  buttonRow: { flexDirection: 'row', gap: 10 },
  mouseButton: { flex: 1, backgroundColor: '#27435f', minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { opacity: 0.45 },
  mouseText: { color: 'white', fontSize: 16, fontWeight: '800' },
  keyboardButton: { minHeight: 48, backgroundColor: '#203a53', borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  keyboardButtonText: { color: 'white', fontSize: 16, fontWeight: '800' },
  footer: { color: '#7f8da0', textAlign: 'center', fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.68)', justifyContent: 'flex-end' },
  settingsPanel: { backgroundColor: '#152131', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, gap: 12 },
  settingsTitle: { color: 'white', fontSize: 24, fontWeight: '800' },
  settingLabel: { color: '#eff5fc', fontSize: 17, fontWeight: '800', marginTop: 4 },
  settingHelp: { color: '#aebdce', lineHeight: 20 },
  sensitivityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginVertical: 6 },
  stepButton: { width: 58, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#294765' },
  stepButtonText: { color: 'white', fontSize: 31, fontWeight: '700', lineHeight: 35 },
  sensitivityValue: { color: '#71bcff', minWidth: 100, textAlign: 'center', fontSize: 28, fontWeight: '800' },
  settingRange: { color: '#8294a9', textAlign: 'center', fontSize: 12 },
  settingPrecision: { color: '#aebdce', textAlign: 'center', fontSize: 12, lineHeight: 18 },
  settingDivider: { height: 1, backgroundColor: '#2d4055', marginVertical: 4 },
  resetButton: { alignItems: 'center', padding: 10 },
  resetButtonText: { color: '#9dcbfa', fontWeight: '700' },
  doneButton: { alignItems: 'center', backgroundColor: '#2e7eea', borderRadius: 10, padding: 15 },
  doneButtonText: { color: 'white', fontSize: 16, fontWeight: '800' },
  keyboardInput: { color: '#eef4ff', backgroundColor: '#0e1722', borderWidth: 1, borderColor: '#38526d', borderRadius: 10, minHeight: 52, paddingHorizontal: 13, fontSize: 18 },
  shortcutRow: { flexDirection: 'row', gap: 7 },
  shortcutButton: { flex: 1, minHeight: 44, borderRadius: 8, backgroundColor: '#294765', alignItems: 'center', justifyContent: 'center' },
  shortcutButtonWide: { flex: 2 },
  shortcutText: { color: 'white', fontWeight: '700' },
})
