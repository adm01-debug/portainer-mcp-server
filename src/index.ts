import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { ResponseFormat } from './constants.js';
import * as schemas from './schemas/portainer-schemas.js';
import * as portainer from './services/portainer-api.js';

// === TOOL REGISTRATION (extracted to reusable function) ===
function registerTools(server: McpServer): void {
  // === SYSTEM ===
  server.tool('portainer_status', 'Get Portainer server status and version', {}, async () => {
    const status = await portainer.getStatus();
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  });

  // === ENDPOINTS ===
  server.tool('portainer_list_endpoints', 'List all Portainer endpoints (Docker environments)', {}, async () => {
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
    const p = schemas.EndpointIdSchema.parse(args);
    const info = await portainer.getDockerInfo(p.endpointId);
    return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
  });

  // === CONTAINERS ===
  server.tool('portainer_list_containers', 'List Docker containers', schemas.ListContainersSchema.shape, async (args) => {
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
    const p = schemas.GetContainerSchema.parse(args);
    const c = await portainer.getContainer(p.endpointId, p.containerId);
    return { content: [{ type: 'text', text: JSON.stringify(c, null, 2) }] };
  });

  server.tool('portainer_container_action', 'Perform action on a container (start, stop, restart, pause, unpause, kill)', schemas.ContainerActionSchema.shape, async (args) => {
    const p = schemas.ContainerActionSchema.parse(args);
    await portainer.containerAction(p.endpointId, p.containerId, p.action);
    return { content: [{ type: 'text', text: `Container ${p.containerId} ${p.action} executed successfully` }] };
  });

  server.tool('portainer_container_logs', 'Get container logs', schemas.ContainerLogsSchema.shape, async (args) => {
    const p = schemas.ContainerLogsSchema.parse(args);
    const logs = await portainer.getContainerLogs(p.endpointId, p.containerId, p.tail, p.timestamps);
    return { content: [{ type: 'text', text: logs }] };
  });

  // === STACKS ===
  server.tool('portainer_list_stacks', 'List all stacks', schemas.ListStacksSchema.shape, async (args) => {
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
    const p = schemas.GetStackFileSchema.parse(args);
    const r = await portainer.getStackFile(p.stackId);
    return { content: [{ type: 'text', text: r.StackFileContent }] };
  });

  server.tool('portainer_create_stack', 'Create a new stack from docker-compose content', schemas.CreateStackSchema.shape, async (args) => {
    const p = schemas.CreateStackSchema.parse(args);
    const s = await portainer.createStack(p.endpointId, p.name, p.stackFileContent, p.env);
    return { content: [{ type: 'text', text: `Stack '${s.Name}' created with ID ${s.Id}` }] };
  });

  server.tool('portainer_update_stack', 'Update an existing stack', schemas.UpdateStackSchema.shape, async (args) => {
    const p = schemas.UpdateStackSchema.parse(args);
    const s = await portainer.updateStack(p.stackId, p.endpointId, p.stackFileContent, p.env, p.prune);
    return { content: [{ type: 'text', text: `Stack '${s.Name}' updated successfully` }] };
  });

  server.tool('portainer_delete_stack', 'Delete a stack', schemas.DeleteStackSchema.shape, async (args) => {
    const p = schemas.DeleteStackSchema.parse(args);
    await portainer.deleteStack(p.stackId, p.endpointId);
    return { content: [{ type: 'text', text: `Stack ${p.stackId} deleted successfully` }] };
  });

  server.tool('portainer_stack_action', 'Start or stop a stack', schemas.StackActionSchema.shape, async (args) => {
    const p = schemas.StackActionSchema.parse(args);
    await portainer.stackAction(p.stackId, p.endpointId, p.action);
    return { content: [{ type: 'text', text: `Stack ${p.stackId} ${p.action} executed successfully` }] };
  });

  // === VOLUMES / NETWORKS / IMAGES ===
  server.tool('portainer_list_volumes', 'List Docker volumes', schemas.ListVolumesSchema.shape, async (args) => {
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
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function cleanupSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL_MS) {
      session.transport.close().catch(() => {});
      sessions.delete(id);
      console.log(`Session ${id} expired and removed`);
    }
  }
}

// Cleanup every 5 minutes
setInterval(cleanupSessions, 5 * 60 * 1000);

// === STARTUP ===
async function main() {
  const transport = process.env.TRANSPORT || 'http';

  if (transport === 'stdio') {
    const server = new McpServer({ name: 'portainer-mcp-server', version: '1.2.0' });
    registerTools(server);
    await server.connect(new StdioServerTransport());
    console.error('Portainer MCP Server running on stdio');
    return;
  }

  const app = express();
  app.use(express.json());
  const PORT = parseInt(process.env.PORT || '3000');

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      server: 'portainer-mcp-server',
      version: '1.2.0',
      transport: 'streamable-http',
      activeSessions: sessions.size
    });
  });

  // Streamable HTTP with proper session management
  const mcpHandler = async (req: Request, res: Response) => {
    try {
      const existingSessionId = req.headers['mcp-session-id'] as string | undefined;

      // If we have a session ID in the request, try to reuse that session
      if (existingSessionId && sessions.has(existingSessionId)) {
        const session = sessions.get(existingSessionId)!;
        session.lastAccess = Date.now();
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      // For new connections (no session ID or unknown session), create new session
      const sessionId = randomUUID();
      const server = new McpServer({ name: 'portainer-mcp-server', version: '1.2.0' });
      registerTools(server);

      const t = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
        onsessioninitialized: (id) => {
          console.log(`New session initialized: ${id}`);
        }
      });

      // Store session before connecting
      sessions.set(sessionId, { server, transport: t, lastAccess: Date.now() });

      // Cleanup on connection close
      res.on('close', () => {
        // Don't delete immediately - keep for future requests with same session ID
        // Will be cleaned up by the interval if inactive
      });

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

  // Handle DELETE for session termination
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.close();
      sessions.delete(sessionId);
      console.log(`Session ${sessionId} terminated by client`);
      res.status(200).end();
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  app.post('/mcp', mcpHandler);
  app.get('/mcp', mcpHandler);

  app.listen(PORT, () => {
    console.log(`Portainer MCP Server v1.2.0 (Streamable HTTP + Sessions) on http://localhost:${PORT}`);
    console.log(`Health:  GET  /health`);
    console.log(`MCP:     POST /mcp`);
  });
}

main().catch(console.error);