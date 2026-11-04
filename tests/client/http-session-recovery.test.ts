import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { ServerResponse } from 'node:http'
import { Client } from 'fastmcp-ts/client'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

/** Real HTTP protocol fixture; dispatch counts distinguish reconnecting from replaying a tool. */
async function fixture() {
  let session = ''
  let initializes = 0
  let executions = 0
  let failure = 0
  let toolError = false
  let initializationFailure = 0
  let streaming = false
  const failedStreamGets = new Map<string, number>()
  const streams = new Set<ServerResponse>()
  let holdInit: ReturnType<typeof deferred> | undefined
  let holdTool: ReturnType<typeof deferred> | undefined
  const initStarted = deferred()
  const toolStarted = deferred()
  const streamOpened = deferred()
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
      if (initializes > 1 && holdInit) { initStarted.resolve(); await holdInit.promise }
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
    if (message.method === 'resources/subscribe') subscriptions.push(message.params.uri)
    reply(res, 200, { jsonrpc: '2.0', id: message.id,
      result: message.method === 'tools/list' ? { tools: [] } : {} })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => {
    holdInit?.resolve(); holdTool?.resolve(); server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address() as { port: number }
  const client = await Client.connect(`http://127.0.0.1:${address.port}/mcp`, { versionNegotiation: { mode: 'legacy' } })
  cleanups.push(() => client.close())
  return { client, subscriptions, initStarted, toolStarted, streamOpened,
    counts: () => ({ initializes, executions }),
    expire: () => { session = 'retired'; for (const stream of streams) stream.end() },
    stream: () => { streaming = true },
    streamFailures: (id: string) => failedStreamGets.get(id) ?? 0,
    failInitialization: (status: number) => { initializationFailure = status },
    fail: (status: number) => { failure = status },
    toolError: () => { toolError = true },
    holdInit: () => (holdInit = deferred()),
    holdTool: () => (holdTool = deferred()),
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
})
