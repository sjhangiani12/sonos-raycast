import { Cache, getPreferenceValues } from "@raycast/api";
import { getSystem, modelOf, primaryGroup, type System } from "./sonos";

// A separate namespace: writes here must not wake the cache that the Raycast hooks watch.
const cache = new Cache({ namespace: "sonos" });

/** The coordinator of the music group that played last. Commands fall back to it when nothing plays. */
export const lastCoordinator = () => cache.get("last");

export const volumeStep = () => Math.max(1, Number(getPreferenceValues<{ step?: string }>().step) || 3);

/** Reads the live state. It starts from the speaker addresses of the last run, so it is fast. */
export async function load(): Promise<System> {
  const seeds: string[] = JSON.parse(cache.get("ips") ?? "[]");
  const system = await getSystem(seeds);
  cache.set("ips", JSON.stringify(system.rooms.map((room) => room.ip)));
  const primary = primaryGroup(system, lastCoordinator());
  if (primary?.playing && !primary.tv) cache.set("last", primary.coordinator);
  return system;
}

/** The model of each speaker by UUID, for example "Beam". A model never changes, so it stays in the cache. */
export async function loadModels(system: System): Promise<Record<string, string>> {
  const models: Record<string, string> = JSON.parse(cache.get("models") ?? "{}");
  await Promise.all(
    system.rooms
      .filter((room) => !models[room.uuid])
      .map(async (room) => {
        const model = await modelOf(room.ip).catch(() => undefined);
        if (model) models[room.uuid] = model;
      }),
  );
  cache.set("models", JSON.stringify(models));
  return models;
}
