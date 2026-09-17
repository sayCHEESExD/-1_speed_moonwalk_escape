# CLAUDE.md — +1 Speed Moonwalk Escape

Permanent project rules and design constraints. Read this before changing anything.

## What this is

A **production** browser multiplayer escape game, and the third in the same
series as `+1 Backflip Obby Escape` and `+1 Speed Animal Escape`. Not a demo,
not a prototype. "Roblox-inspired" describes the **visual and gameplay style
only**.

The one gameplay difference from the previous games: the player does not
backflip and does not ride an animal. They **moonwalk**. That is the only way
this character moves on the ground, at every speed, for the whole game.

## Technology (fixed)

| Layer  | Stack                                   |
| ------ | --------------------------------------- |
| Client | Three.js + TypeScript + Vite            |
| Server | Colyseus + Node.js + TypeScript         |
| Shared | TypeScript, framework-free              |
| Target | Browser / WebGL, desktop **and** mobile |
| Repo   | npm workspaces monorepo                 |

**Not used, ever:** Unity. Roblox Studio or the Roblox engine. Any other game
engine. Do not add a framework or a build tool without a concrete need.

**Bloxity is integrated; nothing else is.** No blockchain and no other cloud
service. The server has exactly two HTTP routes - `/health` and Bloxity's Bux
webhook - and must not grow a third without a concrete need: an endpoint that
exists before anything needs it is an endpoint nobody is checking the
authentication on.

## Hard constraints

- Final browser build must stay **under 12 MB**. It is currently ~1.51 MB.
  `npm run size:client` enforces it.
- **Progression and rewards are server-authoritative.** The client may predict
  for UI feel but never decides, computes or claims a reward.
- Desktop and mobile browsers are both first-class. No desktop-only input
  assumptions.
- **Ports are not the defaults, and not the previous games'.** The two earlier
  games in this series run on 2567/5173 and 2568/5174 on the same machine. This
  one uses **2569** and **5175** so all three can run side by side; sharing
  either port means whichever server starts first silently serves both clients.
  The dev script passes `--port 2569` explicitly, because a dev harness that
  hosts the client often exports `PORT` for its own web server and the game
  server would otherwise bind to it.

## THE MOONWALK

This is the whole game, so it gets its own section.

- **There are exactly TWO authored animations: the MOONWALK and the JUMP.**
  There is no walk cycle and no run cycle anywhere in this codebase, and adding
  one would not be a feature - it would be the thing that stops the character
  being a moonwalker. `Idle` is the moonwalk's own held pose with the slide
  taken out of it; `Dying` is a half-second procedural tip-over with no cycle in
  it. Neither is a third animation.
- **The reversal is ONE constant on ONE visual node**, and it lives in
  presentation: `PLAYER_MODEL_YAW_OFFSET` is `Math.PI`, applied to the
  `facing` node in `PlayerCharacter`. The simulation faces the player the way
  they are TRAVELLING, exactly as it would for any character; the body is then
  drawn half a turn from that, so pressing W sends the character physically
  backwards down the carpet.
- **The reversal must never move into `stepPlayer`.** Physics, collision, the
  camera's idea of forward and the server's authoritative yaw are all
  completely ordinary. Putting a dance move into the shared simulation would
  mean the client and the server had to agree about it, which is exactly the
  sort of thing that ends up agreed on one side only.
- The character therefore faces the CAMERA for the whole run. That is not an
  accident to be corrected - it is the shot the reference art is, and it is why
  the hat, the glasses and the raised hand are visible at all times.
- **The two legs must be doing DIFFERENT things at every instant.** One is flat
  on the floor with a straight knee, sliding backward; the other has its heel
  up and its knee folded hard, coming forward on the toe. Half a cycle later
  they swap. Both knees bending together is what a walk is, so the sign of the
  knee curve in `MoonwalkCycle.writeLeg` is the difference between the whole
  game working and not.
- **The head SNAPS, it does not nod.** The drive is a sine pushed through a
  steep `tanh`, which holds, flicks in a couple of frames and holds again. A
  plain sine there is a nod, and a nod is the one head motion this move does
  not have.
- **The raised hand is HELD, not swung.** The right arm stays folded up by the
  hat brim for the entire move with only a small pulse on it. It is the
  silhouette the character is recognised by, and an arm that swung would put
  the hand somewhere different every frame.
- Cadence is CLAMPED (`MOONWALK.maxFrequency`). Phase advances with DISTANCE,
  so a late-game player at four hundred units a second would otherwise cycle
  their feet 150 times a second. The sense of pace comes from the world going
  past.
