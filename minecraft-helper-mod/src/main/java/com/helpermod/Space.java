package com.helpermod;

import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.Identifier;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.levelgen.Heightmap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The mod's own planets: Europa, Io, Titan, Ceres, Pluto, Bikini Bottom (a warm ocean planet) and
 * Fairway (a grassy golf planet). They are plain data-pack dimensions in data/helpermod, so they
 * need no other mod. /helper planet NAME flies you there, /helper planet home brings you back.
 */
final class Space {
    private Space() {}

    static final List<String> PLANETS = List.of("europa", "io", "titan", "ceres", "pluto", "bikini_bottom", "fairway");

    /** Where each player took off from, so "home" puts them back there. */
    private static final Map<UUID, Object[]> TOOK_OFF = new HashMap<>();

    static void register() {
        HelperMod.LOG.info("Planets ready: " + String.join(", ", PLANETS));
    }

    static ResourceKey<Level> key(String planet) {
        return ResourceKey.create(Registries.DIMENSION, Identifier.fromNamespaceAndPath(HelperMod.MOD_ID, planet));
    }

    static String display(String planet) {
        return switch (planet) {
            case "bikini_bottom" -> "Bikini Bottom";
            default -> Character.toUpperCase(planet.charAt(0)) + planet.substring(1);
        };
    }

    static void list(ServerPlayer player) {
        StringBuilder sb = new StringBuilder("Planets you can fly to: ");
        for (int i = 0; i < PLANETS.size(); i++) sb.append(i == 0 ? "" : ", ").append(display(PLANETS.get(i)));
        Helper.say(player, sb + ". Use /helper planet <name>, and /helper planet home to come back.");
    }

    static void go(ServerPlayer player, String planet) {
        planet = planet.toLowerCase().replace(' ', '_');
        if (!PLANETS.contains(planet)) {
            list(player);
            return;
        }
        ServerLevel to = player.level().getServer().getLevel(key(planet));
        if (to == null) {
            Helper.say(player, "I can't find " + display(planet) + ". Is the world missing the mod's data?");
            return;
        }
        if (!Planets.isSpace(player.level())) {
            TOOK_OFF.put(player.getUUID(), new Object[]{player.level().dimension(), player.getX(), player.getY(), player.getZ()});
        }
        BlockPos land = landingSpot(to, 0, 0);
        Compat.teleport(player, to, land.getX() + 0.5, land.getY(), land.getZ() + 0.5, player.getYRot(), player.getXRot());
        if (planet.equals("bikini_bottom")) {
            player.addEffect(new MobEffectInstance(MobEffects.CONDUIT_POWER, 20 * 60 * 10, 0)); // breathe under the sea
        }
        Helper.say(player, "Welcome to " + display(planet) + "! Use /helper planet home when you want to go back.");
    }

    static void home(ServerPlayer player) {
        var server = player.level().getServer();
        Object[] from = TOOK_OFF.remove(player.getUUID());
        ServerLevel to = from == null ? null : server.getLevel((ResourceKey<Level>) from[0]);
        if (to == null) {
            to = server.overworld();
            BlockPos spawn = to.getRespawnData().pos();
            Compat.teleport(player, to, spawn.getX() + 0.5, spawn.getY(), spawn.getZ() + 0.5, player.getYRot(), player.getXRot());
        } else {
            Compat.teleport(player, to, (double) from[1], (double) from[2], (double) from[3], player.getYRot(), player.getXRot());
        }
        Helper.say(player, "Back home.");
    }

    /** The top of the ground near x, z, with a small pad so nobody lands in a hole or a lava lake. */
    private static BlockPos landingSpot(ServerLevel world, int x, int z) {
        world.getChunk(x >> 4, z >> 4); // make sure the ground there exists
        int y = world.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, x, z);
        boolean ocean = world.dimension().identifier().getPath().equals("bikini_bottom");
        if (ocean) y = world.getHeight(Heightmap.Types.OCEAN_FLOOR, x, z);
        if (y <= world.getMinY() + 1) y = 80; // no ground at all: make some
        BlockPos pad = new BlockPos(x, y - 1, z);
        for (int dx = -1; dx <= 1; dx++) {
            for (int dz = -1; dz <= 1; dz++) {
                BlockPos p = pad.offset(dx, 0, dz);
                if (!world.getBlockState(p).isSolid()) world.setBlockAndUpdate(p, Blocks.SMOOTH_STONE.defaultBlockState());
            }
        }
        return pad.above();
    }
}
