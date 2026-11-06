package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.ChatFormatting;
import net.minecraft.advancements.Advancement;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.DispenserBlock;
import net.minecraft.world.level.block.GlazedTerracottaBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
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

    static final class Data extends SavedData {
        private static final String ID = "helpermod_tycoon";
        private static final SavedDataType<Data> TYPE = Compat.dataType(ID, Data::new, Data::fromNbt, d -> d.save(new CompoundTag()));
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
            return server.overworld().getDataStorage().computeIfAbsent(TYPE);
        }

        /** Register a Tycoon Dropper. If its owner picked one up earlier, it gets that one's level back. */
        Dropper register(Level world, BlockPos pos, UUID owner) {
            return register(world, pos, owner, 0);
        }

        /** level > 0: a pre-levelled dropper from a loot box, which doesn't use up the spare level. */
        Dropper register(Level world, BlockPos pos, UUID owner, int boxLevel) {
            Dropper existing = droppers.get(key(world, pos));
            if (existing != null) return existing;
            if (boxLevel > 0) {
                Dropper d = new Dropper(owner, Math.min(MAX_LEVEL, boxLevel));
                droppers.put(key(world, pos), d);
                setDirty();
                return d;
            }
            Integer level = spare.remove(owner);
            Dropper d = new Dropper(owner, level == null ? 1 : level);
            droppers.put(key(world, pos), d);
            setDirty();
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
            setDirty();
        }

        private static Data fromNbt(CompoundTag nbt) {
            Data d = new Data();
            ListTag players = nbt.getListOrEmpty("players");
            for (int i = 0; i < players.size(); i++) {
                CompoundTag p = players.getCompoundOrEmpty(i);
                UUID id = p.getUUID("id");
                d.coins.put(id, p.getLongOr("coins", 0L));
                d.earned.put(id, p.getLongOr("earned", 0L));
                d.started.put(id, p.getBooleanOr("started", false));
                if (p.getIntOr("spare", 0) > 0) d.spare.put(id, p.getIntOr("spare", 0));
                if (p.getIntOr("rebirths", 0) > 0) d.rebirths.put(id, p.getIntOr("rebirths", 0));
                if (p.getIntOr("milestones", 0) > 0) d.milestones.put(id, p.getIntOr("milestones", 0));
            }
            ListTag list = nbt.getListOrEmpty("droppers");
            for (int i = 0; i < list.size(); i++) {
                CompoundTag t = list.getCompoundOrEmpty(i);
                d.droppers.put(t.getString("key"), new Dropper(t.getUUID("owner"), t.getInt("level")));
            }
            return d;
        }

                public CompoundTag save(CompoundTag nbt) {
            ListTag players = new ListTag();
            java.util.Set<UUID> ids = new java.util.HashSet<>(coins.keySet());
            ids.addAll(started.keySet());
            ids.addAll(spare.keySet());
            ids.addAll(rebirths.keySet());
            for (UUID id : ids) {
                CompoundTag p = new CompoundTag();
                p.putUUID("id", id);
                p.putLong("coins", coins.getOrDefault(id, 0L));
                p.putLong("earned", earned.getOrDefault(id, 0L));
                p.putBoolean("started", started.getOrDefault(id, false));
                p.putInt("spare", spare.getOrDefault(id, 0));
                p.putInt("rebirths", rebirths.getOrDefault(id, 0));
                p.putInt("milestones", milestones.getOrDefault(id, 0));
                players.add(p);
            }
            nbt.put("players", players);
            ListTag list = new ListTag();
            droppers.forEach((key, dr) -> {
                CompoundTag t = new CompoundTag();
                t.putString("key", key);
                t.putUUID("owner", dr.owner);
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

    private static String key(Level world, BlockPos pos) {
        return world.dimension().location() + "|" + pos.asLong();
    }

    // ---------------------------------------------------------------------------------------
    // Items
    // ---------------------------------------------------------------------------------------

    private static ItemStack named(Item item, int count, String name, ChatFormatting color) {
        ItemStack stack = new ItemStack(item, count);
        stack.setHoverName(Component.literal(name).withStyle(s -> s.withItalic(false)).withStyle(color));
        return stack;
    }

    static ItemStack dropperItem() {
        return named(Items.DROPPER, 1, DROPPER_NAME, ChatFormatting.GOLD);
    }

    private static final String LEVEL_NBT = "HelperDropperLevel";

    /** A Tycoon Dropper that starts at a set level (from loot boxes). Same name, so it works like any other. */
    static ItemStack dropperItem(int level) {
        ItemStack stack = dropperItem();
        stack.getOrCreateTag().putInt(LEVEL_NBT, level);
        ListTag lore = new ListTag();
        lore.add(net.minecraft.nbt.StringTag.valueOf(Component.Serializer.toJson(
                Component.literal("Starts at level " + level).withStyle(s -> s.withItalic(false)).withStyle(ChatFormatting.YELLOW))));
        stack.getOrCreateTagElement("display").put("Lore", lore);
        return stack;
    }

    /** Tycoon machines by name, for the shop, milestones and Machine Boxes. */
    static ItemStack machine(String kind, int count) {
        return switch (kind) {
            case "upgrader" -> named(Items.GLAZED_TERRACOTTA.lime(), count, "Upgrader x2", ChatFormatting.GREEN);
            case "super" -> named(Items.GLAZED_TERRACOTTA.cyan(), count, "Super Upgrader x3", ChatFormatting.AQUA);
            case "mega" -> named(Items.GLAZED_TERRACOTTA.purple(), count, "Mega Upgrader x5", ChatFormatting.LIGHT_PURPLE);
            case "speed" -> named(Items.GLAZED_TERRACOTTA.lightBlue(), count, "Speed Belt", ChatFormatting.BLUE);
            case "polisher" -> named(Items.GLAZED_TERRACOTTA.orange(), count, "Polisher +10", ChatFormatting.GOLD);
            case "smelter" -> named(Items.GLAZED_TERRACOTTA.brown(), count, "Smelter x1.5", ChatFormatting.RED);
            case "lucky" -> named(Items.GLAZED_TERRACOTTA.pink(), count, "Lucky Upgrader", ChatFormatting.LIGHT_PURPLE);
            default -> ItemStack.EMPTY;
        };
    }

    static boolean isDropperItem(ItemStack stack) {
        return stack.is(Items.DROPPER) && stack.hasCustomHoverName() && stack.getHoverName().getString().equals(DROPPER_NAME);
    }

    static ItemStack conveyors(int n) {
        return named(Items.GLAZED_TERRACOTTA.magenta(), n, "Conveyor", ChatFormatting.LIGHT_PURPLE);
    }

    static ItemStack collector() {
        return named(Items.GLAZED_TERRACOTTA.black(), 1, "Collector", ChatFormatting.DARK_GRAY);
    }

    /** Upgrader blocks: which block, how much it multiplies by. */
    private static int multiplier(BlockState state) {
        if (state.is(Blocks.GLAZED_TERRACOTTA.lime())) return 2;
        if (state.is(Blocks.GLAZED_TERRACOTTA.cyan())) return 3;
        if (state.is(Blocks.GLAZED_TERRACOTTA.purple())) return 5;
        if (state.is(Blocks.GLAZED_TERRACOTTA.red())) return 10;
        return 1;
    }

    /** Yellow Lifters hop ore up one block, so lines can climb to a second floor. */
    private static boolean isLifter(BlockState state) {
        return state.is(Blocks.GLAZED_TERRACOTTA.yellow());
    }

    private static boolean isSpeedBelt(BlockState state) {
        return state.is(Blocks.GLAZED_TERRACOTTA.lightBlue());
    }

    /** Machines that change ore once each: Polisher (+10), Smelter (x1.5), Lucky Upgrader (1 in 8 for x20). */
    private static boolean isSpecial(BlockState state) {
        return state.is(Blocks.GLAZED_TERRACOTTA.orange()) || state.is(Blocks.GLAZED_TERRACOTTA.brown())
                || state.is(Blocks.GLAZED_TERRACOTTA.pink());
    }

    private static boolean isBelt(BlockState state) {
        return state.is(Blocks.GLAZED_TERRACOTTA.magenta()) || isLifter(state) || isSpeedBelt(state) || isSpecial(state)
                || multiplier(state) > 1;
    }

    static ItemStack lifter() {
        return named(Items.GLAZED_TERRACOTTA.yellow(), 1, "Lifter", ChatFormatting.YELLOW);
    }

    static ItemStack starUpgrader() {
        return named(Items.GLAZED_TERRACOTTA.red(), 1, "Star Upgrader x10", ChatFormatting.RED);
    }

    /** What collected ore is multiplied by: +50% per rebirth. */
    static double rebirthBonus(int rebirths) {
        return 1.0 + 0.5 * rebirths;
    }

    // ---------------------------------------------------------------------------------------
    // Placing a Tycoon Dropper
    // ---------------------------------------------------------------------------------------

    private record Pending(ResourceKey<Level> world, BlockPos pos, UUID player, int ticks, int level) {}

    private static final List<Pending> PENDING = new ArrayList<>();
    /** Ore entities alive right now, and the dropper each came from. Not saved: old ore is cleared on load. */
    private static final Map<UUID, String> ORES = new HashMap<>();

    static void reset() {
        PENDING.clear();
        ORES.clear();
    }

    static InteractionResult onUseBlock(Player p, Level w, InteractionHand hand, BlockHitResult hit) {
        if (w.isClientSide() || !(p instanceof ServerPlayer player) || p instanceof FakePlayer) return InteractionResult.PASS;
        ItemStack stack = player.getItemInHand(hand);
        if (isDropperItem(stack)) {
            BlockPos pos = new BlockPlaceContext(player, hand, stack, hit).getClickedPos();
            int level = stack.hasTag() ? stack.getTag().getInt(LEVEL_NBT) : 0;
            PENDING.add(new Pending(w.dimension(), pos.immutable(), player.getUUID(), 0, level));
        }
        return InteractionResult.PASS;
    }

    /** A Tycoon Dropper that turns up somewhere the mod doesn't know (moved by a carrying mod, for example). */
    static void onBlockEntityLoad(net.minecraft.world.level.block.entity.BlockEntity be, ServerLevel world) {
        if (!(be instanceof net.minecraft.world.level.block.entity.DropperBlockEntity dropper) || !dropper.hasCustomName()) return;
        if (!DROPPER_NAME.equals(dropper.getCustomName().getString())) return;
        BlockPos pos = be.getBlockPos().immutable();
        world.getServer().execute(() -> {
            Data data = Data.get(world.getServer());
            if (data.droppers.containsKey(key(world, pos))) return;
            Player near = world.getNearestPlayer(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5, 48, false);
            if (near == null) return;
            Dropper d = data.register(world, pos, near.getUUID());
            if (near instanceof ServerPlayer sp) Helper.say(sp, "Tycoon Dropper is working again (level " + d.level + ").");
        });
    }

    /** /helper tycoon fix: make the dropper you're looking at work as your Tycoon Dropper. */
    static void fix(ServerPlayer player) {
        HitResult hit = player.pick(6, 0, false);
        if (!(hit instanceof BlockHitResult bh) || hit.getType() != HitResult.Type.BLOCK
                || !player.level().getBlockState(bh.getBlockPos()).is(Blocks.DROPPER)) {
            Helper.say(player, "Look at your Tycoon Dropper and run /helper tycoon fix again.");
            return;
        }
        BlockPos pos = bh.getBlockPos();
        if (!(player.level().getBlockEntity(pos) instanceof net.minecraft.world.level.block.entity.DropperBlockEntity be)
                || !be.hasCustomName() || !DROPPER_NAME.equals(be.getCustomName().getString())) {
            Helper.say(player, "That's a plain dropper. Only Tycoon Droppers (from the starter kit or the shop) drop ore.");
            return;
        }
        Data data = Data.get(player.level().getServer());
        Dropper existing = data.droppers.get(key(player.level(), pos));
        if (existing != null) {
            Helper.say(player, "That Tycoon Dropper is already working (level " + existing.level + "). Make sure its front isn't blocked "
                    + "and it isn't getting a redstone signal.");
            return;
        }
        Dropper d = data.register(player.level(), pos, player.getUUID());
        Helper.say(player, "Fixed! Your Tycoon Dropper is working again (level " + d.level + ").");
    }

    /** Old ore left over from before a restart has no dropper to pay out to: remove it. */
    static void onEntityLoad(Entity entity, ServerLevel world) {
        if (entity instanceof ItemEntity && entity.entityTags().contains(ORE_TAG) && !ORES.containsKey(entity.getUUID())) {
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
            ServerLevel world = server.getLevel(pd.world());
            if (world != null && world.getBlockState(pd.pos()).is(Blocks.DROPPER)) {
                Dropper placed = data.register(world, pd.pos(), pd.player(), pd.level());
                ServerPlayer player = server.getPlayerList().getPlayer(pd.player());
                if (player != null) Helper.say(player, "Tycoon Dropper placed" + (placed.level > 1 ? " (level " + placed.level + ")" : "")
                        + "! It drops ore out of its front. Lead conveyors from there to a Collector to earn coins.");
                PENDING.remove(i);
            } else if (pd.ticks() > 5) {
                PENDING.remove(i);
            } else {
                PENDING.set(i, new Pending(pd.world(), pd.pos(), pd.player(), pd.ticks() + 1, pd.level()));
            }
        }

        for (Iterator<Map.Entry<String, Dropper>> it = data.droppers.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<String, Dropper> e = it.next();
            String[] parts = e.getKey().split("\\|");
            Identifier dim = Identifier.tryParse(parts[0]);
            ServerLevel world = dim == null ? null : server.getLevel(ResourceKey.create(Registries.DIMENSION, dim));
            if (world == null) continue;
            BlockPos pos = BlockPos.of(Long.parseLong(parts[1]));
            if (!world.hasChunkAt(pos)) continue;
            BlockState state = world.getBlockState(pos);
            Dropper d = e.getValue();
            if (!state.is(Blocks.DROPPER)) { // picked up or broken: remember its level for the next one
                it.remove();
                data.spare.merge(d.owner, d.level, Math::max);
                data.setDirty();
                ServerPlayer owner = server.getPlayerList().getPlayer(d.owner);
                if (owner != null) Helper.say(owner, "Your Tycoon Dropper was picked up. Place it again anywhere and it keeps its level ("
                        + d.level + ").");
                continue;
            }
            if (++d.timer < d.interval() || d.live >= MAX_ORES_PER_DROPPER) continue;
            d.timer = 0;
            if (world.hasNeighborSignal(pos)) continue; // a redstone signal pauses it
            drop(world, pos, state.getValue(DispenserBlock.FACING), d, e.getKey());
        }

        // Move the ore.
        boolean checkPiles = server.getTickCount() % 20 == 0;
        List<ItemEntity> live = checkPiles ? new ArrayList<>() : null;
        for (Iterator<Map.Entry<UUID, String>> it = ORES.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<UUID, String> e = it.next();
            Dropper source = data.droppers.get(e.getValue());
            ItemEntity ore = null;
            for (ServerLevel w : server.getAllLevels()) {
                if (w.getEntity(e.getKey()) instanceof ItemEntity ie) {
                    ore = ie;
                    break;
                }
            }
            if (ore == null || !ore.isAlive() || ore.getAge() > ORE_LIFETIME) {
                if (ore != null) ore.discard();
                if (source != null) source.live = Math.max(0, source.live - 1);
                it.remove();
                continue;
            }
            if (moveOre((ServerLevel) ore.level(), ore, data)) {
                if (source != null) source.live = Math.max(0, source.live - 1);
                it.remove();
            } else if (live != null) {
                live.add(ore);
            }
        }
        if (live != null && !live.isEmpty()) BlackHole.checkPiles(live); // big piles spin into a Singularity
    }

    private static void drop(ServerLevel world, BlockPos pos, Direction facing, Dropper d, String key) {
        Item look = d.level >= 8 ? Items.RAW_GOLD : d.level >= 4 ? Items.RAW_IRON : Items.RAW_COPPER;
        ItemStack stack = new ItemStack(look);
        CompoundTag tag = stack.getOrCreateTagElement(ORE_NBT);
        tag.putLong("value", d.oreValue());
        tag.putUUID("owner", d.owner);
        tag.putLong("id", world.getRandom().nextLong()); // never stacks with other ore
        tag.put("ups", new ListTag());
        Vec3 at = Vec3.atCenterOf(pos).add(facing.getStepX() * 0.7, facing.getStepY() * 0.7 - 0.15, facing.getStepZ() * 0.7);
        ItemEntity ore = new ItemEntity(world, at.x, at.y, at.z, stack,
                facing.getStepX() * 0.1, 0, facing.getStepZ() * 0.1);
        ore.setNeverPickUp();
        ore.addTag(ORE_TAG);
        ORES.put(ore.getUUID(), key);
        world.addFreshEntity(ore);
        d.live++;
        world.playSound(null, pos, SoundEvents.DISPENSER_DISPENSE, SoundSource.BLOCKS, 0.25f, 1.4f);
    }

    /** Returns true when the ore has been collected (or is otherwise finished). */
    private static boolean moveOre(ServerLevel world, ItemEntity ore, Data data) {
        BlockPos under = BlockPos.containing(ore.getX(), ore.getY() - 0.1, ore.getZ());
        BlockState state = world.getBlockState(under);
        ItemStack stack = ore.getItem();
        CompoundTag tag = stack.getTagElement(ORE_NBT);
        if (tag == null) return true;

        if (state.is(Blocks.GLAZED_TERRACOTTA.black())) { // a Collector: cash in
            UUID owner = tag.getUUID("owner");
            long value = Math.max(1, Math.round(tag.getLong("value") * rebirthBonus(data.rebirths(owner))));
            data.add(owner, value);
            checkMilestones(world.getServer(), data, owner);
            world.sendParticles(ParticleTypes.HAPPY_VILLAGER, ore.getX(), ore.getY() + 0.3, ore.getZ(), 4, 0.2, 0.2, 0.2, 0);
            world.playSound(null, under, SoundEvents.EXPERIENCE_ORB_PICKUP, SoundSource.BLOCKS, 0.3f, 1.6f);
            ServerPlayer p = world.getServer().getPlayerList().getPlayer(owner);
            TycoonSidebar.earned(world.getServer(), owner, value); // shown on the side panel, not in the middle of the screen
            ore.discard();
            return true;
        }
        int mult = multiplier(state);
        if (mult > 1) { // each upgrader block works once per ore
            ListTag ups = tag.getListOrEmpty("ups");
            net.minecraft.nbt.LongTag here = net.minecraft.nbt.LongTag.valueOf(under.asLong());
            if (!ups.contains(here) && ups.size() < 16) {
                ups.add(here);
                tag.put("ups", ups);
                tag.putLong("value", Math.min(Long.MAX_VALUE / 8, tag.getLong("value") * mult));
                ore.setItem(stack.copy());
                world.sendParticles(ParticleTypes.ELECTRIC_SPARK, ore.getX(), ore.getY() + 0.2, ore.getZ(), 6, 0.15, 0.15, 0.15, 0.05);
                world.playSound(null, under, SoundEvents.AMETHYST_BLOCK_CHIME, SoundSource.BLOCKS, 0.4f, 1.2f);
            }
        }
        if (isSpecial(state)) {
            ListTag ups = tag.getListOrEmpty("ups");
            net.minecraft.nbt.LongTag here = net.minecraft.nbt.LongTag.valueOf(under.asLong());
            if (!ups.contains(here) && ups.size() < 16) {
                ups.add(here);
                tag.put("ups", ups);
                long value = tag.getLongOr("value", 0L);
                ItemStack next = stack;
                if (state.is(Blocks.GLAZED_TERRACOTTA.orange())) {
                    value += 10;
                    world.sendParticles(ParticleTypes.WAX_ON, ore.getX(), ore.getY() + 0.2, ore.getZ(), 6, 0.15, 0.15, 0.15, 0.05);
                    world.playSound(null, under, SoundEvents.HONEYCOMB_WAX_ON, SoundSource.BLOCKS, 0.4f, 1.3f);
                } else if (state.is(Blocks.GLAZED_TERRACOTTA.brown())) {
                    value = value + (value + 1) / 2; // x1.5, rounded up
                    Item ingot = stack.is(Items.RAW_GOLD) ? Items.GOLD_INGOT : stack.is(Items.RAW_IRON) ? Items.IRON_INGOT
                            : stack.is(Items.RAW_COPPER) ? Items.COPPER_INGOT : stack.getItem();
                    if (ingot != stack.getItem()) {
                        next = new ItemStack(ingot);
                        next.setTag(stack.getTag());
                    }
                    world.sendParticles(ParticleTypes.FLAME, ore.getX(), ore.getY() + 0.2, ore.getZ(), 8, 0.15, 0.15, 0.15, 0.02);
                    world.playSound(null, under, SoundEvents.FURNACE_FIRE_CRACKLE, SoundSource.BLOCKS, 0.6f, 1.0f);
                } else if (world.getRandom().nextInt(8) == 0) { // Lucky Upgrader
                    value *= 20;
                    world.sendParticles(ParticleTypes.TOTEM_OF_UNDYING, ore.getX(), ore.getY() + 0.3, ore.getZ(), 20, 0.2, 0.3, 0.2, 0.2);
                    world.playSound(null, under, SoundEvents.PLAYER_LEVELUP, SoundSource.BLOCKS, 0.5f, 1.6f);
                } else {
                    world.sendParticles(ParticleTypes.SMOKE, ore.getX(), ore.getY() + 0.2, ore.getZ(), 3, 0.1, 0.1, 0.1, 0.01);
                }
                next.getOrCreateTagElement(ORE_NBT).putLong("value", Math.min(Long.MAX_VALUE / 8, value));
                next.getOrCreateTagElement(ORE_NBT).put("ups", ups);
                ore.setItem(next.copy());
            }
        }
        if (isBelt(state)) {
            // The arrow on the block points away from whoever placed it.
            Direction dir = state.getValue(GlazedTerracottaBlock.FACING).getOpposite();
            Vec3 v = ore.getDeltaMovement();
            double cx = under.getX() + 0.5, cz = under.getZ() + 0.5;
            double speed = isSpeedBelt(state) ? BELT_SPEED * 2.2 : BELT_SPEED;
            double vx = dir.getStepX() != 0 ? dir.getStepX() * speed : (cx - ore.getX()) * 0.2;
            double vz = dir.getStepZ() != 0 ? dir.getStepZ() * speed : (cz - ore.getZ()) * 0.2;
            double vy = v.y;
            if (isLifter(state) && ore.onGround()) vy = 0.42; // hop up a block
            ore.setDeltaMovement(vx, vy, vz);
            ore.needsSync = true;
        }
        return false;
    }

    // ---------------------------------------------------------------------------------------
    // Commands
    // ---------------------------------------------------------------------------------------

    static void info(ServerPlayer player) {
        Data data = Data.get(player.level().getServer());
        long mine = data.droppers.values().stream().filter(d -> d.owner.equals(player.getUUID())).count();
        int rb = data.rebirths(player.getUUID());
        Helper.say(player, "You have " + data.coins(player.getUUID()) + " coins and " + mine + " Tycoon Dropper"
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
                "New machines: light blue Speed Belts carry ore twice as fast, orange Polishers add +10, brown Smelters x1.5 and turn ore",
                "into ingots, pink Lucky Upgraders have a 1 in 8 chance of x20. Put Polishers before upgraders so the +10 gets multiplied too.",
                "Loot boxes (Gear, Machine, Mega) are in the shop. Right-click one to open it. /helper tycoon odds shows the chances.",
                "Black Collectors turn ore into coins. A redstone signal pauses a dropper.",
        };
        for (String line : how) player.sendSystemMessage(Component.literal(line).withStyle(ChatFormatting.GRAY));
    }

    static void start(ServerPlayer player) {
        Data data = Data.get(player.level().getServer());
        if (data.started.getOrDefault(player.getUUID(), false)) {
            Helper.say(player, "You've already had your starter kit. Earn coins and buy more in /helper tycoon shop.");
            return;
        }
        data.started.put(player.getUUID(), true);
        data.setDirty();
        player.getInventory().placeItemBackInInventory(dropperItem());
        player.getInventory().placeItemBackInInventory(conveyors(16));
        player.getInventory().placeItemBackInInventory(collector());
        Helper.say(player, "Here's your tycoon starter kit! Place the Tycoon Dropper, put conveyors in front of it "
                + "with the arrows pointing away, and end the line on the Collector.");
    }

    static void upgrade(ServerPlayer player) {
        HitResult hit = player.pick(6, 0, false);
        if (!(hit instanceof BlockHitResult bh) || hit.getType() != HitResult.Type.BLOCK) {
            Helper.say(player, "Look at your Tycoon Dropper and try again.");
            return;
        }
        Data data = Data.get(player.level().getServer());
        Dropper d = data.droppers.get(key(player.level(), bh.getBlockPos()));
        if (d == null || !d.owner.equals(player.getUUID())) {
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
        if (data.coins(player.getUUID()) < cost) {
            Helper.say(player, "Upgrading to level " + (d.level + 1) + " costs " + cost + " coins. You have "
                    + data.coins(player.getUUID()) + ".");
            return;
        }
        data.add(player.getUUID(), -cost);
        d.level++;
        data.setDirty();
        player.level().playSound(null, bh.getBlockPos(), SoundEvents.ANVIL_USE, SoundSource.BLOCKS, 0.6f, 1.3f);
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
    static void rebirth(ServerPlayer player, boolean confirm) {
        Data data = Data.get(player.level().getServer());
        UUID id = player.getUUID();
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
        data.setDirty();
        player.level().playSound(null, player.blockPosition(), SoundEvents.UI_TOAST_CHALLENGE_COMPLETE, SoundSource.PLAYERS, 0.8f, 1f);
        broadcast(player.level().getServer(), player.getName().getString() + " was reborn as a tycoon (rebirth " + (rb + 1)
                + ", coins now x" + rebirthBonus(rb + 1) + ")!");
    }

    private static final long[] MILESTONES = {1_000, 10_000, 100_000, 1_000_000};

    private static void checkMilestones(MinecraftServer server, Data data, UUID owner) {
        int got = data.milestones.getOrDefault(owner, 0);
        long earned = data.earned.getOrDefault(owner, 0L);
        if (got >= MILESTONES.length || earned < MILESTONES[got]) return;
        data.milestones.put(owner, got + 1);
        data.setDirty();
        ServerPlayer p = server.getPlayerList().getPlayer(owner);
        String who = p != null ? p.getName().getString() : "Someone";
        broadcast(server, who + " has earned " + String.format(java.util.Locale.ROOT, "%,d", MILESTONES[got]) + " tycoon coins!");
        if (p == null) return;
        ItemStack[] reward = switch (got) {
            case 0 -> new ItemStack[]{conveyors(16), named(Items.GLAZED_TERRACOTTA.lime(), 1, "Upgrader x2", ChatFormatting.GREEN), lifter()};
            case 1 -> new ItemStack[]{dropperItem()};
            case 2 -> new ItemStack[]{named(Items.GLAZED_TERRACOTTA.cyan(), 2, "Super Upgrader x3", ChatFormatting.AQUA)};
            default -> new ItemStack[]{named(Items.GLAZED_TERRACOTTA.purple(), 2, "Mega Upgrader x5", ChatFormatting.LIGHT_PURPLE), starUpgrader()};
        };
        for (ItemStack r : reward) p.getInventory().placeItemBackInInventory(r);
        Helper.say(p, "Milestone reward! I put some free tycoon parts in your inventory.");
    }

    private static void broadcast(MinecraftServer server, String message) {
        Component t = Component.literal("[Tycoon] ").withStyle(ChatFormatting.GOLD).append(Component.literal(message).withStyle(ChatFormatting.YELLOW));
        for (ServerPlayer p : server.getPlayerList().getPlayers()) p.sendSystemMessage(t);
    }

    /** /helper tycoon top: the five biggest earners. */
    static void top(ServerPlayer player) {
        Data data = Data.get(player.level().getServer());
        List<Map.Entry<UUID, Long>> rows = new ArrayList<>(data.earned.entrySet());
        rows.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
        if (rows.isEmpty()) {
            Helper.say(player, "Nobody has earned any coins yet. /helper tycoon start to get going!");
            return;
        }
        player.sendSystemMessage(Component.literal("Top tycoons (coins earned):").withStyle(ChatFormatting.GOLD));
        for (int i = 0; i < Math.min(5, rows.size()); i++) {
            UUID id = rows.get(i).getKey();
            String name = player.level().getServer().getProfileCache() == null ? null
                    : player.level().getServer().getProfileCache().get(id).map(com.mojang.authlib.GameProfile::getName).orElse(null);
            int rb = data.rebirths(id);
            player.sendSystemMessage(Component.literal((i + 1) + ". " + (name == null ? "A player" : name) + "  "
                    + String.format(java.util.Locale.ROOT, "%,d", rows.get(i).getValue())
                    + (rb > 0 ? "  (rebirth " + rb + ")" : "")).withStyle(id.equals(player.getUUID()) ? ChatFormatting.AQUA : ChatFormatting.GRAY));
        }
    }

    /** For quest rewards and admins: /helper tycoon give <player> <amount>. */
    static void give(ServerPlayer target, long amount) {
        Data data = Data.get(target.level().getServer());
        data.add(target.getUUID(), amount);
        target.sendSystemMessage(Component.literal("+" + amount + " coins (" + data.coins(target.getUUID()) + ")").withStyle(ChatFormatting.GOLD));
    }

    // ---------------------------------------------------------------------------------------
    // Progress: shop tiers follow how far you are in the modpack
    // ---------------------------------------------------------------------------------------

    private static boolean has(ServerPlayer player, String advancement) {
        Advancement adv = player.level().getServer().getAdvancements().getAdvancement(Identifier.parse(advancement));
        return adv != null && player.getAdvancements().getOrStartProgress(adv).isDone();
    }

    static int tier(ServerPlayer player) {
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
                         java.util.function.Predicate<ServerPlayer> action) {
        Offer(int tier, long price, String what, java.util.function.Supplier<ItemStack> item) {
            this(tier, price, what, item, 0, null);
        }

        Offer(int tier, long price, String what, java.util.function.Supplier<ItemStack> item, int rebirths) {
            this(tier, price, what, item, rebirths, null);
        }
    }

    /** Big-ticket shop item: one more helper level, straight away. */
    private static boolean trainHelper(ServerPlayer player) {
        HelperData hd = HelperData.get(player.level().getServer());
        HelperData.Entry e = hd.get(player.getUUID());
        if (e == null) {
            player.sendOverlayMessage(Component.literal("Summon your helper first (/helper summon).").withStyle(ChatFormatting.RED));
            return false;
        }
        if (e.level >= HelperData.MAX_LEVEL) {
            player.sendOverlayMessage(Component.literal("Your helper is already level " + HelperData.MAX_LEVEL + ".").withStyle(ChatFormatting.RED));
            return false;
        }
        e.level++;
        e.work = Math.max(e.work, HelperData.pointsFor(e.level));
        e.inventory.unlocked = HelperData.pocketsFor(e.level);
        hd.setDirty();
        Helper.say(player, "Training done! I'm level " + e.level + " now: I mine faster and have " + e.inventory.unlocked + " pockets.");
        return true;
    }

    private static final Offer[] OFFERS = {
            new Offer(1, 20, "8 Conveyors", () -> conveyors(8)),
            new Offer(1, 40, "Collector", Tycoon::collector),
            new Offer(1, 60, "Lifter (hops ore up a block)", Tycoon::lifter),
            new Offer(1, 150, "Upgrader (x2)", () -> named(Items.GLAZED_TERRACOTTA.lime(), 1, "Upgrader x2", ChatFormatting.GREEN)),
            new Offer(1, 250, "Tycoon Dropper", Tycoon::dropperItem),
            new Offer(1, 15, "16 Bread", () -> new ItemStack(Items.BREAD, 16)),
            new Offer(1, 15, "32 Torches", () -> new ItemStack(Items.TORCH, 32)),
            new Offer(1, 80, "8 Iron Ingots", () -> new ItemStack(Items.IRON_INGOT, 8)),
            new Offer(1, 60, "Saddle", () -> new ItemStack(Items.SADDLE)),
            new Offer(1, 0, "Furniture Catalogue (31 pieces for every room)", () -> new ItemStack(Items.BED.red()), 0, p -> {
                p.level().getServer().execute(() -> Furniture.openCatalog(p));
                return false;
            }),
            // New machines
            new Offer(1, 60, "4 Speed Belts (carry ore twice as fast)", () -> machine("speed", 4)),
            new Offer(1, 300, "Polisher (+10 to each ore)", () -> machine("polisher", 1)),
            new Offer(2, 1500, "Smelter (x1.5, turns ore into ingots)", () -> machine("smelter", 1)),
            new Offer(2, 2000, "Lucky Upgrader (1 in 8 chance of x20)", () -> machine("lucky", 1)),
            // Loot boxes
            new Offer(1, 400, "Machine Box (random tycoon machine or dropper)", () -> Loot.boxItem("machine")),
            new Offer(1, 500, "Gear Box (random weapon or armour)", () -> Loot.boxItem("gear")),
            new Offer(3, 20_000, "Mega Box (gear or machines, much better odds)", () -> Loot.boxItem("mega")),
            // Weapons and armour
            new Offer(1, 100, "Iron Sword", () -> new ItemStack(Items.IRON_SWORD)),
            new Offer(1, 120, "Iron Axe", () -> new ItemStack(Items.IRON_AXE)),
            new Offer(1, 150, "Bow and 32 Arrows", () -> new ItemStack(Items.BOW), 0, p -> Loot.giveAll(p, Loot.bowKit())),
            new Offer(1, 80, "Shield", () -> new ItemStack(Items.SHIELD)),
            new Offer(1, 400, "Iron Armour Set (4 pieces)", () -> new ItemStack(Items.IRON_CHESTPLATE), 0, p -> Loot.giveAll(p, Loot.ironSet())),
            new Offer(2, 600, "Diamond Sword", () -> new ItemStack(Items.DIAMOND_SWORD)),
            new Offer(2, 350, "Crossbow", () -> new ItemStack(Items.CROSSBOW)),
            new Offer(2, 2500, "Diamond Armour Set (4 pieces)", () -> new ItemStack(Items.DIAMOND_CHESTPLATE), 0, p -> Loot.giveAll(p, Loot.diamondSet())),
            new Offer(2, 3000, "Power V Bow (Infinity, Flame)", Loot::powerBow),
            new Offer(3, 8000, "Sharpness V Diamond Sword", Loot::sharpDiamondSword),
            new Offer(3, 12_000, "Protection IV Diamond Armour Set", () -> Loot.protectedDiamondSet().get(1), 0,
                    p -> Loot.giveAll(p, Loot.protectedDiamondSet())),
            new Offer(3, 30_000, "Trident (Loyalty III)", () -> Loot.enchanted(Items.TRIDENT,
                    net.minecraft.world.item.enchantment.Enchantments.LOYALTY, 3, net.minecraft.world.item.enchantment.Enchantments.IMPALING, 3)),
            new Offer(3, 60_000, "Netherite Sword", () -> new ItemStack(Items.NETHERITE_SWORD)),
            new Offer(3, 200_000, "Netherite Armour Set (4 pieces)", () -> new ItemStack(Items.NETHERITE_CHESTPLATE), 0,
                    p -> Loot.giveAll(p, Loot.netheriteSet())),
            new Offer(1, Roadster.PRICE, "Star Roadster (a flying sports car you can repaint)",
                    Roadster::shopIcon, 0, Roadster::spawn),
            new Offer(2, 800, "Super Upgrader (x3)", () -> named(Items.GLAZED_TERRACOTTA.cyan(), 1, "Super Upgrader x3", ChatFormatting.AQUA)),
            new Offer(2, 500, "2 Diamonds", () -> new ItemStack(Items.DIAMOND, 2)),
            new Offer(2, 300, "Golden Apple", () -> new ItemStack(Items.GOLDEN_APPLE)),
            new Offer(2, 250, "16 Bottles o' Enchanting", () -> new ItemStack(Items.EXPERIENCE_BOTTLE, 16)),
            new Offer(2, 300, "4 Ender Pearls", () -> new ItemStack(Items.ENDER_PEARL, 4)),
            new Offer(3, 5000, "Mega Upgrader (x5)", () -> named(Items.GLAZED_TERRACOTTA.purple(), 1, "Mega Upgrader x5", ChatFormatting.LIGHT_PURPLE)),
            new Offer(3, 25000, "Star Upgrader (x10)", Tycoon::starUpgrader, 1),
            // Big-ticket items for when you're rich.
            new Offer(3, 25_000, "Shulker Box", () -> new ItemStack(Items.SHULKER_BOX)),
            new Offer(3, 50_000, "Mending book", () -> net.minecraft.world.item.EnchantedBookItem.createForEnchantment(
                    new net.minecraft.world.item.enchantment.EnchantmentInstance(net.minecraft.world.item.enchantment.Enchantments.MENDING, 1))),
            new Offer(3, 100_000, "Netherite Ingot", () -> new ItemStack(Items.NETHERITE_INGOT)),
            new Offer(3, 250_000, "Elytra", () -> new ItemStack(Items.ELYTRA)),
            new Offer(3, 500_000, "Beacon", () -> new ItemStack(Items.BEACON)),
            new Offer(3, 1_000_000, "Helper Training (+1 helper level)",
                    () -> named(Items.EXPERIENCE_BOTTLE, 1, "Helper Training", ChatFormatting.AQUA), 0, Tycoon::trainHelper),
            new Offer(3, 3000, "Netherite Scrap", () -> new ItemStack(Items.NETHERITE_SCRAP)),
            new Offer(3, 4000, "Totem of Undying", () -> new ItemStack(Items.TOTEM_OF_UNDYING)),
            new Offer(3, 2500, "Enchanted Golden Apple", () -> new ItemStack(Items.ENCHANTED_GOLDEN_APPLE)),
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
        // Then every other weapon and armour piece in the mod pack, cheapest first.
        java.util.Set<Item> skip = ModGear.soldElsewhere();
        for (ModGear.Gear g : ModGear.all()) {
            if (skip.contains(g.item())) continue;
            list.add(new Offer(g.tier(), g.price(), g.name(), () -> new ItemStack(g.item())));
        }
        return list;
    }

    private static ItemStack adAstra(String id, int count) {
        Identifier key = Identifier.fromNamespaceAndPath("ad_astra", id);
        if (!net.minecraft.core.registries.BuiltInRegistries.ITEM.containsKey(key)) return ItemStack.EMPTY;
        return new ItemStack(net.minecraft.core.registries.BuiltInRegistries.ITEM.get(key), count);
    }

    /**
     * An Ad Astra rocket with a full tank (3 buckets) of cryo fuel, the best fuel: it only burns 1 bucket a launch,
     * so that's 3 launches. Ad Astra keeps an item's fuel in Botarium's NBT: BotariumData.StoredFluids[{Fluid, Amount}],
     * Amount in Fabric droplets (81 per millibucket).
     */
    static ItemStack rocket(int tier) {
        ItemStack stack = adAstra("tier_" + tier + "_rocket", 1);
        if (stack.isEmpty()) return stack;
        CompoundTag fluid = new CompoundTag();
        fluid.putString("Fluid", "ad_astra:cryo_fuel");
        fluid.putLong("Amount", 3000L * 81L);
        ListTag fluids = new ListTag();
        fluids.add(fluid);
        CompoundTag data = new CompoundTag();
        data.put("StoredFluids", fluids);
        stack.getOrCreateTag().put("BotariumData", data);
        return stack;
    }

    private static String lockReason(Offer o) {
        String need = o.tier() == 2 ? "visit the Nether" : o.tier() == 3 ? "reach the End" : "";
        if (o.rebirths() > 0) need = (need.isEmpty() ? "" : need + " and ") + "rebirth at least " + o.rebirths() + " time" + (o.rebirths() == 1 ? "" : "s");
        return need;
    }

    static void openShop(ServerPlayer player) {
        player.openMenu(new SimpleMenuProvider(
                (syncId, inv, p) -> new Shop(syncId, inv, player),
                Component.literal("Tycoon Shop")));
    }

    static final class Shop extends ChestMenu {
        private final ServerPlayer player;
        private static final int SIZE = 54;
        private final SimpleContainer view;
        private final List<Offer> list;
        private static final int PER_PAGE = 45;
        private int page;

        private int pages() {
            return Math.max(1, (list.size() + PER_PAGE - 1) / PER_PAGE);
        }

        private Offer offerAt(int slot) {
            int i = page * PER_PAGE + slot;
            return slot < PER_PAGE && i < list.size() ? list.get(i) : null;
        }

        Shop(int syncId, Inventory inv, ServerPlayer player) {
            this(syncId, inv, player, new SimpleContainer(SIZE));
        }

        private Shop(int syncId, Inventory inv, ServerPlayer player, SimpleContainer view) {
            super(MenuType.GENERIC_9x6, syncId, inv, view, 6);
            this.player = player;
            this.view = view;
            this.list = offers();
            refresh();
        }

        private void refresh() {
            Data data = Data.get(player.level().getServer());
            int tier = tier(player);
            for (int i = 0; i < SIZE; i++) view.setItem(i, ItemStack.EMPTY);
            for (int i = 0; i < PER_PAGE; i++) {
                Offer o = offerAt(i);
                if (o == null) break;
                ItemStack shown = o.item().get();
                boolean open = tier >= o.tier() && data.rebirths(player.getUUID()) >= o.rebirths();
                ItemStack button = Storage.Menu.button(open ? shown.getItem() : Items.BARRIER, o.what(),
                        open ? "Costs " + o.price() + " coins" : "Locked: " + lockReason(o),
                        open ? "Click to buy" : "Costs " + o.price() + " coins once unlocked");
                button.setCount(Math.max(1, shown.getCount()));
                view.setItem(i, button);
            }
            view.setItem(49, Storage.Menu.button(Items.GOLD_INGOT, data.coins(player.getUUID()) + " coins",
                    "Earn coins with Tycoon Droppers", "Tier " + tierName(tier)));
            if (page > 0) view.setItem(45, Storage.Menu.button(Items.ARROW, "Previous page", "Page " + page + " of " + pages(), ""));
            if (page < pages() - 1) view.setItem(53, Storage.Menu.button(Items.SPECTRAL_ARROW, "Next page",
                    "Page " + (page + 2) + " of " + pages(), page == 0 ? "More: weapons, armour, loot boxes" : "Every weapon and armour piece in the pack"));
            broadcastChanges();
        }

        @Override
        public void clicked(int slotIndex, int button, ContainerInput action, Player p) {
            if (slotIndex < 0 || slotIndex >= SIZE) {
                if (action != ContainerInput.QUICK_MOVE) super.clicked(slotIndex, button, action, p);
                return;
            }
            if (action == ContainerInput.PICKUP) {
                Offer o = offerAt(slotIndex);
                if (o != null) buy(o);
                else if (slotIndex == 45 && page > 0) page--;
                else if (slotIndex == 53 && page < pages() - 1) page++;
            }
            refresh();
        }

        private void buy(Offer o) {
            Data data = Data.get(player.level().getServer());
            if (tier(player) < o.tier() || data.rebirths(player.getUUID()) < o.rebirths()) {
                player.sendOverlayMessage(Component.literal("Locked: " + lockReason(o) + ".").withStyle(ChatFormatting.RED));
                return;
            }
            if (data.coins(player.getUUID()) < o.price()) {
                player.sendOverlayMessage(Component.literal("You need " + o.price() + " coins (you have " + data.coins(player.getUUID()) + ").")
                        .withStyle(ChatFormatting.RED));
                return;
            }
            if (o.action() != null) {
                if (!o.action().test(player)) return;
            } else {
                player.getInventory().placeItemBackInInventory(o.item().get());
            }
            data.add(player.getUUID(), -o.price());
            player.playNotifySound(SoundEvents.VILLAGER_YES, SoundSource.PLAYERS, 0.6f, 1.2f);
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
}
