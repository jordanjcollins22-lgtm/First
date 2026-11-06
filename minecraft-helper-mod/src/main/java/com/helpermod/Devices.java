package com.helpermod;

import com.helpermod.mixin.ExperienceOrbAccessor;
import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
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
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.ExperienceOrb;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.boss.enderdragon.EnderDragon;
import net.minecraft.world.entity.boss.wither.WitherBoss;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.monster.ElderGuardian;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.entity.monster.warden.Warden;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.HopperBlockEntity;
import net.minecraft.world.level.block.entity.SpawnerBlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraft.world.phys.shapes.CollisionContext;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Spawners the helper digs up (they remember their mob), and the Monster Harvester: a hopper that
 * kills monsters around it, sends their loot down into a chest and stores their XP for you.
 */
public final class Devices {
    private Devices() {}

    public static final String HARVESTER_NAME = "Monster Harvester";
    private static final String SPAWNER_MOB_KEY = "HelperSpawnerMob";
    private static final int RANGE = 4;

    // ---------------------------------------------------------------------------------------
    // Spawners
    // ---------------------------------------------------------------------------------------

    /** The item a helper gets from mining a spawner: placing it gives back the same spawner. */
    public static ItemStack spawnerItem(BlockEntity be) {
        String mob = "";
        if (be != null) {
            mob = be.saveWithoutMetadata(be.getLevel().registryAccess()).getCompoundOrEmpty("SpawnData").getCompoundOrEmpty("entity").getStringOr("id", "");
        }
        ItemStack stack = new ItemStack(Items.SPAWNER);
        String name = "Monster Spawner";
        Identifier id = Identifier.tryParse(mob);
        if (id != null && !mob.isEmpty()) {
            Compat.editTag(stack, t -> t.putString(SPAWNER_MOB_KEY, mob));
            var type = Compat.entityType(mob);
            if (type.isPresent()) name = type.get().getDescription().getString() + " Spawner";
        }
        stack.set(net.minecraft.core.component.DataComponents.CUSTOM_NAME, Component.literal(name).withStyle(s -> s.withItalic(false)).withStyle(ChatFormatting.YELLOW));
        return stack;
    }

    private static InteractionResult placeSpawner(ServerPlayer player, ServerLevel world, InteractionHand hand,
                                             ItemStack stack, BlockHitResult hit) {
        BlockPlaceContext ctx = new BlockPlaceContext(player, hand, stack, hit);
        if (!ctx.canPlace()) return InteractionResult.FAIL;
        BlockPos pos = ctx.getClickedPos();
        BlockState state = Blocks.SPAWNER.defaultBlockState();
        if (!world.isUnobstructed(state, pos, CollisionContext.of(player)) || !world.mayInteract(player, pos)) {
            return InteractionResult.FAIL;
        }
        world.setBlockAndUpdate(pos, state);
        if (world.getBlockEntity(pos) instanceof SpawnerBlockEntity spawner) {
            Compat.entityType(Compat.tag(stack).getStringOr(SPAWNER_MOB_KEY, ""))
                    .ifPresent(type -> spawner.setEntityId(type, world.getRandom()));
            spawner.setChanged();
            world.sendBlockUpdated(pos, state, state, 3);
        }
        world.playSound(null, pos, SoundEvents.STONE_PLACE, SoundSource.BLOCKS, 1f, 0.8f);
        Compat.swing(player, hand);
        if (!player.isCreative()) stack.shrink(1);
        return InteractionResult.SUCCESS;
    }

    // ---------------------------------------------------------------------------------------
    // Monster Harvester
    // ---------------------------------------------------------------------------------------

    public static boolean isHarvesterItem(ItemStack stack) {
        return stack.is(Items.HOPPER) && stack.has(net.minecraft.core.component.DataComponents.CUSTOM_NAME)
                && stack.getHoverName().getString().equals(HARVESTER_NAME);
    }

    public static ItemStack harvesterItem() {
        ItemStack stack = new ItemStack(Items.HOPPER);
        stack.set(net.minecraft.core.component.DataComponents.CUSTOM_NAME, Component.literal(HARVESTER_NAME).withStyle(s -> s.withItalic(false)).withStyle(ChatFormatting.GOLD));
        return stack;
    }

