import config from "./services.json";

export interface MonitoredService {
  id: string;
  name: string;
  engine?: string;
  url: string;
  health?: string;
  group: "product" | "platform";
}

/** Services the status page checks. Instances of client organizations are added in Phase 3 and later. */
export function monitoredServices(): MonitoredService[] {
  return [
    ...config.products.map((s) => ({ ...s, group: "product" as const })),
    ...config.platform.map((s) => ({ ...s, group: "platform" as const })),
  ];
}
