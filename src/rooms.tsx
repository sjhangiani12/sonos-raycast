import { Action, ActionPanel, Color, Icon, List, showToast, Toast, type LaunchProps } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import { TOGGLE_MESSAGE } from "./commands";
import {
  activeRooms,
  adjustVolume,
  pauseAll,
  playEverywhere,
  playPause,
  primaryGroup,
  roomNames,
  setMute,
  setVolume,
  toggleKind,
  toggleRoom,
  type Group,
  type Room,
  type System,
  type ToggleResult,
} from "./sonos";
import { lastCoordinator, load, loadModels, volumeStep } from "./state";

const TOGGLE_TITLE: Record<ToggleResult, string> = {
  added: "Add to Group",
  removed: "Remove from Group",
  paused: "Pause",
  playing: "Play Here",
};

/** A volume bar of 10 segments, made of text. An SVG progress icon did not render in the accessories. */
function volumeBar(volume: number) {
  const filled = volume > 0 ? Math.max(1, Math.round(volume / 10)) : 0;
  return "▰".repeat(filled) + "▱".repeat(10 - filled);
}

async function loadAll() {
  const system = await load();
  return { system, models: await loadModels(system) };
}

export default function Command(props: LaunchProps) {
  const [text, setText] = useState(props.fallbackText ?? "");
  const { data, isLoading, revalidate } = useCachedPromise(loadAll, [], { keepPreviousData: true });

  // Other controllers (a phone, the TV) also change the speakers, so read the state again every 5 seconds.
  const refresh = useRef(revalidate);
  refresh.current = revalidate;
  useEffect(() => {
    const timer = setInterval(() => refresh.current(), 5000);
    return () => clearInterval(timer);
  }, []);

  /** Runs one change on the speakers, shows the result, then reads the state again. */
  async function act(change: () => Promise<string | void>) {
    try {
      const message = await change();
      if (message) await showToast({ style: Toast.Style.Success, title: message });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: error instanceof Error ? error.message : "Sonos did not answer.",
      });
    }
    revalidate();
  }

  const system: System = data?.system ?? { groups: [], rooms: [] };
  const models = data?.models ?? {};
  const last = lastCoordinator();
  const step = volumeStep();
  const query = text.trim();
  const typedVolume = /^\d{1,3}$/.test(query) ? Math.min(100, Number(query)) : undefined;

  // Type a number: each row sets that volume. The first row is the rooms that play now.
  if (typedVolume !== undefined) {
    const active = activeRooms(system, last);
    const isActive = (room: Room) => active.some((member) => member.uuid === room.uuid);
    const targets: { id: string; title: string; subtitle?: string; rooms: Room[] }[] = [
      ...(active.length > 1
        ? [{ id: "active", title: roomNames(active), subtitle: "Rooms that play now", rooms: active }]
        : []),
      ...[...system.rooms]
        .sort((a, b) => Number(isActive(b)) - Number(isActive(a)))
        .map((room) => ({ id: room.uuid, title: room.name, subtitle: models[room.uuid], rooms: [room] })),
    ];
    return (
      <List isLoading={isLoading} searchText={text} onSearchTextChange={setText} filtering={false}>
        <List.Section title={`Set volume to ${typedVolume}`}>
          {targets.map((target) => (
            <List.Item
              key={target.id}
              id={`set-${target.id}`}
              icon={Icon.SpeakerHigh}
              title={target.title}
              subtitle={target.subtitle}
              accessories={[
                { text: target.rooms.map((room) => room.volume).join(", ") },
                { icon: Icon.ArrowRight },
                { text: { value: String(typedVolume), color: Color.Yellow } },
              ]}
              actions={
                <ActionPanel>
                  <Action
                    title={`Set Volume to ${typedVolume}`}
                    icon={Icon.SpeakerHigh}
                    onAction={() =>
                      act(async () => {
                        await setVolume(target.rooms, typedVolume);
                        setText("");
                        return `${target.title} · ${typedVolume}`;
                      })
                    }
                  />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      </List>
    );
  }

  const matches = (name: string) => name.toLowerCase().includes(query.toLowerCase());
  const primary = primaryGroup(system, last);
  const playing = system.groups
    .filter((group) => group.playing)
    .sort((a, b) => Number(b === primary) - Number(a === primary));
  const idle = system.groups.filter((group) => !group.playing).flatMap((group) => group.rooms);

  const roomItem = (room: Room, group?: Group) => {
    const kind = toggleKind(system, room, last);
    const icon = !group
      ? Icon.Circle
      : group === primary
        ? { source: Icon.CheckCircle, tintColor: Color.Yellow }
        : group.tv
          ? Icon.Desktop
          : Icon.Music;
    return (
      <List.Item
        key={room.uuid}
        id={room.uuid}
        icon={icon}
        title={room.name}
        subtitle={models[room.uuid]}
        accessories={[
          ...(room.muted ? [{ icon: Icon.SpeakerOff, tooltip: "Muted" }] : []),
          { text: { value: volumeBar(room.volume), color: group ? Color.Yellow : Color.SecondaryText } },
          { text: String(room.volume).padStart(2, " ") },
        ]}
        actions={
          <ActionPanel>
            <Action
              title={TOGGLE_TITLE[kind]}
              icon={kind === "removed" || kind === "paused" ? Icon.MinusCircle : Icon.PlusCircle}
              onAction={() => act(async () => TOGGLE_MESSAGE[await toggleRoom(system, room, last)](room.name))}
            />
            <Action
              title="Volume Up"
              icon={Icon.SpeakerUp}
              shortcut={{ modifiers: [], key: "arrowRight" }}
              onAction={() => act(async () => void (await adjustVolume([room], step)))}
            />
            <Action
              title="Volume Down"
              icon={Icon.SpeakerDown}
              shortcut={{ modifiers: [], key: "arrowLeft" }}
              onAction={() => act(async () => void (await adjustVolume([room], -step)))}
            />
            {/* The same two actions again, on keys that are known to be free in Raycast. */}
            <Action
              title="Volume Up"
              icon={Icon.SpeakerUp}
              shortcut={{ modifiers: ["cmd"], key: "arrowUp" }}
              onAction={() => act(async () => void (await adjustVolume([room], step)))}
            />
            <Action
              title="Volume Down"
              icon={Icon.SpeakerDown}
              shortcut={{ modifiers: ["cmd"], key: "arrowDown" }}
              onAction={() => act(async () => void (await adjustVolume([room], -step)))}
            />
            <Action
              title={room.muted ? "Unmute" : "Mute"}
              icon={room.muted ? Icon.SpeakerOn : Icon.SpeakerOff}
              shortcut={{ modifiers: ["cmd"], key: "m" }}
              onAction={() => act(() => setMute(room, !room.muted))}
            />
            <Action
              title="Play or Pause Music"
              icon={Icon.Play}
              shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
              onAction={() =>
                act(async () => {
                  const result = await playPause(system, last);
                  return `${result.playing ? "Playing" : "Paused"} · ${roomNames(result.rooms)}`;
                })
              }
            />
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={revalidate}
            />
          </ActionPanel>
        }
      />
    );
  };

  return (
    <List
      isLoading={isLoading}
      searchText={text}
      onSearchTextChange={setText}
      filtering={false}
      searchBarPlaceholder="Search rooms, or type a volume"
    >
      {playing.map((group) => (
        <List.Section
          key={group.coordinator}
          title={group.rooms.length > 1 ? "Playing together" : "Playing"}
          subtitle={group.track}
        >
          {group.rooms.filter((room) => matches(room.name)).map((room) => roomItem(room, group))}
        </List.Section>
      ))}
      <List.Section title="Not playing">
        {idle.filter((room) => matches(room.name)).map((room) => roomItem(room))}
      </List.Section>
      {system.rooms.length > 0 && (
        <List.Section title="Whole home">
          {matches("Play in every room") && (
            <List.Item
              id="everywhere"
              icon={Icon.House}
              title="Play in Every Room"
              actions={
                <ActionPanel>
                  <Action
                    title="Play in Every Room"
                    icon={Icon.House}
                    onAction={() =>
                      act(async () => {
                        await playEverywhere(system, last);
                        return "Playing in every room";
                      })
                    }
                  />
                </ActionPanel>
              }
            />
          )}
          {matches("Pause everything") && (
            <List.Item
              id="pause-all"
              icon={Icon.Pause}
              title="Pause Everything"
              actions={
                <ActionPanel>
                  <Action
                    title="Pause Everything"
                    icon={Icon.Pause}
                    onAction={() =>
                      act(async () => {
                        await pauseAll(system);
                        return "Paused the music";
                      })
                    }
                  />
                </ActionPanel>
              }
            />
          )}
        </List.Section>
      )}
    </List>
  );
}
