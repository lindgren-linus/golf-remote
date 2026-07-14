export type RotationRate = {
  beta: number | null
  gamma: number | null
}

export type AirMouseSettings = {
  sensitivity: number
  deadZoneDegreesPerSecond: number
  smoothing: number
  maxSpeedPixelsPerSecond: number
  horizontalScale?: number
  verticalScale?: number
}

export const defaultAirMouseSettings: AirMouseSettings = {
  sensitivity: 1.5,
  deadZoneDegreesPerSecond: 2,
  smoothing: 0.72,
  maxSpeedPixelsPerSecond: 3500,
}

// DeviceMotion reports degrees per second, while the cursor needs pixels per
// second. Without this conversion a whole phone tilt only moves a few pixels.
const PIXELS_PER_DEGREE = 35
const FULL_SPEED_DEGREES_PER_SECOND = 55
const PRECISION_CURVE = 1.65

function precisionRate(rate: number, deadZone: number) {
  const direction = Math.sign(rate)
  const magnitude = Math.max(0, Math.abs(rate) - deadZone)
  if (magnitude === 0) return 0
  if (magnitude >= FULL_SPEED_DEGREES_PER_SECOND) return direction * magnitude

  // A curve below normal sweeping speed turns hand tremor into almost no
  // cursor movement, but catches up to full speed for a deliberate gesture.
  return direction * FULL_SPEED_DEGREES_PER_SECOND * Math.pow(magnitude / FULL_SPEED_DEGREES_PER_SECOND, PRECISION_CURVE)
}

export class AirMouseFilter {
  private filteredX = 0
  private filteredY = 0

  reset() {
    this.filteredX = 0
    this.filteredY = 0
  }

  update(rotationRate: RotationRate, elapsedMilliseconds: number, settings: AirMouseSettings) {
    const seconds = Math.min(0.1, Math.max(0.001, elapsedMilliseconds / 1000))
    const gamma = rotationRate.gamma ?? 0
    const beta = rotationRate.beta ?? 0
    const xRate = precisionRate(gamma, settings.deadZoneDegreesPerSecond)
    const yRate = precisionRate(beta, settings.deadZoneDegreesPerSecond)
    const targetX = -xRate * PIXELS_PER_DEGREE * settings.sensitivity * (settings.horizontalScale ?? 1)
    const targetY = -yRate * PIXELS_PER_DEGREE * settings.sensitivity * (settings.verticalScale ?? 1)
    const keep = Math.min(0.98, Math.max(0, settings.smoothing))

    // Do not let the low-pass filter coast after the phone has stopped. That
    // trailing value feels like cursor drift precisely when aiming at a button.
    this.filteredX = targetX === 0 ? 0 : this.filteredX * keep + targetX * (1 - keep)
    this.filteredY = targetY === 0 ? 0 : this.filteredY * keep + targetY * (1 - keep)

    const maximumMove = settings.maxSpeedPixelsPerSecond * seconds
    return {
      dx: Math.max(-maximumMove, Math.min(maximumMove, this.filteredX * seconds)),
      dy: Math.max(-maximumMove, Math.min(maximumMove, this.filteredY * seconds)),
    }
  }
}
