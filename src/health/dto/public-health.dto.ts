export type ComponentStatus = 'operational' | 'degraded' | 'down';

export type ComponentId = 'api' | 'database' | 'realtime' | 'stt' | 'tts';

export interface PublicHealthComponent {
  id: ComponentId;
  status: ComponentStatus;
  lastCheckedAt: string;
}

export interface PublicHealthResponse {
  status: ComponentStatus;
  components: PublicHealthComponent[];
  generatedAt: string;
}
