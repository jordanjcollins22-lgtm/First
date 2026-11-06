package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.enchantment.Enchantment;
import net.minecraft.enchantment.Enchantments;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.SpawnReason;
import net.minecraft.entity.attribute.EntityAttribute;
import net.minecraft.entity.attribute.EntityAttributeInstance;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.boss.BossBar;
import net.minecraft.entity.boss.ServerBossBar;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.mob.Monster;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
import net.minecraft.nbt.NbtString;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.Hand;
import net.minecraft.util.Identifier;
import net.minecraft.util.TypedActionResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.PersistentState;
import net.minecraft.world.World;

import net.minecraft.block.entity.ChestBlockEntity;
import net.minecraft.item.EnchantedBookItem;
import net.minecraft.enchantment.EnchantmentHelper;
import net.minecraft.enchantment.EnchantmentLevelEntry;
import net.minecraft.util.ActionResult;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.random.Random;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The Black Hole. When enough Tycoon ore piles up in one spot it starts to spin in a circle, then collapses
 * into a Singularity. Right-click with a Singularity to fall into the Black Hole: a dark void dimension with
 * a hub island, four boss arenas joined by bridges, and four original bosses that drop weapons with special
 * skills (right-click to use the skill). Right-click the Singularity again inside to go back home.
 */
final class BlackHole {
    private BlackHole() {}

    static final RegistryKey<World> WORLD = RegistryKey.of(RegistryKeys.WORLD, new Identifier(HelperMod.MOD_ID, "black_hole"));
    private static final String NBT = "HelperRift";
    private static final String BOSS_TAG = "helpermod_rift_boss";
    private static final int Y = 100; // floor height of everything in the Black Hole
    private static final int PILE = 16; // this much ore resting in one spot makes a vortex
    private static final int VORTEX_TICKS = 70;

    // ---------------------------------------------------------------------------------------
    // The bosses
    // ---------------------------------------------------------------------------------------

    private record BossDef(String id, String name, String title, String type, double health, double damage, double speed,
                           Item weapon, String minion, int dx, int dz, Block edge, long coins, String reward) {}

    private static final BossDef[] BOSSES = {
            new BossDef("ashen", "Ashen Warden", "the Ashen Warden, Keeper of Cinders", "minecraft:wither_skeleton",
                    450, 14, 0.30, Items.NETHERITE_SWORD, "minecraft:blaze", 58, 0, Blocks.MAGMA_BLOCK, 100_000,
                    "the Ashfall Greatsword"),
            new BossDef("dusk", "Duskfang", "Duskfang, the Moonless Hunter", "minecraft:vindicator",
                    420, 16, 0.42, Items.NETHERITE_AXE, "minecraft:vex", -58, 0, Blocks.PURPUR_PILLAR, 100_000,
                    "the Duskfang Blade"),
            new BossDef("colossus", "Hollow Colossus", "the Hollow Colossus", "minecraft:ravager",
                    650, 18, 0.32, null, "minecraft:silverfish", 0, 58, Blocks.GILDED_BLACKSTONE, 150_000,
                    "the Collapse Maul"),
            new BossDef("sovereign", "Singularity Sovereign", "the Singularity Sovereign, Heart of the Black Hole",
                    "minecraft:evoker", 900, 12, 0.36, null, "minecraft:vex", 0, -58, Blocks.CRYING_OBSIDIAN, 1_000_000,
                    "the Starless Staff and a Nether Star"),
    };

    private static BossDef boss(String id) {
        for (BossDef b : BOSSES) if (b.id().equals(id)) return b;
        return null;
    }

    private static BlockPos altar(BossDef b) {
        return new BlockPos(b.dx(), Y, b.dz());
    }

    // ---------------------------------------------------------------------------------------
    // Saved state
    // ---------------------------------------------------------------------------------------

    static final class Data extends PersistentState {
        private static final String ID = "helpermod_black_hole";
        boolean built;
        /** The loot chests were added (worlds that fell in before 1.26.0 get them later). */
        boolean cachesBuilt;
        /** Magic level from reading Rift Tomes: stronger, faster weapon skills. */
        final Map<UUID, Integer> arcane = new HashMap<>();
        /** When each player last looted each Rift Cache ("uuid|pos" -> Black Hole world time). */
        final Map<String, Long> looted = new HashMap<>();
        /** Which bosses each player has beaten. */
        final Map<UUID, Set<String>> beaten = new HashMap<>();
        /** When each boss can be fought again (Black Hole world time). */
        final Map<String, Long> rematchAt = new HashMap<>();
        /** Where each player was before falling in, to send them back. */
        final Map<UUID, NbtCompound> home = new HashMap<>();

        static Data get(MinecraftServer server) {
            return server.getOverworld().getPersistentStateManager().getOrCreate(Data::fromNbt, Data::new, ID);
        }

        private static Data fromNbt(NbtCompound nbt) {
            Data d = new Data();
            d.built = nbt.getBoolean("built");
            d.cachesBuilt = nbt.getBoolean("cachesBuilt");
            NbtCompound a = nbt.getCompound("arcane");
            for (String k : a.getKeys()) d.arcane.put(UUID.fromString(k), a.getInt(k));
            NbtCompound lo = nbt.getCompound("looted");
            for (String k : lo.getKeys()) d.looted.put(k, lo.getLong(k));
            NbtCompound b = nbt.getCompound("beaten");
            for (String k : b.getKeys()) {
                Set<String> set = new HashSet<>();
                NbtList l = b.getList(k, NbtElement.STRING_TYPE);
                for (int i = 0; i < l.size(); i++) set.add(l.getString(i));
                d.beaten.put(UUID.fromString(k), set);
            }
            NbtCompound r = nbt.getCompound("rematch");
            for (String k : r.getKeys()) d.rematchAt.put(k, r.getLong(k));
            NbtCompound h = nbt.getCompound("home");
            for (String k : h.getKeys()) d.home.put(UUID.fromString(k), h.getCompound(k));
            return d;
        }

        @Override
        public NbtCompound writeNbt(NbtCompound nbt) {
            nbt.putBoolean("built", built);
            nbt.putBoolean("cachesBuilt", cachesBuilt);
            NbtCompound a = new NbtCompound();
            arcane.forEach((k, v) -> a.putInt(k.toString(), v));
            nbt.put("arcane", a);
            NbtCompound lo = new NbtCompound();
            looted.forEach(lo::putLong);
            nbt.put("looted", lo);
            NbtCompound b = new NbtCompound();
            for (Map.Entry<UUID, Set<String>> e : beaten.entrySet()) {
                NbtList l = new NbtList();
                for (String s : e.getValue()) l.add(NbtString.of(s));
                b.put(e.getKey().toString(), l);
            }
            nbt.put("beaten", b);
            NbtCompound r = new NbtCompound();
            rematchAt.forEach(r::putLong);
            nbt.put("rematch", r);
            NbtCompound h = new NbtCompound();
            home.forEach((k, v) -> h.put(k.toString(), v));
            nbt.put("home", h);
            return nbt;
        }

