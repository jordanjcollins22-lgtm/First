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
  stops at a landing and mines the ore around that layer before going deeper. When it's done it climbs back
  up the stairs and walks back to you.
- For short distances it digs a tunnel, bridges gaps or pillars up. It plugs lava and water with cobblestone
  instead of giving up.
- It picks the best tool from its inventory for every block: the fastest one, fortune for ores, never
  silk touch unless that's what you want.
- It mines out the whole vein or tree before moving on.
- It brings everything back to you when it's done or its pockets are full.
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
| `/helper look <mob>` | Make your helper look like any mob, e.g. `/helper look creeper` or `/helper look iron golem`. Modded mobs work too (`/helper look somemod:thing`). Press Tab to see them all |
| `/helper look me` | Make your helper look like you again |
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
- Helpers only work while they're within simulation distance of their owner. If you walk or teleport far
  away, your helper pops back next to you and starts searching again from there.
- Mining speed follows the normal player rules. Better tools and Efficiency make your helper faster.