- The show blend is measured against the player's own `moveMultiplier`, so
  "full tilt" means the same thing at level 1 and level 60.

## The guard

- **The guard is CLIENT-LOCAL and is not on the wire.** Every player has their
  own, simulated on their own machine. Player A sees guard A and nothing more.
  Do not replicate it, and do not add it to `CourseState`.
- Replicating it would mean a per-player chasing entity at twenty hertz -
  fifteen of them in a full room - to draw fourteen things every client is then
  required to hide.
- **A catch is a FORFEIT, not a grant.** All the guard can do is ask the server
  to put its own player back at the arena - a request any client could already
  make - and it costs the asker their entire run. There is nothing here to
  cheat FOR, which is what makes trusting the client with it reasonable rather
  than merely convenient.
- The server still decides the placement. `Game.updateGuard` calls
  `requestRespawn('guard')`; the reason is LOGGED and never changes the
  destination.
- **THE MONSTER NEVER ENTERS THE ARENA**, and that is a rule rather than a
  tuning choice. The arena is the hub: it holds the treadmills, the upgrade
  tiles and the boards, and every run begins and ends there. One that chased in
  would catch anybody who stopped to read a price or farm a belt, over and over,
  and the one room built for standing still would be the least safe place in
  the game.
- **It waits OFF THE LANE, and the chase starts at `headStart`, not at the
  boundary.** Both halves of that are the fix for a real bug: it used to wait
  on the centreline at the mouth of the course and begin the instant the exit
  line was crossed, which put it a few units IN FRONT of anybody stepping out
  of the arch and killed anybody who paused just outside in about two seconds.
  **Standing still is not a death condition and must never become one.** It now
  waits hard against a wall and does not move until the player is well down the
  first stage.
- **It does not fall, and it is not run through `stepPlayer`.** It has no jump,
  no gravity and no physics: it walks toward the player along the corridor,
  samples the floor to climb risers, and STRIDES over any gap it finds. A
  creature four times the player's height stepping across a catwalk gap is what
  it should look like, and it is also the only version of this that cannot end
  up stuck at the bottom of a pit under the map for the rest of the run.
  `floorAt` falls back to `COURSE.floorY` rather than to the pit for exactly
  that reason.
- **It is a MONSTER, not a bouncer.** Roughly four times the player's height,
  hunched, horned, with oversized glowing eyes - the eyes are the only bright
  thing on it, because what the player actually tracks over their shoulder is
  two pink lights getting bigger.
- **The model faces +Z, and every asymmetric part is built on that face.**
  `faceToward` uses `atan2(dx, dz)`, which aims the model's own +Z at the
  target, so a face built on -Z makes the whole creature run backwards - which
  is exactly what it used to do. Fix the MONSTER's orientation if this is ever
  wrong again; never the player's moonwalk offset, which is a separate and
  deliberate half-turn.
- Its speed is a FRACTION of the player's own current top speed, not an
  absolute. One at a fixed 30 units a second is terrifying at level 1 and
  irrelevant at level 60; one at 80% of whatever the player can actually do is
  the same pressure for ever. The fraction rises with the stage reached, to a
  ceiling below 1.
- Clamped to the corridor, to the arena's back wall and to `COURSE_END_Z`, so
  it can never walk out of the world at either end. The leash is the backstop
  that makes "permanently stuck" impossible whatever the geometry does.
- **"THE MONSTER IS COMING"** is one reused DOM element driven from the
  monster's own `isChasing` - never from a guess, a timer or a distance
  heuristic of its own. It is written to only when the answer FLIPS, so a
  per-frame call costs a comparison rather than a DOM write.

## Bloxity

- **One module talks to the SDK: `client/src/bloxity/Bloxity.ts`.** Nothing
  else touches `window.Legion`. The game hands it plain callbacks through
  `BloxityHost`; renderer, audio, input and network never import the SDK.
- Every SDK call goes through `guard()`. The script comes from a third-party CDN
  and can be blocked or offline, and the game must boot and play without it.
- **One `auth.onUserChanged` subscription**, inside `Bloxity`, is the auth
  source of truth. The UI fans out from it via `Bloxity.onUserChanged`. The user
  object is never cached - always `getUser()`.
- The slug is `speed-moonwalk-escape`, the same id the deploy workflow publishes
  to; the workflow bakes it in as `VITE_BLOXITY_GAME_ID` so the two cannot differ.
- **The server never trusts a Bloxity id from a client.** The client sends its
  TOKEN on join (and `BloxityIdentity` after a login mid-session); the server
  resolves it with `GET /v1/social/profile`. A claimed id would let anyone
  collect another account's paid-for grants.
