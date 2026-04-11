import {
  PortainerEndpoint,
  DockerContainer,
  ContainerDetails,
  PortainerStack,
  DockerVolume,
  DockerNetwork,
  DockerImage,
  DockerInfo,
  PortainerStatus,
  StackEnvVar
} from '../types.js';

const PORTAINER_URL = process.env.PORTAINER_URL || 'https://portainer.atomicabr.com.br';
const PORTAINER_API_KEY = process.env.PORTAINER_API_KEY;
const PORTAINER_USERNAME = process.env.PORTAINER_USERNAME;
const PORTAINER_PASSWORD = process.env.PORTAINER_PASSWORD;

let jwtToken: string | null = null;
let tokenExpiry: number = 0;

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (PORTAINER_API_KEY) {
    return { 'X-API-Key': PORTAINER_API_KEY };
  }

  if (jwtToken && Date.now() < tokenExpiry) {
    return { 'Authorization': `Bearer ${jwtToken}` };
  }

  if (!PORTAINER_USERNAME || !PORTAINER_PASSWORD) {
    throw new Error('No authentication configured. Set PORTAINER_API_KEY or PORTAINER_USERNAME/PASSWORD');
  }

  const response = await fetch(`${PORTAINER_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: PORTAINER_USERNAME,
      password: PORTAINER_PASSWORD
    })
  });

  if (!response.ok) {
    throw new Error(`Authentication failed: ${response.status}`);
  }

  const data = await response.json() as { jwt: string };
  jwtToken = data.jwt;
  tokenExpiry = Date.now() + (7.5 * 60 * 60 * 1000);

  return { 'Authorization': `Bearer ${jwtToken}` };
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const authHeaders = await getAuthHeaders();
  
  const response = await fetch(`${PORTAINER_URL}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options.headers
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Portainer API error ${response.status}: ${errorText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  
  return response.text() as unknown as T;
}

// === SYSTEM ===
export async function getStatus(): Promise<PortainerStatus> {
  return apiRequest<PortainerStatus>('/status');
}

// === ENDPOINTS ===
export async function listEndpoints(): Promise<PortainerEndpoint[]> {
  return apiRequest<PortainerEndpoint[]>('/endpoints');
}

export async function getDockerInfo(endpointId: number): Promise<DockerInfo> {
  return apiRequest<DockerInfo>(`/endpoints/${endpointId}/docker/info`);
}

// === CONTAINERS ===
export async function listContainers(endpointId: number, all: boolean = true): Promise<DockerContainer[]> {
  return apiRequest<DockerContainer[]>(`/endpoints/${endpointId}/docker/containers/json?all=${all}`);
}

export async function getContainer(endpointId: number, containerId: string): Promise<ContainerDetails> {
  return apiRequest<ContainerDetails>(`/endpoints/${endpointId}/docker/containers/${containerId}/json`);
}

export async function containerAction(endpointId: number, containerId: string, action: string): Promise<void> {
  await apiRequest(`/endpoints/${endpointId}/docker/containers/${containerId}/${action}`, {
    method: 'POST'
  });
}

export async function getContainerLogs(
  endpointId: number,
  containerId: string,
  tail: number = 100,
  timestamps: boolean = false
): Promise<string> {
  return apiRequest<string>(
    `/endpoints/${endpointId}/docker/containers/${containerId}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=${timestamps}`
  );
}

// === STACKS ===
export async function listStacks(): Promise<PortainerStack[]> {
  return apiRequest<PortainerStack[]>('/stacks');
}

export async function getStackFile(stackId: number): Promise<{ StackFileContent: string }> {
  return apiRequest<{ StackFileContent: string }>(`/stacks/${stackId}/file`);
}

export async function createStack(
  endpointId: number,
  name: string,
  stackFileContent: string,
  env?: StackEnvVar[]
): Promise<PortainerStack> {
  return apiRequest<PortainerStack>(`/stacks/create/standalone/string?endpointId=${endpointId}`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      stackFileContent,
      env: env || []
    })
  });
}

export async function updateStack(
  stackId: number,
  endpointId: number,
  stackFileContent: string,
  env?: StackEnvVar[],
  prune: boolean = false
): Promise<PortainerStack> {
  return apiRequest<PortainerStack>(`/stacks/${stackId}?endpointId=${endpointId}`, {
    method: 'PUT',
    body: JSON.stringify({
      stackFileContent,
      env: env || [],
      prune
    })
  });
}

export async function deleteStack(stackId: number, endpointId: number): Promise<void> {
  await apiRequest(`/stacks/${stackId}?endpointId=${endpointId}`, {
    method: 'DELETE'
  });
}

export async function stackAction(stackId: number, endpointId: number, action: 'start' | 'stop'): Promise<void> {
  await apiRequest(`/stacks/${stackId}/${action}?endpointId=${endpointId}`, {
    method: 'POST'
  });
}

// === VOLUMES ===
export async function listVolumes(endpointId: number): Promise<{ Volumes: DockerVolume[] }> {
  return apiRequest<{ Volumes: DockerVolume[] }>(`/endpoints/${endpointId}/docker/volumes`);
}

// === NETWORKS ===
export async function listNetworks(endpointId: number): Promise<DockerNetwork[]> {
  return apiRequest<DockerNetwork[]>(`/endpoints/${endpointId}/docker/networks`);
}

// === IMAGES ===
export async function listImages(endpointId: number): Promise<DockerImage[]> {
  return apiRequest<DockerImage[]>(`/endpoints/${endpointId}/docker/images/json`);
}
