package com.helpermod;

import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.Mth;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.entity.npc.villager.VillagerProfession;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.DoorBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.DoubleBlockHalf;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * Reef Town: an undersea town on the Bikini Bottom planet.
 *
 * The first time someone stands on the sea floor there, a town is built nearby: four glass dome houses
 * full of air, each with its own townsperson and their work block, and a diner in the middle. The doors
 * keep the water out, so you can walk in without a helmet. The townsfolk are villagers you can trade
 * with, and they can breathe underwater in case they wander out.
 */
final class Town {
    private Town() {}

    static final String PLANET = "helpermod:bikini_bottom";
    static final String TAG = "helpermod_townsfolk";
    private static final int DOME = 5;
    private static final int RING = 20;

    private record Resident(String name, net.minecraft.resources.ResourceKey<VillagerProfession> job, Block workstation) {}

    private static final Resident[] HOUSES = {
            new Resident("Old Finn", VillagerProfession.FISHERMAN, Blocks.BARREL),
            new Resident("Shelly", VillagerProfession.CARTOGRAPHER, Blocks.CARTOGRAPHY_TABLE),
            new Resident("Barnaby", VillagerProfession.ARMORER, Blocks.BLAST_FURNACE),
            new Resident("Coral", VillagerProfession.LIBRARIAN, Blocks.LECTERN),
    };
    private static final Resident CHEF = new Resident("Chef Marlo", VillagerProfession.BUTCHER, Blocks.SMOKER);

    private static final Set<UUID> TOLD = new HashSet<>();

    static void reset() {
        TOLD.clear();
    }

    /** Where the town is. Saved with the world. */
    static final class Data extends SavedData {
        private static final String ID = "helpermod_reef_town";
        private static final SavedDataType<Data> TYPE = Compat.dataType(ID, Data::new, Data::fromNbt, d -> d.save(new CompoundTag()));
        BlockPos centre;

        static Data get(MinecraftServer server) {
            return server.overworld().getDataStorage().computeIfAbsent(TYPE);
        }

        private static Data fromNbt(CompoundTag nbt) {
            Data d = new Data();
            if (nbt.contains("centre")) d.centre = BlockPos.of(nbt.getLongOr("centre", 0L));
            return d;
        }

                public CompoundTag save(CompoundTag nbt) {
            if (centre != null) nbt.putLong("centre", centre.asLong());
            return nbt;
        }
    }