        Set<String> beaten(UUID id) {
            return beaten.computeIfAbsent(id, k -> new HashSet<>());
        }
    }

    // ---------------------------------------------------------------------------------------
    // Runtime state
    // ---------------------------------------------------------------------------------------

    /** Ore spinning into a Singularity. */
    private static final class Vortex {
        final ServerWorld world;
        final Vec3d centre;
        int ticks;

        Vortex(ServerWorld world, Vec3d centre) {
            this.world = world;
            this.centre = centre;
        }
    }

    private static final class Fight {
        final BossDef def;
        final MobEntity boss;
        final ServerBossBar bar;
        boolean enraged;
        int emptyTicks;

        Fight(BossDef def, MobEntity boss, ServerBossBar bar) {
            this.def = def;
            this.boss = boss;
            this.bar = bar;
        }
    }

    private static final List<Vortex> VORTICES = new ArrayList<>();
    private static final Map<String, Fight> FIGHTS = new HashMap<>();
    private static final Map<String, Long> COOLDOWNS = new HashMap<>();
    private static final Set<UUID> TOLD = new HashSet<>();

    static void reset() {
        VORTICES.clear();
        for (Fight f : FIGHTS.values()) f.bar.clearPlayers();
        FIGHTS.clear();
        COOLDOWNS.clear();
        TOLD.clear();
    }

    // ---------------------------------------------------------------------------------------
    // Piles of ore -> vortex -> Singularity (called by Tycoon with the live ore every second)
    // ---------------------------------------------------------------------------------------

    static void checkPiles(List<ItemEntity> ores) {
        List<ItemEntity> resting = new ArrayList<>();
        for (ItemEntity o : ores) {
            Vec3d v = o.getVelocity();
            if (o.isAlive() && v.x * v.x + v.z * v.z < 0.0025 && !inVortex(o)) resting.add(o);
        }
        Set<ItemEntity> used = new HashSet<>();
        for (ItemEntity o : resting) {
            if (used.contains(o)) continue;
            List<ItemEntity> pile = new ArrayList<>();
            for (ItemEntity other : resting) {
                if (other.getWorld() == o.getWorld() && other.squaredDistanceTo(o) < 2.0 * 2.0) pile.add(other);
            }
            if (pile.size() < PILE) continue;
            used.addAll(pile);
            double x = 0, y = 0, z = 0;
            for (ItemEntity p : pile) {
                x += p.getX();
                y += p.getY();
                z += p.getZ();
            }
            ServerWorld world = (ServerWorld) o.getWorld();
            Vec3d centre = new Vec3d(x / pile.size(), y / pile.size(), z / pile.size());
            VORTICES.add(new Vortex(world, centre));
            world.playSound(null, BlockPos.ofFloored(centre), SoundEvents.BLOCK_PORTAL_TRIGGER, SoundCategory.BLOCKS, 0.6f, 1.6f);
            for (ServerPlayerEntity p : world.getPlayers()) {
                if (p.squaredDistanceTo(centre) < 32 * 32) {
                    p.sendMessage(Text.literal("The ore pile is starting to spin...").formatted(Formatting.DARK_PURPLE), true);
                }
            }
        }
    }

    private static boolean inVortex(ItemEntity o) {
        for (Vortex v : VORTICES) if (v.world == o.getWorld() && v.centre.squaredDistanceTo(o.getPos()) < 4 * 4) return true;
        return false;
    }

    private static boolean isOre(Entity e) {
        return e instanceof ItemEntity && e.getCommandTags().contains("helpermod_ore");
    }

