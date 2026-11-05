package com.helpermod;

import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.SpawnReason;
import net.minecraft.entity.attribute.EntityAttributeInstance;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.boss.BossBar;
import net.minecraft.entity.boss.ServerBossBar;
import net.minecraft.entity.mob.MagmaCubeEntity;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.passive.IronGolemEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.Heightmap;
import net.minecraft.world.PersistentState;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * A boss on every planet. The first time someone lands on a planet, a boss arena is built on the surface
 * nearby. Stand on the lodestone in the middle to call the planet's boss. It has a boss bar, gets help
 * from the planet's monsters when it's hurt, and drops what you need to build the rocket for the next
 * planet. It can be fought again one Minecraft day later.
 */
final class Bosses {
    private Bosses() {}

    static final String TAG = "helpermod_boss";
    private static final int RADIUS = 12;
    private static final long REMATCH_TICKS = 24000;

    /** A fight going on right now, per planet. Not saved: a restart ends the fight and the arena re-arms. */
    private static final class Fight {
        final MobEntity boss;
        final ServerBossBar bar;
        boolean calledHelp;
        int emptyTicks;

        Fight(MobEntity boss, ServerBossBar bar) {
            this.boss = boss;
            this.bar = bar;
        }
    }

    private static final Map<String, Fight> FIGHTS = new HashMap<>();
    private static final Set<UUID> TOLD = new HashSet<>();

    static void reset() {
        for (Fight f : FIGHTS.values()) f.bar.clearPlayers();
        FIGHTS.clear();
        TOLD.clear();
    }

    /** Where each planet's arena is, and when its boss can be fought again. Saved with the world. */
    static final class Data extends PersistentState {
        private static final String ID = "helpermod_bosses";
        final Map<String, BlockPos> arenas = new HashMap<>();
        final Map<String, Long> rematchAt = new HashMap<>();
        final Map<String, Integer> wins = new HashMap<>();

        static Data get(MinecraftServer server) {
            return server.getOverworld().getPersistentStateManager().getOrCreate(Data::fromNbt, Data::new, ID);
        }

        private static Data fromNbt(NbtCompound nbt) {
            Data d = new Data();
            NbtList list = nbt.getList("planets", NbtElement.COMPOUND_TYPE);
            for (int i = 0; i < list.size(); i++) {
                NbtCompound t = list.getCompound(i);
                String key = t.getString("planet");
                d.arenas.put(key, BlockPos.fromLong(t.getLong("arena")));
                d.rematchAt.put(key, t.getLong("rematch"));
                d.wins.put(key, t.getInt("wins"));
            }
            return d;
        }

        @Override
        public NbtCompound writeNbt(NbtCompound nbt) {
            NbtList list = new NbtList();
            arenas.forEach((key, pos) -> {
                NbtCompound t = new NbtCompound();
                t.putString("planet", key);
                t.putLong("arena", pos.asLong());
                t.putLong("rematch", rematchAt.getOrDefault(key, 0L));
                t.putInt("wins", wins.getOrDefault(key, 0));
                list.add(t);
            });
            nbt.put("planets", list);
            return nbt;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Ticking
    // ---------------------------------------------------------------------------------------

    static void tick(MinecraftServer server) {
        FIGHTS.entrySet().removeIf(e -> tickFight(server, e.getKey(), e.getValue()));
        if (server.getTicks() % 20 != 0) return;
        Data data = Data.get(server);
        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            if (player.isSpectator()) continue;
            ServerWorld world = player.getServerWorld();
            Planets.Theme theme = Planets.themeOf(world);
            if (theme == null) continue;
            String key = Planets.keyOf(world);
            BlockPos arena = data.arenas.get(key);
            if (arena == null) {
                if (!player.isOnGround() || player.hasVehicle()) continue; // wait until they've landed
                arena = build(world, player, theme);
                if (arena == null) continue;
                data.arenas.put(key, arena);
                data.markDirty();
            }
            if (TOLD.add(uuidFor(player, key))) {
                Helper.say(player, "There's a boss arena on " + theme.display() + ", " + whereIs(player, arena)
                        + ". Stand on the lodestone in the middle to call the " + theme.boss().name() + ". Beat it for "
                        + theme.boss().reward() + ".");
            }
            if (FIGHTS.containsKey(key)) continue;
            if (player.getBlockPos().getSquaredDistance(arena.up()) > 2.5 * 2.5) continue;
            long now = world.getTime();
            long ready = data.rematchAt.getOrDefault(key, 0L);
            if (now < ready) {
                player.sendMessage(Text.literal("The " + theme.boss().name() + " is resting. Come back in "
                        + Math.max(1, (ready - now) / 1200) + " minutes."), true);
                continue;
            }
            start(world, arena, theme, key);
        }
    }

