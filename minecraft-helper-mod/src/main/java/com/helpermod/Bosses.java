package com.helpermod;

import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerBossEvent;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.Mth;
import net.minecraft.world.BossEvent;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.animal.golem.IronGolem;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.monster.cubemob.MagmaCube;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import net.minecraft.world.phys.Vec3;
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
        final Mob boss;
        final ServerBossEvent bar;
        boolean calledHelp;
        int emptyTicks;

        Fight(Mob boss, ServerBossEvent bar) {
            this.boss = boss;
            this.bar = bar;
        }
    }

    private static final Map<String, Fight> FIGHTS = new HashMap<>();
    private static final Set<UUID> TOLD = new HashSet<>();

    static void reset() {
        for (Fight f : FIGHTS.values()) f.bar.removeAllPlayers();
        FIGHTS.clear();
        TOLD.clear();
    }

    /** Where each planet's arena is, and when its boss can be fought again. Saved with the world. */
    static final class Data extends SavedData {
        private static final String ID = "helpermod_bosses";
        private static final SavedDataType<Data> TYPE = Compat.dataType(ID, Data::new, Data::fromNbt, d -> d.save(new CompoundTag()));
        final Map<String, BlockPos> arenas = new HashMap<>();
        final Map<String, Long> rematchAt = new HashMap<>();
        final Map<String, Integer> wins = new HashMap<>();

        static Data get(MinecraftServer server) {
            return server.overworld().getDataStorage().computeIfAbsent(TYPE);
        }

        private static Data fromNbt(CompoundTag nbt) {
            Data d = new Data();
            ListTag list = nbt.getListOrEmpty("planets");
            for (int i = 0; i < list.size(); i++) {
                CompoundTag t = list.getCompoundOrEmpty(i);
                String key = t.getStringOr("planet", "");
                d.arenas.put(key, BlockPos.of(t.getLongOr("arena", 0L)));
                d.rematchAt.put(key, t.getLongOr("rematch", 0L));
                d.wins.put(key, t.getIntOr("wins", 0));
            }
            return d;
        }

                public CompoundTag save(CompoundTag nbt) {
            ListTag list = new ListTag();
            arenas.forEach((key, pos) -> {
                CompoundTag t = new CompoundTag();
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
        if (server.getTickCount() % 20 != 0) return;
        Data data = Data.get(server);
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player.isSpectator()) continue;
            ServerLevel world = player.level();
            Planets.Theme theme = Planets.themeOf(world);
            if (theme == null) continue;
            String key = Planets.keyOf(world);
            BlockPos arena = data.arenas.get(key);
            if (arena == null) {
                if (!player.onGround() || player.isPassenger()) continue; // wait until they've landed
                arena = build(world, player, theme);
                if (arena == null) continue;
                data.arenas.put(key, arena);
                data.setDirty();
            }
            if (TOLD.add(uuidFor(player, key))) {
                Helper.say(player, "There's a boss arena on " + theme.display() + ", " + whereIs(player, arena)
                        + ". Stand on the lodestone in the middle to call the " + theme.boss().name() + ". Beat it for "
                        + theme.boss().reward() + ".");
            }
            if (FIGHTS.containsKey(key)) continue;
            if (player.blockPosition().distSqr(arena.above()) > 2.5 * 2.5) continue;
            long now = world.getGameTime();
            long ready = data.rematchAt.getOrDefault(key, 0L);
            if (now < ready) {
                player.sendOverlayMessage(Component.literal("The " + theme.boss().name() + " is resting. Come back in "
                        + Math.max(1, (ready - now) / 1200) + " minutes."));
                continue;
            }
            start(world, arena, theme, key);
        }
    }

    private static UUID uuidFor(ServerPlayer player, String key) {
        return UUID.nameUUIDFromBytes((player.getStringUUID() + "|" + key).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    /** /helper boss: where's this planet's arena? */
    static void tellWhere(ServerPlayer player) {
        ServerLevel world = player.level();
        Planets.Theme theme = Planets.themeOf(world);
        if (theme == null) {
            Helper.say(player, "There are planet bosses on the Moon, Mars, Mercury, Venus, Glacio, Europa, Io, Ceres, Titan and Pluto. "
                    + "Fly there with an Ad Astra rocket.");
            return;
        }
        BlockPos arena = Data.get(player.level().getServer()).arenas.get(Planets.keyOf(world));
        if (arena == null) {
            Helper.say(player, "The boss arena on " + theme.display() + " appears near you once you're standing on the ground.");
            return;
        }
        Helper.say(player, "The " + theme.boss().name() + "'s arena is " + whereIs(player, arena)
                + ". Stand on the lodestone in the middle to call it.");
    }

    private static String whereIs(ServerPlayer player, BlockPos arena) {
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
        if (i == null || !BuiltInRegistries.BLOCK.containsKey(i)) return fallback;
        Block b = BuiltInRegistries.BLOCK.getValue(i);
        return b == Blocks.AIR ? fallback : b.defaultBlockState();
    }

    /** Build a round arena on the surface 40 blocks from the player, and return its centre (the lodestone). */
    private static BlockPos build(ServerLevel world, ServerPlayer player, Planets.Theme theme) {
        double angle = world.getRandom().nextDouble() * Math.PI * 2;
        int cx = Mth.floor(player.getX() + Math.cos(angle) * 40);
        int cz = Mth.floor(player.getZ() + Math.sin(angle) * 40);
        world.getChunk(cx >> 4, cz >> 4); // make sure it's loaded
        int y = world.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, cx, cz);
        if (y <= world.getMinY() + 4 || y >= (world.getMaxY() + 1) - 12) return null;
        BlockState floor = block(theme.floor(), Blocks.POLISHED_BLACKSTONE_BRICKS.defaultBlockState());
        BlockState pillar = block(theme.pillar(), Blocks.CHISELED_POLISHED_BLACKSTONE.defaultBlockState());
        BlockState under = Blocks.COBBLED_DEEPSLATE.defaultBlockState();
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
                    if (world.getBlockState(p).isRedstoneConductor(world, p)) break;
                    world.setBlock(p, under, Block.UPDATE_CLIENTS);
                }
                world.setBlock(new BlockPos(x, floorY, z), d > RADIUS - 0.5 ? pillar : floor, Block.UPDATE_CLIENTS);
                for (int ay = 1; ay <= 8; ay++) {
                    BlockPos p = new BlockPos(x, floorY + ay, z);
                    if (!world.getBlockState(p).isAir()) world.setBlock(p, Blocks.AIR.defaultBlockState(), Block.UPDATE_CLIENTS);
                }
            }
        }
        for (int k = 0; k < 8; k++) { // eight pillars with lights on top
            double a = k * Math.PI / 4;
            int x = cx + (int) Math.round(Math.cos(a) * (RADIUS - 1));
            int z = cz + (int) Math.round(Math.sin(a) * (RADIUS - 1));
            for (int py = 1; py <= 4; py++) world.setBlock(new BlockPos(x, floorY + py, z), pillar, Block.UPDATE_CLIENTS);
            world.setBlock(new BlockPos(x, floorY + 5, z), Blocks.SEA_LANTERN.defaultBlockState(), Block.UPDATE_CLIENTS);
        }
        BlockPos centre = new BlockPos(cx, floorY, cz);
        world.setBlock(centre, Blocks.LODESTONE.defaultBlockState(), Block.UPDATE_CLIENTS);
        return centre;
    }

    // ---------------------------------------------------------------------------------------
    // The fight
    // ---------------------------------------------------------------------------------------

    private static void start(ServerLevel world, BlockPos arena, Planets.Theme theme, String key) {
        EntityType<?> type = Planets.type(theme.boss().type());
        if (type == null) return;
        BlockPos at = arena.above().offset(0, 0, 6);
        Entity e = type.create(world, net.minecraft.world.entity.EntitySpawnReason.MOB_SUMMONED);
        if (!(e instanceof Mob boss)) {
            if (e != null) e.discard();
            return;
        }
        boss.snapTo(at.getX() + 0.5, at.getY(), at.getZ() + 0.5, 180f, 0f);
        boss.finalizeSpawn(world, world.getCurrentDifficultyAt(at), EntitySpawnReason.EVENT, null);
        if (boss instanceof MagmaCube cube) cube.setSize(6, true);
        Planets.Boss b = theme.boss();
        set(boss, Attributes.MAX_HEALTH, b.health());
        set(boss, Attributes.ATTACK_DAMAGE, b.damage());
        set(boss, Attributes.KNOCKBACK_RESISTANCE, 1.0);
        set(boss, Attributes.FOLLOW_RANGE, 48);
        boss.setHealth(boss.getMaxHealth());
        if (b.weapon() != null) {
            Identifier w = Identifier.tryParse(b.weapon());
            if (w != null && BuiltInRegistries.ITEM.containsKey(w)) boss.setItemSlot(EquipmentSlot.MAINHAND, new ItemStack(BuiltInRegistries.ITEM.getValue(w)));
        }
        for (EquipmentSlot slot : EquipmentSlot.values()) boss.setDropChance(slot, 0f);
        boss.setCustomName(Component.literal(b.name()).withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD));
        boss.setCustomNameVisible(true);
        boss.setPersistenceRequired();
        boss.addTag(TAG);
        ServerBossEvent bar = new ServerBossEvent(java.util.UUID.randomUUID(), Component.literal(b.name() + " of " + theme.display()), BossEvent.BossBarColor.RED, BossEvent.BossBarOverlay.NOTCHED_10);
        FIGHTS.put(key, new Fight(boss, bar)); // before spawning, so onEntityLoad knows it belongs to a fight
        world.addFreshEntity(boss);
        world.playSound(null, at, SoundEvents.WITHER_SPAWN, SoundSource.HOSTILE, 1.5f, 0.8f);
        world.sendParticles(ParticleTypes.EXPLOSION_EMITTER, at.getX() + 0.5, at.getY() + 1, at.getZ() + 0.5, 1, 0, 0, 0, 0);
        for (ServerPlayer p : world.players()) {
            if (p.blockPosition().distSqr(arena) < 96 * 96) Helper.say(p, "The " + b.name() + " has woken up!");
        }
    }

    private static void set(Mob mob, net.minecraft.core.Holder<net.minecraft.world.entity.ai.attributes.Attribute> attr, double value) {
        AttributeInstance inst = mob.getAttribute(attr);
        if (inst != null) inst.setBaseValue(value);
    }

    /** Returns true when the fight is over (won or abandoned). */
    private static boolean tickFight(MinecraftServer server, String key, Fight f) {
        Mob boss = f.boss;
        ServerLevel world = (ServerLevel) boss.level();
        Data data = Data.get(server);
        BlockPos arena = data.arenas.get(key);
        Planets.Theme theme = Planets.themeOf(world);
        if (arena == null || theme == null) {
            end(f, true);
            return true;
        }
        if (boss.isDeadOrDying() || (boss.isRemoved() && boss.getRemovalReason() == Entity.RemovalReason.KILLED)) {
            win(world, arena, theme, key, f, data);
            return true;
        }
        if (boss.isRemoved()) { // unloaded or despawned: call it off, the arena re-arms
            end(f, false);
            return true;
        }
        f.bar.setProgress(boss.getHealth() / boss.getMaxHealth());
        boolean anyone = false;
        for (ServerPlayer p : world.players()) {
            boolean near = !p.isSpectator() && p.blockPosition().distSqr(arena) < 64 * 64;
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
        if (server.getTickCount() % 20 == 0) {
            if (boss.getTarget() == null || !boss.getTarget().isAlive()) {
                ServerPlayer nearest = null;
                double best = 40 * 40;
                for (ServerPlayer p : world.players()) {
                    if (p.isSpectator() || p.isCreative()) continue;
                    double d = p.distanceToSqr(boss);
                    if (d < best) {
                        best = d;
                        nearest = p;
                    }
                }
                if (nearest != null) {
                    boss.setTarget(nearest);
                    if (boss instanceof IronGolem golem) golem.setPersistentAngerTarget(net.minecraft.world.entity.EntityReference.of(nearest.getUUID()));
                }
            }
            if (boss.distanceToSqr(Vec3.atCenterOf(arena)) > (RADIUS + 10) * (RADIUS + 10)) { // dragged out: back to the arena
                boss.teleportTo(arena.getX() + 0.5, arena.getY() + 1, arena.getZ() + 6.5);
            }
        }
        if (!f.calledHelp && boss.getHealth() < boss.getMaxHealth() / 2) {
            f.calledHelp = true;
            for (ServerPlayer p : world.players()) {
                if (p.blockPosition().distSqr(arena) < 64 * 64) Helper.say(p, "The " + theme.boss().name() + " calls for help!");
            }
            int spawned = 0;
            for (String id : theme.mobs()) {
                EntityType<?> t = Planets.type(id);
                if (t == null) continue;
                double a = spawned * Math.PI / 2;
                BlockPos at = arena.above().offset((int) Math.round(Math.cos(a) * 8), 0, (int) Math.round(Math.sin(a) * 8));
                Entity minion = t.spawn(world, at, EntitySpawnReason.EVENT);
                if (minion != null) minion.addTag(Planets.MOB_TAG);
                if (++spawned >= 4) break;
            }
        }
        return false;
    }

    private static void win(ServerLevel world, BlockPos arena, Planets.Theme theme, String key, Fight f, Data data) {
        end(f, false);
        data.rematchAt.put(key, world.getGameTime() + REMATCH_TICKS);
        data.wins.merge(key, 1, Integer::sum);
        data.setDirty();
        List<ItemStack> loot = Planets.rewards(theme);
        Vec3 at = Vec3.atCenterOf(arena.above());
        for (ItemStack stack : loot) {
            ItemEntity item = new ItemEntity(world, at.x, at.y + 0.5, at.z, stack);
            item.setDefaultPickUpDelay();
            world.addFreshEntity(item);
        }
        world.playSound(null, arena, SoundEvents.UI_TOAST_CHALLENGE_COMPLETE, SoundSource.PLAYERS, 1f, 1f);
        world.sendParticles(ParticleTypes.TOTEM_OF_UNDYING, at.x, at.y + 1, at.z, 60, 1.5, 1.5, 1.5, 0.3);
        StringBuilder what = new StringBuilder();
        for (ItemStack s : loot) {
            if (!what.isEmpty()) what.append(", ");
            what.append(s.getCount()).append(" ").append(s.getHoverName().getString());
        }
        for (ServerPlayer p : world.players()) {
            if (p.blockPosition().distSqr(arena) < 96 * 96) {
                Helper.say(p, "You beat the " + theme.boss().name() + "! It dropped " + what + " on the lodestone. "
                        + "That's " + theme.boss().reward() + ".");
            }
        }
    }

    private static void end(Fight f, boolean discardBoss) {
        f.bar.removeAllPlayers();
        if (discardBoss && !f.boss.isRemoved()) f.boss.discard();
    }

    /** A boss left over from before a restart has no fight to belong to: remove it (the arena re-arms). */
    static void onEntityLoad(Entity entity, ServerLevel world) {
        if (!entity.entityTags().contains(TAG)) return;
        world.getServer().execute(() -> {
            for (Fight f : FIGHTS.values()) if (f.boss == entity) return;
            if (!entity.isRemoved()) entity.discard();
        });
    }
}