- **Bux: SKUs only, never prices.** The catalogue prices a SKU; `SKU_WINS` in
  `server/src/bloxity/BuxGrants.ts` is the game's half - what it hands over.
- **The webhook is the ONLY way a purchase becomes Wins.** The client never
  grants on `requestPurchase` success; it waits for replicated state. The webhook
  records to a queue that is on disk BEFORE it answers 2xx, dedupes by
  `transactionId`, answers 2xx for an unknown SKU (a refund would lose a real
  purchase), and REFUSES everything if `BLOXITY_WEBHOOK_SECRET` is unset unless
  `BLOXITY_WEBHOOK_ALLOW_UNSIGNED=1` - otherwise it would grant Wins to anyone
  who found the URL. Grants are applied by the room through `wallet.add`.
- **A player is shown by their BLOXITY DISPLAY NAME, and by nothing else.**
  Over their character, on the three boards, in the friends list - one name,
  the one they chose on bloxity.io, spelled their way. There is no second
  identity system and there must never be one: this game used to derive a
  handle (`@SwiftGallop_2F91`) from the browser-stored id, and that is exactly
  the thing that is gone. The ids it kept - the browser id for persistence, the
  session id for networking, the Bloxity account id for Bux - all still exist
  and none of them is ever DRAWN. Someone with no Bloxity identity is
  `GUEST_NAME`, which is deliberately not unique and deliberately not invented.
- **The name is what the PORTAL says, sent by the client.** `SetIdentity`
  carries a display name and a portrait; the server sanitises both
  (`sanitiseDisplayName`, `sanitisePfpUrl`) and replicates them, and that is
  the only path either field is written by. Requiring a server-VERIFIED name
  was tried and is what shipped every signed-in player as a guest: there is no
  server-to-server route that answers "who owns this socket", so insisting on
  one meant nobody ever got their name. It is acceptable for the same reason a
  look is - a name decides nothing, it chooses text on a sign. The token is
  still verified server-side and still governs the one thing worth money: who
  a Bux grant belongs to.
- `displayName` is empty for a guest and for anyone signed out, and every
  display falls back to `GUEST_NAME` itself rather than the server inventing a
  name. The SDK's random guest nickname is NOT an identity - it changes when
  the browser is cleared - so `identityFromLegion` treats a guest as signed out
  for the name while keeping their portrait, which is really theirs.
- The boards are keyed by the player ID and shown by the name. Those are two
  jobs: display names are NOT unique - two people really can both be "Chicken
  877" - so keying on one would silently merge their totals.
- **Cosmetics are replicated: everyone is dressed, not just the local player.**
  A look travels as `AvatarLook` (`shared/src/config/avatar.ts`) - nine slots,
  seven proportions, and the `bloxity` flag - and `RemotePlayer` owns a
  `BloxityAvatar` of its own, so the character moonwalking past is wearing what
  its owner actually chose. ONE construction path for local and remote alike:
  two would be how a player ends up looking different on their own screen to
  how they look on everybody else's.
