package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.block.DoorBlock;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.block.entity.SignText;
import net.minecraft.block.enums.DoubleBlockHalf;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.SpawnReason;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.passive.HorseEntity;
import net.minecraft.entity.passive.VillagerEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.DyeableItem;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.screen.GenericContainerScreenHandler;
import net.minecraft.screen.ScreenHandlerType;
import net.minecraft.screen.SimpleNamedScreenHandlerFactory;
import net.minecraft.screen.slot.SlotActionType;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Formatting;
import net.minecraft.util.Hand;
import net.minecraft.util.TypedActionResult;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.hit.EntityHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;
import net.minecraft.village.VillagerProfession;
import net.minecraft.world.Heightmap;
import net.minecraft.world.PersistentState;
import net.minecraft.world.World;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Fairway: a grassy golf planet for Ad Astra (tier 1, so it's an easy first trip).
 *
 * The first time someone lands there, the Fairway Golf Club is built nearby: a clubhouse with a
 * Golf Pro who runs the shop, three mini golf lanes and six full holes (two par 3, two par 4 and two
 * long par 5s) with tees, fairways, bunkers, ponds, greens and flags. Golf is played for real: place
 * a Golf Ball, right-click near it with a club to hit it the way you're looking, and sink it in the
 * cup. Sinking a ball pays tycoon coins (more for under par). The shop sells clubs, balls, a golf cart,
 * a golf cap and deeds that build a cottage or a villa where you use them.
 */
final class Golf {
    private Golf() {}

    static final String PLANET = "helpermod:fairway";
    static final String PRO_TAG = "helpermod_golf_pro";
    static final String BALL_TAG = "helpermod_golf_ball";
    private static final String NBT = "HelperGolf";

    // ---------------------------------------------------------------------------------------
    // The course layout, relative to the clubhouse. Ground level is y 0.
    // ---------------------------------------------------------------------------------------

    private record Hazard(int x, int z, int r, boolean water) {}

    private record Hole(int number, String kind, int par, int teeX, int teeZ, int cupX, int cupZ, Hazard... hazards) {
        boolean mini() {
            return kind.equals("Mini golf");
        }
    }

    private static final int MINI_X0 = 12, MINI_X1 = 34;
    private static final int[] MINI_Z = {-8, 0, 8};

    private static final Hole[] HOLES = {
            new Hole(1, "Mini golf", 2, MINI_X0 + 1, MINI_Z[0], MINI_X1 - 1, MINI_Z[0]),
            new Hole(2, "Mini golf", 3, MINI_X0 + 1, MINI_Z[1], MINI_X1 - 1, MINI_Z[1]),
            new Hole(3, "Mini golf", 3, MINI_X0 + 1, MINI_Z[2], MINI_X1 - 1, MINI_Z[2]),
            new Hole(4, "Short hole", 3, -12, -16, -36, -16, new Hazard(-32, -19, 2, false)),
            new Hole(5, "Short hole", 3, -12, 16, -38, 20, new Hazard(-26, 23, 2, true)),
            new Hole(6, "Middle hole", 4, -42, -34, -68, -12, new Hazard(-58, -25, 2, false)),
            new Hole(7, "Middle hole", 4, -42, 34, -68, 12, new Hazard(-56, 25, 2, true)),
            new Hole(8, "Long hole", 5, 44, -34, 56, 34, new Hazard(50, 0, 2, false), new Hazard(55, -12, 2, true)),
            new Hole(9, "Long hole", 5, -82, 36, -82, -36, new Hazard(-82, -10, 2, false), new Hazard(-87, 12, 2, true)),
    };

    private static final int AREA_X0 = -92, AREA_X1 = 62, AREA_Z0 = -42, AREA_Z1 = 42;

    // ---------------------------------------------------------------------------------------
    // Saved state
    // ---------------------------------------------------------------------------------------

    static final class Data extends PersistentState {
        private static final String ID = "helpermod_golf";
        BlockPos centre;
        final Set<UUID> welcomed = new HashSet<>();

        static Data get(MinecraftServer server) {
            return server.getOverworld().getPersistentStateManager().getOrCreate(Data::fromNbt, Data::new, ID);
        }

        private static Data fromNbt(NbtCompound nbt) {
            Data d = new Data();
            if (nbt.contains("centre")) d.centre = BlockPos.fromLong(nbt.getLong("centre"));
            NbtList list = nbt.getList("welcomed", NbtElement.INT_ARRAY_TYPE);
            for (int i = 0; i < list.size(); i++) d.welcomed.add(net.minecraft.nbt.NbtHelper.toUuid(list.get(i)));
            return d;
        }

        @Override
        public NbtCompound writeNbt(NbtCompound nbt) {
            if (centre != null) nbt.putLong("centre", centre.asLong());
            NbtList list = new NbtList();
            for (UUID id : welcomed) list.add(net.minecraft.nbt.NbtHelper.fromUuid(id));
            nbt.put("welcomed", list);
            return nbt;
        }
    }

    /** A player's ball in play and how many strokes they've taken with it. */
    private static final class Round {
        UUID ball;
        int strokes;
    }

    private static final Map<UUID, Round> ROUNDS = new HashMap<>();
    private static final Set<UUID> TOLD = new HashSet<>();

    static void reset() {
        ROUNDS.clear();
        TOLD.clear();
    }

    // ---------------------------------------------------------------------------------------
    // Items
    // ---------------------------------------------------------------------------------------

    private record Club(String id, String name, Item item, double power, double lift, String what) {}

    private static final Club[] CLUBS = {
            new Club("putter", "Putter", Items.STICK, 0.30, 0.0, "a gentle roll for the green"),
            new Club("wedge", "Wedge", Items.BONE, 0.50, 0.55, "a high chip over bunkers and water"),
            new Club("iron", "Iron", Items.IRON_SHOVEL, 0.95, 0.30, "a solid mid-range shot"),
            new Club("driver", "Driver", Items.DIAMOND_SHOVEL, 1.45, 0.42, "the long one, for tee shots"),
    };

    private static ItemStack tagged(Item item, int count, String kind, String name, Formatting color, String lore) {
        ItemStack stack = new ItemStack(item, count);
        stack.getOrCreateNbt().putString(NBT, kind);
        stack.setCustomName(Text.literal(name).styled(s -> s.withItalic(false)).formatted(color));
        if (lore != null) {
            NbtCompound display = stack.getOrCreateSubNbt("display");
            NbtList l = new NbtList();
            l.add(net.minecraft.nbt.NbtString.of(Text.Serializer.toJson(Text.literal(lore).formatted(Formatting.GRAY))));
            display.put("Lore", l);
        }
        return stack;
    }

    static ItemStack club(Club c) {
        return tagged(c.item(), 1, "club:" + c.id(), c.name(), Formatting.GREEN, "Golf club: " + c.what());
    }

    static ItemStack balls(int n) {
        return tagged(Items.SNOWBALL, n, "ball", "Golf Ball", Formatting.WHITE, "Right-click the ground to place it");
    }

    static ItemStack deed(String kind) {
        return tagged(Items.PAPER, 1, "deed:" + kind, kind.equals("villa") ? "Fairway Villa Deed" : "Fairway Cottage Deed",
                Formatting.GOLD, "Right-click the ground to build your " + kind + " there");
    }

    static ItemStack cap() {
        ItemStack cap = tagged(Items.LEATHER_HELMET, 1, "cap", "Golf Cap", Formatting.WHITE, "Looking sharp on the green");
        ((DyeableItem) Items.LEATHER_HELMET).setColor(cap, 0xF2F2F2);
        return cap;
    }

    private static String kindOf(ItemStack stack) {
        NbtCompound nbt = stack.getNbt();
        return nbt != null && nbt.contains(NBT) ? nbt.getString(NBT) : null;
    }

    private static Club clubOf(ItemStack stack) {
        String k = kindOf(stack);
        if (k == null || !k.startsWith("club:")) return null;
        for (Club c : CLUBS) if (k.equals("club:" + c.id())) return c;
        return null;
    }

    // ---------------------------------------------------------------------------------------
    // Building the club the first time someone lands
    // ---------------------------------------------------------------------------------------

    static void tick(MinecraftServer server) {
        tickBalls(server);
        if (server.getTicks() % 40 != 0) return;
        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            if (player.isSpectator()) continue;
            ServerWorld world = player.getServerWorld();
            if (!Planets.keyOf(world).equals(PLANET)) continue;
            Data data = Data.get(server);
            if (data.centre == null) {
                if (player.hasVehicle() || !player.isOnGround()) continue;
                BlockPos centre = build(world, player);
                if (centre == null) continue;
                data.centre = centre;
                data.markDirty();
            }
            if (TOLD.add(player.getUuid())) {
                Helper.say(player, "Welcome to Fairway! The Fairway Golf Club is " + where(player, data.centre)
                        + ". Talk to the Golf Pro in the clubhouse for clubs, balls, carts and houses.");
            }
            if (data.welcomed.add(player.getUuid())) {
                data.markDirty();
                player.getInventory().offerOrDrop(club(CLUBS[0]));
                player.getInventory().offerOrDrop(balls(3));
                Helper.say(player, "Here's a free Putter and 3 Golf Balls to get you started. Try the mini golf first!");
            }
        }
    }

    private static BlockPos build(ServerWorld world, ServerPlayerEntity player) {
        // Put the club just south of the player, so the course doesn't land on top of them.
        int cx = MathHelper.floor(player.getX());
        int cz = MathHelper.floor(player.getZ()) + AREA_Z1 + 24;
        world.getChunk(cx >> 4, cz >> 4);
        int g = world.getTopY(Heightmap.Type.OCEAN_FLOOR_WG, cx, cz) - 1;
        if (g < world.getBottomY() + 16 || g > world.getTopY() - 40) return null;
        g = Math.max(g, 52); // above the lakes
        BlockPos c = new BlockPos(cx, g, cz);
        flatten(world, c);
        clubhouse(world, c);
        for (Hole h : HOLES) {
            if (h.mini()) miniLane(world, c, h);
            else hole(world, c, h);
        }
        return c;
    }

    private static void set(ServerWorld world, BlockPos pos, BlockState state) {
        if (world.getBlockState(pos) == state) return;
        world.setBlockState(pos, state, Block.NOTIFY_LISTENERS);
    }

    private static BlockPos at(BlockPos c, int x, int y, int z) {
        return c.add(x, y, z);
    }

    /** Level the whole course: grass at ground level, dirt under it down to the land, clear air above. */
    private static void flatten(ServerWorld world, BlockPos c) {
        BlockState air = Blocks.AIR.getDefaultState(), dirt = Blocks.DIRT.getDefaultState(), grass = Blocks.GRASS_BLOCK.getDefaultState();
        for (int x = AREA_X0; x <= AREA_X1; x++) {
            for (int z = AREA_Z0; z <= AREA_Z1; z++) {
                BlockPos col = at(c, x, 0, z);
                world.getChunk(col.getX() >> 4, col.getZ() >> 4);
                for (int y = 1; y <= 22; y++) {
                    BlockPos p = col.up(y);
                    if (!world.getBlockState(p).isAir()) set(world, p, air);
                }
                set(world, col, grass);
                for (int y = 1; y <= 30; y++) {
                    BlockPos p = col.down(y);
                    BlockState s = world.getBlockState(p);
                    if (s.isSolidBlock(world, p) && y > 3) break;
                    set(world, p, dirt);
                }
            }
        }
    }

    private static void clubhouse(ServerWorld world, BlockPos c) {
        int hw = 6, hd = 4, h = 5;
        for (int x = -hw; x <= hw; x++) {
            for (int z = -hd; z <= hd; z++) {
                boolean edge = Math.abs(x) == hw || Math.abs(z) == hd;
                boolean corner = Math.abs(x) == hw && Math.abs(z) == hd;
                set(world, at(c, x, 0, z), Blocks.BIRCH_PLANKS.getDefaultState());
                for (int y = 1; y < h; y++) {
                    BlockPos p = at(c, x, y, z);
                    if (corner) set(world, p, Blocks.STRIPPED_BIRCH_LOG.getDefaultState());
                    else if (edge) set(world, p, y == 2 && (x + z) % 2 == 0 ? Blocks.GLASS_PANE.getDefaultState() : Blocks.WHITE_CONCRETE.getDefaultState());
                    else set(world, p, Blocks.AIR.getDefaultState());
                }
                set(world, at(c, x, h, z), Blocks.DARK_OAK_SLAB.getDefaultState());
            }
        }
        for (int[] l : new int[][]{{-3, 0}, {3, 0}}) set(world, at(c, l[0], h - 1, l[1]), Blocks.LANTERN.getDefaultState()
                .with(net.minecraft.block.LanternBlock.HANGING, true));
        // Front door facing the course (east, towards the mini golf).
        BlockState lower = Blocks.BIRCH_DOOR.getDefaultState().with(DoorBlock.FACING, Direction.WEST).with(DoorBlock.HALF, DoubleBlockHalf.LOWER);
        set(world, at(c, hw, 1, 0), lower);
        set(world, at(c, hw, 2, 0), lower.with(DoorBlock.HALF, DoubleBlockHalf.UPPER));
        BlockState lower2 = Blocks.BIRCH_DOOR.getDefaultState().with(DoorBlock.FACING, Direction.EAST).with(DoorBlock.HALF, DoubleBlockHalf.LOWER);
        set(world, at(c, -hw, 1, 0), lower2);
        set(world, at(c, -hw, 2, 0), lower2.with(DoorBlock.HALF, DoubleBlockHalf.UPPER));
        // The pro shop counter and some club racks.
        for (int z = -2; z <= 2; z++) set(world, at(c, -2, 1, z), Blocks.STRIPPED_BIRCH_LOG.getDefaultState());
        set(world, at(c, -4, 1, -3), Blocks.BARREL.getDefaultState());
        set(world, at(c, -4, 1, 3), Blocks.BARREL.getDefaultState());
        for (int x = 1; x <= 4; x++) {
            set(world, at(c, x, 1, -3), Blocks.BIRCH_FENCE.getDefaultState());
            set(world, at(c, x, 1, 3), Blocks.BIRCH_FENCE.getDefaultState());
        }
        sign(world, at(c, hw + 1, 1, 2), Direction.EAST, "Fairway", "Golf Club", "Pro shop inside", "Holes 1-9");
        pro(world, at(c, -4, 1, 0));
    }

    private static void pro(ServerWorld world, BlockPos at) {
        VillagerEntity v = EntityType.VILLAGER.create(world);
        if (v == null) return;
        v.refreshPositionAndAngles(at.getX() + 0.5, at.getY(), at.getZ() + 0.5, -90f, 0f);
        v.initialize(world, world.getLocalDifficulty(at), SpawnReason.STRUCTURE, null, null);
        v.setVillagerData(v.getVillagerData().withProfession(VillagerProfession.NITWIT));
        v.setCustomName(Text.literal("Golf Pro").formatted(Formatting.GREEN));
        v.setCustomNameVisible(true);
        v.setPersistent();
        v.setAiDisabled(true);
        v.setInvulnerable(true);
        v.addCommandTag(PRO_TAG);
        world.spawnEntity(v);
    }

    private static void sign(ServerWorld world, BlockPos pos, Direction facing, String... lines) {
        int rot = switch (facing) {
            case SOUTH -> 0;
            case WEST -> 4;
            case NORTH -> 8;
            default -> 12; // EAST
        };
        set(world, pos, Blocks.BIRCH_SIGN.getDefaultState().with(net.minecraft.block.SignBlock.ROTATION, rot));
        BlockEntity be = world.getBlockEntity(pos);
        if (be instanceof SignBlockEntity s) {
            SignText text = new SignText();
            for (int i = 0; i < Math.min(4, lines.length); i++) text = text.withMessage(i, Text.literal(lines[i]));
            s.setText(text, true);
            s.markDirty();
            world.updateListeners(pos, world.getBlockState(pos), world.getBlockState(pos), Block.NOTIFY_LISTENERS);
        }
    }

    private static void disc(ServerWorld world, BlockPos c, int x0, int z0, int r, BlockState state) {
        for (int x = -r; x <= r; x++) {
            for (int z = -r; z <= r; z++) {
                if (x * x + z * z <= r * r + r) set(world, at(c, x0 + x, 0, z0 + z), state);
            }
        }
    }

    /** A full hole: tee box and sign, a fairway strip, hazards, then the green with its cup and flag. */
    private static void hole(ServerWorld world, BlockPos c, Hole h) {
        int dx = h.cupX() - h.teeX(), dz = h.cupZ() - h.teeZ();
        int len = (int) Math.round(Math.sqrt(dx * dx + dz * dz));
        BlockState fairway = Blocks.MOSS_BLOCK.getDefaultState();
        for (int s = 0; s <= len; s++) {
            double t = s / (double) Math.max(1, len);
            int fx = (int) Math.round(h.teeX() + dx * t), fz = (int) Math.round(h.teeZ() + dz * t);
            int w = s < 4 ? 1 : 3;
            for (int ox = -w; ox <= w; ox++) for (int oz = -w; oz <= w; oz++) set(world, at(c, fx + ox, 0, fz + oz), fairway);
        }
        for (Hazard z : h.hazards()) {
            disc(world, c, z.x(), z.z(), z.r(), z.water() ? Blocks.WATER.getDefaultState() : Blocks.SAND.getDefaultState());
        }
        disc(world, c, h.cupX(), h.cupZ(), 4, Blocks.GREEN_CONCRETE.getDefaultState());
        for (int ox = -1; ox <= 1; ox++) for (int oz = -1; oz <= 1; oz++) set(world, at(c, h.teeX() + ox, 0, h.teeZ() + oz), Blocks.SMOOTH_STONE.getDefaultState());
        cup(world, c, h, true);
        Direction back = Direction.getFacing(-dx, 0, -dz);
        BlockPos signAt = at(c, h.teeX(), 1, h.teeZ()).offset(back, 2).offset(back.rotateYClockwise(), 2);
        sign(world, signAt, back.getOpposite() == Direction.UP ? Direction.SOUTH : back,
                "Hole " + h.number(), h.kind(), "Par " + h.par(), len + " blocks");
    }

    /** A mini golf lane: a walled carpet-green strip with a few obstacles. */
    private static void miniLane(ServerWorld world, BlockPos c, Hole h) {
        int z0 = h.teeZ();
        BlockState lane = Blocks.LIME_CONCRETE.getDefaultState(), wall = Blocks.STRIPPED_OAK_LOG.getDefaultState()
                .with(net.minecraft.block.PillarBlock.AXIS, Direction.Axis.X);
        for (int x = MINI_X0 - 1; x <= MINI_X1 + 1; x++) {
            for (int z = -2; z <= 2; z++) {
                boolean side = Math.abs(z) == 2 || x == MINI_X0 - 1 || x == MINI_X1 + 1;
                set(world, at(c, x, 0, z0 + z), side ? Blocks.STRIPPED_OAK_LOG.getDefaultState() : lane);
                if (side) set(world, at(c, x, 1, z0 + z), wall);
            }
        }
        if (h.number() == 2) { // a post in the middle: go round it
            set(world, at(c, 23, 1, z0), Blocks.STRIPPED_OAK_LOG.getDefaultState());
        } else if (h.number() == 3) { // a zig-zag
            set(world, at(c, 19, 1, z0 - 1), Blocks.STRIPPED_OAK_LOG.getDefaultState());
            set(world, at(c, 19, 1, z0), Blocks.STRIPPED_OAK_LOG.getDefaultState());
            set(world, at(c, 27, 1, z0 + 1), Blocks.STRIPPED_OAK_LOG.getDefaultState());
            set(world, at(c, 27, 1, z0), Blocks.STRIPPED_OAK_LOG.getDefaultState());
        }
        set(world, at(c, h.teeX(), 0, h.teeZ()), Blocks.WHITE_CONCRETE.getDefaultState());
        cup(world, c, h, false);
        sign(world, at(c, MINI_X0 - 1, 2, z0), Direction.WEST, "Hole " + h.number(), "Mini golf", "Par " + h.par(), "");
    }

    private static void cup(ServerWorld world, BlockPos c, Hole h, boolean flag) {
        BlockPos cup = at(c, h.cupX(), 0, h.cupZ());
        set(world, cup, Blocks.AIR.getDefaultState());
        set(world, cup.down(), Blocks.WHITE_CONCRETE.getDefaultState());
        if (flag) {
            BlockPos pole = cup.add(1, 0, 1);
            for (int y = 1; y <= 3; y++) set(world, pole.up(y), Blocks.BIRCH_FENCE.getDefaultState());
            set(world, pole.up(4), Blocks.RED_WOOL.getDefaultState());
        }
    }

    private static String where(ServerPlayerEntity player, BlockPos c) {
        double dx = c.getX() + 0.5 - player.getX(), dz = c.getZ() + 0.5 - player.getZ();
        int dist = (int) Math.round(Math.sqrt(dx * dx + dz * dz));
        if (dist < 12) return "right here";
        String[] dirs = {"south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"};
        int i = Math.floorMod(Math.round((float) (Math.toDegrees(Math.atan2(-dx, dz)) / 45.0)), 8);
        return dist + " blocks to the " + dirs[i] + " (at " + c.getX() + ", " + c.getY() + ", " + c.getZ() + ")";
    }

    // ---------------------------------------------------------------------------------------
    // Playing
    // ---------------------------------------------------------------------------------------

    static TypedActionResult<ItemStack> onUseItem(PlayerEntity p, World w, Hand hand) {
        ItemStack stack = p.getStackInHand(hand);
        String kind = kindOf(stack);
        if (kind == null) return TypedActionResult.pass(stack);
        if (w.isClient) return kind.equals("cap") ? TypedActionResult.pass(stack) : TypedActionResult.success(stack);
        if (!(p instanceof ServerPlayerEntity player) || p instanceof FakePlayer) return TypedActionResult.pass(stack);
        if (kind.equals("ball") || kind.startsWith("deed:")) {
            player.sendMessage(Text.literal("Right-click the ground to use it.").formatted(Formatting.YELLOW), true);
            return TypedActionResult.success(stack);
        }
        Club club = clubOf(stack);
        if (club != null) {
            swing(player, club);
            return TypedActionResult.success(stack);
        }
        return TypedActionResult.pass(stack);
    }

    static ActionResult onUseBlock(PlayerEntity p, World w, Hand hand, BlockHitResult hit) {
        ItemStack stack = p.getStackInHand(hand);
        String kind = kindOf(stack);
        if (kind == null || kind.equals("cap")) return ActionResult.PASS;
        if (w.isClient) return ActionResult.SUCCESS;
        if (!(p instanceof ServerPlayerEntity player) || p instanceof FakePlayer) return ActionResult.PASS;
        BlockPos top = hit.getBlockPos().up();
        if (kind.equals("ball")) {
            placeBall(player, (ServerWorld) w, top);
            if (!player.isCreative()) stack.decrement(1);
        } else if (kind.startsWith("deed:")) {
            if (House.build((ServerWorld) w, top, player.getHorizontalFacing(), kind.substring(5).equals("villa"))) {
                if (!player.isCreative()) stack.decrement(1);
                Helper.say(player, "Your " + kind.substring(5) + " is built! Make yourself at home.");
            } else {
                Helper.say(player, "There isn't enough open space here for that. Try a flat, clear spot.");
            }
        } else {
            Club club = clubOf(stack);
            if (club != null) swing(player, club);
        }
        return ActionResult.SUCCESS;
    }

    static ActionResult onUseEntity(PlayerEntity p, World w, Hand hand, Entity entity, EntityHitResult hit) {
        if (!entity.getCommandTags().contains(PRO_TAG)) return ActionResult.PASS;
        if (w.isClient) return ActionResult.SUCCESS;
        if (hand == Hand.MAIN_HAND && p instanceof ServerPlayerEntity player) openShop(player);
        return ActionResult.SUCCESS;
    }

    private static void placeBall(ServerPlayerEntity player, ServerWorld world, BlockPos at) {
        ItemEntity old = ball(player);
        if (old != null) {
            old.discard();
            player.getInventory().offerOrDrop(balls(1));
        }
        ItemStack look = new ItemStack(Items.SNOWBALL);
        look.getOrCreateNbt().putLong("HelperGolfId", world.getRandom().nextLong()); // never merges
        ItemEntity ball = new ItemEntity(world, at.getX() + 0.5, at.getY() + 0.05, at.getZ() + 0.5, look, 0, 0, 0);
        ball.setPickupDelayInfinite();
        ball.setNeverDespawn();
        ball.addCommandTag(BALL_TAG);
        world.spawnEntity(ball);
        Round r = ROUNDS.computeIfAbsent(player.getUuid(), k -> new Round());
        r.ball = ball.getUuid();
        r.strokes = 0;
        player.sendMessage(Text.literal("Ball placed. Stand next to it and right-click with a club to hit it the way you look. Sneak for a softer shot.")
                .formatted(Formatting.GREEN), true);
    }

    private static ItemEntity ball(ServerPlayerEntity player) {
        Round r = ROUNDS.get(player.getUuid());
        if (r == null || r.ball == null) return null;
        Entity e = player.getServerWorld().getEntity(r.ball);
        return e instanceof ItemEntity ie && ie.isAlive() ? ie : null;
    }

    private static void swing(ServerPlayerEntity player, Club club) {
        ItemEntity ball = ball(player);
        if (ball == null) {
            player.sendMessage(Text.literal("Place a Golf Ball first (right-click the ground with one).").formatted(Formatting.YELLOW), true);
            return;
        }
        if (ball.squaredDistanceTo(player) > 3.5 * 3.5) {
            player.sendMessage(Text.literal("Get closer to your ball (it's " + (int) Math.sqrt(ball.squaredDistanceTo(player)) + " blocks away).")
                    .formatted(Formatting.YELLOW), true);
            return;
        }
        if (ball.getVelocity().horizontalLengthSquared() > 0.003) {
            player.sendMessage(Text.literal("Wait for the ball to stop.").formatted(Formatting.YELLOW), true);
            return;
        }
        double yaw = Math.toRadians(player.getYaw());
        double soft = player.isSneaking() ? 0.5 : 1.0;
        double h = club.power() * soft, v = club.lift() * soft;
        ball.setVelocity(-Math.sin(yaw) * h, v + 0.05, Math.cos(yaw) * h);
        ball.velocityModified = true;
        Round r = ROUNDS.get(player.getUuid());
        r.strokes++;
        ServerWorld world = player.getServerWorld();
        world.playSound(null, ball.getBlockPos(), club.id().equals("putter") ? SoundEvents.BLOCK_WOOD_HIT : SoundEvents.ENTITY_PLAYER_ATTACK_STRONG,
                SoundCategory.PLAYERS, 0.8f, 1.6f);
        world.spawnParticles(ParticleTypes.CRIT, ball.getX(), ball.getY() + 0.1, ball.getZ(), 6, 0.1, 0.1, 0.1, 0.1);
        player.swingHand(Hand.MAIN_HAND, true);
        player.sendMessage(Text.literal(club.name() + " - stroke " + r.strokes).formatted(Formatting.AQUA), true);
    }

    /** Pick your ball back up: /helper golf ball */
    static void pickUp(ServerPlayerEntity player) {
        ItemEntity ball = ball(player);
        if (ball == null) {
            Helper.say(player, "You don't have a ball in play.");
            return;
        }
        ball.discard();
        ROUNDS.remove(player.getUuid());
        player.getInventory().offerOrDrop(balls(1));
        Helper.say(player, "Ball picked up.");
    }

    private static void tickBalls(MinecraftServer server) {
        if (ROUNDS.isEmpty()) return;
        Data data = Data.get(server);
        for (var it = ROUNDS.entrySet().iterator(); it.hasNext(); ) {
            var e = it.next();
            ServerPlayerEntity player = server.getPlayerManager().getPlayer(e.getKey());
            Round r = e.getValue();
            if (player == null || r.ball == null) continue;
            ItemEntity ball = ball(player);
            if (ball == null) {
                it.remove();
                continue;
            }
            if (ball.isTouchingWater()) {
                ball.discard();
                it.remove();
                player.getInventory().offerOrDrop(balls(1));
                Helper.say(player, "Splash! Your ball went in the water. Here it is back; place it again and add a stroke.");
                continue;
            }
            if (data.centre == null || !Planets.keyOf(ball.getWorld()).equals(PLANET)) continue;
            BlockPos bp = ball.getBlockPos();
            for (Hole h : HOLES) {
                BlockPos cup = data.centre.add(h.cupX(), 0, h.cupZ());
                if (!bp.equals(cup)) continue;
                ball.discard();
                it.remove();
                sunk(player, h, r.strokes);
                break;
            }
        }
    }

    private static void sunk(ServerPlayerEntity player, Hole h, int strokes) {
        int diff = strokes - h.par();
        String name;
        long coins;
        if (strokes == 1) { name = "HOLE IN ONE!"; coins = 5000; }
        else if (diff <= -2) { name = "Eagle!"; coins = 2000; }
        else if (diff == -1) { name = "Birdie!"; coins = 1000; }
        else if (diff == 0) { name = "Par."; coins = 500; }
        else if (diff == 1) { name = "Bogey."; coins = 200; }
        else { name = "Finished."; coins = 50; }
        Tycoon.Data td = Tycoon.Data.get(player.getServer());
        td.add(player.getUuid(), coins);
        player.getInventory().offerOrDrop(balls(1));
        ServerWorld world = player.getServerWorld();
        world.playSound(null, player.getBlockPos(), strokes == 1 ? SoundEvents.UI_TOAST_CHALLENGE_COMPLETE : SoundEvents.ENTITY_PLAYER_LEVELUP,
                SoundCategory.PLAYERS, 0.8f, 1.2f);
        Text msg = Text.literal("[Golf] ").formatted(Formatting.GREEN).append(Text.literal(player.getName().getString() + " sank hole "
                + h.number() + " (" + h.kind().toLowerCase(java.util.Locale.ROOT) + ", par " + h.par() + ") in " + strokes
                + (strokes == 1 ? " stroke. " : " strokes. ") + name + " +" + coins + " coins").formatted(Formatting.WHITE));
        for (ServerPlayerEntity p : player.getServer().getPlayerManager().getPlayerList()) {
            if (p == player || p.getWorld() == player.getWorld()) p.sendMessage(msg, false);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Commands and the shop
    // ---------------------------------------------------------------------------------------

    /** /helper golf */
    static void info(ServerPlayerEntity player) {
        Data data = Data.get(player.getServer());
        if (!Planets.keyOf(player.getServerWorld()).equals(PLANET)) {
            Helper.say(player, "The golf course is on Fairway, a grassy planet. Fly there with a tier 1 Ad Astra rocket "
                    + "(the same one that reaches the Moon).");
        } else if (data.centre == null) {
            Helper.say(player, "The Fairway Golf Club gets built near you as soon as you're standing on the ground.");
        } else {
            Helper.say(player, "The Fairway Golf Club is " + where(player, data.centre) + ".");
        }
        String[] how = {
                "Place a Golf Ball by right-clicking the ground with it (best on a tee).",
                "Stand next to it, look where you want it to go and right-click with a club. Sneak for half power.",
                "Putter: short roll. Wedge: high chip. Iron: mid shot. Driver: long tee shot.",
                "Sink it in the cup by the flag. Hole in one 5000 coins, eagle 2000, birdie 1000, par 500, bogey 200.",
                "Holes 1-3 are mini golf, 4-5 short (par 3), 6-7 middle (par 4), 8-9 long (par 5).",
                "/helper golf shop (on Fairway) or talk to the Golf Pro.  /helper golf ball picks your ball back up.",
        };
        for (String line : how) player.sendMessage(Text.literal(line).formatted(Formatting.GRAY), false);
    }

    private record Offer(long price, String what, java.util.function.Supplier<ItemStack> item,
                         java.util.function.Predicate<ServerPlayerEntity> action) {}

    private static final Offer[] OFFERS = {
            new Offer(200, "Putter", () -> club(CLUBS[0]), null),
            new Offer(400, "Wedge", () -> club(CLUBS[1]), null),
            new Offer(600, "Iron", () -> club(CLUBS[2]), null),
            new Offer(1000, "Driver", () -> club(CLUBS[3]), null),
            new Offer(100, "4 Golf Balls", () -> balls(4), null),
            new Offer(300, "Golf Cap", Golf::cap, null),
            new Offer(5000, "Golf Cart (a speedy ride)", () -> named(Items.SADDLE, "Golf Cart"), Golf::cart),
            new Offer(20000, "Cottage Deed (builds a cottage)", () -> deed("cottage"), null),
            new Offer(100000, "Villa Deed (builds a big villa)", () -> deed("villa"), null),
            new Offer(50, "16 Cookies (clubhouse snack)", () -> new ItemStack(Items.COOKIE, 16), null),
    };

    private static ItemStack named(Item item, String name) {
        ItemStack s = new ItemStack(item);
        s.setCustomName(Text.literal(name));
        return s;
    }

    /** A golf cart: a fast, tame, saddled white horse that's yours. */
    private static boolean cart(ServerPlayerEntity player) {
        ServerWorld world = player.getServerWorld();
        HorseEntity horse = EntityType.HORSE.create(world);
        if (horse == null) return false;
        Vec3d at = player.getPos().add(player.getRotationVector().multiply(2).multiply(1, 0, 1));
        horse.refreshPositionAndAngles(at.x, player.getY(), at.z, player.getYaw(), 0);
        horse.setTame(true);
        horse.setOwnerUuid(player.getUuid());
        horse.saddle(SoundCategory.NEUTRAL);
        var speed = horse.getAttributeInstance(EntityAttributes.GENERIC_MOVEMENT_SPEED);
        if (speed != null) speed.setBaseValue(0.36);
        var jump = horse.getAttributeInstance(EntityAttributes.HORSE_JUMP_STRENGTH);
        if (jump != null) jump.setBaseValue(0.6);
        var hp = horse.getAttributeInstance(EntityAttributes.GENERIC_MAX_HEALTH);
        if (hp != null) hp.setBaseValue(30);
        horse.setHealth(30);
        horse.setCustomName(Text.literal(player.getName().getString() + "'s Golf Cart").formatted(Formatting.WHITE));
        horse.setPersistent();
        world.spawnEntity(horse);
        Helper.say(player, "Your golf cart is parked next to you. Hop on!");
        return true;
    }

    static void openShop(ServerPlayerEntity player) {
        if (!Planets.keyOf(player.getServerWorld()).equals(PLANET)) {
            Helper.say(player, "The golf shop is in the Fairway Golf Club, on the planet Fairway.");
            return;
        }
        player.openHandledScreen(new SimpleNamedScreenHandlerFactory(
                (syncId, inv, p) -> new Shop(syncId, inv, player, new SimpleInventory(27)),
                Text.literal("Fairway Pro Shop")));
    }

    static final class Shop extends GenericContainerScreenHandler {
        private final ServerPlayerEntity player;
        private final SimpleInventory view;

        private Shop(int syncId, PlayerInventory inv, ServerPlayerEntity player, SimpleInventory view) {
            super(ScreenHandlerType.GENERIC_9X3, syncId, inv, view, 3);
            this.player = player;
            this.view = view;
            refresh();
        }

        private void refresh() {
            for (int i = 0; i < 27; i++) view.setStack(i, ItemStack.EMPTY);
            for (int i = 0; i < OFFERS.length; i++) {
                Offer o = OFFERS[i];
                ItemStack shown = o.item().get();
                ItemStack b = Storage.Menu.button(shown.getItem(), o.what(), "Costs " + o.price() + " tycoon coins", "Click to buy");
                b.setCount(Math.max(1, shown.getCount()));
                view.setStack(i, b);
            }
            view.setStack(26, Storage.Menu.button(Items.GOLD_INGOT, Tycoon.Data.get(player.getServer()).coins(player.getUuid()) + " coins",
                    "Earn coins with the tycoon", "or by sinking putts"));
            sendContentUpdates();
        }

        @Override
        public void onSlotClick(int slotIndex, int button, SlotActionType action, PlayerEntity p) {
            if (slotIndex < 0 || slotIndex >= 27) {
                if (action != SlotActionType.QUICK_MOVE) super.onSlotClick(slotIndex, button, action, p);
                return;
            }
            if (action == SlotActionType.PICKUP && slotIndex < OFFERS.length) buy(OFFERS[slotIndex]);
            refresh();
        }

        private void buy(Offer o) {
            Tycoon.Data data = Tycoon.Data.get(player.getServer());
            if (data.coins(player.getUuid()) < o.price()) {
                player.sendMessage(Text.literal("You need " + o.price() + " coins (you have " + data.coins(player.getUuid()) + ").")
                        .formatted(Formatting.RED), true);
                return;
            }
            if (o.action() != null) {
                if (!o.action().test(player)) return;
            } else {
                player.getInventory().offerOrDrop(o.item().get());
            }
            data.add(player.getUuid(), -o.price());
            player.playSound(SoundEvents.ENTITY_VILLAGER_YES, SoundCategory.PLAYERS, 0.6f, 1.2f);
            player.sendMessage(Text.literal("Bought " + o.what() + ".").formatted(Formatting.GREEN), true);
        }

        @Override
        public ItemStack quickMove(PlayerEntity p, int slot) {
            return ItemStack.EMPTY;
        }

        @Override
        public boolean canUse(PlayerEntity p) {
            return true;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Houses from deeds
    // ---------------------------------------------------------------------------------------

    static final class House {
        private House() {}

        /** Builds a cottage (7x7) or villa (11x9) with its door facing the player. False if there's no room. */
        static boolean build(ServerWorld world, BlockPos floorAbove, Direction playerFacing, boolean villa) {
            int w = villa ? 11 : 7, d = villa ? 9 : 7, h = villa ? 5 : 4;
            Direction front = playerFacing.getOpposite(); // the door faces back at the player
            Direction right = front.rotateYClockwise();
            // The house goes in front of the player: its front wall is 1 block ahead of where they clicked.
            BlockPos origin = floorAbove.down().offset(playerFacing, d).offset(right, -(w / 2));
            // origin = back-left corner at floor level; the front wall is towards the player.
            for (int a = 0; a < w; a++) {
                for (int b = 0; b < d; b++) {
                    for (int y = 1; y <= h + 1; y++) {
                        BlockPos p = origin.offset(right, a).offset(front, b).up(y);
                        BlockState s = world.getBlockState(p);
                        if (!s.isAir() && !s.isReplaceable()) return false;
                    }
                }
            }
            BlockState planks = Blocks.BIRCH_PLANKS.getDefaultState(), log = Blocks.STRIPPED_BIRCH_LOG.getDefaultState();
            for (int a = 0; a < w; a++) {
                for (int b = 0; b < d; b++) {
                    BlockPos base = origin.offset(right, a).offset(front, b);
                    boolean edgeA = a == 0 || a == w - 1, edgeB = b == 0 || b == d - 1;
                    world.setBlockState(base, Blocks.SPRUCE_PLANKS.getDefaultState());
                    for (int y = 1; y <= h; y++) {
                        BlockPos p = base.up(y);
                        if (edgeA && edgeB) world.setBlockState(p, log);
                        else if (edgeA || edgeB) world.setBlockState(p, y == 2 && (a + b) % 3 == 1 ? Blocks.GLASS_PANE.getDefaultState() : planks);
                        else world.setBlockState(p, Blocks.AIR.getDefaultState());
                    }
                    world.setBlockState(base.up(h + 1), Blocks.DARK_OAK_SLAB.getDefaultState());
                }
            }
            // Door in the middle of the front wall.
            BlockPos door = origin.offset(right, w / 2).offset(front, d - 1).up();
            BlockState lower = Blocks.BIRCH_DOOR.getDefaultState().with(DoorBlock.FACING, front).with(DoorBlock.HALF, DoubleBlockHalf.LOWER);
            world.setBlockState(door, lower);
            world.setBlockState(door.up(), lower.with(DoorBlock.HALF, DoubleBlockHalf.UPPER));
            // Inside: bed(s), chest, crafting table, furnace, lights.
            BlockPos backLeft = origin.offset(right, 1).offset(front, 1).up();
            bed(world, backLeft, front);
            if (villa) bed(world, backLeft.offset(right, 2), front);
            BlockPos backRight = origin.offset(right, w - 2).offset(front, 1).up();
            world.setBlockState(backRight, Blocks.CHEST.getDefaultState());
            world.setBlockState(backRight.offset(front), Blocks.CRAFTING_TABLE.getDefaultState());
            world.setBlockState(backRight.offset(front, 2), Blocks.FURNACE.getDefaultState());
            if (villa) {
                world.setBlockState(backRight.offset(right.getOpposite()), Blocks.CHEST.getDefaultState());
                world.setBlockState(backRight.offset(front, 3), Blocks.SMOKER.getDefaultState());
                world.setBlockState(origin.offset(right, w / 2).offset(front, d / 2).up(), Blocks.LIGHT_GRAY_CARPET.getDefaultState());
            }
            world.setBlockState(origin.offset(right, w / 2).offset(front, d / 2).up(h), Blocks.LANTERN.getDefaultState()
                    .with(net.minecraft.block.LanternBlock.HANGING, true));
            world.playSound(null, door, SoundEvents.BLOCK_WOOD_PLACE, SoundCategory.BLOCKS, 1f, 1f);
            return true;
        }

        private static void bed(ServerWorld world, BlockPos foot, Direction front) {
            // Head against the back wall: the head is one block further back than the foot.
            Direction head = front.getOpposite();
            BlockPos footPos = foot.offset(front);
            BlockState bed = Blocks.WHITE_BED.getDefaultState().with(net.minecraft.block.BedBlock.FACING, head);
            world.setBlockState(footPos, bed.with(net.minecraft.block.BedBlock.PART, net.minecraft.block.enums.BedPart.FOOT));
            world.setBlockState(footPos.offset(head), bed.with(net.minecraft.block.BedBlock.PART, net.minecraft.block.enums.BedPart.HEAD));
        }
    }
}