    private static void tickVortices() {
        for (Iterator<Vortex> it = VORTICES.iterator(); it.hasNext(); ) {
            Vortex v = it.next();
            v.ticks++;
            Box box = new Box(v.centre, v.centre).expand(4, 2, 4);
            List<Entity> ores = v.world.getOtherEntities(null, box, BlackHole::isOre);
            double pull = (double) v.ticks / VORTEX_TICKS; // the circle shrinks as it spins faster
            for (Entity e : ores) {
                double dx = e.getX() - v.centre.x, dz = e.getZ() - v.centre.z;
                double r = Math.max(0.15, Math.sqrt(dx * dx + dz * dz));
                double target = 1.6 * (1 - pull) + 0.1;
                double spin = 0.18 + 0.35 * pull;
                double tx = -dz / r * spin, tz = dx / r * spin; // around the circle
                double in = (target - r) * 0.25; // towards the ring
                e.setVelocity(tx + dx / r * in, 0.04 + 0.06 * pull + (v.centre.y + 0.4 - e.getY()) * 0.1, tz + dz / r * in);
                e.velocityModified = true;
                e.setNoGravity(true);
            }
            if (v.ticks % 4 == 0) {
                v.world.spawnParticles(ParticleTypes.REVERSE_PORTAL, v.centre.x, v.centre.y + 0.5, v.centre.z, 20, 0.8, 0.3, 0.8, 0.02);
                v.world.spawnParticles(ParticleTypes.SQUID_INK, v.centre.x, v.centre.y + 0.5, v.centre.z, 4, 0.2, 0.2, 0.2, 0.01);
            }
            if (v.ticks < VORTEX_TICKS) continue;
            it.remove();
            int n = 0;
            for (Entity e : ores) {
                e.discard();
                n++;
            }
            if (n < PILE / 2) continue; // most of it got away (picked up or moved)
            v.world.spawnParticles(ParticleTypes.SONIC_BOOM, v.centre.x, v.centre.y + 0.5, v.centre.z, 1, 0, 0, 0, 0);
            v.world.spawnParticles(ParticleTypes.PORTAL, v.centre.x, v.centre.y + 0.5, v.centre.z, 80, 0.5, 0.5, 0.5, 1.0);
            v.world.playSound(null, BlockPos.ofFloored(v.centre), SoundEvents.ENTITY_WARDEN_SONIC_BOOM, SoundCategory.BLOCKS, 0.7f, 0.6f);
            ItemEntity drop = new ItemEntity(v.world, v.centre.x, v.centre.y + 0.5, v.centre.z, singularity(), 0, 0.2, 0);
            drop.setNeverDespawn();
            v.world.spawnEntity(drop);
            for (ServerPlayerEntity p : v.world.getPlayers()) {
                if (p.squaredDistanceTo(v.centre) < 32 * 32) {
                    Helper.say(p, "Whoa! " + n + " ore just collapsed into a Singularity, a tiny black hole. Pick it up and "
                            + "right-click with it to fall in. There are bosses in there.");
                }
            }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Items
    // ---------------------------------------------------------------------------------------

    private static ItemStack tagged(Item item, String kind, String name, Formatting color, String... lore) {
        ItemStack stack = new ItemStack(item);
        stack.getOrCreateNbt().putString(NBT, kind);
        stack.setCustomName(Text.literal(name).styled(s -> s.withItalic(false)).formatted(color));
        NbtCompound display = stack.getOrCreateSubNbt("display");
        NbtList l = new NbtList();
        for (String line : lore) l.add(NbtString.of(Text.Serializer.toJson(Text.literal(line).formatted(Formatting.GRAY))));
        display.put("Lore", l);
        return stack;
    }

    static ItemStack singularity() {
        ItemStack s = tagged(Items.ECHO_SHARD, "singularity", "Singularity", Formatting.DARK_PURPLE,
                "A tiny black hole made of collapsed ore.", "Right-click to fall into the Black Hole.",
                "Right-click again inside to go home.");
        s.addEnchantment(Enchantments.UNBREAKING, 1); // for the shine
        s.getOrCreateNbt().putInt("HideFlags", 1);
        return s;
    }

    private static ItemStack enchanted(ItemStack s, Object... pairs) {
        for (int i = 0; i < pairs.length; i += 2) s.addEnchantment((Enchantment) pairs[i], (Integer) pairs[i + 1]);
        return s;
    }

    static ItemStack weapon(String kind) {
        return switch (kind) {
            case "ashfall" -> enchanted(tagged(Items.NETHERITE_SWORD, "ashfall", "Ashfall Greatsword", Formatting.GOLD,
                            "Dropped by the Ashen Warden.", "Skill (right-click): Ash Whirl, a burning spin", "that hits every monster around you."),
                    Enchantments.SHARPNESS, 5, Enchantments.FIRE_ASPECT, 2, Enchantments.UNBREAKING, 3);
            case "duskfang" -> enchanted(tagged(Items.NETHERITE_SWORD, "duskfang", "Duskfang Blade", Formatting.LIGHT_PURPLE,
                            "Dropped by Duskfang, the Moonless Hunter.", "Skill (right-click): Moonless Step, dash forward", "and cut through everything in the way."),
                    Enchantments.SHARPNESS, 5, Enchantments.SWEEPING, 3, Enchantments.UNBREAKING, 3);
            case "maul" -> enchanted(tagged(Items.NETHERITE_AXE, "maul", "Collapse Maul", Formatting.DARK_AQUA,
                            "Dropped by the Hollow Colossus.", "Skill (right-click): Collapse, pull monsters in", "with gravity and slam them into the air."),
                    Enchantments.SHARPNESS, 5, Enchantments.UNBREAKING, 3);
            case "staff" -> enchanted(tagged(Items.BLAZE_ROD, "staff", "Starless Staff", Formatting.DARK_PURPLE,
                            "Dropped by the Singularity Sovereign.", "Skill (right-click): Starless Beam, a ray of", "black starlight that hits the first monster."),
                    Enchantments.UNBREAKING, 1);
            default -> ItemStack.EMPTY;
        };
    }

    private static String kindOf(ItemStack stack) {
        NbtCompound nbt = stack.getNbt();
        return nbt != null && nbt.contains(NBT) ? nbt.getString(NBT) : null;
    }

    // ---------------------------------------------------------------------------------------
    // Going in and out
    // ---------------------------------------------------------------------------------------

    static TypedActionResult<ItemStack> onUseItem(PlayerEntity p, World w, Hand hand) {
        ItemStack stack = p.getStackInHand(hand);
        String kind = kindOf(stack);
        if (kind == null || kind.startsWith("set:")) return TypedActionResult.pass(stack); // armor equips as normal
        if (w.isClient) return TypedActionResult.success(stack);
        if (!(p instanceof ServerPlayerEntity player) || p instanceof FakePlayer) return TypedActionResult.pass(stack);
        if (kind.startsWith("tome:")) {
            readTome(player, stack, kind);
        } else if (kind.equals("singularity")) {
            if (player.getServerWorld().getRegistryKey().equals(WORLD)) leave(player);
            else enter(player);
        } else {
            skill(player, kind);
        }
        return TypedActionResult.success(stack);
    }

    static void enter(ServerPlayerEntity player) {
        MinecraftServer server = player.getServer();
        ServerWorld hole = server.getWorld(WORLD);
        if (hole == null) {
            Helper.say(player, "The Black Hole didn't load. Restart the world once after installing this version.");
            return;
        }
        Data data = Data.get(server);
        if (!data.built) {
            build(hole);
            data.built = true;
        }
        if (!data.cachesBuilt) {
            buildCaches(hole);
            data.cachesBuilt = true;
        }
        NbtCompound home = new NbtCompound();
        home.putString("dim", player.getServerWorld().getRegistryKey().getValue().toString());
        home.putDouble("x", player.getX());
        home.putDouble("y", player.getY());
        home.putDouble("z", player.getZ());
        data.home.put(player.getUuid(), home);
        data.markDirty();
        ServerWorld from = player.getServerWorld();
        from.spawnParticles(ParticleTypes.REVERSE_PORTAL, player.getX(), player.getY() + 1, player.getZ(), 60, 0.4, 0.8, 0.4, 0.1);
        from.playSound(null, player.getBlockPos(), SoundEvents.BLOCK_END_PORTAL_SPAWN, SoundCategory.PLAYERS, 0.6f, 1.4f);
        player.teleport(hole, 0.5, Y + 1, 4.5, 180f, 0f);
        player.addStatusEffect(new StatusEffectInstance(StatusEffects.SLOW_FALLING, 200, 0));
        Helper.say(player, "Welcome to the Black Hole. Four bosses wait at the end of the bridges: the Ashen Warden (east), "
                + "Duskfang (west) and the Hollow Colossus (south). Beat all three and the Singularity Sovereign (north) wakes up. "
                + "Stand on the lodestone in an arena to call its boss. The chests with soul lanterns are Rift Caches: loot just for you, "
                + "refilled every 15 minutes. Right-click your Singularity to go home.");
    }

    static void leave(ServerPlayerEntity player) {
        MinecraftServer server = player.getServer();
        Data data = Data.get(server);
        NbtCompound home = data.home.get(player.getUuid());
        ServerWorld to = server.getOverworld();
        double x, y, z;
        if (home != null) {
            Identifier dim = Identifier.tryParse(home.getString("dim"));
            ServerWorld w = dim == null ? null : server.getWorld(RegistryKey.of(RegistryKeys.WORLD, dim));
            if (w != null) to = w;
            x = home.getDouble("x");
            y = home.getDouble("y");
            z = home.getDouble("z");
        } else {
            BlockPos spawn = to.getSpawnPos();
            x = spawn.getX() + 0.5;
            y = spawn.getY();
            z = spawn.getZ() + 0.5;
        }
        player.teleport(to, x, y, z, player.getYaw(), player.getPitch());
        Helper.say(player, "Back home. The Black Hole will be there when you need it.");
    }

    /** /helper blackhole */
    static void info(ServerPlayerEntity player) {
        Data data = Data.get(player.getServer());
        Set<String> beaten = data.beaten(player.getUuid());
        Helper.say(player, "Black Hole: pile up " + PILE + " or more Tycoon ore in one spot (let it drop into a pit, or run your "
                + "conveyors in a loop with no collector). The pile spins in a circle and collapses into a Singularity. "
                + "Right-click with it to fall in.");
        int arcane = data.arcane.getOrDefault(player.getUuid(), 0);
        player.sendMessage(Text.literal("  Magic level " + arcane + "/" + MAX_ARCANE + " (skills +" + (arcane * 10) + "% damage, -"
                + (arcane * 5) + "% cooldown). Read Rift Tomes to level up.").formatted(Formatting.LIGHT_PURPLE), false);
        for (BossDef b : BOSSES) {
            String where = b.dx() > 0 ? "east" : b.dx() < 0 ? "west" : b.dz() > 0 ? "south" : "north";
            player.sendMessage(Text.literal((beaten.contains(b.id()) ? "  [beaten] " : "  ") + b.title() + " (" + where
                    + " bridge): drops " + b.reward() + " and " + b.coins() + " coins").formatted(
                    beaten.contains(b.id()) ? Formatting.GREEN : Formatting.GRAY), false);
        }
    }

    /** /helper blackhole leave, in case the Singularity got lost. */
    static void leaveCommand(ServerPlayerEntity player) {
        if (!player.getServerWorld().getRegistryKey().equals(WORLD)) {
            Helper.say(player, "You're not in the Black Hole.");
            return;
        }
        leave(player);
    }

    // ---------------------------------------------------------------------------------------
    // Building the Black Hole: hub island, bridges, arenas
    // ---------------------------------------------------------------------------------------

    private static void set(ServerWorld w, int x, int y, int z, BlockState s) {
        w.setBlockState(new BlockPos(x, y, z), s, Block.NOTIFY_LISTENERS);
    }

    private static void disc(ServerWorld w, int cx, int cz, int r, BlockState floor, BlockState edge) {
        for (int dx = -r; dx <= r; dx++) {
            for (int dz = -r; dz <= r; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > r + 0.5) continue;
                w.getChunk((cx + dx) >> 4, (cz + dz) >> 4);
                set(w, cx + dx, Y, cz + dz, d > r - 0.5 ? edge : floor);
                int depth = (int) Math.round((r - d) * 0.8); // a rocky underside, like a floating island
                for (int k = 1; k <= depth; k++) set(w, cx + dx, Y - k, cz + dz, Blocks.BLACKSTONE.getDefaultState());
            }
        }
    }

    private static void pillars(ServerWorld w, int cx, int cz, int r, int n, BlockState pillar, BlockState light) {
        for (int k = 0; k < n; k++) {
            double a = k * Math.PI * 2 / n;
            int x = cx + (int) Math.round(Math.cos(a) * r), z = cz + (int) Math.round(Math.sin(a) * r);
            for (int y = 1; y <= 4; y++) set(w, x, Y + y, z, pillar);
            set(w, x, Y + 5, z, light);
        }
    }

    private static void build(ServerWorld w) {
        BlockState floor = Blocks.POLISHED_BLACKSTONE_BRICKS.getDefaultState();
        BlockState obsidian = Blocks.OBSIDIAN.getDefaultState();
        // Hub
        disc(w, 0, 0, 10, floor, Blocks.CRYING_OBSIDIAN.getDefaultState());
        for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++) set(w, dx, Y, dz, obsidian);
        set(w, 0, Y, 0, Blocks.CRYING_OBSIDIAN.getDefaultState());
        pillars(w, 0, 0, 8, 8, obsidian, Blocks.END_ROD.getDefaultState());
        // Bridges and arenas
        for (BossDef b : BOSSES) {
            int sx = Integer.signum(b.dx()), sz = Integer.signum(b.dz());
            for (int i = 10; i <= 46; i++) {
                for (int s = -1; s <= 1; s++) {
                    int x = sx * i + (sx == 0 ? s : 0), z = sz * i + (sz == 0 ? s : 0);
                    w.getChunk(x >> 4, z >> 4);
                    set(w, x, Y, z, Blocks.POLISHED_BLACKSTONE.getDefaultState());
                    set(w, x, Y - 1, z, Blocks.BLACKSTONE.getDefaultState());
                }
                if (i % 6 == 0) { // lanterns along both sides
                    int lx1 = sx * i + (sx == 0 ? 2 : 0), lz1 = sz * i + (sz == 0 ? 2 : 0);
                    int lx2 = sx * i - (sx == 0 ? 2 : 0), lz2 = sz * i - (sz == 0 ? 2 : 0);
                    set(w, lx1, Y, lz1, Blocks.POLISHED_BLACKSTONE.getDefaultState());
                    set(w, lx2, Y, lz2, Blocks.POLISHED_BLACKSTONE.getDefaultState());
                    set(w, lx1, Y + 1, lz1, Blocks.SOUL_LANTERN.getDefaultState());
                    set(w, lx2, Y + 1, lz2, Blocks.SOUL_LANTERN.getDefaultState());
                }
            }
            disc(w, b.dx(), b.dz(), 13, Blocks.DEEPSLATE_TILES.getDefaultState(), b.edge().getDefaultState());
            pillars(w, b.dx(), b.dz(), 11, 6, b.edge().getDefaultState(), Blocks.SHROOMLIGHT.getDefaultState());
            set(w, b.dx(), Y, b.dz(), Blocks.LODESTONE.getDefaultState());
        }
    }

