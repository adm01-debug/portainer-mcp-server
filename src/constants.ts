export enum ResponseFormat {
  FULL = 'full',
  SUMMARY = 'summary'
}

export enum EndpointType {
  DOCKER = 1,
  AGENT = 2,
  AZURE = 3,
  EDGE_AGENT = 4,
  KUBERNETES = 5
}

export enum StackType {
  SWARM = 1,
  COMPOSE = 2,
  KUBERNETES = 3
}

export enum ContainerAction {
  START = 'start',
  STOP = 'stop',
  RESTART = 'restart',
  PAUSE = 'pause',
  UNPAUSE = 'unpause',
  KILL = 'kill'
}

export enum StackAction {
  START = 'start',
  STOP = 'stop'
}

export const DEFAULT_ENDPOINT_ID = 2;
export const DEFAULT_LOG_LINES = 100;
