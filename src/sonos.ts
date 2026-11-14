// A small Sonos client. It talks to the speakers on the local network (UPnP on port 1400).
// It needs no Sonos account. This file has no Raycast imports, so a plain Node script can run it.
import dgram from "node:dgram";

export type Room = { uuid: string; name: string; ip: string; volume: number; muted: boolean };
export type Group = {
  coordinator: string;
  coordinatorIp: string;
  rooms: Room[];
  playing: boolean;
  /** True when the source is the TV input of a soundbar. That source reports "playing" all the time. */
  tv: boolean;
  track?: string;
};
export type System = { groups: Group[]; rooms: Room[] };
export type ToggleResult = "added" | "removed" | "paused" | "playing";

const SERVICES = {
  AVTransport: "/MediaRenderer/AVTransport/Control",
  RenderingControl: "/MediaRenderer/RenderingControl/Control",
  ZoneGroupTopology: "/ZoneGroupTopology/Control",
} as const;

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function tag(xml: string, name: string): string | undefined {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return match ? unescapeXml(match[1]) : undefined;
}

function attr(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match ? unescapeXml(match[1]) : undefined;
}

async function soap(
  ip: string,
  service: keyof typeof SERVICES,
  action: string,
  args: Record<string, string | number> = {},
  timeoutMs = 3000,
): Promise<string> {
  const urn = `urn:schemas-upnp-org:service:${service}:1`;
  const fields = Object.entries(args)
    .map(([key, value]) => `<${key}>${escapeXml(String(value))}</${key}>`)
    .join("");
  const response = await fetch(`http://${ip}:1400${SERVICES[service]}`, {
    method: "POST",
    headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPACTION: `"${urn}#${action}"` },
    body:
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ` +
      `s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>` +
      `<u:${action} xmlns:u="${urn}">${fields}</u:${action}></s:Body></s:Envelope>`,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Sonos refused ${action} (error ${tag(text, "errorCode") ?? response.status}).`);
  }
  return text;
}

/** Finds Sonos speakers with SSDP. Returns their IP addresses. */
export function discover(timeoutMs = 2500): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        socket.close();
      } catch {
        // The socket is already closed.
      }
      resolve([...found]);
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.on("message", (data, remote) => {
      if (!/sonos/i.test(data.toString())) return;
      found.add(remote.address);
      // One speaker is enough: it knows all the others. Wait a moment for more, then stop.
      clearTimeout(timer);
      setTimeout(finish, 150);
    });
    socket.on("error", finish);
    socket.bind(() => {
      const search = [
        "M-SEARCH * HTTP/1.1",
        "HOST: 239.255.255.250:1900",
        'MAN: "ssdp:discover"',
        "MX: 1",
        "ST: urn:schemas-upnp-org:device:ZonePlayer:1",
        "",
        "",
      ].join("\r\n");
      socket.send(search, 1900, "239.255.255.250");
    });
  });
}

async function topology(seeds: string[]): Promise<string> {
  const ask = (ips: string[]) =>
    Promise.any(ips.map((ip) => soap(ip, "ZoneGroupTopology", "GetZoneGroupState", {}, 1500)));
  if (seeds.length > 0) {
    try {
      return await ask(seeds);
    } catch {
      // The saved addresses are stale. Search the network.
    }
  }
  const ips = await discover();
  if (ips.length === 0) {
    throw new Error("No Sonos speakers found. Check the Wi-Fi and the Local Network permission of Raycast.");
  }
  return ask(ips);
}

async function trackOf(ip: string): Promise<string | undefined> {
  const xml = await soap(ip, "AVTransport", "GetPositionInfo", { InstanceID: 0 });
  if ((tag(xml, "TrackURI") ?? "").startsWith("x-sonos-htastream")) return "TV";
  const meta = tag(xml, "TrackMetaData") ?? "";
  const title = tag(meta, "dc:title");
  const artist = tag(meta, "dc:creator");
  if (!title) return undefined;
  return artist ? `${title} · ${artist}` : title;
}

