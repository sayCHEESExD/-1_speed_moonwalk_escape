# +1 Speed Moonwalk Escape

A browser multiplayer escape game. You moonwalk down a red carpet through a
neon city at night, dodging disco balls, chased by a very large security guard,
while a leaderboard on the wall behind you keeps score.

Three.js + Colyseus + TypeScript. No engine, no blockchain, no cloud services.
The whole browser build is **1.51 MB**.

The third game in the same series as `+1 Backflip Obby Escape` and
`+1 Speed Animal Escape`, and it reuses their architecture: the same shared
authoritative simulation, the same client-side prediction and reconciliation,
the same Speed/level/rebirth progression, the same runtime-drawn textures.

---

## Quick start

```bash
npm install
npm run dev
```

Then open **http://localhost:5175**. The Colyseus server comes up on **2569**.

Both ports are deliberately not the defaults and not the previous games' — all
three projects can run side by side.

## The loop

1. Spawn on the red carpet, in the arena, under permanent night.
2. Moonwalk out through the VIP arch and down the course.
3. Cross a stage's finish banner to bank its Wins and carry straight on into
   the next stage.
4. Farm **Speed** by moving — every stride and every jump — which raises your
   **level**, which makes you permanently faster.
5. Train on the treadmills on your **left** to farm Speed without running the
   course.
6. Spend Wins on the speed upgrade tiles on your **right**. Step on one to buy
   it.
7. **Rebirth** at level 25, and every 25 levels after that, for a permanently
   higher ceiling and a bigger multiplier.
8. Outrun the monster. **THE MONSTER IS COMING** appears on screen the moment
   it starts after you; if it catches you, you are back at the carpet.

## Controls

| Input           | Action                                             |
| --------------- | -------------------------------------------------- |
| **W A S D**     | Move (camera-relative). W glides you down the course |
| **Shift**       | Sprint                                             |
| **Space**       | Jump                                               |
| **Mouse**       | Aim the camera. The camera defines forward         |
| **R**           | Rebirth panel                                      |
| **U**           | Speed upgrade ladder                               |
| **M**           | Mute                                               |
| **Escape**      | Close panels and free the cursor                   |

Touch controls appear automatically on a phone or tablet, and on a hybrid
device the moment a finger actually touches the screen.

## The moonwalk

The character glides **backwards relative to the way they are facing** — which
is what a moonwalk is, and why pressing W sends them physically backward down
the carpet while the animation plays forward.

Mechanically it is one constant: the simulation faces the player the way they
are travelling like any ordinary character, and the model is drawn half a turn
from that. Physics, collision and the server's authoritative yaw never learn
about it. A happy side effect is that the character faces the chase camera for
the whole run, so the hat, the glasses and the raised hand are always in shot.

There are exactly **two** authored animations — the moonwalk and the jump.
There is no walk cycle and no run cycle in this codebase, deliberately.

## Stages and rewards

Ten stages, each ending in a transparent finish banner spanning the entire
course with its reward printed across it. Crossing the line pays automatically
and advances you — there is no pad to find and no teleport back.

| # | Stage           | Difficulty | Rec. level | Wins      |
| - | --------------- | ---------- | ---------- | --------- |
| 1 | Red Carpet      | EASY       | 1          | 1         |
| 2 | Rope Line       | EASY       | 3          | 5         |
| 3 | Flashbulbs      | EASY       | 6          | 40        |
| 4 | The Catwalk     | NORMAL     | 10         | 100       |
| 5 | Paparazzi Pit   | NORMAL     | 15         | 450       |
| 6 | Falling Rig     | HARD       | 22         | 2,500     |
| 7 | Neon Columns    | HARD       | 30         | 15,000    |
| 8 | Dance Floor     | INSANE     | 40         | 75,000    |
| 9 | Hall of Mirrors | INSANE     | 52         | 250,000   |
| 10| Grand Finale    | NIGHTMARE  | 66         | 1,000,000 |

Every hazard in the game is a **disco ball**. They roll down the carpet, swing
across it, orbit a hub, and drop out of the lighting rig — four motions, one
object, one thing to learn.

## The monster

A huge horned thing with glowing pink eyes, about four times your height. Each
player is chased by their **own**, simulated on their own machine: you never
see anybody else's, and yours is never sent over the network.

It waits off to one side of the course entrance while you are in the arena —
the arena is a safe hub, because it is where you buy upgrades, farm belts and
read the boards — and it does not start after you until you are properly out on
the first stage. **Standing still never kills you on its own**; it has to
actually reach you.

Once it is coming, **THE MONSTER IS COMING** appears across the screen, and it
stays up for exactly as long as it is actually chasing.

It does not fall into gaps and it does not give up: it strides across the
catwalks and follows you through every stage to the end of the course. Its
speed is a fraction of *your* current top speed, so it stays exactly as
threatening at level 60 as at level 1, and that fraction rises with every stage
you reach.

Catching you costs you the run and nothing else. The server still decides where
you are placed.

## Speed upgrades

Ten floor tiles down the right-hand side of the arena. Each shows what it gives
(`+X SPEED`) and what it costs in Wins. Walk onto one holding enough Wins and
it is bought, permanently.

There are no boots, no pets, no animals and no equipment — nothing appears on
the character. That is deliberate: he wears one outfit.

