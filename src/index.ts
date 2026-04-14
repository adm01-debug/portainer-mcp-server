import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

import { ResponseFormat } from './constants.js';
import * as schemas from './schemas/portainer-schemas.js';
import * as portainer from './services/portainer-api.js';

const VERSION = '1.3.0';
const START_TIME = Date.now();

// === METRICS ===
const metrics = {
  requestsTotal: 0,
  requestsByStatus: new Map<number, number>(),
  toolCallsTotal: 0,
  toolCallsByName: new Map<string, number>(),
  sessionsCreatedTotal: 0,
  sessionsExpiredTotal: 0,
  rateLimitedTotal: 0,
  portainerErrorsTotal: 0,
};

function incStatus(code: number): void {
  metrics.requestsByStatus.set(code, (metrics.requestsByStatus.get(code) || 0) + 1);
}

function incTool(name: string): void {
  metrics.toolCallsTotal++;
  metrics.toolCallsByName.set(name, (metrics.toolCallsByName.get(name) || 0) + 1);
}

// === TOOL REGISTRATION ===
function registerTools(server: McpServer): void {
  server.tool('portainer_status', 'Get Portainer server status and version', {}, async () => {
    incTool('portainer_status');
    const status = await portainer.getStatus();
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  });

  server.tool('portainer_list_endpoints', 'List all Portainer endpoints (Docker environments)', {}, async () => {
    incTool('portainer_list_endpoints');
    const endpoints = await portainer.listEndpoints();
    const summary = endpoints.map(e => ({
      id: e.Id, name: e.Name, type: e.Type, url: e.URL,
      status: e.Status === 1 ? 'up' : 'down',
      snapshot: e.Snapshots?.[0] ? {
        containers: e.Snapshots[0].RunningContainerCount + e.Snapshots[0].StoppedContainerCount,
        running: e.Snapshots[0].RunningContainerCount,
        stacks: e.Snapshots[0].StackCount,
        volumes: e.Snapshots[0].VolumeCount,
        images: e.Snapshots[0].ImageCount
      } : null
    }));
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  });

  server.tool('portainer_get_docker_info', 'Get Docker engine information for an endpoint', schemas.EndpointIdSchema.shape, async (args) => {
    incTool('portainer_get_docker_info');
    const p = schemas.EndpointIdSchema.parse(args);
    const info = await portainer.getDockerInfo(p.endpointId);
    return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
  });

  server.tool('portainer_list_containers', 'List Docker containers', schemas.ListContainersSchema.shape, async (args) => {
    incTool('portainer_list_containers');
    const p = schemas.ListContainersSchema.parse(args);
    const containers = await portainer.listContainers(p.endpointId, p.all);
    if (p.format === ResponseFormat.SUMMARY) {
      const summary = containers.map(c => ({
        id: c.Id.substring(0, 12),
        name: c.Names[0]?.replace(/^\//, ''),
        image: c.Image, state: c.State, status: c.Status,
        ports: c.Ports.filter(x => x.PublicPort).map(x => `${x.PublicPort}:${x.PrivatePort}`)
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(containers, null, 2) }] };
  });

  server.tool('portainer_get_container', 'Get detailed information about a specific container', schemas.GetContainerSchema.shape, async (args) => {
    incTool('portainer_get_container');
    const p = schemas.GetContainerSchema.parse(args);
    const c = await portainer.getContainer(p.endpointId, p.containerId);
    return { content: [{ type: 'text', text: JSON.stringify(c, null, 2) }] };
  });

  server.tool('portainer_container_action', 'Perform action on a container (start, stop, restart, pause, unpause, kill)', schemas.ContainerActionSchema.shape, async (args) => {
    incTool('portainer_container_action');
    const p = schemas.ContainerActionSchema.parse(args);
    await portainer.containerAction(p.endpointId, p.containerId, p.action);
    return { content: [{ type: 'text', text: `Container ${p.containerId} ${p.action} executed successfully` }] };
  });

  server.tool('portainer_container_logs', 'Get container logs', schemas.ContainerLogsSchema.shape, async (args) => {
    incTool('portainer_container_logs');
    const p = schemas.ContainerLogsSchema.parse(args);
    const logs = await portainer.getContainerLogs(p.endpointId, p.containerId, p.tail, p.timestamps);
    return { content: [{ type: 'text', text: logs }] };
  });

  server.tool('portainer_list_stacks', 'List all stacks', schemas.ListStacksSchema.shape, async (args) => {
    incTool('portainer_list_stacks');
    const p = schemas.ListStacksSchema.parse(args);
    const stacks = await portainer.listStacks();
    const filtered = stacks.filter(s => !p.endpointId || s.EndpointId === p.endpointId);
    if (p.format === ResponseFormat.SUMMARY) {
      const summary = filtered.map(s => ({
        id: s.Id, name: s.Name,
        type: s.Type === 2 ? 'compose' : s.Type === 1 ? 'swarm' : 'kubernetes',
        endpointId: s.EndpointId,
        status: s.Status === 1 ? 'active' : 'inactive',
        created: new Date(s.CreationDate * 1000).toISOString(),
        updated: new Date(s.UpdateDate * 1000).toISOString()
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }] };
  });

  server.tool('portainer_get_stack_file', 'Get the docker-compose.yml content of a stack', schemas.GetStackFileSchema.shape, async (args) => {
    incTool('portainer_get_stack_file');
    const p = schemas.GetStackFileSchema.parse(args);
    const r = await portainer.getStackFile(p.stackId);
    return { content: [{ type: 'text', text: r.StackFileContent }] };
  });

  server.tool('portainer_create_stack', 'Create a new stack from docker-compose content', schemas.CreateStackSchema.shape, async (args) => {
    incTool('portainer_create_stack');
    const p = schemas.CreateStackSchema.parse(args);
    const s = await portainer.createStack(p.endpointId, p.name, p.stackFileContent, p.env);
    return { content: [{ type: 'text', text: `Stack '${s.Name}' created with ID ${s.Id}` }] };
  });

  server.tool('portainer_update_stack', 'Update an existing stack', schemas.UpdateStackSchema.shape, async (args) => {
    incTool('portainer_update_stack');
    const p = schemas.UpdateStackSchema.parse(args);
    const s = await portainer.updateStack(p.stackId, p.endpointId, p.stackFileContent, p.env, p.prune);
    return { content: [{ type: 'text', text: `Stack '${s.Name}' updated successfully` }] };
  });

  server.tool('portainer_delete_stack', 'Delete a stack', schemas.DeleteStackSchema.shape, async (args) => {
    incTool('portainer_delete_stack');
    const p = schemas.DeleteStackSchema.parse(args);
    await portainer.deleteStack(p.stackId, p.endpointId);
    return { content: [{ type: 'text', text: `Stack ${p.stackId} deleted successfully` }] };
  });

  server.tool('portainer_stack_action', 'Start or stop a stack', schemas.StackActionSchema.shape, async (args) => {
    incTool('portainer_stack_action');
    const p = schemas.StackActionSchema.parse(args);
    await portainer.stackAction(p.stackId, p.endpointId, p.action);
    return { content: [{ type: 'text', text: `Stack ${p.stackId} ${p.action} executed successfully` }] };
  });

  server.tool('portainer_list_volumes', 'List Docker volumes', schemas.ListVolumesSchema.shape, async (args) => {
    incTool('portainer_list_volumes');
    const p = schemas.ListVolumesSchema.parse(args);
    const r = await portainer.listVolumes(p.endpointId);
    if (p.format === ResponseFormat.SUMMARY) {
      const summary = r.Volumes.map(v => ({
        name: v.Name, driver: v.Driver, scope: v.Scope,
        created: v.CreatedAt, size: v.UsageData?.Size, refCount: v.UsageData?.RefCount
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(r.Volumes, null, 2) }] };
  });

  server.tool('portainer_list_networks', 'List Docker networks', schemas.ListNetworksSchema.shape, async (args) => {
    incTool('portainer_list_networks');
    const p = schemas.ListNetworksSchema.parse(args);
    const nets = await portainer.listNetworks(p.endpointId);
    if (p.format === ResponseFormat.SUMMARY) {
      const summary = nets.map(n => ({
        id: n.Id.substring(0, 12), name: n.Name, driver: n.Driver, scope: n.Scope,
        internal: n.Internal, attachable: n.Attachable,
        containers: Object.keys(n.Containers || {}).length,
        subnet: n.IPAM.Config?.[0]?.Subnet
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(nets, null, 2) }] };
  });

  server.tool('portainer_list_images', 'List Docker images', schemas.ListImagesSchema.shape, async (args) => {
    incTool('portainer_list_images');
    const p = schemas.ListImagesSchema.parse(args);
    const imgs = await portainer.listImages(p.endpointId);
    if (p.format === ResponseFormat.SUMMARY) {
      const summary = imgs.map(i => ({
        id: i.Id.substring(7, 19),
        tags: i.RepoTags || ['<none>'],
        size: `${(i.Size / 1024 / 1024).toFixed(1)} MB`,
        created: new Date(i.Created * 1000).toISOString(),
        containers: i.Containers
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(imgs, null, 2) }] };
  });
}

// === SESSION MANAGEMENT ===
interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastAccess: number;
  createdAt: number;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes (reduced from 30)
const SESSION_CLEANUP_INTERVAL_MS = 2 * 60 * 1000; // every 2 min

function cleanupSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL_MS) {
      session.transport.close().catch(() => {});
      sessions.delete(id);
      metrics.sessionsExpiredTotal++;
      console.log(`[session] expired and removed: ${id}`);
    }
  }
}

setInterval(cleanupSessions, SESSION_CLEANUP_INTERVAL_MS);

// === RATE LIMITING (token bucket per-IP, sliding window) ===
interface RateBucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, RateBucket>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 120; // 120 requests/min per IP

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_MAX - bucket.count)));
  res.setHeader('X-RateLimit-Reset', String(Math.floor(bucket.resetAt / 1000)));
  if (bucket.count > RATE_LIMIT_MAX) {
    metrics.rateLimitedTotal++;
    incStatus(429);
    res.status(429).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: `Rate limit exceeded: ${RATE_LIMIT_MAX} req/min` },
      id: null
    });
    return;
  }
  next();
}