    // ---------------------------------------------------------------------------------------
    // Ticking: vortices, fights, calling bosses
    // ---------------------------------------------------------------------------------------

    static void tick(MinecraftServer server) {
        tickVortices();
        if (server.getTicks() % 40 == 0) tickSetBonuses(server);
        FIGHTS.entrySet().removeIf(e -> tickFight(server, e.getValue()));
        if (server.getTicks() % 20 != 0) return;
        ServerWorld hole = server.getWorld(WORLD);
        if (hole == null) return;
        Data data = Data.get(server);
        for (ServerPlayerEntity player : hole.getPlayers()) {
            if (player.isSpectator()) continue;
            if (player.getY() < -20) { // fell off: back to the hub instead of dying in the void
                player.teleport(hole, 0.5, Y + 1, 4.5, player.getYaw(), player.getPitch());
                player.addStatusEffect(new StatusEffectInstance(StatusEffects.SLOW_FALLING, 100, 0));
                Helper.say(player, "Careful! The Black Hole spat you back out at the hub.");
                continue;
            }
            for (BossDef b : BOSSES) {
                if (FIGHTS.containsKey(b.id())) continue;
                if (player.getBlockPos().getSquaredDistance(altar(b).up()) > 2.5 * 2.5) continue;
                if (b.id().equals("sovereign")) {
                    Set<String> beaten = data.beaten(player.getUuid());
                    if (!(beaten.contains("ashen") && beaten.contains("dusk") && beaten.contains("colossus"))) {
                        player.sendMessage(Text.literal("The Singularity Sovereign sleeps. Beat the other three bosses first.")
                                .formatted(Formatting.DARK_PURPLE), true);
                        continue;
                    }
                }
                long ready = data.rematchAt.getOrDefault(b.id(), 0L);
                if (hole.getTime() < ready) {
                    player.sendMessage(Text.literal(b.name() + " is gathering strength. Back in "
                            + Math.max(1, (ready - hole.getTime()) / 1200) + " minutes."), true);
                    continue;
                }
                start(hole, b);
            }
        }
    }

