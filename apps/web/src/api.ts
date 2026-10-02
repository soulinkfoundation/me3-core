/**
 * API client for me3
 */

// Use relative /api by default so OSS installs do not point at ME3 Cloud.
export const API_BASE = import.meta.env.VITE_API_BASE || '/api'
export const USERNAME_AVAILABILITY_API_BASE =
  import.meta.env.VITE_USERNAME_AVAILABILITY_API_BASE || API_BASE

export type LocationPrecision =
  | 'locality'
  | 'city'
  | 'district'
  | 'county'
  | 'region'
  | 'country'
  | 'unknown'

export interface LocationSearchResult {
  id: string
  label: string
  latitude: number
  longitude: number
  precision: LocationPrecision
  locality?: string
  region?: string
  country?: string
  countryCode?: string
  source: {
    provider: string
    id?: string
    osmType?: string
    osmId?: string | number
    osmKey?: string
    osmValue?: string
  }
}

function sanitizeErrorMessage(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const trimmed = raw.trim()
  if (!trimmed) return fallback

  const looksLikeHtml =
    /^<!doctype html>/i.test(trimmed) ||
    /^<html[\s>]/i.test(trimmed) ||
    /<body[\s>]/i.test(trimmed)

  if (!looksLikeHtml) return trimmed

  const titleMatch = trimmed.match(/<title>(.*?)<\/title>/i)
  const title = titleMatch?.[1]?.trim()
  return title || 'Unexpected server response'
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export type ApiStreamEvent = {
  event: string
  data: unknown
}

export type MailboxMessageReceivedEvent = {
  type: 'mailbox.message_received'
  mailboxId: string
  messageId: string
  receivedAt: string
}

export type MailboxEventSubscription = {
  close(): void
}

export type MailboxEventHandlers = {
  onMessageReceived(event: MailboxMessageReceivedEvent): void
  onReconnect(): void
}

type ApiStreamRequestOptions = RequestInit & {
  onResponse?: (response: Response) => void
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {}

  // Copy existing headers if any
  if (options.headers) {
    const existingHeaders = options.headers as Record<string, string>
    Object.assign(headers, existingHeaders)
  }

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  const text = await response.text()
  const data = text
    ? (() => {
        try {
          return JSON.parse(text)
        } catch {
          return { error: text }
        }
      })()
    : {}

  if (!response.ok) {
    throw new ApiError(
      sanitizeErrorMessage(data.error, 'Request failed'),
      response.status
    )
  }

  return data as T
}

async function streamEvents(
  endpoint: string,
  body: unknown,
  onEvent: (event: ApiStreamEvent) => void,
  options: ApiStreamRequestOptions = {}
): Promise<void> {
  const { onResponse, ...requestOptions } = options
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  }

  if (requestOptions.headers) {
    Object.assign(headers, requestOptions.headers as Record<string, string>)
  }

  headers['Content-Type'] = 'application/json'

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...requestOptions,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  })
  onResponse?.(response)

  if (!response.ok) {
    const text = await response.text()
    const data = text
      ? (() => {
          try {
            return JSON.parse(text)
          } catch {
            return { error: text }
          }
        })()
      : {}
    throw new ApiError(
      sanitizeErrorMessage(data.error, 'Request failed'),
      response.status
    )
  }

  if (!response.body) return

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    buffer = flushStreamEventBuffer(buffer, onEvent)
  }

  buffer += decoder.decode()
  flushStreamEventBuffer(`${buffer}\n\n`, onEvent)
}

function flushStreamEventBuffer(
  buffer: string,
  onEvent: (event: ApiStreamEvent) => void
): string {
  let cursor = buffer.indexOf('\n\n')
  while (cursor >= 0) {
    const raw = buffer.slice(0, cursor)
    buffer = buffer.slice(cursor + 2)
    emitStreamEvent(raw, onEvent)
    cursor = buffer.indexOf('\n\n')
  }
  return buffer
}

function emitStreamEvent(
  raw: string,
  onEvent: (event: ApiStreamEvent) => void
) {
  const lines = raw.split(/\r?\n/)
  let event = 'message'
  const data: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim() || event
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart())
    }
  }

  if (data.length === 0) return
  const rawData = data.join('\n')
  onEvent({
    event,
    data: (() => {
      try {
        return JSON.parse(rawData)
      } catch {
        return rawData
      }
    })(),
  })
}

