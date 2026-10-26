# Monopoly Online (2–6 players, friends instead of bots)

How it works: every player runs the full game in their browser (Ruffle). The game
is deterministic (shared random seed), and a tiny Node server only relays each
player's moves (roll, buy, build, trade, bid…) to the others in the same order.

```
web/                 what the browser loads
  index.html         lobby (name, room code, token, host presses Start)
  game.swf           patched main.swf (built by build/build.sh)
  monopoly_config.xml, assets/   original game files
server/server.js     rooms + relay + static files (no dependencies)
src/scripts/         decompiled ActionScript (patched files + new net/ classes)
build/build.sh       rebuilds web/game.swf from main.swf + patched sources
```

## Play locally / with friends on your network

```
node server/server.js        # then open http://localhost:8080
```

Everyone opens the page, types their own name, uses the same room code, and the
first person to join (host) presses **Start game**.

## Play over the internet (free host)

Any Node host works. On Render.com: new *Web Service* from a Git repo containing
this folder, build command empty, start command `npm start`. Share the URL it
gives you. Free instances sleep when idle, so the first load can take ~30 s.
Alternatively run the server on your PC and expose it with a tunnel
(e.g. `cloudflared tunnel --url http://localhost:8080`).

Note: the game files in `web/` are EA/Hasbro's. Keep the site private
(only share the link with friends).

## Rebuild after changing ActionScript

```
bash build/build.sh
```

Needs Java. FFDec is in `tools/ffdec`. Patch scripts: `build/patch_game.js`,
`build/patch_small.js` (they re-apply edits to the pristine decompiled files in
`build/orig/`).

## Test helpers

`web/test.html` loads `game.swf` directly from URL parameters (no lobby), e.g.
`test.html?swf=game.swf&room=R&seat=0&n=2&seed=1&names=["A","B"]&tokens=[4,3]`.
The room must already exist and be started (use the lobby or the /api/join + /api/start calls).
Add `rejoin=1` to replay as a returning player. Optional scenario parameters, applied identically on every client:
`dbgown=0:1,3;1:6,8,9` (seat:properties), `dbgcash=0:1500;1:10` (seat:cash),
`dbgmort=0:21,23` (seat:properties that start mortgaged), `dbgrolls=J,7,4` (scripted dice sums; `J` = go to jail). Ignored when absent.

## Known limits

* Reconnect: if a player refreshes or drops, they open the same site and press **Rejoin game** (their browser remembers the room and seat). Their client silently fast-forwards the game from the server log behind a "Reconnexion… N%" cover (sound muted, clock and frame rate sped up, intro dialog auto-closed), then removes the cover and hands control back at the live state. Rooms are kept in server memory for 6 hours; restarting the server loses running games.
* The end-of-game screen is a simple "<name> wins the game!" dialog (the original needs Pogo files that are not part of the game).
* 5–6 players hide the "History" side panel to make room for the extra panels.
* Players choose a token in the lobby; the in-game token picker is skipped.