- **A missing asset falls back for that ONE thing.** A part the catalogue
  does not know leaves that slot's default mesh; a hat with a mesh and no
  texture (three of the catalogue's 243 hats) is worn plain rather than not at
  all; a body that cannot be fetched leaves the bundled character. Nothing
  about one missing item may replace a whole avatar.
- Body PARTS carry no texture of their own - checked across all 600 catalogue
  items - because the skin is ONE atlas covering the whole body. One material
  per body is therefore right, and a per-part material would be a second answer
  to a question that has one.
- **NOTHING builds an asset URL out of an id.** `describeItem` reads the item's
  own `assetPaths` from Bloxity's public catalogue and they are used verbatim;
  an item the catalogue does not know is simply not worn, and only that slot
  falls back. The id-pattern version of `bloxityAssets.ts` was right for most
  items and silently wrong for the rest, and a 404 for a part is an avatar
  missing an arm. Arms and legs are ONE item carrying `meshL` and `meshR`, not
  two ids with a `_L`/`_R` suffix.
- **A hat may force the head** (`forceHeadId`, `'-1'` meaning the stock one).
  Bloxity's customiser applies it on equip and its renderer applies it again;
  so does `BloxityAvatar.forceHead`, because a look reaching this game from
  replicated state has not been through the customiser. A custom head left
  under a helmet modelled around the stock one is the "distorted avatar" bug.
- **The look is the ONE message whose contents the server replicates rather
  than decides**, and that is safe for exactly one reason: it is pure
  presentation with nothing to win by lying about. The server cannot ask
  Bloxity what somebody else's character wears, so it takes the sender's word,
  LAUNDERS it (`sanitiseAvatarLook`: ids are about to become CDN URLs on
  fifteen other machines, proportions are about to become scales) and passes it
  on. Nothing in a look can reach progression.
- **THE DEFAULT AVATAR IS BLOXITY'S, not this game's.** A character wears
  Bloxity's `player.glb` whenever Bloxity could describe its player at all -
  `AvatarLook.bloxity` - and that is NOT the same question as "is anything
  equipped". A player who has never opened the customiser still has a Bloxity
  default avatar: that body, wearing `skins/0.png`. Rendering the bundled
  `player.fbx` for them would be showing them somebody else. The bundled body
  is the fallback for one case only - the SDK blocked, offline or absent, or
  its base model unreachable - which is what `bloxityBodyFactory.build`
  returning null means.
- The Bloxity body is applied AFTER the bundled one exists, never before: the
  character is built from `player.fbx`, then `BloxityAvatar` replaces the model
  inside it. A look that arrives before the character does waits in
  `Game.pendingLook`; without that, a fast avatar would dress a character that
  did not exist yet and the bundled texture would win for the whole session.
- `player.glb` carries the same twelve bone names, so `PlayerCharacter.setModel`
  rebinds `PlayerRig` and the moonwalk drives it unchanged. The swap happens
  INSIDE `visual`, under the `facing` half-turn, so the moonwalk offset is
  untouched.
- **Accessories are sized in MODEL space, never world space.** A hat is a
  child of a bone and already inherits the body's scale and every proportion
  above it, so its local scale is the one it was authored at: 1 on Bloxity's
  body (the rig these items are made for, hat lifted 0.8 up the head bone) and
  the tuned figures on the bundled FBX. Dividing by the anchor's WORLD scale -
  which this did once - cancels that inheritance and pins the hat to a fixed
  world size, so a small avatar wears a giant hat.
- **Height is applied ONCE, uniformly, on top of the model's own `baseScale`.**
  The body is fitted to this game in exactly one place
  (`BloxityBodyFactory.loadPrototype`) and the height multiplier goes on top of
  it; scaling the root and the parts both is a double scaling, and scaling Y
  alone is a stretched character rather than a tall one.
- **Proportions are TEMPERED, not obeyed literally** (`temperProportion` in
  `shared/src/config/avatar.ts`). Bloxity's sliders span sizes a viewer can
  show and a course cannot be run at - `height` alone runs 0.5 to 1.6 - so each
  deviation from 1 is scaled by an influence and clamped. Every avatar keeps
  its own build and the ORDER is preserved (a taller avatar is still taller);
  nobody ends up microscopic, gigantic, or - through a zero, a NaN or a missing
  field - scaled to nothing. `verify:bloxity` asserts all of that.
- Bone proportions are applied relative to each bone's REST scale/position, so
  the two rigs' different units never need a per-body constant, and never as
  rotations (`PlayerRig` owns rotations).

## Rewards, stages and the finish line

- **Crossing a finish banner pays, and there is no pad to find.** The banner is
  a transparent sheet spanning the WHOLE corridor with the reward printed
  across it. What actually pays is `hasCrossedFinish`, a CROSSING test on the
  player's Z.
- **It is a crossing test rather than a volume test, and that is not a
  detail.** A late-game player covers hundreds of units a second, so a trigger
  box of any sane thickness would be stepped clean over by a single frame - the
  reward would simply stop being paid to the fastest players, which is
  precisely backwards.
- **There is no teleport behind a finish line.** Crossing it leaves the player
  running into the next stage, which is what makes the ten stages one run
  rather than ten errands.
- Because nobody is moved away from the line, "already paid" cannot be enforced
  by distance. `player.stageProgress` enforces it: the ONLY claimable stage is
  `stageProgress + 1`, and it resets on every placement at the arena. That one
  comparison is simultaneously the anti-double-pay rule, the anti-skip rule and
  the reason a player sprinting through two banners in one tick gets two
  separate awards in the right order.
- Stage rewards are **1, 5, 40, 100, 450, 2,500, 15,000, 75,000, 250,000,
  1,000,000**, exactly as specified. They live in ONE table, `STAGE_REWARDS`,
  and `verify-course` asserts every figure and that the list is strictly
  increasing - a later stage worth fewer Wins than an earlier one would make
  the whole ladder something to farm backwards.
- **Death sends the player to the arena, and only the arena.** `placeAt` takes
  no position for exactly that reason: a placement that could land somewhere
  else is a checkpoint system waiting to be reintroduced. Only a finish line
  moves anybody forward, and it does it by not teleporting them at all.
- **A death with NO SERVER is placed by the client** (`Game.placeOffline`), at
  the same `SPAWN_POSITION` the server would have used. "The server decides"
  has no answer when there is no server, and this game deliberately keeps
  rendering and moving with none - so without this the first death ENDED the
  session: the fall-over finished, the placement request went into a closed
  socket, and the player sat where they died for ever. That is a real state -
  a crashed server, a dead deployment, another game holding this one's port -
  and it is exactly what it looked like. Nothing is granted offline, so there
  is nothing there to cheat.
- **A dropped room is rejoined** (`NetworkClient.rejoin`), with the same
  backoff and the same join options the first join used - the stored player id,
  the portal identity and the look all travel with it, so a restarted server
  restores the whole session rather than half of it. A deliberate
  `disconnect()` does not come back.

## Progression

- **Speed** is the currency. Players farm it by moonwalking: distance the
  SERVER observes, plus a bonus each time they leave the ground.
- Level follows from lifetime Speed through `resolveLevel`, and level drives
  **actual movement speed**. Farming Speed is what physically opens the later
  stages.
- **Speed upgrades are floor TILES, not equipment.** No boots, no pets, no
  animals, no visible attachment of any kind. A tile is bought by gliding onto
  it while holding enough Wins, the price is deducted, and nothing appears on
  the character afterwards. That absence is the design: this character wears one
  outfit, and a rack of gear hanging off him would fight the whole look.
- Buying is a DELIBERATE ACT. Reaching the price alone does nothing. Wins are
  SPENT, and the highest tier OWNED is always equipped, so a purchase can never
  downgrade anyone.
- **Wins move in exactly one place**: `Wallet`. Two things want to move them -
  finishing a stage and buying a tile - and they must not become two ways to
  take payment.
- **Speed is granted in exactly one place**: `SpeedService`, derived from
  movement the server observes and capped at a plausible step so a teleport
  pays nothing. The cap is derived from the player's OWN authoritative run
  speed, so validation and movement cannot disagree.
- **Movement speed has exactly one EVALUATOR**: `resolveMovementProfile` in
  `shared/src/config/movement.ts`. The server evaluates it and replicates the
  multiplier; the client multiplies its base speeds by that and never derives
  its own. A new modifier is a factor fed through it, never a second formula.
- Rebirth is at level 25, then every 25 levels for ever. `REBIRTH_TIERS` is the
  authored head and `EXTENSION` continues the pattern, so a third rebirth is one
  row in a table. The level CAP is not a constant - it is whatever the next
  rebirth requires, so reaching the cap and unlocking a rebirth are the same
  moment. A cap is a gate, never a dead end.
- A rebirth resets the level curve - which means clearing `totalSpeed`, because
  level FOLLOWS from it - and deliberately keeps Wins and bought tiles.
- **All three treadmills pay EXACTLY the same**, and there is one constant -
  `TREADMILL_MULTIPLIER` - that says so. `TreadmillTier` deliberately has no
  multiplier field at all, so there is no way for one belt to drift into being
  worth more than another; the three differ in name and neon only, which is how
  a player says "meet me at the blue one" across a dark arena. The bay is
  somewhere to farm while chatting, not a ladder, so there is nothing to choose
  between them and no reason to queue. `verify:services` proves the parity
  end-to-end through `SpeedService.credit` rather than trusting the constant.
- A treadmill is not a pinned state and needs no button. `treadmillAt` derives
  it from POSITION every step on both sides: gliding on starts it, gliding off
  stops it, and there is no treadmill message for a client to forge.
- A runner earns from the BELT: distance is `beltSpeed x step` instead of a
  position delta, fed through the same per-stride formula. There is no second
  progression path.
- Only the DERIVING facts are persisted (Speed, Wins, owned tiles, rebirths,
  best stage). Level, movement speed and the equipped tier are recomputed on
  load through the same formulas a live session uses, so a tuning change
  reaches returning players.

## Movement and the world

- **The MOUSE aims the camera; the camera defines forward.** WASD moves
  relative to it and never rotates it.
- The camera's RIGHT is `(-cos yaw, sin yaw)`. At yaw 0 that is world **-X**.
- **The player's LEFT is +X and their RIGHT is -X.** Every "left" and "right"
  in the world layout means the PLAYER's. The treadmills are on the left at
  +X and the upgrade tiles on the right at -X, as specified; `verify-course`
  asserts both, because authoring either from the reading of the number rather
  than from that cross product is how a feature ends up on the wrong side of
  the screen.
- **`LANDING_TOLERANCE` and `MOVEMENT.stepHeight` are the same number, and must
  stay that way.** `surfaceYAt` reports the highest surface within a step of the
  feet and `canLandOn` decides whether the player may settle onto it; when the
  two disagree, every ledge between them - the training deck, the upgrade
  tiles, the carpet runner - is reported as the floor and then refused as a
  landing, and the player falls through the solid ground underneath.
- A feature the player is meant to glide over must be UNDER `stepHeight`.
- **There is no speed cap, and there must not be one.** `stepPlayer`
  SUBDIVIDES its own step until no substep travels further than
  `MOVEMENT.maxSubstepDistance`, so collision is exactly as reliable at 400
  units/second as at 20. Never "fix" a tunnelling bug by capping speed.
- **Velocity determines jump distance.** Faster approach = longer jump. Jump
  velocity scales far more gently than travel speed.
- Horizontal collision is **axis-separated**: move X, resolve, move Z, resolve,
  then move Y.
- The course is **generated, not authored**, from builders in
  `shared/src/config/course.ts`. `COURSE_SOLIDS` and `COURSE_HAZARDS` are read
  by BOTH the renderer and the collision model, so a platform the client draws
  but the server does not know about is structurally impossible.
- A stage's LENGTH is not a constant: it is whatever its builder came to.
  Stages are positioned from the **build cursor**, never from a nominal length.
- The first stage begins exactly at `lobbyEndZ`. Any gap there is an unmarked
  hole across the full width of the course.
- **Every hazard is a DISCO BALL, and every disco ball kills.** Four motions -
  `sweeper`, `roller`, `spinner`, `faller` - one object, one thing to learn. A
  colour is a promise and a silhouette is a promise; in this world a mirror
  ball promises "this will end your run".
- Hazards are a **pure function of time** (`hazardPositionAt`). The server
  evaluates them against its own clock to decide a death and the client against
  its estimate of the same to draw them. There is no hazard state on the wire.
- The client ADVANCES its own copy of that clock between patches and re-bases it
  whenever a fresher `elapsed` arrives. Freezing it makes every ball stutter at
  the patch rate.
- The corridor is **60 units wide** (`COURSE.halfWidth` 30), and every obstacle
  offset is written as a FRACTION of it through `lane()`.
- Places that open out are declared in **`WIDE_AREAS`**, and there is exactly
  one list. The floor, `clampToBounds`, `corridorHalfWidthAt` and the wall run
  all read it, so a span the renderer draws wide and the collision keeps narrow
  cannot exist.
- The walls are **scenery**. What holds the player in is
  `WorldCollision.clampToBounds`, applied after the substep has already
  integrated, so no speed can tunnel it.
- Solids are bucketed by Z. At late-game speeds one frame is dozens of
  substeps, and a linear scan per substep would be the whole frame budget.
- `texturedBox` scales UVs to WORLD size, so one texture tiles across every
  solid at the same physical scale.
- World signs are **single-sided**, and which way they face is a real decision.
  A finish banner's reward label faces BACK down the course at the player
  approaching it; its "cleared" label faces forward, because a moonwalking
  player who has just crossed is looking straight back at it. That is the one
  place in this game where the dance changes what a sign should face.
- **Sign text is sized to FIT**, and a panel must be NARROWER than the pitch of
  the row it sits in. The upgrade labels were authored at 11 units on a 9-unit
  pitch once already, which turned the whole ladder into one unbroken ticker of
  run-together prices.

## Art direction

Permanent night. There is no daylight state and no day palette - a "night mode"
that can be turned off is two art directions to keep in step.

- Red carpet, dark neon city, disco balls, VIP arch, velvet ropes, spotlights,
  overhead trusses, tiled plaza. Michael-Jackson-and-red-carpet, not horror.
- **Not one image file is used for the WORLD.** Every world texture - the woven
  carpet, the tiled plaza, brushed chrome, the dance glass, the treadmill
  belts, the building facades and the night sky - is drawn on a canvas at
  runtime by `WorldTextures`. Do not add an image for something `WorldTextures`
  could draw.
- **The lighting rig is built for night, not turned down from a day rig.**
  There is no sun. A very low hemisphere fill, a dim ambient, one shadow-casting
  key that follows the player, and a warm point light the player CARRIES.
  Everything else that glows does so because its material is emissive - neon,
  disco balls, dance floor, signs. Emissive costs nothing per light, and a
  scene with fifty real lights does not run on a phone.
- The city is generated from a hash of the block index, never `Math.random`:
  two players standing beside each other must see the same skyline.
- The whole skyline is TWO merged meshes plus one per neon tint. It neither
  casts nor receives shadows - it is a backdrop.

## Assets

- `assets/player/player.fbx` is the **canonical** player asset.
  `assets/player/base_rig.fbx` is **byte-identical** to it and is pruned from
  the build by `vite.config.ts`. Do not load both.
- **Never modify the supplied FBX files.**
- The FBX embeds **dead absolute texture paths** (`X:\legion\poxel\...`).
  Texture resolution is handled explicitly in `client/src/config/assets.ts` and
  `client/src/player/PlayerModelLoader.ts`.
- The FBX contains **no animation clips** - it is a bind-pose rig with 12 bones
  (`Rig1 Spine1 Spine2 Neck1 ArmL1 ArmL2 ArmR1 ArmR2 LegR1 LegR2 LegL1 LegL2`).
  All animation is **procedural**. Do not add an animation library or a clip
  pack.
- The FBX declares **two skin deformers**, so FBXLoader creates two Bone objects
  per name. `PlayerRig` binds the **first** bone of each name (traversal visits
  a parent before its child), which drives both meshes. Binding the terminals
  animates the arms only.
- **Every static file lives in the repo-level `assets/`**, which Vite publishes
  as the web ROOT (`publicDir` points at it). So `assets/ui/shoe.png` is served
  at `/ui/shoe.png`. There is no `client/public/`.
- The only images in the build are the rider FBX, its texture, and the three
  HUD icons in `assets/ui/` (`trophy`, `rebirth`, `shoe`). Those are SUPPLIED
  ART: never regenerate one procedurally, and never set both dimensions in CSS
  - drive one and leave the other automatic so the real aspect ratio survives.
- **The supplied audio in `assets/audio/` is the real audio.** `background.mp3`
  is the music, `jump.mp3` and `death.mp3` are the two cues that carry the most
  weight. Everything else - the landing, the scuff, the win and level stings -
  stays synthesised, because oscillators cost bytes measured in hundreds and
  those sounds do not need a file.
- The music is STREAMED through an `<audio>` element, never decoded:
  `decodeAudioData` would hold a four-hundred-kilobyte mp3 as tens of megabytes
  of uncompressed samples for something only ever played end to end. Muting
  PAUSES it rather than merely silencing it - a muted stream still decodes, and
  on a phone that is battery spent on nothing.
- Jump and death ARE decoded into buffers, because they are short and have to
  land on the frame they are asked for; an element's start latency is audible
  on a jump cue. Both keep their synthesised version as a FALLBACK, so the
  window before the file decodes - and the case where it never does - is never
  silence.
- `walk.mp3` is supplied but unused: the moonwalk's scuff fires several times a
  second and has to track the cadence clamp, which a fixed-length file cannot.
  It is pruned from the build by `vite.config.ts` alongside `base_rig.fbx`.

## Architecture rules

- **No god files.** Logic belongs in its module: `net`, `player`, `input`,
  `rendering`, `camera`, `animation`, `guard`, `world`, `progression`, `config`.
- Gameplay tuning is **data-driven** and lives in `shared/src/config/*`. Numbers
  the client and server must agree on go in `shared/`, never duplicated.
- The guard's tuning lives in `client/src/guard/`, NOT in `shared/`, and that
  placement is the point: a guard is simulated by one machine for one player,
  so there is no second party to agree with - and a number in `shared/`
  announces an agreement that does not exist.
- `shared/` must not import `three`, `colyseus`, or anything DOM.
- The client touches `colyseus.js` only inside `client/src/net/`.
- Animators write **only** to bones and to their own visual nodes. They must
  never move the physics root, change velocity, or decide a gameplay outcome.
- One node, one owner. `root` is the physics transform, `facing` is the
  moonwalk, `tipPivot` is the death roll, `visual` carries the bob and the
  scale effects. Folding two meanings into one node is how a respawn pop ends
  up undoing a bind-pose correction.
- **Deaths by hazard are decided on the server tick**, from the position it
  simulated and the clock it owns. There is deliberately no hazard message.
- Persistence sits behind `PersistenceAdapter`. `createPersistence` is the ONLY
  place naming a concrete adapter.

## UI

The HUD is: **Wins** upper centre, **Rebirth**, **Speed** and **Sound** down the
left rail, **Speed** and **Level** along the bottom, and the monster warning
across the upper middle. Speed-gain popups float over the centre.

- `hudStyles.ts` owns the one stylesheet and the icons, so the rail, the win
  counter and both panels cannot drift apart visually. Every class is `mwe-`.
- Everything shown is replicated server state. The HUD never awards, predicts or
  derives progress; a rail tile is "ready" when the server would accept the
  request behind it.
- The **upgrade panel is READ ONLY**. Nothing is bought in it - buying happens
  by standing on a tile, which is the whole point of doing it with tiles. A Buy
  button in there would quietly make the tiles decorative. What it is for is the
  question a tile cannot answer from across the room: what the whole ladder is
  and what the next rung costs.
- `Panel` counts open modals and the input layer polls that count to suppress
  movement. A COUNT rather than a boolean, so two panels closing out of order
  cannot leave the game permanently suppressed.
- **Speed-gain popups** are driven by an ACCUMULATOR over the replicated total,
  never by raw patches, and the pool is a HARD CEILING allocated once.
- **Names are drawn by `Nameplates`, one chip per player, local included.**
  DOM over the canvas, not geometry in it, and that is what keeps a plate
  readable: a plate in the world scales with the avatar under it, so Bloxity's
  smallest height would carry a name nobody could read. These are projected
  from the player's NECK JOINT after the render - so the plate sits where that
  player's own head actually is - and sized by camera distance alone, so every
  plate is the same size on screen whatever the body beneath it is built like.
  One plate per session id, removed the frame its player stops being drawn, so
  a rejoin or a body swap cannot leave a second one behind.
- Plates show the REPLICATED name, the local player's included, so the name
  over your own head cannot disagree with the one everybody else sees.
- **There is no Log out button in the Bloxity panel.** Signing out is the
  portal's to offer: doing it from in here costs a player their name, their
  avatar and any purchase in flight, inside a game they meant to close a panel
  in. Nothing about authentication changed - the SDK still reports a portal
  logout through the one `onUserChanged` - there is simply no button that calls
  it.
- **Every menu must be reachable with a mouse.** Every panel opens from a rail
  tile AND has a key (R, U, M, Escape). A key PRESSES THE BUTTON rather than
  doing the same thing as the button, so the two paths cannot drift.

## Verification

`npm run verify` runs four suites, and they are the reason the world can be
generated with confidence:

- `verify:course` - stages abut with no gaps, every finish line is inside its
  stage with solid carpet on BOTH sides, the reward table matches the spec
  exactly and is strictly increasing, the treadmills are on the left and the
  tiles on the right, no hazard is anchored outside its corridor.
- `verify:progression` - the level curve is monotonic and `resolveLevel` agrees
  with `totalSpeedToReach` at every boundary, rebirth is at 25/50/75/100 and
  continues for ever, the cap and the requirement are the same moment, the
  upgrade ladder never lets a purchase downgrade anybody, and the level term
  tapers instead of running away.
- `verify:bloxity` - the Bux webhook: unsigned and wrongly-signed deliveries are
  refused, a server with no secret refuses, retries pay once, unknown SKUs are
  2xx with no grant, and the queue survives a restart. Also everything an
  identity decides: a look off the wire is clamped and laundered (a traversal
  or a `javascript:` id never becomes a CDN URL); every slider value a player
  or a hostile client can send lands inside the playable size band, in order,
  and never at zero; a name is bounded and stripped of markup and
  bidirectional overrides while a non-Latin one survives intact; a portrait
  from anywhere but Bloxity's own origin is refused; and a board row shows a
  Bloxity display name - never an id, never a generated handle - with two
  players sharing a name still two rows.
- `verify:services` - the server's own decisions, exercised without a server:
  a stage short of the line pays nothing, crossing pays once, STANDING PAST THE
  LINE DOES NOT PAY TWICE, stages cannot be claimed out of order, a new run
  re-opens the ladder, a tile cannot be bought from across the room or without
  the Wins, the price is deducted exactly once, and a big award saturates
  rather than wrapping.

`verify:services` also proves the three treadmills pay identically, by running
a real credit for each belt and comparing what lands in the total.

Also `npm run verify:assets` (every runtime asset exists, the three audio files
included - they are requested by PATH at runtime, which is exactly the kind of
reference a bundler cannot check) and `npm run size:client` (the 12 MB budget,
currently ~1.51 MB).

## Deployment

- **Two hosts, and the split is not negotiable.** Netlify serves static files
  and cannot run a WebSocket server, so the client is deployed there and the
  Colyseus server runs as a long-lived Node process somewhere else.
- **`VITE_SERVER_URL` is the ONLY client-side server configuration**, and it is
  baked in at build time. An `http(s)://` URL is converted to `ws(s)://` rather
  than rejected, because that is the form every host's dashboard hands out.
- The URL fallback guesses ONLY on localhost. A deployed origin with nothing
  configured gets an empty endpoint and says so, because `wss://the-site:2569`
  is an address that cannot ever answer and a client pointed at one spends
  thirty seconds timing out instead of reporting the real fault.
