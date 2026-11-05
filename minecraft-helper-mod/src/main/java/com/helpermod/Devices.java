package com.helpermod;

import com.helpermod.mixin.ExperienceOrbAccessor;
import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.block.ShapeContext;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.HopperBlockEntity;
import net.minecraft.block.entity.MobSpawnerBlockEntity;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.ExperienceOrbEntity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.boss.WitherEntity;
import net.minecraft.entity.boss.dragon.EnderDragonEntity;
import net.minecraft.entity.mob.ElderGuardianEntity;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.mob.Monster;
import net.minecraft.entity.mob.WardenEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.ItemPlacementContext;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
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
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.PersistentState;
import net.minecraft.world.World;

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
            mob = be.createNbt().getCompound("SpawnData").getCompound("entity").getString("id");
        }
        ItemStack stack = new ItemStack(Items.SPAWNER);
        String name = "Monster Spawner";
        Identifier id = Identifier.tryParse(mob);
        if (id != null && !mob.isEmpty()) {
            stack.getOrCreateNbt().putString(SPAWNER_MOB_KEY, mob);
            var type = EntityType.get(mob);
            if (type.isPresent()) name = type.get().getName().getString() + " Spawner";
        }
        stack.setCustomName(Text.literal(name).styled(s -> s.withItalic(false)).formatted(Formatting.YELLOW));
        return stack;
    }

    private static ActionResult placeSpawner(ServerPlayerEntity player, ServerWorld world, Hand hand,
                                             ItemStack stack, BlockHitResult hit) {
        ItemPlacementContext ctx = new ItemPlacementContext(player, hand, stack, hit);
        if (!ctx.canPlace()) return ActionResult.FAIL;
        BlockPos pos = ctx.getBlockPos();
        BlockState state = Blocks.SPAWNER.getDefaultState();
        if (!world.canPlace(state, pos, ShapeContext.of(player)) || !world.canPlayerModifyAt(player, pos)) {
            return ActionResult.FAIL;
        }
        world.setBlockState(pos, state);
        if (world.getBlockEntity(pos) instanceof MobSpawnerBlockEntity spawner) {
            EntityType.get(stack.getNbt().getString(SPAWNER_MOB_KEY))
                    .ifPresent(type -> spawner.setEntityType(type, world.getRandom()));
            spawner.markDirty();
            world.updateListeners(pos, state, state, 3);
        }
        world.playSound(null, pos, SoundEvents.BLOCK_STONE_PLACE, SoundCategory.BLOCKS, 1f, 0.8f);
        player.swingHand(hand, true);
        if (!player.isCreative()) stack.decrement(1);
        return ActionResult.SUCCESS;
    }

    // ---------------------------------------------------------------------------------------
    // Monster Harvester
    // ---------------------------------------------------------------------------------------

    public static boolean isHarvesterItem(ItemStack stack) {
        return stack.isOf(Items.HOPPER) && stack.hasCustomName()
                && stack.getName().getString().equals(HARVESTER_NAME);
    }

    public static ItemStack harvesterItem() {
        ItemStack stack = new ItemStack(Items.HOPPER);
        stack.setCustomName(Text.literal(HARVESTER_NAME).styled(s -> s.withItalic(false)).formatted(Formatting.GOLD));
        return stack;
    }

    /** /helper harvester: turn a hopper in your hand into a Monster Harvester. */
    public static void craftHarvester(ServerPlayerEntity player) {
        ItemStack held = player.getMainHandStack();
        if (!held.isOf(Items.HOPPER) || isHarvesterItem(held)) {
            Helper.say(player, "Hold a hopper in your hand and run /helper harvester again. "
                    + "I'll turn it into a Monster Harvester.");
            return;
        }
        if (!player.isCreative()) held.decrement(1);
        player.getInventory().offerOrDrop(harvesterItem());
        Helper.say(player, "Here's your Monster Harvester! Place it right below where the spawner's monsters "
                + "appear (within " + RANGE + " blocks) and put a chest under it for the loot. "
                + "Sneak + right-click it to collect the XP.");
    }

    private record Pending(RegistryKey<World> world, BlockPos pos, UUID player, int ticks) {}

    private static final List<Pending> PENDING = new ArrayList<>();

    public static void reset() {
        PENDING.clear();
    }

    /** All block right-clicks: placing spawners and harvesters, and collecting harvester XP. */
    public static ActionResult onUseBlock(PlayerEntity p, World w, Hand hand, BlockHitResult hit) {
        if (w.isClient || !(p instanceof ServerPlayerEntity player) || !(w instanceof ServerWorld world)) {
            return ActionResult.PASS;
        }
        if (p instanceof FakePlayer) return ActionResult.PASS;
        ItemStack stack = player.getStackInHand(hand);
        BlockPos clicked = hit.getBlockPos();
        HarvesterData data = HarvesterData.get(world.getServer());

        if (player.isSneaking() && data.has(world, clicked)) {
            if (hand != Hand.MAIN_HAND) return ActionResult.SUCCESS;
            int xp = data.take(world, clicked);
            if (xp <= 0) {
                player.sendMessage(Text.literal("No XP stored yet.").formatted(Formatting.GRAY), true);
            } else {
                int before = player.experienceLevel;
                player.addExperience(xp);
                world.playSound(null, player.getBlockPos(), player.experienceLevel > before
                                ? SoundEvents.ENTITY_PLAYER_LEVELUP : SoundEvents.ENTITY_EXPERIENCE_ORB_PICKUP,
                        SoundCategory.PLAYERS, 0.8f, 1f);
                player.sendMessage(Text.literal("Collected " + xp + " XP from the Monster Harvester!")
                        .formatted(Formatting.GREEN), true);
            }
            return ActionResult.SUCCESS;
        }
        if ((!player.isSneaking() || stack.isEmpty()) && Storage.isStorageBlock(world, clicked)) {
            if (hand == Hand.MAIN_HAND) Storage.open(player);
            return ActionResult.SUCCESS;
        }
        if (stack.isOf(Items.SPAWNER) && stack.hasNbt() && stack.getNbt().contains(SPAWNER_MOB_KEY)) {
            return placeSpawner(player, world, hand, stack, hit);
        }
        if (isHarvesterItem(stack)) {
            BlockPos pos = new ItemPlacementContext(player, hand, stack, hit).getBlockPos();
            PENDING.add(new Pending(world.getRegistryKey(), pos.toImmutable(), player.getUuid(), 0));
        }
        return ActionResult.PASS; // let the game place the hopper normally
    }

    public static void tick(MinecraftServer server) {
        HarvesterData data = HarvesterData.get(server);
        // Harvesters placed last tick: register them once the hopper is really there.
        for (int i = PENDING.size() - 1; i >= 0; i--) {
            Pending pending = PENDING.get(i);
            ServerWorld world = server.getWorld(pending.world());
            if (world != null && world.getBlockState(pending.pos()).isOf(Blocks.HOPPER)) {
                data.add(world, pending.pos());
                ServerPlayerEntity player = server.getPlayerManager().getPlayer(pending.player());
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
        if (server.getTicks() % 10 != 0) return;
        data.forEach(server, Devices::tickHarvester);
    }

    /** Returns false if the harvester is gone (broken). */
    private static boolean tickHarvester(ServerWorld world, BlockPos pos, int[] xp) {
        if (!world.isChunkLoaded(pos)) return true;
        if (!(world.getBlockEntity(pos) instanceof HopperBlockEntity hopper)) {
            if (xp[0] > 0) ExperienceOrbEntity.spawn(world, Vec3d.ofCenter(pos), xp[0]); // don't lose stored XP
            return false;
        }
        Box area = new Box(pos.add(-RANGE, -1, -RANGE), pos.add(RANGE + 1, RANGE + 2, RANGE + 1));
        FakePlayer killer = FakePlayer.get(world);
        for (MobEntity mob : world.getEntitiesByClass(MobEntity.class, area, Devices::isHarvestable)) {
            mob.damage(world.getDamageSources().playerAttack(killer), Float.MAX_VALUE);
        }
        for (ItemEntity item : world.getEntitiesByClass(ItemEntity.class, area, Entity::isAlive)) {
            ItemStack rest = HopperBlockEntity.transfer(null, hopper, item.getStack().copy(), null);
            if (rest.isEmpty()) item.discard();
            else item.setStack(rest);
        }
        for (ExperienceOrbEntity orb : world.getEntitiesByClass(ExperienceOrbEntity.class, area, Entity::isAlive)) {
            xp[0] += orb.getExperienceAmount() * Math.max(1, ((ExperienceOrbAccessor) orb).helpermod$getPickingCount());
            orb.discard();
        }
        return true;
    }

    private static boolean isHarvestable(MobEntity mob) {
        if (!(mob instanceof Monster) || !mob.isAlive() || mob.hasCustomName()) return false;
        if (mob.getCommandTags().contains(Helper.TAG)) return false;
        return !(mob instanceof WitherEntity || mob instanceof EnderDragonEntity || mob instanceof WardenEntity
                || mob instanceof ElderGuardianEntity);
    }

    /** Where the harvesters are, and how much XP each is holding. Saved with the world. */
    public static final class HarvesterData extends PersistentState {
        private static final String ID = "helpermod_harvesters";
        private final Map<String, int[]> harvesters = new LinkedHashMap<>();

        public static HarvesterData get(MinecraftServer server) {
            return server.getOverworld().getPersistentStateManager()
                    .getOrCreate(HarvesterData::fromNbt, HarvesterData::new, ID);
        }

        private static String key(World world, BlockPos pos) {
            return world.getRegistryKey().getValue() + "|" + pos.asLong();
        }

        boolean has(World world, BlockPos pos) {
            return harvesters.containsKey(key(world, pos));
        }

        void add(World world, BlockPos pos) {
            harvesters.putIfAbsent(key(world, pos), new int[]{0});
            markDirty();
        }

        int take(World world, BlockPos pos) {
            int[] xp = harvesters.get(key(world, pos));
            if (xp == null) return 0;
            int amount = xp[0];
            xp[0] = 0;
            markDirty();
            return amount;
        }

        interface Visitor {
            boolean visit(ServerWorld world, BlockPos pos, int[] xp);
        }

        void forEach(MinecraftServer server, Visitor visitor) {
            for (Iterator<Map.Entry<String, int[]>> it = harvesters.entrySet().iterator(); it.hasNext(); ) {
                Map.Entry<String, int[]> e = it.next();
                String[] parts = e.getKey().split("\\|");
                Identifier dim = Identifier.tryParse(parts[0]);
                ServerWorld world = dim == null ? null : server.getWorld(RegistryKey.of(RegistryKeys.WORLD, dim));
                if (world == null) continue;
                int before = e.getValue()[0];
                if (!visitor.visit(world, BlockPos.fromLong(Long.parseLong(parts[1])), e.getValue())) {
                    it.remove();
                    markDirty();
                } else if (e.getValue()[0] != before) {
                    markDirty();
                }
            }
        }

        private static HarvesterData fromNbt(NbtCompound nbt) {
            HarvesterData data = new HarvesterData();
            NbtList list = nbt.getList("harvesters", NbtElement.COMPOUND_TYPE);
            for (int i = 0; i < list.size(); i++) {
                NbtCompound tag = list.getCompound(i);
                data.harvesters.put(tag.getString("key"), new int[]{tag.getInt("xp")});
            }
            return data;
        }

        @Override
        public NbtCompound writeNbt(NbtCompound nbt) {
            NbtList list = new NbtList();
            harvesters.forEach((key, xp) -> {
                NbtCompound tag = new NbtCompound();
                tag.putString("key", key);
                tag.putInt("xp", xp[0]);
                list.add(tag);
            });
            nbt.put("harvesters", list);
            return nbt;
        }
    }
}