    private static void attr(MobEntity mob, EntityAttribute a, double v) {
        EntityAttributeInstance inst = mob.getAttributeInstance(a);
        if (inst != null) inst.setBaseValue(v);
    }

    private static void start(ServerWorld world, BossDef b) {
        EntityType<?> type = Planets.type(b.type());
        if (type == null) return;
        Entity e = type.create(world);
        if (!(e instanceof MobEntity boss)) {
            if (e != null) e.discard();
            return;
        }
        BlockPos at = altar(b).up();
        double ox = -Math.signum(b.dx()) * 7, oz = -Math.signum(b.dz()) * 7; // between the altar and the far edge
        boss.refreshPositionAndAngles(at.getX() + 0.5 - ox, at.getY(), at.getZ() + 0.5 - oz, 0f, 0f);
        boss.initialize(world, world.getLocalDifficulty(at), SpawnReason.EVENT, null, null);
        attr(boss, EntityAttributes.GENERIC_MAX_HEALTH, b.health());
        attr(boss, EntityAttributes.GENERIC_ATTACK_DAMAGE, b.damage());
        attr(boss, EntityAttributes.GENERIC_MOVEMENT_SPEED, b.speed());
        attr(boss, EntityAttributes.GENERIC_KNOCKBACK_RESISTANCE, 1.0);
        attr(boss, EntityAttributes.GENERIC_FOLLOW_RANGE, 48);
        attr(boss, EntityAttributes.GENERIC_ARMOR, 10);
        boss.setHealth(boss.getMaxHealth());
        if (b.weapon() != null) boss.equipStack(EquipmentSlot.MAINHAND, new ItemStack(b.weapon()));
        for (EquipmentSlot slot : EquipmentSlot.values()) boss.setEquipmentDropChance(slot, 0f);
        boss.setCustomName(Text.literal(b.name()).formatted(Formatting.DARK_PURPLE, Formatting.BOLD));
        boss.setCustomNameVisible(true);
        boss.setPersistent();
        boss.addCommandTag(BOSS_TAG);
        boss.addCommandTag(Planets.MOB_TAG);
        ServerBossBar bar = new ServerBossBar(Text.literal(b.title()), BossBar.Color.PURPLE, BossBar.Style.NOTCHED_10);
        bar.setDarkenSky(true);
        FIGHTS.put(b.id(), new Fight(b, boss, bar));
        world.spawnEntity(boss);
        world.playSound(null, at, SoundEvents.ENTITY_WITHER_SPAWN, SoundCategory.HOSTILE, 1.2f, 0.6f);
        world.spawnParticles(ParticleTypes.SCULK_SOUL, boss.getX(), boss.getY() + 1, boss.getZ(), 40, 0.6, 1, 0.6, 0.05);
        for (ServerPlayerEntity p : world.getPlayers()) {
            if (p.squaredDistanceTo(Vec3d.ofCenter(at)) < 64 * 64) {
                p.sendMessage(Text.literal(b.title().toUpperCase(java.util.Locale.ROOT)).formatted(Formatting.DARK_PURPLE, Formatting.BOLD), false);
            }
        }
    }

    /** Returns true when the fight is over. */
    private static boolean tickFight(MinecraftServer server, Fight f) {
        MobEntity boss = f.boss;
        ServerWorld world = (ServerWorld) boss.getWorld();
        BlockPos altar = altar(f.def);
        if (boss.isDead() || (boss.isRemoved() && boss.getRemovalReason() == Entity.RemovalReason.KILLED)) {
            win(world, f);
            return true;
        }
        if (boss.isRemoved()) {
            f.bar.clearPlayers();
            return true;
        }
        f.bar.setPercent(boss.getHealth() / boss.getMaxHealth());
        boolean anyone = false;
        for (ServerPlayerEntity p : world.getPlayers()) {
            boolean near = !p.isSpectator() && p.getBlockPos().getSquaredDistance(altar) < 48 * 48;
            if (near) {
                anyone = true;
                f.bar.addPlayer(p);
            } else {
                f.bar.removePlayer(p);
            }
        }
        if (!anyone && ++f.emptyTicks > 600) { // everyone left: it fades away and can be called again
            boss.discard();
            f.bar.clearPlayers();
            return true;
        }
        if (anyone) f.emptyTicks = 0;
        // Leashed to its arena.
        if (boss.getBlockPos().getSquaredDistance(altar) > 16 * 16 || boss.getY() < Y - 4) {
            boss.requestTeleport(altar.getX() + 0.5, Y + 1, altar.getZ() + 0.5);
        }
        // Second phase at half health: faster, stronger, and it calls for help.
        if (!f.enraged && boss.getHealth() < boss.getMaxHealth() / 2) {
            f.enraged = true;
            f.bar.setColor(BossBar.Color.RED);
            boss.addStatusEffect(new StatusEffectInstance(StatusEffects.SPEED, 20 * 600, 1));
            boss.addStatusEffect(new StatusEffectInstance(StatusEffects.STRENGTH, 20 * 600, 1));
            boss.addStatusEffect(new StatusEffectInstance(StatusEffects.GLOWING, 20 * 600, 0));
            world.playSound(null, boss.getBlockPos(), SoundEvents.ENTITY_ENDER_DRAGON_GROWL, SoundCategory.HOSTILE, 1.2f, 0.8f);
            world.spawnParticles(ParticleTypes.SOUL_FIRE_FLAME, boss.getX(), boss.getY() + 1, boss.getZ(), 60, 1, 1, 1, 0.1);
            EntityType<?> minion = Planets.type(f.def.minion());
            for (int i = 0; minion != null && i < 3; i++) {
                Entity m = minion.create(world);
                if (m == null) continue;
                double a = i * Math.PI * 2 / 3;
                m.refreshPositionAndAngles(boss.getX() + Math.cos(a) * 3, boss.getY() + (minion == EntityType.VEX ? 2 : 0),
                        boss.getZ() + Math.sin(a) * 3, 0, 0);
                m.addCommandTag(Planets.MOB_TAG);
                world.spawnEntity(m);
            }
            for (ServerPlayerEntity p : world.getPlayers()) {
                if (p.getBlockPos().getSquaredDistance(altar) < 48 * 48) {
                    p.sendMessage(Text.literal(f.def.name() + " is enraged!").formatted(Formatting.RED, Formatting.BOLD), true);
                }
            }
        }
        return false;
    }