/** Reads the full state: groups, rooms, volumes and what plays. `seeds` are IPs from the last run. */
export async function getSystem(seeds: string[] = []): Promise<System> {
  const state = tag(await topology(seeds), "ZoneGroupState") ?? "";
  const groups = await Promise.all(
    [...state.matchAll(/<ZoneGroup\s+Coordinator="([^"]+)"[^>]*>([\s\S]*?)<\/ZoneGroup>/g)].map(
      async ([, coordinator, body]): Promise<Group | undefined> => {
        const members = [...body.matchAll(/<ZoneGroupMember(\s[^>]*?)\/?>/g)].map(([, attrs]) => ({
          uuid: attr(attrs, "UUID") ?? "",
          name: attr(attrs, "ZoneName") ?? "",
          ip: (attr(attrs, "Location") ?? "").match(/\/\/([^:/]+)/)?.[1] ?? "",
          // A hidden member is the second speaker of a stereo pair, or a bridge.
          hidden: attr(attrs, "Invisible") === "1",
        }));
        const coordinatorIp = members.find((member) => member.uuid === coordinator)?.ip;
        const visible = members.filter((member) => !member.hidden && member.ip);
        if (!coordinatorIp || visible.length === 0) return undefined;

        const [rooms, transport, track] = await Promise.all([
          Promise.all(
            visible.map(async ({ uuid, name, ip }): Promise<Room> => {
              const [volume, mute] = await Promise.all([
                soap(ip, "RenderingControl", "GetVolume", { InstanceID: 0, Channel: "Master" }),
                soap(ip, "RenderingControl", "GetMute", { InstanceID: 0, Channel: "Master" }),
              ]);
              return {
                uuid,
                name,
                ip,
                volume: Number(tag(volume, "CurrentVolume") ?? 0),
                muted: tag(mute, "CurrentMute") === "1",
              };
            }),
          ),
          soap(coordinatorIp, "AVTransport", "GetTransportInfo", { InstanceID: 0 }),
          trackOf(coordinatorIp).catch(() => undefined),
        ]);
        const transportState = tag(transport, "CurrentTransportState");
        return {
          coordinator,
          coordinatorIp,
          rooms,
          playing: transportState === "PLAYING" || transportState === "TRANSITIONING",
          tv: track === "TV",
          track,
        };
      },
    ),
  );
  const real = groups
    .filter((group): group is Group => group !== undefined)
    .sort((a, b) => a.rooms[0].name.localeCompare(b.rooms[0].name));
  const rooms = real.flatMap((group) => group.rooms).sort((a, b) => a.name.localeCompare(b.name));
  return { groups: real, rooms };
}

/**
 * The group that commands act on. It is the largest group that plays.
 * Music wins over TV audio, because a soundbar on its TV input always reports "playing".
 * If no group plays, it is the group that played last, then the largest group.
 */
export function primaryGroup(system: System, lastCoordinator?: string): Group | undefined {
  const bySize = (groups: Group[]) =>
    [...groups].sort(
      (a, b) =>
        Number(a.tv) - Number(b.tv) ||
        b.rooms.length - a.rooms.length ||
        Number(b.coordinator === lastCoordinator) - Number(a.coordinator === lastCoordinator),
    )[0];
  const playing = system.groups.filter((group) => group.playing);
  if (playing.length > 0) return bySize(playing);
  return system.groups.find((group) => group.coordinator === lastCoordinator) ?? bySize(system.groups);
}

/**
 * The rooms that volume commands change: all rooms that play music.
 * If no music plays, the rooms of the primary group (TV audio, or the group that played last).
 */
export function activeRooms(system: System, lastCoordinator?: string): Room[] {
  const music = system.groups.filter((group) => group.playing && !group.tv).flatMap((group) => group.rooms);
  if (music.length > 0) return music;
  return primaryGroup(system, lastCoordinator)?.rooms ?? [];
}

export const roomNames = (rooms: Room[]) => rooms.map((room) => room.name).join(" + ");

/** Moves the volume of each room by `delta`. Returns the new volumes, in the same order. */
export function adjustVolume(rooms: Room[], delta: number): Promise<number[]> {
  return Promise.all(
    rooms.map(async (room) => {
      const xml = await soap(room.ip, "RenderingControl", "SetRelativeVolume", {
        InstanceID: 0,
        Channel: "Master",
        Adjustment: delta,
      });
      return Number(tag(xml, "NewVolume") ?? room.volume + delta);
    }),
  );
}

