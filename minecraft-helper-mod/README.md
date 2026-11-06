# Helper Buddies

A light Fabric mod for **Minecraft 1.20.1**, built to drop into the **Prominence II: Hasturian Era**
modpack, though it works with any Fabric 1.20.1 setup that has Fabric API.

Every player on the world can summon their own little helper. **It looks like the player who summoned
it** (same skin, with "Jordan's Helper" over its head), **fights for them**, and collects whatever they
ask for. It works out the best way to get it:

- It searches nearby for the closest blocks that give you that material. It knows about deepslate and
  modded variants. If there's none nearby, it keeps searching further out, loading chunks a few at a time
  until it finds some (up to 1,000 blocks away). It keeps its own area loaded while it works.
- If you ask for an ore that doesn't generate in your dimension (diamonds in the Nether, quartz in the
  Overworld), it tells you which dimension to go to.
- It walks there if it can, through caves or over land. Only if there's no way in does it dig.
- To get deep underground it digs **its own mine**: a spiral staircase near your base, 3 blocks tall so you
  can use it too. It reuses the same mine every time and digs it deeper as needed. Every 4 blocks down it
  stops at a landing and branch-mines like a player would: straight 2-tall tunnels out from the stairs
  (16 blocks, 32 at the bottom), only in directions that have ore. It takes every ore it can reach from
  the tunnel and follows veins, so you get a tidy mine instead of lots of random holes. When it's done it climbs back
  up the stairs and walks back to you.
- **Choose where it mines:** `/helper mine marker` gives you a **Helper Mine Marker** (a lodestone). Place it on
  open ground and the helper digs its staircase right beside it from then on, however far away you are (same
  dimension). Break the marker to let it choose again.
- For short distances it digs a tunnel, bridges gaps or pillars up. It plugs lava and water with cobblestone
  instead of giving up.
- It picks the best tool from its inventory for every block: the fastest one, fortune for ores, never
  silk touch unless that's what you want.
- It mines out the whole vein or tree before moving on.
- It brings everything back to you when it's done or its pockets are full.
- Every delivery is a little party: it does a spin-and-hop dance and, when it's out in the open, sets
  off two fireworks (they burst high up, and it skips them under a roof so nobody gets hurt).
