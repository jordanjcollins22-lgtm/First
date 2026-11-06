package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.advancement.Advancement;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.block.DispenserBlock;
import net.minecraft.block.GlazedTerracottaBlock;
import net.minecraft.entity.Entity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.Item;
import net.minecraft.item.ItemPlacementContext;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
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
import net.minecraft.util.Identifier;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.PersistentState;
import net.minecraft.world.World;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Dropper Tycoon.
 *
 * A Tycoon Dropper drops ore every few seconds. Conveyors (magenta glazed terracotta) carry it the way
 * their arrow points. Upgraders multiply its value as it rolls over them, once each. A Collector (black
 * glazed terracotta) turns it into coins for whoever owns the dropper. Coins buy more tycoon parts and
 * useful items in /helper tycoon shop. Better items unlock as you progress through the modpack: the
 * Nether, then the End. Quest rewards can also pay coins with /helper tycoon give.
 */
final class Tycoon {
    private Tycoon() {}

    static final String DROPPER_NAME = "Tycoon Dropper";
    private static final String ORE_TAG = "helpermod_ore";
    private static final String ORE_NBT = "HelperTycoonOre";
    private static final int MAX_LEVEL = 10;
    private static final int MAX_ORES_PER_DROPPER = 24;
    private static final int ORE_LIFETIME = 1200; // one minute, then it fizzles out
    private static final double BELT_SPEED = 0.14;

    // ---------------------------------------------------------------------------------------
    // Saved state: coins per player, and every placed Tycoon Dropper
    // ---------------------------------------------------------------------------------------

    static final class Data extends PersistentState {
        private static final String ID = "helpermod_tycoon";
        final Map<UUID, Long> coins = new HashMap<>();
        final Map<UUID, Long> earned = new HashMap<>();
        final Map<UUID, Boolean> started = new HashMap<>();
        /** Level of a dropper that was picked up, given back to the next one its owner places. */
        final Map<UUID, Integer> spare = new HashMap<>();
        /** Rebirths: each one makes every coin collected worth 50% more, for good. */
        final Map<UUID, Integer> rebirths = new HashMap<>();
        /** How many lifetime-earnings milestones a player has been rewarded for. */
        final Map<UUID, Integer> milestones = new HashMap<>();
        /** "dimension|pos" -> dropper. */
        final Map<String, Dropper> droppers = new LinkedHashMap<>();

        static Data get(MinecraftServer server) {
            return server.getOverworld().getPersistentStateManager().getOrCreate(Data::fromNbt, Data::new, ID);
        }

        /** Register a Tycoon Dropper. If its owner picked one up earlier, it gets that one's level back. */
        Dropper register(World world, BlockPos pos, UUID owner) {
            Dropper existing = droppers.get(key(world, pos));
            if (existing != null) return existing;
            Integer level = spare.remove(owner);
            Dropper d = new Dropper(owner, level == null ? 1 : level);
            droppers.put(key(world, pos), d);
            markDirty();
            return d;
        }

        int rebirths(UUID id) {
            return rebirths.getOrDefault(id, 0);
        }

        long coins(UUID id) {
            return coins.getOrDefault(id, 0L);
        }

        void add(UUID id, long amount) {
            coins.merge(id, amount, Long::sum);
            if (amount > 0) earned.merge(id, amount, Long::sum);
            markDirty();
        }

        private static Data fromNbt(NbtCompound nbt) {
            Data d = new Data();
            NbtList players = nbt.getList("players", NbtElement.COMPOUND_TYPE);
            for (int i = 0; i < players.size(); i++) {
                NbtCompound p = players.getCompound(i);
                UUID id = p.getUuid("id");
                d.coins.put(id, p.getLong("coins"));
                d.earned.put(id, p.getLong("earned"));
                d.started.put(id, p.getBoolean("started"));
                if (p.getInt("spare") > 0) d.spare.put(id, p.getInt("spare"));
                if (p.getInt("rebirths") > 0) d.rebirths.put(id, p.getInt("rebirths"));
                if (p.getInt("milestones") > 0) d.milestones.put(id, p.getInt("milestones"));
            }
            NbtList list = nbt.getList("droppers", NbtElement.COMPOUND_TYPE);
            for (int i = 0; i < list.size(); i++) {
                NbtCompound t = list.getCompound(i);
                d.droppers.put(t.getString("key"), new Dropper(t.getUuid("owner"), t.getInt("level")));
            }
            return d;
        }

        @Override
        public NbtCompound writeNbt(NbtCompound nbt) {
            NbtList players = new NbtList();
            java.util.Set<UUID> ids = new java.util.HashSet<>(coins.keySet());
            ids.addAll(started.keySet());
            ids.addAll(spare.keySet());
            ids.addAll(rebirths.keySet());
            for (UUID id : ids) {
                NbtCompound p = new NbtCompound();
                p.putUuid("id", id);
                p.putLong("coins", coins.getOrDefault(id, 0L));
                p.putLong("earned", earned.getOrDefault(id, 0L));
                p.putBoolean("started", started.getOrDefault(id, false));
                p.putInt("spare", spare.getOrDefault(id, 0));
                p.putInt("rebirths", rebirths.getOrDefault(id, 0));
                p.putInt("milestones", milestones.getOrDefault(id, 0));
                players.add(p);
            }
            nbt.put("players", players);
            NbtList list = new NbtList();
            droppers.forEach((key, dr) -> {
                NbtCompound t = new NbtCompound();
                t.putString("key", key);
                t.putUuid("owner", dr.owner);
                t.putInt("level", dr.level);
                list.add(t);
            });
            nbt.put("droppers", list);
            return nbt;
        }
    }

