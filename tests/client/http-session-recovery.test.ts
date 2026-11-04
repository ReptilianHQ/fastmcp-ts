import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { Client } from 'fastmcp-ts/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

/** Real HTTP protocol fixture; dispatch counts distinguish reconnecting from replaying a tool. */
async function fixture(connect = true) {
  let session = ''
  let initializes = 0
  let executions = 0
  let failure = 0
  let toolError = false
  let initializationFailure = 0
  let streaming = false
  let logAfterSubscription = false
  const rejectedSubscriptions = new Set<string>()
  let notifyResource: string | undefined
  const failedStreamGets = new Map<string, number>()
  const streams = new Set<ServerResponse>()
  let holdInit: ReturnType<typeof deferred> | undefined
  let holdTool: ReturnType<typeof deferred> | undefined
  let holdSubscription: ReturnType<typeof deferred> | undefined
  const initStarted = deferred()
  const toolStarted = deferred()
  const streamOpened = deferred()
  const subscriptionStarted = deferred()
  const subscriptions: string[] = []
  const reply = (res: ServerResponse, status: number, body: unknown) => {
    if (!res.destroyed) res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  }
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      if (!streaming) { res.writeHead(405).end(); return }
      if (req.headers['mcp-session-id'] !== session) {
        const id = String(req.headers['mcp-session-id'])
        failedStreamGets.set(id, (failedStreamGets.get(id) ?? 0) + 1)
        reply(res, 404, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found' } })
        return
      }
      streams.add(res)
      res.on('close', () => streams.delete(res))
      res.writeHead(200, { 'content-type': 'text/event-stream' }).write(': ready\n\n')
      streamOpened.resolve()
      return
    }
    let bytes = ''
    for await (const chunk of req) bytes += chunk
    const message = bytes ? JSON.parse(bytes) : {}
    if (message.method === 'initialize') {
      initializes++
      if (holdInit) { initStarted.resolve(); await holdInit.promise }
      if (initializationFailure) { reply(res, initializationFailure, {}); return }
      session = `session-${initializes}`
      res.setHeader('mcp-session-id', session)
      reply(res, 200, { jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: { subscribe: true } },
        serverInfo: { name: 'session-fixture', version: '1' },
      } })
      return
    }
    if (req.headers['mcp-session-id'] !== session || failure) {
      reply(res, failure || 404, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found' } })
      return
    }
    if (message.method === 'notifications/initialized') { res.writeHead(202).end(); return }
    if (req.method === 'DELETE') { res.writeHead(200).end(); return }
    if (message.method === 'tools/call') {
      executions++
      const execution = executions
      if (holdTool) { const hold = holdTool; holdTool = undefined; toolStarted.resolve(); await hold.promise }
      reply(res, 200, { jsonrpc: '2.0', id: message.id, result: {
        content: [{ type: 'text', text: String(execution) }], ...(toolError ? { isError: true } : {}),
      } })
      return
    }
    if (message.method === 'resources/subscribe') {
      subscriptions.push(message.params.uri)
      if (rejectedSubscriptions.has(message.params.uri)) {
        reply(res, 200, { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Resource not found' } })
        return
      }
      if (holdSubscription) { subscriptionStarted.resolve(); await holdSubscription.promise }
      if (logAfterSubscription) {
        reply(res, 200, [
          { jsonrpc: '2.0', id: message.id, result: {} },
          { jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'restored' } },
        ])
        return
      }
    }
    if (message.method === 'tools/list' && notifyResource) {
      reply(res, 200, [
        { jsonrpc: '2.0', id: message.id, result: { tools: [] } },
        { jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri: notifyResource } },
      ])
      return
    }
    reply(res, 200, { jsonrpc: '2.0', id: message.id,
      result: message.method === 'tools/list' ? { tools: [] } : {} })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    holdInit?.resolve(); holdTool?.resolve(); holdSubscription?.resolve(); server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address() as { port: number }
  const url = `http://127.0.0.1:${address.port}/mcp`
  const client = new Client(url, { versionNegotiation: { mode: 'legacy' } })
  if (connect) await client.connect()
  cleanups.push(() => client.close())
  return { client, url, subscriptions, initStarted, toolStarted, streamOpened, subscriptionStarted,
    counts: () => ({ initializes, executions }),
    expire: () => { session = 'retired'; for (const stream of streams) stream.end() },
    stream: () => { streaming = true },
    logAfterSubscription: () => { logAfterSubscription = true },
    rejectSubscription: (uri: string) => { rejectedSubscriptions.add(uri) },
    notifyResourceOnList: (uri: string) => { notifyResource = uri },
    streamFailures: (id: string) => failedStreamGets.get(id) ?? 0,
    failInitialization: (status: number) => { initializationFailure = status },
    fail: (status: number) => { failure = status },
    toolError: () => { toolError = true },
    holdInit: () => (holdInit = deferred()),
    holdTool: () => (holdTool = deferred()),
    holdSubscription: () => (holdSubscription = deferred()),
  }
}