| Tier | Name      | Speed/stride | Wins      |
| ---- | --------- | ------------ | --------- |
| 1    | Rookie    | +1           | free      |
| 2    | Groove    | +3           | 5         |
| 3    | Spotlight | +9           | 40        |
| 4    | Sequin    | +26          | 120       |
| 5    | Platinum  | +75          | 600       |
| 6    | Neon      | +210         | 3,000     |
| 7    | Disco     | +600         | 18,000    |
| 8    | Superstar | +1,700       | 90,000    |
| 9    | Icon      | +5,000       | 400,000   |
| 10   | Legend    | +15,000      | 1,500,000 |

The highest tier you own is always the one equipped, so buying a cheaper one
later can never downgrade you.

## Treadmills

Three machines on the left of the arena — **Rehearsal**, **Showtime** and
**Headliner**. They pay **exactly the same**: the bay is somewhere to farm
while chatting, not a ladder, so there is nothing to choose between them. The
three names and colours exist so you can say which one you are standing on.

Standing on a belt is derived from your position by the simulation on both
sides, so there is no button, no message and nothing to forge: step on to start
farming, step off to stop.

## Layout

```
shared/     the single source of truth both halves obey
  config/   course, movement, speed, rebirth, upgrades, camera
  sim/      PlayerSim (the one physics step) and WorldCollision
server/     Colyseus. Owns every reward, every death and the clock
  progression/  Speed, Stage, Upgrade, Rebirth, Wallet, Leaderboard
  rooms/    CourseRoom - composition only, every rule lives in a service
client/     Three.js
  animation/  MoonwalkCycle, PlayerAnimator, the bone rig
  guard/      the client-local chaser
  world/      the arena, the city, the banners, the disco balls
scripts/    the verification suites
```

## Commands

| Command                     | What it does                                  |
| --------------------------- | --------------------------------------------- |
| `npm run dev`               | Server on 2569, client on 5175                |
| `npm run build`             | Build all three workspaces                    |
| `npm run typecheck`         | Typecheck everything                          |
| `npm run verify`            | Course + progression + services suites        |
| `npm run verify:assets`     | Every runtime asset exists                    |
| `npm run size:client`       | Measure against the 12 MB budget              |
| `npm start`                 | Run the built server                          |

## Design rules

The permanent constraints — why the moonwalk is one constant on a visual node,
why the guard is client-local, why the finish line is a crossing test rather
than a trigger box, why there is no checkpoint system — are written down in
[CLAUDE.md](CLAUDE.md). Read it before changing anything.

## Deployment

The client is static and the server is a long-lived Node process, so they go to
two different places. `VITE_SERVER_URL` is baked into the client at **build**
time and is the only client-side configuration there is.

### Bloxity Hosting (automatic)

Pushing deploys. `.github/workflows/deploy.yml` builds both halves and publishes
them:

| Branch          | Channel | Backend                                       | Frontend                                       |
| --------------- | ------- | --------------------------------------------- | ---------------------------------------------- |
| `dev`           | `dev`   | `wss://speed-moonwalk-escape.dev.host.bloxity.io` | `https://speed-moonwalk-escape.dev.play.bloxity.io` |
| `main`/`master` | `prod`  | `wss://speed-moonwalk-escape.host.bloxity.io`     | `https://speed-moonwalk-escape.play.bloxity.io`     |

Note the convention: **`.dev.` is the dev channel and the bare host is prod.**
Getting that backwards points test players at the live server, which nobody
notices until test progress turns up on the production leaderboard.

The server is built by [`Dockerfile`](Dockerfile) into a GHCR image tagged
`<channel>-<sha>` and rolled by the Legion control plane; the client is zipped
with `index.html` at the archive root and uploaded to Bloxity Hosting. The
commit SHA is the deployment version for both halves, so a frontend and a
backend from the same push are identifiable as a pair.

Both API routes were verified against the live service before being used — each
answers `401` without a token while a deliberately wrong sibling path answers
`404`, so neither is a guess.

**One secret is required:** `LEGION_DEPLOY_TOKEN`, under
*Settings → Secrets and variables → Actions*. Copy it from *My Games* on
hosting.bloxity.io. Nothing else needs configuring — the API hosts and the
per-channel URLs all have working defaults, and the optional repository
variables `LEGION_API_BASE`, `HOSTING_API_BASE`, `SERVER_URL_DEV` and
`SERVER_URL_PROD` exist only so a change on Bloxity's side stays a settings
edit rather than a commit.

`workflow_dispatch` runs the same pipeline against a channel you pick, for
re-publishing without a push.

### A caveat about persistence

Player profiles are a JSON file behind `PersistenceAdapter`. Legion scales a
pod to zero when the last player leaves, and the container filesystem goes with
it — so on Bloxity, progression currently lasts only as long as a pod does.
Legion injects a `MONGODB_URI` per game and channel for exactly this case;
wiring an adapter to it is the fix, and until then the `VOLUME` in the
Dockerfile is honest about promising nothing on Kubernetes.

### Netlify (the static client alone)

`netlify.toml` still builds and publishes `client/dist`, which is useful for
previewing the client against a server running anywhere else. It does not
deploy the Colyseus server.