    static final class Dropper {
        final UUID owner;
        int level;
        int timer;
        int live;

        Dropper(UUID owner, int level) {
            this.owner = owner;
            this.level = Math.max(1, level);
        }

        int interval() {
            return Math.max(20, 70 - level * 5); // 3.25 s at level 1, 1 s at level 10
        }

        int oreValue() {
            return level;
        }
    }

    private static String key(World world, BlockPos pos) {
        return world.getRegistryKey().getValue() + "|" + pos.asLong();
    }

    // ---------------------------------------------------------------------------------------
    // Items
    // ---------------------------------------------------------------------------------------

    private static ItemStack named(Item item, int count, String name, Formatting color) {
        ItemStack stack = new ItemStack(item, count);
        stack.setCustomName(Text.literal(name).styled(s -> s.withItalic(false)).formatted(color));
        return stack;
    }

    static ItemStack dropperItem() {
        return named(Items.DROPPER, 1, DROPPER_NAME, Formatting.GOLD);
    }

    static boolean isDropperItem(ItemStack stack) {
        return stack.isOf(Items.DROPPER) && stack.hasCustomName() && stack.getName().getString().equals(DROPPER_NAME);
    }

    static ItemStack conveyors(int n) {
        return named(Items.MAGENTA_GLAZED_TERRACOTTA, n, "Conveyor", Formatting.LIGHT_PURPLE);
    }

    static ItemStack collector() {
        return named(Items.BLACK_GLAZED_TERRACOTTA, 1, "Collector", Formatting.DARK_GRAY);
    }

    /** Upgrader blocks: which block, how much it multiplies by. */
    private static int multiplier(BlockState state) {
        if (state.isOf(Blocks.LIME_GLAZED_TERRACOTTA)) return 2;
        if (state.isOf(Blocks.CYAN_GLAZED_TERRACOTTA)) return 3;
        if (state.isOf(Blocks.PURPLE_GLAZED_TERRACOTTA)) return 5;
        if (state.isOf(Blocks.RED_GLAZED_TERRACOTTA)) return 10;
        return 1;
    }

    /** Yellow Lifters hop ore up one block, so lines can climb to a second floor. */
    private static boolean isLifter(BlockState state) {
        return state.isOf(Blocks.YELLOW_GLAZED_TERRACOTTA);
    }

    private static boolean isBelt(BlockState state) {
        return state.isOf(Blocks.MAGENTA_GLAZED_TERRACOTTA) || isLifter(state) || multiplier(state) > 1;
    }

    static ItemStack lifter() {
        return named(Items.YELLOW_GLAZED_TERRACOTTA, 1, "Lifter", Formatting.YELLOW);
    }

    static ItemStack starUpgrader() {
        return named(Items.RED_GLAZED_TERRACOTTA, 1, "Star Upgrader x10", Formatting.RED);
    }

    /** What collected ore is multiplied by: +50% per rebirth. */
    static double rebirthBonus(int rebirths) {
        return 1.0 + 0.5 * rebirths;
    }

    // ---------------------------------------------------------------------------------------
    // Placing a Tycoon Dropper
    // ---------------------------------------------------------------------------------------

    private record Pending(RegistryKey<World> world, BlockPos pos, UUID player, int ticks) {}

    private static final List<Pending> PENDING = new ArrayList<>();
    /** Ore entities alive right now, and the dropper each came from. Not saved: old ore is cleared on load. */
    private static final Map<UUID, String> ORES = new HashMap<>();

    static void reset() {
        PENDING.clear();
        ORES.clear();
    }

    static ActionResult onUseBlock(PlayerEntity p, World w, Hand hand, BlockHitResult hit) {
        if (w.isClient || !(p instanceof ServerPlayerEntity player) || p instanceof FakePlayer) return ActionResult.PASS;
        ItemStack stack = player.getStackInHand(hand);
        if (isDropperItem(stack)) {
            BlockPos pos = new ItemPlacementContext(player, hand, stack, hit).getBlockPos();
            PENDING.add(new Pending(w.getRegistryKey(), pos.toImmutable(), player.getUuid(), 0));
        }
        return ActionResult.PASS;
    }

    /** A Tycoon Dropper that turns up somewhere the mod doesn't know (moved by a carrying mod, for example). */
    static void onBlockEntityLoad(net.minecraft.block.entity.BlockEntity be, ServerWorld world) {
        if (!(be instanceof net.minecraft.block.entity.DropperBlockEntity dropper) || !dropper.hasCustomName()) return;
        if (!DROPPER_NAME.equals(dropper.getCustomName().getString())) return;
        BlockPos pos = be.getPos().toImmutable();
        world.getServer().execute(() -> {
            Data data = Data.get(world.getServer());
            if (data.droppers.containsKey(key(world, pos))) return;
            PlayerEntity near = world.getClosestPlayer(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5, 48, false);
            if (near == null) return;
            Dropper d = data.register(world, pos, near.getUuid());
            if (near instanceof ServerPlayerEntity sp) Helper.say(sp, "Tycoon Dropper is working again (level " + d.level + ").");
        });
    }