describe('expired legacy HTTP sessions', () => {
  it('never replays a rejected tool and reinitializes on the next explicit request', async () => {
    const f = await fixture()
    f.expire()
    await expect(f.client.callTool('change-state')).rejects.toMatchObject({ status: 404 })
    expect(f.counts()).toEqual({ initializes: 1, executions: 0 })
    expect(f.client.isConnected()).toBe(false)
    await expect(f.client.callTool('change-state')).resolves.toMatchObject({ content: [{ type: 'text', text: '1' }] })
    expect(f.counts()).toEqual({ initializes: 2, executions: 1 })
  })

  it('shares one initialization across concurrent new calls and preserves reference ownership', async () => {
    const f = await fixture()
    await f.client.connect()
    f.expire()
    await expect(f.client.listTools()).rejects.toMatchObject({ status: 404 })
    await Promise.all(Array.from({ length: 12 }, () => f.client.callTool('change-state')))
    expect(f.counts()).toEqual({ initializes: 2, executions: 12 })
    await f.client.close()
    expect(f.client.isConnected()).toBe(true)
    await f.client.close()
    expect(f.client.isConnected()).toBe(false)
  })

  it('preserves the result of an already-dispatched request while replacing its session', async () => {
    const f = await fixture()
    const held = f.holdTool()
    const accepted = f.client.callTool('change-state')
    await f.toolStarted.promise
    f.expire()
    await expect(f.client.listTools()).rejects.toMatchObject({ status: 404 })
    await f.client.callTool('change-state')
    held.resolve()
    await expect(accepted).resolves.toMatchObject({ content: [{ type: 'text', text: '1' }] })
    expect(f.counts()).toEqual({ initializes: 2, executions: 2 })
  })

  it('restores registered resource subscriptions without replaying tools', async () => {
    const f = await fixture()
    await f.client.subscribeResource('test://resource', () => {})
    f.expire()
    await expect(f.client.listTools()).rejects.toMatchObject({ status: 404 })
    await f.client.listTools()
    expect(f.subscriptions).toEqual(['test://resource', 'test://resource'])
    expect(f.counts()).toEqual({ initializes: 2, executions: 0 })
  })

  it.each([401, 403, 500])('does not recover or replay HTTP %s failures', async status => {
    const f = await fixture()
    f.fail(status)
    await expect(f.client.callTool('change-state')).rejects.toBeDefined()
    f.fail(0)
    await f.client.listTools()
    expect(f.counts()).toEqual({ initializes: 1, executions: 0 })
  })

  it('does not recover from a tool error result or repeat its execution', async () => {
    const f = await fixture()
    f.toolError()
    await expect(f.client.callTool('change-state')).rejects.toThrow()
    await f.client.listTools()
    expect(f.counts()).toEqual({ initializes: 1, executions: 1 })
  })

  it('aborts a pending replacement when the last owner closes', async () => {
    const f = await fixture()
    f.expire()
    await expect(f.client.listTools()).rejects.toMatchObject({ status: 404 })
    const hold = f.holdInit()
    const request = f.client.callTool('change-state').catch(error => error)
    await f.initStarted.promise
    await f.client.close()
    hold.resolve()
    expect(await request).toBeInstanceOf(Error)
    expect(f.client.isConnected()).toBe(false)
    expect(f.counts().executions).toBe(0)
  })

  it('bounds a failed replacement to one attempt per explicit request', async () => {
    const f = await fixture()
    f.expire()
    await expect(f.client.listTools()).rejects.toMatchObject({ status: 404 })
    f.failInitialization(500)
    await expect(f.client.callTool('change-state')).rejects.toBeDefined()
    expect(f.counts()).toEqual({ initializes: 2, executions: 0 })
    expect(f.client.isConnected()).toBe(false)
    f.failInitialization(0)
    await f.client.callTool('change-state')
    expect(f.counts()).toEqual({ initializes: 3, executions: 1 })
  })

  it('stops polling a retired GET stream before the next explicit operation', async () => {
    const f = await fixture()
    f.stream()
    // Establish a second session whose initialized notification opens the GET.
    f.expire()
    await expect(f.client.listTools()).rejects.toMatchObject({ status: 404 })
    await f.client.listTools()
    await f.streamOpened.promise
    f.expire()
    await expect.poll(() => f.client.isConnected(), { timeout: 4000 }).toBe(false)
    expect(f.streamFailures('session-2')).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 1200))
    expect(f.streamFailures('session-2')).toBe(1)
    await f.client.callTool('change-state')
    expect(f.counts()).toEqual({ initializes: 3, executions: 1 })
  })

  it('does not restore a subscription the server rejected', async () => {
    const f = await fixture()
    f.rejectSubscription('test://missing')
    await expect(f.client.subscribeResource('test://missing', () => {})).rejects.toThrow('Resource not found')
    f.expire()
    await expect(f.client.listTools()).rejects.toMatchObject({ status: 404 })
    await expect(f.client.callTool('change-state')).resolves.toBeDefined()
    expect(f.subscriptions).toEqual(['test://missing'])
    expect(f.counts()).toEqual({ initializes: 2, executions: 1 })
  })

  it('does not retain either handler when concurrent registrations for one resource fail', async () => {
    const f = await fixture()
    f.rejectSubscription('test://missing')
    const results = await Promise.allSettled([
      f.client.subscribeResource('test://missing', () => {}),
      f.client.subscribeResource('test://missing', () => {}),
    ])
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
    f.expire()
    await expect(f.client.listTools()).rejects.toMatchObject({ status: 404 })
    await expect(f.client.callTool('change-state')).resolves.toBeDefined()
    expect(f.subscriptions).toEqual(['test://missing', 'test://missing'])
    expect(f.counts()).toEqual({ initializes: 2, executions: 1 })
  })

  it('keeps the confirmed handler when its replacement is rejected', async () => {
    const f = await fixture()
    let originalUpdates = 0
    let rejectedUpdates = 0
    await f.client.subscribeResource('test://resource', () => { originalUpdates++ })
    f.rejectSubscription('test://resource')
    await expect(f.client.subscribeResource('test://resource', () => { rejectedUpdates++ })).rejects.toThrow('Resource not found')
    f.notifyResourceOnList('test://resource')
    await f.client.listTools()
    expect(originalUpdates).toBe(1)
    expect(rejectedUpdates).toBe(0)
  })

  it('can remove a vanished resource after its restoration fails', async () => {
    const f = await fixture()
    await f.client.subscribeResource('test://removed', () => {})
    await f.client.subscribeResource('test://retained', () => {})
    f.rejectSubscription('test://removed')
    f.expire()
    await expect(f.client.listTools()).rejects.toMatchObject({ status: 404 })
    await expect(f.client.callTool('change-state')).rejects.toThrow('Resource not found')
    expect(f.counts().executions).toBe(0)
    await f.client.unsubscribeResource('test://removed')
    await expect(f.client.callTool('change-state')).resolves.toBeDefined()
    expect(f.subscriptions).toEqual(['test://removed', 'test://retained', 'test://removed', 'test://retained'])
    expect(f.counts()).toEqual({ initializes: 3, executions: 1 })
  })

  it('does not try to replace a caller-owned SDK transport', async () => {
    const f = await fixture(false)
    const transport = new StreamableHTTPClientTransport(new URL(f.url))
    const client = await Client.connect(transport, { versionNegotiation: { mode: 'legacy' } })
    try {
      f.expire()
      await expect(client.listTools()).rejects.toMatchObject({ status: 404 })
      await expect(client.listTools()).rejects.toMatchObject({ status: 404 })
      expect(f.counts()).toEqual({ initializes: 1, executions: 0 })
    } finally { await client.close() }
  })

  it('releases every reference when concurrent initial connections fail', async () => {
    const f = await fixture(false)
    f.failInitialization(500)
    const results = await Promise.allSettled([f.client.connect(), f.client.connect()])
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(f.counts().initializes).toBe(1)
    f.failInitialization(0)
    await f.client.connect()
    await f.client.close()
    expect(f.client.isConnected()).toBe(false)
  })

  it('does not publish a replacement closed by a notification following a subscription response', async () => {
    const f = await fixture(false)
    let closed: Promise<void> | undefined
    const client = await Client.connect(f.url, {
      versionNegotiation: { mode: 'legacy' },
      handlers: { log: () => { closed = client.close() } },
    })
    try {
      await client.subscribeResource('test://resource', () => {})
      f.expire()
      await expect(client.listTools()).rejects.toMatchObject({ status: 404 })
      f.logAfterSubscription()
      await expect(client.callTool('change-state')).rejects.toThrow('Client closed while connecting')
      expect(closed).toBeDefined()
      await closed
      expect(client.isConnected()).toBe(false)
      expect(f.counts().executions).toBe(0)
    } finally { await client.close() }
  })

  it('does not publish a replacement closed during resource subscription restoration', async () => {
    const f = await fixture()
    await f.client.subscribeResource('test://resource', () => {})
    f.expire()
    await expect(f.client.listTools()).rejects.toMatchObject({ status: 404 })
    const hold = f.holdSubscription()
    const request = f.client.callTool('change-state').catch(error => error)
    await f.subscriptionStarted.promise
    await f.client.close()
    hold.resolve()
    expect(await request).toBeInstanceOf(Error)
    expect(f.client.isConnected()).toBe(false)
    expect(f.counts().executions).toBe(0)
  })
})
