// Prints the live Sonos state. It reads only: it changes nothing on the speakers.
// Run: node scripts/read-state.ts
import { activeRooms, getSystem, modelOf, primaryGroup, roomNames, toggleKind } from "../src/sonos.ts";

const system = await getSystem();
for (const group of system.groups) {
  console.log(`${group.playing ? "PLAYING" : "idle   "} ${roomNames(group.rooms)}  track: ${group.track ?? "-"}`);
}
for (const room of system.rooms) {
  console.log(
    `  ${room.name} (${await modelOf(room.ip)}) ${room.ip} volume ${room.volume}${room.muted ? " muted" : ""}` +
      `  toggle -> ${toggleKind(system, room)}`,
  );
}
console.log("primary:", roomNames(primaryGroup(system)?.rooms ?? []));
console.log("active: ", roomNames(activeRooms(system)));
