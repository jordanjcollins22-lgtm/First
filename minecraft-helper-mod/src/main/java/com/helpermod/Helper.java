package com.helpermod;

import com.helpermod.mixin.ExperienceOrbAccessor;
import com.helpermod.mixin.MobEntityAccessor;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.SectionPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerChunkCache;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.level.TicketType;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.tags.BlockTags;
import net.minecraft.tags.FluidTags;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.ExperienceOrb;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.ai.goal.LookAtPlayerGoal;
import net.minecraft.world.entity.npc.wanderingtrader.WanderingTrader;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;
import net.minecraft.world.level.chunk.LevelChunkSection;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.pathfinder.Path;
import net.minecraft.world.phys.Vec3;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** The brain of one player's helper. */
public class Helper {
    public static final String TAG = "helpermod.helper";
    public static final String OWNER_TAG = "helpermod.owner:";
    public static final String NAME_TAG = "helpermod.name:";
    private static final boolean DEBUG = Boolean.getBoolean("helpermod.debug");

    private static final double REACH_SQ = 4.75 * 4.75;
    private static final double SPEED = 0.6;
    private static final int[][] SCAN_RADII = {{24, 16}, {48, 32}, {80, 48}, {48, 384}};
    private static final int MAX_CANDIDATES = 4000;
    private static final int PATH_CHECKS = 6;
    /** Building blocks the helper keeps after a delivery so it can bridge and climb next time. */
    private static final int KEEP_BUILDING_BLOCKS = 32;
    /** Far search: chunk rings (16 blocks each) beyond what's already loaded. */
    private static final int FAR_START_RING = 4;
    private static final int FAR_MAX_RING = 64;
    private static final int FAR_PARALLEL = 8;
    /** Past this horizontal distance the helper walks over land toward the target before digging. */
    private static final double TRAVEL_DISTANCE = 40;
    private static final TicketType<ChunkPos> SEARCH_TICKET =
            TicketType.create("helpermod_search", Comparator.comparingLong(ChunkPos::toLong), 300);
    private static final TicketType<ChunkPos> KEEP_LOADED_TICKET =
            TicketType.create("helpermod_helper", Comparator.comparingLong(ChunkPos::toLong), 80);

    enum Mode { FOLLOW, COLLECT, RETURN, FISH, FARM, SEND }

    enum MineState { NONE, DESCEND, WORK }

    /** Spiral staircase: 2x2 footprint, one block down per step, 3 blocks of headroom. */
    private static final int[][] SPIRAL = {{0, 0}, {1, 0}, {1, 1}, {0, 1}};
    private static final int LANDING_EVERY = 4;
    /** Branch tunnels off each landing: straight, 2 tall, this long (twice as long at the bottom). */
    private static final int BRANCH_LENGTH = 16;
    /** Ore this close to a branch's line counts toward digging that branch. */
    private static final int BRANCH_REACH = 4;

    private final UUID owner;
    private Mob mob;
    private HelperData.Entry currentEntry;
    /** Which stair step the helper is standing on (-1 = not in the mine). */
    private int mineStep = -1;
    /** The stair step it left from to mine off a landing (-1 = not in a side tunnel). */
    private int branchFrom = -1;
    private int stairTicks;
    private int returnTicks;
    /** Set by /helper deliver: bring the haul to the player even when there's a Helper Storage nearby. */
    private boolean toPlayer;
    private BlockPos storagePos;
    private long storageScanAt;
    private int missingTicks;
    private boolean toldFlight;
    private String lastPlanet = "";
    private int repathCooldown;
    private LivingEntity combatTarget;
    private int combatTicks;
    private int attackCooldown;
    private int combatScan;
    private int gearTicks;
    /** Ticks left in the little dance it does after a delivery. */
    private int danceTicks;
    private int lastProgressTick;
    private double closestSoFar;
    private final Set<UUID> ignoredTargets = new HashSet<>();
    private int ignoreClearTicks;
    private int stuckTicks;
    private Vec3 lastPos = Vec3.ZERO;
    /** Items it's taking to another player (/helper send), who they're for, and how long it's been going. */
    private final List<ItemStack> parcel = new ArrayList<>();
    private UUID sendTo;
    private String sendToName = "";
    private int sendTicks;
    Mode mode = Mode.FOLLOW;
    Job job;

    /** The helper's mob while it's out in the world, or null. */
    Mob mobEntity() {
        return mob;
    }

    boolean isFighting() {
        return combatTarget != null;
    }

    static final class Job {
        final Materials.Spec spec;
        final int wanted;
        int collected;
        boolean done;

        final List<BlockPos> candidates = new ArrayList<>();
        int scanStage = -1;
        final Deque<BlockPos> vein = new ArrayDeque<>();
        final Set<BlockPos> blacklist = new HashSet<>();

        BlockPos target;
        boolean tunneling;
        int targetTicks;
        int pathFailures;

        BlockPos stepCell;
        int stepTicks;

        BlockPos breaking;
        int breakTotal;
        int breakProgress;
        int breakSlot;
        int lastStage;
        boolean breakingTarget;

        boolean toldAboutHands;

        int farRing = -1;
        ChunkPos farOrigin;
        final Deque<ChunkPos> farQueue = new ArrayDeque<>();
        final Set<ChunkPos> farPending = new HashSet<>();
        boolean toldFarSearch;

        int travelFailures;
        Vec3 travelFrom;

        /** Using the mine: NONE = normal gathering; DESCEND = on the stairs; WORK = mining off a landing. */
        MineState mineState = MineState.NONE;
        int mineTargetY;
        boolean landingScanned;
        int doneLanding = -1;
        /** Branch mining off the current landing: directions still to dig, and the tunnel being dug now. */
        final Deque<Direction> branchQueue = new ArrayDeque<>();
        /** Out of ore at the bottom of the mine: strip-mine further out (longer, blind branches) instead of giving up. */
        int stripRounds;
        int lengthBonus;
        boolean blind;
        Direction branchDir;
        int branchLen;
        int branchTicks;
        /** Openings of shafts we dug from the surface, plugged afterwards so nobody falls in. */
        final Set<BlockPos> shaftTops = new HashSet<>();

        Job(Materials.Spec spec, int wanted) {
            this.spec = spec;
            this.wanted = wanted;
        }

        void resetSearch() {
            candidates.clear();
            scanStage = -1;
            vein.clear();
            target = null;
            stepCell = null;
            breaking = null;
            farRing = -1;
            farQueue.clear();
            farPending.clear();
            travelFailures = 0;
            travelFrom = null;
            mineState = MineState.NONE;
            landingScanned = false;
            doneLanding = -1;
            branchQueue.clear();
            branchDir = null;
        }
    }

    public Helper(UUID owner) {
        this.owner = owner;
    }

    // ---------------------------------------------------------------------------------------
    // Entity handling
    // ---------------------------------------------------------------------------------------

    public static String ownerNameOf(Entity entity) {
        for (String tag : entity.entityTags()) {
            if (tag.startsWith(NAME_TAG)) return tag.substring(NAME_TAG.length());
        }
        String name = entity.getName().getString();
        return name.endsWith("'s Helper") ? name.substring(0, name.length() - 9) : "Helper";
    }

    public static UUID ownerOf(Entity entity) {
        for (String tag : entity.entityTags()) {
            if (tag.startsWith(OWNER_TAG)) {
                try {
                    return UUID.fromString(tag.substring(OWNER_TAG.length()));
                } catch (IllegalArgumentException ignored) {
                    return null;
                }
            }
        }
        return null;
    }

    /** Strip the vanilla AI so only this mod moves the helper. Called on spawn and on every load. */
    public static void applyBrain(Mob mob) {
        MobEntityAccessor accessor = (MobEntityAccessor) mob;
        accessor.helpermod$getGoalSelector().removeAllGoals(goal -> true);
        accessor.helpermod$getTargetSelector().removeAllGoals(goal -> true);
        accessor.helpermod$getGoalSelector().addGoal(8, new LookAtPlayerGoal(mob, Player.class, 8f));
        mob.getNavigation().setCanFloat(true);
        mob.setPersistenceRequired();
        ((com.helpermod.mixin.EntityAccessor) mob).helpermod$setInvulnerable(true);
        mob.setSilent(true);
        if (mob instanceof WanderingTrader trader) trader.setDespawnDelay(0);
        for (EquipmentSlot slot : EquipmentSlot.values()) mob.setDropChance(slot, 0f);
        AttributeInstance range = mob.getAttribute(Attributes.FOLLOW_RANGE);
        if (range != null) range.setBaseValue(64);
    }

    Mob findEntity(MinecraftServer server, HelperData.Entry entry) {
        if (entry.entity == null) return null;
        if (mob != null && !mob.isRemoved() && mob.getUUID().equals(entry.entity)) return mob;
        mob = null;
        for (ServerLevel world : server.getAllLevels()) {
            Entity e = world.getEntity(entry.entity);
            if (e instanceof Mob m && !m.isRemoved()) {
                mob = m;
                break;
            }
        }
        return mob;
    }

    /** Spawn (or move) the helper right next to the player. */
    void spawnNear(ServerPlayer player, HelperData.Entry entry) {
        MinecraftServer server = player.level().getServer();
        Disguise.prepare(player);
        Mob existing = findEntity(server, entry);
        ServerLevel world = player.level();
        Vec3 spot = findSpotNear(world, player.blockPosition());
        if (existing != null && existing.level() == world) {
            clearBreaking(existing);
            existing.getNavigation().stop();
            existing.teleportTo(spot.x, spot.y, spot.z);
            mineStep = -1;
            branchFrom = -1;
            entry.active = true;
            if (job != null) job.resetSearch();
            return;
        }
        if (existing != null) {
            clearBreaking(existing);
            existing.discard();
        }
        WanderingTrader helper = EntityTypes.WANDERING_TRADER.create(world);
        if (helper == null) return;
        mineStep = -1;
        branchFrom = -1;
        helper.snapTo(spot.x, spot.y, spot.z, player.getYRot() + 180f, 0f);
        helper.setCustomName(Component.literal(player.getGameProfile().name() + "'s Helper"));
        helper.setCustomNameVisible(true);
        helper.addTag(TAG);
        helper.addTag(OWNER_TAG + owner);
        helper.addTag(NAME_TAG + player.getGameProfile().name());
        applyBrain(helper);
        if (entry.size != 1f) Size.apply(helper, entry.size);
        entry.entity = helper.getUUID();
        entry.active = true;
        HelperData.get(server).setDirty();
        mob = helper;
        world.addFreshEntity(helper);
        world.playSound(null, helper.blockPosition(), SoundEvents.ILLUSIONER_MIRROR_MOVE, SoundSource.NEUTRAL,
                0.6f, 1.4f);
        if (job != null) job.resetSearch();
    }

    /** Replace the helper entity with a fresh one in the same spot (used to refresh its skin). */
    void respawnInPlace(MinecraftServer server, HelperData.Entry entry) {
        Mob old = findEntity(server, entry);
        ServerPlayer player = server.getPlayerList().getPlayer(owner);
        if (old == null || player == null) return;
        clearBreaking(old);
        ServerLevel world = (ServerLevel) old.level();
        Vec3 pos = old.position();
        float yaw = old.getYRot();
        old.discard();
        mob = null;
        WanderingTrader helper = EntityTypes.WANDERING_TRADER.create(world);
        if (helper == null) return;
        helper.snapTo(pos.x, pos.y, pos.z, yaw, 0f);
        helper.setCustomName(Component.literal(player.getGameProfile().name() + "'s Helper"));
        helper.setCustomNameVisible(true);
        helper.addTag(TAG);
        helper.addTag(OWNER_TAG + owner);
        helper.addTag(NAME_TAG + player.getGameProfile().name());
        applyBrain(helper);
        if (entry.size != 1f) Size.apply(helper, entry.size);
        entry.entity = helper.getUUID();
        HelperData.get(server).setDirty();
        mob = helper;
        world.addFreshEntity(helper);
        gearTicks = 0;
    }

    void dismiss(MinecraftServer server, HelperData.Entry entry) {
        ServerPlayer ownerPlayer = server.getPlayerList().getPlayer(owner);
        if (ownerPlayer != null) cancelSend(ownerPlayer, "I'll hold off on that delivery. Here it is back.");
        else saveParcel(server);
        Mob m = findEntity(server, entry);
        if (m != null) {
            clearBreaking(m);
            m.discard();
        }
        mob = null;
        job = null;
        mode = Mode.FOLLOW;
        entry.active = false;
        HelperData.get(server).setDirty();
    }

    private static Vec3 findSpotNear(ServerLevel world, BlockPos center) {
        for (int r = 1; r <= 3; r++) {
            for (int dx = -r; dx <= r; dx++) {
                for (int dz = -r; dz <= r; dz++) {
                    for (int dy = -1; dy <= 1; dy++) {
                        BlockPos p = center.offset(dx, dy, dz);
                        if (canStand(world, p)) return Vec3.atBottomCenterOf(p);
                    }
                }
            }
        }
        return Vec3.atBottomCenterOf(center);
    }

    private static boolean canStand(Level world, BlockPos p) {
        return passable(world, p) && passable(world, p.above())
                && world.getBlockState(p.below()).isFaceSturdy(world, p.below(), Direction.UP);
    }

    private static boolean passable(Level world, BlockPos p) {
        BlockState s = world.getBlockState(p);
        return s.getCollisionShape(world, p).isEmpty() && !s.getFluidState().is(FluidTags.LAVA);
    }

    // ---------------------------------------------------------------------------------------
    // Commands
    // ---------------------------------------------------------------------------------------

    void startJob(ServerPlayer player, Materials.Spec spec, int amount) {
        if (mob != null) clearBreaking(mob);
        job = new Job(spec, amount);
        mode = Mode.COLLECT;
        say(player, "On it! Going to collect " + amount + " " + spec.display + ".");
    }

    // ---------------------------------------------------------------------------------------
    // Fishing: /helper fish [amount]. Needs a fishing rod in its inventory.
    // ---------------------------------------------------------------------------------------

    private int fishWanted, fishCaught, fishTimer, fishWalkTicks;
    private BlockPos fishSpot, fishStand;

    void startFishing(ServerPlayer player, int amount) {
        if (mob != null) clearBreaking(mob);
        job = null;
        fishWanted = amount;
        fishCaught = 0;
        fishSpot = null;
        fishStand = null;
        fishTimer = 0;
        mode = Mode.FISH;
        say(player, "Gone fishing! I'll catch " + amount + " things for you. Make sure I have a fishing rod "
                + "(right-click me to give me one).");
    }

