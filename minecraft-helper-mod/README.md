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
| `/helper ride` | Ride your helper (or right-click it holding a saddle). Steer with your movement keys, sprint to go faster, sneak to get off |
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

If Ad Astra is installed (it is in Prominence II), five more real places show up on the rocket's planet
list, each with its own orbit for space stations:

| Planet | Rocket tier | Gravity | Ground | Ores and extras | In the sky |
| --- | --- | --- | --- | --- | --- |
| Europa (Jupiter) | 4 | 1.3 m/s² | Snow over packed ice | Diamond, lapis, ice shards, brown "crack" streaks, ice spikes | Jupiter |
| Io (Jupiter) | 4 | 1.8 m/s² | Yellow sulfur over blackstone | Gold, calorite, gilded blackstone, magma, lava lakes | A huge Jupiter |
| Titan (Saturn) | 4 | 1.35 m/s² | Red dunes over tuff, thick orange haze | Lots of coal, ostrum, diamond | Saturn through the haze |
| Ceres (asteroid belt) | 3 | 0.28 m/s² | Gravel over deepslate | Iron, desh, ice shards, bright salt patches | Just stars |
| Pluto | 4 | 0.62 m/s² | Snow over calcite, red patches | Emerald, diamond, calorite | Charon, and a tiny Sun |

All of them have no air and are very cold, so bring a space suit and oxygen. Without Ad Astra the mod
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

## Safety on shared worlds

- Helpers only break **natural** blocks: stone, dirt, ores, real trees (logs with natural leaves next to
  them), and so on. They refuse to collect crafted blocks like planks, and they never tunnel through anything
  a player placed (cobblestone, planks, chests, ...).
- They avoid lava, won't drop down big holes, and plug the top of any mineshaft they dig.
- Helpers can't be hurt and never despawn. Their inventory is saved with the world, so nothing is lost if
  one gets unloaded.
- Only the owner can open a helper's inventory.
- Helpers do **not** check land-claim mods, so ask players to keep their helpers away from other people's
  bases.

## Installing (CurseForge / Prominence II)

1. In CurseForge, open the Prominence II instance, click the **⋮** menu → **Open Folder**.
2. Put `helper-mod-1.0.0.jar` into the `mods` folder.
3. Launch the game.

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
- **Levels:** your helper gets better the more it works. It earns 1 point for every block it mines and 5 for
  every mob it beats. Level 2 comes at 50 points, level 3 at 200, and so on up to level 10. Each level makes it
  mine 10% faster (90% faster at level 10) and unlocks 3 more pockets: 27 at level 1, up to 54 at level 10.
  `/helper status` shows its level and how close it is to the next one.
