export interface DockerServiceStatus {
  service: string;
  /** One of "running", "partial", "not created", or a docker-reported container state. */
  state: string;
  /** "healthy" / "unhealthy" / "starting", or null if no container defines a healthcheck. */
  health: string | null;
}
