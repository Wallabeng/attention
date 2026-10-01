export interface DockerOutputEvent {
  operation_id: string;
  stream: 'stdout' | 'stderr';
  line: string;
}
