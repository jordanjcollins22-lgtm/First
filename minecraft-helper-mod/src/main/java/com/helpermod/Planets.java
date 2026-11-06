package com.helpermod;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.RandomSource;
import net.minecraft.world.Difficulty;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.phys.AABB;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * What lives on each planet: themed monsters that roam the surface, the planet's boss, and what the
 * boss drops. Works on the planets this mod adds (Europa, Io, Titan, Ceres, Pluto, Bikini Bottom and Fairway). Mobs that aren't installed are skipped, so it never breaks
 * if the modpack changes.
 */
final class Planets {
    private Planets() {}

    static final String MOB_TAG = "helpermod_planet_mob";

    /** One reward stack: item id, how many. The first id that exists is used. */
    record Reward(String[] ids, int count) {}

    record Boss(String type, String name, double health, double damage, String weapon, String reward) {}

    record Theme(String display, String[] mobs, Boss boss, Reward[] rewards, String floor, String pillar) {}

    private static Reward r(int count, String... ids) {
        return new Reward(ids, count);
    }

    private static final Reward FUEL = r(2, "minecraft:lava_bucket");

    static final Map<String, Theme> THEMES = Map.ofEntries(
            Map.entry("europa", new Theme("Europa",
                    new String[]{"minecraft:stray", "minecraft:drowned", "minecraft:silverfish", "minecraft:polar_bear"},
                    new Boss("minecraft:iron_golem", "Ice Colossus", 360, 20, null,
                            "Diamonds and gold for the trip to Titan and Pluto"),
                    new Reward[]{r(16, "minecraft:diamond"), r(1, "minecraft:trident"), FUEL},
                    "minecraft:packed_ice", "minecraft:blue_ice")),
            Map.entry("io", new Theme("Io",
                    new String[]{"minecraft:blaze", "minecraft:magma_cube"},
                    new Boss("minecraft:magma_cube", "Molten Heart", 300, 10, null,
                            "Diamonds and gold for the trip to Titan and Pluto"),
                    new Reward[]{r(16, "minecraft:diamond"), r(8, "minecraft:gold_block"), FUEL},
                    "minecraft:blackstone", "minecraft:magma_block")),
            Map.entry("ceres", new Theme("Ceres",
                    new String[]{"minecraft:silverfish", "minecraft:endermite", "minecraft:zombie", "minecraft:skeleton"},
                    new Boss("minecraft:evoker", "Ceres Sorcerer", 260, 8, null,
                            "Diamonds and a totem of undying"),
                    new Reward[]{r(12, "minecraft:diamond"), r(1, "minecraft:totem_of_undying"), FUEL},
                    "minecraft:deepslate_bricks", "minecraft:chiseled_deepslate")),
            Map.entry("titan", new Theme("Titan",
                    new String[]{"minecraft:husk", "minecraft:cave_spider", "minecraft:witch", "minecraft:creeper"},
                    new Boss("minecraft:zoglin", "Haze Beast", 360, 16, null,
                            "Rare gear and fuel for the trip to Pluto"),
                    new Reward[]{r(2, "minecraft:netherite_ingot"), r(16, "minecraft:emerald"), r(4, "minecraft:lava_bucket")},
                    "minecraft:red_sandstone", "minecraft:orange_glazed_terracotta")),
            Map.entry("bikini_bottom", new Theme("Bikini Bottom",
                    new String[]{"minecraft:drowned", "minecraft:guardian", "minecraft:pufferfish", "minecraft:drowned"},
                    new Boss("minecraft:drowned", "King of the Deep", 340, 16, "minecraft:trident",
                            "Treasure from the deep and fuel for the trip home"),
                    new Reward[]{r(1, "minecraft:heart_of_the_sea"), r(8, "minecraft:nautilus_shell"), r(1, "minecraft:trident"),
                            r(12, "minecraft:diamond"), FUEL},
                    "minecraft:prismarine_bricks", "minecraft:sea_lantern")),
            Map.entry("pluto", new Theme("Pluto",
                    new String[]{"minecraft:stray", "minecraft:enderman", "minecraft:phantom", "minecraft:skeleton"},
                    new Boss("minecraft:vindicator", "Pluto Executioner", 400, 20, "minecraft:netherite_axe",
                            "The best loot in the solar system"),
                    new Reward[]{r(4, "minecraft:netherite_ingot"), r(1, "minecraft:elytra"), r(16, "minecraft:diamond")},
                    "minecraft:calcite", "minecraft:purpur_pillar")));

