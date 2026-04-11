import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express, { Request, Response } from 'express';

import { ResponseFormat } from './constants.js';
import * as schemas from './schemas/portainer-schemas.js';
import * as portainer from './services/portainer-api.js';

const server = new McpServer({
  name: 'portainer-mcp-server',
  version: '1.0.0'
});

// === SYSTEM TOOLS ===
server.tool(
  'portainer_status',
  'Get Portainer server status and version',
  {},
  async () => {
    const status = await portainer.getStatus();
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }
);

// === ENDPOINT TOOLS ===
server.tool(
  'portainer_list_endpoints',
  'List all Portainer endpoints (Docker environments)',
  {},
  async () => {
    const endpoints = await portainer.listEndpoints();
    const summary = endpoints.map(e => ({
      id: e.Id,
      name: e.Name,
      type: e.Type,
      url: e.URL,
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
  }
);

server.tool(
  'portainer_get_docker_info',
  'Get Docker engine information for an endpoint',
  schemas.EndpointIdSchema.shape,
  async (args) => {
    const params = schemas.EndpointIdSchema.parse(args);
    const info = await portainer.getDockerInfo(params.endpointId);
    return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
  }
);

// === CONTAINER TOOLS ===
server.tool(
  'portainer_list_containers',
  'List Docker containers',
  schemas.ListContainersSchema.shape,
  async (args) => {
    const params = schemas.ListContainersSchema.parse(args);
    const containers = await portainer.listContainers(params.endpointId, params.all);
    
    if (params.format === ResponseFormat.SUMMARY) {
      const summary = containers.map(c => ({
        id: c.Id.substring(0, 12),
        name: c.Names[0]?.replace(/^\//, ''),
        image: c.Image,
        state: c.State,
        status: c.Status,
        ports: c.Ports.filter(p => p.PublicPort).map(p => `${p.PublicPort}:${p.PrivatePort}`)
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
    
    return { content: [{ type: 'text', text: JSON.stringify(containers, null, 2) }] };
  }
);

server.tool(
  'portainer_get_container',
  'Get detailed information about a specific container',
  schemas.GetContainerSchema.shape,
  async (args) => {
    const params = schemas.GetContainerSchema.parse(args);
    const container = await portainer.getContainer(params.endpointId, params.containerId);
    return { content: [{ type: 'text', text: JSON.stringify(container, null, 2) }] };
  }
);

server.tool(
  'portainer_container_action',
  'Perform action on a container (start, stop, restart, pause, unpause, kill)',
  schemas.ContainerActionSchema.shape,
  async (args) => {
    const params = schemas.ContainerActionSchema.parse(args);
    await portainer.containerAction(params.endpointId, params.containerId, params.action);
    return { content: [{ type: 'text', text: `Container ${params.containerId} ${params.action} executed successfully` }] };
  }
);

server.tool(
  'portainer_container_logs',
  'Get container logs',
  schemas.ContainerLogsSchema.shape,
  async (args) => {
    const params = schemas.ContainerLogsSchema.parse(args);
    const logs = await portainer.getContainerLogs(
      params.endpointId,
      params.containerId,
      params.tail,
      params.timestamps
    );
    return { content: [{ type: 'text', text: logs }] };
  }
);

// === STACK TOOLS ===
server.tool(
  'portainer_list_stacks',
  'List all stacks',
  schemas.ListStacksSchema.shape,
  async (args) => {
    const params = schemas.ListStacksSchema.parse(args);
    const stacks = await portainer.listStacks();
    
    const filtered = stacks.filter(s => !params.endpointId || s.EndpointId === params.endpointId);
    
    if (params.format === ResponseFormat.SUMMARY) {
      const summary = filtered.map(s => ({
        id: s.Id,
        name: s.Name,
        type: s.Type === 2 ? 'compose' : s.Type === 1 ? 'swarm' : 'kubernetes',
        endpointId: s.EndpointId,
        status: s.Status === 1 ? 'active' : 'inactive',
        created: new Date(s.CreationDate * 1000).toISOString(),
        updated: new Date(s.UpdateDate * 1000).toISOString()
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
    
    return { content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }] };
  }
);

server.tool(
  'portainer_get_stack_file',
  'Get the docker-compose.yml content of a stack',
  schemas.GetStackFileSchema.shape,
  async (args) => {
    const params = schemas.GetStackFileSchema.parse(args);
    const result = await portainer.getStackFile(params.stackId);
    return { content: [{ type: 'text', text: result.StackFileContent }] };
  }
);

server.tool(
  'portainer_create_stack',
  'Create a new stack from docker-compose content',
  schemas.CreateStackSchema.shape,
  async (args) => {
    const params = schemas.CreateStackSchema.parse(args);
    const stack = await portainer.createStack(
      params.endpointId,
      params.name,
      params.stackFileContent,
      params.env
    );
    return { content: [{ type: 'text', text: `Stack '${stack.Name}' created with ID ${stack.Id}` }] };
  }
);

server.tool(
  'portainer_update_stack',
  'Update an existing stack',
  schemas.UpdateStackSchema.shape,
  async (args) => {
    const params = schemas.UpdateStackSchema.parse(args);
    const stack = await portainer.updateStack(
      params.stackId,
      params.endpointId,
      params.stackFileContent,
      params.env,
      params.prune
    );
    return { content: [{ type: 'text', text: `Stack '${stack.Name}' updated successfully` }] };
  }
);

server.tool(
  'portainer_delete_stack',
  'Delete a stack',
  schemas.DeleteStackSchema.shape,
  async (args) => {
    const params = schemas.DeleteStackSchema.parse(args);
    await portainer.deleteStack(params.stackId, params.endpointId);
    return { content: [{ type: 'text', text: `Stack ${params.stackId} deleted successfully` }] };
  }
);

server.tool(
  'portainer_stack_action',
  'Start or stop a stack',
  schemas.StackActionSchema.shape,
  async (args) => {
    const params = schemas.StackActionSchema.parse(args);
    await portainer.stackAction(params.stackId, params.endpointId, params.action);
    return { content: [{ type: 'text', text: `Stack ${params.stackId} ${params.action} executed successfully` }] };
  }
);

// === VOLUME TOOLS ===
server.tool(
  'portainer_list_volumes',
  'List Docker volumes',
  schemas.ListVolumesSchema.shape,
  async (args) => {
    const params = schemas.ListVolumesSchema.parse(args);
    const result = await portainer.listVolumes(params.endpointId);
    
    if (params.format === ResponseFormat.SUMMARY) {
      const summary = result.Volumes.map(v => ({
        name: v.Name,
        driver: v.Driver,
        scope: v.Scope,
        created: v.CreatedAt,
        size: v.UsageData?.Size,
        refCount: v.UsageData?.RefCount
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
    
    return { content: [{ type: 'text', text: JSON.stringify(result.Volumes, null, 2) }] };
  }
);

// === NETWORK TOOLS ===
server.tool(
  'portainer_list_networks',
  'List Docker networks',
  schemas.ListNetworksSchema.shape,
  async (args) => {
    const params = schemas.ListNetworksSchema.parse(args);
    const networks = await portainer.listNetworks(params.endpointId);
    
    if (params.format === ResponseFormat.SUMMARY) {
      const summary = networks.map(n => ({
        id: n.Id.substring(0, 12),
        name: n.Name,
        driver: n.Driver,
        scope: n.Scope,
        internal: n.Internal,
        attachable: n.Attachable,
        containers: Object.keys(n.Containers || {}).length,
        subnet: n.IPAM.Config?.[0]?.Subnet
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
    
    return { content: [{ type: 'text', text: JSON.stringify(networks, null, 2) }] };
  }
);

// === IMAGE TOOLS ===
server.tool(
  'portainer_list_images',
  'List Docker images',
  schemas.ListImagesSchema.shape,
  async (args) => {
    const params = schemas.ListImagesSchema.parse(args);
    const images = await portainer.listImages(params.endpointId);
    
    if (params.format === ResponseFormat.SUMMARY) {
      const summary = images.map(i => ({
        id: i.Id.substring(7, 19),
        tags: i.RepoTags || ['<none>'],
        size: `${(i.Size / 1024 / 1024).toFixed(1)} MB`,
        created: new Date(i.Created * 1000).toISOString(),
        containers: i.Containers
      }));
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
    
    return { content: [{ type: 'text', text: JSON.stringify(images, null, 2) }] };
  }
);

// === SERVER STARTUP ===
async function main() {
  const transport = process.env.TRANSPORT || 'http';
  
  if (transport === 'stdio') {
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    console.error('Portainer MCP Server running on stdio');
  } else {
    const app = express();
    const PORT = parseInt(process.env.PORT || '3000');
    
    const transports = new Map<string, SSEServerTransport>();
    
    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', server: 'portainer-mcp-server', version: '1.0.0' });
    });
    
    app.get('/sse', (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string || crypto.randomUUID();
      const transport = new SSEServerTransport('/mcp', res);
      transports.set(sessionId, transport);
      
      res.on('close', () => {
        transports.delete(sessionId);
      });
      
      server.connect(transport);
    });
    
    app.post('/mcp', express.json(), async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);
      
      if (!transport) {
        res.status(400).json({ error: 'No active SSE connection' });
        return;
      }
      
      await transport.handlePostMessage(req, res, req.body);
    });
    
    app.listen(PORT, () => {
      console.log(`Portainer MCP Server running on http://localhost:${PORT}`);
      console.log(`Health: http://localhost:${PORT}/health`);
      console.log(`SSE: http://localhost:${PORT}/sse`);
      console.log(`MCP: POST http://localhost:${PORT}/mcp`);
    });
  }
}

main().catch(console.error);
