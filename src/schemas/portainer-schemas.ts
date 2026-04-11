import { z } from 'zod';
import { ContainerAction, StackAction, ResponseFormat } from '../constants.js';

export const EndpointIdSchema = z.object({
  endpointId: z.number().optional().default(2).describe('Portainer endpoint ID (default: 2)')
});

export const ListContainersSchema = z.object({
  endpointId: z.number().optional().default(2).describe('Portainer endpoint ID'),
  all: z.boolean().optional().default(true).describe('Show all containers (including stopped)'),
  format: z.nativeEnum(ResponseFormat).optional().default(ResponseFormat.SUMMARY)
});

export const GetContainerSchema = z.object({
  endpointId: z.number().optional().default(2),
  containerId: z.string().describe('Container ID or name')
});

export const ContainerActionSchema = z.object({
  endpointId: z.number().optional().default(2),
  containerId: z.string().describe('Container ID or name'),
  action: z.nativeEnum(ContainerAction).describe('Action to perform')
});

export const ContainerLogsSchema = z.object({
  endpointId: z.number().optional().default(2),
  containerId: z.string().describe('Container ID or name'),
  tail: z.number().optional().default(100).describe('Number of lines to return'),
  timestamps: z.boolean().optional().default(false)
});

export const ListStacksSchema = z.object({
  endpointId: z.number().optional().default(2),
  format: z.nativeEnum(ResponseFormat).optional().default(ResponseFormat.SUMMARY)
});

export const GetStackFileSchema = z.object({
  stackId: z.number().describe('Stack ID')
});

export const CreateStackSchema = z.object({
  endpointId: z.number().optional().default(2),
  name: z.string().describe('Stack name'),
  stackFileContent: z.string().describe('Docker Compose YAML content'),
  env: z.array(z.object({
    name: z.string(),
    value: z.string()
  })).optional().describe('Environment variables')
});

export const UpdateStackSchema = z.object({
  stackId: z.number().describe('Stack ID'),
  endpointId: z.number().optional().default(2),
  stackFileContent: z.string().describe('Updated Docker Compose YAML'),
  env: z.array(z.object({
    name: z.string(),
    value: z.string()
  })).optional(),
  prune: z.boolean().optional().default(false).describe('Remove services not in compose file')
});

export const DeleteStackSchema = z.object({
  stackId: z.number().describe('Stack ID'),
  endpointId: z.number().optional().default(2)
});

export const StackActionSchema = z.object({
  stackId: z.number().describe('Stack ID'),
  endpointId: z.number().optional().default(2),
  action: z.nativeEnum(StackAction).describe('Action: start or stop')
});

export const ListVolumesSchema = z.object({
  endpointId: z.number().optional().default(2),
  format: z.nativeEnum(ResponseFormat).optional().default(ResponseFormat.SUMMARY)
});

export const ListNetworksSchema = z.object({
  endpointId: z.number().optional().default(2),
  format: z.nativeEnum(ResponseFormat).optional().default(ResponseFormat.SUMMARY)
});

export const ListImagesSchema = z.object({
  endpointId: z.number().optional().default(2),
  format: z.nativeEnum(ResponseFormat).optional().default(ResponseFormat.SUMMARY)
});
