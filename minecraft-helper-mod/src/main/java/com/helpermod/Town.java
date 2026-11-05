package com.helpermod;

import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.block.DoorBlock;
import net.minecraft.block.enums.DoubleBlockHalf;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnReason;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.passive.VillagerEntity;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.MathHelper;
import net.minecraft.village.VillagerProfession;
import net.minecraft.world.Heightmap;
import net.minecraft.world.PersistentState;

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

    private record Resident(String name, VillagerProfession job, Block workstation) {}

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
    static final class Data extends PersistentState {
        private static final String ID = "helpermod_reef_town";
        BlockPos centre;

        static Data get(MinecraftServer server) {
            return server.getOverworld().getPersistentStateManager().getOrCreate(Data::fromNbt, Data::new, ID);
        }

        private static Data fromNbt(NbtCompound nbt) {
            Data d = new Data();
            if (nbt.contains("centre")) d.centre = BlockPos.fromLong(nbt.getLong("centre"));
            return d;
        }

        @Override
        public NbtCompound writeNbt(NbtCompound nbt) {
            if (centre != null) nbt.putLong("centre", centre.asLong());
            return nbt;
        }
    }

    static void tick(MinecraftServer server) {
        if (server.getTicks() % 40 != 0) return;
        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            if (player.isSpectator()) continue;
            ServerWorld world = player.getServerWorld();
            if (!Planets.keyOf(world).equals(PLANET)) continue;
            Data data = Data.get(server);
            if (data.centre == null) {
                if (player.hasVehicle() || !(player.isOnGround() || player.isTouchingWater())) continue;
                BlockPos centre = build(world, player);
                if (centre == null) continue;
                data.centre = centre;
                data.markDirty();
            }
            if (TOLD.add(player.getUuid())) {
                Helper.say(player, "There's a town under the sea here, Reef Town, " + where(player, data.centre)
                        + ". The glass domes are full of air, so you can go inside and trade with the townsfolk.");
            }
        }
    }

    /** /helper town */
    static void tellWhere(ServerPlayerEntity player) {
        if (!Planets.keyOf(player.getServerWorld()).equals(PLANET)) {
            Helper.say(player, "Reef Town is on the Bikini Bottom planet. Fly there with a tier 3 Ad Astra rocket.");
            return;
        }
        BlockPos c = Data.get(player.getServer()).centre;
        if (c == null) {
            Helper.say(player, "Reef Town gets built near you once you reach the sea floor.");
            return;
        }
        Helper.say(player, "Reef Town is " + where(player, c) + ".");
    }

    private static String where(ServerPlayerEntity player, BlockPos c) {
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

    private static BlockPos build(ServerWorld world, ServerPlayerEntity player) {
        double angle = world.getRandom().nextDouble() * Math.PI * 2;
        int cx = MathHelper.floor(player.getX() + Math.cos(angle) * 48);
        int cz = MathHelper.floor(player.getZ() + Math.sin(angle) * 48);
        int cy = floorY(world, cx, cz);
        if (cy <= world.getBottomY() + 8 || cy >= world.getTopY() - 16) return null;

        diner(world, new BlockPos(cx, cy, cz));
        for (int i = 0; i < HOUSES.length; i++) {
            double a = i * Math.PI / 2 + Math.PI / 4;
            int hx = cx + (int) Math.round(Math.cos(a) * RING);
            int hz = cz + (int) Math.round(Math.sin(a) * RING);
            int hy = floorY(world, hx, hz);
            if (hy <= world.getBottomY() + 8) hy = cy;
            // The door faces the town centre.
            Direction facing = Direction.getFacing(cx - hx, 0, cz - hz);
            dome(world, new BlockPos(hx, hy, hz), facing, HOUSES[i]);
            path(world, new BlockPos(cx, cy, cz), new BlockPos(hx, hy, hz));
        }
        return new BlockPos(cx, cy, cz);
    }

    private static int floorY(ServerWorld world, int x, int z) {
        world.getChunk(x >> 4, z >> 4);
        return world.getTopY(Heightmap.Type.OCEAN_FLOOR, x, z);
    }

    private static void set(ServerWorld world, BlockPos pos, BlockState state) {
        world.setBlockState(pos, state, Block.NOTIFY_LISTENERS);
    }

    /** Solid ground under a building so it doesn't hang over a drop. */
    private static void foundation(ServerWorld world, int x, int y, int z) {
        for (int fy = y - 1; fy >= y - 8; fy--) {
            BlockPos p = new BlockPos(x, fy, z);
            if (world.getBlockState(p).isSolidBlock(world, p)) break;
            set(world, p, Blocks.SANDSTONE.getDefaultState());
        }
    }

    /** A glass dome house filled with air. pos is the centre of its floor. */
    private static void dome(ServerWorld world, BlockPos pos, Direction door, Resident who) {
        int r = DOME;
        for (int dx = -r - 1; dx <= r + 1; dx++) {
            for (int dz = -r - 1; dz <= r + 1; dz++) {
                world.getChunk((pos.getX() + dx) >> 4, (pos.getZ() + dz) >> 4);
                double flat = Math.sqrt(dx * dx + dz * dz);
                if (flat > r + 0.5) continue;
                int x = pos.getX() + dx, z = pos.getZ() + dz;
                foundation(world, x, pos.getY(), z);
                set(world, new BlockPos(x, pos.getY(), z), flat > r - 0.5
                        ? Blocks.PRISMARINE_BRICKS.getDefaultState() : Blocks.SMOOTH_SANDSTONE.getDefaultState());
                for (int dy = 1; dy <= r + 1; dy++) {
                    double d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    BlockPos p = new BlockPos(x, pos.getY() + dy, z);
                    if (d <= r - 1.5) set(world, p, Blocks.AIR.getDefaultState());
                    else if (d <= r + 0.5) set(world, p, Blocks.GLASS.getDefaultState());
                }
            }
        }
        set(world, pos.up(r), Blocks.SEA_LANTERN.getDefaultState());

        // Door in the outer wall facing the town, with a short air tunnel through the thick glass.
        for (int k = 3; k < r; k++) {
            set(world, pos.offset(door, k).up(), Blocks.AIR.getDefaultState());
            set(world, pos.offset(door, k).up(2), Blocks.AIR.getDefaultState());
        }
        BlockPos doorPos = pos.offset(door, r).up();
        BlockState lower = Blocks.SPRUCE_DOOR.getDefaultState().with(DoorBlock.FACING, door)
                .with(DoorBlock.HALF, DoubleBlockHalf.LOWER);
        set(world, doorPos, lower);
        set(world, doorPos.up(), lower.with(DoorBlock.HALF, DoubleBlockHalf.UPPER));

        // Inside: a bed, a light, a chest and the resident's work block.
        Direction left = door.rotateYCounterclockwise();
        BlockPos back = pos.offset(door.getOpposite(), 2).up();
        set(world, back.offset(left, 2), who.workstation().getDefaultState());
        set(world, back.offset(left.getOpposite(), 2), Blocks.CHEST.getDefaultState());
        bed(world, back.offset(left.getOpposite(), 0), door);
        set(world, pos.up().offset(left, 3), Blocks.LANTERN.getDefaultState());
        resident(world, pos.up().offset(door, 1), who);
    }

    private static void bed(ServerWorld world, BlockPos foot, Direction door) {
        Direction head = door.getOpposite();
        BlockState bed = Blocks.CYAN_BED.getDefaultState().with(net.minecraft.block.BedBlock.FACING, head);
        set(world, foot, bed.with(net.minecraft.block.BedBlock.PART, net.minecraft.block.enums.BedPart.FOOT));
        set(world, foot.offset(head), bed.with(net.minecraft.block.BedBlock.PART, net.minecraft.block.enums.BedPart.HEAD));
    }

    /** The diner in the middle of town: a prismarine hall with a glass roof, tables and a cook. */
    private static void diner(ServerWorld world, BlockPos pos) {
        int hw = 6, hd = 4, h = 5;
        for (int dx = -hw; dx <= hw; dx++) {
            for (int dz = -hd; dz <= hd; dz++) {
                int x = pos.getX() + dx, z = pos.getZ() + dz;
                world.getChunk(x >> 4, z >> 4);
                foundation(world, x, pos.getY(), z);
                boolean edge = Math.abs(dx) == hw || Math.abs(dz) == hd;
                set(world, new BlockPos(x, pos.getY(), z), Blocks.DARK_PRISMARINE.getDefaultState());
                for (int dy = 1; dy <= h; dy++) {
                    BlockPos p = new BlockPos(x, pos.getY() + dy, z);
                    if (dy == h) set(world, p, edge ? Blocks.PRISMARINE_BRICKS.getDefaultState() : Blocks.GLASS.getDefaultState());
                    else if (edge) set(world, p, dy == 2 && dx % 2 == 0 ? Blocks.GLASS.getDefaultState()
                            : Blocks.PRISMARINE_BRICKS.getDefaultState());
                    else set(world, p, Blocks.AIR.getDefaultState());
                }
            }
        }
        set(world, pos.up(h), Blocks.SEA_LANTERN.getDefaultState());
        set(world, pos.add(-3, h, 0), Blocks.SEA_LANTERN.getDefaultState());
        set(world, pos.add(3, h, 0), Blocks.SEA_LANTERN.getDefaultState());

        // Doors on both long sides.
        for (Direction d : new Direction[]{Direction.NORTH, Direction.SOUTH}) {
            BlockPos dp = pos.offset(d, hd).up();
            BlockState lower = Blocks.SPRUCE_DOOR.getDefaultState().with(DoorBlock.FACING, d.getOpposite())
                    .with(DoorBlock.HALF, DoubleBlockHalf.LOWER);
            set(world, dp, lower);
            set(world, dp.up(), lower.with(DoorBlock.HALF, DoubleBlockHalf.UPPER));
        }

        // A counter along the back, a smoker and some tables.
        for (int dx = -hw + 1; dx <= -hw + 3; dx++) {
            for (int dz = -hd + 1; dz <= hd - 1; dz++) {
                if (dx == -hw + 3) set(world, pos.add(dx, 1, dz), Blocks.STRIPPED_SPRUCE_LOG.getDefaultState());
            }
        }
        set(world, pos.add(-hw + 1, 1, 0), CHEF.workstation().getDefaultState());
        set(world, pos.add(-hw + 1, 1, 1), Blocks.CAMPFIRE.getDefaultState()
                .with(net.minecraft.block.CampfireBlock.LIT, false));
        set(world, pos.add(-hw + 1, 1, -1), Blocks.BARREL.getDefaultState());
        for (int[] t : new int[][]{{1, -2}, {1, 2}, {4, -2}, {4, 2}}) {
            BlockPos table = pos.add(t[0], 1, t[1]);
            set(world, table, Blocks.SPRUCE_FENCE.getDefaultState());
            set(world, table.up(), Blocks.SPRUCE_PRESSURE_PLATE.getDefaultState());
            set(world, table.east(), Blocks.SPRUCE_STAIRS.getDefaultState()
                    .with(net.minecraft.block.StairsBlock.FACING, Direction.WEST));
            set(world, table.west(), Blocks.SPRUCE_STAIRS.getDefaultState()
                    .with(net.minecraft.block.StairsBlock.FACING, Direction.EAST));
        }
        resident(world, pos.add(-hw + 2, 1, 0), CHEF);
    }

    /** A sandstone path along the sea floor from the town centre to a house. */
    private static void path(ServerWorld world, BlockPos from, BlockPos to) {
        int steps = (int) Math.ceil(Math.sqrt(from.getSquaredDistance(to)));
        for (int s = 0; s <= steps; s++) {
            double t = s / (double) Math.max(1, steps);
            int x = MathHelper.floor(MathHelper.lerp(t, from.getX(), to.getX()) + 0.5);
            int z = MathHelper.floor(MathHelper.lerp(t, from.getZ(), to.getZ()) + 0.5);
            int y = floorY(world, x, z) - 1;
            BlockPos p = new BlockPos(x, y, z);
            BlockState here = world.getBlockState(p);
            if (here.isOf(Blocks.GLASS) || here.isOf(Blocks.SMOOTH_SANDSTONE) || here.isOf(Blocks.DARK_PRISMARINE)
                    || here.isOf(Blocks.PRISMARINE_BRICKS)) continue;
            set(world, p, Blocks.CUT_SANDSTONE.getDefaultState());
        }
    }

    private static void resident(ServerWorld world, BlockPos at, Resident who) {
        VillagerEntity v = EntityType.VILLAGER.create(world);
        if (v == null) return;
        v.refreshPositionAndAngles(at.getX() + 0.5, at.getY(), at.getZ() + 0.5, world.getRandom().nextFloat() * 360f, 0f);
        v.initialize(world, world.getLocalDifficulty(at), SpawnReason.STRUCTURE, null, null);
        v.setVillagerData(v.getVillagerData().withProfession(who.job()).withLevel(2));
        v.setExperience(10); // keeps the job even if it loses its work block
        v.setCustomName(Text.literal(who.name()).formatted(Formatting.AQUA));
        v.setCustomNameVisible(true);
        v.setPersistent();
        v.addCommandTag(TAG);
        v.addStatusEffect(new StatusEffectInstance(StatusEffects.WATER_BREATHING, StatusEffectInstance.INFINITE, 0, false, false));
        world.spawnEntity(v);
    }
}
