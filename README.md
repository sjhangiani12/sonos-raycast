<p align="center">
  <img src="assets/icon.png" width="96" alt="Sonos for Raycast icon">
</p>

<h1 align="center">Sonos for Raycast</h1>

<p align="center">
  Change the volume and pick the rooms that play, from the keyboard.<br>
  No Sonos account. No cloud. The extension talks to the speakers on your Wi-Fi.
</p>

---

## What it does

| Command | Window | What it does |
| --- | --- | --- |
| **Sonos Rooms** | Yes | Shows every room, its volume, and what plays. |
| **Volume Up** | No | Raises the volume of the rooms that play now. |
| **Volume Down** | No | Lowers the volume of the rooms that play now. |
| **Set Volume** | No | Sets those rooms to a number from 0 to 100. |
| **Play or Pause** | No | Pauses the music, or starts it again. |
| **Toggle _room_** | No | Adds one room to the group that plays, or removes it. |

Give a hotkey to each command that has no window. Then you never open Raycast to change the volume.

## The rooms list

```
┌──────────────────────────────────────────────────────────────┐
│  Search rooms, or type a volume                              │
├──────────────────────────────────────────────────────────────┤
│  Playing together                       Show Me · Joey Bada$$│
│  ✓  Living Room      Beam                           ◔   32   │
│  ✓  Bathroom         One SL                         ◑   45   │
│  Not playing                                                 │
│  ○  Bedroom          One SL                         ◔   23   │
│  Whole home                                                  │
│     Play in Every Room                                       │
│     Pause Everything                                         │
└──────────────────────────────────────────────────────────────┘
```

| Key | Action on the selected room |
| --- | --- |
| `↵` | Add the room to the group, or remove it |
| `→` or `⌘↑` | Volume up |
| `←` or `⌘↓` | Volume down |
| `⌘M` | Mute or unmute |
| `⌘⇧P` | Play or pause the music |
| `⌘R` | Refresh |

**Type a number to set the volume.** Type `30`, then press `↵`. The first row is always the rooms that play now. The rows below it set one room each.

## Install

You need [Raycast](https://raycast.com) and Node 20 or later.

```sh
git clone https://github.com/sjhangiani12/sonos-raycast.git
cd sonos-raycast
npm install
npm run dev
```

`npm run dev` adds the extension to Raycast. Stop it with `Ctrl-C`. The extension stays in Raycast.

macOS can ask to let Raycast find devices on your local network. Allow it.

## Set it up

Open **Raycast Settings → Extensions → Sonos**.

1. **Record a hotkey** for Volume Up, Volume Down, Play or Pause, and each toggle.
2. **Name your rooms.** Each toggle command has a _Room Name_ setting. Type the name that the Sonos app shows.
3. **Pick the volume step.** The default is 3 points for each key press.

Hotkeys that work well:

| Command | Hotkey |
| --- | --- |
| Volume Up | `⌃⌥↑` |
| Volume Down | `⌃⌥↓` |
| Play or Pause | `⌃⌥Space` |
| Toggle room 1, 2, 3 | `⌃⌥1`, `⌃⌥2`, `⌃⌥3` |

## How it decides which rooms to change

- **The rooms that play now** are all rooms that play music.
- **Music wins over TV audio.** A soundbar on its TV input always reports "playing". The volume keys change the soundbar only when no music plays.
- **If nothing plays,** the commands use the group that played last.
- **A toggle** adds the room to the group that plays. If the room is already in the group, the toggle removes it. If the room plays alone, the toggle pauses it.

## How it works

Each Sonos speaker has a local control service (UPnP) on port 1400. The extension finds one speaker with SSDP. That speaker lists all the others. The extension saves the addresses, so the next command is fast.

| File | Purpose |
| --- | --- |
| `src/sonos.ts` | The Sonos client. It has no Raycast code and no dependencies. |
| `src/state.ts` | The saved addresses, speaker models, and settings. |
| `src/rooms.tsx` | The rooms list. |
| `src/commands.ts` | The commands that have no window. |
| `scripts/read-state.ts` | Prints the live state of your speakers. It changes nothing. |

Check your speakers from a terminal:

```sh
node scripts/read-state.ts
```

## Limits

- The Mac and the speakers must be on the same network.
- Play starts music that is already in the queue of a room. To pick new music, use the Sonos app.
- TV audio cannot pause.