export async function setVolume(rooms: Room[], volume: number): Promise<void> {
  const level = Math.max(0, Math.min(100, Math.round(volume)));
  await Promise.all(
    rooms.map((room) =>
      soap(room.ip, "RenderingControl", "SetVolume", { InstanceID: 0, Channel: "Master", DesiredVolume: level }),
    ),
  );
}

export async function setMute(room: Room, muted: boolean): Promise<void> {
  await soap(room.ip, "RenderingControl", "SetMute", {
    InstanceID: 0,
    Channel: "Master",
    DesiredMute: muted ? 1 : 0,
  });
}

export async function play(group: Group): Promise<void> {
  try {
    await soap(group.coordinatorIp, "AVTransport", "Play", { InstanceID: 0, Speed: 1 });
  } catch {
    throw new Error(`${roomNames(group.rooms)} has nothing to play. Start the music from a phone first.`);
  }
}

export async function pause(group: Group): Promise<void> {
  try {
    await soap(group.coordinatorIp, "AVTransport", "Pause", { InstanceID: 0 });
  } catch {
    throw new Error(`${roomNames(group.rooms)} cannot pause this source${group.track === "TV" ? " (TV audio)" : ""}.`);
  }
}

async function join(room: Room, group: Group): Promise<void> {
  await soap(room.ip, "AVTransport", "SetAVTransportURI", {
    InstanceID: 0,
    CurrentURI: `x-rincon:${group.coordinator}`,
    CurrentURIMetaData: "",
  });
}

async function leave(room: Room): Promise<void> {
  await soap(room.ip, "AVTransport", "BecomeCoordinatorOfStandaloneGroup", { InstanceID: 0 });
}

/** What a toggle does to a room, for the label of the action. */
export function toggleKind(system: System, room: Room, lastCoordinator?: string): ToggleResult {
  const primary = primaryGroup(system, lastCoordinator);
  if (!primary?.playing) return "playing";
  if (!primary.rooms.some((member) => member.uuid === room.uuid)) return "added";
  return primary.rooms.length > 1 ? "removed" : "paused";
}

/** Adds the room to the group that plays, or removes it. If nothing plays, starts the room. */
export async function toggleRoom(system: System, room: Room, lastCoordinator?: string): Promise<ToggleResult> {
  const kind = toggleKind(system, room, lastCoordinator);
  const primary = primaryGroup(system, lastCoordinator);
  const own = system.groups.find((group) => group.rooms.some((member) => member.uuid === room.uuid));
  if (kind === "added" && primary) await join(room, primary);
  if (kind === "removed") await leave(room);
  if (kind === "paused" && primary) await pause(primary);
  if (kind === "playing" && own) await play(own);
  return kind;
}

/** Pauses every group that plays music. If no music plays, starts the group that played last. */
export async function playPause(system: System, lastCoordinator?: string): Promise<{ playing: boolean; rooms: Room[] }> {
  const music = system.groups.filter((group) => group.playing && !group.tv);
  if (music.length > 0) {
    await Promise.all(music.map(pause));
    return { playing: false, rooms: music.flatMap((group) => group.rooms) };
  }
  const idle = system.groups.filter((group) => !group.playing);
  const target = idle.find((group) => group.coordinator === lastCoordinator) ?? idle[0];
  if (!target) throw new Error("No paused music to start.");
  await play(target);
  return { playing: true, rooms: target.rooms };
}

/** Puts every room in the primary group, then makes sure that it plays. */
export async function playEverywhere(system: System, lastCoordinator?: string): Promise<void> {
  const primary = primaryGroup(system, lastCoordinator);
  if (!primary) throw new Error("No Sonos rooms found.");
  const outside = system.rooms.filter((room) => !primary.rooms.some((member) => member.uuid === room.uuid));
  await Promise.all(outside.map((room) => join(room, primary)));
  if (!primary.playing) await play(primary);
}

export async function pauseAll(system: System): Promise<void> {
  await Promise.all(system.groups.filter((group) => group.playing && !group.tv).map(pause));
}

/** The model of a speaker, for example "Beam". */
export async function modelOf(ip: string): Promise<string | undefined> {
  const response = await fetch(`http://${ip}:1400/xml/device_description.xml`, { signal: AbortSignal.timeout(2000) });
  return tag(await response.text(), "displayName");
}