    private static int rodSlot(SimpleContainer inv) {
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack s = inv.getItem(i);
            if (s.getItem() instanceof net.minecraft.world.item.FishingRodItem && s.getDamageValue() < s.getMaxDamage() - 1) return i;
        }
        return -1;
    }

    /** The nearest open water (a water block with air above), and a dry spot right next to it to stand on. */
    private static BlockPos[] findWater(ServerLevel world, BlockPos from) {
        BlockPos best = null, stand = null;
        double bestD = Double.MAX_VALUE;
        BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
        for (int dx = -24; dx <= 24; dx++) for (int dz = -24; dz <= 24; dz++) for (int dy = -6; dy <= 4; dy++) {
            p.set(from.getX() + dx, from.getY() + dy, from.getZ() + dz);
            if (!world.getFluidState(p).is(net.minecraft.tags.FluidTags.WATER)
                    || !world.getFluidState(p).isSource() || !world.getBlockState(p.above()).isAir()) continue;
            double d = dx * dx + dz * dz + dy * dy * 4;
            if (d >= bestD) continue;
            for (Direction side : Direction.Plane.HORIZONTAL) {
                BlockPos land = p.relative(side); // stand on the bank, level with the water's surface
                BlockPos feet = land.above();
                if (world.getBlockState(land).isRedstoneConductor(world, land) && world.getBlockState(feet).isAir()
                        && world.getBlockState(feet.above()).isAir()) {
                    best = p.immutable();
                    stand = feet.immutable();
                    bestD = d;
                    break;
                }
            }
        }
        return best == null ? null : new BlockPos[]{best, stand};
    }

    private void tickFish(Mob m, ServerPlayer player, HelperData.Entry entry) {
        ServerLevel world = (ServerLevel) m.level();
        SimpleContainer inv = entry.inventory;
        int slot = rodSlot(inv);
        if (slot < 0) {
            say(player, "I need a fishing rod to fish. Right-click me and put one in my inventory, then ask me again.");
            mode = Mode.FOLLOW;
            return;
        }
        if (fishCaught >= fishWanted || isFull(inv)) {
            if (fishCaught < fishWanted) say(player, "My pockets are full of fish, so I'm bringing them over. Then I'll go back to fishing.");
            m.setItemSlot(EquipmentSlot.MAINHAND, ItemStack.EMPTY);
            mode = Mode.RETURN;
            return;
        }
        if (fishSpot == null || !world.getFluidState(fishSpot).is(net.minecraft.tags.FluidTags.WATER)) {
            BlockPos[] w = findWater(world, m.blockPosition());
            if (w == null) w = findWater(world, player.blockPosition());
            if (w == null) {
                say(player, "I can't see any open water within 24 blocks. Take me to a lake, river or the sea and ask me again.");
                mode = Mode.FOLLOW;
                return;
            }
            fishSpot = w[0];
            fishStand = w[1];
            fishWalkTicks = 0;
            fishTimer = 0;
        }
        Vec3 stand = Vec3.atBottomCenterOf(fishStand);
        if (m.position().distanceToSqr(stand) > 1.5 * 1.5) { // walk to the bank
            if (m.getNavigation().isDone() || ++fishWalkTicks % 40 == 0) m.getNavigation().moveTo(stand.x, stand.y, stand.z, SPEED);
            if (fishWalkTicks > 300) m.teleportTo(stand.x, stand.y, stand.z);
            fishWalkTicks++;
            return;
        }
        m.getNavigation().stop();
        ItemStack rod = inv.getItem(slot);
        if (!ItemStack.matches(m.getMainHandItem(), rod)) m.setItemSlot(EquipmentSlot.MAINHAND, rod.copy());
        m.getLookControl().setLookAt(Vec3.atCenterOf(fishSpot));
        if (fishTimer <= 0) { // cast: wait 5 to 30 seconds like a player, less with Lure
            int lure = net.minecraft.world.item.enchantment.EnchantmentHelper.getFishingSpeedBonus(rod);
            fishTimer = Math.max(40, 100 + world.getRandom().nextInt(500) - lure * 100);
            Compat.swing(m, InteractionHand.MAIN_HAND);
            world.playSound(null, fishSpot, SoundEvents.FISHING_BOBBER_THROW, SoundSource.NEUTRAL, 0.5f, 0.4f);
            return;
        }
        if (fishTimer % 20 == 0) {
            world.sendParticles(net.minecraft.core.particles.ParticleTypes.FISHING, fishSpot.getX() + 0.5, fishSpot.getY() + 0.9,
                    fishSpot.getZ() + 0.5, 2, 0.2, 0, 0.2, 0.02);
        }
        if (--fishTimer > 0) return;
        // A bite: reel it in.
        world.playSound(null, fishSpot, SoundEvents.FISHING_BOBBER_SPLASH, SoundSource.NEUTRAL, 0.6f, 1f);
        world.sendParticles(net.minecraft.core.particles.ParticleTypes.SPLASH, fishSpot.getX() + 0.5, fishSpot.getY() + 1,
                fishSpot.getZ() + 0.5, 12, 0.3, 0.1, 0.3, 0.1);
        Compat.swing(m, InteractionHand.MAIN_HAND);
        float luck = net.minecraft.world.item.enchantment.EnchantmentHelper.getFishingLuckBonus(rod);
        net.minecraft.world.level.storage.loot.LootParams params = new net.minecraft.world.level.storage.loot.LootParams.Builder(world)
                .withParameter(net.minecraft.world.level.storage.loot.parameters.LootContextParams.ORIGIN, Vec3.atCenterOf(fishSpot))
                .withParameter(net.minecraft.world.level.storage.loot.parameters.LootContextParams.TOOL, rod)
                .withLuck(luck)
                .create(net.minecraft.world.level.storage.loot.parameters.LootContextParamSets.FISHING);
        List<ItemStack> loot = world.getServer().getLootData()
                .getLootTable(net.minecraft.world.level.storage.loot.BuiltInLootTables.FISHING).getRandomItems(params);
        for (ItemStack caught : loot) {
            fishCaught += caught.getCount();
            ItemStack rest = inv.addItem(caught);
            if (!rest.isEmpty()) Block.popResource(world, m.blockPosition(), rest);
        }
        if (currentEntry != null) currentEntry.xp += 1 + world.getRandom().nextInt(6); // fishing XP, handed over on delivery
        addWork(player, 2);
        rod.hurtAndBreak(1, m, e -> {});
        inv.setChanged();
        if (rod.isEmpty() || rodSlot(inv) < 0) {
            say(player, "My fishing rod is about to break, so I stopped. Give me a new one and ask me again.");
            m.setItemSlot(EquipmentSlot.MAINHAND, ItemStack.EMPTY);
            mode = Mode.RETURN;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Torches: while mining, light up dark tunnels so monsters don't spawn in them.
    // Uses torches it carries, or makes them from coal (or charcoal) and sticks.
    // ---------------------------------------------------------------------------------------

    private int torchTicks;
    private boolean toldNoTorches;

    private void lightUp(Mob m, ServerPlayer player, ServerLevel world, SimpleContainer inv) {
        BlockPos feet = m.blockPosition();
        if (world.getBrightness(net.minecraft.world.level.LightLayer.SKY, feet) > 7) return; // out in the open
        if (world.getBrightness(net.minecraft.world.level.LightLayer.BLOCK, feet) > 4) return; // already lit
        if (!world.getBlockState(feet).isAir()) return;
        net.minecraft.world.level.block.state.BlockState torch = net.minecraft.world.level.block.Blocks.TORCH.defaultBlockState();
        if (!torch.canSurvive(world, feet)) return;
        if (!takeTorch(inv)) {
            if (!toldNoTorches) {
                toldNoTorches = true;
                say(player, "It's dark down here. Give me torches, or coal and sticks, and I'll light up the tunnels so monsters can't spawn.");
            }
            return;
        }
        world.setBlockAndUpdate(feet, torch);
        world.playSound(null, feet, SoundEvents.WOOD_PLACE, SoundSource.BLOCKS, 0.6f, 1.2f);
        inv.setChanged();
    }

    /** Take one torch, crafting four from a coal and a stick if it has none. */
    private static boolean takeTorch(SimpleContainer inv) {
        int torch = slotOf(inv, net.minecraft.world.item.Items.TORCH);
        if (torch < 0) {
            int coal = slotOf(inv, net.minecraft.world.item.Items.COAL);
            if (coal < 0) coal = slotOf(inv, net.minecraft.world.item.Items.CHARCOAL);
            int stick = slotOf(inv, net.minecraft.world.item.Items.STICK);
            if (coal < 0 || stick < 0) return false;
            inv.getItem(coal).shrink(1);
            inv.getItem(stick).shrink(1);
            ItemStack rest = inv.addItem(new ItemStack(net.minecraft.world.item.Items.TORCH, 4));
            if (!rest.isEmpty()) return true; // no room for them, but it can still place the one in its hand
            torch = slotOf(inv, net.minecraft.world.item.Items.TORCH);
            if (torch < 0) return false;
        }
        inv.getItem(torch).shrink(1);
        return true;
    }

    private static int slotOf(SimpleContainer inv, Item item) {
        for (int i = 0; i < inv.getContainerSize(); i++) if (inv.getItem(i).is(item)) return i;
        return -1;
    }

    // ---------------------------------------------------------------------------------------
    // Farming: /helper farm [radius]. Harvests ripe crops around where you asked and replants them.
    // ---------------------------------------------------------------------------------------

    private BlockPos farmCentre, farmTarget;
    private int farmRadius, farmHarvested, farmIdle, farmWalkTicks, farmSinceDelivery;

    void startFarming(ServerPlayer player, int radius) {
        if (mob != null) clearBreaking(mob);
        job = null;
        fishWanted = 0;
        farmCentre = player.blockPosition();
        farmRadius = radius;
        farmHarvested = 0;
        farmSinceDelivery = 0;
        farmTarget = null;
        farmIdle = 0;
        mode = Mode.FARM;
        say(player, "I'll look after the crops within " + radius + " blocks of here: harvest them when they're ripe and "
                + "plant them again. I'll bring you the harvest. Use /helper stop when you want me back.");
    }

    private static boolean isRipe(BlockState state) {
        if (state.getBlock() instanceof net.minecraft.world.level.block.CropBlock crop) return crop.isMaxAge(state);
        if (state.getBlock() instanceof net.minecraft.world.level.block.NetherWartBlock)
            return state.getValue(net.minecraft.world.level.block.NetherWartBlock.AGE) >= 3;
        return false;
    }

    private BlockPos findRipe(ServerLevel world) {
        BlockPos best = null;
        double bestD = Double.MAX_VALUE;
        BlockPos from = mob != null ? mob.blockPosition() : farmCentre;
        BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
        for (int dx = -farmRadius; dx <= farmRadius; dx++) for (int dz = -farmRadius; dz <= farmRadius; dz++) for (int dy = -4; dy <= 4; dy++) {
            p.set(farmCentre.getX() + dx, farmCentre.getY() + dy, farmCentre.getZ() + dz);
            if (!world.hasChunk(p.getX() >> 4, p.getZ() >> 4)) continue;
            if (!isRipe(world.getBlockState(p))) continue;
            double d = p.distSqr(from);
            if (d < bestD) {
                bestD = d;
                best = p.immutable();
            }
        }
        return best;
    }

    private void tickFarm(Mob m, ServerPlayer player, HelperData.Entry entry) {
        ServerLevel world = (ServerLevel) m.level();
        SimpleContainer inv = entry.inventory;
        if (farmCentre == null) {
            mode = Mode.FOLLOW;
            return;
        }
        if (isFull(inv)) {
            say(player, "My pockets are full of crops. Bringing them to you, then I'll go back to the farm.");
            mode = Mode.RETURN;
            return;
        }
        if (farmTarget == null || !isRipe(world.getBlockState(farmTarget))) {
            farmTarget = null;
            if (++farmIdle % 40 != 1) return; // look for ripe crops every 2 seconds
            farmTarget = findRipe(world);
            farmWalkTicks = 0;
            if (farmTarget == null) {
                if (farmSinceDelivery > 0) { // finished a round: hand it over
                    farmSinceDelivery = 0;
                    mode = Mode.RETURN;
                    return;
                }
                Vec3 c = Vec3.atBottomCenterOf(farmCentre);
                if (m.position().distanceToSqr(c) > 6 * 6 && m.getNavigation().isDone())
                    m.getNavigation().moveTo(c.x, c.y, c.z, SPEED);
                return;
            }
        }
        m.getLookControl().setLookAt(Vec3.atCenterOf(farmTarget));
        if (m.getEyePosition().distanceToSqr(Vec3.atCenterOf(farmTarget)) > REACH_SQ) {
            if (m.getNavigation().isDone() || ++farmWalkTicks % 40 == 0)
                m.getNavigation().moveTo(farmTarget.getX() + 0.5, farmTarget.getY(), farmTarget.getZ() + 0.5, SPEED);
            if (++farmWalkTicks > 400) farmTarget = null; // can't get there, try another
            return;
        }
        m.getNavigation().stop();
        Compat.swing(m, InteractionHand.MAIN_HAND);
        BlockState ripe = world.getBlockState(farmTarget);
        List<ItemStack> drops = Block.getDrops(ripe, world, farmTarget, world.getBlockEntity(farmTarget), m, m.getMainHandItem());
        // Replant with one of the seeds it just harvested (or one it was carrying).
        ItemStack seed = ripe.getBlock().getCloneItemStack(world, farmTarget, ripe);
        boolean replanted = false;
        for (ItemStack d : drops) {
            if (!seed.isEmpty() && d.is(seed.getItem()) && !replanted) {
                d.shrink(1);
                replanted = true;
            }
        }
        if (!replanted && !seed.isEmpty()) {
            int s = slotOf(inv, seed.getItem());
            if (s >= 0) {
                inv.getItem(s).shrink(1);
                replanted = true;
            }
        }
        world.levelEvent(net.minecraft.world.level.block.LevelEvent.PARTICLES_DESTROY_BLOCK, farmTarget, Block.getId(ripe));
        world.setBlockAndUpdate(farmTarget, replanted ? ripe.getBlock().defaultBlockState() : net.minecraft.world.level.block.Blocks.AIR.defaultBlockState());
        for (ItemStack d : drops) {
            if (d.isEmpty()) continue;
            ItemStack rest = inv.addItem(d);
            if (!rest.isEmpty()) Block.popResource(world, farmTarget, rest);
        }
        inv.setChanged();
        farmHarvested++;
        farmSinceDelivery++;
        addWork(player, 1);
        farmTarget = null;
        farmIdle = 0;
    }

    void stop(ServerPlayer player) {
        if (mode == Mode.SEND) cancelSend(player, "Okay, I won't take it. Here it is back.");
        fishWanted = 0;
        farmCentre = null;
        if (mob != null && job != null && mob.level() instanceof ServerLevel w) {
            plugShafts(w, HelperData.get(player.level().getServer()).getOrCreate(owner).inventory);
        }
        if (mob != null) {
            clearBreaking(mob);
            mob.getNavigation().stop();
        }
        job = null;
        mode = Mode.FOLLOW;
    }

    void deliverNow() {
        if (mob != null) clearBreaking(mob);
        toPlayer = true;
        mode = Mode.RETURN;
    }

    // ---------------------------------------------------------------------------------------
    // Courier: take things to another player (/helper send <player>)
    // ---------------------------------------------------------------------------------------

    /** Hand the helper some items to walk over to another player. False (items untouched) if it can't. */
    boolean send(ServerPlayer player, ServerPlayer target, List<ItemStack> items) {
        if (mode == Mode.SEND) {
            say(player, "I'm already taking " + parcelText() + " to " + sendToName + ". One delivery at a time!");
            return false;
        }
        if (mode != Mode.FOLLOW) stop(player);
        parcel.clear();
        for (ItemStack s : items) if (!s.isEmpty()) parcel.add(s);
        if (parcel.isEmpty()) return false;
        sendTo = target.getUUID();
        sendToName = target.getName().getString();
        sendTicks = 0;
        returnTicks = 0;
        mode = Mode.SEND;
        say(player, "On it! Taking " + parcelText() + " to " + sendToName + ".");
        return true;
    }

    private String parcelText() {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (ItemStack s : parcel) counts.merge(s.getHoverName().getString(), s.getCount(), Integer::sum);
        StringBuilder sb = new StringBuilder();
        counts.forEach((name, count) -> {
            if (sb.length() > 0) sb.append(", ");
            sb.append(count).append(' ').append(name);
        });
        return sb.length() == 0 ? "nothing" : sb.toString();
    }

    /** Give the parcel back to its owner (or drop it at their feet) and go back to following. */
    private void cancelSend(ServerPlayer player, String why) {
        if (mode == Mode.SEND) mode = Mode.FOLLOW;
        sendTo = null;
        if (parcel.isEmpty()) return;
        for (ItemStack s : parcel) player.getInventory().placeItemBackInInventory(s, net.minecraft.util.Prediction.SERVER_ONLY);
        parcel.clear();
        say(player, why);
    }

    /** The server is stopping mid-delivery: keep the items safe in the owner's Helper Storage. */
    void saveParcel(MinecraftServer server) {
        if (parcel.isEmpty()) return;
        Storage.Data store = Storage.Data.get(server);
        for (ItemStack s : parcel) store.add(owner, s);
        store.setDirty();
        parcel.clear();
        if (mode == Mode.SEND) mode = Mode.FOLLOW;
    }

    private void tickSend(Mob m, ServerPlayer player) {
        ServerPlayer target = sendTo == null ? null : player.level().getServer().getPlayerList().getPlayer(sendTo);
        if (target == null) {
            cancelSend(player, sendToName + " isn't online any more, so here's your stuff back.");
            return;
        }
        if (++sendTicks > 20 * 120) {
            cancelSend(player, "I couldn't reach " + sendToName + " in two minutes. Here's your stuff back.");
            return;
        }
        ServerLevel world = (ServerLevel) m.level();
        if (target.level() != world) {
            // A different dimension: zip through and hand it over straight away.
            handOver(m, player, target, true);
            return;
        }
        double d = m.distanceToSqr(target);
        if (d <= 3 * 3) {
            handOver(m, player, target, false);
            return;
        }
        if (d > 48 * 48) { // too far to walk: hop most of the way, then walk up to them
            hopNear(m, target);
            return;
        }
        if (--repathCooldown <= 0) {
            m.getNavigation().moveTo(target, SPEED);
            repathCooldown = 10;
        }
        if (isStuck(m, 80)) hopNear(m, target);
    }

    private void hopNear(Mob m, ServerPlayer target) {
        ServerLevel world = (ServerLevel) m.level();
        Vec3 spot = findSpotNear(world, target.blockPosition());
        world.sendParticles(net.minecraft.core.particles.ParticleTypes.PORTAL, m.getX(), m.getY() + 1, m.getZ(), 20, 0.3, 0.5, 0.3, 0.2);
        m.getNavigation().stop();
        m.teleportTo(spot.x, spot.y, spot.z);
        world.playSound(null, BlockPos.containing(spot), SoundEvents.ENDERMAN_TELEPORT, SoundSource.NEUTRAL, 0.4f, 1.4f);
        stuckTicks = 0;
    }

    private void handOver(Mob m, ServerPlayer player, ServerPlayer target, boolean otherWorld) {
        String what = parcelText();
        boolean dropped = false;
        for (ItemStack s : parcel) {
            ItemStack give = s.copy();
            target.getInventory().add(give);
            if (!give.isEmpty()) {
                target.drop(give, false, false);
                dropped = true;
            }
        }
        parcel.clear();
        sendTo = null;
        mode = Mode.FOLLOW;
        m.getNavigation().stop();
        Compat.notifySound(target, SoundEvents.ITEM_PICKUP, SoundSource.PLAYERS, 0.6f, 1.2f);
        if (otherWorld) {
            ((ServerLevel) target.level()).sendParticles(net.minecraft.core.particles.ParticleTypes.PORTAL,
                    target.getX(), target.getY() + 1, target.getZ(), 30, 0.5, 0.5, 0.5, 0.2);
        } else {
            danceTicks = Celebrate.DANCE_TICKS / 2;
            Celebrate.fireworks((ServerLevel) m.level(), m.position());
        }
        target.sendSystemMessage(Component.literal("[" + player.getName().getString() + "'s Helper] ").withStyle(ChatFormatting.GOLD)
                .append(Component.literal(player.getName().getString() + " sent you " + what + "."
                        + (dropped ? " Your inventory is full, so some of it is at your feet." : "")).withStyle(ChatFormatting.WHITE)));
        say(player, "Delivered " + what + " to " + target.getName().getString() + "!"
                + (otherWorld ? " (They're in another dimension, so I zipped it over.)" : " Heading back to you now."));
    }

    // ---------------------------------------------------------------------------------------
    // Answering questions about itself ("helper, are you stuck?")
    // ---------------------------------------------------------------------------------------

    /** Does it look stuck: not moving while it's trying to get somewhere? */
    boolean looksStuck(ServerPlayer player) {
        Mob m = mob;
        if (m == null || !m.isAlive()) return true;
        if (m.level() != player.level() && mode == Mode.FOLLOW) return true;
        if (stuckTicks > 30) return true;
        return mode == Mode.FOLLOW && m.distanceToSqr(player) > 10 * 10 && m.getNavigation().isDone();
    }

    /** Pop over to the owner, cancelling the trip it was stuck on (the job itself keeps going). */
    void unstick(ServerPlayer player, HelperData.Entry entry) {
        Mob m = mob;
        if (m == null || !m.isAlive() || m.level() != player.level()) {
            spawnNear(player, entry);
            return;
        }
        clearBreaking(m);
        if (job != null) {
            job.resetSearch();
            job.travelFailures = 0;
        }
        teleportNear(m, player);
        ((ServerLevel) m.level()).sendParticles(net.minecraft.core.particles.ParticleTypes.PORTAL,
                m.getX(), m.getY() + 1, m.getZ(), 20, 0.3, 0.5, 0.3, 0.2);
    }

    /** Where it is, in words: distance, direction and height from the owner. */
    String whereText(ServerPlayer player) {
        Mob m = mob;
        if (m == null || !m.isAlive()) return "I'm not out in the world right now. /helper summon brings me to you.";
        if (m.level() != player.level()) {
            return "I'm in a different dimension (" + m.level().dimension().identifier().getPath() + "). I'll come over in a moment.";
        }
        BlockPos at = m.blockPosition();
        double dx = m.getX() - player.getX(), dz = m.getZ() - player.getZ(), dy = m.getY() - player.getY();
        int dist = (int) Math.round(Math.sqrt(dx * dx + dz * dz + dy * dy));
        if (dist <= 4) return "Right next to you! (" + at.getX() + ", " + at.getY() + ", " + at.getZ() + ")";
        String dir;
        double angle = Math.toDegrees(Math.atan2(dz, dx)); // 0 = east, 90 = south
        String[] names = {"east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"};
        dir = names[(int) Math.round(((angle % 360) + 360) % 360 / 45) % 8];
        String height = dy < -6 ? ", " + (int) -dy + " blocks below you" : dy > 6 ? ", " + (int) dy + " blocks above you" : "";
        return "I'm " + dist + " blocks " + dir + " of you" + height + ", at " + at.getX() + ", " + at.getY() + ", " + at.getZ() + ".";
    }

    /** Health and what it's carrying, for "are you ok" / "are you full". */
    String healthText() {
        Mob m = mob;
        if (m == null || !m.isAlive()) return "I'm not out right now.";
        int hp = (int) Math.ceil(m.getHealth()), max = (int) Math.ceil(m.getMaxHealth());
        return hp >= max ? "Full health (" + hp + "/" + max + ")" : hp <= max / 3 ? "Ouch, I'm hurt: " + hp + "/" + max + " health"
                : hp + "/" + max + " health";
    }

    String pocketsText(SimpleContainer inv) {
        int room = inv instanceof HelperData.Pockets p ? p.unlocked : inv.getContainerSize();
        int used = 0;
        for (int i = 0; i < room; i++) if (!inv.getItem(i).isEmpty()) used++;
        String items = summarize(inv, false);
        return (used >= room ? "I'm full! " : "") + used + " of my " + room + " pockets are used. Carrying: "
                + (items.isEmpty() ? "nothing" : items) + ".";
    }

    /** How far along the current job is, for "are you done yet" / "how long". */
    String progressText() {
        if (mode == Mode.SEND) return "Still on my way to " + sendToName + " with " + parcelText() + ".";
        if (job != null && (mode == Mode.COLLECT || mode == Mode.RETURN)) {
            int left = Math.max(0, job.wanted - job.collected);
            return job.done || left == 0 ? "That job's done! I'm bringing it all back."
                    : job.collected + " of " + job.wanted + " " + job.spec.display + " so far, " + left + " to go.";
        }
        if (mode == Mode.FISH) return fishCaught + " of " + fishWanted + " fish caught so far.";
        if (mode == Mode.FARM) return farmHarvested + " crops harvested so far. Say \"helper stop\" when you've got enough.";
        return "I'm not on a job right now, just following you. Give me one, like \"helper, get 20 iron\".";
    }

    String status(SimpleContainer inv) {
        String doing;
        if (mode == Mode.COLLECT && job != null) {
            doing = "Collecting " + job.spec.display + ": " + job.collected + "/" + job.wanted;
        } else if (mode == Mode.RETURN) {
            doing = job != null && !job.done
                    ? "Bringing you my haul, then back to collecting " + job.spec.display
                    : "Bringing you my haul";
        } else if (mode == Mode.FISH) {
            doing = "Fishing: " + fishCaught + "/" + fishWanted + " caught";
        } else if (mode == Mode.SEND) {
            doing = "Taking " + parcelText() + " to " + sendToName;
        } else if (mode == Mode.FARM) {
            doing = "Farming the crops around " + farmCentre.getX() + ", " + farmCentre.getZ() + " (" + farmHarvested + " harvested)";
        } else {
            doing = "Following you";
        }
        if (combatTarget != null) doing = "Fighting " + combatTarget.getName().getString() + " (" + doing + ")";
        String items = summarize(inv, false);
        int xp = currentEntry == null ? 0 : currentEntry.xp;
        String level = currentEntry == null ? "" : levelText(currentEntry) + ", " + currentEntry.inventory.unlocked + " pockets. ";
        return level + doing + ". Carrying: " + (items.isEmpty() ? "nothing" : items) + "."
                + (xp > 0 ? " Holding " + xp + " XP for you." : "");
    }

    // ---------------------------------------------------------------------------------------
    // Ticking
    // ---------------------------------------------------------------------------------------

    void tick(MinecraftServer server, ServerPlayer player, HelperData.Entry entry) {
        currentEntry = entry;
        Mob m = findEntity(server, entry);
        // Flying an Ad Astra rocket or lander: wait, then meet the owner when they've landed (on any planet).
        Entity vehicle = player.getVehicle();
        if (vehicle != null && vehicle != m
                && BuiltInRegistries.ENTITY_TYPE.getKey(vehicle.getType()).getNamespace().equals("ad_astra")) {
            if (!toldFlight) {
                toldFlight = true;
                say(player, "Have a good flight! I'll meet you when you land.");
            }
            if (m != null && m.level() == player.level()) m.getNavigation().stop();
            missingTicks = 0;
            return;
        }
        if (toldFlight && m != null && m.level() != player.level()) spawnNear(player, entry); // just landed
        toldFlight = false;
        if (m != null && Planets.isSpace(m.level())) { // no air and freezing or boiling: the helper is fine
            m.setAirSupply(m.getMaxAirSupply());
            m.setTicksFrozen(0);
            m.clearFire();
            Planets.Theme here = Planets.themeOf(m.level());
            String dim = Planets.keyOf(m.level());
            if (here != null && !dim.equals(lastPlanet)) {
                lastPlanet = dim;
                say(player, "We made it to " + here.display() + "! I can mine the ores here too, e.g. /helper collect "
                        + ("moon".equals(m.level().dimension().identifier().getPath()) ? "desh"
                        : "mars".equals(m.level().dimension().identifier().getPath()) ? "ostrum" : "calorite")
                        + ". Try /helper boss to find this planet's boss.");
            }
        }
        if (m == null) {
            // Unloaded (owner walked or teleported away) or gone. Bring a fresh one to the owner.
            if (++missingTicks > 40) {
                missingTicks = 0;
                spawnNear(player, entry);
            }
            return;
        }
        // Always keep the helper's own chunk (and the ones around it) loaded, whatever it's doing.
        // Counted in server ticks, not the helper's age, so it keeps going even if the helper stops ticking.
        if (server.getTickCount() % 20 == 0) keepLoaded((ServerLevel) m.level(), m);
        if (!((ServerLevel) m.level()).isPositionEntityTicking(m.blockPosition())) {
            // Too far from every player to be simulated: it would just stand frozen. Bring it back.
            if (++missingTicks > 40) {
                missingTicks = 0;
                spawnNear(player, entry);
            }
            return;
        }
        missingTicks = 0;
        if (m.getFirstPassenger() == player) {
            tickRide(m, player);
            return;
        }
        if (m.maxUpStep() != WALK_STEP) m.setMaxUpStep(WALK_STEP); // got off: back to its normal step
        if (m.isNoGravity() && !m.isVehicle()) m.setNoGravity(false); // got off a flying helper
        if (m.tickCount % 10 == 0) pickUpXp(m, player, entry);
        if (++gearTicks % 40 == 1) Combat.wearBestArmor(m, entry.inventory);
        if (tickCombat(m, player, entry)) return;
        if (danceTicks > 0) {
            Celebrate.danceStep(m, --danceTicks);
            return;
        }
        switch (mode) {
            case FOLLOW -> tickFollow(m, player, entry);
            case RETURN -> tickReturn(m, player, entry);
            case COLLECT -> {
                if (job == null) mode = Mode.FOLLOW;
                else tickCollect(m, player, entry);
            }
            case FISH -> tickFish(m, player, entry);
            case FARM -> tickFarm(m, player, entry);
            case SEND -> tickSend(m, player);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Combat: protect the owner and itself, and help with whatever the owner attacks
    // ---------------------------------------------------------------------------------------

    private boolean tickCombat(Mob m, ServerPlayer player, HelperData.Entry entry) {
        if (!entry.guard) {
            combatTarget = null;
            return false;
        }
        if (combatTarget != null && !Combat.stillWorthFighting(m, player, combatTarget, ++combatTicks)) {
            combatTarget = null;
            m.getNavigation().stop();
        }
        if (combatTarget == null) {
            if (++combatScan < 10) return false;
            combatScan = 0;
            if (++ignoreClearTicks > 60) { // forget unreachable mobs every ~30 seconds
                ignoreClearTicks = 0;
                ignoredTargets.clear();
            }
            combatTarget = Combat.findThreat(m, player, mode == Mode.COLLECT, ignoredTargets);
            if (combatTarget == null) return false;
            if (DEBUG) HelperMod.LOG.info("[helper debug] target {} at {}", combatTarget, combatTarget.blockPosition());
            combatTicks = 0;
            lastProgressTick = 0;
            closestSoFar = Double.MAX_VALUE;
            clearBreaking(m);
            if (job != null) {
                job.target = null; // re-plan the route after the fight
                job.stepCell = null;
            }
        }
        LivingEntity target = combatTarget;
        m.getLookControl().setLookAt(target, 30f, 30f);
        double d = m.distanceToSqr(target);
        if (d < closestSoFar - 0.5) {
            closestSoFar = d;
            lastProgressTick = combatTicks;
        }
        if (combatTicks - lastProgressTick > 80) { // can't get to it (behind walls, in a cave...): skip it
            if (DEBUG) HelperMod.LOG.info("[helper debug] giving up on {}", target);
            ignoredTargets.add(target.getUUID());
            combatTarget = null;
            m.getNavigation().stop();
            return false;
        }
        if (d > Combat.REACH_SQ) {
            if (--repathCooldown <= 0) {
                m.getNavigation().moveTo(target, Combat.CHASE_SPEED);
                repathCooldown = 5;
            }
        } else {
            m.getNavigation().stop();
        }
        if (attackCooldown > 0) attackCooldown--;
        if (attackCooldown <= 0 && d <= Combat.REACH_SQ && m.hasLineOfSight(target)) {
            attackCooldown = Combat.attack(m, target, entry.inventory, name -> say(player,
                    "My " + name + " is about to break, so I've stopped using it. Give me a new one or repair it."));
            lastProgressTick = combatTicks;
            if (!target.isAlive()) {
                combatTarget = null;
                addWork(player, 5);
            }
        }
        return true;
    }

    // ---------------------------------------------------------------------------------------
    // Levels: the helper gets better the more it works
    // ---------------------------------------------------------------------------------------

    private void addWork(ServerPlayer player, int points) {
        HelperData.Entry e = currentEntry;
        if (e == null || e.level >= HelperData.MAX_LEVEL) return;
        e.work += points;
        int level = HelperData.levelFor(e.work);
        HelperData.get(player.level().getServer()).setDirty();
        if (level <= e.level) return;
        e.level = level;
        e.inventory.unlocked = HelperData.pocketsFor(level);
        Mob m = mob;
        if (m != null) {
            ServerLevel w = (ServerLevel) m.level();
            w.playSound(null, m.blockPosition(), SoundEvents.PLAYER_LEVELUP, SoundSource.NEUTRAL, 0.8f, 1.2f);
            w.sendParticles(net.minecraft.core.particles.ParticleTypes.HAPPY_VILLAGER,
                    m.getX(), m.getY() + m.getBbHeight(), m.getZ(), 15, 0.4, 0.4, 0.4, 0.1);
        }
        say(player, "I leveled up! I'm level " + level + " now: I mine "
                + Math.round((HelperData.speedFor(level) - 1) * 100) + "% faster and have "
                + e.inventory.unlocked + " pockets." + (level >= HelperData.MAX_LEVEL ? " That's the top level!" : ""));
    }

    static String levelText(HelperData.Entry e) {
        if (e.level >= HelperData.MAX_LEVEL) return "Level " + e.level + " (top level)";
        return "Level " + e.level + " (" + (e.work - HelperData.pointsFor(e.level)) + "/"
                + (HelperData.pointsFor(e.level + 1) - HelperData.pointsFor(e.level)) + " to the next)";
    }

    /**
     * The helper is its own chunk loader: its chunk and the 8 around it stay loaded and running (so it
     * can walk over a chunk border without freezing), plus wherever it's heading. The ticket runs out
     * a few seconds after the helper is gone, so nothing stays loaded for nothing.
     */
    private void keepLoaded(ServerLevel world, Mob m) {
        ChunkPos here = new ChunkPos(m.blockPosition());
        world.getChunkSource().addRegionTicket(KEEP_LOADED_TICKET, here, 3, here);
        if (job != null && job.target != null) {
            ChunkPos there = new ChunkPos(job.target);
            world.getChunkSource().addRegionTicket(KEEP_LOADED_TICKET, there, 2, there);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Riding: the owner sits on the helper and steers with the normal movement keys
    // ---------------------------------------------------------------------------------------

    /** Start riding your helper (right-click it holding a saddle, or /helper ride). */
    boolean ride(ServerPlayer player, HelperData.Entry entry) {
        Mob m = findEntity(player.level().getServer(), entry);
        if (m == null || m.level() != player.level() || m.distanceToSqr(player) > 16 * 16) return false;
        if (player.isPassenger()) player.stopRiding();
        m.getNavigation().stop();
        clearBreaking(m);
        return player.startRiding(m, true);
    }

    private static final Set<String> FLYERS = Set.of("minecraft:phantom", "minecraft:bat", "minecraft:parrot",
            "minecraft:ghast", "minecraft:allay", "minecraft:bee", "minecraft:blaze", "minecraft:vex",
            "minecraft:ender_dragon", "minecraft:wither");

    /** Does the helper look like a mob that flies? Then it flies when you ride it. */
    private boolean looksLikeFlyer() {
        String look = currentEntry == null ? null : currentEntry.look;
        if (look == null) return false;
        if (FLYERS.contains(look)) return true;
        String path = look.substring(look.indexOf(':') + 1);
        return path.contains("dragon") || path.contains("bird") || path.contains("bat") || path.contains("wyvern");
    }

    /** How high a step it walks up without jumping: a mob's usual 0.6, or a full block while ridden (like a horse). */
    private static final float WALK_STEP = 0.6f, RIDE_STEP = 1.0f;

    private void tickRide(Mob m, ServerPlayer rider) {
        m.getNavigation().stop();
        combatTarget = null;
        float yaw = rider.getYRot();
        m.setYRot(yaw);
        m.setYBodyRot(yaw);
        m.setYHeadRot(yaw);
        float forward = rider.zza, side = rider.xxa; // the rider's W/A/S/D, sent by the game
        boolean jump = ((com.helpermod.mixin.LivingEntityAccessor) rider).helpermod$isJumping(); // the rider's space bar
        double rad = Math.toRadians(yaw);
        double dx = side * Math.cos(rad) - forward * Math.sin(rad);
        double dz = forward * Math.cos(rad) + side * Math.sin(rad);
        double len = Math.sqrt(dx * dx + dz * dz);
        boolean moving = len > 0.01;
        if (moving) {
            dx /= len;
            dz /= len;
        }
        boolean flyer = looksLikeFlyer();
        m.setNoGravity(flyer);
        if (flyer) { // fly where the rider looks: W goes that way (up or down too), space bar climbs
            m.getMoveControl().setWantedPosition(m.getX(), m.getY(), m.getZ(), 0);
            Vec3 look = rider.getViewVector(1f);
            double speed = rider.isSprinting() ? 0.9 : 0.6;
            Vec3 v = moving ? new Vec3(dx * speed, forward > 0 ? look.y * speed : 0, dz * speed) : Vec3.ZERO;
            if (jump) v = v.add(0, 0.4, 0);
            m.setDeltaMovement(m.getDeltaMovement().scale(0.5).add(v.scale(0.5)));
            m.needsSync = true;
            m.fallDistance = 0;
            return;
        }
        if (m.isInWater()) { // swim properly: full speed through water, space bar swims up
            m.getMoveControl().setWantedPosition(m.getX(), m.getY(), m.getZ(), 0);
            double speed = rider.isSprinting() ? 0.45 : 0.3;
            Vec3 v = moving ? new Vec3(dx * speed, 0, dz * speed) : Vec3.ZERO;
            double up = jump ? 0.3 : m.isUnderWater() ? 0.05 : 0; // float up gently
            m.setDeltaMovement(new Vec3(v.x, Math.max(m.getDeltaMovement().y, up), v.z));
            m.needsSync = true;
            return;
        }
        // Like a horse: walk straight up 1-block steps, and hop over anything a little taller by itself.
        if (m.maxUpStep() != RIDE_STEP) m.setMaxUpStep(RIDE_STEP);
        if (!jump && moving && m.onGround() && m.horizontalCollision && !m.isInWater()) {
            m.setDeltaMovement(m.getDeltaMovement().x, 0.5, m.getDeltaMovement().z);
            m.needsSync = true;
        }
        if (jump && m.onGround()) { // jump like a horse: a good hop, more while moving
            m.setDeltaMovement(m.getDeltaMovement().x + dx * 0.2, 0.6, m.getDeltaMovement().z + dz * 0.2);
            m.needsSync = true;
        }
        if (!moving) {
            m.getMoveControl().setWantedPosition(m.getX(), m.getY(), m.getZ(), 0);
            return;
        }
        double speed = forward < 0 ? 0.8 : rider.isSprinting() ? 2.2 : 1.6;
        m.getMoveControl().setWantedPosition(m.getX() + dx * 3, m.getY(), m.getZ() + dz * 3, speed);
    }

    private void tickFollow(Mob m, ServerPlayer player, HelperData.Entry entry) {
        if (m.level() != player.level()) {
            spawnNear(player, entry);
            return;
        }
        double d = m.distanceToSqr(player);
        if (d > 32 * 32) {
            teleportNear(m, player);
        } else if (d > 4 * 4) {
            if (--repathCooldown <= 0) {
                m.getNavigation().moveTo(player, SPEED);
                repathCooldown = 10;
            }
            if (isStuck(m, 60)) teleportNear(m, player); // stuck behind a wall for 3 s: phase through to you
        } else if (d < 2.5 * 2.5) {
            m.getNavigation().stop();
        }
    }

    private void tickReturn(Mob m, ServerPlayer player, HelperData.Entry entry) {
        if (m.level() != player.level()) {
            spawnNear(player, entry);
            return;
        }
        if (job != null && job.breaking != null) {
            tickBreaking(m, player, (ServerLevel) m.level(), entry.inventory); // e.g. gravel fell on the stairs
            return;
        }
        if (mineStep >= 0 || branchFrom >= 0) {
            // Walk back up the mine's staircase to the surface.
            if (goToStep(m, player, (ServerLevel) m.level(), entry, 0)) {
                mineStep = -1;
                stuckTicks = 0;
            }
            return;
        }
        // A Helper Storage nearby? Put the haul in there instead of in the player's pockets.
        BlockPos store = toPlayer ? null : nearbyStorage(m, (ServerLevel) m.level());
        if (store != null) {
            double ds = m.distanceToSqr(Vec3.atCenterOf(store));
            if (ds > 3.2 * 3.2) {
                if (--repathCooldown <= 0) {
                    m.getNavigation().moveTo(store.getX() + 0.5, store.getY(), store.getZ() + 0.5, SPEED);
                    repathCooldown = 10;
                }
                if (++returnTicks > 600 || isStuck(m, 100)) { // can't get there: hop next to it
                    returnTicks = 0;
                    BlockPos stand = standNear((ServerLevel) m.level(), store);
                    if (stand != null) m.teleportTo(stand.getX() + 0.5, stand.getY(), stand.getZ() + 0.5);
                    else storagePos = null;
                }
                return;
            }
        }
        double d = m.distanceToSqr(player);
        if (store == null && d > 3 * 3 && ++returnTicks > 600) { // 30 s and still can't reach you: hop over
            returnTicks = 0;
            teleportNear(m, player);
            d = m.distanceToSqr(player);
        }
        if (store != null || d <= 3 * 3) {
            returnTicks = 0;
            m.getNavigation().stop();
            if (job != null) plugShafts((ServerLevel) m.level(), entry.inventory);
            if (store != null) deliver(m, player, entry.inventory, true);
            else deliver(m, player, entry.inventory);
            toPlayer = false;
            if (job != null && !job.done && isFull(entry.inventory)) {
                say(player, "I'm still out of space: my inventory is full of tools and gear. Right-click me and "
                        + "take some things out, then ask me again.");
                job = null;
            }
            if (job != null && !job.done) {
                job.resetSearch();
                mode = Mode.COLLECT;
            } else if (job == null && fishWanted > 0 && fishCaught < fishWanted && rodSlot(entry.inventory) >= 0
                    && !isFull(entry.inventory)) {
                mode = Mode.FISH; // back to the water for the rest
            } else if (job == null && farmCentre != null && !isFull(entry.inventory)) {
                farmTarget = null;
                mode = Mode.FARM; // back to the fields
            } else {
                farmCentre = null;
                fishWanted = 0;
                job = null;
                mode = Mode.FOLLOW;
            }
            return;
        }
        if (d > 48 * 48) {
            teleportNear(m, player);
            return;
        }
        if (--repathCooldown <= 0) {
            m.getNavigation().moveTo(player, SPEED);
            repathCooldown = 10;
        }
        if (isStuck(m, 100)) teleportNear(m, player);
    }

    /**
     * Step through a wall: find the first open spot (2 tall, with a floor) up to 5 blocks further along
     * (dx, dz) and pop out there, without breaking anything. False if there's no open spot within reach.
     */
    private boolean phaseThrough(Mob m, ServerLevel world, BlockPos cur, int dx, int dz) {
        for (int k = 2; k <= 6; k++) {
            for (int dy : new int[]{0, 1, -1}) {
                BlockPos p = cur.offset(dx * k, dy, dz * k);
                if (!world.hasChunkAt(p)) return false;
                if (!passable(world, p) || !passable(world, p.above())) continue;
                if (!world.getFluidState(p).isEmpty()) continue;
                BlockPos floor = p.below();
                if (!world.getBlockState(floor).isFaceSturdy(world, floor, Direction.UP)) continue;
                m.getNavigation().stop();
                world.sendParticles(net.minecraft.core.particles.ParticleTypes.PORTAL, m.getX(), m.getY() + 1, m.getZ(), 20, 0.3, 0.5, 0.3, 0.2);
                m.teleportTo(p.getX() + 0.5, p.getY(), p.getZ() + 0.5);
                world.playSound(null, p, SoundEvents.ENDERMAN_TELEPORT, SoundSource.NEUTRAL, 0.4f, 1.4f);
                stuckTicks = 0;
                return true;
            }
        }
        return false;
    }

    private void teleportNear(Mob m, ServerPlayer player) {
        mineStep = -1;
        branchFrom = -1;
        Vec3 spot = findSpotNear(player.level(), player.blockPosition());
        m.getNavigation().stop();
        m.teleportTo(spot.x, spot.y, spot.z);
        stuckTicks = 0;
    }

    private boolean isStuck(Mob m, int limit) {
        if (m.position().distanceToSqr(lastPos) > 0.04) {
            lastPos = m.position();
            stuckTicks = 0;
            return false;
        }
        return ++stuckTicks > limit;
    }

    /** Orbs within this many blocks of the helper are picked up. */
    private static final double XP_PICKUP_RADIUS = 4.0;
    /** If the owner is this close, leave the orbs for them to grab themselves. */
    private static final double OWNER_NEAR_SQ = 6.0 * 6.0;

    /**
     * Mined ores and defeated mobs drop XP orbs where the helper is, usually far from its owner.
     * The helper soaks them up and hands the XP over when it delivers.
     */
    private void pickUpXp(Mob m, ServerPlayer player, HelperData.Entry entry) {
        if (player.level() == m.level() && player.distanceToSqr(m) < OWNER_NEAR_SQ) {
            // Back with its owner and not on a run: hand over anything it's still holding.
            if (mode == Mode.FOLLOW && entry.xp > 0) {
                int given = giveXp(player);
                if (given > 0) say(player, "Here's " + given + " XP I picked up for you.");
            }
            return;
        }
        int gained = 0;
        for (ExperienceOrb orb : m.level().getEntitiesOfClass(ExperienceOrb.class,
                m.getBoundingBox().inflate(XP_PICKUP_RADIUS), Entity::isAlive)) {
            gained += orb.getValue() * Math.max(1, ((ExperienceOrbAccessor) orb).helpermod$getPickingCount());
            orb.discard();
        }
        if (gained <= 0) return;
        entry.xp = (int) Math.min(Integer.MAX_VALUE, (long) entry.xp + gained);
        HelperData.get(player.level().getServer()).setDirty();
        m.level().playSound(null, m.blockPosition(), SoundEvents.EXPERIENCE_ORB_PICKUP,
                SoundSource.NEUTRAL, 0.2f, 1.4f);
    }

    /** Give the owner the XP the helper has been holding. Returns how much was given. */
    private int giveXp(ServerPlayer player) {
        HelperData.Entry entry = currentEntry;
        if (entry == null || entry.xp <= 0) return 0;
        int xp = entry.xp;
        entry.xp = 0;
        HelperData.get(player.level().getServer()).setDirty();
        int before = player.experienceLevel;
        player.giveExperiencePoints(xp);
        player.level().playSound(null, player.blockPosition(), player.experienceLevel > before
                        ? SoundEvents.PLAYER_LEVELUP : SoundEvents.EXPERIENCE_ORB_PICKUP,
                SoundSource.PLAYERS, 0.6f, 1f);
        return xp;
    }

    /** The closest Helper Storage within 48 blocks of the helper (rescanned every 5 seconds), or null. */
    private BlockPos nearbyStorage(Mob m, ServerLevel world) {
        long now = world.getGameTime();
        if (storagePos != null && now < storageScanAt && Storage.isStorageBlock(world, storagePos)) return storagePos;
        storageScanAt = now + 100;
        storagePos = null;
        BlockPos here = m.blockPosition();
        double best = 48 * 48;
        int cx = here.getX() >> 4, cz = here.getZ() >> 4;
        for (int x = cx - 3; x <= cx + 3; x++) {
            for (int z = cz - 3; z <= cz + 3; z++) {
                if (!world.hasChunk(x, z)) continue;
                for (BlockPos pos : world.getChunk(x, z).getBlockEntities().keySet()) {
                    double dist = pos.distSqr(here);
                    if (dist < best && Storage.isStorageBlock(world, pos)) {
                        best = dist;
                        storagePos = pos.immutable();
                    }
                }
            }
        }
        return storagePos;
    }

    /** An open spot (2 tall, with a floor) next to a block, to stand by it. */
    private static BlockPos standNear(ServerLevel world, BlockPos pos) {
        for (Direction dir : Direction.Plane.HORIZONTAL) {
            for (int dy : new int[]{0, -1, 1}) {
                BlockPos p = pos.relative(dir).above(dy);
                if (world.getBlockState(p).isAir() && world.getBlockState(p.above()).isAir()
                        && world.getBlockState(p.below()).isFaceSturdy(world, p.below(), Direction.UP)) return p;
            }
        }
        return null;
    }

    private void deliver(Mob m, ServerPlayer player, SimpleContainer inv) {
        deliver(m, player, inv, false);
    }

    private void deliver(Mob m, ServerPlayer player, SimpleContainer inv, boolean toStorage) {
        Storage.Data store = toStorage ? Storage.Data.get(player.level().getServer()) : null;
        Map<String, Integer> given = new LinkedHashMap<>();
        boolean droppedAtFeet = false;
        int keptBuilding = 0;
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack stack = inv.getItem(i);
            if (stack.isEmpty() || stack.isDamageableItem()) continue; // keep tools
            if (isBuildingBlock(stack) && (job == null || !job.spec.counts(stack))
                    && keptBuilding < KEEP_BUILDING_BLOCKS) {
                int keep = Math.min(stack.getCount(), KEEP_BUILDING_BLOCKS - keptBuilding);
                keptBuilding += keep;
                if (keep == stack.getCount()) continue;
                ItemStack give = stack.split(stack.getCount() - keep);
                given.merge(give.getHoverName().getString(), give.getCount(), Integer::sum);
                if (store != null) store.add(player.getUUID(), give);
                else player.getInventory().placeItemBackInInventory(give, net.minecraft.util.Prediction.SERVER_ONLY);
                continue;
            }
            given.merge(stack.getHoverName().getString(), stack.getCount(), Integer::sum);
            ItemStack give = stack.copy();
            if (store != null) {
                store.add(player.getUUID(), give);
                give = ItemStack.EMPTY;
            } else {
                player.getInventory().add(give);
            }
            if (!give.isEmpty()) {
                player.drop(give, false, false);
                droppedAtFeet = true;
            }
            inv.setItem(i, ItemStack.EMPTY);
        }
        inv.setChanged();
        int xp = giveXp(player);
        String xpNote = xp > 0 ? " Plus " + xp + " XP I picked up along the way." : "";
        if (given.isEmpty()) {
            say(player, xp > 0 ? "No new items, but here's " + xp + " XP I picked up along the way."
                    : "I don't have anything new for you.");
            return;
        }
        m.level().playSound(null, store != null ? m.blockPosition() : player.blockPosition(), SoundEvents.ITEM_PICKUP,
                SoundSource.PLAYERS, 0.4f, 1.2f);
        StringBuilder sb = new StringBuilder();
        given.forEach((name, count) -> {
            if (sb.length() > 0) sb.append(", ");
            sb.append(count).append(' ').append(name);
        });
        danceTicks = Celebrate.DANCE_TICKS;
        m.getNavigation().stop();
        Celebrate.fireworks((ServerLevel) m.level(), m.position());
        if (store != null) {
            say(player, "Put " + sb + " in your Helper Storage." + xpNote);
            return;
        }
        say(player, "Here you go: " + sb + "." + xpNote + (droppedAtFeet
                ? " Your inventory is full, so I dropped the rest at your feet." : ""));
    }

    // ---------------------------------------------------------------------------------------
    // Collecting
    // ---------------------------------------------------------------------------------------

    private void tickCollect(Mob m, ServerPlayer player, HelperData.Entry entry) {
        Job j = job;
        ServerLevel world = (ServerLevel) m.level();
        SimpleContainer inv = entry.inventory;
        if (++torchTicks % 10 == 0) lightUp(m, player, world, inv);

        if (j.breaking != null) {
            tickBreaking(m, player, world, inv);
            return;
        }
        if (isFull(inv)) {
            say(player, "My pockets are full. Bringing everything to you, then I'll keep going.");
            mode = Mode.RETURN;
            return;
        }
        if (j.mineState == MineState.DESCEND) {
            tickDescend(m, player, world, entry);
            return;
        }
        if (j.target != null && !j.spec.matches(world.getBlockState(j.target))) j.target = null;
        if (j.target == null && !pickTarget(m, player, world, inv)) return;

        BlockPos target = j.target;
        if (++j.targetTicks > 900) { // 45 seconds without getting it: give up on that one
            abandonTarget(m);
            return;
        }
        m.getLookControl().setLookAt(Vec3.atCenterOf(target));

        boolean inReach = m.getEyePosition().distanceToSqr(Vec3.atCenterOf(target)) <= REACH_SQ;
        if (inReach && (isExposed(world, target) || isAdjacent(m, target))) {
            m.getNavigation().stop();
            j.stepCell = null;
            startBreaking(m, player, world, inv, target, true);
            return;
        }
        if (j.tunneling && tickTravel(m, world)) return;
        if (j.tunneling) tickTunnel(m, player, world, inv);
        else tickWalk(m, world);
    }

    /** Far away: walk over land toward the target in hops, then dig the rest. Returns false when done. */
    private boolean tickTravel(Mob m, ServerLevel world) {
        Job j = job;
        Vec3 here = m.position();
        double hx = j.target.getX() + 0.5 - here.x;
        double hz = j.target.getZ() + 0.5 - here.z;
        double h = Math.sqrt(hx * hx + hz * hz);
        if (h <= TRAVEL_DISTANCE || j.travelFailures >= 3) return false;
        if (j.travelFrom == null || here.distanceToSqr(j.travelFrom) > 8 * 8) {
            j.travelFrom = here; // making progress
            j.travelFailures = 0;
            j.targetTicks = 0;
        }
        boolean stuck = isStuck(m, 60);
        if (m.getNavigation().isDone() || stuck) {
            stuckTicks = 0;
            if (stuck) j.travelFailures++;
            int wx = (int) Math.floor(here.x + hx / h * 24);
            int wz = (int) Math.floor(here.z + hz / h * 24);
            int wy = world.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, wx, wz);
            Path path = m.getNavigation().createPath(new BlockPos(wx, wy, wz), 3);
            if (path == null || path.getNodeCount() <= 1 || !m.getNavigation().moveTo(path, SPEED)) {
                j.travelFailures++;
            }
        }
        return true;
    }

    private static boolean isAdjacent(Mob m, BlockPos target) {
        BlockPos feet = m.blockPosition();
        int dx = Math.abs(target.getX() - feet.getX());
        int dz = Math.abs(target.getZ() - feet.getZ());
        int dy = target.getY() - feet.getY();
        return dx + dz <= 1 && dy >= -1 && dy <= 2;
    }

    private void tickWalk(Mob m, ServerLevel world) {
        Job j = job;
        boolean stuck = isStuck(m, 40);
        if (m.getNavigation().isDone() || stuck) {
            stuckTicks = 0;
            if (++j.pathFailures > 2) {
                j.tunneling = true; // walking isn't working; dig a way there instead
                return;
            }
            Path path = m.getNavigation().createPath(j.target, 2);
            if (path == null || !m.getNavigation().moveTo(path, SPEED)) j.tunneling = true;
        }
    }

    private boolean pickTarget(Mob m, ServerPlayer player, ServerLevel world, SimpleContainer inv) {
        Job j = job;
        j.targetTicks = 0;
        j.pathFailures = 0;
        j.stepCell = null;
        stuckTicks = 0;

        // 1. Keep going along the vein / tree we're already on.
        while (!j.vein.isEmpty()) {
            BlockPos p = j.vein.pollFirst();
            if (isValidTarget(world, p, false)) {
                if (!checkTool(player, world, inv, p)) return false;
                j.target = p;
                Path path = m.getNavigation().createPath(p, 2);
                j.tunneling = path == null || !path.canReach();
                if (!j.tunneling) m.getNavigation().moveTo(path, SPEED);
                return true;
            }
        }

        // 2. Working off a mine landing: dig straight branch tunnels and take the ore they uncover.
        if (j.mineState == MineState.WORK && currentEntry != null && branchFrom >= 0) {
            return pickFromBranch(m, player, world, inv, currentEntry);
        }

        // 3. Nearest blocks around us, widening the search when we run out.
        j.candidates.removeIf(p -> !isValidTarget(world, p, true));
        while (j.candidates.isEmpty()) {
            if (j.scanStage + 1 >= SCAN_RADII.length) {
                // Nothing in the loaded area: load chunks further out until we find some.
                if (!farSearch(m, player, world, inv)) return false;
                break;
            }
            j.scanStage++;
            scan(world, m.blockPosition(), SCAN_RADII[j.scanStage][0], SCAN_RADII[j.scanStage][1], j);
            j.candidates.removeIf(p -> !isValidTarget(world, p, true));
        }
        Vec3 here = m.position();
        j.candidates.sort(Comparator.comparingDouble(p -> Vec3.atCenterOf(p).distanceToSqr(here)));

        // 3. Of the closest few, pick the cheapest: walk if there's a path, otherwise dig.
        BlockPos best = null;
        Path bestPath = null;
        double bestCost = Double.MAX_VALUE;
        for (int i = 0; i < Math.min(PATH_CHECKS, j.candidates.size()); i++) {
            BlockPos p = j.candidates.get(i);
            double dist = Math.sqrt(Vec3.atCenterOf(p).distanceToSqr(here));
            double cost;
            Path path = null;
            if (m.getEyePosition().distanceToSqr(Vec3.atCenterOf(p)) <= REACH_SQ && isExposed(world, p)) {
                cost = 0;
            } else {
                if (isExposed(world, p)) path = m.getNavigation().createPath(p, 2);
                if (path != null && path.canReach()) cost = path.getNodeCount();
                else {
                    path = null;
                    cost = dist * 3 + 4; // digging is slower than walking
                }
            }
            if (cost < bestCost) {
                bestCost = cost;
                best = p;
                bestPath = path;
            }
            if (cost == 0) break;
        }
        if (best == null) return false;
        if (!checkTool(player, world, inv, best)) return false;
        if (bestPath == null && bestCost > 0 && currentEntry != null && isDeepUnderground(world, m, best)) {
            // No way to walk there (no cave or open access): use our mine instead of digging a random hole.
            startMine(m, player, world, currentEntry, best);
            return false;
        }
        j.target = best;
        j.candidates.remove(best);
        j.tunneling = bestPath == null && bestCost > 0;
        if (bestPath != null) m.getNavigation().moveTo(bestPath, SPEED);
        return true;
    }

    // ---------------------------------------------------------------------------------------
    // The mine: a reusable spiral staircase from the base, with landings every few blocks
    // ---------------------------------------------------------------------------------------

    /*
     * Branch mining. At each landing the helper digs straight 2-tall tunnels out from the staircase, like
     * a player strip-mining, instead of a separate tunnel to every ore. It only digs branches that have
     * ore along them, takes any ore it can reach from the tunnel (following veins), and then goes back
     * to the stairs. Branches always leave the stairs' 2x2 footprint on the outside, so they never cut
     * into the steps above or below.
     */
    private boolean pickFromBranch(Mob m, ServerPlayer player, ServerLevel world, SimpleContainer inv,
                                   HelperData.Entry entry) {
        Job j = job;
        BlockPos landing = stepPos(entry, branchFrom);
        boolean atBottom = landing.getY() <= j.mineTargetY;
        int length = (atBottom ? BRANCH_LENGTH * 2 : BRANCH_LENGTH) + j.lengthBonus;
        if (!j.landingScanned) {
            j.landingScanned = true;
            scan(world, landing, length + BRANCH_REACH, 6, j);
            planBranches(world, entry, landing, length);
        }
        j.candidates.removeIf(p -> !isValidTarget(world, p, true));

        // Ore we can reach from where we stand in the tunnel: take it (short pokes into the wall are fine).
        Vec3 eye = m.getEyePosition();
        BlockPos reachable = null;
        double best = Double.MAX_VALUE;
        for (BlockPos p : j.candidates) {
            double d = eye.distanceToSqr(Vec3.atCenterOf(p));
            if (d <= REACH_SQ && d < best && Math.abs(p.getY() - landing.getY()) <= 3) {
                best = d;
                reachable = p;
            }
        }
        if (reachable != null) {
            if (!checkTool(player, world, inv, reachable)) return false;
            j.target = reachable;
            j.candidates.remove(reachable);
            j.tunneling = !isExposed(world, reachable);
            return true;
        }
        tickBranch(m, player, world, inv, entry, landing, length, atBottom);
        return false;
    }

    /** Which ways to dig from this landing: the two outward directions, most ore first, skipping empty ones. */
    private void planBranches(ServerLevel world, HelperData.Entry entry, BlockPos landing, int length) {
        Job j = job;
        j.branchQueue.clear();
        j.branchDir = null;
        int cx = landing.getX() - entry.mineOrigin.getX(), cz = landing.getZ() - entry.mineOrigin.getZ();
        Direction[] out = {cx == 0 ? Direction.WEST : Direction.EAST, cz == 0 ? Direction.NORTH : Direction.SOUTH};
        int[] counts = new int[2];
        for (BlockPos p : j.candidates) {
            int rx = p.getX() - landing.getX(), rz = p.getZ() - landing.getZ(), ry = p.getY() - landing.getY();
            if (Math.abs(ry) > 3) continue;
            for (int k = 0; k < 2; k++) {
                int along = rx * out[k].getStepX() + rz * out[k].getStepZ();
                int side = Math.abs(rx * out[k].getStepZ() - rz * out[k].getStepX());
                if (along >= 1 && along <= length + 1 && side <= BRANCH_REACH) counts[k]++;
            }
        }
        if (j.blind) { // strip-mining for more: dig both ways whether or not ore shows up yet
            j.blind = false;
            j.branchQueue.add(counts[1] > counts[0] ? out[1] : out[0]);
            j.branchQueue.add(counts[1] > counts[0] ? out[0] : out[1]);
        } else if (counts[0] >= counts[1]) {
            if (counts[0] > 0) j.branchQueue.add(out[0]);
            if (counts[1] > 0) j.branchQueue.add(out[1]);
        } else {
            j.branchQueue.add(out[1]);
            if (counts[0] > 0) j.branchQueue.add(out[0]);
        }
        if (DEBUG) HelperMod.LOG.info("[helper debug] landing {} branches {} counts {} {}", landing, j.branchQueue,
                counts[0], counts[1]);
    }

    /** Dig the current branch one block further, or start the next one, or head back to the stairs. */
    private void tickBranch(Mob m, ServerPlayer player, ServerLevel world, SimpleContainer inv,
                            HelperData.Entry entry, BlockPos landing, int length, boolean atBottom) {
        Job j = job;
        if (j.stepCell != null) { // stepping into the block we just opened
            BlockPos cell = j.stepCell;
            Vec3 c = Vec3.atBottomCenterOf(cell);
            if (m.blockPosition().equals(cell) || m.position().distanceToSqr(c) < 0.15) j.stepCell = null;
            else if (++j.stepTicks > 25) {
                m.teleportTo(c.x, c.y, c.z);
                j.stepCell = null;
            } else m.getMoveControl().setWantedPosition(c.x, c.y, c.z, SPEED);
            return;
        }
        if (j.branchDir != null && j.branchLen >= length) j.branchDir = null; // this branch is finished
        if (j.branchDir == null) {
            if (j.branchQueue.isEmpty()) {
                if (atBottom) {
                    stripMineFurther(player, inv, entry, branchFrom);
                } else {
                    j.mineState = MineState.DESCEND; // back to the stairs, next landing down
                }
                return;
            }
            j.branchDir = j.branchQueue.pollFirst();
            j.branchLen = 0;
            j.branchTicks = 0;
        }
        Direction d = j.branchDir;
        BlockPos head = landing.relative(d, j.branchLen); // where we should be standing
        BlockPos next = head.relative(d);
        // Get back to the end of the tunnel first (e.g. after mining a bit of ore off to the side).
        if (!m.blockPosition().equals(head) && m.position().distanceToSqr(Vec3.atBottomCenterOf(head)) > 0.5) {
            if (m.getNavigation().isDone() || isStuck(m, 40)) {
                Path path = m.getNavigation().createPath(head, 0);
                if (path != null) m.getNavigation().moveTo(path, SPEED);
            }
            if (++j.branchTicks > 200) {
                m.teleportTo(head.getX() + 0.5, head.getY(), head.getZ() + 0.5);
                j.branchTicks = 0;
            }
            return;
        }
        j.branchTicks = 0;
        j.targetTicks = 0;
        for (BlockPos cell : new BlockPos[]{next.above(), next}) {
            BlockState s = world.getBlockState(cell);
            if (s.getFluidState().is(FluidTags.LAVA) || lavaNear(world, cell)) {
                if (!sealLava(world, inv, cell, head)) j.branchDir = null; // can't make it safe: stop this branch
                return;
            }
            if (passable(world, cell)) continue;
            if (!canDigThrough(world, cell, s)) {
                j.branchDir = null; // something built or unbreakable: end the branch here
                return;
            }
            startBreaking(m, player, world, inv, cell, j.spec.matches(s));
            return;
        }
        // Keep the tunnel floor solid so it stays a straight, walkable line.
        BlockPos floor = next.below();
        BlockState fs = world.getBlockState(floor);
        if (!fs.isFaceSturdy(world, floor, Direction.UP)) {
            int slot = buildingBlockSlot(inv);
            if (slot >= 0 && fs.canBeReplaced()) placeBlock(world, inv, slot, floor);
            else if (!hasGroundWithin(world, floor, 1)) {
                j.branchDir = null; // a drop into a cave and nothing to bridge with
                return;
            }
        }
        j.branchLen++;
        j.stepCell = next;
        j.stepTicks = 0;
        m.getNavigation().stop();
        Vec3 c = Vec3.atBottomCenterOf(next);
        m.getMoveControl().setWantedPosition(c.x, c.y, c.z, SPEED);
    }

    private static boolean isDeepUnderground(ServerLevel world, Mob m, BlockPos target) {
        int surface = world.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, target.getX(), target.getZ());
        return target.getY() < m.getBlockY() - 3 && target.getY() < surface - 4;
    }

    static BlockPos stepPos(HelperData.Entry entry, int i) {
        int[] c = SPIRAL[i & 3];
        return entry.mineOrigin.offset(c[0], -i, c[1]);
    }

    private int bottomStep(ServerLevel world, HelperData.Entry entry) {
        return Math.max(0, entry.mineOrigin.getY() - (world.getMinY() + 6));
    }

    private void startMine(Mob m, ServerPlayer player, ServerLevel world, HelperData.Entry entry,
                           BlockPos target) {
        Job j = job;
        String dim = world.dimension().identifier().toString();
        boolean marked = entry.mineMarker != null && entry.mineOrigin != null && dim.equals(entry.mineDim);
        boolean reuse = marked || (entry.mineOrigin != null && dim.equals(entry.mineDim)
                && horizontalDistanceSq(entry.mineOrigin, m.blockPosition()) < 256 * 256);
        if (!reuse) {
            BlockPos spot = findMineSpot(world, m.blockPosition());
            if (spot == null) {
                finishJob(player, entry.inventory, "I'd have to dig a mine to reach " + j.spec.display
                        + ", but there's no open ground nearby that's away from buildings. "
                        + "Place a Mine Marker (/helper mine marker) where you want my mine, or take me somewhere with plain ground.");
                return;
            }
            entry.mineOrigin = spot;
            entry.mineDim = dim;
            entry.mineDepth = 0;
            HelperData.get(world.getServer()).setDirty();
            say(player, "There's no cave I can walk through to get there, so I'm digging a mine at "
                    + entry.mineOrigin.getX() + ", " + entry.mineOrigin.getY() + ", " + entry.mineOrigin.getZ()
                    + ". It's a staircase you can use too, and I'll use it every time I go underground.");
        } else if (mineStep < 0) {
            say(player, "Heading down my mine for " + j.spec.display + ".");
        }
        if (DEBUG) HelperMod.LOG.info("[helper debug] start mine for {} candidates {}", target, j.candidates.size());
        // Aim for the depth where the nearest few targets are.
        List<Integer> ys = new ArrayList<>();
        ys.add(target.getY());
        BlockPos o = entry.mineOrigin;
        j.candidates.stream()
                .sorted(Comparator.comparingDouble(p -> horizontalDistanceSq(p, o)))
                .limit(20).forEach(p -> ys.add(p.getY()));
        ys.sort(null);
        int median = ys.get(ys.size() / 2);
        j.mineTargetY = Math.max(world.getMinY() + 6, median);
        j.mineState = MineState.DESCEND;
        j.landingScanned = false;
        j.doneLanding = -1;
        j.branchQueue.clear();
        j.branchDir = null;
        j.target = null;
    }

    private static double horizontalDistanceSq(BlockPos a, BlockPos b) {
        double dx = a.getX() - b.getX(), dz = a.getZ() - b.getZ();
        return dx * dx + dz * dz;
    }

    /** Down the stairs, stopping at every landing to mine what's around. */
    private void tickDescend(Mob m, ServerPlayer player, ServerLevel world, HelperData.Entry entry) {
        Job j = job;
        if (entry.mineOrigin == null) {
            j.mineState = MineState.NONE;
            return;
        }
        if (mineStep < 0 && branchFrom < 0) {
            if (!goToStep(m, player, world, entry, 0)) return;
        }
        if (branchFrom >= 0) { // came back from a side tunnel
            if (!goToStep(m, player, world, entry, branchFrom)) return;
        }
        BlockPos here = stepPos(entry, mineStep);
        boolean landing = mineStep > 0 && mineStep % LANDING_EVERY == 0;
        boolean atDepth = here.getY() <= j.mineTargetY || mineStep >= bottomStep(world, entry);
        if ((landing || atDepth) && j.doneLanding != mineStep) {
            // Stop at this layer and look for ore around it.
            j.mineState = MineState.WORK;
            j.doneLanding = mineStep;
            j.landingScanned = false;
            branchFrom = mineStep;
            mineStep = -1;
            j.target = null;
            return;
        }
        if (atDepth) {
            stripMineFurther(player, entry.inventory, entry, mineStep);
            return;
        }
        goToStep(m, player, world, entry, mineStep + 1);
    }

    /**
     * Move one step at a time along the staircase toward step {@code goal}, digging new steps when
     * going deeper than the mine has been dug. Returns true once standing on the goal step.
     */
    private boolean goToStep(Mob m, ServerPlayer player, ServerLevel world, HelperData.Entry entry,
                             int goal) {
        if (entry.mineOrigin == null) return true;
        // Out in a side tunnel: walk back to the landing we came from.
        if (branchFrom >= 0) {
            BlockPos landing = stepPos(entry, branchFrom);
            if (m.blockPosition().equals(landing) || m.position().distanceToSqr(Vec3.atBottomCenterOf(landing)) < 0.5) {
                mineStep = branchFrom;
                branchFrom = -1;
                stairTicks = 0;
            } else {
                if (m.getNavigation().isDone() || isStuck(m, 40)) {
                    Path path = m.getNavigation().createPath(landing, 0);
                    if (path != null) m.getNavigation().moveTo(path, SPEED);
                }
                if (++stairTicks > 200) { // tunnel got blocked somehow: hop back
                    m.teleportTo(landing.getX() + 0.5, landing.getY(), landing.getZ() + 0.5);
                    stairTicks = 0;
                }
                return false;
            }
        }
        // Not on the stairs yet: walk to the entrance.
        if (mineStep < 0) {
            BlockPos top = stepPos(entry, 0);
            if (m.blockPosition().equals(top) || m.position().distanceToSqr(Vec3.atBottomCenterOf(top)) < 0.6) {
                mineStep = 0;
                stairTicks = 0;
            } else {
                if (m.getNavigation().isDone() || isStuck(m, 60)) {
                    Path path = m.getNavigation().createPath(top, 0);
                    if (path != null) m.getNavigation().moveTo(path, SPEED);
                }
                if (++stairTicks > 400) {
                    m.teleportTo(top.getX() + 0.5, top.getY(), top.getZ() + 0.5);
                    stairTicks = 0;
                }
                return false;
            }
        }
        if (mineStep == goal) return true;
        int next = mineStep + Integer.signum(goal - mineStep);
        BlockPos cell = stepPos(entry, next);
        if (!prepareStep(m, player, world, entry, cell)) return false; // digging / sealing this tick
        Vec3 c = Vec3.atBottomCenterOf(cell);
        if (m.blockPosition().equals(cell) || m.position().distanceToSqr(c) < 0.15) {
            mineStep = next;
            stairTicks = 0;
            if (next > entry.mineDepth) {
                entry.mineDepth = next;
                HelperData.get(world.getServer()).setDirty();
            }
            return mineStep == goal;
        }
        m.getNavigation().stop();
        m.getMoveControl().setWantedPosition(c.x, c.y, c.z, SPEED);
        if (++stairTicks > 25) {
            m.teleportTo(c.x, c.y, c.z);
            stairTicks = 0;
        }
        return false;
    }

    /** Make sure a stair step is open, sealed from lava and water, and has a floor. False while working on it. */
    private boolean prepareStep(Mob m, ServerPlayer player, ServerLevel world, HelperData.Entry entry,
                                BlockPos cell) {
        if (job == null) return true; // nothing to dig with; just walk (and hop if blocked)
        SimpleContainer inv = entry.inventory;
        for (int dy = 2; dy >= 0; dy--) {
            BlockPos p = cell.above(dy);
            BlockState s = world.getBlockState(p);
            if (!s.getFluidState().isEmpty() || fluidNear(world, p, entry)) {
                if (sealFluids(world, inv, p, entry)) return false;
                if (!s.getFluidState().isEmpty()) {
                    say(player, "There's water or lava in the way of my mine and I have nothing to block it with. "
                            + "Give me some cobblestone or dirt.");
                    finishJob(player, inv, "I'll come back up for now.");
                    return false;
                }
            }
            if (s.getCollisionShape(world, p).isEmpty()) continue;
            if (s.hasBlockEntity() || s.getDestroySpeed(world, p) < 0 || protectedHere(world, p, s)) {
                say(player, "My mine ran into something that looks built or that I can't dig through, at "
                        + p.toShortString() + ", so I left it alone. I'll start a new mine somewhere else next time.");
                if (entry.mineMarker == null) entry.mineOrigin = null;
                else say(player, "Move your Mine Marker somewhere clear so I can keep digging.");
                finishJob(player, inv, "Coming back up.");
                return false;
            }
            job.targetTicks = 0;
            startBreaking(m, player, world, inv, p, job.spec.matches(s));
            return false;
        }
        BlockPos floor = cell.below();
        BlockState fs = world.getBlockState(floor);
        if (!fs.isFaceSturdy(world, floor, Direction.UP) && fs.canBeReplaced()) {
            int slot = buildingBlockSlot(inv);
            if (slot >= 0) placeBlock(world, inv, slot, floor);
        }
        return true;
    }

    private boolean isMineCell(HelperData.Entry entry, BlockPos p) {
        BlockPos o = entry.mineOrigin;
        int dx = p.getX() - o.getX(), dz = p.getZ() - o.getZ();
        if (dx < 0 || dx > 1 || dz < 0 || dz > 1) return false;
        for (int i = 0; i < 4; i++) {
            if (SPIRAL[i][0] != dx || SPIRAL[i][1] != dz) continue;
            int step = o.getY() - p.getY();
            // Each column is open for its step's feet and the two blocks above.
            for (int k = 0; k <= 2; k++) if (Math.floorMod(step + k - i, 4) == 0) return true;
        }
        return false;
    }

    private boolean fluidNear(ServerLevel world, BlockPos p, HelperData.Entry entry) {
        for (Direction dir : Direction.values()) {
            BlockPos n = p.relative(dir);
            if (!world.getFluidState(n).isEmpty() && !isMineCell(entry, n)) return true;
        }
        return false;
    }

    /** Plug water and lava touching the mine. True if it placed something (call again next tick). */
    private boolean sealFluids(ServerLevel world, SimpleContainer inv, BlockPos p, HelperData.Entry entry) {
        boolean placed = false;
        List<BlockPos> spots = new ArrayList<>();
        if (!world.getFluidState(p).isEmpty()) spots.add(p);
        for (Direction dir : Direction.values()) {
            BlockPos n = p.relative(dir);
            if (!world.getFluidState(n).isEmpty() && !isMineCell(entry, n)) spots.add(n);
        }
        for (BlockPos spot : spots) {
            int slot = buildingBlockSlot(inv);
            if (slot < 0) return placed;
            placeBlock(world, inv, slot, spot);
            placed = true;
        }
        return placed;
    }

    /** Make sure we can actually harvest this block; otherwise tell the owner what we need. */
    private boolean checkTool(ServerPlayer player, ServerLevel world, SimpleContainer inv, BlockPos p) {
        BlockState state = world.getBlockState(p);
        int slot = Mining.bestToolSlot(inv, state, world, p, true, job.spec.preferSilk);
        ItemStack tool = slot >= 0 ? inv.getItem(slot) : ItemStack.EMPTY;
        if (!Mining.canHarvest(tool, state)) {
            for (int i = 0; i < inv.getContainerSize(); i++) {
                ItemStack worn = inv.getItem(i);
                if (!worn.isEmpty() && !Mining.isUsableTool(worn) && worn.isCorrectToolForDrops(state)) {
                    finishJob(player, inv, "My " + worn.getHoverName().getString() + " is worn out (it would break). "
                            + "Give me a new one or repair it, and I'll mine " + Mining.blockName(state.getBlock()) + ".");
                    return false;
                }
            }
            finishJob(player, inv, "I need " + Mining.requiredToolName(state) + " to mine "
                    + Mining.blockName(state.getBlock()) + ". Right-click me and put one in my inventory.");
            return false;
        }
        if (tool.isEmpty() && !job.toldAboutHands && Mining.breakTicks(tool, state, world, p) > 20) {
            job.toldAboutHands = true;
            say(player, "I'm doing this by hand. Put a tool in my inventory (right-click me) and I'll be faster.");
        }
        return true;
    }

    private boolean isValidTarget(ServerLevel world, BlockPos p, boolean checkTree) {
        Job j = job;
        if (j.blacklist.contains(p) || !world.hasChunkAt(p)) return false;
        BlockState state = world.getBlockState(p);
        if (!j.spec.matches(state)) return false;
        if (checkTree && state.is(BlockTags.LOGS)) return isPartOfTree(world, p);
        return true;
    }

    /** Logs only count if they're part of a real tree (natural leaves nearby), so cabins are safe. */
    private static boolean isPartOfTree(ServerLevel world, BlockPos p) {
        BlockPos.MutableBlockPos q = new BlockPos.MutableBlockPos();
        for (int dy = -1; dy <= 8; dy++) {
            for (int dx = -3; dx <= 3; dx++) {
                for (int dz = -3; dz <= 3; dz++) {
                    q.set(p.getX() + dx, p.getY() + dy, p.getZ() + dz);
                    BlockState s = world.getBlockState(q);
                    if (s.is(BlockTags.LEAVES) && Materials.isGatherable(s)) return true;
                }
            }
        }
        return false;
    }

    private static boolean isExposed(Level world, BlockPos p) {
        for (Direction dir : Direction.values()) {
            BlockPos n = p.relative(dir);
            if (!world.getBlockState(n).isSolidRender(world, n)) return true;
        }
        return false;
    }

    private static void scan(ServerLevel world, BlockPos center, int radius, int vertical, Job j) {
        int minY = Math.max(world.getMinY(), center.getY() - vertical);
        int maxY = Math.min(world.getMaxBuildHeight() - 1, center.getY() + vertical);
        Set<BlockPos> seen = new HashSet<>(j.candidates);
        for (int cx = (center.getX() - radius) >> 4; cx <= (center.getX() + radius) >> 4; cx++) {
            for (int cz = (center.getZ() - radius) >> 4; cz <= (center.getZ() + radius) >> 4; cz++) {
                LevelChunk chunk = world.getChunkSource().getChunkNow(cx, cz);
                if (chunk == null) continue;
                scanChunk(world, chunk, minY, maxY, j, seen, center, radius);
            }
        }
        if (j.candidates.size() > MAX_CANDIDATES) {
            j.candidates.sort(Comparator.comparingDouble(p -> p.distSqr(center)));
            j.candidates.subList(MAX_CANDIDATES, j.candidates.size()).clear();
        }
    }

    /** Add every matching block in this chunk (within the radius of center, if given) to the candidates. */
    private static void scanChunk(ServerLevel world, LevelChunk chunk, int minY, int maxY, Job j,
                                  Set<BlockPos> seen, BlockPos center, int radius) {
        int r2 = radius * radius;
        int cx = chunk.getPos().x(), cz = chunk.getPos().z();
        LevelChunkSection[] sections = chunk.getSections();
        for (int si = 0; si < sections.length; si++) {
            int baseY = SectionPos.sectionToBlockCoord(world.getMinSection() + si);
            if (baseY + 15 < minY || baseY > maxY) continue;
            LevelChunkSection section = sections[si];
            if (section == null || section.hasOnlyAir() || !section.maybeHas(j.spec::matches)) continue;
            for (int y = 0; y < 16; y++) {
                int wy = baseY + y;
                if (wy < minY || wy > maxY) continue;
                for (int z = 0; z < 16; z++) {
                    for (int x = 0; x < 16; x++) {
                        if (!j.spec.matches(section.getBlockState(x, y, z))) continue;
                        int wx = (cx << 4) + x, wz = (cz << 4) + z;
                        if (center != null) {
                            int ddx = wx - center.getX(), ddz = wz - center.getZ();
                            if (ddx * ddx + ddz * ddz > r2) continue;
                        }
                        BlockPos p = new BlockPos(wx, wy, wz);
                        if (seen.add(p)) j.candidates.add(p);
                    }
                }
            }
        }
    }

    /**
     * Nothing in the loaded area: load chunks ring by ring around where we are (a few at a time, so the
     * server doesn't lag) and scan each one as it arrives. Returns true once there are candidates.
     */
    private boolean farSearch(Mob m, ServerPlayer player, ServerLevel world, SimpleContainer inv) {
        Job j = job;
        if (j.farRing < 0) {
            j.farOrigin = new ChunkPos(m.blockPosition());
            j.farRing = FAR_START_RING;
            j.farQueue.clear();
            j.farPending.clear();
            queueRing(j);
            if (!j.toldFarSearch) {
                j.toldFarSearch = true;
                say(player, "There's no " + j.spec.display + " close by, so I'm searching further out. "
                        + "This can take a little while.");
            }
        }
        ServerChunkCache chunks = world.getChunkSource();
        Set<BlockPos> seen = new HashSet<>(j.candidates);
        for (java.util.Iterator<ChunkPos> it = j.farPending.iterator(); it.hasNext(); ) {
            ChunkPos cp = it.next();
            LevelChunk chunk = chunks.getChunkNow(cp.x(), cp.z());
            if (chunk == null) continue; // still loading / generating
            it.remove();
            scanChunk(world, chunk, world.getMinY(), world.getMaxBuildHeight() - 1, j, seen, null, 0);
        }
        while (j.farPending.size() < FAR_PARALLEL) {
            if (j.farQueue.isEmpty()) {
                if (!j.farPending.isEmpty() || !j.candidates.isEmpty()) break; // finish this ring first
                if (++j.farRing > FAR_MAX_RING) {
                    finishJob(player, inv, "I searched " + FAR_MAX_RING * 16 + " blocks in every direction and "
                            + "couldn't find any " + j.spec.display + ". It might not exist in this dimension.");
                    return false;
                }
                if (j.farRing % 8 == 0) {
                    say(player, "Still looking for " + j.spec.display + " (" + j.farRing * 16 + " blocks out)...");
                }
                queueRing(j);
            }
            ChunkPos cp = j.farQueue.pollFirst();
            chunks.addRegionTicket(SEARCH_TICKET, cp, 0, cp);
            j.farPending.add(cp);
        }
        j.candidates.removeIf(p -> !isValidTarget(world, p, true));
        return !j.candidates.isEmpty();
    }

    private static void queueRing(Job j) {
        int r = j.farRing;
        for (int dx = -r; dx <= r; dx++) {
            for (int dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) != r) continue;
                j.farQueue.add(new ChunkPos(j.farOrigin.x() + dx, j.farOrigin.z() + dz));
            }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Digging a path (staircases, tunnels, bridging, pillaring)
    // ---------------------------------------------------------------------------------------

    private void tickTunnel(Mob m, ServerPlayer player, ServerLevel world, SimpleContainer inv) {
        Job j = job;
        if (j.stepCell != null) {
            BlockPos cell = j.stepCell;
            Vec3 center = Vec3.atBottomCenterOf(cell);
            if (m.blockPosition().equals(cell) || m.position().distanceToSqr(center) < 0.15) {
                j.stepCell = null;
            } else if (++j.stepTicks > 25) {
                m.teleportTo(center.x, center.y, center.z); // nudge into the freshly dug spot
                j.stepCell = null;
            } else {
                // Step straight into the freshly dug cell (pathfinding is unreliable in 1-wide tunnels).
                m.getMoveControl().setWantedPosition(center.x, center.y, center.z, SPEED);
            }
            return;
        }

        BlockPos cur = m.blockPosition();
        BlockPos target = j.target;
        int dx = target.getX() - cur.getX();
        int dy = target.getY() - cur.getY();
        int dz = target.getZ() - cur.getZ();
        int sx = 0, sz = 0;
        if (Math.abs(dx) >= Math.abs(dz) && dx != 0) sx = Integer.signum(dx);
        else if (dz != 0) sz = Integer.signum(dz);
        int sy = dy >= 2 ? 1 : (dy <= -1 ? -1 : 0);
        if (dy < -2 && -dy > Math.abs(dx) + Math.abs(dz) + 2) {
            sx = 0; // far below: dig straight down instead of a long staircase
            sz = 0;
        }
        if (sx == 0 && sz == 0 && sy == 0) { // target is in our body space; just mine it
            startBreaking(m, player, world, inv, target, true);
            return;
        }
        BlockPos next = cur.offset(sx, sy, sz);
        boolean pillar = sx == 0 && sz == 0 && sy == 1;

        List<BlockPos> toClear = new ArrayList<>();
        if (sy == 1) toClear.add(cur.above(2));
        if (sy == -1) toClear.add(next.above(2));
        toClear.add(next.above());
        toClear.add(next);
        for (BlockPos cell : toClear) {
            if (cell.equals(cur) || cell.equals(cur.above())) continue;
            BlockState s = world.getBlockState(cell);
            if (passable(world, cell)) continue;
            if (s.getFluidState().is(FluidTags.LAVA) || lavaNear(world, cell)) {
                // Plug the lava with a building block (like a player would), then dig on.
                if (!sealLava(world, inv, cell, cur)) abandonTarget(m);
                j.targetTicks = 0;
                return;
            }
            if (!canDigThrough(world, cell, s)) {
                // Something built (or unbreakable) is in the way: phase through it instead of digging.
                if ((sx != 0 || sz != 0) && phaseThrough(m, world, cur, sx, sz)) {
                    j.targetTicks = 0;
                    return;
                }
                abandonTarget(m); // can't get past; try a different one
                return;
            }
            j.targetTicks = 0; // still making progress toward it
            if (sx == 0 && sz == 0 && sy == -1 && cell.equals(next) && world.canSeeSky(cur)) {
                j.shaftTops.add(next.immutable());
            }
            startBreaking(m, player, world, inv, cell, j.spec.matches(s));
            return;
        }

        j.targetTicks = 0;
        if (pillar) {
            int slot = buildingBlockSlot(inv);
            if (slot < 0) {
                abandonTarget(m);
                return;
            }
            if (nearBuild(world, cur, 3, true)) { // never pillar up inside or beside someone's build
                abandonTarget(m);
                return;
            }
            m.getNavigation().stop();
            m.teleportTo(cur.getX() + 0.5, cur.getY() + 1.0, cur.getZ() + 0.5);
            placeBlock(world, inv, slot, cur);
            return;
        }

        BlockPos floor = next.below();
        BlockState floorState = world.getBlockState(floor);
        if (!floorState.isFaceSturdy(world, floor, Direction.UP)) {
            boolean fluid = !floorState.getFluidState().isEmpty();
            if (floorState.canBeReplaced() && (fluid || passable(world, floor))) {
                int slot = buildingBlockSlot(inv);
                if (slot >= 0 && nearBuild(world, floor, 3, true)) {
                    abandonTarget(m); // don't bridge through someone's build
                    return;
                } else if (slot >= 0) {
                    placeBlock(world, inv, slot, floor); // bridge over the gap, water or lava
                } else if (floorState.getFluidState().is(FluidTags.LAVA)
                        || (!fluid && !hasGroundWithin(world, floor, 3))) {
                    abandonTarget(m); // too dangerous and nothing to bridge with
                    return;
                }
            }
            // Otherwise it's something odd (slab, fence...) under the next step. Fine to walk on.
        }
        j.stepCell = next;
        j.stepTicks = 0;
        m.getNavigation().stop();
        Vec3 c = Vec3.atBottomCenterOf(next);
        m.getMoveControl().setWantedPosition(c.x, c.y, c.z, SPEED);
    }

    private void plugShafts(ServerLevel world, SimpleContainer inv) {
        for (BlockPos top : job.shaftTops) {
            if (!world.hasChunkAt(top) || !world.getBlockState(top).isAir()) continue;
            if (mob != null && mob.getBoundingBox().intersects(new net.minecraft.world.phys.AABB(top))) continue;
            if (nearBuild(world, top, 2, true)) continue; // leave holes next to builds for the owner to deal with
            int slot = buildingBlockSlot(inv);
            if (slot < 0) break;
            placeBlock(world, inv, slot, top);
        }
        job.shaftTops.clear();
    }

    /** Cover any lava in or next to the cell we're about to open. False if we ran out of blocks. */
    private boolean sealLava(ServerLevel world, SimpleContainer inv, BlockPos cell, BlockPos cur) {
        List<BlockPos> spots = new ArrayList<>();
        if (world.getFluidState(cell).is(FluidTags.LAVA)) spots.add(cell);
        for (Direction dir : Direction.values()) {
            BlockPos n = cell.relative(dir);
            if (n.equals(cur) || n.equals(cur.above())) continue;
            if (world.getFluidState(n).is(FluidTags.LAVA)) spots.add(n);
        }
        if (spots.isEmpty()) return false; // the lava is where we're standing; go a different way
        for (BlockPos spot : spots) {
            int slot = buildingBlockSlot(inv);
            if (slot < 0) return false;
            placeBlock(world, inv, slot, spot);
        }
        return true;
    }

    /**
     * Natural terrain is always fine to dig through. Deep underground (well below the surface, where
     * nobody builds) anything that isn't obviously player-made is fine too, e.g. modded stone or sculk.
     */
    private boolean canDigThrough(ServerLevel world, BlockPos pos, BlockState s) {
        if (protectedHere(world, pos, s)) return false;
        if (Materials.isTerrain(s) || job.spec.matches(s)) return true;
        if (s.hasBlockEntity()) return false;
        float hardness = s.getDestroySpeed(world, pos);
        if (hardness < 0 || hardness >= 30) return false;
        int surface = world.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, pos.getX(), pos.getZ());
        if (pos.getY() > surface - 8) return false;
        return !Materials.looksPlayerMade(s);
    }

    // ---------------------------------------------------------------------------------------
    // Not breaking people's builds
    // ---------------------------------------------------------------------------------------

    /**
     * True when a block is probably part of something a player built, so a helper must leave it alone.
     * Near the surface that means anything that looks placed (planks, glass, bricks, doors...) and any
     * block within two blocks of one, so house floors and stone walls are safe too. Deep underground
     * only blocks next to chests, beds, furnaces and similar are protected, so caves stay minable.
     */
    /**
     * isProtected, except right around the owner's Mine Marker: there the player chose the spot, so only
     * blocks that are themselves built (planks, glass, chests...) are off limits, not their neighbours.
     */
    private boolean protectedHere(ServerLevel world, BlockPos pos, BlockState s) {
        HelperData.Entry e = currentEntry;
        if (e != null && e.mineMarker != null && e.mineOrigin != null
                && world.dimension().identifier().toString().equals(e.mineDim)
                && Math.abs(pos.getX() - e.mineOrigin.getX()) <= 3 && Math.abs(pos.getZ() - e.mineOrigin.getZ()) <= 3) {
            if (pos.equals(e.mineMarker)) return true; // never dig up the marker itself
            if (s.is(net.minecraft.world.level.block.Blocks.SPAWNER)) return false;
            return s.hasBlockEntity() || isBuildEvidence(s);
        }
        return isProtected(world, pos, s);
    }

    static boolean isProtected(ServerLevel world, BlockPos pos, BlockState s) {
        if (s.isAir() || s.is(net.minecraft.world.level.block.Blocks.SPAWNER)) return false;
        if (s.hasBlockEntity()) return true;
        int surface = world.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, pos.getX(), pos.getZ());
        boolean shallow = pos.getY() > surface - 8;
        if (shallow && isBuildEvidence(s)) return true;
        return nearBuild(world, pos, 2, shallow);
    }

    /** Is there a placed-looking block (or, when deep, a chest/bed/furnace) within radius? */
    static boolean nearBuild(ServerLevel world, BlockPos center, int radius, boolean shallow) {
        BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dy = -radius; dy <= radius; dy++) {
                for (int dz = -radius; dz <= radius; dz++) {
                    if (dx == 0 && dy == 0 && dz == 0) continue;
                    p.set(center.getX() + dx, center.getY() + dy, center.getZ() + dz);
                    BlockState s = world.getBlockState(p);
                    if (s.isAir()) continue;
                    if (s.hasBlockEntity()) {
                        if (!s.is(net.minecraft.world.level.block.Blocks.SPAWNER)) return true;
                        continue;
                    }
                    if (shallow && isBuildEvidence(s)) return true;
                }
            }
        }
        return false;
    }

    /** Placed-looking blocks, minus torches (helpers light their own mines) and logs (trees). */
    private static boolean isBuildEvidence(BlockState s) {
        if (s.is(BlockTags.LOGS) || s.is(BlockTags.LEAVES)) return false;
        if (s.is(net.minecraft.world.level.block.Blocks.TORCH) || s.is(net.minecraft.world.level.block.Blocks.WALL_TORCH)) return false;
        if (Materials.isTerrain(s)) return false;
        return Materials.looksPlayerMade(s);
    }

    private static final int[][] MINE_SPOT_OFFSETS = buildMineSpotOffsets();

    private static int[][] buildMineSpotOffsets() {
        List<int[]> list = new ArrayList<>();
        for (int dx = -30; dx <= 30; dx += 3) {
            for (int dz = -30; dz <= 30; dz += 3) {
                if (dx * dx + dz * dz <= 30 * 30) list.add(new int[]{dx, dz});
            }
        }
        list.sort(Comparator.comparingInt(o -> o[0] * o[0] + o[1] * o[1]));
        return list.toArray(new int[0][]);
    }

    /** The nearest open, natural ground with nothing built close by, for a new staircase mine. */
    private static BlockPos findMineSpot(ServerLevel world, BlockPos near) {
        for (int[] o : MINE_SPOT_OFFSETS) {
            int x = near.getX() + o[0], z = near.getZ() + o[1];
            if (!world.getChunkSource().hasChunk(x >> 4, z >> 4)
                    || !world.getChunkSource().hasChunk((x + 2) >> 4, (z + 2) >> 4)
                    || !world.getChunkSource().hasChunk((x - 1) >> 4, (z - 1) >> 4)) continue;
            BlockPos top = world.getHeightmapPos(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, new BlockPos(x, 0, z));
            if (goodMineSpot(world, top)) return top;
        }
        return null;
    }

    private static boolean goodMineSpot(ServerLevel world, BlockPos top) {
        // The staircase uses a 2x2 column; check a ring around it too.
        for (int dx = -1; dx <= 2; dx++) {
            for (int dz = -1; dz <= 2; dz++) {
                int x = top.getX() + dx, z = top.getZ() + dz;
                int ty = world.getHeight(Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, x, z);
                if (Math.abs(ty - top.getY()) > 2) return false; // roofs, walls or a cliff
                BlockPos ground = new BlockPos(x, ty - 1, z);
                if (!world.getFluidState(ground).isEmpty() || !world.getFluidState(ground.above()).isEmpty()) return false;
                if (!Materials.isTerrain(world.getBlockState(ground))) return false;
            }
        }
        return !nearBuild(world, top.below(), 5, true);
    }

    private static boolean hasGroundWithin(Level world, BlockPos from, int depth) {
        for (int i = 1; i <= depth; i++) {
            BlockPos p = from.below(i);
            BlockState s = world.getBlockState(p);
            if (s.getFluidState().is(FluidTags.LAVA)) return false;
            if (s.isFaceSturdy(world, p, Direction.UP)) return true;
        }
        return false;
    }

    private static boolean lavaNear(Level world, BlockPos cell) {
        for (Direction dir : Direction.values()) {
            if (world.getFluidState(cell.relative(dir)).is(FluidTags.LAVA)) return true;
        }
        return false;
    }

    private static boolean isBuildingBlock(ItemStack stack) {
        if (!(stack.getItem() instanceof BlockItem bi)) return false;
        BlockState s = bi.getBlock().defaultBlockState();
        if (s.hasBlockEntity() || bi.getBlock() instanceof net.minecraft.world.level.block.FallingBlock) return false;
        Item item = stack.getItem();
        String path = net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(item).getPath();
        return s.is(BlockTags.BASE_STONE_OVERWORLD) || s.is(BlockTags.BASE_STONE_NETHER)
                || s.is(BlockTags.DIRT) || path.equals("cobblestone") || path.equals("cobbled_deepslate");
    }

    private int buildingBlockSlot(SimpleContainer inv) {
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack stack = inv.getItem(i);
            if (!stack.isEmpty() && isBuildingBlock(stack) && !job.spec.counts(stack)) return i;
        }
        return -1;
    }

    private static void placeBlock(ServerLevel world, SimpleContainer inv, int slot, BlockPos pos) {
        ItemStack stack = inv.getItem(slot);
        Block block = ((BlockItem) stack.getItem()).getBlock();
        BlockState state = block.defaultBlockState();
        world.setBlockAndUpdate(pos, state);
        world.playSound(null, pos, state.getSoundType().getPlaceSound(), SoundSource.BLOCKS, 0.8f, 1f);
        stack.shrink(1);
        inv.setChanged();
    }

    private void abandonTarget(Mob m) {
        Job j = job;
        if (j.target != null) j.blacklist.add(j.target);
        j.target = null;
        j.stepCell = null;
        m.getNavigation().stop();
    }

    // ---------------------------------------------------------------------------------------
    // Breaking blocks
    // ---------------------------------------------------------------------------------------

    private void startBreaking(Mob m, ServerPlayer player, ServerLevel world, SimpleContainer inv,
                               BlockPos pos, boolean isTarget) {
        Job j = job;
        BlockState state = world.getBlockState(pos);
        if (protectedHere(world, pos, state)) { // part of someone's build: never break it
            abandonTarget(m);
            return;
        }
        int slot = Mining.bestToolSlot(inv, state, world, pos, isTarget, j.spec.preferSilk);
        ItemStack tool = slot >= 0 ? inv.getItem(slot) : ItemStack.EMPTY;
        int ticks = Mining.breakTicks(tool, state, world, pos);
        if (ticks > 0 && currentEntry != null) { // a higher level helper mines faster
            ticks = Math.max(1, Math.round(ticks / HelperData.speedFor(currentEntry.level)));
        }
        if (ticks < 0) {
            abandonTarget(m);
            return;
        }
        if (isTarget && !Mining.canHarvest(tool, state)) {
            checkTool(player, world, inv, pos);
            return;
        }
        j.breaking = pos.immutable();
        j.breakTotal = ticks;
        j.breakProgress = 0;
        j.breakSlot = slot;
        j.lastStage = -1;
        j.breakingTarget = isTarget;
        m.setItemSlot(EquipmentSlot.MAINHAND, tool.copy());
    }

    private void tickBreaking(Mob m, ServerPlayer player, ServerLevel world, SimpleContainer inv) {
        Job j = job;
        BlockPos pos = j.breaking;
        BlockState state = world.getBlockState(pos);
        if (state.isAir() || (!j.breakingTarget && passable(world, pos))) {
            clearBreaking(m);
            return;
        }
        m.getLookControl().setLookAt(Vec3.atCenterOf(pos));
        j.breakProgress++;
        if (j.breakProgress % 4 == 1) {
            Compat.swing(m, InteractionHand.MAIN_HAND);
            world.playSound(null, pos, state.getSoundType().getHitSound(), SoundSource.NEUTRAL, 0.25f, 0.6f);
        }
        int stage = Math.min(9, (int) (10f * j.breakProgress / j.breakTotal));
        if (stage != j.lastStage) {
            world.destroyBlockProgress(m.getId(), pos, stage);
            j.lastStage = stage;
        }
        if (j.breakProgress < j.breakTotal) return;

        // Done: harvest it.
        ItemStack tool = j.breakSlot >= 0 ? inv.getItem(j.breakSlot) : ItemStack.EMPTY;
        if (!tool.isEmpty() && !Mining.isUsableTool(tool)) tool = ItemStack.EMPTY;
        boolean harvest = Mining.canHarvest(tool, state);
        float hardness = state.getDestroySpeed(world, pos);
        BlockEntity be = world.getBlockEntity(pos);
        List<ItemStack> drops = !harvest ? List.of()
                : state.is(net.minecraft.world.level.block.Blocks.SPAWNER) ? List.of(Devices.spawnerItem(be)) // keeps its mob
                : Block.getDrops(state, world, pos, be, m, tool);
        if (harvest) state.spawnAfterBreak(world, pos, tool, true);
        world.destroyBlockProgress(m.getId(), pos, -1);
        world.destroyBlock(pos, false, m);
        if (!tool.isEmpty() && tool.isDamageableItem() && hardness != 0) {
            tool.hurtAndBreak(1, m, e -> {});
            inv.setChanged();
            if (!Mining.isUsableTool(tool)) {
                say(player, "My " + tool.getHoverName().getString() + " is about to break, so I've stopped using it. "
                        + "Give me a new one, or take it out and repair it.");
            }
        }
        boolean wasTarget = j.breakingTarget;
        j.breaking = null;
        addWork(player, 1);
        for (ItemStack drop : drops) {
            if (wasTarget && j.spec.counts(drop)) j.collected += drop.getCount();
            ItemStack rest = inv.addItem(drop);
            if (!rest.isEmpty()) {
                Block.popResource(world, pos, rest);
                if (mode == Mode.COLLECT) {
                    say(player, "I'm out of space, so I had to drop " + rest.getCount() + " "
                            + rest.getHoverName().getString() + ". Bringing everything back to you.");
                    mode = Mode.RETURN;
                }
            }
        }
        if (wasTarget) {
            if (pos.equals(j.target)) j.target = null;
            for (int ox = -1; ox <= 1; ox++)
                for (int oy = -1; oy <= 1; oy++)
                    for (int oz = -1; oz <= 1; oz++) {
                        if (ox == 0 && oy == 0 && oz == 0) continue;
                        BlockPos n = pos.offset(ox, oy, oz);
                        if (j.spec.matches(world.getBlockState(n)) && !j.blacklist.contains(n)) j.vein.addLast(n);
                    }
        }
        if (j.collected >= j.wanted && !j.done) {
            j.done = true;
            say(player, "Done! Got " + j.collected + " " + j.spec.display + ". Coming back to you.");
            mode = Mode.RETURN;
        }
    }

    private void clearBreaking(Mob m) {
        if (job != null && job.breaking != null) {
            m.level().destroyBlockProgress(m.getId(), job.breaking, -1);
            job.breaking = null;
        }
    }

    private static final int STRIP_ROUNDS = 4;
    private static final int STRIP_STEP = 32;

    /**
     * Nothing left near the bottom of the mine. Don't give up yet: strip-mine further out from the bottom
     * landing, 32 blocks longer each time, until enough is found (or after a few rounds).
     */
    private void stripMineFurther(ServerPlayer player, SimpleContainer inv, HelperData.Entry entry, int step) {
        Job j = job;
        if (j.collected >= j.wanted || j.stripRounds >= STRIP_ROUNDS || step < 0) {
            int dug = BRANCH_LENGTH * 2 + j.lengthBonus;
            finishJob(player, inv, j.stripRounds > 0
                    ? "I strip-mined " + dug + " blocks out from the bottom of my mine and there's no more "
                    + j.spec.display + " down there."
                    : "I've mined out all the " + j.spec.display + " I could find around my mine.");
            return;
        }
        j.stripRounds++;
        j.lengthBonus += STRIP_STEP;
        j.blind = true;
        if (j.stripRounds == 1) {
            say(player, "No more " + j.spec.display + " right around my mine, so I'm strip-mining further out to find some.");
        }
        j.mineState = MineState.WORK;
        j.landingScanned = false;
        j.doneLanding = step;
        branchFrom = step;
        mineStep = -1;
        j.target = null;
        j.branchDir = null;
        j.branchQueue.clear();
    }

    private void finishJob(ServerPlayer player, SimpleContainer inv, String message) {
        say(player, message);
        if (mob != null) clearBreaking(mob);
        if (!summarize(inv, true).isEmpty()) {
            job.done = true;
            mode = Mode.RETURN;
        } else {
            job = null;
            mode = Mode.FOLLOW;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------------------------

    private static boolean isFull(SimpleContainer inv) {
        int room = inv instanceof HelperData.Pockets p ? p.unlocked : inv.getContainerSize();
        for (int i = 0; i < room; i++) if (inv.getItem(i).isEmpty()) return false;
        return true;
    }

    static String summarize(SimpleContainer inv, boolean skipTools) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack s = inv.getItem(i);
            if (s.isEmpty() || (skipTools && s.isDamageableItem())) continue;
            counts.merge(s.getHoverName().getString(), s.getCount(), Integer::sum);
        }
        StringBuilder sb = new StringBuilder();
        counts.forEach((name, count) -> {
            if (sb.length() > 0) sb.append(", ");
            sb.append(count).append(' ').append(name);
        });
        return sb.toString();
    }

    static void say(ServerPlayer player, String message) {
        MutableComponent text = Component.literal("[Helper] ").withStyle(ChatFormatting.GOLD)
                .append(Component.literal(message).withStyle(ChatFormatting.WHITE));
        if (Mind.sayToAll(player, text, message)) return; // answering chat: everyone sees the reply
        player.sendSystemMessage(text);
    }
}