    /** /helper harvester: turn a hopper in your hand into a Monster Harvester. */
    public static void craftHarvester(ServerPlayer player) {
        ItemStack held = player.getMainHandItem();
        if (!held.is(Items.HOPPER) || isHarvesterItem(held)) {
            Helper.say(player, "Hold a hopper in your hand and run /helper harvester again. "
                    + "I'll turn it into a Monster Harvester.");
            return;
        }
        if (!player.isCreative()) held.shrink(1);
        player.getInventory().placeItemBackInInventory(harvesterItem(), net.minecraft.util.Prediction.SERVER_ONLY);
        Helper.say(player, "Here's your Monster Harvester! Place it right below where the spawner's monsters "
                + "appear (within " + RANGE + " blocks) and put a chest under it for the loot. "
                + "Sneak + right-click it to collect the XP.");
    }

    private record Pending(ResourceKey<Level> world, BlockPos pos, UUID player, int ticks) {}

    private static final List<Pending> PENDING = new ArrayList<>();

    public static void reset() {
        PENDING.clear();
    }

    /** All block right-clicks: placing spawners and harvesters, and collecting harvester XP. */
    public static InteractionResult onUseBlock(Player p, Level w, InteractionHand hand, BlockHitResult hit) {
        if (w.isClientSide() || !(p instanceof ServerPlayer player) || !(w instanceof ServerLevel world)) {
            return InteractionResult.PASS;
        }
        if (p instanceof FakePlayer) return InteractionResult.PASS;
        ItemStack stack = player.getItemInHand(hand);
        BlockPos clicked = hit.getBlockPos();
        HarvesterData data = HarvesterData.get(world.getServer());

        if (player.isShiftKeyDown() && data.has(world, clicked)) {
            if (hand != InteractionHand.MAIN_HAND) return InteractionResult.SUCCESS;
            int xp = data.take(world, clicked);
            if (xp <= 0) {
                player.sendOverlayMessage(Component.literal("No XP stored yet.").withStyle(ChatFormatting.GRAY));
            } else {
                int before = player.experienceLevel;
                player.giveExperiencePoints(xp);
                world.playSound(null, player.blockPosition(), player.experienceLevel > before
                                ? SoundEvents.PLAYER_LEVELUP : SoundEvents.EXPERIENCE_ORB_PICKUP,
                        SoundSource.PLAYERS, 0.8f, 1f);
                player.sendOverlayMessage(Component.literal("Collected " + xp + " XP from the Monster Harvester!")
                        .withStyle(ChatFormatting.GREEN));
            }
            return InteractionResult.SUCCESS;
        }
        if ((!player.isShiftKeyDown() || stack.isEmpty()) && Storage.isStorageBlock(world, clicked)) {
            if (hand == InteractionHand.MAIN_HAND) Storage.open(player);
            return InteractionResult.SUCCESS;
        }
        if (stack.is(Items.SPAWNER) && Compat.hasTag(stack) && Compat.tag(stack).contains(SPAWNER_MOB_KEY)) {
            return placeSpawner(player, world, hand, stack, hit);
        }
        if (isHarvesterItem(stack)) {
            BlockPos pos = new BlockPlaceContext(player, hand, stack, hit).getClickedPos();
            PENDING.add(new Pending(world.dimension(), pos.immutable(), player.getUUID(), 0));
        }
        return InteractionResult.PASS; // let the game place the hopper normally
    }

    public static void tick(MinecraftServer server) {
        HarvesterData data = HarvesterData.get(server);
        // Harvesters placed last tick: register them once the hopper is really there.
        for (int i = PENDING.size() - 1; i >= 0; i--) {
            Pending pending = PENDING.get(i);
            ServerLevel world = server.getLevel(pending.world());
            if (world != null && world.getBlockState(pending.pos()).is(Blocks.HOPPER)) {
                data.add(world, pending.pos());
                ServerPlayer player = server.getPlayerList().getPlayer(pending.player());
                if (player != null) {
                    Helper.say(player, "Monster Harvester placed. It kills monsters within " + RANGE
                            + " blocks, sends the loot into a chest below it, and stores the XP. "
                            + "Sneak + right-click it to collect.");
                }
                PENDING.remove(i);
            } else if (pending.ticks() > 5) {
                PENDING.remove(i);
            } else {
                PENDING.set(i, new Pending(pending.world(), pending.pos(), pending.player(), pending.ticks() + 1));
            }
        }
        if (server.getTickCount() % 10 != 0) return;
        data.forEach(server, Devices::tickHarvester);
    }