    static void tick(MinecraftServer server) {
        if (server.getTickCount() % 40 != 0) return;
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player.isSpectator()) continue;
            ServerLevel world = player.level();
            if (!Planets.keyOf(world).equals(PLANET)) continue;
            Data data = Data.get(server);
            if (data.centre == null) {
                if (player.isPassenger() || !(player.onGround() || player.isInWater())) continue;
                BlockPos centre = build(world, player);
                if (centre == null) continue;
                data.centre = centre;
                data.setDirty();
            }
            if (TOLD.add(player.getUUID())) {
                Helper.say(player, "There's a town under the sea here, Reef Town, " + where(player, data.centre)
                        + ". The glass domes are full of air, so you can go inside and trade with the townsfolk.");
            }
        }
    }

    /** /helper town */
    static void tellWhere(ServerPlayer player) {
        if (!Planets.keyOf(player.level()).equals(PLANET)) {
            Helper.say(player, "Reef Town is on the Bikini Bottom planet. Fly there with a tier 3 Ad Astra rocket.");
            return;
        }
        BlockPos c = Data.get(player.level().getServer()).centre;
        if (c == null) {
            Helper.say(player, "Reef Town gets built near you once you reach the sea floor.");
            return;
        }
        Helper.say(player, "Reef Town is " + where(player, c) + ".");
    }

    private static String where(ServerPlayer player, BlockPos c) {
        double dx = c.getX() + 0.5 - player.getX(), dz = c.getZ() + 0.5 - player.getZ();
        int dist = (int) Math.round(Math.sqrt(dx * dx + dz * dz));
        if (dist < 10) return "right here";
        String[] dirs = {"south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"};
        int i = Math.floorMod(Math.round((float) (Math.toDegrees(Math.atan2(-dx, dz)) / 45.0)), 8);
        return dist + " blocks to the " + dirs[i] + " (at " + c.getX() + ", " + c.getY() + ", " + c.getZ() + ")";
    }

    // ---------------------------------------------------------------------------------------
    // Building
    // ---------------------------------------------------------------------------------------

    private static BlockPos build(ServerLevel world, ServerPlayer player) {
        double angle = world.getRandom().nextDouble() * Math.PI * 2;
        int cx = Mth.floor(player.getX() + Math.cos(angle) * 48);
        int cz = Mth.floor(player.getZ() + Math.sin(angle) * 48);
        int cy = floorY(world, cx, cz);
        if (cy <= world.getMinY() + 8 || cy >= (world.getMaxY() + 1) - 16) return null;

        diner(world, new BlockPos(cx, cy, cz));
        for (int i = 0; i < HOUSES.length; i++) {
            double a = i * Math.PI / 2 + Math.PI / 4;
            int hx = cx + (int) Math.round(Math.cos(a) * RING);
            int hz = cz + (int) Math.round(Math.sin(a) * RING);
            int hy = floorY(world, hx, hz);
            if (hy <= world.getMinY() + 8) hy = cy;
            // The door faces the town centre.
            Direction facing = Direction.getNearest(cx - hx, 0, cz - hz, Direction.NORTH);
            dome(world, new BlockPos(hx, hy, hz), facing, HOUSES[i]);
            path(world, new BlockPos(cx, cy, cz), new BlockPos(hx, hy, hz));
        }
        return new BlockPos(cx, cy, cz);
    }

    private static int floorY(ServerLevel world, int x, int z) {
        world.getChunk(x >> 4, z >> 4);
        return world.getHeight(Heightmap.Types.OCEAN_FLOOR, x, z);
    }

    private static void set(ServerLevel world, BlockPos pos, BlockState state) {
        world.setBlock(pos, state, Block.UPDATE_CLIENTS);
    }

    /** Solid ground under a building so it doesn't hang over a drop. */
    private static void foundation(ServerLevel world, int x, int y, int z) {
        for (int fy = y - 1; fy >= y - 8; fy--) {
            BlockPos p = new BlockPos(x, fy, z);
            if (world.getBlockState(p).isRedstoneConductor(world, p)) break;
            set(world, p, Blocks.SANDSTONE.defaultBlockState());
        }
    }

    /** A glass dome house filled with air. pos is the centre of its floor. */
    private static void dome(ServerLevel world, BlockPos pos, Direction door, Resident who) {
        int r = DOME;
        for (int dx = -r - 1; dx <= r + 1; dx++) {
            for (int dz = -r - 1; dz <= r + 1; dz++) {
                world.getChunk((pos.getX() + dx) >> 4, (pos.getZ() + dz) >> 4);
                double flat = Math.sqrt(dx * dx + dz * dz);
                if (flat > r + 0.5) continue;
                int x = pos.getX() + dx, z = pos.getZ() + dz;
                foundation(world, x, pos.getY(), z);
                set(world, new BlockPos(x, pos.getY(), z), flat > r - 0.5
                        ? Blocks.PRISMARINE_BRICKS.defaultBlockState() : Blocks.SMOOTH_SANDSTONE.defaultBlockState());
                for (int dy = 1; dy <= r + 1; dy++) {
                    double d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    BlockPos p = new BlockPos(x, pos.getY() + dy, z);
                    if (d <= r - 1.5) set(world, p, Blocks.AIR.defaultBlockState());
                    else if (d <= r + 0.5) set(world, p, Blocks.GLASS.defaultBlockState());
                }
            }
        }
        set(world, pos.above(r), Blocks.SEA_LANTERN.defaultBlockState());

        // Door in the outer wall facing the town, with a short air tunnel through the thick glass.
        for (int k = 3; k < r; k++) {
            set(world, pos.relative(door, k).above(), Blocks.AIR.defaultBlockState());
            set(world, pos.relative(door, k).above(2), Blocks.AIR.defaultBlockState());
        }
        BlockPos doorPos = pos.relative(door, r).above();
        BlockState lower = Blocks.SPRUCE_DOOR.defaultBlockState().setValue(DoorBlock.FACING, door)
                .setValue(DoorBlock.HALF, DoubleBlockHalf.LOWER);
        set(world, doorPos, lower);
        set(world, doorPos.above(), lower.setValue(DoorBlock.HALF, DoubleBlockHalf.UPPER));

        // Inside: a bed, a light, a chest and the resident's work block.
        Direction left = door.getCounterClockWise();
        BlockPos back = pos.relative(door.getOpposite(), 2).above();
        set(world, back.relative(left, 2), who.workstation().defaultBlockState());
        set(world, back.relative(left.getOpposite(), 2), Blocks.CHEST.defaultBlockState());
        bed(world, back.relative(left.getOpposite(), 0), door);
        set(world, pos.above().relative(left, 3), Blocks.LANTERN.defaultBlockState());
        resident(world, pos.above().relative(door, 1), who);
    }

    private static void bed(ServerLevel world, BlockPos foot, Direction door) {
        Direction head = door.getOpposite();
        BlockState bed = Blocks.BED.cyan().defaultBlockState().setValue(net.minecraft.world.level.block.BedBlock.FACING, head);
        set(world, foot, bed.setValue(net.minecraft.world.level.block.BedBlock.PART, net.minecraft.world.level.block.state.properties.BedPart.FOOT));
        set(world, foot.relative(head), bed.setValue(net.minecraft.world.level.block.BedBlock.PART, net.minecraft.world.level.block.state.properties.BedPart.HEAD));
    }

    /** The diner in the middle of town: a prismarine hall with a glass roof, tables and a cook. */
    private static void diner(ServerLevel world, BlockPos pos) {
        int hw = 6, hd = 4, h = 5;
        for (int dx = -hw; dx <= hw; dx++) {
            for (int dz = -hd; dz <= hd; dz++) {
                int x = pos.getX() + dx, z = pos.getZ() + dz;
                world.getChunk(x >> 4, z >> 4);
                foundation(world, x, pos.getY(), z);
                boolean edge = Math.abs(dx) == hw || Math.abs(dz) == hd;
                set(world, new BlockPos(x, pos.getY(), z), Blocks.DARK_PRISMARINE.defaultBlockState());
                for (int dy = 1; dy <= h; dy++) {
                    BlockPos p = new BlockPos(x, pos.getY() + dy, z);
                    if (dy == h) set(world, p, edge ? Blocks.PRISMARINE_BRICKS.defaultBlockState() : Blocks.GLASS.defaultBlockState());
                    else if (edge) set(world, p, dy == 2 && dx % 2 == 0 ? Blocks.GLASS.defaultBlockState()
                            : Blocks.PRISMARINE_BRICKS.defaultBlockState());
                    else set(world, p, Blocks.AIR.defaultBlockState());
                }
            }
        }
        set(world, pos.above(h), Blocks.SEA_LANTERN.defaultBlockState());
        set(world, pos.offset(-3, h, 0), Blocks.SEA_LANTERN.defaultBlockState());
        set(world, pos.offset(3, h, 0), Blocks.SEA_LANTERN.defaultBlockState());

        // Doors on both long sides.
        for (Direction d : new Direction[]{Direction.NORTH, Direction.SOUTH}) {
            BlockPos dp = pos.relative(d, hd).above();
            BlockState lower = Blocks.SPRUCE_DOOR.defaultBlockState().setValue(DoorBlock.FACING, d.getOpposite())
                    .setValue(DoorBlock.HALF, DoubleBlockHalf.LOWER);
            set(world, dp, lower);
            set(world, dp.above(), lower.setValue(DoorBlock.HALF, DoubleBlockHalf.UPPER));
        }

        // A counter along the back, a smoker and some tables.
        for (int dx = -hw + 1; dx <= -hw + 3; dx++) {
            for (int dz = -hd + 1; dz <= hd - 1; dz++) {
                if (dx == -hw + 3) set(world, pos.offset(dx, 1, dz), Blocks.STRIPPED_SPRUCE_LOG.defaultBlockState());
            }
        }
        set(world, pos.offset(-hw + 1, 1, 0), CHEF.workstation().defaultBlockState());
        set(world, pos.offset(-hw + 1, 1, 1), Blocks.CAMPFIRE.defaultBlockState()
                .setValue(net.minecraft.world.level.block.CampfireBlock.LIT, false));
        set(world, pos.offset(-hw + 1, 1, -1), Blocks.BARREL.defaultBlockState());
        for (int[] t : new int[][]{{1, -2}, {1, 2}, {4, -2}, {4, 2}}) {
            BlockPos table = pos.offset(t[0], 1, t[1]);
            set(world, table, Blocks.SPRUCE_FENCE.defaultBlockState());
            set(world, table.above(), Blocks.SPRUCE_PRESSURE_PLATE.defaultBlockState());
            set(world, table.east(), Blocks.SPRUCE_STAIRS.defaultBlockState()
                    .setValue(net.minecraft.world.level.block.StairBlock.FACING, Direction.WEST));
            set(world, table.west(), Blocks.SPRUCE_STAIRS.defaultBlockState()
                    .setValue(net.minecraft.world.level.block.StairBlock.FACING, Direction.EAST));
        }
        resident(world, pos.offset(-hw + 2, 1, 0), CHEF);
    }

    /** A sandstone path along the sea floor from the town centre to a house. */
    private static void path(ServerLevel world, BlockPos from, BlockPos to) {
        int steps = (int) Math.ceil(Math.sqrt(from.distSqr(to)));
        for (int s = 0; s <= steps; s++) {
            double t = s / (double) Math.max(1, steps);
            int x = Mth.floor(Mth.lerp(t, from.getX(), to.getX()) + 0.5);
            int z = Mth.floor(Mth.lerp(t, from.getZ(), to.getZ()) + 0.5);
            int y = floorY(world, x, z) - 1;
            BlockPos p = new BlockPos(x, y, z);
            BlockState here = world.getBlockState(p);
            if (here.is(Blocks.GLASS) || here.is(Blocks.SMOOTH_SANDSTONE) || here.is(Blocks.DARK_PRISMARINE)
                    || here.is(Blocks.PRISMARINE_BRICKS)) continue;
            set(world, p, Blocks.CUT_SANDSTONE.defaultBlockState());
        }
    }

    private static void resident(ServerLevel world, BlockPos at, Resident who) {
        Villager v = EntityTypes.VILLAGER.create(world, net.minecraft.world.entity.EntitySpawnReason.MOB_SUMMONED);
        if (v == null) return;
        v.snapTo(at.getX() + 0.5, at.getY(), at.getZ() + 0.5, world.getRandom().nextFloat() * 360f, 0f);
        v.finalizeSpawn(world, world.getCurrentDifficultyAt(at), EntitySpawnReason.STRUCTURE, null);
        v.setVillagerData(v.getVillagerData().withProfession(v.registryAccess(), who.job()).withLevel(2));
        v.setVillagerXp(10); // keeps the job even if it loses its work block
        v.setCustomName(Component.literal(who.name()).withStyle(ChatFormatting.AQUA));
        v.setCustomNameVisible(true);
        v.setPersistenceRequired();
        v.addTag(TAG);
        v.addEffect(new MobEffectInstance(MobEffects.WATER_BREATHING, MobEffectInstance.INFINITE_DURATION, 0, false, false));
        world.addFreshEntity(v);
    }
}