    /** /helper tycoon fix: make the dropper you're looking at work as your Tycoon Dropper. */
    static void fix(ServerPlayerEntity player) {
        HitResult hit = player.raycast(6, 0, false);
        if (!(hit instanceof BlockHitResult bh) || hit.getType() != HitResult.Type.BLOCK
                || !player.getWorld().getBlockState(bh.getBlockPos()).isOf(Blocks.DROPPER)) {
            Helper.say(player, "Look at your Tycoon Dropper and run /helper tycoon fix again.");
            return;
        }
        BlockPos pos = bh.getBlockPos();
        if (!(player.getWorld().getBlockEntity(pos) instanceof net.minecraft.block.entity.DropperBlockEntity be)
                || !be.hasCustomName() || !DROPPER_NAME.equals(be.getCustomName().getString())) {
            Helper.say(player, "That's a plain dropper. Only Tycoon Droppers (from the starter kit or the shop) drop ore.");
            return;
        }
        Data data = Data.get(player.getServer());
        Dropper existing = data.droppers.get(key(player.getWorld(), pos));
        if (existing != null) {
            Helper.say(player, "That Tycoon Dropper is already working (level " + existing.level + "). Make sure its front isn't blocked "
                    + "and it isn't getting a redstone signal.");
            return;
        }
        Dropper d = data.register(player.getWorld(), pos, player.getUuid());
        Helper.say(player, "Fixed! Your Tycoon Dropper is working again (level " + d.level + ").");
    }