    private static void win(ServerWorld world, Fight f) {
        f.bar.clearPlayers();
        BossDef b = f.def;
        Data data = Data.get(world.getServer());
        data.rematchAt.put(b.id(), world.getTime() + 20 * 60 * 5);
        BlockPos altar = altar(b);
        Tycoon.Data coins = Tycoon.Data.get(world.getServer());
        String weapon = switch (b.id()) {
            case "ashen" -> "ashfall";
            case "dusk" -> "duskfang";
            case "colossus" -> "maul";
            default -> "staff";
        };
        world.playSound(null, altar, SoundEvents.UI_TOAST_CHALLENGE_COMPLETE, SoundCategory.PLAYERS, 1f, 0.8f);
        world.spawnParticles(ParticleTypes.END_ROD, altar.getX() + 0.5, Y + 2, altar.getZ() + 0.5, 80, 2, 2, 2, 0.1);
        for (ServerPlayerEntity p : world.getPlayers()) {
            if (p.isSpectator() || p.getBlockPos().getSquaredDistance(altar) > 48 * 48) continue;
            p.getInventory().offerOrDrop(weapon(weapon));
            Random rnd = world.getRandom();
            p.getInventory().offerOrDrop(armor(b.id(), ARMOR_SLOTS[rnd.nextInt(4)])); // one piece of its set each time
            if (b.id().equals("sovereign")) p.getInventory().offerOrDrop(armor(b.id(), ARMOR_SLOTS[rnd.nextInt(4)]));
            p.getInventory().offerOrDrop(tome(b.id().equals("sovereign") ? 3 : 1));
            p.getInventory().offerOrDrop(book(rnd));
            if (b.id().equals("sovereign")) p.getInventory().offerOrDrop(new ItemStack(Items.NETHER_STAR));
            p.addExperience(b.id().equals("sovereign") ? 2000 : 500);
            coins.add(p.getUuid(), b.coins());
            data.beaten(p.getUuid()).add(b.id());
            p.sendMessage(Text.literal("ENEMY FELLED").formatted(Formatting.GOLD, Formatting.BOLD), false);
            Helper.say(p, "We beat " + b.title() + "! You got " + b.reward() + " and " + b.coins() + " coins.");
            Set<String> beaten = data.beaten(p.getUuid());
            if (!b.id().equals("sovereign") && beaten.contains("ashen") && beaten.contains("dusk") && beaten.contains("colossus")) {
                Helper.say(p, "All three are down. The Singularity Sovereign is awake at the end of the north bridge.");
            }
        }
        data.markDirty();
    }

    // ---------------------------------------------------------------------------------------
    // Armor sets, Rift Tomes (magic levels), enchanted books and the Rift Caches
    // ---------------------------------------------------------------------------------------