    /** Returns false if the harvester is gone (broken). */
    private static boolean tickHarvester(ServerLevel world, BlockPos pos, int[] xp) {
        if (!world.hasChunkAt(pos)) return true;
        if (!(world.getBlockEntity(pos) instanceof HopperBlockEntity hopper)) {
            if (xp[0] > 0) ExperienceOrb.award(world, Vec3.atCenterOf(pos), xp[0]); // don't lose stored XP
            return false;
        }
        AABB area = AABB.encapsulatingFullBlocks(pos.offset(-RANGE, -1, -RANGE), pos.offset(RANGE, RANGE + 1, RANGE));
        FakePlayer killer = FakePlayer.get(world);
        for (Mob mob : world.getEntitiesOfClass(Mob.class, area, Devices::isHarvestable)) {
            mob.hurt(world.damageSources().playerAttack(killer), Float.MAX_VALUE);
        }
        for (ItemEntity item : world.getEntitiesOfClass(ItemEntity.class, area, Entity::isAlive)) {
            ItemStack rest = HopperBlockEntity.addItem(null, hopper, item.getItem().copy(), null);
            if (rest.isEmpty()) item.discard();
            else item.setItem(rest);
        }
        for (ExperienceOrb orb : world.getEntitiesOfClass(ExperienceOrb.class, area, Entity::isAlive)) {
            xp[0] += orb.getValue() * Math.max(1, ((ExperienceOrbAccessor) orb).helpermod$getPickingCount());
            orb.discard();
        }
        return true;
    }

    private static boolean isHarvestable(Mob mob) {
        if (!(mob instanceof Enemy) || !mob.isAlive() || mob.hasCustomName()) return false;
        if (mob.entityTags().contains(Helper.TAG)) return false;
        return !(mob instanceof WitherBoss || mob instanceof EnderDragon || mob instanceof Warden
                || mob instanceof ElderGuardian);
    }

    /** Where the harvesters are, and how much XP each is holding. Saved with the world. */
    public static final class HarvesterData extends SavedData {
        private static final String ID = "helpermod_harvesters";
        private static final SavedDataType<HarvesterData> TYPE = Compat.dataType(ID, HarvesterData::new, HarvesterData::fromNbt, d -> d.save(new CompoundTag()));
        private final Map<String, int[]> harvesters = new LinkedHashMap<>();

        public static HarvesterData get(MinecraftServer server) {
            return server.overworld().getDataStorage()
                    .computeIfAbsent(TYPE);
        }

        private static String key(Level world, BlockPos pos) {
            return world.dimension().identifier() + "|" + pos.asLong();
        }

        boolean has(Level world, BlockPos pos) {
            return harvesters.containsKey(key(world, pos));
        }

        void add(Level world, BlockPos pos) {
            harvesters.putIfAbsent(key(world, pos), new int[]{0});
            setDirty();
        }

        int take(Level world, BlockPos pos) {
            int[] xp = harvesters.get(key(world, pos));
            if (xp == null) return 0;
            int amount = xp[0];
            xp[0] = 0;
            setDirty();
            return amount;
        }

        interface Visitor {
            boolean visit(ServerLevel world, BlockPos pos, int[] xp);
        }

        void forEach(MinecraftServer server, Visitor visitor) {
            for (Iterator<Map.Entry<String, int[]>> it = harvesters.entrySet().iterator(); it.hasNext(); ) {
                Map.Entry<String, int[]> e = it.next();
                String[] parts = e.getKey().split("\\|");
                Identifier dim = Identifier.tryParse(parts[0]);
                ServerLevel world = dim == null ? null : server.getLevel(ResourceKey.create(Registries.DIMENSION, dim));
                if (world == null) continue;
                int before = e.getValue()[0];
                if (!visitor.visit(world, BlockPos.of(Long.parseLong(parts[1])), e.getValue())) {
                    it.remove();
                    setDirty();
                } else if (e.getValue()[0] != before) {
                    setDirty();
                }
            }
        }

        private static HarvesterData fromNbt(CompoundTag nbt) {
            HarvesterData data = new HarvesterData();
            ListTag list = nbt.getListOrEmpty("harvesters");
            for (int i = 0; i < list.size(); i++) {
                CompoundTag tag = list.getCompoundOrEmpty(i);
                data.harvesters.put(tag.getStringOr("key", ""), new int[]{tag.getIntOr("xp", 0)});
            }
            return data;
        }

                public CompoundTag save(CompoundTag nbt) {
            ListTag list = new ListTag();
            harvesters.forEach((key, xp) -> {
                CompoundTag tag = new CompoundTag();
                tag.putString("key", key);
                tag.putInt("xp", xp[0]);
                list.add(tag);
            });
            nbt.put("harvesters", list);
            return nbt;
        }
    }
}
