package com.helpermod;

import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnReason;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.random.Random;
import net.minecraft.world.Difficulty;
import net.minecraft.world.Heightmap;
import net.minecraft.world.World;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * What lives on each planet: themed monsters that roam the surface, the planet's boss, and what the
 * boss drops. Works on Ad Astra's planets (Moon, Mars, Venus, Mercury, Glacio) and the ones this mod
 * adds (Europa, Io, Titan, Ceres, Pluto). Mobs that aren't installed are skipped, so it never breaks
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

    private static final Reward FUEL = r(2, "ad_astra:fuel_bucket", "minecraft:lava_bucket");

    static final Map<String, Theme> THEMES = Map.ofEntries(
            Map.entry("moon", new Theme("the Moon",
                    new String[]{"ad_astra:star_crawler", "ad_astra:corrupted_lunarian", "minecraft:silverfish",
                            "minecraft:endermite", "minecraft:skeleton"},
                    new Boss("minecraft:ravager", "Crater King", 300, 14, null,
                            "Desh to build a tier 2 rocket for Mars"),
                    new Reward[]{r(16, "ad_astra:desh_ingot", "minecraft:iron_ingot"), r(4, "ad_astra:desh_plate", "minecraft:iron_block"), FUEL},
                    "minecraft:polished_blackstone_bricks", "minecraft:chiseled_polished_blackstone")),
            Map.entry("mars", new Theme("Mars",
                    new String[]{"ad_astra:martian_raptor", "ad_astra:pygro", "ad_astra:pygro_brute",
                            "minecraft:husk", "minecraft:spider"},
                    new Boss("ad_astra:pygro_brute|minecraft:piglin_brute", "Red Warlord", 320, 16, "minecraft:netherite_axe",
                            "Ostrum to build a tier 3 rocket for Mercury, Venus and Ceres"),
                    new Reward[]{r(16, "ad_astra:ostrum_ingot", "minecraft:gold_ingot"), r(4, "ad_astra:ostrum_plate", "minecraft:gold_block"), FUEL},
                    "minecraft:red_nether_bricks", "minecraft:red_sandstone")),
            Map.entry("mercury", new Theme("Mercury",
                    new String[]{"minecraft:magma_cube", "minecraft:blaze", "minecraft:husk"},
                    new Boss("minecraft:wither_skeleton", "Sun Knight", 340, 18, "minecraft:netherite_sword",
                            "Calorite to build a tier 4 rocket"),
                    new Reward[]{r(12, "ad_astra:calorite_ingot", "minecraft:diamond"), FUEL},
                    "minecraft:nether_bricks", "minecraft:magma_block")),
            Map.entry("venus", new Theme("Venus",
                    new String[]{"ad_astra:sulfur_creeper", "minecraft:blaze", "minecraft:magma_cube",
                            "minecraft:wither_skeleton"},
                    new Boss("minecraft:blaze", "Sulfur Lord", 300, 12, null,
                            "Calorite to build a tier 4 rocket for Glacio, Titan and Pluto"),
                    new Reward[]{r(16, "ad_astra:calorite_ingot", "minecraft:diamond"), r(4, "ad_astra:calorite_plate", "minecraft:diamond_block"), FUEL},
                    "minecraft:polished_blackstone_bricks", "minecraft:gilded_blackstone")),
            Map.entry("glacio", new Theme("Glacio",
                    new String[]{"minecraft:stray", "minecraft:skeleton", "minecraft:spider", "minecraft:zombie"},
                    new Boss("minecraft:stray", "Frost Lord", 320, 14, "minecraft:netherite_sword",
                            "Rare gear for the outer planets"),
                    new Reward[]{r(2, "minecraft:netherite_ingot"), r(16, "minecraft:diamond"), r(4, "ad_astra:fuel_bucket", "minecraft:lava_bucket")},
                    "minecraft:packed_ice", "minecraft:blue_ice")),
            Map.entry("europa", new Theme("Europa",
                    new String[]{"minecraft:stray", "minecraft:drowned", "minecraft:silverfish", "minecraft:polar_bear"},
                    new Boss("minecraft:iron_golem", "Ice Colossus", 360, 20, null,
                            "Calorite for a tier 4 rocket to reach Titan and Pluto"),
                    new Reward[]{r(16, "ad_astra:calorite_ingot", "minecraft:diamond"), r(1, "minecraft:trident"), FUEL},
                    "minecraft:packed_ice", "minecraft:blue_ice")),
            Map.entry("io", new Theme("Io",
                    new String[]{"ad_astra:sulfur_creeper", "minecraft:blaze", "minecraft:magma_cube"},
                    new Boss("minecraft:magma_cube", "Molten Heart", 300, 10, null,
                            "Calorite for a tier 4 rocket to reach Titan and Pluto"),
                    new Reward[]{r(16, "ad_astra:calorite_ingot", "minecraft:diamond"), r(8, "minecraft:gold_block"), FUEL},
                    "minecraft:blackstone", "minecraft:magma_block")),
            Map.entry("ceres", new Theme("Ceres",
                    new String[]{"minecraft:silverfish", "minecraft:endermite", "minecraft:zombie", "minecraft:skeleton"},
                    new Boss("minecraft:evoker", "Ceres Sorcerer", 260, 8, null,
                            "Calorite for a tier 4 rocket"),
                    new Reward[]{r(12, "ad_astra:calorite_ingot", "minecraft:diamond"), r(1, "minecraft:totem_of_undying"), FUEL},
                    "minecraft:deepslate_bricks", "minecraft:chiseled_deepslate")),
            Map.entry("titan", new Theme("Titan",
                    new String[]{"minecraft:husk", "minecraft:cave_spider", "minecraft:witch", "minecraft:creeper"},
                    new Boss("minecraft:zoglin", "Haze Beast", 360, 16, null,
                            "Rare gear and fuel for the trip to Pluto"),
                    new Reward[]{r(2, "minecraft:netherite_ingot"), r(16, "ad_astra:ostrum_ingot", "minecraft:emerald"), r(4, "ad_astra:fuel_bucket", "minecraft:lava_bucket")},
                    "minecraft:red_sandstone", "minecraft:orange_glazed_terracotta")),
            Map.entry("bikini_bottom", new Theme("Bikini Bottom",
                    new String[]{"minecraft:drowned", "minecraft:guardian", "minecraft:pufferfish", "minecraft:drowned"},
                    new Boss("minecraft:drowned", "King of the Deep", 340, 16, "minecraft:trident",
                            "Treasure from the deep and fuel for the trip home"),
                    new Reward[]{r(1, "minecraft:heart_of_the_sea"), r(8, "minecraft:nautilus_shell"), r(1, "minecraft:trident"),
                            r(12, "ad_astra:calorite_ingot", "minecraft:diamond"), FUEL},
                    "minecraft:prismarine_bricks", "minecraft:sea_lantern")),
            Map.entry("pluto", new Theme("Pluto",
                    new String[]{"minecraft:stray", "minecraft:enderman", "minecraft:phantom", "minecraft:skeleton"},
                    new Boss("minecraft:vindicator", "Pluto Executioner", 400, 20, "minecraft:netherite_axe",
                            "The best loot in the solar system"),
                    new Reward[]{r(4, "minecraft:netherite_ingot"), r(1, "minecraft:elytra"), r(16, "minecraft:diamond")},
                    "minecraft:calcite", "minecraft:purpur_pillar")));

    /** The planet a world is (by its name, e.g. ad_astra:moon or helpermod:europa), or null for Earth, orbits and the rest. */
    static Theme themeOf(World world) {
        Identifier id = world.getRegistryKey().getValue();
        if (!id.getNamespace().equals("ad_astra") && !id.getNamespace().equals(HelperMod.MOD_ID)) return null;
        return THEMES.get(id.getPath());
    }

    static String keyOf(World world) {
        return world.getRegistryKey().getValue().toString();
    }

    /** Ad Astra planets and orbits (any world from Ad Astra or this mod's planet pack). */
    static boolean isSpace(World world) {
        String ns = world.getRegistryKey().getValue().getNamespace();
        return ns.equals("ad_astra") || ns.equals(HelperMod.MOD_ID);
    }

    static EntityType<?> type(String ids) {
        for (String s : ids.split("\\|")) {
            Identifier id = Identifier.tryParse(s);
            if (id != null && Registries.ENTITY_TYPE.containsId(id)) return Registries.ENTITY_TYPE.get(id);
        }
        return null;
    }

    static List<ItemStack> rewards(Theme theme) {
        List<ItemStack> out = new ArrayList<>();
        for (Reward reward : theme.rewards()) {
            for (String s : reward.ids()) {
                Identifier id = Identifier.tryParse(s);
                if (id == null || !Registries.ITEM.containsId(id)) continue;
                Item item = Registries.ITEM.get(id);
                if (item == Items.AIR) continue;
                int left = reward.count();
                while (left > 0) {
                    int n = Math.min(left, item.getMaxCount());
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
        if (server.getTicks() % 200 != 0) return;
        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            if (player.isSpectator()) continue;
            ServerWorld world = player.getServerWorld();
            Theme theme = themeOf(world);
            if (theme == null || world.getDifficulty() == Difficulty.PEACEFUL) continue;
            Box around = player.getBoundingBox().expand(64);
            int near = world.getEntitiesByClass(MobEntity.class, around, e -> e.getCommandTags().contains(MOB_TAG)).size();
            if (near >= NEARBY_CAP) continue;
            spawnOne(world, player, theme, world.getRandom());
        }
    }

    private static void spawnOne(ServerWorld world, ServerPlayerEntity player, Theme theme, Random random) {
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
            if (!world.isChunkLoaded(x >> 4, z >> 4)) continue;
            int y = world.getTopY(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, x, z);
            if (world.getFluidState(new BlockPos(x, y - 1, z)).isIn(net.minecraft.registry.tag.FluidTags.WATER)) {
                y = world.getTopY(Heightmap.Type.OCEAN_FLOOR, x, z); // an ocean planet: spawn on the sea floor
            }
            BlockPos pos = new BlockPos(x, y, z);
            if (y <= world.getBottomY() + 1 || !world.getBlockState(pos.down()).isSolidBlock(world, pos.down())) continue;
            if (!world.isSpaceEmpty(type.createSimpleBoundingBox(x + 0.5, y, z + 0.5))) continue;
            Entity e = type.spawn(world, pos, SpawnReason.NATURAL);
            if (e != null) e.addCommandTag(MOB_TAG);
            return;
        }
    }
}