    static final int MAX_ARCANE = 10;
    private static final EquipmentSlot[] ARMOR_SLOTS = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET};

    private record ArmorSet(String id, String name, Formatting color, String bonus, StatusEffectInstance[] effects) {}

    private static StatusEffectInstance fx(net.minecraft.entity.effect.StatusEffect e, int amp) {
        return new StatusEffectInstance(e, 100, amp, true, false, true);
    }

    private static final ArmorSet[] SETS = {
            new ArmorSet("ashen", "Cinderwarden", Formatting.GOLD, "Fire Resistance and Strength",
                    new StatusEffectInstance[]{fx(StatusEffects.FIRE_RESISTANCE, 0), fx(StatusEffects.STRENGTH, 0)}),
            new ArmorSet("dusk", "Moonless", Formatting.LIGHT_PURPLE, "Speed II and Night Vision",
                    new StatusEffectInstance[]{fx(StatusEffects.SPEED, 1), fx(StatusEffects.NIGHT_VISION, 0)}),
            new ArmorSet("colossus", "Hollow Bulwark", Formatting.DARK_AQUA, "Resistance and Haste II",
                    new StatusEffectInstance[]{fx(StatusEffects.RESISTANCE, 0), fx(StatusEffects.HASTE, 1)}),
            new ArmorSet("sovereign", "Event Horizon", Formatting.DARK_PURPLE, "Regeneration, Strength II and Slow Falling",
                    new StatusEffectInstance[]{fx(StatusEffects.REGENERATION, 0), fx(StatusEffects.STRENGTH, 1), fx(StatusEffects.SLOW_FALLING, 0)}),
    };

    private static ArmorSet set(String id) {
        for (ArmorSet a : SETS) if (a.id().equals(id)) return a;
        return SETS[0];
    }

    /** One piece of a boss's armor set: netherite, well enchanted, and a bonus for wearing all four. */
    static ItemStack armor(String setId, EquipmentSlot slot) {
        ArmorSet a = set(setId);
        Item item;
        String piece;
        switch (slot) {
            case HEAD -> { item = Items.NETHERITE_HELMET; piece = "Helm"; }
            case CHEST -> { item = Items.NETHERITE_CHESTPLATE; piece = "Chestplate"; }
            case LEGS -> { item = Items.NETHERITE_LEGGINGS; piece = "Greaves"; }
            default -> { item = Items.NETHERITE_BOOTS; piece = "Boots"; }
        }
        ItemStack s = tagged(item, "set:" + a.id(), a.name() + " " + piece, a.color(),
                "Part of the " + a.name() + " set.", "Wear all four pieces: " + a.bonus() + ".");
        s.addEnchantment(Enchantments.PROTECTION, 4);
        s.addEnchantment(Enchantments.UNBREAKING, 3);
        if (slot == EquipmentSlot.FEET) s.addEnchantment(Enchantments.FEATHER_FALLING, 4);
        if (slot == EquipmentSlot.HEAD) s.addEnchantment(Enchantments.RESPIRATION, 3);
        return s;
    }

    private static void tickSetBonuses(MinecraftServer server) {
        for (ServerPlayerEntity p : server.getPlayerManager().getPlayerList()) {
            String worn = null;
            int count = 0;
            for (EquipmentSlot slot : ARMOR_SLOTS) {
                String k = kindOf(p.getEquippedStack(slot));
                if (k == null || !k.startsWith("set:")) break;
                if (worn == null) worn = k;
                if (!worn.equals(k)) break;
                count++;
            }
            if (count < 4) continue;
            for (StatusEffectInstance e : set(worn.substring(4)).effects()) p.addStatusEffect(new StatusEffectInstance(e));
        }
    }

    /** A Rift Tome: read it to raise your magic level (stronger, faster weapon skills). */
    static ItemStack tome(int count) {
        ItemStack s = tagged(Items.ENCHANTED_BOOK, "tome:arcane", "Rift Tome", Formatting.AQUA,
                "Black Hole magic, written in starlight.", "Right-click to read: +1 magic level (max " + MAX_ARCANE + ").",
                "Each level: weapon skills +10% damage, -5% cooldown.");
        s.setCount(count);
        return s;
    }

    private static void readTome(ServerPlayerEntity player, ItemStack stack, String kind) {
        Data data = Data.get(player.getServer());
        int level = data.arcane.getOrDefault(player.getUuid(), 0);
        if (level >= MAX_ARCANE) {
            Helper.say(player, "Your magic is already at the top level (" + MAX_ARCANE + "). Keep this tome for a friend.");
            return;
        }
        data.arcane.put(player.getUuid(), level + 1);
        data.markDirty();
        stack.decrement(1);
        player.addExperienceLevels(5);
        ServerWorld w = player.getServerWorld();
        w.spawnParticles(ParticleTypes.ENCHANT, player.getX(), player.getY() + 1.5, player.getZ(), 60, 0.6, 0.8, 0.6, 1.0);
        w.playSound(null, player.getBlockPos(), SoundEvents.BLOCK_ENCHANTMENT_TABLE_USE, SoundCategory.PLAYERS, 1f, 0.8f);
        player.sendMessage(Text.literal("Magic level " + (level + 1) + "! Weapon skills now do +" + ((level + 1) * 10)
                + "% damage with " + ((level + 1) * 5) + "% shorter cooldowns. (+5 XP levels for enchanting)").formatted(Formatting.AQUA), false);
    }

    /** A strong enchanted book: one of the best enchantments at its top level. */
    static ItemStack book(Random rnd) {
        Enchantment[] good = {Enchantments.SHARPNESS, Enchantments.PROTECTION, Enchantments.EFFICIENCY, Enchantments.UNBREAKING,
                Enchantments.FORTUNE, Enchantments.LOOTING, Enchantments.POWER, Enchantments.FEATHER_FALLING,
                Enchantments.MENDING, Enchantments.SWEEPING, Enchantments.FIRE_ASPECT, Enchantments.SILK_TOUCH,
                Enchantments.INFINITY, Enchantments.DEPTH_STRIDER, Enchantments.SOUL_SPEED, Enchantments.SWIFT_SNEAK};
        Enchantment e = good[rnd.nextInt(good.length)];
        return EnchantedBookItem.forEnchantment(new EnchantmentLevelEntry(e, e.getMaxLevel()));
    }

    /** Diamond or netherite gear with a level-30 (treasure) enchant roll. */
    private static ItemStack gear(Random rnd) {
        Item[] items = {Items.DIAMOND_SWORD, Items.DIAMOND_PICKAXE, Items.DIAMOND_AXE, Items.DIAMOND_HELMET, Items.DIAMOND_CHESTPLATE,
                Items.DIAMOND_LEGGINGS, Items.DIAMOND_BOOTS, Items.BOW, Items.CROSSBOW, Items.TRIDENT, Items.NETHERITE_SWORD,
                Items.NETHERITE_PICKAXE, Items.NETHERITE_CHESTPLATE};
        ItemStack s = new ItemStack(items[rnd.nextInt(items.length)]);
        return EnchantmentHelper.enchant(rnd, s, 30, true);
    }

    /** What a Rift Cache gives: a handful of good things, sometimes armor from a boss set. */
    private static List<ItemStack> loot(Random rnd) {
        List<ItemStack> out = new ArrayList<>();
        out.add(gear(rnd));
        out.add(book(rnd));
        if (rnd.nextFloat() < 0.5f) out.add(gear(rnd));
        if (rnd.nextFloat() < 0.5f) out.add(book(rnd));
        if (rnd.nextFloat() < 0.35f) out.add(tome(1));
        if (rnd.nextFloat() < 0.25f) out.add(armor(SETS[rnd.nextInt(SETS.length)].id(), ARMOR_SLOTS[rnd.nextInt(4)]));
        ItemStack[] extras = {new ItemStack(Items.DIAMOND, 3 + rnd.nextInt(6)), new ItemStack(Items.NETHERITE_SCRAP, 1 + rnd.nextInt(3)),
                new ItemStack(Items.GOLDEN_APPLE, 2 + rnd.nextInt(3)), new ItemStack(Items.ENCHANTED_GOLDEN_APPLE),
                new ItemStack(Items.EXPERIENCE_BOTTLE, 16), new ItemStack(Items.TOTEM_OF_UNDYING), new ItemStack(Items.ENDER_PEARL, 8),
                new ItemStack(Items.LAPIS_LAZULI, 32)};
        out.add(extras[rnd.nextInt(extras.length)]);
        out.add(extras[rnd.nextInt(extras.length)]);
        return out;
    }

    /** Where the Rift Caches are: one on each bridge and two in each arena. */
    private static List<BlockPos> cachePositions() {
        List<BlockPos> out = new ArrayList<>();
        for (BossDef b : BOSSES) {
            int sx = Integer.signum(b.dx()), sz = Integer.signum(b.dz());
            out.add(new BlockPos(sx * 28 + (sx == 0 ? 2 : 0), Y + 1, sz * 28 + (sz == 0 ? 2 : 0)));
            int fx = b.dx() + sx * 9, fz = b.dz() + sz * 9; // far side of the arena
            out.add(new BlockPos(fx + (sx == 0 ? 3 : 0), Y + 1, fz + (sz == 0 ? 3 : 0)));
            out.add(new BlockPos(fx - (sx == 0 ? 3 : 0), Y + 1, fz - (sz == 0 ? 3 : 0)));
        }
        return out;
    }

    private static final long CACHE_COOLDOWN = 20 * 60 * 15; // each player can loot each cache every 15 minutes

    private static void buildCaches(ServerWorld w) {
        for (BlockPos p : cachePositions()) {
            w.getChunk(p.getX() >> 4, p.getZ() >> 4);
            if (w.getBlockState(p.down()).isAir()) w.setBlockState(p.down(), Blocks.POLISHED_BLACKSTONE.getDefaultState(), Block.NOTIFY_LISTENERS);
            w.setBlockState(p, Blocks.CHEST.getDefaultState(), Block.NOTIFY_LISTENERS);
            w.setBlockState(p.up(), Blocks.SOUL_LANTERN.getDefaultState(), Block.NOTIFY_LISTENERS);
            if (w.getBlockEntity(p) instanceof ChestBlockEntity chest) chest.setCustomName(Text.literal("Rift Cache"));
        }
    }

    /** Right-clicking a Rift Cache gives that player their own loot (everyone gets their own, nobody steals it). */
    static ActionResult onUseBlock(PlayerEntity p, World w, Hand hand, BlockHitResult hit) {
        if (w.isClient || !w.getRegistryKey().equals(WORLD)) return ActionResult.PASS;
        BlockPos pos = hit.getBlockPos();
        if (!w.getBlockState(pos).isOf(Blocks.CHEST) || !cachePositions().contains(pos)) return ActionResult.PASS;
        if (!(p instanceof ServerPlayerEntity player) || p instanceof FakePlayer) return ActionResult.PASS;
        if (hand != Hand.MAIN_HAND) return ActionResult.SUCCESS;
        ServerWorld world = (ServerWorld) w;
        Data data = Data.get(world.getServer());
        String key = player.getUuidAsString() + "|" + pos.asLong();
        long ready = data.looted.getOrDefault(key, 0L);
        if (world.getTime() < ready) {
            player.sendMessage(Text.literal("This Rift Cache is empty for you. It refills in "
                    + Math.max(1, (ready - world.getTime()) / 1200) + " minutes.").formatted(Formatting.GRAY), true);
            return ActionResult.SUCCESS;
        }
        data.looted.put(key, world.getTime() + CACHE_COOLDOWN);
        data.markDirty();
        List<ItemStack> items = loot(world.getRandom());
        for (ItemStack s : items) player.getInventory().offerOrDrop(s);
        world.playSound(null, pos, SoundEvents.BLOCK_CHEST_OPEN, SoundCategory.BLOCKS, 0.8f, 0.7f);
        world.spawnParticles(ParticleTypes.REVERSE_PORTAL, pos.getX() + 0.5, pos.getY() + 1, pos.getZ() + 0.5, 30, 0.3, 0.4, 0.3, 0.05);
        player.sendMessage(Text.literal("Rift Cache: " + items.size() + " items! It refills for you in 15 minutes.")
                .formatted(Formatting.LIGHT_PURPLE), true);
        return ActionResult.SUCCESS;
    }

    // ---------------------------------------------------------------------------------------
    // Weapon skills
    // ---------------------------------------------------------------------------------------

    private static boolean target(Entity e, PlayerEntity owner) {
        return e instanceof LivingEntity le && le.isAlive() && e instanceof Monster && e != owner
                && !e.getCommandTags().contains(Helper.TAG);
    }

    private static void skill(ServerPlayerEntity player, String kind) {
        ServerWorld world = player.getServerWorld();
        String key = player.getUuidAsString() + "|" + kind;
        long now = world.getServer().getTicks();
        long ready = COOLDOWNS.getOrDefault(key, 0L);
        if (now < ready) {
            player.sendMessage(Text.literal("Skill ready in " + ((ready - now) / 20 + 1) + " s").formatted(Formatting.GRAY), true);
            return;
        }
        int arcane = Data.get(world.getServer()).arcane.getOrDefault(player.getUuid(), 0);
        float power = 1f + 0.1f * arcane; // +10% skill damage per magic level
        int cooldown;
        switch (kind) {
            case "ashfall" -> { // Ash Whirl
                for (Entity e : world.getOtherEntities(player, player.getBoundingBox().expand(4.5, 1.5, 4.5), x -> target(x, player))) {
                    LivingEntity le = (LivingEntity) e;
                    le.damage(player.getDamageSources().playerAttack(player), 12 * power);
                    le.setOnFireFor(5);
                    Vec3d push = e.getPos().subtract(player.getPos()).multiply(1, 0, 1).normalize().multiply(0.8);
                    le.addVelocity(push.x, 0.3, push.z);
                    le.velocityModified = true;
                }
                for (int i = 0; i < 24; i++) {
                    double a = i * Math.PI / 12;
                    world.spawnParticles(ParticleTypes.FLAME, player.getX() + Math.cos(a) * 3, player.getY() + 1, player.getZ() + Math.sin(a) * 3, 2, 0.1, 0.1, 0.1, 0.01);
                }
                world.spawnParticles(ParticleTypes.SWEEP_ATTACK, player.getX(), player.getY() + 1, player.getZ(), 6, 1.5, 0.2, 1.5, 0);
                world.playSound(null, player.getBlockPos(), SoundEvents.ENTITY_PLAYER_ATTACK_SWEEP, SoundCategory.PLAYERS, 1f, 0.6f);
                world.playSound(null, player.getBlockPos(), SoundEvents.ITEM_FIRECHARGE_USE, SoundCategory.PLAYERS, 0.7f, 0.8f);
                cooldown = 100;
            }
            case "duskfang" -> { // Moonless Step
                Vec3d look = player.getRotationVector().multiply(1, 0, 1).normalize();
                Vec3d start = player.getPos();
                Box path = new Box(start, start.add(look.multiply(8))).expand(1.2, 1.5, 1.2);
                for (Entity e : world.getOtherEntities(player, path, x -> target(x, player))) {
                    ((LivingEntity) e).damage(player.getDamageSources().playerAttack(player), 11 * power);
                }
                player.setVelocity(look.x * 2.4, 0.15, look.z * 2.4);
                player.velocityModified = true;
                player.addStatusEffect(new StatusEffectInstance(StatusEffects.RESISTANCE, 20, 2));
                for (int i = 0; i <= 8; i++) {
                    Vec3d p = start.add(look.multiply(i));
                    world.spawnParticles(ParticleTypes.PORTAL, p.x, p.y + 1, p.z, 6, 0.2, 0.4, 0.2, 0.2);
                }
                world.playSound(null, player.getBlockPos(), SoundEvents.ENTITY_ENDERMAN_TELEPORT, SoundCategory.PLAYERS, 0.8f, 1.4f);
                cooldown = 80;
            }
            case "maul" -> { // Collapse
                List<Entity> near = world.getOtherEntities(player, player.getBoundingBox().expand(8, 3, 8), x -> target(x, player));
                for (Entity e : near) {
                    Vec3d to = player.getPos().subtract(e.getPos());
                    e.setVelocity(to.x * 0.25, 0.9, to.z * 0.25);
                    e.velocityModified = true;
                    ((LivingEntity) e).damage(player.getDamageSources().playerAttack(player), 14 * power);
                }
                world.spawnParticles(ParticleTypes.REVERSE_PORTAL, player.getX(), player.getY() + 0.5, player.getZ(), 120, 4, 0.5, 4, 0.05);
                world.spawnParticles(ParticleTypes.EXPLOSION, player.getX(), player.getY(), player.getZ(), 3, 1, 0, 1, 0);
                world.playSound(null, player.getBlockPos(), SoundEvents.ENTITY_GENERIC_EXPLODE, SoundCategory.PLAYERS, 0.6f, 0.6f);
                cooldown = 160;
            }
            case "staff" -> { // Starless Beam
                Vec3d eye = player.getEyePos();
                Vec3d look = player.getRotationVector();
                LivingEntity hit = null;
                double reach = 32;
                for (double d = 1; d <= 32 && hit == null; d += 0.5) {
                    Vec3d p = eye.add(look.multiply(d));
                    BlockPos bp = BlockPos.ofFloored(p);
                    if (world.getBlockState(bp).isSolidBlock(world, bp)) {
                        reach = d;
                        break;
                    }
                    for (Entity e : world.getOtherEntities(player, new Box(p, p).expand(0.6), x -> target(x, player))) {
                        hit = (LivingEntity) e;
                        reach = d;
                        break;
                    }
                }
                for (double d = 1; d <= reach; d += 0.6) {
                    Vec3d p = eye.add(look.multiply(d));
                    world.spawnParticles(ParticleTypes.END_ROD, p.x, p.y, p.z, 1, 0.02, 0.02, 0.02, 0);
                    world.spawnParticles(ParticleTypes.SQUID_INK, p.x, p.y, p.z, 1, 0.05, 0.05, 0.05, 0);
                }
                if (hit != null) {
                    hit.damage(player.getDamageSources().indirectMagic(player, player), 16 * power);
                    world.spawnParticles(ParticleTypes.SONIC_BOOM, hit.getX(), hit.getBodyY(0.5), hit.getZ(), 1, 0, 0, 0, 0);
                }
                world.playSound(null, player.getBlockPos(), SoundEvents.ENTITY_ILLUSIONER_CAST_SPELL, SoundCategory.PLAYERS, 0.8f, 0.7f);
                cooldown = 40;
            }
            default -> {
                return;
            }
        }
        COOLDOWNS.put(key, now + Math.round(cooldown * (1 - 0.05f * arcane))); // -5% cooldown per magic level
    }
}
