package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.Mth;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.animal.equine.Horse;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.npc.villager.Villager;
import net.minecraft.world.entity.npc.villager.VillagerProfession;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.DoorBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.SignBlockEntity;
import net.minecraft.world.level.block.entity.SignText;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.DoubleBlockHalf;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import net.minecraft.world.phys.Vec3;
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

    static final class Data extends SavedData {
        private static final String ID = "helpermod_golf";
        private static final SavedDataType<Data> TYPE = Compat.dataType(ID, Data::new, Data::fromNbt, d -> d.save(new CompoundTag()));
        BlockPos centre;
        final Set<UUID> welcomed = new HashSet<>();

        static Data get(MinecraftServer server) {
            return server.overworld().getDataStorage().computeIfAbsent(TYPE);
        }

        private static Data fromNbt(CompoundTag nbt) {
            Data d = new Data();
            if (nbt.contains("centre")) d.centre = BlockPos.of(nbt.getLongOr("centre", 0L));
            ListTag list = nbt.getListOrEmpty("welcomed");
            for (int i = 0; i < list.size(); i++) d.welcomed.add(Compat.uuidOf(list.get(i)));
            return d;
        }

                public CompoundTag save(CompoundTag nbt) {
            if (centre != null) nbt.putLong("centre", centre.asLong());
            ListTag list = new ListTag();
            for (UUID id : welcomed) list.add(Compat.uuidTag(id));
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

    private static ItemStack tagged(Item item, int count, String kind, String name, ChatFormatting color, String lore) {
        ItemStack stack = new ItemStack(item, count);
        Compat.editTag(stack, t -> t.putString(NBT, kind));
        stack.set(net.minecraft.core.component.DataComponents.CUSTOM_NAME, Component.literal(name).withStyle(s -> s.withItalic(false)).withStyle(color));
        if (lore != null) {
            java.util.List<Component> l = new java.util.ArrayList<>();
            l.add(Component.literal(lore).withStyle(ChatFormatting.GRAY));
            Compat.lore(stack, l);
        }
        return stack;
    }

    static ItemStack club(Club c) {
        return tagged(c.item(), 1, "club:" + c.id(), c.name(), ChatFormatting.GREEN, "Golf club: " + c.what());
    }

    static ItemStack balls(int n) {
        return tagged(Items.SNOWBALL, n, "ball", "Golf Ball", ChatFormatting.WHITE, "Right-click the ground to place it");
    }

    static ItemStack deed(String kind) {
        return tagged(Items.PAPER, 1, "deed:" + kind, kind.equals("villa") ? "Fairway Villa Deed" : "Fairway Cottage Deed",
                ChatFormatting.GOLD, "Right-click the ground to build your " + kind + " there");
    }

    static ItemStack cap() {
        ItemStack cap = tagged(Items.LEATHER_HELMET, 1, "cap", "Golf Cap", ChatFormatting.WHITE, "Looking sharp on the green");
        cap.set(net.minecraft.core.component.DataComponents.DYED_COLOR, new net.minecraft.world.item.component.DyedItemColor(0xF2F2F2));
        return cap;
    }

    private static String kindOf(ItemStack stack) {
        CompoundTag nbt = Compat.tag(stack);
        return nbt != null && nbt.contains(NBT) ? nbt.getStringOr(NBT, "") : null;
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
        if (server.getTickCount() % 40 != 0) return;
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            if (player.isSpectator()) continue;
            ServerLevel world = player.level();
            if (!Planets.keyOf(world).equals(PLANET)) continue;
            Data data = Data.get(server);
            if (data.centre == null) {
                if (player.isPassenger() || !player.onGround()) continue;
                BlockPos centre = build(world, player);
                if (centre == null) continue;
                data.centre = centre;
                data.setDirty();
            }
            if (TOLD.add(player.getUUID())) {
                Helper.say(player, "Welcome to Fairway! The Fairway Golf Club is " + where(player, data.centre)
                        + ". Talk to the Golf Pro in the clubhouse for clubs, balls, carts and houses.");
            }
            if (data.welcomed.add(player.getUUID())) {
                data.setDirty();
                player.getInventory().placeItemBackInInventory(club(CLUBS[0]), net.minecraft.util.Prediction.SERVER_ONLY);
                player.getInventory().placeItemBackInInventory(balls(3), net.minecraft.util.Prediction.SERVER_ONLY);
                Helper.say(player, "Here's a free Putter and 3 Golf Balls to get you started. Try the mini golf first!");
            }
        }
    }

    private static BlockPos build(ServerLevel world, ServerPlayer player) {
        // Put the club just south of the player, so the course doesn't land on top of them.
        int cx = Mth.floor(player.getX());
        int cz = Mth.floor(player.getZ()) + AREA_Z1 + 24;
        world.getChunk(cx >> 4, cz >> 4);
        int g = world.getHeight(Heightmap.Types.OCEAN_FLOOR_WG, cx, cz) - 1;
        if (g < world.getMinY() + 16 || g > (world.getMaxY() + 1) - 40) return null;
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

    private static void set(ServerLevel world, BlockPos pos, BlockState state) {
        if (world.getBlockState(pos) == state) return;
        world.setBlock(pos, state, Block.UPDATE_CLIENTS);
    }

    private static BlockPos at(BlockPos c, int x, int y, int z) {
        return c.offset(x, y, z);
    }

    /** Level the whole course: grass at ground level, dirt under it down to the land, clear air above. */
    private static void flatten(ServerLevel world, BlockPos c) {
        BlockState air = Blocks.AIR.defaultBlockState(), dirt = Blocks.DIRT.defaultBlockState(), grass = Blocks.GRASS_BLOCK.defaultBlockState();
        for (int x = AREA_X0; x <= AREA_X1; x++) {
            for (int z = AREA_Z0; z <= AREA_Z1; z++) {
                BlockPos col = at(c, x, 0, z);
                world.getChunk(col.getX() >> 4, col.getZ() >> 4);
                for (int y = 1; y <= 22; y++) {
                    BlockPos p = col.above(y);
                    if (!world.getBlockState(p).isAir()) set(world, p, air);
                }
                set(world, col, grass);
                for (int y = 1; y <= 30; y++) {
                    BlockPos p = col.below(y);
                    BlockState s = world.getBlockState(p);
                    if (s.isRedstoneConductor(world, p) && y > 3) break;
                    set(world, p, dirt);
                }
            }
        }
    }

    private static void clubhouse(ServerLevel world, BlockPos c) {
        int hw = 6, hd = 4, h = 5;
        for (int x = -hw; x <= hw; x++) {
            for (int z = -hd; z <= hd; z++) {
                boolean edge = Math.abs(x) == hw || Math.abs(z) == hd;
                boolean corner = Math.abs(x) == hw && Math.abs(z) == hd;
                set(world, at(c, x, 0, z), Blocks.BIRCH_PLANKS.defaultBlockState());
                for (int y = 1; y < h; y++) {
                    BlockPos p = at(c, x, y, z);
                    if (corner) set(world, p, Blocks.STRIPPED_BIRCH_LOG.defaultBlockState());
                    else if (edge) set(world, p, y == 2 && (x + z) % 2 == 0 ? Blocks.GLASS_PANE.defaultBlockState() : Blocks.CONCRETE.white().defaultBlockState());
                    else set(world, p, Blocks.AIR.defaultBlockState());
                }
                set(world, at(c, x, h, z), Blocks.DARK_OAK_SLAB.defaultBlockState());
            }
        }
        for (int[] l : new int[][]{{-3, 0}, {3, 0}}) set(world, at(c, l[0], h - 1, l[1]), Blocks.LANTERN.defaultBlockState()
                .setValue(net.minecraft.world.level.block.LanternBlock.HANGING, true));
        // Front door facing the course (east, towards the mini golf).
        BlockState lower = Blocks.BIRCH_DOOR.defaultBlockState().setValue(DoorBlock.FACING, Direction.WEST).setValue(DoorBlock.HALF, DoubleBlockHalf.LOWER);
        set(world, at(c, hw, 1, 0), lower);
        set(world, at(c, hw, 2, 0), lower.setValue(DoorBlock.HALF, DoubleBlockHalf.UPPER));
        BlockState lower2 = Blocks.BIRCH_DOOR.defaultBlockState().setValue(DoorBlock.FACING, Direction.EAST).setValue(DoorBlock.HALF, DoubleBlockHalf.LOWER);
        set(world, at(c, -hw, 1, 0), lower2);
        set(world, at(c, -hw, 2, 0), lower2.setValue(DoorBlock.HALF, DoubleBlockHalf.UPPER));
        // The pro shop counter and some club racks.
        for (int z = -2; z <= 2; z++) set(world, at(c, -2, 1, z), Blocks.STRIPPED_BIRCH_LOG.defaultBlockState());
        set(world, at(c, -4, 1, -3), Blocks.BARREL.defaultBlockState());
        set(world, at(c, -4, 1, 3), Blocks.BARREL.defaultBlockState());
        for (int x = 1; x <= 4; x++) {
            set(world, at(c, x, 1, -3), Blocks.BIRCH_FENCE.defaultBlockState());
            set(world, at(c, x, 1, 3), Blocks.BIRCH_FENCE.defaultBlockState());
        }
        sign(world, at(c, hw + 1, 1, 2), Direction.EAST, "Fairway", "Golf Club", "Pro shop inside", "Holes 1-9");
        pro(world, at(c, -4, 1, 0));
    }

    private static void pro(ServerLevel world, BlockPos at) {
        Villager v = EntityTypes.VILLAGER.create(world, net.minecraft.world.entity.EntitySpawnReason.MOB_SUMMONED);
        if (v == null) return;
        v.snapTo(at.getX() + 0.5, at.getY(), at.getZ() + 0.5, -90f, 0f);
        v.finalizeSpawn(world, world.getCurrentDifficultyAt(at), EntitySpawnReason.STRUCTURE, null);
        v.setVillagerData(v.getVillagerData().withProfession(v.registryAccess(), VillagerProfession.NITWIT));
        v.setCustomName(Component.literal("Golf Pro").withStyle(ChatFormatting.GREEN));
        v.setCustomNameVisible(true);
        v.setPersistenceRequired();
        v.setNoAi(true);
        ((com.helpermod.mixin.EntityAccessor) v).helpermod$setInvulnerable(true);
        v.addTag(PRO_TAG);
        world.addFreshEntity(v);
    }

    private static void sign(ServerLevel world, BlockPos pos, Direction facing, String... lines) {
        int rot = switch (facing) {
            case SOUTH -> 0;
            case WEST -> 4;
            case NORTH -> 8;
            default -> 12; // EAST
        };
        set(world, pos, Blocks.BIRCH_SIGN.defaultBlockState().setValue(net.minecraft.world.level.block.StandingSignBlock.ROTATION, rot));
        BlockEntity be = world.getBlockEntity(pos);
        if (be instanceof SignBlockEntity s) {
            java.util.List<Component> msgs = new java.util.ArrayList<>();
            for (int i = 0; i < 4; i++) msgs.add(i < lines.length ? Component.literal(lines[i]) : Component.empty());
            SignText text = new SignText(msgs, msgs, net.minecraft.world.item.DyeColor.BLACK, false);
            s.setText(text, net.minecraft.world.level.block.entity.SignTextSlot.FRONT);
            s.setChanged();
            world.sendBlockUpdated(pos, world.getBlockState(pos), world.getBlockState(pos), Block.UPDATE_CLIENTS);
        }
    }

    private static void disc(ServerLevel world, BlockPos c, int x0, int z0, int r, BlockState state) {
        for (int x = -r; x <= r; x++) {
            for (int z = -r; z <= r; z++) {
                if (x * x + z * z <= r * r + r) set(world, at(c, x0 + x, 0, z0 + z), state);
            }
        }
    }

    /** A full hole: tee box and sign, a fairway strip, hazards, then the green with its cup and flag. */
    private static void hole(ServerLevel world, BlockPos c, Hole h) {
        int dx = h.cupX() - h.teeX(), dz = h.cupZ() - h.teeZ();
        int len = (int) Math.round(Math.sqrt(dx * dx + dz * dz));
        BlockState fairway = Blocks.MOSS_BLOCK.defaultBlockState();
        for (int s = 0; s <= len; s++) {
            double t = s / (double) Math.max(1, len);
            int fx = (int) Math.round(h.teeX() + dx * t), fz = (int) Math.round(h.teeZ() + dz * t);
            int w = s < 4 ? 1 : 3;
            for (int ox = -w; ox <= w; ox++) for (int oz = -w; oz <= w; oz++) set(world, at(c, fx + ox, 0, fz + oz), fairway);
        }
        for (Hazard z : h.hazards()) {
            disc(world, c, z.x(), z.z(), z.r(), z.water() ? Blocks.WATER.defaultBlockState() : Blocks.SAND.defaultBlockState());
        }
        disc(world, c, h.cupX(), h.cupZ(), 4, Blocks.CONCRETE.green().defaultBlockState());
        for (int ox = -1; ox <= 1; ox++) for (int oz = -1; oz <= 1; oz++) set(world, at(c, h.teeX() + ox, 0, h.teeZ() + oz), Blocks.SMOOTH_STONE.defaultBlockState());
        cup(world, c, h, true);
        Direction back = Direction.getNearest(-dx, 0, -dz, Direction.NORTH);
        BlockPos signAt = at(c, h.teeX(), 1, h.teeZ()).relative(back, 2).relative(back.getClockWise(), 2);
        sign(world, signAt, back.getOpposite() == Direction.UP ? Direction.SOUTH : back,
                "Hole " + h.number(), h.kind(), "Par " + h.par(), len + " blocks");
    }

    /** A mini golf lane: a walled carpet-green strip with a few obstacles. */
    private static void miniLane(ServerLevel world, BlockPos c, Hole h) {
        int z0 = h.teeZ();
        BlockState lane = Blocks.CONCRETE.lime().defaultBlockState(), wall = Blocks.STRIPPED_OAK_LOG.defaultBlockState()
                .setValue(net.minecraft.world.level.block.RotatedPillarBlock.AXIS, Direction.Axis.X);
        for (int x = MINI_X0 - 1; x <= MINI_X1 + 1; x++) {
            for (int z = -2; z <= 2; z++) {
                boolean side = Math.abs(z) == 2 || x == MINI_X0 - 1 || x == MINI_X1 + 1;
                set(world, at(c, x, 0, z0 + z), side ? Blocks.STRIPPED_OAK_LOG.defaultBlockState() : lane);
                if (side) set(world, at(c, x, 1, z0 + z), wall);
            }
        }
        if (h.number() == 2) { // a post in the middle: go round it
            set(world, at(c, 23, 1, z0), Blocks.STRIPPED_OAK_LOG.defaultBlockState());
        } else if (h.number() == 3) { // a zig-zag
            set(world, at(c, 19, 1, z0 - 1), Blocks.STRIPPED_OAK_LOG.defaultBlockState());
            set(world, at(c, 19, 1, z0), Blocks.STRIPPED_OAK_LOG.defaultBlockState());
            set(world, at(c, 27, 1, z0 + 1), Blocks.STRIPPED_OAK_LOG.defaultBlockState());
            set(world, at(c, 27, 1, z0), Blocks.STRIPPED_OAK_LOG.defaultBlockState());
        }
        set(world, at(c, h.teeX(), 0, h.teeZ()), Blocks.CONCRETE.white().defaultBlockState());
        cup(world, c, h, false);
        sign(world, at(c, MINI_X0 - 1, 2, z0), Direction.WEST, "Hole " + h.number(), "Mini golf", "Par " + h.par(), "");
    }

    private static void cup(ServerLevel world, BlockPos c, Hole h, boolean flag) {
        BlockPos cup = at(c, h.cupX(), 0, h.cupZ());
        set(world, cup, Blocks.AIR.defaultBlockState());
        set(world, cup.below(), Blocks.CONCRETE.white().defaultBlockState());
        if (flag) {
            BlockPos pole = cup.offset(1, 0, 1);
            for (int y = 1; y <= 3; y++) set(world, pole.above(y), Blocks.BIRCH_FENCE.defaultBlockState());
            set(world, pole.above(4), Blocks.WOOL.red().defaultBlockState());
        }
    }

    private static String where(ServerPlayer player, BlockPos c) {
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

    static InteractionResult onUseItem(Player p, Level w, InteractionHand hand) {
        ItemStack stack = p.getItemInHand(hand);
        String kind = kindOf(stack);
        if (kind == null) return InteractionResult.PASS;
        if (w.isClientSide()) return kind.equals("cap") ? InteractionResult.PASS : InteractionResult.SUCCESS;
        if (!(p instanceof ServerPlayer player) || p instanceof FakePlayer) return InteractionResult.PASS;
        if (kind.equals("ball") || kind.startsWith("deed:")) {
            player.sendOverlayMessage(Component.literal("Right-click the ground to use it.").withStyle(ChatFormatting.YELLOW));
            return InteractionResult.SUCCESS;
        }
        Club club = clubOf(stack);
        if (club != null) {
            swing(player, club);
            return InteractionResult.SUCCESS;
        }
        return InteractionResult.PASS;
    }

    static InteractionResult onUseBlock(Player p, Level w, InteractionHand hand, BlockHitResult hit) {
        ItemStack stack = p.getItemInHand(hand);
        String kind = kindOf(stack);
        if (kind == null || kind.equals("cap")) return InteractionResult.PASS;
        if (w.isClientSide()) return InteractionResult.SUCCESS;
        if (!(p instanceof ServerPlayer player) || p instanceof FakePlayer) return InteractionResult.PASS;
        BlockPos top = hit.getBlockPos().above();
        if (kind.equals("ball")) {
            placeBall(player, (ServerLevel) w, top);
            if (!player.isCreative()) stack.shrink(1);
        } else if (kind.startsWith("deed:")) {
            if (House.build((ServerLevel) w, top, player.getDirection(), kind.substring(5).equals("villa"))) {
                if (!player.isCreative()) stack.shrink(1);
                Helper.say(player, "Your " + kind.substring(5) + " is built! Make yourself at home.");
            } else {
                Helper.say(player, "There isn't enough open space here for that. Try a flat, clear spot.");
            }
        } else {
            Club club = clubOf(stack);
            if (club != null) swing(player, club);
        }
        return InteractionResult.SUCCESS;
    }

    static InteractionResult onUseEntity(Player p, Level w, InteractionHand hand, Entity entity, EntityHitResult hit) {
        if (!entity.entityTags().contains(PRO_TAG)) return InteractionResult.PASS;
        if (w.isClientSide()) return InteractionResult.SUCCESS;
        if (hand == InteractionHand.MAIN_HAND && p instanceof ServerPlayer player) openShop(player);
        return InteractionResult.SUCCESS;
    }

    private static void placeBall(ServerPlayer player, ServerLevel world, BlockPos at) {
        ItemEntity old = ball(player);
        if (old != null) {
            old.discard();
            player.getInventory().placeItemBackInInventory(balls(1), net.minecraft.util.Prediction.SERVER_ONLY);
        }
        ItemStack look = new ItemStack(Items.SNOWBALL);
        Compat.editTag(look, t -> t.putLong("HelperGolfId", world.getRandom().nextLong())); // never merges
        ItemEntity ball = new ItemEntity(world, at.getX() + 0.5, at.getY() + 0.05, at.getZ() + 0.5, look, 0, 0, 0);
        ball.setNeverPickUp();
        ball.setUnlimitedLifetime();
        ball.addTag(BALL_TAG);
        world.addFreshEntity(ball);
        Round r = ROUNDS.computeIfAbsent(player.getUUID(), k -> new Round());
        r.ball = ball.getUUID();
        r.strokes = 0;
        player.sendOverlayMessage(Component.literal("Ball placed. Stand next to it and right-click with a club to hit it the way you look. Sneak for a softer shot.")
                .withStyle(ChatFormatting.GREEN));
    }

    private static ItemEntity ball(ServerPlayer player) {
        Round r = ROUNDS.get(player.getUUID());
        if (r == null || r.ball == null) return null;
        Entity e = player.level().getEntity(r.ball);
        return e instanceof ItemEntity ie && ie.isAlive() ? ie : null;
    }

    private static void swing(ServerPlayer player, Club club) {
        ItemEntity ball = ball(player);
        if (ball == null) {
            player.sendOverlayMessage(Component.literal("Place a Golf Ball first (right-click the ground with one).").withStyle(ChatFormatting.YELLOW));
            return;
        }
        if (ball.distanceToSqr(player) > 3.5 * 3.5) {
            player.sendOverlayMessage(Component.literal("Get closer to your ball (it's " + (int) Math.sqrt(ball.distanceToSqr(player)) + " blocks away).")
                    .withStyle(ChatFormatting.YELLOW));
            return;
        }
        if (ball.getDeltaMovement().horizontalDistanceSqr() > 0.003) {
            player.sendOverlayMessage(Component.literal("Wait for the ball to stop.").withStyle(ChatFormatting.YELLOW));
            return;
        }
        double yaw = Math.toRadians(player.getYRot());
        double soft = player.isShiftKeyDown() ? 0.5 : 1.0;
        double h = club.power() * soft, v = club.lift() * soft;
        ball.setDeltaMovement(-Math.sin(yaw) * h, v + 0.05, Math.cos(yaw) * h);
        ball.needsSync = true;
        Round r = ROUNDS.get(player.getUUID());
        r.strokes++;
        ServerLevel world = player.level();
        world.playSound(null, ball.blockPosition(), club.id().equals("putter") ? SoundEvents.WOOD_HIT : SoundEvents.PLAYER_ATTACK_STRONG,
                SoundSource.PLAYERS, 0.8f, 1.6f);
        world.sendParticles(ParticleTypes.CRIT, ball.getX(), ball.getY() + 0.1, ball.getZ(), 6, 0.1, 0.1, 0.1, 0.1);
        Compat.swing(player, InteractionHand.MAIN_HAND);
        player.sendOverlayMessage(Component.literal(club.name() + " - stroke " + r.strokes).withStyle(ChatFormatting.AQUA));
    }

    /** Pick your ball back up: /helper golf ball */
    static void pickUp(ServerPlayer player) {
        ItemEntity ball = ball(player);
        if (ball == null) {
            Helper.say(player, "You don't have a ball in play.");
            return;
        }
        ball.discard();
        ROUNDS.remove(player.getUUID());
        player.getInventory().placeItemBackInInventory(balls(1), net.minecraft.util.Prediction.SERVER_ONLY);
        Helper.say(player, "Ball picked up.");
    }

    private static void tickBalls(MinecraftServer server) {
        if (ROUNDS.isEmpty()) return;
        Data data = Data.get(server);
        for (var it = ROUNDS.entrySet().iterator(); it.hasNext(); ) {
            var e = it.next();
            ServerPlayer player = server.getPlayerList().getPlayer(e.getKey());
            Round r = e.getValue();
            if (player == null || r.ball == null) continue;
            ItemEntity ball = ball(player);
            if (ball == null) {
                it.remove();
                continue;
            }
            if (ball.isInWater()) {
                ball.discard();
                it.remove();
                player.getInventory().placeItemBackInInventory(balls(1), net.minecraft.util.Prediction.SERVER_ONLY);
                Helper.say(player, "Splash! Your ball went in the water. Here it is back; place it again and add a stroke.");
                continue;
            }
            if (data.centre == null || !Planets.keyOf(ball.level()).equals(PLANET)) continue;
            BlockPos bp = ball.blockPosition();
            for (Hole h : HOLES) {
                BlockPos cup = data.centre.offset(h.cupX(), 0, h.cupZ());
                if (!bp.equals(cup)) continue;
                ball.discard();
                it.remove();
                sunk(player, h, r.strokes);
                break;
            }
        }
    }

    private static void sunk(ServerPlayer player, Hole h, int strokes) {
        int diff = strokes - h.par();
        String name;
        long coins;
        if (strokes == 1) { name = "HOLE IN ONE!"; coins = 5000; }
        else if (diff <= -2) { name = "Eagle!"; coins = 2000; }
        else if (diff == -1) { name = "Birdie!"; coins = 1000; }
        else if (diff == 0) { name = "Par."; coins = 500; }
        else if (diff == 1) { name = "Bogey."; coins = 200; }
        else { name = "Finished."; coins = 50; }
        Tycoon.Data td = Tycoon.Data.get(player.level().getServer());
        td.add(player.getUUID(), coins);
        player.getInventory().placeItemBackInInventory(balls(1), net.minecraft.util.Prediction.SERVER_ONLY);
        ServerLevel world = player.level();
        world.playSound(null, player.blockPosition(), strokes == 1 ? SoundEvents.UI_TOAST_CHALLENGE_COMPLETE : SoundEvents.PLAYER_LEVELUP,
                SoundSource.PLAYERS, 0.8f, 1.2f);
        Component msg = Component.literal("[Golf] ").withStyle(ChatFormatting.GREEN).append(Component.literal(player.getName().getString() + " sank hole "
                + h.number() + " (" + h.kind().toLowerCase(java.util.Locale.ROOT) + ", par " + h.par() + ") in " + strokes
                + (strokes == 1 ? " stroke. " : " strokes. ") + name + " +" + coins + " coins").withStyle(ChatFormatting.WHITE));
        for (ServerPlayer p : player.level().getServer().getPlayerList().getPlayers()) {
            if (p == player || p.level() == player.level()) p.sendSystemMessage(msg);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Commands and the shop
    // ---------------------------------------------------------------------------------------

    /** /helper golf */
    static void info(ServerPlayer player) {
        Data data = Data.get(player.level().getServer());
        if (!Planets.keyOf(player.level()).equals(PLANET)) {
            Helper.say(player, "The golf course is on Fairway, a grassy planet. Fly there with a Tier 1 Space Rocket "
                    + "from /helper tycoon shop, or /helper planet fairway.");
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
        for (String line : how) player.sendSystemMessage(Component.literal(line).withStyle(ChatFormatting.GRAY));
    }

    private record Offer(long price, String what, java.util.function.Supplier<ItemStack> item,
                         java.util.function.Predicate<ServerPlayer> action) {}

    private static final Offer[] OFFERS = {
            new Offer(200, "Putter", () -> club(CLUBS[0]), null),
            new Offer(400, "Wedge", () -> club(CLUBS[1]), null),
            new Offer(600, "Iron", () -> club(CLUBS[2]), null),
            new Offer(1000, "Driver", () -> club(CLUBS[3]), null),
            new Offer(100, "4 Golf Balls", () -> balls(4), null),
            new Offer(300, "Golf Cap", Golf::cap, null),
            new Offer(5000, "Golf Cart (a speedy ride)", () -> named(Items.SADDLE, "Golf Cart"), Golf::cart),
            new Offer(Roadster.PRICE, "Star Roadster (a flying sports car you can repaint)", Roadster::shopIcon, Roadster::spawn),
            new Offer(20000, "Cottage Deed (builds a cottage)", () -> deed("cottage"), null),
            new Offer(100000, "Villa Deed (builds a big villa)", () -> deed("villa"), null),
            new Offer(50, "16 Cookies (clubhouse snack)", () -> new ItemStack(Items.COOKIE, 16), null),
    };

    private static ItemStack named(Item item, String name) {
        ItemStack s = new ItemStack(item);
        s.set(net.minecraft.core.component.DataComponents.CUSTOM_NAME, Component.literal(name));
        return s;
    }

    /** A golf cart: a fast, tame, saddled white horse that's yours. */
    private static boolean cart(ServerPlayer player) {
        ServerLevel world = player.level();
        Horse horse = EntityTypes.HORSE.create(world, net.minecraft.world.entity.EntitySpawnReason.MOB_SUMMONED);
        if (horse == null) return false;
        Vec3 at = player.position().add(player.getLookAngle().scale(2).multiply(1, 0, 1));
        horse.snapTo(at.x, player.getY(), at.z, player.getYRot(), 0);
        horse.setTamed(true);
        horse.setOwner(player);
        horse.setItemSlot(net.minecraft.world.entity.EquipmentSlot.SADDLE, new ItemStack(Items.SADDLE));
        var speed = horse.getAttribute(Attributes.MOVEMENT_SPEED);
        if (speed != null) speed.setBaseValue(0.36);
        var jump = horse.getAttribute(Attributes.JUMP_STRENGTH);
        if (jump != null) jump.setBaseValue(0.6);
        var hp = horse.getAttribute(Attributes.MAX_HEALTH);
        if (hp != null) hp.setBaseValue(30);
        horse.setHealth(30);
        horse.setCustomName(Component.literal(player.getName().getString() + "'s Golf Cart").withStyle(ChatFormatting.WHITE));
        horse.setPersistenceRequired();
        world.addFreshEntity(horse);
        Helper.say(player, "Your golf cart is parked next to you. Hop on!");
        return true;
    }

    static void openShop(ServerPlayer player) {
        if (!Planets.keyOf(player.level()).equals(PLANET)) {
            Helper.say(player, "The golf shop is in the Fairway Golf Club, on the planet Fairway.");
            return;
        }
        player.openMenu(new SimpleMenuProvider(
                (syncId, inv, p) -> new Shop(syncId, inv, player, new SimpleContainer(27)),
                Component.literal("Fairway Pro Shop")));
    }

    static final class Shop extends ChestMenu {
        private final ServerPlayer player;
        private final SimpleContainer view;

        private Shop(int syncId, Inventory inv, ServerPlayer player, SimpleContainer view) {
            super(MenuType.GENERIC_9x3, syncId, inv, view, 3);
            this.player = player;
            this.view = view;
            refresh();
        }

        private void refresh() {
            for (int i = 0; i < 27; i++) view.setItem(i, ItemStack.EMPTY);
            for (int i = 0; i < OFFERS.length; i++) {
                Offer o = OFFERS[i];
                ItemStack shown = o.item().get();
                ItemStack b = Storage.Menu.button(shown.getItem(), o.what(), "Costs " + o.price() + " tycoon coins", "Click to buy");
                b.setCount(Math.max(1, shown.getCount()));
                view.setItem(i, b);
            }
            view.setItem(26, Storage.Menu.button(Items.GOLD_INGOT, Tycoon.Data.get(player.level().getServer()).coins(player.getUUID()) + " coins",
                    "Earn coins with the tycoon", "or by sinking putts"));
            broadcastChanges();
        }

        @Override
        public void clicked(int slotIndex, int button, ContainerInput action, Player p) {
            if (slotIndex < 0 || slotIndex >= 27) {
                if (action != ContainerInput.QUICK_MOVE) super.clicked(slotIndex, button, action, p);
                return;
            }
            if (action == ContainerInput.PICKUP && slotIndex < OFFERS.length) buy(OFFERS[slotIndex]);
            refresh();
        }

        private void buy(Offer o) {
            Tycoon.Data data = Tycoon.Data.get(player.level().getServer());
            if (data.coins(player.getUUID()) < o.price()) {
                player.sendOverlayMessage(Component.literal("You need " + o.price() + " coins (you have " + data.coins(player.getUUID()) + ").")
                        .withStyle(ChatFormatting.RED));
                return;
            }
            if (o.action() != null) {
                if (!o.action().test(player)) return;
            } else {
                player.getInventory().placeItemBackInInventory(o.item().get(), net.minecraft.util.Prediction.SERVER_ONLY);
            }
            data.add(player.getUUID(), -o.price());
            Compat.notifySound(player, SoundEvents.VILLAGER_YES, SoundSource.PLAYERS, 0.6f, 1.2f);
            player.sendOverlayMessage(Component.literal("Bought " + o.what() + ".").withStyle(ChatFormatting.GREEN));
        }

        @Override
        public ItemStack quickMoveStack(Player p, int slot) {
            return ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(Player p) {
            return true;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Houses from deeds
    // ---------------------------------------------------------------------------------------

    static final class House {
        private House() {}

        /** Builds a cottage (7x7) or villa (11x9) with its door facing the player. False if there's no room. */
        static boolean build(ServerLevel world, BlockPos floorAbove, Direction playerFacing, boolean villa) {
            int w = villa ? 11 : 7, d = villa ? 9 : 7, h = villa ? 5 : 4;
            Direction front = playerFacing.getOpposite(); // the door faces back at the player
            Direction right = front.getClockWise();
            // The house goes in front of the player: its front wall is 1 block ahead of where they clicked.
            BlockPos origin = floorAbove.below().relative(playerFacing, d).relative(right, -(w / 2));
            // origin = back-left corner at floor level; the front wall is towards the player.
            for (int a = 0; a < w; a++) {
                for (int b = 0; b < d; b++) {
                    for (int y = 1; y <= h + 1; y++) {
                        BlockPos p = origin.relative(right, a).relative(front, b).above(y);
                        BlockState s = world.getBlockState(p);
                        if (!s.isAir() && !s.canBeReplaced()) return false;
                    }
                }
            }
            BlockState planks = Blocks.BIRCH_PLANKS.defaultBlockState(), log = Blocks.STRIPPED_BIRCH_LOG.defaultBlockState();
            for (int a = 0; a < w; a++) {
                for (int b = 0; b < d; b++) {
                    BlockPos base = origin.relative(right, a).relative(front, b);
                    boolean edgeA = a == 0 || a == w - 1, edgeB = b == 0 || b == d - 1;
                    world.setBlockAndUpdate(base, Blocks.SPRUCE_PLANKS.defaultBlockState());
                    for (int y = 1; y <= h; y++) {
                        BlockPos p = base.above(y);
                        if (edgeA && edgeB) world.setBlockAndUpdate(p, log);
                        else if (edgeA || edgeB) world.setBlockAndUpdate(p, y == 2 && (a + b) % 3 == 1 ? Blocks.GLASS_PANE.defaultBlockState() : planks);
                        else world.setBlockAndUpdate(p, Blocks.AIR.defaultBlockState());
                    }
                    world.setBlockAndUpdate(base.above(h + 1), Blocks.DARK_OAK_SLAB.defaultBlockState());
                }
            }
            // Door in the middle of the front wall.
            BlockPos door = origin.relative(right, w / 2).relative(front, d - 1).above();
            BlockState lower = Blocks.BIRCH_DOOR.defaultBlockState().setValue(DoorBlock.FACING, front).setValue(DoorBlock.HALF, DoubleBlockHalf.LOWER);
            world.setBlockAndUpdate(door, lower);
            world.setBlockAndUpdate(door.above(), lower.setValue(DoorBlock.HALF, DoubleBlockHalf.UPPER));
            // Inside: bed(s), chest, crafting table, furnace, lights.
            BlockPos backLeft = origin.relative(right, 1).relative(front, 1).above();
            bed(world, backLeft, front);
            if (villa) bed(world, backLeft.relative(right, 2), front);
            BlockPos backRight = origin.relative(right, w - 2).relative(front, 1).above();
            world.setBlockAndUpdate(backRight, Blocks.CHEST.defaultBlockState());
            world.setBlockAndUpdate(backRight.relative(front), Blocks.CRAFTING_TABLE.defaultBlockState());
            world.setBlockAndUpdate(backRight.relative(front, 2), Blocks.FURNACE.defaultBlockState());
            if (villa) {
                world.setBlockAndUpdate(backRight.relative(right.getOpposite()), Blocks.CHEST.defaultBlockState());
                world.setBlockAndUpdate(backRight.relative(front, 3), Blocks.SMOKER.defaultBlockState());
                world.setBlockAndUpdate(origin.relative(right, w / 2).relative(front, d / 2).above(), Blocks.CARPET.lightGray().defaultBlockState());
            }
            world.setBlockAndUpdate(origin.relative(right, w / 2).relative(front, d / 2).above(h), Blocks.LANTERN.defaultBlockState()
                    .setValue(net.minecraft.world.level.block.LanternBlock.HANGING, true));
            world.playSound(null, door, SoundEvents.WOOD_PLACE, SoundSource.BLOCKS, 1f, 1f);
            return true;
        }

        private static void bed(ServerLevel world, BlockPos foot, Direction front) {
            // Head against the back wall: the head is one block further back than the foot.
            Direction head = front.getOpposite();
            BlockPos footPos = foot.relative(front);
            BlockState bed = Blocks.BED.white().defaultBlockState().setValue(net.minecraft.world.level.block.BedBlock.FACING, head);
            world.setBlockAndUpdate(footPos, bed.setValue(net.minecraft.world.level.block.BedBlock.PART, net.minecraft.world.level.block.state.properties.BedPart.FOOT));
            world.setBlockAndUpdate(footPos.relative(head), bed.setValue(net.minecraft.world.level.block.BedBlock.PART, net.minecraft.world.level.block.state.properties.BedPart.HEAD));
        }
    }
}