    /** Old ore left over from before a restart has no dropper to pay out to: remove it. */
    static void onEntityLoad(Entity entity, ServerWorld world) {
        if (entity instanceof ItemEntity && entity.getCommandTags().contains(ORE_TAG) && !ORES.containsKey(entity.getUuid())) {
            world.getServer().execute(entity::discard);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Ticking: droppers drop, conveyors carry, upgraders upgrade, collectors pay
    // ---------------------------------------------------------------------------------------

    static void tick(MinecraftServer server) {
        Data data = Data.get(server);
        for (int i = PENDING.size() - 1; i >= 0; i--) {
            Pending pd = PENDING.get(i);
            ServerWorld world = server.getWorld(pd.world());
            if (world != null && world.getBlockState(pd.pos()).isOf(Blocks.DROPPER)) {
                Dropper placed = data.register(world, pd.pos(), pd.player());
                ServerPlayerEntity player = server.getPlayerManager().getPlayer(pd.player());
                if (player != null) Helper.say(player, "Tycoon Dropper placed" + (placed.level > 1 ? " (level " + placed.level + ")" : "")
                        + "! It drops ore out of its front. Lead conveyors from there to a Collector to earn coins.");
                PENDING.remove(i);
            } else if (pd.ticks() > 5) {
                PENDING.remove(i);
            } else {
                PENDING.set(i, new Pending(pd.world(), pd.pos(), pd.player(), pd.ticks() + 1));
            }
        }

        for (Iterator<Map.Entry<String, Dropper>> it = data.droppers.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<String, Dropper> e = it.next();
            String[] parts = e.getKey().split("\\|");
            Identifier dim = Identifier.tryParse(parts[0]);
            ServerWorld world = dim == null ? null : server.getWorld(RegistryKey.of(RegistryKeys.WORLD, dim));
            if (world == null) continue;
            BlockPos pos = BlockPos.fromLong(Long.parseLong(parts[1]));
            if (!world.isChunkLoaded(pos)) continue;
            BlockState state = world.getBlockState(pos);
            Dropper d = e.getValue();
            if (!state.isOf(Blocks.DROPPER)) { // picked up or broken: remember its level for the next one
                it.remove();
                data.spare.merge(d.owner, d.level, Math::max);
                data.markDirty();
                ServerPlayerEntity owner = server.getPlayerManager().getPlayer(d.owner);
                if (owner != null) Helper.say(owner, "Your Tycoon Dropper was picked up. Place it again anywhere and it keeps its level ("
                        + d.level + ").");
                continue;
            }
            if (++d.timer < d.interval() || d.live >= MAX_ORES_PER_DROPPER) continue;
            d.timer = 0;
            if (world.isReceivingRedstonePower(pos)) continue; // a redstone signal pauses it
            drop(world, pos, state.get(DispenserBlock.FACING), d, e.getKey());
        }

        // Move the ore.
        boolean checkPiles = server.getTicks() % 20 == 0;
        List<ItemEntity> live = checkPiles ? new ArrayList<>() : null;
        for (Iterator<Map.Entry<UUID, String>> it = ORES.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<UUID, String> e = it.next();
            Dropper source = data.droppers.get(e.getValue());
            ItemEntity ore = null;
            for (ServerWorld w : server.getWorlds()) {
                if (w.getEntity(e.getKey()) instanceof ItemEntity ie) {
                    ore = ie;
                    break;
                }
            }
            if (ore == null || !ore.isAlive() || ore.getItemAge() > ORE_LIFETIME) {
                if (ore != null) ore.discard();
                if (source != null) source.live = Math.max(0, source.live - 1);
                it.remove();
                continue;
            }
            if (moveOre((ServerWorld) ore.getWorld(), ore, data)) {
                if (source != null) source.live = Math.max(0, source.live - 1);
                it.remove();
            } else if (live != null) {
                live.add(ore);
            }
        }
        if (live != null && !live.isEmpty()) BlackHole.checkPiles(live); // big piles spin into a Singularity
    }

    private static void drop(ServerWorld world, BlockPos pos, Direction facing, Dropper d, String key) {
        Item look = d.level >= 8 ? Items.RAW_GOLD : d.level >= 4 ? Items.RAW_IRON : Items.RAW_COPPER;
        ItemStack stack = new ItemStack(look);
        NbtCompound tag = stack.getOrCreateSubNbt(ORE_NBT);
        tag.putLong("value", d.oreValue());
        tag.putUuid("owner", d.owner);
        tag.putLong("id", world.getRandom().nextLong()); // never stacks with other ore
        tag.put("ups", new NbtList());
        Vec3d at = Vec3d.ofCenter(pos).add(facing.getOffsetX() * 0.7, facing.getOffsetY() * 0.7 - 0.15, facing.getOffsetZ() * 0.7);
        ItemEntity ore = new ItemEntity(world, at.x, at.y, at.z, stack,
                facing.getOffsetX() * 0.1, 0, facing.getOffsetZ() * 0.1);
        ore.setPickupDelayInfinite();
        ore.addCommandTag(ORE_TAG);
        ORES.put(ore.getUuid(), key);
        world.spawnEntity(ore);
        d.live++;
        world.playSound(null, pos, SoundEvents.BLOCK_DISPENSER_DISPENSE, SoundCategory.BLOCKS, 0.25f, 1.4f);
    }

    /** Returns true when the ore has been collected (or is otherwise finished). */
    private static boolean moveOre(ServerWorld world, ItemEntity ore, Data data) {
        BlockPos under = BlockPos.ofFloored(ore.getX(), ore.getY() - 0.1, ore.getZ());
        BlockState state = world.getBlockState(under);
        ItemStack stack = ore.getStack();
        NbtCompound tag = stack.getSubNbt(ORE_NBT);
        if (tag == null) return true;

        if (state.isOf(Blocks.BLACK_GLAZED_TERRACOTTA)) { // a Collector: cash in
            UUID owner = tag.getUuid("owner");
            long value = Math.max(1, Math.round(tag.getLong("value") * rebirthBonus(data.rebirths(owner))));
            data.add(owner, value);
            checkMilestones(world.getServer(), data, owner);
            world.spawnParticles(ParticleTypes.HAPPY_VILLAGER, ore.getX(), ore.getY() + 0.3, ore.getZ(), 4, 0.2, 0.2, 0.2, 0);
            world.playSound(null, under, SoundEvents.ENTITY_EXPERIENCE_ORB_PICKUP, SoundCategory.BLOCKS, 0.3f, 1.6f);
            ServerPlayerEntity p = world.getServer().getPlayerManager().getPlayer(owner);
            TycoonSidebar.earned(world.getServer(), owner, value); // shown on the side panel, not in the middle of the screen
            ore.discard();
            return true;
        }
        int mult = multiplier(state);
        if (mult > 1) { // each upgrader block works once per ore
            NbtList ups = tag.getList("ups", NbtElement.LONG_TYPE);
            net.minecraft.nbt.NbtLong here = net.minecraft.nbt.NbtLong.of(under.asLong());
            if (!ups.contains(here) && ups.size() < 16) {
                ups.add(here);
                tag.put("ups", ups);
                tag.putLong("value", Math.min(Long.MAX_VALUE / 8, tag.getLong("value") * mult));
                ore.setStack(stack.copy());
                world.spawnParticles(ParticleTypes.ELECTRIC_SPARK, ore.getX(), ore.getY() + 0.2, ore.getZ(), 6, 0.15, 0.15, 0.15, 0.05);
                world.playSound(null, under, SoundEvents.BLOCK_AMETHYST_BLOCK_CHIME, SoundCategory.BLOCKS, 0.4f, 1.2f);
            }
        }
        if (isBelt(state)) {
            // The arrow on the block points away from whoever placed it.
            Direction dir = state.get(GlazedTerracottaBlock.FACING).getOpposite();
            Vec3d v = ore.getVelocity();
            double cx = under.getX() + 0.5, cz = under.getZ() + 0.5;
            double vx = dir.getOffsetX() != 0 ? dir.getOffsetX() * BELT_SPEED : (cx - ore.getX()) * 0.2;
            double vz = dir.getOffsetZ() != 0 ? dir.getOffsetZ() * BELT_SPEED : (cz - ore.getZ()) * 0.2;
            double vy = v.y;
            if (isLifter(state) && ore.isOnGround()) vy = 0.42; // hop up a block
            ore.setVelocity(vx, vy, vz);
            ore.velocityModified = true;
        }
        return false;
    }

    // ---------------------------------------------------------------------------------------
    // Commands
    // ---------------------------------------------------------------------------------------

    static void info(ServerPlayerEntity player) {
        Data data = Data.get(player.getServer());
        long mine = data.droppers.values().stream().filter(d -> d.owner.equals(player.getUuid())).count();
        int rb = data.rebirths(player.getUuid());
        Helper.say(player, "You have " + data.coins(player.getUuid()) + " coins and " + mine + " Tycoon Dropper"
                + (mine == 1 ? "" : "s") + ". Shop tier: " + tierName(tier(player)) + "."
                + (rb > 0 ? " Rebirths: " + rb + " (coins x" + rebirthBonus(rb) + ")." : ""));
        String[] how = {
                "/helper tycoon start  - free starter kit (once): a Tycoon Dropper, 16 conveyors and a Collector",
                "/helper tycoon shop  - spend coins on tycoon parts and useful items",
                "/helper tycoon upgrade  - look at your Tycoon Dropper to make it faster and its ore worth more",
                "/helper tycoon fix  - look at a Tycoon Dropper that stopped working after you moved it",
                "/helper tycoon rebirth  - start over for a permanent +50% on every coin",
                "/helper tycoon top  - the richest tycoons on the server",
                "/helper tycoon sidebar on|off  - show or hide your coin total and coins per second on the side",
                "Conveyors carry ore the way their arrow points. Upgraders (lime x2, cyan x3, purple x5, red x10) boost it once each.",
                "Yellow Lifters hop ore up one block so a line can climb. Milestones at 1k, 10k, 100k and 1M coins earned give free parts.",
                "Black Collectors turn ore into coins. A redstone signal pauses a dropper.",
        };
        for (String line : how) player.sendMessage(Text.literal(line).formatted(Formatting.GRAY), false);
    }

    static void start(ServerPlayerEntity player) {
        Data data = Data.get(player.getServer());
        if (data.started.getOrDefault(player.getUuid(), false)) {
            Helper.say(player, "You've already had your starter kit. Earn coins and buy more in /helper tycoon shop.");
            return;
        }
        data.started.put(player.getUuid(), true);
        data.markDirty();
        player.getInventory().offerOrDrop(dropperItem());
        player.getInventory().offerOrDrop(conveyors(16));
        player.getInventory().offerOrDrop(collector());
        Helper.say(player, "Here's your tycoon starter kit! Place the Tycoon Dropper, put conveyors in front of it "
                + "with the arrows pointing away, and end the line on the Collector.");
    }

    static void upgrade(ServerPlayerEntity player) {
        HitResult hit = player.raycast(6, 0, false);
        if (!(hit instanceof BlockHitResult bh) || hit.getType() != HitResult.Type.BLOCK) {
            Helper.say(player, "Look at your Tycoon Dropper and try again.");
            return;
        }
        Data data = Data.get(player.getServer());
        Dropper d = data.droppers.get(key(player.getWorld(), bh.getBlockPos()));
        if (d == null || !d.owner.equals(player.getUuid())) {
            Helper.say(player, "That isn't one of your Tycoon Droppers.");
            return;
        }
        if (d.level >= MAX_LEVEL) {
            Helper.say(player, "That dropper is already at the top level (" + MAX_LEVEL + ").");
            return;
        }
        int maxForTier = tier(player) == 1 ? 4 : tier(player) == 2 ? 7 : MAX_LEVEL;
        if (d.level >= maxForTier) {
            Helper.say(player, "To upgrade past level " + maxForTier + ", go further in the modpack first: "
                    + (tier(player) == 1 ? "visit the Nether." : "reach the End."));
            return;
        }
        long cost = 50L * d.level * d.level;
        if (data.coins(player.getUuid()) < cost) {
            Helper.say(player, "Upgrading to level " + (d.level + 1) + " costs " + cost + " coins. You have "
                    + data.coins(player.getUuid()) + ".");
            return;
        }
        data.add(player.getUuid(), -cost);
        d.level++;
        data.markDirty();
        player.getWorld().playSound(null, bh.getBlockPos(), SoundEvents.BLOCK_ANVIL_USE, SoundCategory.BLOCKS, 0.6f, 1.3f);
        Helper.say(player, "Dropper upgraded to level " + d.level + ": ore worth " + d.oreValue() + " each, every "
                + String.format(java.util.Locale.ROOT, "%.1f", d.interval() / 20.0) + " seconds.");
    }

    // ---------------------------------------------------------------------------------------
    // Rebirth, milestones and the leaderboard
    // ---------------------------------------------------------------------------------------

    static long rebirthCost(int rebirths) {
        return 10_000L * (rebirths + 1) * (rebirths + 1); // 10k, 40k, 90k, ...
    }

    /** /helper tycoon rebirth shows the deal; /helper tycoon rebirth confirm does it. */
    static void rebirth(ServerPlayerEntity player, boolean confirm) {
        Data data = Data.get(player.getServer());
        UUID id = player.getUuid();
        int rb = data.rebirths(id);
        long cost = rebirthCost(rb);
        long have = data.coins(id);
        if (!confirm) {
            Helper.say(player, "Rebirth " + (rb + 1) + ": needs " + cost + " coins (you have " + have + "). You lose all your coins and "
                    + "your Tycoon Droppers go back to level 1, but every coin you collect is worth x" + rebirthBonus(rb + 1)
                    + " from then on, for good. Type /helper tycoon rebirth confirm to do it.");
            if (have >= cost) Helper.say(player, "You'd keep " + (have - cost) + " coins after paying, so you can rebirth again "
                    + "straight away if you have enough. Rich already? Check the top of /helper tycoon shop for big-ticket items.");
            return;
        }
        if (have < cost) {
            Helper.say(player, "You need " + cost + " coins to rebirth. You have " + have + ".");
            return;
        }
        data.coins.put(id, have - cost); // the price is spent; anything above it is kept
        data.rebirths.put(id, rb + 1);
        data.spare.remove(id);
        for (Dropper d : data.droppers.values()) {
            if (d.owner.equals(id)) d.level = 1;
        }
        data.markDirty();
        player.getWorld().playSound(null, player.getBlockPos(), SoundEvents.UI_TOAST_CHALLENGE_COMPLETE, SoundCategory.PLAYERS, 0.8f, 1f);
        broadcast(player.getServer(), player.getName().getString() + " was reborn as a tycoon (rebirth " + (rb + 1)
                + ", coins now x" + rebirthBonus(rb + 1) + ")!");
    }

    private static final long[] MILESTONES = {1_000, 10_000, 100_000, 1_000_000};

    private static void checkMilestones(MinecraftServer server, Data data, UUID owner) {
        int got = data.milestones.getOrDefault(owner, 0);
        long earned = data.earned.getOrDefault(owner, 0L);
        if (got >= MILESTONES.length || earned < MILESTONES[got]) return;
        data.milestones.put(owner, got + 1);
        data.markDirty();
        ServerPlayerEntity p = server.getPlayerManager().getPlayer(owner);
        String who = p != null ? p.getName().getString() : "Someone";
        broadcast(server, who + " has earned " + String.format(java.util.Locale.ROOT, "%,d", MILESTONES[got]) + " tycoon coins!");
        if (p == null) return;
        ItemStack[] reward = switch (got) {
            case 0 -> new ItemStack[]{conveyors(16), named(Items.LIME_GLAZED_TERRACOTTA, 1, "Upgrader x2", Formatting.GREEN), lifter()};
            case 1 -> new ItemStack[]{dropperItem()};
            case 2 -> new ItemStack[]{named(Items.CYAN_GLAZED_TERRACOTTA, 2, "Super Upgrader x3", Formatting.AQUA)};
            default -> new ItemStack[]{named(Items.PURPLE_GLAZED_TERRACOTTA, 2, "Mega Upgrader x5", Formatting.LIGHT_PURPLE), starUpgrader()};
        };
        for (ItemStack r : reward) p.getInventory().offerOrDrop(r);
        Helper.say(p, "Milestone reward! I put some free tycoon parts in your inventory.");
    }

    private static void broadcast(MinecraftServer server, String message) {
        Text t = Text.literal("[Tycoon] ").formatted(Formatting.GOLD).append(Text.literal(message).formatted(Formatting.YELLOW));
        for (ServerPlayerEntity p : server.getPlayerManager().getPlayerList()) p.sendMessage(t, false);
    }

    /** /helper tycoon top: the five biggest earners. */
    static void top(ServerPlayerEntity player) {
        Data data = Data.get(player.getServer());
        List<Map.Entry<UUID, Long>> rows = new ArrayList<>(data.earned.entrySet());
        rows.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
        if (rows.isEmpty()) {
            Helper.say(player, "Nobody has earned any coins yet. /helper tycoon start to get going!");
            return;
        }
        player.sendMessage(Text.literal("Top tycoons (coins earned):").formatted(Formatting.GOLD), false);
        for (int i = 0; i < Math.min(5, rows.size()); i++) {
            UUID id = rows.get(i).getKey();
            String name = player.getServer().getUserCache() == null ? null
                    : player.getServer().getUserCache().getByUuid(id).map(com.mojang.authlib.GameProfile::getName).orElse(null);
            int rb = data.rebirths(id);
            player.sendMessage(Text.literal((i + 1) + ". " + (name == null ? "A player" : name) + "  "
                    + String.format(java.util.Locale.ROOT, "%,d", rows.get(i).getValue())
                    + (rb > 0 ? "  (rebirth " + rb + ")" : "")).formatted(id.equals(player.getUuid()) ? Formatting.AQUA : Formatting.GRAY), false);
        }
    }

    /** For quest rewards and admins: /helper tycoon give <player> <amount>. */
    static void give(ServerPlayerEntity target, long amount) {
        Data data = Data.get(target.getServer());
        data.add(target.getUuid(), amount);
        target.sendMessage(Text.literal("+" + amount + " coins (" + data.coins(target.getUuid()) + ")").formatted(Formatting.GOLD), false);
    }

    // ---------------------------------------------------------------------------------------
    // Progress: shop tiers follow how far you are in the modpack
    // ---------------------------------------------------------------------------------------

    private static boolean has(ServerPlayerEntity player, String advancement) {
        Advancement adv = player.getServer().getAdvancementLoader().get(new Identifier(advancement));
        return adv != null && player.getAdvancementTracker().getProgress(adv).isDone();
    }

    static int tier(ServerPlayerEntity player) {
        if (has(player, "minecraft:story/enter_the_end")) return 3;
        if (has(player, "minecraft:story/enter_the_nether")) return 2;
        return 1;
    }

    private static String tierName(int tier) {
        return switch (tier) {
            case 3 -> "3 (End)";
            case 2 -> "2 (Nether)";
            default -> "1 (Overworld). Visit the Nether to unlock tier 2";
        };
    }

    // ---------------------------------------------------------------------------------------
    // The shop
    // ---------------------------------------------------------------------------------------

    /** action, when set, runs instead of giving the item; it returns false (and nothing is charged) if it can't. */
    private record Offer(int tier, long price, String what, java.util.function.Supplier<ItemStack> item, int rebirths,
                         java.util.function.Predicate<ServerPlayerEntity> action) {
        Offer(int tier, long price, String what, java.util.function.Supplier<ItemStack> item) {
            this(tier, price, what, item, 0, null);
        }

        Offer(int tier, long price, String what, java.util.function.Supplier<ItemStack> item, int rebirths) {
            this(tier, price, what, item, rebirths, null);
        }
    }

    /** Big-ticket shop item: one more helper level, straight away. */
    private static boolean trainHelper(ServerPlayerEntity player) {
        HelperData hd = HelperData.get(player.getServer());
        HelperData.Entry e = hd.get(player.getUuid());
        if (e == null) {
            player.sendMessage(Text.literal("Summon your helper first (/helper summon).").formatted(Formatting.RED), true);
            return false;
        }
        if (e.level >= HelperData.MAX_LEVEL) {
            player.sendMessage(Text.literal("Your helper is already level " + HelperData.MAX_LEVEL + ".").formatted(Formatting.RED), true);
            return false;
        }
        e.level++;
        e.work = Math.max(e.work, HelperData.pointsFor(e.level));
        e.inventory.unlocked = HelperData.pocketsFor(e.level);
        hd.markDirty();
        Helper.say(player, "Training done! I'm level " + e.level + " now: I mine faster and have " + e.inventory.unlocked + " pockets.");
        return true;
    }

    private static final Offer[] OFFERS = {
            new Offer(1, 20, "8 Conveyors", () -> conveyors(8)),
            new Offer(1, 40, "Collector", Tycoon::collector),
            new Offer(1, 60, "Lifter (hops ore up a block)", Tycoon::lifter),
            new Offer(1, 150, "Upgrader (x2)", () -> named(Items.LIME_GLAZED_TERRACOTTA, 1, "Upgrader x2", Formatting.GREEN)),
            new Offer(1, 250, "Tycoon Dropper", Tycoon::dropperItem),
            new Offer(1, 15, "16 Bread", () -> new ItemStack(Items.BREAD, 16)),
            new Offer(1, 15, "32 Torches", () -> new ItemStack(Items.TORCH, 32)),
            new Offer(1, 80, "8 Iron Ingots", () -> new ItemStack(Items.IRON_INGOT, 8)),
            new Offer(1, 60, "Saddle", () -> new ItemStack(Items.SADDLE)),
            new Offer(2, 800, "Super Upgrader (x3)", () -> named(Items.CYAN_GLAZED_TERRACOTTA, 1, "Super Upgrader x3", Formatting.AQUA)),
            new Offer(2, 500, "2 Diamonds", () -> new ItemStack(Items.DIAMOND, 2)),
            new Offer(2, 300, "Golden Apple", () -> new ItemStack(Items.GOLDEN_APPLE)),
            new Offer(2, 250, "16 Bottles o' Enchanting", () -> new ItemStack(Items.EXPERIENCE_BOTTLE, 16)),
            new Offer(2, 300, "4 Ender Pearls", () -> new ItemStack(Items.ENDER_PEARL, 4)),
            new Offer(3, 5000, "Mega Upgrader (x5)", () -> named(Items.PURPLE_GLAZED_TERRACOTTA, 1, "Mega Upgrader x5", Formatting.LIGHT_PURPLE)),
            new Offer(3, 25000, "Star Upgrader (x10)", Tycoon::starUpgrader, 1),
            // Big-ticket items for when you're rich.
            new Offer(3, 25_000, "Shulker Box", () -> new ItemStack(Items.SHULKER_BOX)),
            new Offer(3, 50_000, "Mending book", () -> net.minecraft.item.EnchantedBookItem.forEnchantment(
                    new net.minecraft.enchantment.EnchantmentLevelEntry(net.minecraft.enchantment.Enchantments.MENDING, 1))),
            new Offer(3, 100_000, "Netherite Ingot", () -> new ItemStack(Items.NETHERITE_INGOT)),
            new Offer(3, 250_000, "Elytra", () -> new ItemStack(Items.ELYTRA)),
            new Offer(3, 500_000, "Beacon", () -> new ItemStack(Items.BEACON)),
            new Offer(3, 1_000_000, "Helper Training (+1 helper level)",
                    () -> named(Items.EXPERIENCE_BOTTLE, 1, "Helper Training", Formatting.AQUA), 0, Tycoon::trainHelper),
            new Offer(3, 3000, "Netherite Scrap", () -> new ItemStack(Items.NETHERITE_SCRAP)),
            new Offer(3, 4000, "Totem of Undying", () -> new ItemStack(Items.TOTEM_OF_UNDYING)),
            new Offer(3, 2500, "Enchanted Golden Apple", () -> new ItemStack(Items.ENCHANTED_GOLDEN_APPLE)),
            new Offer(2, 250_000, "Star Roadster (a flying sports car you can repaint)",
                    () -> named(Items.LEATHER_HORSE_ARMOR, 1, "Star Roadster", Formatting.RED), 0, Roadster::spawn),
            // Ad Astra rockets, fully fueled (only shown when Ad Astra is installed)
            new Offer(1, 50_000, "Tier 1 Rocket, full of cryo fuel (Moon, Fairway)", () -> rocket(1)),
            new Offer(2, 150_000, "Tier 2 Rocket, full of cryo fuel (Mars)", () -> rocket(2)),
            new Offer(3, 400_000, "Tier 3 Rocket, full of cryo fuel (Venus, Mercury, Bikini Bottom, Ceres)", () -> rocket(3)),
            new Offer(3, 1_000_000, "Tier 4 Rocket, full of cryo fuel (every planet: Glacio, Europa, Io, Titan, Pluto)", () -> rocket(4)),
            new Offer(1, 5_000, "Launch Pad", () -> adAstra("launch_pad", 1)),
            new Offer(1, 20_000, "4 Cryo Fuel buckets (refills)", () -> adAstra("cryo_fuel_bucket", 4)),
    };

    /** Offers that can be sold here (rockets need Ad Astra). */
    private static List<Offer> offers() {
        List<Offer> list = new ArrayList<>();
        for (Offer o : OFFERS) if (o.action() != null || !o.item().get().isEmpty()) list.add(o);
        return list;
    }

    private static ItemStack adAstra(String id, int count) {
        Identifier key = new Identifier("ad_astra", id);
        if (!net.minecraft.registry.Registries.ITEM.containsId(key)) return ItemStack.EMPTY;
        return new ItemStack(net.minecraft.registry.Registries.ITEM.get(key), count);
    }

    /**
     * An Ad Astra rocket with a full tank (3 buckets) of cryo fuel, the best fuel: it only burns 1 bucket a launch,
     * so that's 3 launches. Ad Astra keeps an item's fuel in Botarium's NBT: BotariumData.StoredFluids[{Fluid, Amount}],
     * Amount in Fabric droplets (81 per millibucket).
     */
    static ItemStack rocket(int tier) {
        ItemStack stack = adAstra("tier_" + tier + "_rocket", 1);
        if (stack.isEmpty()) return stack;
        NbtCompound fluid = new NbtCompound();
        fluid.putString("Fluid", "ad_astra:cryo_fuel");
        fluid.putLong("Amount", 3000L * 81L);
        NbtList fluids = new NbtList();
        fluids.add(fluid);
        NbtCompound data = new NbtCompound();
        data.put("StoredFluids", fluids);
        stack.getOrCreateNbt().put("BotariumData", data);
        return stack;
    }

    private static String lockReason(Offer o) {
        String need = o.tier() == 2 ? "visit the Nether" : o.tier() == 3 ? "reach the End" : "";
        if (o.rebirths() > 0) need = (need.isEmpty() ? "" : need + " and ") + "rebirth at least " + o.rebirths() + " time" + (o.rebirths() == 1 ? "" : "s");
        return need;
    }

    static void openShop(ServerPlayerEntity player) {
        player.openHandledScreen(new SimpleNamedScreenHandlerFactory(
                (syncId, inv, p) -> new Shop(syncId, inv, player),
                Text.literal("Tycoon Shop")));
    }

    static final class Shop extends GenericContainerScreenHandler {
        private final ServerPlayerEntity player;
        private static final int SIZE = 54;
        private final SimpleInventory view;
        private final List<Offer> list;

        Shop(int syncId, PlayerInventory inv, ServerPlayerEntity player) {
            this(syncId, inv, player, new SimpleInventory(SIZE));
        }

        private Shop(int syncId, PlayerInventory inv, ServerPlayerEntity player, SimpleInventory view) {
            super(ScreenHandlerType.GENERIC_9X6, syncId, inv, view, 6);
            this.player = player;
            this.view = view;
            this.list = offers();
            refresh();
        }

        private void refresh() {
            Data data = Data.get(player.getServer());
            int tier = tier(player);
            for (int i = 0; i < SIZE; i++) view.setStack(i, ItemStack.EMPTY);
            for (int i = 0; i < list.size() && i < SIZE - 1; i++) {
                Offer o = list.get(i);
                ItemStack shown = o.item().get();
                boolean open = tier >= o.tier() && data.rebirths(player.getUuid()) >= o.rebirths();
                ItemStack button = Storage.Menu.button(open ? shown.getItem() : Items.BARRIER, o.what(),
                        open ? "Costs " + o.price() + " coins" : "Locked: " + lockReason(o),
                        open ? "Click to buy" : "Costs " + o.price() + " coins once unlocked");
                button.setCount(Math.max(1, shown.getCount()));
                view.setStack(i, button);
            }
            view.setStack(SIZE - 1, Storage.Menu.button(Items.GOLD_INGOT, data.coins(player.getUuid()) + " coins",
                    "Earn coins with Tycoon Droppers", "Tier " + tierName(tier)));
            sendContentUpdates();
        }

        @Override
        public void onSlotClick(int slotIndex, int button, SlotActionType action, PlayerEntity p) {
            if (slotIndex < 0 || slotIndex >= SIZE) {
                if (action != SlotActionType.QUICK_MOVE) super.onSlotClick(slotIndex, button, action, p);
                return;
            }
            if (action == SlotActionType.PICKUP && slotIndex < list.size() && slotIndex < SIZE - 1) buy(list.get(slotIndex));
            refresh();
        }

        private void buy(Offer o) {
            Data data = Data.get(player.getServer());
            if (tier(player) < o.tier() || data.rebirths(player.getUuid()) < o.rebirths()) {
                player.sendMessage(Text.literal("Locked: " + lockReason(o) + ".").formatted(Formatting.RED), true);
                return;
            }
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
}