function apiUrl(base: string, endpoint: string): string {
  return `${base.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`
}

function isMailboxMessageReceivedEvent(value: unknown): value is MailboxMessageReceivedEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const event = value as Record<string, unknown>
  return (
    event.type === 'mailbox.message_received' &&
    typeof event.mailboxId === 'string' &&
    Boolean(event.mailboxId) &&
    typeof event.messageId === 'string' &&
    Boolean(event.messageId) &&
    typeof event.receivedAt === 'string' &&
    Boolean(event.receivedAt)
  )
}

function subscribeMailboxEvents(handlers: MailboxEventHandlers): MailboxEventSubscription {
  const source = new EventSource(apiUrl(API_BASE, '/mailbox/events'), {
    withCredentials: true,
  })
  let opened = false
  let disconnected = false

  const handleOpen = () => {
    if (opened || disconnected) handlers.onReconnect()
    opened = true
    disconnected = false
  }
  const handleError = () => {
    disconnected = true
  }
  const handleMessageReceived = (rawEvent: Event) => {
    const data = (() => {
      try {
        return JSON.parse((rawEvent as MessageEvent<string>).data)
      } catch {
        return null
      }
    })()
    if (isMailboxMessageReceivedEvent(data)) handlers.onMessageReceived(data)
  }

  source.addEventListener('open', handleOpen)
  source.addEventListener('error', handleError)
  source.addEventListener('mailbox.message_received', handleMessageReceived)

  return {
    close() {
      source.removeEventListener('open', handleOpen)
      source.removeEventListener('error', handleError)
      source.removeEventListener('mailbox.message_received', handleMessageReceived)
      source.close()
    },
  }
}

export async function getUsernameAvailability(username: string): Promise<boolean> {
  const response = await fetch(
    apiUrl(
      USERNAME_AVAILABILITY_API_BASE,
      `/usernames/${encodeURIComponent(username)}/available`
    ),
    {
      method: 'GET',
      credentials: 'include',
    }
  )

  const text = await response.text()
  const data = text
    ? (() => {
        try {
          return JSON.parse(text)
        } catch {
          return { error: text }
        }
      })()
    : {}

  if (!response.ok) {
    throw new ApiError(
      sanitizeErrorMessage(data.error, 'Username availability check failed'),
      response.status
    )
  }

  return data.available === true
}

export async function searchLocations(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {}
): Promise<LocationSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const params = new URLSearchParams({
    q: trimmed,
    limit: String(options.limit ?? 6),
  })

  const response = await fetch(`${API_BASE}/locations/search?${params.toString()}`, {
    method: 'GET',
    credentials: 'include',
    signal: options.signal,
  })

  const text = await response.text()
  const data = text
    ? (() => {
        try {
          return JSON.parse(text)
        } catch {
          return { error: text }
        }
      })()
    : {}

  if (!response.ok) {
    throw new ApiError(
      sanitizeErrorMessage(data.error, 'Location lookup failed'),
      response.status
    )
  }

  return Array.isArray(data.locations) ? data.locations : []
}

export const api = {
  get<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return request<T>(endpoint, { ...options, method: 'GET' })
  },

  post<T>(endpoint: string, body?: unknown, options: RequestInit = {}): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  streamEvents,

  subscribeMailboxEvents,

  put<T>(endpoint: string, body?: unknown): Promise<T> {
    return request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  },

  patch<T>(endpoint: string, body?: unknown, options: RequestInit = {}): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  },

  delete<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return request<T>(endpoint, { ...options, method: 'DELETE' })
  },

  upload<T>(endpoint: string, formData: FormData, options: RequestInit = {}): Promise<T> {
    return fetch(`${API_BASE}${endpoint}`, {
      ...options,
      method: 'POST',
      body: formData,
      credentials: 'include',
    }).then(async (response) => {
      const text = await response.text()
      const data = text
        ? (() => {
            try {
              return JSON.parse(text)
            } catch {
              return { error: text }
            }
          })()
        : {}
      if (!response.ok) {
        throw new ApiError(
          sanitizeErrorMessage(data.error, 'Upload failed'),
          response.status
        )
      }
      return data as T
    })
  },
}