    private static UUID uuidFor(ServerPlayerEntity player, String key) {
        return UUID.nameUUIDFromBytes((player.getUuidAsString() + "|" + key).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    /** /helper boss: where's this planet's arena? */
    static void tellWhere(ServerPlayerEntity player) {
        ServerWorld world = player.getServerWorld();
        Planets.Theme theme = Planets.themeOf(world);
        if (theme == null) {
            Helper.say(player, "There are planet bosses on the Moon, Mars, Mercury, Venus, Glacio, Europa, Io, Ceres, Titan and Pluto. "
                    + "Fly there with an Ad Astra rocket.");
            return;
        }
        BlockPos arena = Data.get(player.getServer()).arenas.get(Planets.keyOf(world));
        if (arena == null) {
            Helper.say(player, "The boss arena on " + theme.display() + " appears near you once you're standing on the ground.");
            return;
        }
        Helper.say(player, "The " + theme.boss().name() + "'s arena is " + whereIs(player, arena)
                + ". Stand on the lodestone in the middle to call it.");
    }

    private static String whereIs(ServerPlayerEntity player, BlockPos arena) {
        double dx = arena.getX() + 0.5 - player.getX(), dz = arena.getZ() + 0.5 - player.getZ();
        int dist = (int) Math.round(Math.sqrt(dx * dx + dz * dz));
        if (dist < 8) return "right here";
        String[] dirs = {"south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"};
        double deg = Math.toDegrees(Math.atan2(-dx, dz));
        int i = Math.floorMod(Math.round((float) (deg / 45.0)), 8);
        return dist + " blocks to the " + dirs[i] + " (at " + arena.getX() + ", " + arena.getY() + ", " + arena.getZ() + ")";
    }

    // ---------------------------------------------------------------------------------------
    // The arena
    // ---------------------------------------------------------------------------------------

    private static BlockState block(String id, BlockState fallback) {
        Identifier i = Identifier.tryParse(id);
        if (i == null || !Registries.BLOCK.containsId(i)) return fallback;
        Block b = Registries.BLOCK.get(i);
        return b == Blocks.AIR ? fallback : b.getDefaultState();
    }

    /** Build a round arena on the surface 40 blocks from the player, and return its centre (the lodestone). */
    private static BlockPos build(ServerWorld world, ServerPlayerEntity player, Planets.Theme theme) {
        double angle = world.getRandom().nextDouble() * Math.PI * 2;
        int cx = MathHelper.floor(player.getX() + Math.cos(angle) * 40);
        int cz = MathHelper.floor(player.getZ() + Math.sin(angle) * 40);
        world.getChunk(cx >> 4, cz >> 4); // make sure it's loaded
        int y = world.getTopY(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, cx, cz);
        if (y <= world.getBottomY() + 4 || y >= world.getTopY() - 12) return null;
        BlockState floor = block(theme.floor(), Blocks.POLISHED_BLACKSTONE_BRICKS.getDefaultState());
        BlockState pillar = block(theme.pillar(), Blocks.CHISELED_POLISHED_BLACKSTONE.getDefaultState());
        BlockState under = Blocks.COBBLED_DEEPSLATE.getDefaultState();
        int floorY = y - 1;
        for (int dx = -RADIUS; dx <= RADIUS; dx++) {
            for (int dz = -RADIUS; dz <= RADIUS; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > RADIUS + 0.5) continue;
                int x = cx + dx, z = cz + dz;
                world.getChunk(x >> 4, z >> 4);
                // Fill below so it doesn't float, and clear above so there's room to fight.
                for (int fy = floorY - 1; fy >= floorY - 8; fy--) {
                    BlockPos p = new BlockPos(x, fy, z);
                    if (world.getBlockState(p).isSolidBlock(world, p)) break;
                    world.setBlockState(p, under, Block.NOTIFY_LISTENERS);
                }
                world.setBlockState(new BlockPos(x, floorY, z), d > RADIUS - 0.5 ? pillar : floor, Block.NOTIFY_LISTENERS);
                for (int ay = 1; ay <= 8; ay++) {
                    BlockPos p = new BlockPos(x, floorY + ay, z);
                    if (!world.getBlockState(p).isAir()) world.setBlockState(p, Blocks.AIR.getDefaultState(), Block.NOTIFY_LISTENERS);
                }
            }
        }
        for (int k = 0; k < 8; k++) { // eight pillars with lights on top
            double a = k * Math.PI / 4;
            int x = cx + (int) Math.round(Math.cos(a) * (RADIUS - 1));
            int z = cz + (int) Math.round(Math.sin(a) * (RADIUS - 1));
            for (int py = 1; py <= 4; py++) world.setBlockState(new BlockPos(x, floorY + py, z), pillar, Block.NOTIFY_LISTENERS);
            world.setBlockState(new BlockPos(x, floorY + 5, z), Blocks.SEA_LANTERN.getDefaultState(), Block.NOTIFY_LISTENERS);
        }
        BlockPos centre = new BlockPos(cx, floorY, cz);
        world.setBlockState(centre, Blocks.LODESTONE.getDefaultState(), Block.NOTIFY_LISTENERS);
        return centre;
    }

    // ---------------------------------------------------------------------------------------
    // The fight
    // ---------------------------------------------------------------------------------------

    private static void start(ServerWorld world, BlockPos arena, Planets.Theme theme, String key) {
        EntityType<?> type = Planets.type(theme.boss().type());
        if (type == null) return;
        BlockPos at = arena.up().add(0, 0, 6);
        Entity e = type.create(world);
        if (!(e instanceof MobEntity boss)) {
            if (e != null) e.discard();
            return;
        }
        boss.refreshPositionAndAngles(at.getX() + 0.5, at.getY(), at.getZ() + 0.5, 180f, 0f);
        boss.initialize(world, world.getLocalDifficulty(at), SpawnReason.EVENT, null, null);
        if (boss instanceof MagmaCubeEntity cube) cube.setSize(6, true);
        Planets.Boss b = theme.boss();
        set(boss, EntityAttributes.GENERIC_MAX_HEALTH, b.health());
        set(boss, EntityAttributes.GENERIC_ATTACK_DAMAGE, b.damage());
        set(boss, EntityAttributes.GENERIC_KNOCKBACK_RESISTANCE, 1.0);
        set(boss, EntityAttributes.GENERIC_FOLLOW_RANGE, 48);
        boss.setHealth(boss.getMaxHealth());
        if (b.weapon() != null) {
            Identifier w = Identifier.tryParse(b.weapon());
            if (w != null && Registries.ITEM.containsId(w)) boss.equipStack(EquipmentSlot.MAINHAND, new ItemStack(Registries.ITEM.get(w)));
        }
        for (EquipmentSlot slot : EquipmentSlot.values()) boss.setEquipmentDropChance(slot, 0f);
        boss.setCustomName(Text.literal(b.name()).formatted(Formatting.GOLD, Formatting.BOLD));
        boss.setCustomNameVisible(true);
        boss.setPersistent();
        boss.addCommandTag(TAG);
        ServerBossBar bar = new ServerBossBar(Text.literal(b.name() + " of " + theme.display()), BossBar.Color.RED, BossBar.Style.NOTCHED_10);
        FIGHTS.put(key, new Fight(boss, bar)); // before spawning, so onEntityLoad knows it belongs to a fight
        world.spawnEntity(boss);
        world.playSound(null, at, SoundEvents.ENTITY_WITHER_SPAWN, SoundCategory.HOSTILE, 1.5f, 0.8f);
        world.spawnParticles(ParticleTypes.EXPLOSION_EMITTER, at.getX() + 0.5, at.getY() + 1, at.getZ() + 0.5, 1, 0, 0, 0, 0);
        for (ServerPlayerEntity p : world.getPlayers()) {
            if (p.getBlockPos().getSquaredDistance(arena) < 96 * 96) Helper.say(p, "The " + b.name() + " has woken up!");
        }
    }

    private static void set(MobEntity mob, net.minecraft.entity.attribute.EntityAttribute attr, double value) {
        EntityAttributeInstance inst = mob.getAttributeInstance(attr);
        if (inst != null) inst.setBaseValue(value);
    }

    /** Returns true when the fight is over (won or abandoned). */
    private static boolean tickFight(MinecraftServer server, String key, Fight f) {
        MobEntity boss = f.boss;
        ServerWorld world = (ServerWorld) boss.getWorld();
        Data data = Data.get(server);
        BlockPos arena = data.arenas.get(key);
        Planets.Theme theme = Planets.themeOf(world);
        if (arena == null || theme == null) {
            end(f, true);
            return true;
        }
        if (boss.isDead() || (boss.isRemoved() && boss.getRemovalReason() == Entity.RemovalReason.KILLED)) {
            win(world, arena, theme, key, f, data);
            return true;
        }
        if (boss.isRemoved()) { // unloaded or despawned: call it off, the arena re-arms
            end(f, false);
            return true;
        }
        f.bar.setPercent(boss.getHealth() / boss.getMaxHealth());
        boolean anyone = false;
        for (ServerPlayerEntity p : world.getPlayers()) {
            boolean near = !p.isSpectator() && p.getBlockPos().getSquaredDistance(arena) < 64 * 64;
            if (near) {
                anyone = true;
                f.bar.addPlayer(p);
            } else {
                f.bar.removePlayer(p);
            }
        }
        if (!anyone) {
            if (++f.emptyTicks > 600) { // everyone left for 30 s: the boss goes back to sleep
                end(f, true);
                return true;
            }
        } else {
            f.emptyTicks = 0;
        }
        if (server.getTicks() % 20 == 0) {
            if (boss.getTarget() == null || !boss.getTarget().isAlive()) {
                ServerPlayerEntity nearest = null;
                double best = 40 * 40;
                for (ServerPlayerEntity p : world.getPlayers()) {
                    if (p.isSpectator() || p.isCreative()) continue;
                    double d = p.squaredDistanceTo(boss);
                    if (d < best) {
                        best = d;
                        nearest = p;
                    }
                }
                if (nearest != null) {
                    boss.setTarget(nearest);
                    if (boss instanceof IronGolemEntity golem) golem.setAngryAt(nearest.getUuid());
                }
            }
            if (boss.squaredDistanceTo(Vec3d.ofCenter(arena)) > (RADIUS + 10) * (RADIUS + 10)) { // dragged out: back to the arena
                boss.requestTeleport(arena.getX() + 0.5, arena.getY() + 1, arena.getZ() + 6.5);
            }
        }
        if (!f.calledHelp && boss.getHealth() < boss.getMaxHealth() / 2) {
            f.calledHelp = true;
            for (ServerPlayerEntity p : world.getPlayers()) {
                if (p.getBlockPos().getSquaredDistance(arena) < 64 * 64) Helper.say(p, "The " + theme.boss().name() + " calls for help!");
            }
            int spawned = 0;
            for (String id : theme.mobs()) {
                EntityType<?> t = Planets.type(id);
                if (t == null) continue;
                double a = spawned * Math.PI / 2;
                BlockPos at = arena.up().add((int) Math.round(Math.cos(a) * 8), 0, (int) Math.round(Math.sin(a) * 8));
                Entity minion = t.spawn(world, at, SpawnReason.EVENT);
                if (minion != null) minion.addCommandTag(Planets.MOB_TAG);
                if (++spawned >= 4) break;
            }
        }
        return false;
    }

    private static void win(ServerWorld world, BlockPos arena, Planets.Theme theme, String key, Fight f, Data data) {
        end(f, false);
        data.rematchAt.put(key, world.getTime() + REMATCH_TICKS);
        data.wins.merge(key, 1, Integer::sum);
        data.markDirty();
        List<ItemStack> loot = Planets.rewards(theme);
        Vec3d at = Vec3d.ofCenter(arena.up());
        for (ItemStack stack : loot) {
            ItemEntity item = new ItemEntity(world, at.x, at.y + 0.5, at.z, stack);
            item.setToDefaultPickupDelay();
            world.spawnEntity(item);
        }
        world.playSound(null, arena, SoundEvents.UI_TOAST_CHALLENGE_COMPLETE, SoundCategory.PLAYERS, 1f, 1f);
        world.spawnParticles(ParticleTypes.TOTEM_OF_UNDYING, at.x, at.y + 1, at.z, 60, 1.5, 1.5, 1.5, 0.3);
        StringBuilder what = new StringBuilder();
        for (ItemStack s : loot) {
            if (!what.isEmpty()) what.append(", ");
            what.append(s.getCount()).append(" ").append(s.getName().getString());
        }
        for (ServerPlayerEntity p : world.getPlayers()) {
            if (p.getBlockPos().getSquaredDistance(arena) < 96 * 96) {
                Helper.say(p, "You beat the " + theme.boss().name() + "! It dropped " + what + " on the lodestone. "
                        + "That's " + theme.boss().reward() + ".");
            }
        }
    }

    private static void end(Fight f, boolean discardBoss) {
        f.bar.clearPlayers();
        if (discardBoss && !f.boss.isRemoved()) f.boss.discard();
    }

    /** A boss left over from before a restart has no fight to belong to: remove it (the arena re-arms). */
    static void onEntityLoad(Entity entity, ServerWorld world) {
        if (!entity.getCommandTags().contains(TAG)) return;
        world.getServer().execute(() -> {
            for (Fight f : FIGHTS.values()) if (f.boss == entity) return;
            if (!entity.isRemoved()) entity.discard();
        });
    }
}
