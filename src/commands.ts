// The commands that run with no window. Each one ends with a short HUD message.
import { getPreferenceValues, showHUD, type LaunchProps } from "@raycast/api";
import { activeRooms, adjustVolume, playPause, roomNames, setVolume, toggleRoom, type ToggleResult } from "./sonos";
import { lastCoordinator, load, volumeStep } from "./state";

async function run(action: () => Promise<string>) {
  try {
    await showHUD(await action());
  } catch (error) {
    await showHUD(error instanceof Error ? error.message : "Sonos did not answer.");
  }
}

const levels = (volumes: number[]) => [...new Set(volumes)].join(", ");

export const nudgeVolume = (direction: 1 | -1) =>
  run(async () => {
    const rooms = activeRooms(await load(), lastCoordinator());
    if (rooms.length === 0) throw new Error("No Sonos rooms found.");
    const volumes = await adjustVolume(rooms, direction * volumeStep());
    return `${roomNames(rooms)} · ${levels(volumes)}`;
  });

export const setVolumeCommand = (props: LaunchProps<{ arguments: { volume: string } }>) =>
  run(async () => {
    const volume = Number(props.arguments.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 100) throw new Error("Type a number from 0 to 100.");
    const rooms = activeRooms(await load(), lastCoordinator());
    if (rooms.length === 0) throw new Error("No Sonos rooms found.");
    await setVolume(rooms, volume);
    return `${roomNames(rooms)} · ${Math.round(volume)}`;
  });

export const playPauseCommand = () =>
  run(async () => {
    const result = await playPause(await load(), lastCoordinator());
    return `${result.playing ? "Playing" : "Paused"} · ${roomNames(result.rooms)}`;
  });

export const TOGGLE_MESSAGE: Record<ToggleResult, (room: string) => string> = {
  added: (room) => `Added ${room}`,
  removed: (room) => `Removed ${room}`,
  paused: (room) => `Paused ${room}`,
  playing: (room) => `Playing in ${room}`,
};

/** Toggles the room that the command preference names. */
export const toggleRoomCommand = () =>
  run(async () => {
    const name = (getPreferenceValues<{ room?: string }>().room ?? "").trim();
    const system = await load();
    const room = system.rooms.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    if (!room) throw new Error(`No Sonos room has the name "${name}". Change it in the command settings.`);
    return TOGGLE_MESSAGE[await toggleRoom(system, room, lastCoordinator())](room.name);
  });
