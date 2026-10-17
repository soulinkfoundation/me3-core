import { describe, it, expect, beforeEach, vi } from 'vitest'
import { api, ApiError, getUsernameAvailability } from './api'

// Mock fetch globally
global.fetch = vi.fn()

/** Matches real fetch: api client reads bodies via response.text() then JSON.parse */
function mockJsonResponse(
  body: unknown,
  init?: { ok?: boolean; status?: number }
): Response {
  const text = JSON.stringify(body)
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    text: async () => text,
  } as Response
}

describe('api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('error handling', () => {
    it('should throw ApiError for non-200 responses', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockJsonResponse({ error: 'Bad request' }, { ok: false, status: 400 })
      )

      await expect(api.get('/test')).rejects.toThrow(ApiError)
      await expect(api.get('/test')).rejects.toThrow('Bad request')
    })

    it('should throw ApiError with default message when error field is missing', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockJsonResponse({}, { ok: false, status: 500 })
      )

      await expect(api.get('/test')).rejects.toThrow(ApiError)
      await expect(api.get('/test')).rejects.toThrow('Request failed')
    })

    it('should include status code in ApiError', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockJsonResponse({ error: 'Not found' }, { ok: false, status: 404 })
      )

      try {
        await api.get('/test')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError)
        expect((error as ApiError).status).toBe(404)
      }
    })

    it('keeps a machine-readable error code so callers can branch on it', async () => {
      vi.mocked(fetch).mockResolvedValue(
        mockJsonResponse({ ok: false, error: 'Sign in again to approve this payment.', code: 'fresh_authentication_required' }, { ok: false, status: 403 })
      )

      const error = await api.post('/assistant/approvals/a1', { decision: 'approved' }).catch(caught => caught)
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ status: 403, code: 'fresh_authentication_required', message: 'Sign in again to approve this payment.' })
    })
  })

  describe('credentials handling', () => {
    it('should include credentials for authenticated cookie requests', async () => {
      vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ data: 'test' }))

      await api.get('/test')

      expect(fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          credentials: 'include',
        })
      )
    })

    it('should not include Authorization header by default', async () => {
      vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ data: 'test' }))

      await api.get('/test')

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const headers = callArgs[1]?.headers as Record<string, string>
      expect(headers).not.toHaveProperty('Authorization')
    })

    it('should include credentials in upload requests', async () => {
      const formData = new FormData()
      formData.append('file', new Blob(['test']))

      vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ success: true }))

      await api.upload('/upload', formData)

      expect(fetch).toHaveBeenCalledWith(
        '/api/upload',
        expect.objectContaining({
          credentials: 'include',
        })
      )
    })

    it('should pass upload request options', async () => {
      const formData = new FormData()
      const controller = new AbortController()

      vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ success: true }))

      await api.upload('/upload', formData, { signal: controller.signal })

      expect(fetch).toHaveBeenCalledWith(
        '/api/upload',
        expect.objectContaining({
          body: formData,
          credentials: 'include',
          method: 'POST',
          signal: controller.signal,
        })
      )
    })

    it('keeps an authenticated mailbox event stream and reports reconnects', () => {
      class FakeEventSource {
        static instances: FakeEventSource[] = []
        readonly listeners = new Map<string, Set<EventListener>>()
        closed = false

        constructor(
          readonly url: string,
          readonly options?: EventSourceInit
        ) {
          FakeEventSource.instances.push(this)
        }

        addEventListener(type: string, listener: EventListener) {
          const listeners = this.listeners.get(type) || new Set<EventListener>()
          listeners.add(listener)
          this.listeners.set(type, listeners)
        }

        removeEventListener(type: string, listener: EventListener) {
          this.listeners.get(type)?.delete(listener)
        }

        emit(type: string, event: Event) {
          for (const listener of this.listeners.get(type) || []) listener(event)
        }

        close() {
          this.closed = true
        }
      }
      vi.stubGlobal('EventSource', FakeEventSource)
      try {
        const onMessageReceived = vi.fn()
        const onReconnect = vi.fn()
        const subscription = api.subscribeMailboxEvents({
          onMessageReceived,
          onReconnect,
        })
        const source = FakeEventSource.instances[0]!

        expect(source.url).toBe('/api/mailbox/events')
        expect(source.options).toEqual({ withCredentials: true })

        source.emit('error', new Event('error'))
        source.emit('open', new Event('open'))
        expect(onReconnect).toHaveBeenCalledOnce()
        source.emit(
          'mailbox.message_received',
          new MessageEvent('mailbox.message_received', {
            data: JSON.stringify({
              type: 'mailbox.message_received',
              mailboxId: 'mailbox-1',
              messageId: 'message-1',
              receivedAt: '2026-09-03T09:00:00.000Z',
            }),
          })
        )
        expect(onMessageReceived).toHaveBeenCalledWith({
          type: 'mailbox.message_received',
          mailboxId: 'mailbox-1',
          messageId: 'message-1',
          receivedAt: '2026-09-03T09:00:00.000Z',
        })

        source.emit('open', new Event('open'))
        expect(onReconnect).toHaveBeenCalledTimes(2)

        subscription.close()
        expect(source.closed).toBe(true)
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('request methods', () => {
    beforeEach(() => {
      vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ data: 'test' }))
    })

    it('should make GET request', async () => {
      await api.get('/test')

      expect(fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should make POST request with body', async () => {
      const body = { email: 'test@example.com' }
      await api.post('/test', body)

      expect(fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(body),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('should make PUT request with body', async () => {
      const body = { name: 'Test' }
      await api.put('/test', body)

      expect(fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(body),
        })
      )
    })

    it('should make DELETE request', async () => {
      await api.delete('/test')

      expect(fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })

  describe('username availability', () => {
    it('should check Core username availability through the local API', async () => {
      vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ available: true }))

      await expect(getUsernameAvailability('testuser')).resolves.toBe(true)

      expect(fetch).toHaveBeenCalledWith(
        '/api/usernames/testuser/available',
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
        })
      )
    })

    it('should encode usernames in the availability URL', async () => {
      vi.mocked(fetch).mockResolvedValue(mockJsonResponse({ available: false }))

      await expect(getUsernameAvailability('test user')).resolves.toBe(false)

      expect(fetch).toHaveBeenCalledWith(
        '/api/usernames/test%20user/available',
        expect.any(Object)
      )
    })
  })

  describe('content type handling', () => {
    it('should set Content-Type to application/json for JSON bodies', async () => {
      vi.mocked(fetch).mockResolvedValue(mockJsonResponse({}))

      await api.post('/test', { data: 'test' })

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const headers = callArgs[1]?.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('should not set Content-Type for FormData', async () => {
      const formData = new FormData()
      formData.append('file', new Blob(['test']))

      vi.mocked(fetch).mockResolvedValue(mockJsonResponse({}))

      await api.upload('/upload', formData)

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const headers = (callArgs[1]?.headers || {}) as Record<string, string>
      expect(headers).not.toHaveProperty('Content-Type')
    })
  })

  describe('upload error handling', () => {
    it('should throw ApiError for failed uploads', async () => {
      const formData = new FormData()
      vi.mocked(fetch).mockResolvedValue(
        mockJsonResponse({ error: 'File too large' }, { ok: false, status: 413 })
      )

      await expect(api.upload('/upload', formData)).rejects.toThrow(ApiError)
      await expect(api.upload('/upload', formData)).rejects.toThrow('File too large')
    })
  })
})
