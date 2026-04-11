export interface PortainerEndpoint {
  Id: number;
  Name: string;
  Type: number;
  URL: string;
  PublicURL?: string;
  Status: number;
  Snapshots?: EndpointSnapshot[];
}

export interface EndpointSnapshot {
  DockerVersion: string;
  TotalCPU: number;
  TotalMemory: number;
  RunningContainerCount: number;
  StoppedContainerCount: number;
  HealthyContainerCount: number;
  UnhealthyContainerCount: number;
  VolumeCount: number;
  ImageCount: number;
  StackCount: number;
}

export interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  Command: string;
  Created: number;
  State: string;
  Status: string;
  Ports: ContainerPort[];
  Labels: Record<string, string>;
  NetworkSettings?: {
    Networks: Record<string, NetworkInfo>;
  };
}

export interface ContainerPort {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
}

export interface NetworkInfo {
  IPAddress: string;
  Gateway: string;
  MacAddress: string;
}

export interface ContainerDetails extends DockerContainer {
  Config: {
    Env: string[];
    Cmd: string[];
    Image: string;
    WorkingDir: string;
    Entrypoint: string[] | null;
  };
  HostConfig: {
    Memory: number;
    CpuShares: number;
    RestartPolicy: {
      Name: string;
      MaximumRetryCount: number;
    };
    Binds: string[] | null;
  };
  Mounts: Mount[];
}

export interface Mount {
  Type: string;
  Source: string;
  Destination: string;
  Mode: string;
  RW: boolean;
}

export interface PortainerStack {
  Id: number;
  Name: string;
  Type: number;
  EndpointId: number;
  Status: number;
  CreationDate: number;
  UpdateDate: number;
  Env?: StackEnvVar[];
}

export interface StackEnvVar {
  name: string;
  value: string;
}

export interface DockerVolume {
  Name: string;
  Driver: string;
  Mountpoint: string;
  CreatedAt: string;
  Labels: Record<string, string>;
  Scope: string;
  Options: Record<string, string> | null;
  UsageData?: {
    Size: number;
    RefCount: number;
  };
}

export interface DockerNetwork {
  Id: string;
  Name: string;
  Driver: string;
  Scope: string;
  IPAM: {
    Driver: string;
    Config: Array<{
      Subnet?: string;
      Gateway?: string;
    }>;
  };
  Internal: boolean;
  Attachable: boolean;
  Containers: Record<string, {
    Name: string;
    IPv4Address: string;
  }>;
}

export interface DockerImage {
  Id: string;
  RepoTags: string[] | null;
  RepoDigests: string[] | null;
  Created: number;
  Size: number;
  VirtualSize: number;
  Labels: Record<string, string> | null;
  Containers: number;
}

export interface DockerInfo {
  ID: string;
  Name: string;
  ServerVersion: string;
  Containers: number;
  ContainersRunning: number;
  ContainersPaused: number;
  ContainersStopped: number;
  Images: number;
  Driver: string;
  MemTotal: number;
  NCPU: number;
  OperatingSystem: string;
  Architecture: string;
  KernelVersion: string;
}

export interface PortainerStatus {
  Version: string;
  InstanceID: string;
}