// Periodic rate bucket cleanup
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of rateBuckets) {
    if (now > b.resetAt + RATE_LIMIT_WINDOW_MS) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);

// === CORS MIDDLEWARE ===
function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, mcp-session-id, Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

// === REQUEST COUNTING ===
function countRequests(req: Request, res: Response, next: NextFunction): void {
  metrics.requestsTotal++;
  res.on('finish', () => incStatus(res.statusCode));
  next();
}

// === PORTAINER PROBE ===
async function probePortainer(): Promise<{ ok: boolean; latencyMs: number; version?: string; error?: string }> {
  const started = Date.now();
  try {
    const status = await portainer.getStatus();
    return { ok: true, latencyMs: Date.now() - started, version: (status as any).Version };
  } catch (err: any) {
    metrics.portainerErrorsTotal++;
    return { ok: false, latencyMs: Date.now() - started, error: err?.message || String(err) };
  }
}

// === STARTUP ===
async function main() {
  const transport = process.env.TRANSPORT || 'http';

  if (transport === 'stdio') {
    const server = new McpServer({ name: 'portainer-mcp-server', version: VERSION });
    registerTools(server);
    await server.connect(new StdioServerTransport());
    console.error(`Portainer MCP Server v${VERSION} running on stdio`);
    return;
  }

  const app = express();
  app.use(cors);
  app.use(countRequests);
  app.use(express.json({ limit: '5mb' }));

  const PORT = parseInt(process.env.PORT || '3000');

  // === /health (liveness) — simples, sempre responde rápido ===
  app.get('/health', (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    res.json({
      status: 'ok',
      server: 'portainer-mcp-server',
      version: VERSION,
      transport: 'streamable-http',
      activeSessions: sessions.size,
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
      memory: {
        rssMB: +(mem.rss / 1024 / 1024).toFixed(1),
        heapUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        heapTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1),
      }
    });
  });

  // === /ready (readiness) — verifica Portainer API ===
  app.get('/ready', async (_req: Request, res: Response) => {
    const probe = await probePortainer();
    const status = probe.ok ? 200 : 503;
    res.status(status).json({
      ready: probe.ok,
      portainer: probe,
      activeSessions: sessions.size,
    });
  });

  // === /metrics (Prometheus text format) ===
  app.get('/metrics', (_req: Request, res: Response) => {
    const lines: string[] = [];
    lines.push(`# HELP mcp_uptime_seconds Server uptime in seconds`);
    lines.push(`# TYPE mcp_uptime_seconds counter`);
    lines.push(`mcp_uptime_seconds ${Math.floor((Date.now() - START_TIME) / 1000)}`);
    lines.push(`# HELP mcp_requests_total Total HTTP requests received`);
    lines.push(`# TYPE mcp_requests_total counter`);
    lines.push(`mcp_requests_total ${metrics.requestsTotal}`);
    lines.push(`# HELP mcp_requests_by_status HTTP requests by status code`);
    lines.push(`# TYPE mcp_requests_by_status counter`);
    for (const [code, n] of metrics.requestsByStatus) {
      lines.push(`mcp_requests_by_status{code="${code}"} ${n}`);
    }
    lines.push(`# HELP mcp_tool_calls_total Total MCP tool invocations`);
    lines.push(`# TYPE mcp_tool_calls_total counter`);
    lines.push(`mcp_tool_calls_total ${metrics.toolCallsTotal}`);
    lines.push(`# HELP mcp_tool_calls_by_name MCP tool invocations by tool name`);
    lines.push(`# TYPE mcp_tool_calls_by_name counter`);
    for (const [name, n] of metrics.toolCallsByName) {
      lines.push(`mcp_tool_calls_by_name{tool="${name}"} ${n}`);
    }
    lines.push(`# HELP mcp_sessions_active Current active sessions`);
    lines.push(`# TYPE mcp_sessions_active gauge`);
    lines.push(`mcp_sessions_active ${sessions.size}`);
    lines.push(`# HELP mcp_sessions_expired_total Total sessions expired by TTL`);
    lines.push(`# TYPE mcp_sessions_expired_total counter`);
    lines.push(`mcp_sessions_expired_total ${metrics.sessionsExpiredTotal}`);
    lines.push(`# HELP mcp_rate_limited_total Total requests rejected by rate limiter`);
    lines.push(`# TYPE mcp_rate_limited_total counter`);
    lines.push(`mcp_rate_limited_total ${metrics.rateLimitedTotal}`);
    lines.push(`# HELP mcp_portainer_errors_total Portainer API errors during probes`);
    lines.push(`# TYPE mcp_portainer_errors_total counter`);
    lines.push(`mcp_portainer_errors_total ${metrics.portainerErrorsTotal}`);
    const mem = process.memoryUsage();
    lines.push(`# HELP mcp_memory_rss_bytes Process RSS memory in bytes`);
    lines.push(`# TYPE mcp_memory_rss_bytes gauge`);
    lines.push(`mcp_memory_rss_bytes ${mem.rss}`);
    lines.push(`mcp_memory_heap_used_bytes ${mem.heapUsed}`);
    res.type('text/plain; version=0.0.4').send(lines.join('\n') + '\n');
  });

  // === MCP routes with rate limiting ===
  const mcpHandler = async (req: Request, res: Response) => {
    try {
      const existingSessionId = req.headers['mcp-session-id'] as string | undefined;

      if (existingSessionId && sessions.has(existingSessionId)) {
        const session = sessions.get(existingSessionId)!;
        session.lastAccess = Date.now();
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      const sessionId = randomUUID();
      const server = new McpServer({ name: 'portainer-mcp-server', version: VERSION });
      registerTools(server);

      const t = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
        onsessioninitialized: (id) => {
          metrics.sessionsCreatedTotal++;
          console.log(`[session] initialized: ${id}`);
        }
      });

      sessions.set(sessionId, { server, transport: t, lastAccess: Date.now(), createdAt: Date.now() });

      await server.connect(t);
      await t.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error' },
          id: null
        });
      }
    }
  };

  app.delete('/mcp', rateLimit, async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.close();
      sessions.delete(sessionId);
      console.log(`[session] terminated by client: ${sessionId}`);
      res.status(200).end();
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  app.post('/mcp', rateLimit, mcpHandler);
  app.get('/mcp', rateLimit, mcpHandler);

  app.listen(PORT, () => {
    console.log(`Portainer MCP Server v${VERSION} on http://localhost:${PORT}`);
    console.log(`  Liveness:   GET  /health`);
    console.log(`  Readiness:  GET  /ready   (probes Portainer API)`);
    console.log(`  Metrics:    GET  /metrics (Prometheus format)`);
    console.log(`  MCP:        POST /mcp     (rate-limited ${RATE_LIMIT_MAX}/min/IP)`);
    console.log(`  Session TTL: ${SESSION_TTL_MS / 1000}s | Cleanup every ${SESSION_CLEANUP_INTERVAL_MS / 1000}s`);
  });
}

main().catch(console.error);