- Mobs it kills count as your kills, so they drop XP (and loot only players get, like blaze rods).
- It picks up the XP from the ores it mines and the mobs it fights, and gives it to you when it brings
  your items back (or as soon as it's next to you). `/helper status` shows how much it's holding.

## Commands

| Command | What it does |
| --- | --- |
| `/helper summon` | Summon your helper next to you |
| `/helper collect <material> [amount]` | Go get something, e.g. `/helper collect iron 32` (default amount 64) |
| `/helper deliver` | Bring me what you have right now, then keep going |
| `/helper stop` | Stop the current job and follow me |
| `/helper status` | What are you doing, and what are you carrying? |
| `/helper guard on` / `off` | Turn fighting on or off (on by default) |
| `/helper collect spawner` | Dig up a monster spawner. It keeps its mob, so you can place it anywhere |
| `/helper harvester` | Turn the hopper in your hand into a **Monster Harvester** |
| `/helper storage` | Turn the barrel in your hand into a **Helper Storage** (no size limit, see below) |
| `/helper storage find <name>` | Search your storage, e.g. `/helper storage find iron` |
| `/helper boss` | On an Ad Astra planet: where is this planet's boss arena? |
| `/helper fish [amount]` | Go fishing at the nearest water (within 24 blocks). Give it a fishing rod first; Lure makes it faster and Luck of the Sea luckier. It brings you the catch and the fishing XP |
| `/helper farm [radius]` | Look after the crops around you (16 blocks unless you say): harvest ripe wheat, carrots, potatoes, beetroot, nether wart and modded crops, plant them again, and bring you the harvest. `/helper stop` ends it |
| `/helper update` | Says whether a newer version of the mod has been downloaded (see "Updates" below) |
| `/helper golf` | Fairway golf: where's the club, how to play. `/helper golf shop` opens the Pro Shop, `/helper golf ball` picks your ball up |
| `/helper blackhole` | How to make a Singularity, and the Black Hole's bosses. `/helper blackhole leave` gets you out |
| `/helper town` | Where's Reef Town, the undersea town on the Bikini Bottom planet? |
| `/helper ride` | Ride your helper (or right-click it holding a saddle). Steer with your movement keys, jump with space, sprint to go faster, sneak to get off. It swims at full speed in water, and if it looks like a flying mob (`/helper look phantom`, bat, parrot, ghast, allay, bee...) it flies where you look |
| `/helper look <mob>` | Make your helper look like any mob, e.g. `/helper look creeper` or `/helper look iron golem`. Modded mobs work too (`/helper look somemod:thing`). Press Tab to see them all |
| `/helper look me` | Make your helper look like you again |
| `/helper size small` / `normal` / `big` | Make your helper shorter or taller, or give a number from 0.25 to 4 (1 is normal). With the [Pehkui](https://modrinth.com/mod/pehkui) mod on the server it truly resizes, whatever it looks like. Without Pehkui, small makes it the baby version of its mob look (zombie, villager, fox, cow...) |
| `/helper dismiss` | Send your helper away. It keeps your items for next time |

**Right-click your helper** to open its inventory. Put tools (pickaxe, axe, shovel), a weapon (sword or
axe) and armor in there, and take out anything you like. Helpers won't use a tool that's about to break, so
you won't lose your gear.

### It tells you when something's wrong

- A tool or weapon is about to break (it stops using it so you never lose it).
- It can't mine something because its tools are worn out, or it needs a better one.
- Its pockets are full (it brings everything back and keeps going), or its inventory is so full of gear
  that it has no room at all.
- Your inventory is full when it delivers (the rest is dropped at your feet).

### Spawners and the Monster Harvester

1. `/helper collect spawner`: your helper finds a dungeon spawner, digs it out and brings it back. The item
   is named after its mob ("Zombie Spawner"), and placing it gives you that spawner back.
2. Hold a hopper and run `/helper harvester` to turn it into a Monster Harvester.
3. Place the harvester near the spawner (monsters within 4 blocks of it get harvested), with a chest
   under it.
4. The harvester kills monsters around it. Their loot goes into the hopper and down into the chest, and their
   XP is stored in the harvester. **Sneak + right-click it** (empty hand) to collect the XP and level up.
   If the harvester is broken, the stored XP drops as orbs so nothing is lost.

### Combat

With guard on, your helper:

- fights monsters that go after you or after the helper itself,
- jumps in on whatever you attack (hit a mob and it helps you finish it off),
- clears out always-hostile mobs (zombies, skeletons, spiders, ...) that get close to you.

It uses the best weapon in its inventory (damage, attack speed, Sharpness, Smite, Fire Aspect and
Knockback all count) and wears the best armor it has. It never attacks players, other helpers or pets,
and leaves creepers alone unless you hit one first. While it's out collecting it only defends itself, then
goes back to work.

### Material examples

`iron`, `gold`, `copper`, `coal`, `diamond`, `emerald`, `lapis`, `redstone`, `quartz`, `netherite`
(ancient debris), `wood` (any logs), `oak_log`, `stone`, `cobblestone`, `dirt`, `sand`, `gravel`, `flint`,
`clay_ball`, `obsidian`, `amethyst_shard`... Modded items work too, e.g. `raw_tin` or `create:zinc_ore`.
Block tags work with `#`, e.g. `#minecraft:logs`.

### Helper Storage

1. Hold a barrel and run `/helper storage` (or rename a barrel to "Helper Storage" in an anvil). Place it.
2. Right-click it. It holds **as much as you want** of everything. Every Helper Storage you place opens the
   same storage (your own, like an ender chest), so put one in every base. Breaking one never loses anything.
3. **Putting things in:** click an item onto the storage area, shift-click items in your inventory, or press
   the chest button to put in everything from your inventory (your hotbar and armor stay put).
4. **Taking things out:** click to take a stack, right-click for half, shift-click to send a stack to your
   inventory, or press a number key to drop it into that hotbar slot.
5. **Organizing:** items are always sorted (by name, amount or mod; click the hopper to switch) and shown in
   pages. The tab button shows just blocks, tools and armor, food or other items. Click the spyglass to
   search: type in the box, then click the result (or press Escape) to see only what matches. Right-click
   the spyglass to clear the search. `/helper storage find <name>` works too.
6. **Crafting grid:** click the crafting table for a 3x3 crafting grid with your stored items beside it (the
   search works here too). Pick items up from storage and put them in the grid like a crafting table. Click
   the result to make one, or shift-click to keep making them: the grid tops itself up from storage, and the
   results go into your inventory. Leftovers like empty buckets go back into storage, and anything left in the
   grid goes back into storage when you close it.

It's drawn as a normal chest screen, so nobody else has to install anything. Each player has their own storage.

## More real planets (needs Ad Astra)

If Ad Astra is installed (it is in Prominence II), five more real places and an ocean planet show up on the rocket's planet
list, each with its own orbit for space stations:

| Planet | Rocket tier | Gravity | Ground | Ores and extras | In the sky |
| --- | --- | --- | --- | --- | --- |
| Europa (Jupiter) | 4 | 1.3 m/s² | Snow over packed ice | Diamond, lapis, ice shards, brown "crack" streaks, ice spikes | Jupiter |
| Io (Jupiter) | 4 | 1.8 m/s² | Yellow sulfur over blackstone | Gold, calorite, gilded blackstone, magma, lava lakes | A huge Jupiter |
| Titan (Saturn) | 4 | 1.35 m/s² | Red dunes over tuff, thick orange haze | Lots of coal, ostrum, diamond | Saturn through the haze |
| Ceres (asteroid belt) | 3 | 0.28 m/s² | Gravel over deepslate | Iron, desh, ice shards, bright salt patches | Just stars |
| Pluto | 4 | 0.62 m/s² | Snow over calcite, red patches | Emerald, diamond, calorite | Charon, and a tiny Sun |
| Bikini Bottom | 3 | 9.8 m/s² (like Earth) | A warm ocean with a sand floor and a few islands | Coral reefs, kelp, sea pickles, gold, copper, prismarine; tropical fish, turtles and dolphins | A blue-green planet |
| Fairway | 1 | 9.8 m/s² (like Earth) | Rolling grassland with flowers and a few trees | Normal ores; sheep, rabbits and cows, no monsters | A green planet |

The real planets have no air and are very cold, so bring a space suit and oxygen. Bikini Bottom is the
exception: it has air and is warm, but it's nearly all ocean, so bring water breathing or a conduit to
explore the reefs. Its boss is the King of the Deep, and it drops a heart of the sea, nautilus shells and
a trident. Without Ad Astra the mod
leaves the planets off. On a dedicated server the planets work for everyone, but players without this
mod see Ad Astra's plain sky there.

### Monsters, bosses and your helper in space

- **Monsters:** each planet has its own monsters roaming the surface, picked to fit it. The Moon has Ad Astra's
  star crawlers and corrupted lunarians, Mars has martian raptors and pygros, Venus and Io have sulfur creepers
  and blazes, Europa and Pluto have strays. Mobs that aren't installed are skipped, and nothing spawns on
  Peaceful.
- **Bosses:** the first time you land on a planet, a boss arena is built on the surface about 40 blocks away,
  and you're told where it is (`/helper boss` tells you again). Stand on the lodestone in the middle to call
  the planet's boss: the Crater King on the Moon, the Red Warlord on Mars, the Sun Knight on Mercury, the
  Sulfur Lord on Venus, the Frost Lord on Glacio, the Ice Colossus on Europa, the Molten Heart on Io, the Ceres
  Sorcerer, the Haze Beast on Titan and the Pluto Executioner. Each one has a boss bar and calls the planet's
  monsters for help at half health. Its reward helps you reach the next planet: desh from the Moon for a
  tier 2 rocket, ostrum from Mars for tier 3, calorite from Mercury, Venus, Europa, Io and Ceres for tier 4,
  plus rocket fuel. You can fight it again one Minecraft day later.
- **Your helper comes too:** while you fly a rocket or lander it waits, then appears next to you when you land
  on the planet. It doesn't need air and doesn't mind the cold or heat. It can dig through planet ground and
  mine planet ores, e.g. `/helper collect desh`, `/helper collect ostrum` or `/helper collect calorite`.

## Talk to your helper

Your helper understands plain chat. Start a message with "helper" (or "buddy"):

- "helper, get 20 iron", "helper mine some coal", "helper find 64 oak"
- "helper go fishing", "helper farm", "helper ride", "helper bring it to me"
- "helper follow me", "helper stop", "helper what are you doing?", "helper how are you?"
- Ending with it works too: "hi helper", "thanks buddy".

On a server everyone sees the conversation: other players get the reply as "[name's Helper] ...". It also
works with chat mods that replace the normal chat.

It also acts on its own:

- It speaks up when night falls, when it starts raining, when you're badly hurt, and when you go somewhere new.
- When you're hungry, it hands you food it's carrying.
- While it follows you, it picks up items lying around nearby.

## Dropper Tycoon

Build a little ore factory and spend what it earns.

1. `/helper tycoon start` gives you a free starter kit (once): a **Tycoon Dropper**, 16 **Conveyors** and a **Collector**.
2. Place the Tycoon Dropper. Every few seconds it drops ore out of its front.
3. Lay **Conveyors** (magenta glazed terracotta) from the dropper. They carry ore the way their arrow points
   (away from you when you place them).
4. End the line on a **Collector** (black glazed terracotta). Ore that reaches it turns into coins for you.
5. Put **Upgraders** in the line to boost ore as it rolls over them, once per block: lime x2, cyan x3, purple x5.
   They carry ore along like conveyors.
6. **Lifters** (yellow glazed terracotta) hop ore up one block, so a line can climb to a second floor.
7. The **Star Upgrader** (red glazed terracotta, x10) is in the shop at tier 3 once you've reborn at least once.

| Command | What it does |
| --- | --- |
| `/helper tycoon` | Your coins, droppers and shop tier |
| `/helper tycoon shop` | Buy conveyors, collectors, upgraders, more droppers, and useful items (food, torches, iron, diamonds, ender pearls, totems...) |
| `/helper tycoon fix` | Look at a Tycoon Dropper that stopped dropping after you moved it, to make it work again |
| `/helper tycoon upgrade` | Look at your Tycoon Dropper: it drops faster and its ore is worth more (up to level 10) |
| `/helper tycoon rebirth` | Pay the price (10,000 coins, then 40k, 90k...) and your droppers go back to level 1, but every coin is worth +50% more for good. Coins above the price are kept, so a rich player can rebirth several times in a row. Add `confirm` to do it |
| `/helper tycoon top` | The five biggest earners on the server |
| `/helper tycoon give <player> <coins>` | For ops and quest rewards: pay a player coins |

**Linked to your progress:** the shop has three tiers. Tier 2 (super upgraders, diamonds, golden apples...)
unlocks when you've been to the Nether, and tier 3 (mega upgraders, netherite, totems) when you've reached the
End. Droppers can go past level 4 at tier 2 and past level 7 at tier 3. To pay coins for FTB quests, add a
command reward to a quest: `/helper tycoon give {p} 500`.

**Coin panel:** your coin total and how many coins per second you're making (averaged over 10 seconds) show
on the right side of the screen, only to you. The "+coins" pop-up in the middle of the screen is gone.
`/helper tycoon sidebar off` hides the panel, `on` brings it back.

**Rich?** The end of the tier 3 shop has big-ticket items: Shulker Box (25k), Mending book (50k), Netherite
Ingot (100k), Elytra (250k), Beacon (500k) and Helper Training (1M, +1 helper level, up to 10).

**Rockets (with Ad Astra):** the shop sells Ad Astra rockets that are ready to fly, each with a full tank of
cryo fuel (3 buckets, enough for 3 launches): Tier 1 (50k), Tier 2 (150k, needs tier 2), Tier 3 (400k) and
Tier 4 (1M, the max rocket, reaches every planet; both need tier 3). It also sells Launch Pads (5k) and 4 cryo
fuel buckets for refills (20k). Place the rocket on a launch pad, get in and press space. The shop now has 6 rows.

**Milestones:** earning 1,000, 10,000, 100,000 and 1,000,000 coins in total gives free parts (conveyors and a
lifter, a new dropper, super upgraders, then mega and star upgraders) and tells the whole server.

You can pick a Tycoon Dropper up and place it somewhere else: it keeps its level. A redstone signal pauses a dropper. Ore that isn't collected within a minute fizzles out, so it can't pile up.

## Torches in the mine

While it mines, the helper lights up dark tunnels and caves with torches so monsters can't spawn in them.
It uses torches you give it. If it has none, it makes four from each coal (or charcoal) and stick it carries.
It only places them underground, where it's dark.

## Reef Town (Bikini Bottom planet)

The first time you reach the sea floor on Bikini Bottom, an undersea town is built about 48 blocks away:

- Four glass dome houses full of air, joined by sandstone paths. Each has a bed, a chest and a work block.
- A diner in the middle with tables and a cook.
- Townsfolk you can trade with: Old Finn (fisherman), Shelly (cartographer), Barnaby (armorer),
  Coral (librarian) and Chef Marlo (butcher). They can breathe underwater if they wander outside.

The doors keep the water out, so you can walk in without a helmet. `/helper town` tells you where it is.

## Fairway Golf Club (Fairway planet)

Fairway is a grassy, peaceful planet (tier 1 rocket, it has air). The first time you land, the Fairway Golf
Club is built about 66 blocks south of you:

- A clubhouse with the Golf Pro. Right-click the Pro (or `/helper golf shop`) to open the Pro Shop.
- Holes 1-3: mini golf lanes with walls and bumpers.
- Holes 4-5: short holes (par 3). Holes 6-7: middle holes (par 4) with sand traps.
- Holes 8-9: long holes (par 5) with sand and water.

On your first visit you get a free Putter and 3 Golf Balls. To play: right-click the ground with a ball to
place it, stand next to it, look where you want it to go and right-click with a club (sneak for half power).
Putter rolls, Wedge chips high, Iron is a mid shot, Driver is a long tee shot. A ball in the water comes back.

Sinking the ball pays tycoon coins: hole in one 5000, eagle 2000, birdie 1000, par 500, bogey 200, anything
else 50. Everyone on the planet sees your score.

The Pro Shop sells clubs (200-1000), balls, a golf cap, a Golf Cart (a fast tame horse, 5000), a Cottage Deed
(20,000) and a Villa Deed (100,000). Right-click the ground with a deed to build the house there.

## The Black Hole (from the Dropper Tycoon)

If 16 or more Tycoon ore pile up in one spot (a dropper dropping into a pit, or conveyors running in a loop
with no Collector), the pile starts spinning in a circle and collapses into a **Singularity**. Right-click
with it to fall into the Black Hole: a dark void with a hub island and four bridges that lead to four boss arenas.
Stand on the lodestone in an arena to call its boss. Each boss gets faster and stronger at half health and
calls minions.

| Boss | Where | Drops |
| --- | --- | --- |
| Ashen Warden, Keeper of Cinders | east bridge | Ashfall Greatsword (skill: Ash Whirl, a burning spin) + 100k coins |
| Duskfang, the Moonless Hunter | west bridge | Duskfang Blade (skill: Moonless Step, a dash that cuts through) + 100k coins |
| The Hollow Colossus | south bridge | Collapse Maul (skill: Collapse, pulls monsters in and slams them up) + 150k coins |
| The Singularity Sovereign (after the other three) | north bridge | Starless Staff (skill: Starless Beam) + Nether Star + 1M coins |

Every boss kill also gives a piece of that boss's **armor set** (netherite, Protection IV), a **Rift Tome**
and a top-level enchanted book. Wear all four pieces of one set for a bonus:

| Set | From | Full-set bonus |
| --- | --- | --- |
| Cinderwarden | Ashen Warden | Fire Resistance and Strength |
| Moonless | Duskfang | Speed II and Night Vision |
| Hollow Bulwark | Hollow Colossus | Resistance and Haste II |
| Event Horizon | Singularity Sovereign | Regeneration, Strength II and Slow Falling |

**Rift Tomes** raise your magic level (up to 10): each level makes weapon skills do 10% more damage with 5%
shorter cooldowns, and gives 5 XP levels for enchanting. **Rift Caches** are the chests with soul lanterns on
the bridges and in the arenas (12 in all). Each one gives every player their own loot every 15 minutes:
enchanted diamond and netherite gear, top-level enchanted books, sometimes a Rift Tome or a set armor piece,
plus diamonds, golden apples, totems and more.

Right-click a weapon to use its skill (it has a cooldown). Bosses can be fought again 5 minutes later.
If you fall off, you're put back on the hub. Right-click the Singularity again (or `/helper blackhole leave`)
to go home. `/helper blackhole` shows which bosses you've beaten.

## Safety on shared worlds

- Helpers only break **natural** blocks: stone, dirt, ores, real trees (logs with natural leaves next to
  them), and so on. They refuse to collect crafted blocks like planks, and they never tunnel through anything
  a player placed (cobblestone, planks, chests, ...).
- Near the surface they also leave alone any block within 2 blocks of something built (doors, glass,
  planks, bricks, beds, chests...), so house floors and stone walls are safe even when they're made of
  dirt or stone. Deep underground they won't dig right next to chests, beds or furnaces.
- They don't pillar up, bridge or plug holes within 3 blocks of anything built either.
- When a wall it mustn't break is in the way, the helper **phases through it** to the open space on the other side
  (up to 5 blocks) instead. If it's stuck behind a wall while following you for 3 seconds, it pops out next to you.
- A new mine is started on open, natural ground at least 5 blocks from anything built, never under a
  roof. If an old mine runs into a build, the helper stops and starts a fresh mine elsewhere next time.
- They avoid lava, won't drop down big holes, and plug the top of any mineshaft they dig.
- Helpers can't be hurt and never despawn. Their inventory is saved with the world, so nothing is lost if
  one gets unloaded.
- Only the owner can open a helper's inventory.
- Helpers do **not** check land-claim mods, so ask players to keep their helpers away from other people's
  bases.

## Installing (CurseForge / Prominence II)

1. In CurseForge, open the Prominence II instance, click the **⋮** menu → **Open Folder**.
2. Put the `helper-mod-<version>.jar` file into the `mods` folder (only one version at a time).
3. Launch the game.

### Updates install themselves

From 1.16.0 on, you only install the jar by hand once. Each time the game starts, the mod checks this
repo's GitHub releases in the background. When a newer version is there, it downloads it and tells you
in chat. When you close Minecraft, a small script waits for the game to exit, removes the old jar from
`mods` and puts the new one in. The next launch runs the new version. A new release is published as soon
as a version reaches Validate on the flow board.

To turn this off, set `auto_update=false` in `config/helpermod-updater.properties`.

**Playing together:**
- **Open to LAN, or the host's single-player world:** only the host needs the mod.
- **Dedicated server:** put the jar in the server's `mods` folder. Players joining don't need it.

## Building from source

Requires Java 17 or newer.

```bash
./gradlew build
```

The mod jar ends up in `build/libs/`.

## Notes

- A helper is a mob on the server that every player's game is told to draw as a player with the owner's
  skin. That's why nobody else has to install anything. If the server can't get the owner's skin (for
  example on an offline-mode server), the helper uses the default Steve/Alex skin.
- Helpers can't be hurt, so they make strong bodyguards. They don't use bows (melee only).
- A helper is its own chunk loader: its chunk and the ones around it stay loaded while its owner is online,
  so it keeps working when you walk away. If you go to another dimension, it pops back next to you.
- Mining speed follows the normal player rules. Better tools and Efficiency make your helper faster.
- **Running out of ore:** when there's nothing left near the bottom of its mine, the helper doesn't give up.
  It strip-mines further out from the bottom, 32 blocks longer each round (up to 4 rounds), until it has
  what you asked for.
- **Levels:** your helper gets better the more it works. It earns 1 point for every block it mines and 5 for
  every mob it beats. Level 2 comes at 50 points, level 3 at 200, and so on up to level 10. Each level makes it
  mine 10% faster (90% faster at level 10) and unlocks 3 more pockets: 27 at level 1, up to 54 at level 10.
  `/helper status` shows its level and how close it is to the next one.
