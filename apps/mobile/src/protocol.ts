export const PROTOCOL_VERSION = 1

export type DisplayInfo = {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  isPrimary: boolean
}

export type Envelope = {
  version: number
  type: string
  sequence?: number
  payload: Record<string, unknown>
}

export const createMessage = (
  type: string,
  payload: Record<string, unknown> = {},
  sequence?: number,
): Envelope => ({ version: PROTOCOL_VERSION, type, sequence, payload })