    /** The planet a world is (by its name, e.g. ad_astra:moon or helpermod:europa), or null for Earth, orbits and the rest. */
    static Theme themeOf(Level world) {
        Identifier id = world.dimension().identifier();
        if (!id.getNamespace().equals("ad_astra") && !id.getNamespace().equals(HelperMod.MOD_ID)) return null;
        return THEMES.get(id.getPath());
    }

    static String keyOf(Level world) {
        return world.dimension().identifier().toString();
    }

    /** Ad Astra planets and orbits (any world from Ad Astra or this mod's planet pack). */
    static boolean isSpace(Level world) {
        String ns = world.dimension().identifier().getNamespace();
        return ns.equals("ad_astra") || ns.equals(HelperMod.MOD_ID);
    }

    static EntityType<?> type(String ids) {
        for (String s : ids.split("\\|")) {
            Identifier id = Identifier.tryParse(s);
            if (id != null && BuiltInRegistries.ENTITY_TYPE.containsKey(id)) return BuiltInRegistries.ENTITY_TYPE.getValue(id);
        }
        return null;
    }

    static List<ItemStack> rewards(Theme theme) {
        List<ItemStack> out = new ArrayList<>();
        for (Reward reward : theme.rewards()) {
            for (String s : reward.ids()) {
                Identifier id = Identifier.tryParse(s);
                if (id == null || !BuiltInRegistries.ITEM.containsKey(id)) continue;
                Item item = BuiltInRegistries.ITEM.getValue(id);
                if (item == Items.AIR) continue;
                int left = reward.count();
                while (left > 0) {
                    int n = Math.min(left, item.getDefaultMaxStackSize());
                    out.add(new ItemStack(item, n));
                    left -= n;
                }
                break;
            }
        }
        return out;
    }

    // ---------------------------------------------------------------------------------------
    // Themed monsters
    // ---------------------------------------------------------------------------------------

    private static final int NEARBY_CAP = 6;

    /** Every 10 seconds, top up each planet player's surroundings with that planet's monsters. */
    static void tick(MinecraftServer server) {
        if (server.getTickCount() % 200 != 0) return;
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player.isSpectator()) continue;
            ServerLevel world = player.level();
            Theme theme = themeOf(world);
            if (theme == null || world.getDifficulty() == Difficulty.PEACEFUL) continue;
            AABB around = player.getBoundingBox().inflate(64);
            int near = world.getEntitiesOfClass(Mob.class, around, e -> e.entityTags().contains(MOB_TAG)).size();
            if (near >= NEARBY_CAP) continue;
            spawnOne(world, player, theme, world.getRandom());
        }
    }

    private static void spawnOne(ServerLevel world, ServerPlayer player, Theme theme, RandomSource random) {
        List<EntityType<?>> options = new ArrayList<>();
        for (String id : theme.mobs()) {
            EntityType<?> t = type(id);
            if (t != null) options.add(t);
        }
        if (options.isEmpty()) return;
        EntityType<?> type = options.get(random.nextInt(options.size()));
        for (int attempt = 0; attempt < 6; attempt++) {
            double angle = random.nextDouble() * Math.PI * 2;
            double dist = 24 + random.nextDouble() * 24;
            int x = (int) Math.floor(player.getX() + Math.cos(angle) * dist);
            int z = (int) Math.floor(player.getZ() + Math.sin(angle) * dist);
            if (!world.hasChunk(x >> 4, z >> 4)) continue;
            int y = world.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, x, z);
            if (world.getFluidState(new BlockPos(x, y - 1, z)).is(net.minecraft.tags.FluidTags.WATER)) {
                y = world.getHeight(Heightmap.Types.OCEAN_FLOOR, x, z); // an ocean planet: spawn on the sea floor
            }
            BlockPos pos = new BlockPos(x, y, z);
            if (y <= world.getMinY() + 1 || !world.getBlockState(pos.below()).isRedstoneConductor(world, pos.below())) continue;
            if (!world.noCollision(type.getSpawnAABB(x + 0.5, y, z + 0.5))) continue;
            Entity e = type.spawn(world, pos, EntitySpawnReason.NATURAL);
            if (e != null) e.addTag(MOB_TAG);
            return;
        }
    }
}
