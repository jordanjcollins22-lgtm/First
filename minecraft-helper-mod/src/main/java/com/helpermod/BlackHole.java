package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerBossEvent;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.RandomSource;
import net.minecraft.world.BossEvent;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.InteractionResultHolder;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.ai.attributes.Attribute;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.EnchantedBookItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.item.enchantment.EnchantmentInstance;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.ChestBlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
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

    static final ResourceKey<Level> WORLD = ResourceKey.create(Registries.DIMENSION, Identifier.fromNamespaceAndPath(HelperMod.MOD_ID, "black_hole"));
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

    static final class Data extends SavedData {
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
        final Map<UUID, CompoundTag> home = new HashMap<>();

        static Data get(MinecraftServer server) {
            return server.overworld().getDataStorage().computeIfAbsent(Data::fromNbt, Data::new, ID);
        }

        private static Data fromNbt(CompoundTag nbt) {
            Data d = new Data();
            d.built = nbt.getBooleanOr("built", false);
            d.cachesBuilt = nbt.getBooleanOr("cachesBuilt", false);
            CompoundTag a = nbt.getCompoundOrEmpty("arcane");
            for (String k : a.keySet()) d.arcane.put(UUID.fromString(k), a.getIntOr(k, 0));
            CompoundTag lo = nbt.getCompoundOrEmpty("looted");
            for (String k : lo.keySet()) d.looted.put(k, lo.getLongOr(k, 0L));
            CompoundTag b = nbt.getCompoundOrEmpty("beaten");
            for (String k : b.keySet()) {
                Set<String> set = new HashSet<>();
                ListTag l = b.getListOrEmpty(k);
                for (int i = 0; i < l.size(); i++) set.add(l.getStringOr(i, ""));
                d.beaten.put(UUID.fromString(k), set);
            }
            CompoundTag r = nbt.getCompoundOrEmpty("rematch");
            for (String k : r.keySet()) d.rematchAt.put(k, r.getLongOr(k, 0L));
            CompoundTag h = nbt.getCompoundOrEmpty("home");
            for (String k : h.keySet()) d.home.put(UUID.fromString(k), h.getCompoundOrEmpty(k));
            return d;
        }

        @Override
        public CompoundTag save(CompoundTag nbt) {
            nbt.putBoolean("built", built);
            nbt.putBoolean("cachesBuilt", cachesBuilt);
            CompoundTag a = new CompoundTag();
            arcane.forEach((k, v) -> a.putInt(k.toString(), v));
            nbt.put("arcane", a);
            CompoundTag lo = new CompoundTag();
            looted.forEach(lo::putLong);
            nbt.put("looted", lo);
            CompoundTag b = new CompoundTag();
            for (Map.Entry<UUID, Set<String>> e : beaten.entrySet()) {
                ListTag l = new ListTag();
                for (String s : e.getValue()) l.add(StringTag.valueOf(s));
                b.put(e.getKey().toString(), l);
            }
            nbt.put("beaten", b);
            CompoundTag r = new CompoundTag();
            rematchAt.forEach(r::putLong);
            nbt.put("rematch", r);
            CompoundTag h = new CompoundTag();
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
        final ServerLevel world;
        final Vec3 centre;
        int ticks;

        Vortex(ServerLevel world, Vec3 centre) {
            this.world = world;
            this.centre = centre;
        }
    }

    private static final class Fight {
        final BossDef def;
        final Mob boss;
        final ServerBossEvent bar;
        boolean enraged;
        int emptyTicks;

        Fight(BossDef def, Mob boss, ServerBossEvent bar) {
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
        for (Fight f : FIGHTS.values()) f.bar.removeAllPlayers();
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
            Vec3 v = o.getDeltaMovement();
            if (o.isAlive() && v.x * v.x + v.z * v.z < 0.0025 && !inVortex(o)) resting.add(o);
        }
        Set<ItemEntity> used = new HashSet<>();
        for (ItemEntity o : resting) {
            if (used.contains(o)) continue;
            List<ItemEntity> pile = new ArrayList<>();
            for (ItemEntity other : resting) {
                if (other.level() == o.level() && other.distanceToSqr(o) < 2.0 * 2.0) pile.add(other);
            }
            if (pile.size() < PILE) continue;
            used.addAll(pile);
            double x = 0, y = 0, z = 0;
            for (ItemEntity p : pile) {
                x += p.getX();
                y += p.getY();
                z += p.getZ();
            }
            ServerLevel world = (ServerLevel) o.level();
            Vec3 centre = new Vec3(x / pile.size(), y / pile.size(), z / pile.size());
            VORTICES.add(new Vortex(world, centre));
            world.playSound(null, BlockPos.containing(centre), SoundEvents.PORTAL_TRIGGER, SoundSource.BLOCKS, 0.6f, 1.6f);
            for (ServerPlayer p : world.players()) {
                if (p.distanceToSqr(centre) < 32 * 32) {
                    p.sendOverlayMessage(Component.literal("The ore pile is starting to spin...").withStyle(ChatFormatting.DARK_PURPLE));
                }
            }
        }
    }

    private static boolean inVortex(ItemEntity o) {
        for (Vortex v : VORTICES) if (v.world == o.level() && v.centre.distanceToSqr(o.position()) < 4 * 4) return true;
        return false;
    }

    private static boolean isOre(Entity e) {
        return e instanceof ItemEntity && e.entityTags().contains("helpermod_ore");
    }

    private static void tickVortices() {
        for (Iterator<Vortex> it = VORTICES.iterator(); it.hasNext(); ) {
            Vortex v = it.next();
            v.ticks++;
            AABB box = new AABB(v.centre, v.centre).inflate(4, 2, 4);
            List<Entity> ores = v.world.getEntities(null, box, BlackHole::isOre);
            double pull = (double) v.ticks / VORTEX_TICKS; // the circle shrinks as it spins faster
            for (Entity e : ores) {
                double dx = e.getX() - v.centre.x, dz = e.getZ() - v.centre.z;
                double r = Math.max(0.15, Math.sqrt(dx * dx + dz * dz));
                double target = 1.6 * (1 - pull) + 0.1;
                double spin = 0.18 + 0.35 * pull;
                double tx = -dz / r * spin, tz = dx / r * spin; // around the circle
                double in = (target - r) * 0.25; // towards the ring
                e.setDeltaMovement(tx + dx / r * in, 0.04 + 0.06 * pull + (v.centre.y + 0.4 - e.getY()) * 0.1, tz + dz / r * in);
                e.needsSync = true;
                e.setNoGravity(true);
            }
            if (v.ticks % 4 == 0) {
                v.world.sendParticles(ParticleTypes.REVERSE_PORTAL, v.centre.x, v.centre.y + 0.5, v.centre.z, 20, 0.8, 0.3, 0.8, 0.02);
                v.world.sendParticles(ParticleTypes.SQUID_INK, v.centre.x, v.centre.y + 0.5, v.centre.z, 4, 0.2, 0.2, 0.2, 0.01);
            }
            if (v.ticks < VORTEX_TICKS) continue;
            it.remove();
            int n = 0;
            for (Entity e : ores) {
                e.discard();
                n++;
            }
            if (n < PILE / 2) continue; // most of it got away (picked up or moved)
            v.world.sendParticles(ParticleTypes.SONIC_BOOM, v.centre.x, v.centre.y + 0.5, v.centre.z, 1, 0, 0, 0, 0);
            v.world.sendParticles(ParticleTypes.PORTAL, v.centre.x, v.centre.y + 0.5, v.centre.z, 80, 0.5, 0.5, 0.5, 1.0);
            v.world.playSound(null, BlockPos.containing(v.centre), SoundEvents.WARDEN_SONIC_BOOM, SoundSource.BLOCKS, 0.7f, 0.6f);
            ItemEntity drop = new ItemEntity(v.world, v.centre.x, v.centre.y + 0.5, v.centre.z, singularity(), 0, 0.2, 0);
            drop.setUnlimitedLifetime();
            v.world.addFreshEntity(drop);
            for (ServerPlayer p : v.world.players()) {
                if (p.distanceToSqr(v.centre) < 32 * 32) {
                    Helper.say(p, "Whoa! " + n + " ore just collapsed into a Singularity, a tiny black hole. Pick it up and "
                            + "right-click with it to fall in. There are bosses in there.");
                }
            }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Items
    // ---------------------------------------------------------------------------------------

    private static ItemStack tagged(Item item, String kind, String name, ChatFormatting color, String... lore) {
        ItemStack stack = new ItemStack(item);
        stack.getOrCreateTag().putString(NBT, kind);
        stack.setHoverName(Component.literal(name).withStyle(s -> s.withItalic(false)).withStyle(color));
        CompoundTag display = stack.getOrCreateTagElement("display");
        ListTag l = new ListTag();
        for (String line : lore) l.add(StringTag.valueOf(Component.Serializer.toJson(Component.literal(line).withStyle(ChatFormatting.GRAY))));
        display.put("Lore", l);
        return stack;
    }

    static ItemStack singularity() {
        ItemStack s = tagged(Items.ECHO_SHARD, "singularity", "Singularity", ChatFormatting.DARK_PURPLE,
                "A tiny black hole made of collapsed ore.", "Right-click to fall into the Black Hole.",
                "Right-click again inside to go home.");
        s.enchant(Enchantments.UNBREAKING, 1); // for the shine
        s.getOrCreateTag().putInt("HideFlags", 1);
        return s;
    }

    private static ItemStack enchanted(ItemStack s, Object... pairs) {
        for (int i = 0; i < pairs.length; i += 2) s.enchant((Enchantment) pairs[i], (Integer) pairs[i + 1]);
        return s;
    }

    static ItemStack weapon(String kind) {
        return switch (kind) {
            case "ashfall" -> enchanted(tagged(Items.NETHERITE_SWORD, "ashfall", "Ashfall Greatsword", ChatFormatting.GOLD,
                            "Dropped by the Ashen Warden.", "Skill (right-click): Ash Whirl, a burning spin", "that hits every monster around you."),
                    Enchantments.SHARPNESS, 5, Enchantments.FIRE_ASPECT, 2, Enchantments.UNBREAKING, 3);
            case "duskfang" -> enchanted(tagged(Items.NETHERITE_SWORD, "duskfang", "Duskfang Blade", ChatFormatting.LIGHT_PURPLE,
                            "Dropped by Duskfang, the Moonless Hunter.", "Skill (right-click): Moonless Step, dash forward", "and cut through everything in the way."),
                    Enchantments.SHARPNESS, 5, Enchantments.SWEEPING_EDGE, 3, Enchantments.UNBREAKING, 3);
            case "maul" -> enchanted(tagged(Items.NETHERITE_AXE, "maul", "Collapse Maul", ChatFormatting.DARK_AQUA,
                            "Dropped by the Hollow Colossus.", "Skill (right-click): Collapse, pull monsters in", "with gravity and slam them into the air."),
                    Enchantments.SHARPNESS, 5, Enchantments.UNBREAKING, 3);
            case "staff" -> enchanted(tagged(Items.BLAZE_ROD, "staff", "Starless Staff", ChatFormatting.DARK_PURPLE,
                            "Dropped by the Singularity Sovereign.", "Skill (right-click): Starless Beam, a ray of", "black starlight that hits the first monster."),
                    Enchantments.UNBREAKING, 1);
            default -> ItemStack.EMPTY;
        };
    }

    private static String kindOf(ItemStack stack) {
        CompoundTag nbt = stack.getTag();
        return nbt != null && nbt.contains(NBT) ? nbt.getString(NBT) : null;
    }

    // ---------------------------------------------------------------------------------------
    // Going in and out
    // ---------------------------------------------------------------------------------------

    static InteractionResultHolder<ItemStack> onUseItem(Player p, Level w, InteractionHand hand) {
        ItemStack stack = p.getItemInHand(hand);
        String kind = kindOf(stack);
        if (kind == null || kind.startsWith("set:")) return InteractionResultHolder.pass(stack); // armor equips as normal
        if (w.isClientSide()) return InteractionResultHolder.success(stack);
        if (!(p instanceof ServerPlayer player) || p instanceof FakePlayer) return InteractionResultHolder.pass(stack);
        if (kind.startsWith("tome:")) {
            readTome(player, stack, kind);
        } else if (kind.equals("singularity")) {
            if (player.level().dimension().equals(WORLD)) leave(player);
            else enter(player);
        } else {
            skill(player, kind);
        }
        return InteractionResultHolder.success(stack);
    }

    static void enter(ServerPlayer player) {
        MinecraftServer server = player.level().getServer();
        ServerLevel hole = server.getLevel(WORLD);
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
        CompoundTag home = new CompoundTag();
        home.putString("dim", player.level().dimension().location().toString());
        home.putDouble("x", player.getX());
        home.putDouble("y", player.getY());
        home.putDouble("z", player.getZ());
        data.home.put(player.getUUID(), home);
        data.setDirty();
        ServerLevel from = player.level();
        from.sendParticles(ParticleTypes.REVERSE_PORTAL, player.getX(), player.getY() + 1, player.getZ(), 60, 0.4, 0.8, 0.4, 0.1);
        from.playSound(null, player.blockPosition(), SoundEvents.END_PORTAL_SPAWN, SoundSource.PLAYERS, 0.6f, 1.4f);
        player.teleportTo(hole, 0.5, Y + 1, 4.5, 180f, 0f);
        player.addEffect(new MobEffectInstance(MobEffects.SLOW_FALLING, 200, 0));
        Helper.say(player, "Welcome to the Black Hole. Four bosses wait at the end of the bridges: the Ashen Warden (east), "
                + "Duskfang (west) and the Hollow Colossus (south). Beat all three and the Singularity Sovereign (north) wakes up. "
                + "Stand on the lodestone in an arena to call its boss. The chests with soul lanterns are Rift Caches: loot just for you, "
                + "refilled every 15 minutes. Right-click your Singularity to go home.");
    }

    static void leave(ServerPlayer player) {
        MinecraftServer server = player.level().getServer();
        Data data = Data.get(server);
        CompoundTag home = data.home.get(player.getUUID());
        ServerLevel to = server.overworld();
        double x, y, z;
        if (home != null) {
            Identifier dim = Identifier.tryParse(home.getString("dim"));
            ServerLevel w = dim == null ? null : server.getLevel(ResourceKey.create(Registries.DIMENSION, dim));
            if (w != null) to = w;
            x = home.getDoubleOr("x", 0.0);
            y = home.getDoubleOr("y", 0.0);
            z = home.getDoubleOr("z", 0.0);
        } else {
            BlockPos spawn = to.getSharedSpawnPos();
            x = spawn.getX() + 0.5;
            y = spawn.getY();
            z = spawn.getZ() + 0.5;
        }
        player.teleportTo(to, x, y, z, player.getYRot(), player.getXRot());
        Helper.say(player, "Back home. The Black Hole will be there when you need it.");
    }

    /** /helper blackhole */
    static void info(ServerPlayer player) {
        Data data = Data.get(player.level().getServer());
        Set<String> beaten = data.beaten(player.getUUID());
        Helper.say(player, "Black Hole: pile up " + PILE + " or more Tycoon ore in one spot (let it drop into a pit, or run your "
                + "conveyors in a loop with no collector). The pile spins in a circle and collapses into a Singularity. "
                + "Right-click with it to fall in.");
        int arcane = data.arcane.getOrDefault(player.getUUID(), 0);
        player.sendSystemMessage(Component.literal("  Magic level " + arcane + "/" + MAX_ARCANE + " (skills +" + (arcane * 10) + "% damage, -"
                + (arcane * 5) + "% cooldown). Read Rift Tomes to level up.").withStyle(ChatFormatting.LIGHT_PURPLE));
        for (BossDef b : BOSSES) {
            String where = b.dx() > 0 ? "east" : b.dx() < 0 ? "west" : b.dz() > 0 ? "south" : "north";
            player.sendSystemMessage(Component.literal((beaten.contains(b.id()) ? "  [beaten] " : "  ") + b.title() + " (" + where
                    + " bridge): drops " + b.reward() + " and " + b.coins() + " coins").withStyle(
                    beaten.contains(b.id()) ? ChatFormatting.GREEN : ChatFormatting.GRAY));
        }
    }

    /** /helper blackhole leave, in case the Singularity got lost. */
    static void leaveCommand(ServerPlayer player) {
        if (!player.level().dimension().equals(WORLD)) {
            Helper.say(player, "You're not in the Black Hole.");
            return;
        }
        leave(player);
    }

    // ---------------------------------------------------------------------------------------
    // Building the Black Hole: hub island, bridges, arenas
    // ---------------------------------------------------------------------------------------

    private static void set(ServerLevel w, int x, int y, int z, BlockState s) {
        w.setBlock(new BlockPos(x, y, z), s, Block.UPDATE_CLIENTS);
    }

    private static void disc(ServerLevel w, int cx, int cz, int r, BlockState floor, BlockState edge) {
        for (int dx = -r; dx <= r; dx++) {
            for (int dz = -r; dz <= r; dz++) {
                double d = Math.sqrt(dx * dx + dz * dz);
                if (d > r + 0.5) continue;
                w.getChunk((cx + dx) >> 4, (cz + dz) >> 4);
                set(w, cx + dx, Y, cz + dz, d > r - 0.5 ? edge : floor);
                int depth = (int) Math.round((r - d) * 0.8); // a rocky underside, like a floating island
                for (int k = 1; k <= depth; k++) set(w, cx + dx, Y - k, cz + dz, Blocks.BLACKSTONE.defaultBlockState());
            }
        }
    }

    private static void pillars(ServerLevel w, int cx, int cz, int r, int n, BlockState pillar, BlockState light) {
        for (int k = 0; k < n; k++) {
            double a = k * Math.PI * 2 / n;
            int x = cx + (int) Math.round(Math.cos(a) * r), z = cz + (int) Math.round(Math.sin(a) * r);
            for (int y = 1; y <= 4; y++) set(w, x, Y + y, z, pillar);
            set(w, x, Y + 5, z, light);
        }
    }

    private static void build(ServerLevel w) {
        BlockState floor = Blocks.POLISHED_BLACKSTONE_BRICKS.defaultBlockState();
        BlockState obsidian = Blocks.OBSIDIAN.defaultBlockState();
        // Hub
        disc(w, 0, 0, 10, floor, Blocks.CRYING_OBSIDIAN.defaultBlockState());
        for (int dx = -1; dx <= 1; dx++) for (int dz = -1; dz <= 1; dz++) set(w, dx, Y, dz, obsidian);
        set(w, 0, Y, 0, Blocks.CRYING_OBSIDIAN.defaultBlockState());
        pillars(w, 0, 0, 8, 8, obsidian, Blocks.END_ROD.defaultBlockState());
        // Bridges and arenas
        for (BossDef b : BOSSES) {
            int sx = Integer.signum(b.dx()), sz = Integer.signum(b.dz());
            for (int i = 10; i <= 46; i++) {
                for (int s = -1; s <= 1; s++) {
                    int x = sx * i + (sx == 0 ? s : 0), z = sz * i + (sz == 0 ? s : 0);
                    w.getChunk(x >> 4, z >> 4);
                    set(w, x, Y, z, Blocks.POLISHED_BLACKSTONE.defaultBlockState());
                    set(w, x, Y - 1, z, Blocks.BLACKSTONE.defaultBlockState());
                }
                if (i % 6 == 0) { // lanterns along both sides
                    int lx1 = sx * i + (sx == 0 ? 2 : 0), lz1 = sz * i + (sz == 0 ? 2 : 0);
                    int lx2 = sx * i - (sx == 0 ? 2 : 0), lz2 = sz * i - (sz == 0 ? 2 : 0);
                    set(w, lx1, Y, lz1, Blocks.POLISHED_BLACKSTONE.defaultBlockState());
                    set(w, lx2, Y, lz2, Blocks.POLISHED_BLACKSTONE.defaultBlockState());
                    set(w, lx1, Y + 1, lz1, Blocks.SOUL_LANTERN.defaultBlockState());
                    set(w, lx2, Y + 1, lz2, Blocks.SOUL_LANTERN.defaultBlockState());
                }
            }
            disc(w, b.dx(), b.dz(), 13, Blocks.DEEPSLATE_TILES.defaultBlockState(), b.edge().defaultBlockState());
            pillars(w, b.dx(), b.dz(), 11, 6, b.edge().defaultBlockState(), Blocks.SHROOMLIGHT.defaultBlockState());
            set(w, b.dx(), Y, b.dz(), Blocks.LODESTONE.defaultBlockState());
        }
    }

    // ---------------------------------------------------------------------------------------
    // Ticking: vortices, fights, calling bosses
    // ---------------------------------------------------------------------------------------

    static void tick(MinecraftServer server) {
        tickVortices();
        if (server.getTickCount() % 40 == 0) tickSetBonuses(server);
        FIGHTS.entrySet().removeIf(e -> tickFight(server, e.getValue()));
        if (server.getTickCount() % 20 != 0) return;
        ServerLevel hole = server.getLevel(WORLD);
        if (hole == null) return;
        Data data = Data.get(server);
        for (ServerPlayer player : hole.players()) {
            if (player.isSpectator()) continue;
            if (player.getY() < -20) { // fell off: back to the hub instead of dying in the void
                player.teleportTo(hole, 0.5, Y + 1, 4.5, player.getYRot(), player.getXRot());
                player.addEffect(new MobEffectInstance(MobEffects.SLOW_FALLING, 100, 0));
                Helper.say(player, "Careful! The Black Hole spat you back out at the hub.");
                continue;
            }
            for (BossDef b : BOSSES) {
                if (FIGHTS.containsKey(b.id())) continue;
                if (player.blockPosition().distSqr(altar(b).above()) > 2.5 * 2.5) continue;
                if (b.id().equals("sovereign")) {
                    Set<String> beaten = data.beaten(player.getUUID());
                    if (!(beaten.contains("ashen") && beaten.contains("dusk") && beaten.contains("colossus"))) {
                        player.sendOverlayMessage(Component.literal("The Singularity Sovereign sleeps. Beat the other three bosses first.")
                                .withStyle(ChatFormatting.DARK_PURPLE));
                        continue;
                    }
                }
                long ready = data.rematchAt.getOrDefault(b.id(), 0L);
                if (hole.getGameTime() < ready) {
                    player.sendOverlayMessage(Component.literal(b.name() + " is gathering strength. Back in "
                            + Math.max(1, (ready - hole.getGameTime()) / 1200) + " minutes."));
                    continue;
                }
                start(hole, b);
            }
        }
    }

    private static void attr(Mob mob, Attribute a, double v) {
        AttributeInstance inst = mob.getAttribute(a);
        if (inst != null) inst.setBaseValue(v);
    }

    private static void start(ServerLevel world, BossDef b) {
        EntityType<?> type = Planets.type(b.type());
        if (type == null) return;
        Entity e = type.create(world);
        if (!(e instanceof Mob boss)) {
            if (e != null) e.discard();
            return;
        }
        BlockPos at = altar(b).above();
        double ox = -Math.signum(b.dx()) * 7, oz = -Math.signum(b.dz()) * 7; // between the altar and the far edge
        boss.snapTo(at.getX() + 0.5 - ox, at.getY(), at.getZ() + 0.5 - oz, 0f, 0f);
        boss.finalizeSpawn(world, world.getCurrentDifficultyAt(at), EntitySpawnReason.EVENT, null, null);
        attr(boss, Attributes.MAX_HEALTH, b.health());
        attr(boss, Attributes.ATTACK_DAMAGE, b.damage());
        attr(boss, Attributes.MOVEMENT_SPEED, b.speed());
        attr(boss, Attributes.KNOCKBACK_RESISTANCE, 1.0);
        attr(boss, Attributes.FOLLOW_RANGE, 48);
        attr(boss, Attributes.ARMOR, 10);
        boss.setHealth(boss.getMaxHealth());
        if (b.weapon() != null) boss.setItemSlot(EquipmentSlot.MAINHAND, new ItemStack(b.weapon()));
        for (EquipmentSlot slot : EquipmentSlot.values()) boss.setDropChance(slot, 0f);
        boss.setCustomName(Component.literal(b.name()).withStyle(ChatFormatting.DARK_PURPLE, ChatFormatting.BOLD));
        boss.setCustomNameVisible(true);
        boss.setPersistenceRequired();
        boss.addTag(BOSS_TAG);
        boss.addTag(Planets.MOB_TAG);
        ServerBossEvent bar = new ServerBossEvent(Component.literal(b.title()), BossEvent.BossBarColor.PURPLE, BossEvent.BossBarOverlay.NOTCHED_10);
        bar.setDarkenScreen(true);
        FIGHTS.put(b.id(), new Fight(b, boss, bar));
        world.addFreshEntity(boss);
        world.playSound(null, at, SoundEvents.WITHER_SPAWN, SoundSource.HOSTILE, 1.2f, 0.6f);
        world.sendParticles(ParticleTypes.SCULK_SOUL, boss.getX(), boss.getY() + 1, boss.getZ(), 40, 0.6, 1, 0.6, 0.05);
        for (ServerPlayer p : world.players()) {
            if (p.distanceToSqr(Vec3.atCenterOf(at)) < 64 * 64) {
                p.sendSystemMessage(Component.literal(b.title().toUpperCase(java.util.Locale.ROOT)).withStyle(ChatFormatting.DARK_PURPLE, ChatFormatting.BOLD));
            }
        }
    }

    /** Returns true when the fight is over. */
    private static boolean tickFight(MinecraftServer server, Fight f) {
        Mob boss = f.boss;
        ServerLevel world = (ServerLevel) boss.level();
        BlockPos altar = altar(f.def);
        if (boss.isDeadOrDying() || (boss.isRemoved() && boss.getRemovalReason() == Entity.RemovalReason.KILLED)) {
            win(world, f);
            return true;
        }
        if (boss.isRemoved()) {
            f.bar.removeAllPlayers();
            return true;
        }
        f.bar.setProgress(boss.getHealth() / boss.getMaxHealth());
        boolean anyone = false;
        for (ServerPlayer p : world.players()) {
            boolean near = !p.isSpectator() && p.blockPosition().distSqr(altar) < 48 * 48;
            if (near) {
                anyone = true;
                f.bar.addPlayer(p);
            } else {
                f.bar.removePlayer(p);
            }
        }
        if (!anyone && ++f.emptyTicks > 600) { // everyone left: it fades away and can be called again
            boss.discard();
            f.bar.removeAllPlayers();
            return true;
        }
        if (anyone) f.emptyTicks = 0;
        // Leashed to its arena.
        if (boss.blockPosition().distSqr(altar) > 16 * 16 || boss.getY() < Y - 4) {
            boss.teleportTo(altar.getX() + 0.5, Y + 1, altar.getZ() + 0.5);
        }
        // Second phase at half health: faster, stronger, and it calls for help.
        if (!f.enraged && boss.getHealth() < boss.getMaxHealth() / 2) {
            f.enraged = true;
            f.bar.setColor(BossEvent.BossBarColor.RED);
            boss.addEffect(new MobEffectInstance(MobEffects.SPEED, 20 * 600, 1));
            boss.addEffect(new MobEffectInstance(MobEffects.STRENGTH, 20 * 600, 1));
            boss.addEffect(new MobEffectInstance(MobEffects.GLOWING, 20 * 600, 0));
            world.playSound(null, boss.blockPosition(), SoundEvents.ENDER_DRAGON_GROWL, SoundSource.HOSTILE, 1.2f, 0.8f);
            world.sendParticles(ParticleTypes.SOUL_FIRE_FLAME, boss.getX(), boss.getY() + 1, boss.getZ(), 60, 1, 1, 1, 0.1);
            EntityType<?> minion = Planets.type(f.def.minion());
            for (int i = 0; minion != null && i < 3; i++) {
                Entity m = minion.create(world);
                if (m == null) continue;
                double a = i * Math.PI * 2 / 3;
                m.snapTo(boss.getX() + Math.cos(a) * 3, boss.getY() + (minion == EntityType.VEX ? 2 : 0), boss.getZ() + Math.sin(a) * 3, 0, 0);
                m.addTag(Planets.MOB_TAG);
                world.addFreshEntity(m);
            }
            for (ServerPlayer p : world.players()) {
                if (p.blockPosition().distSqr(altar) < 48 * 48) {
                    p.sendOverlayMessage(Component.literal(f.def.name() + " is enraged!").withStyle(ChatFormatting.RED, ChatFormatting.BOLD));
                }
            }
        }
        return false;
    }

    private static void win(ServerLevel world, Fight f) {
        f.bar.removeAllPlayers();
        BossDef b = f.def;
        Data data = Data.get(world.getServer());
        data.rematchAt.put(b.id(), world.getGameTime() + 20 * 60 * 5);
        BlockPos altar = altar(b);
        Tycoon.Data coins = Tycoon.Data.get(world.getServer());
        String weapon = switch (b.id()) {
            case "ashen" -> "ashfall";
            case "dusk" -> "duskfang";
            case "colossus" -> "maul";
            default -> "staff";
        };
        world.playSound(null, altar, SoundEvents.UI_TOAST_CHALLENGE_COMPLETE, SoundSource.PLAYERS, 1f, 0.8f);
        world.sendParticles(ParticleTypes.END_ROD, altar.getX() + 0.5, Y + 2, altar.getZ() + 0.5, 80, 2, 2, 2, 0.1);
        for (ServerPlayer p : world.players()) {
            if (p.isSpectator() || p.blockPosition().distSqr(altar) > 48 * 48) continue;
            p.getInventory().placeItemBackInInventory(weapon(weapon));
            RandomSource rnd = world.getRandom();
            p.getInventory().placeItemBackInInventory(armor(b.id(), ARMOR_SLOTS[rnd.nextInt(4)])); // one piece of its set each time
            if (b.id().equals("sovereign")) p.getInventory().placeItemBackInInventory(armor(b.id(), ARMOR_SLOTS[rnd.nextInt(4)]));
            p.getInventory().placeItemBackInInventory(tome(b.id().equals("sovereign") ? 3 : 1));
            p.getInventory().placeItemBackInInventory(book(rnd));
            if (b.id().equals("sovereign")) p.getInventory().placeItemBackInInventory(new ItemStack(Items.NETHER_STAR));
            p.giveExperiencePoints(b.id().equals("sovereign") ? 2000 : 500);
            coins.add(p.getUUID(), b.coins());
            data.beaten(p.getUUID()).add(b.id());
            p.sendSystemMessage(Component.literal("ENEMY FELLED").withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD));
            Helper.say(p, "We beat " + b.title() + "! You got " + b.reward() + " and " + b.coins() + " coins.");
            Set<String> beaten = data.beaten(p.getUUID());
            if (!b.id().equals("sovereign") && beaten.contains("ashen") && beaten.contains("dusk") && beaten.contains("colossus")) {
                Helper.say(p, "All three are down. The Singularity Sovereign is awake at the end of the north bridge.");
            }
        }
        data.setDirty();
    }

    // ---------------------------------------------------------------------------------------
    // Armor sets, Rift Tomes (magic levels), enchanted books and the Rift Caches
    // ---------------------------------------------------------------------------------------

    static final int MAX_ARCANE = 10;
    private static final EquipmentSlot[] ARMOR_SLOTS = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET};

    private record ArmorSet(String id, String name, ChatFormatting color, String bonus, MobEffectInstance[] effects) {}

    private static MobEffectInstance fx(net.minecraft.world.effect.MobEffect e, int amp) {
        return new MobEffectInstance(e, 100, amp, true, false, true);
    }

    private static final ArmorSet[] SETS = {
            new ArmorSet("ashen", "Cinderwarden", ChatFormatting.GOLD, "Fire Resistance and Strength",
                    new MobEffectInstance[]{fx(MobEffects.FIRE_RESISTANCE, 0), fx(MobEffects.STRENGTH, 0)}),
            new ArmorSet("dusk", "Moonless", ChatFormatting.LIGHT_PURPLE, "Speed II and Night Vision",
                    new MobEffectInstance[]{fx(MobEffects.SPEED, 1), fx(MobEffects.NIGHT_VISION, 0)}),
            new ArmorSet("colossus", "Hollow Bulwark", ChatFormatting.DARK_AQUA, "Resistance and Haste II",
                    new MobEffectInstance[]{fx(MobEffects.RESISTANCE, 0), fx(MobEffects.HASTE, 1)}),
            new ArmorSet("sovereign", "Event Horizon", ChatFormatting.DARK_PURPLE, "Regeneration, Strength II and Slow Falling",
                    new MobEffectInstance[]{fx(MobEffects.REGENERATION, 0), fx(MobEffects.STRENGTH, 1), fx(MobEffects.SLOW_FALLING, 0)}),
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
        s.enchant(Enchantments.PROTECTION, 4);
        s.enchant(Enchantments.UNBREAKING, 3);
        if (slot == EquipmentSlot.FEET) s.enchant(Enchantments.FEATHER_FALLING, 4);
        if (slot == EquipmentSlot.HEAD) s.enchant(Enchantments.RESPIRATION, 3);
        return s;
    }

    private static void tickSetBonuses(MinecraftServer server) {
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            String worn = null;
            int count = 0;
            for (EquipmentSlot slot : ARMOR_SLOTS) {
                String k = kindOf(p.getItemBySlot(slot));
                if (k == null || !k.startsWith("set:")) break;
                if (worn == null) worn = k;
                if (!worn.equals(k)) break;
                count++;
            }
            if (count < 4) continue;
            for (MobEffectInstance e : set(worn.substring(4)).effects()) p.addEffect(new MobEffectInstance(e));
        }
    }

    /** A Rift Tome: read it to raise your magic level (stronger, faster weapon skills). */
    static ItemStack tome(int count) {
        ItemStack s = tagged(Items.ENCHANTED_BOOK, "tome:arcane", "Rift Tome", ChatFormatting.AQUA,
                "Black Hole magic, written in starlight.", "Right-click to read: +1 magic level (max " + MAX_ARCANE + ").",
                "Each level: weapon skills +10% damage, -5% cooldown.");
        s.setCount(count);
        return s;
    }

    private static void readTome(ServerPlayer player, ItemStack stack, String kind) {
        Data data = Data.get(player.level().getServer());
        int level = data.arcane.getOrDefault(player.getUUID(), 0);
        if (level >= MAX_ARCANE) {
            Helper.say(player, "Your magic is already at the top level (" + MAX_ARCANE + "). Keep this tome for a friend.");
            return;
        }
        data.arcane.put(player.getUUID(), level + 1);
        data.setDirty();
        stack.shrink(1);
        player.giveExperienceLevels(5);
        ServerLevel w = player.level();
        w.sendParticles(ParticleTypes.ENCHANT, player.getX(), player.getY() + 1.5, player.getZ(), 60, 0.6, 0.8, 0.6, 1.0);
        w.playSound(null, player.blockPosition(), SoundEvents.ENCHANTMENT_TABLE_USE, SoundSource.PLAYERS, 1f, 0.8f);
        player.sendSystemMessage(Component.literal("Magic level " + (level + 1) + "! Weapon skills now do +" + ((level + 1) * 10)
                + "% damage with " + ((level + 1) * 5) + "% shorter cooldowns. (+5 XP levels for enchanting)").withStyle(ChatFormatting.AQUA));
    }

    /** A strong enchanted book: one of the best enchantments at its top level. */
    static ItemStack book(RandomSource rnd) {
        Enchantment[] good = {Enchantments.SHARPNESS, Enchantments.PROTECTION, Enchantments.EFFICIENCY, Enchantments.UNBREAKING,
                Enchantments.FORTUNE, Enchantments.LOOTING, Enchantments.POWER, Enchantments.FEATHER_FALLING,
                Enchantments.MENDING, Enchantments.SWEEPING_EDGE, Enchantments.FIRE_ASPECT, Enchantments.SILK_TOUCH,
                Enchantments.INFINITY, Enchantments.DEPTH_STRIDER, Enchantments.SOUL_SPEED, Enchantments.SWIFT_SNEAK};
        Enchantment e = good[rnd.nextInt(good.length)];
        return EnchantedBookItem.createForEnchantment(new EnchantmentInstance(e, e.getMaxLevel()));
    }

    /** Diamond or netherite gear with a level-30 (treasure) enchant roll. */
    private static ItemStack gear(RandomSource rnd) {
        Item[] items = {Items.DIAMOND_SWORD, Items.DIAMOND_PICKAXE, Items.DIAMOND_AXE, Items.DIAMOND_HELMET, Items.DIAMOND_CHESTPLATE,
                Items.DIAMOND_LEGGINGS, Items.DIAMOND_BOOTS, Items.BOW, Items.CROSSBOW, Items.TRIDENT, Items.NETHERITE_SWORD,
                Items.NETHERITE_PICKAXE, Items.NETHERITE_CHESTPLATE};
        ItemStack s = new ItemStack(items[rnd.nextInt(items.length)]);
        return EnchantmentHelper.enchantItem(rnd, s, 30, true);
    }

    /** What a Rift Cache gives: a handful of good things, sometimes armor from a boss set. */
    private static List<ItemStack> loot(RandomSource rnd) {
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

    private static void buildCaches(ServerLevel w) {
        for (BlockPos p : cachePositions()) {
            w.getChunk(p.getX() >> 4, p.getZ() >> 4);
            if (w.getBlockState(p.below()).isAir()) w.setBlock(p.below(), Blocks.POLISHED_BLACKSTONE.defaultBlockState(), Block.UPDATE_CLIENTS);
            w.setBlock(p, Blocks.CHEST.defaultBlockState(), Block.UPDATE_CLIENTS);
            w.setBlock(p.above(), Blocks.SOUL_LANTERN.defaultBlockState(), Block.UPDATE_CLIENTS);
            if (w.getBlockEntity(p) instanceof ChestBlockEntity chest) chest.setCustomName(Component.literal("Rift Cache"));
        }
    }

    /** Right-clicking a Rift Cache gives that player their own loot (everyone gets their own, nobody steals it). */
    static InteractionResult onUseBlock(Player p, Level w, InteractionHand hand, BlockHitResult hit) {
        if (w.isClientSide() || !w.dimension().equals(WORLD)) return InteractionResult.PASS;
        BlockPos pos = hit.getBlockPos();
        if (!w.getBlockState(pos).is(Blocks.CHEST) || !cachePositions().contains(pos)) return InteractionResult.PASS;
        if (!(p instanceof ServerPlayer player) || p instanceof FakePlayer) return InteractionResult.PASS;
        if (hand != InteractionHand.MAIN_HAND) return InteractionResult.SUCCESS;
        ServerLevel world = (ServerLevel) w;
        Data data = Data.get(world.getServer());
        String key = player.getStringUUID() + "|" + pos.asLong();
        long ready = data.looted.getOrDefault(key, 0L);
        if (world.getGameTime() < ready) {
            player.sendOverlayMessage(Component.literal("This Rift Cache is empty for you. It refills in "
                    + Math.max(1, (ready - world.getGameTime()) / 1200) + " minutes.").withStyle(ChatFormatting.GRAY));
            return InteractionResult.SUCCESS;
        }
        data.looted.put(key, world.getGameTime() + CACHE_COOLDOWN);
        data.setDirty();
        List<ItemStack> items = loot(world.getRandom());
        for (ItemStack s : items) player.getInventory().placeItemBackInInventory(s);
        world.playSound(null, pos, SoundEvents.CHEST_OPEN, SoundSource.BLOCKS, 0.8f, 0.7f);
        world.sendParticles(ParticleTypes.REVERSE_PORTAL, pos.getX() + 0.5, pos.getY() + 1, pos.getZ() + 0.5, 30, 0.3, 0.4, 0.3, 0.05);
        player.sendOverlayMessage(Component.literal("Rift Cache: " + items.size() + " items! It refills for you in 15 minutes.")
                .withStyle(ChatFormatting.LIGHT_PURPLE));
        return InteractionResult.SUCCESS;
    }

    // ---------------------------------------------------------------------------------------
    // Weapon skills
    // ---------------------------------------------------------------------------------------

    private static boolean target(Entity e, Player owner) {
        return e instanceof LivingEntity le && le.isAlive() && e instanceof Enemy && e != owner
                && !e.entityTags().contains(Helper.TAG);
    }

    private static void skill(ServerPlayer player, String kind) {
        ServerLevel world = player.level();
        String key = player.getStringUUID() + "|" + kind;
        long now = world.getServer().getTickCount();
        long ready = COOLDOWNS.getOrDefault(key, 0L);
        if (now < ready) {
            player.sendOverlayMessage(Component.literal("Skill ready in " + ((ready - now) / 20 + 1) + " s").withStyle(ChatFormatting.GRAY));
            return;
        }
        int arcane = Data.get(world.getServer()).arcane.getOrDefault(player.getUUID(), 0);
        float power = 1f + 0.1f * arcane; // +10% skill damage per magic level
        int cooldown;
        switch (kind) {
            case "ashfall" -> { // Ash Whirl
                for (Entity e : world.getEntities(player, player.getBoundingBox().inflate(4.5, 1.5, 4.5), x -> target(x, player))) {
                    LivingEntity le = (LivingEntity) e;
                    le.hurt(player.damageSources().playerAttack(player), 12 * power);
                    le.igniteForSeconds(5);
                    Vec3 push = e.position().subtract(player.position()).multiply(1, 0, 1).normalize().scale(0.8);
                    le.push(push.x, 0.3, push.z);
                    le.needsSync = true;
                }
                for (int i = 0; i < 24; i++) {
                    double a = i * Math.PI / 12;
                    world.sendParticles(ParticleTypes.FLAME, player.getX() + Math.cos(a) * 3, player.getY() + 1, player.getZ() + Math.sin(a) * 3, 2, 0.1, 0.1, 0.1, 0.01);
                }
                world.sendParticles(ParticleTypes.SWEEP_ATTACK, player.getX(), player.getY() + 1, player.getZ(), 6, 1.5, 0.2, 1.5, 0);
                world.playSound(null, player.blockPosition(), SoundEvents.PLAYER_ATTACK_SWEEP, SoundSource.PLAYERS, 1f, 0.6f);
                world.playSound(null, player.blockPosition(), SoundEvents.FIRECHARGE_USE, SoundSource.PLAYERS, 0.7f, 0.8f);
                cooldown = 100;
            }
            case "duskfang" -> { // Moonless Step
                Vec3 look = player.getLookAngle().multiply(1, 0, 1).normalize();
                Vec3 start = player.position();
                AABB path = new AABB(start, start.add(look.scale(8))).inflate(1.2, 1.5, 1.2);
                for (Entity e : world.getEntities(player, path, x -> target(x, player))) {
                    ((LivingEntity) e).hurt(player.damageSources().playerAttack(player), 11 * power);
                }
                player.setDeltaMovement(look.x * 2.4, 0.15, look.z * 2.4);
                player.needsSync = true;
                player.addEffect(new MobEffectInstance(MobEffects.RESISTANCE, 20, 2));
                for (int i = 0; i <= 8; i++) {
                    Vec3 p = start.add(look.scale(i));
                    world.sendParticles(ParticleTypes.PORTAL, p.x, p.y + 1, p.z, 6, 0.2, 0.4, 0.2, 0.2);
                }
                world.playSound(null, player.blockPosition(), SoundEvents.ENDERMAN_TELEPORT, SoundSource.PLAYERS, 0.8f, 1.4f);
                cooldown = 80;
            }
            case "maul" -> { // Collapse
                List<Entity> near = world.getEntities(player, player.getBoundingBox().inflate(8, 3, 8), x -> target(x, player));
                for (Entity e : near) {
                    Vec3 to = player.position().subtract(e.position());
                    e.setDeltaMovement(to.x * 0.25, 0.9, to.z * 0.25);
                    e.needsSync = true;
                    ((LivingEntity) e).hurt(player.damageSources().playerAttack(player), 14 * power);
                }
                world.sendParticles(ParticleTypes.REVERSE_PORTAL, player.getX(), player.getY() + 0.5, player.getZ(), 120, 4, 0.5, 4, 0.05);
                world.sendParticles(ParticleTypes.EXPLOSION, player.getX(), player.getY(), player.getZ(), 3, 1, 0, 1, 0);
                world.playSound(null, player.blockPosition(), SoundEvents.GENERIC_EXPLODE, SoundSource.PLAYERS, 0.6f, 0.6f);
                cooldown = 160;
            }
            case "staff" -> { // Starless Beam
                Vec3 eye = player.getEyePosition();
                Vec3 look = player.getLookAngle();
                LivingEntity hit = null;
                double reach = 32;
                for (double d = 1; d <= 32 && hit == null; d += 0.5) {
                    Vec3 p = eye.add(look.scale(d));
                    BlockPos bp = BlockPos.containing(p);
                    if (world.getBlockState(bp).isRedstoneConductor(world, bp)) {
                        reach = d;
                        break;
                    }
                    for (Entity e : world.getEntities(player, new AABB(p, p).inflate(0.6), x -> target(x, player))) {
                        hit = (LivingEntity) e;
                        reach = d;
                        break;
                    }
                }
                for (double d = 1; d <= reach; d += 0.6) {
                    Vec3 p = eye.add(look.scale(d));
                    world.sendParticles(ParticleTypes.END_ROD, p.x, p.y, p.z, 1, 0.02, 0.02, 0.02, 0);
                    world.sendParticles(ParticleTypes.SQUID_INK, p.x, p.y, p.z, 1, 0.05, 0.05, 0.05, 0);
                }
                if (hit != null) {
                    hit.hurt(player.damageSources().indirectMagic(player, player), 16 * power);
                    world.sendParticles(ParticleTypes.SONIC_BOOM, hit.getX(), hit.getY(0.5), hit.getZ(), 1, 0, 0, 0, 0);
                }
                world.playSound(null, player.blockPosition(), SoundEvents.ILLUSIONER_CAST_SPELL, SoundSource.PLAYERS, 0.8f, 0.7f);
                cooldown = 40;
            }
            default -> {
                return;
            }
        }
        COOLDOWNS.put(key, now + Math.round(cooldown * (1 - 0.05f * arcane))); // -5% cooldown per magic level
    }
}
