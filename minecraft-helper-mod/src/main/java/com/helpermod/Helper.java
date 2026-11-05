package com.helpermod;

import com.helpermod.mixin.ExperienceOrbAccessor;
import com.helpermod.mixin.MobEntityAccessor;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.ExperienceOrbEntity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.ai.goal.LookAtEntityGoal;
import net.minecraft.entity.ai.pathing.Path;
import net.minecraft.entity.attribute.EntityAttributeInstance;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.passive.WanderingTraderEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.registry.tag.FluidTags;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.MutableText;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.Hand;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.ChunkSectionPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;
import net.minecraft.world.chunk.ChunkSection;
import net.minecraft.world.chunk.WorldChunk;
import net.minecraft.world.Heightmap;
import net.minecraft.registry.Registries;
import net.minecraft.server.world.ChunkTicketType;
import net.minecraft.server.world.ServerChunkManager;
import net.minecraft.util.math.ChunkPos;

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
    private static final ChunkTicketType<ChunkPos> SEARCH_TICKET =
            ChunkTicketType.create("helpermod_search", Comparator.comparingLong(ChunkPos::toLong), 300);
    private static final ChunkTicketType<ChunkPos> KEEP_LOADED_TICKET =
            ChunkTicketType.create("helpermod_helper", Comparator.comparingLong(ChunkPos::toLong), 80);

    enum Mode { FOLLOW, COLLECT, RETURN, FISH, FARM }

    enum MineState { NONE, DESCEND, WORK }

    /** Spiral staircase: 2x2 footprint, one block down per step, 3 blocks of headroom. */
    private static final int[][] SPIRAL = {{0, 0}, {1, 0}, {1, 1}, {0, 1}};
    private static final int LANDING_EVERY = 4;
    /** Branch tunnels off each landing: straight, 2 tall, this long (twice as long at the bottom). */
    private static final int BRANCH_LENGTH = 16;
    /** Ore this close to a branch's line counts toward digging that branch. */
    private static final int BRANCH_REACH = 4;

    private final UUID owner;
    private MobEntity mob;
    private HelperData.Entry currentEntry;
    /** Which stair step the helper is standing on (-1 = not in the mine). */
    private int mineStep = -1;
    /** The stair step it left from to mine off a landing (-1 = not in a side tunnel). */
    private int branchFrom = -1;
    private int stairTicks;
    private int returnTicks;
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
    private Vec3d lastPos = Vec3d.ZERO;
    Mode mode = Mode.FOLLOW;
    Job job;

    /** The helper's mob while it's out in the world, or null. */
    MobEntity mobEntity() {
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
        Vec3d travelFrom;

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
        for (String tag : entity.getCommandTags()) {
            if (tag.startsWith(NAME_TAG)) return tag.substring(NAME_TAG.length());
        }
        String name = entity.getName().getString();
        return name.endsWith("'s Helper") ? name.substring(0, name.length() - 9) : "Helper";
    }

    public static UUID ownerOf(Entity entity) {
        for (String tag : entity.getCommandTags()) {
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
    public static void applyBrain(MobEntity mob) {
        MobEntityAccessor accessor = (MobEntityAccessor) mob;
        accessor.helpermod$getGoalSelector().clear(goal -> true);
        accessor.helpermod$getTargetSelector().clear(goal -> true);
        accessor.helpermod$getGoalSelector().add(8, new LookAtEntityGoal(mob, PlayerEntity.class, 8f));
        mob.getNavigation().setCanSwim(true);
        mob.setPersistent();
        mob.setInvulnerable(true);
        mob.setSilent(true);
        if (mob instanceof WanderingTraderEntity trader) trader.setDespawnDelay(0);
        for (EquipmentSlot slot : EquipmentSlot.values()) mob.setEquipmentDropChance(slot, 0f);
        EntityAttributeInstance range = mob.getAttributeInstance(EntityAttributes.GENERIC_FOLLOW_RANGE);
        if (range != null) range.setBaseValue(64);
    }

    MobEntity findEntity(MinecraftServer server, HelperData.Entry entry) {
        if (entry.entity == null) return null;
        if (mob != null && !mob.isRemoved() && mob.getUuid().equals(entry.entity)) return mob;
        mob = null;
        for (ServerWorld world : server.getWorlds()) {
            Entity e = world.getEntity(entry.entity);
            if (e instanceof MobEntity m && !m.isRemoved()) {
                mob = m;
                break;
            }
        }
        return mob;
    }

    /** Spawn (or move) the helper right next to the player. */
    void spawnNear(ServerPlayerEntity player, HelperData.Entry entry) {
        MinecraftServer server = player.getServer();
        Disguise.prepare(player);
        MobEntity existing = findEntity(server, entry);
        ServerWorld world = player.getServerWorld();
        Vec3d spot = findSpotNear(world, player.getBlockPos());
        if (existing != null && existing.getWorld() == world) {
            clearBreaking(existing);
            existing.getNavigation().stop();
            existing.requestTeleport(spot.x, spot.y, spot.z);
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
        WanderingTraderEntity helper = EntityType.WANDERING_TRADER.create(world);
        if (helper == null) return;
        mineStep = -1;
        branchFrom = -1;
        helper.refreshPositionAndAngles(spot.x, spot.y, spot.z, player.getYaw() + 180f, 0f);
        helper.setCustomName(Text.literal(player.getGameProfile().getName() + "'s Helper"));
        helper.setCustomNameVisible(true);
        helper.addCommandTag(TAG);
        helper.addCommandTag(OWNER_TAG + owner);
        helper.addCommandTag(NAME_TAG + player.getGameProfile().getName());
        applyBrain(helper);
        if (entry.size != 1f) Size.apply(helper, entry.size);
        entry.entity = helper.getUuid();
        entry.active = true;
        HelperData.get(server).markDirty();
        mob = helper;
        world.spawnEntity(helper);
        world.playSound(null, helper.getBlockPos(), SoundEvents.ENTITY_ILLUSIONER_MIRROR_MOVE, SoundCategory.NEUTRAL,
                0.6f, 1.4f);
        if (job != null) job.resetSearch();
    }

    /** Replace the helper entity with a fresh one in the same spot (used to refresh its skin). */
    void respawnInPlace(MinecraftServer server, HelperData.Entry entry) {
        MobEntity old = findEntity(server, entry);
        ServerPlayerEntity player = server.getPlayerManager().getPlayer(owner);
        if (old == null || player == null) return;
        clearBreaking(old);
        ServerWorld world = (ServerWorld) old.getWorld();
        Vec3d pos = old.getPos();
        float yaw = old.getYaw();
        old.discard();
        mob = null;
        WanderingTraderEntity helper = EntityType.WANDERING_TRADER.create(world);
        if (helper == null) return;
        helper.refreshPositionAndAngles(pos.x, pos.y, pos.z, yaw, 0f);
        helper.setCustomName(Text.literal(player.getGameProfile().getName() + "'s Helper"));
        helper.setCustomNameVisible(true);
        helper.addCommandTag(TAG);
        helper.addCommandTag(OWNER_TAG + owner);
        helper.addCommandTag(NAME_TAG + player.getGameProfile().getName());
        applyBrain(helper);
        if (entry.size != 1f) Size.apply(helper, entry.size);
        entry.entity = helper.getUuid();
        HelperData.get(server).markDirty();
        mob = helper;
        world.spawnEntity(helper);
        gearTicks = 0;
    }

    void dismiss(MinecraftServer server, HelperData.Entry entry) {
        MobEntity m = findEntity(server, entry);
        if (m != null) {
            clearBreaking(m);
            m.discard();
        }
        mob = null;
        job = null;
        mode = Mode.FOLLOW;
        entry.active = false;
        HelperData.get(server).markDirty();
    }

    private static Vec3d findSpotNear(ServerWorld world, BlockPos center) {
        for (int r = 1; r <= 3; r++) {
            for (int dx = -r; dx <= r; dx++) {
                for (int dz = -r; dz <= r; dz++) {
                    for (int dy = -1; dy <= 1; dy++) {
                        BlockPos p = center.add(dx, dy, dz);
                        if (canStand(world, p)) return Vec3d.ofBottomCenter(p);
                    }
                }
            }
        }
        return Vec3d.ofBottomCenter(center);
    }

    private static boolean canStand(World world, BlockPos p) {
        return passable(world, p) && passable(world, p.up())
                && world.getBlockState(p.down()).isSideSolidFullSquare(world, p.down(), Direction.UP);
    }

    private static boolean passable(World world, BlockPos p) {
        BlockState s = world.getBlockState(p);
        return s.getCollisionShape(world, p).isEmpty() && !s.getFluidState().isIn(FluidTags.LAVA);
    }

    // ---------------------------------------------------------------------------------------
    // Commands
    // ---------------------------------------------------------------------------------------

    void startJob(ServerPlayerEntity player, Materials.Spec spec, int amount) {
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

    void startFishing(ServerPlayerEntity player, int amount) {
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

    private static int rodSlot(SimpleInventory inv) {
        for (int i = 0; i < inv.size(); i++) {
            ItemStack s = inv.getStack(i);
            if (s.getItem() instanceof net.minecraft.item.FishingRodItem && s.getDamage() < s.getMaxDamage() - 1) return i;
        }
        return -1;
    }

    /** The nearest open water (a water block with air above), and a dry spot right next to it to stand on. */
    private static BlockPos[] findWater(ServerWorld world, BlockPos from) {
        BlockPos best = null, stand = null;
        double bestD = Double.MAX_VALUE;
        BlockPos.Mutable p = new BlockPos.Mutable();
        for (int dx = -24; dx <= 24; dx++) for (int dz = -24; dz <= 24; dz++) for (int dy = -6; dy <= 4; dy++) {
            p.set(from.getX() + dx, from.getY() + dy, from.getZ() + dz);
            if (!world.getFluidState(p).isIn(net.minecraft.registry.tag.FluidTags.WATER)
                    || !world.getFluidState(p).isStill() || !world.getBlockState(p.up()).isAir()) continue;
            double d = dx * dx + dz * dz + dy * dy * 4;
            if (d >= bestD) continue;
            for (Direction side : Direction.Type.HORIZONTAL) {
                BlockPos land = p.offset(side); // stand on the bank, level with the water's surface
                BlockPos feet = land.up();
                if (world.getBlockState(land).isSolidBlock(world, land) && world.getBlockState(feet).isAir()
                        && world.getBlockState(feet.up()).isAir()) {
                    best = p.toImmutable();
                    stand = feet.toImmutable();
                    bestD = d;
                    break;
                }
            }
        }
        return best == null ? null : new BlockPos[]{best, stand};
    }

    private void tickFish(MobEntity m, ServerPlayerEntity player, HelperData.Entry entry) {
        ServerWorld world = (ServerWorld) m.getWorld();
        SimpleInventory inv = entry.inventory;
        int slot = rodSlot(inv);
        if (slot < 0) {
            say(player, "I need a fishing rod to fish. Right-click me and put one in my inventory, then ask me again.");
            mode = Mode.FOLLOW;
            return;
        }
        if (fishCaught >= fishWanted || isFull(inv)) {
            if (fishCaught < fishWanted) say(player, "My pockets are full of fish, so I'm bringing them over. Then I'll go back to fishing.");
            m.equipStack(EquipmentSlot.MAINHAND, ItemStack.EMPTY);
            mode = Mode.RETURN;
            return;
        }
        if (fishSpot == null || !world.getFluidState(fishSpot).isIn(net.minecraft.registry.tag.FluidTags.WATER)) {
            BlockPos[] w = findWater(world, m.getBlockPos());
            if (w == null) w = findWater(world, player.getBlockPos());
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
        Vec3d stand = Vec3d.ofBottomCenter(fishStand);
        if (m.getPos().squaredDistanceTo(stand) > 1.5 * 1.5) { // walk to the bank
            if (m.getNavigation().isIdle() || ++fishWalkTicks % 40 == 0) m.getNavigation().startMovingTo(stand.x, stand.y, stand.z, SPEED);
            if (fishWalkTicks > 300) m.requestTeleport(stand.x, stand.y, stand.z);
            fishWalkTicks++;
            return;
        }
        m.getNavigation().stop();
        ItemStack rod = inv.getStack(slot);
        if (!ItemStack.areEqual(m.getMainHandStack(), rod)) m.equipStack(EquipmentSlot.MAINHAND, rod.copy());
        m.getLookControl().lookAt(Vec3d.ofCenter(fishSpot));
        if (fishTimer <= 0) { // cast: wait 5 to 30 seconds like a player, less with Lure
            int lure = net.minecraft.enchantment.EnchantmentHelper.getLure(rod);
            fishTimer = Math.max(40, 100 + world.getRandom().nextInt(500) - lure * 100);
            m.swingHand(Hand.MAIN_HAND);
            world.playSound(null, fishSpot, SoundEvents.ENTITY_FISHING_BOBBER_THROW, SoundCategory.NEUTRAL, 0.5f, 0.4f);
            return;
        }
        if (fishTimer % 20 == 0) {
            world.spawnParticles(net.minecraft.particle.ParticleTypes.FISHING, fishSpot.getX() + 0.5, fishSpot.getY() + 0.9,
                    fishSpot.getZ() + 0.5, 2, 0.2, 0, 0.2, 0.02);
        }
        if (--fishTimer > 0) return;
        // A bite: reel it in.
        world.playSound(null, fishSpot, SoundEvents.ENTITY_FISHING_BOBBER_SPLASH, SoundCategory.NEUTRAL, 0.6f, 1f);
        world.spawnParticles(net.minecraft.particle.ParticleTypes.SPLASH, fishSpot.getX() + 0.5, fishSpot.getY() + 1,
                fishSpot.getZ() + 0.5, 12, 0.3, 0.1, 0.3, 0.1);
        m.swingHand(Hand.MAIN_HAND);
        float luck = net.minecraft.enchantment.EnchantmentHelper.getLuckOfTheSea(rod);
        net.minecraft.loot.context.LootContextParameterSet params = new net.minecraft.loot.context.LootContextParameterSet.Builder(world)
                .add(net.minecraft.loot.context.LootContextParameters.ORIGIN, Vec3d.ofCenter(fishSpot))
                .add(net.minecraft.loot.context.LootContextParameters.TOOL, rod)
                .luck(luck)
                .build(net.minecraft.loot.context.LootContextTypes.FISHING);
        List<ItemStack> loot = world.getServer().getLootManager()
                .getLootTable(net.minecraft.loot.LootTables.FISHING_GAMEPLAY).generateLoot(params);
        for (ItemStack caught : loot) {
            fishCaught += caught.getCount();
            ItemStack rest = inv.addStack(caught);
            if (!rest.isEmpty()) Block.dropStack(world, m.getBlockPos(), rest);
        }
        if (currentEntry != null) currentEntry.xp += 1 + world.getRandom().nextInt(6); // fishing XP, handed over on delivery
        addWork(player, 2);
        rod.damage(1, m, e -> {});
        inv.markDirty();
        if (rod.isEmpty() || rodSlot(inv) < 0) {
            say(player, "My fishing rod is about to break, so I stopped. Give me a new one and ask me again.");
            m.equipStack(EquipmentSlot.MAINHAND, ItemStack.EMPTY);
            mode = Mode.RETURN;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Torches: while mining, light up dark tunnels so monsters don't spawn in them.
    // Uses torches it carries, or makes them from coal (or charcoal) and sticks.
    // ---------------------------------------------------------------------------------------

    private int torchTicks;
    private boolean toldNoTorches;

    private void lightUp(MobEntity m, ServerPlayerEntity player, ServerWorld world, SimpleInventory inv) {
        BlockPos feet = m.getBlockPos();
        if (world.getLightLevel(net.minecraft.world.LightType.SKY, feet) > 7) return; // out in the open
        if (world.getLightLevel(net.minecraft.world.LightType.BLOCK, feet) > 4) return; // already lit
        if (!world.getBlockState(feet).isAir()) return;
        net.minecraft.block.BlockState torch = net.minecraft.block.Blocks.TORCH.getDefaultState();
        if (!torch.canPlaceAt(world, feet)) return;
        if (!takeTorch(inv)) {
            if (!toldNoTorches) {
                toldNoTorches = true;
                say(player, "It's dark down here. Give me torches, or coal and sticks, and I'll light up the tunnels so monsters can't spawn.");
            }
            return;
        }
        world.setBlockState(feet, torch);
        world.playSound(null, feet, SoundEvents.BLOCK_WOOD_PLACE, SoundCategory.BLOCKS, 0.6f, 1.2f);
        inv.markDirty();
    }

    /** Take one torch, crafting four from a coal and a stick if it has none. */
    private static boolean takeTorch(SimpleInventory inv) {
        int torch = slotOf(inv, net.minecraft.item.Items.TORCH);
        if (torch < 0) {
            int coal = slotOf(inv, net.minecraft.item.Items.COAL);
            if (coal < 0) coal = slotOf(inv, net.minecraft.item.Items.CHARCOAL);
            int stick = slotOf(inv, net.minecraft.item.Items.STICK);
            if (coal < 0 || stick < 0) return false;
            inv.getStack(coal).decrement(1);
            inv.getStack(stick).decrement(1);
            ItemStack rest = inv.addStack(new ItemStack(net.minecraft.item.Items.TORCH, 4));
            if (!rest.isEmpty()) return true; // no room for them, but it can still place the one in its hand
            torch = slotOf(inv, net.minecraft.item.Items.TORCH);
            if (torch < 0) return false;
        }
        inv.getStack(torch).decrement(1);
        return true;
    }

    private static int slotOf(SimpleInventory inv, Item item) {
        for (int i = 0; i < inv.size(); i++) if (inv.getStack(i).isOf(item)) return i;
        return -1;
    }

    // ---------------------------------------------------------------------------------------
    // Farming: /helper farm [radius]. Harvests ripe crops around where you asked and replants them.
    // ---------------------------------------------------------------------------------------

    private BlockPos farmCentre, farmTarget;
    private int farmRadius, farmHarvested, farmIdle, farmWalkTicks, farmSinceDelivery;

    void startFarming(ServerPlayerEntity player, int radius) {
        if (mob != null) clearBreaking(mob);
        job = null;
        fishWanted = 0;
        farmCentre = player.getBlockPos();
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
        if (state.getBlock() instanceof net.minecraft.block.CropBlock crop) return crop.isMature(state);
        if (state.getBlock() instanceof net.minecraft.block.NetherWartBlock)
            return state.get(net.minecraft.block.NetherWartBlock.AGE) >= 3;
        return false;
    }

    private BlockPos findRipe(ServerWorld world) {
        BlockPos best = null;
        double bestD = Double.MAX_VALUE;
        BlockPos from = mob != null ? mob.getBlockPos() : farmCentre;
        BlockPos.Mutable p = new BlockPos.Mutable();
        for (int dx = -farmRadius; dx <= farmRadius; dx++) for (int dz = -farmRadius; dz <= farmRadius; dz++) for (int dy = -4; dy <= 4; dy++) {
            p.set(farmCentre.getX() + dx, farmCentre.getY() + dy, farmCentre.getZ() + dz);
            if (!world.isChunkLoaded(p.getX() >> 4, p.getZ() >> 4)) continue;
            if (!isRipe(world.getBlockState(p))) continue;
            double d = p.getSquaredDistance(from);
            if (d < bestD) {
                bestD = d;
                best = p.toImmutable();
            }
        }
        return best;
    }

    private void tickFarm(MobEntity m, ServerPlayerEntity player, HelperData.Entry entry) {
        ServerWorld world = (ServerWorld) m.getWorld();
        SimpleInventory inv = entry.inventory;
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
                Vec3d c = Vec3d.ofBottomCenter(farmCentre);
                if (m.getPos().squaredDistanceTo(c) > 6 * 6 && m.getNavigation().isIdle())
                    m.getNavigation().startMovingTo(c.x, c.y, c.z, SPEED);
                return;
            }
        }
        m.getLookControl().lookAt(Vec3d.ofCenter(farmTarget));
        if (m.getEyePos().squaredDistanceTo(Vec3d.ofCenter(farmTarget)) > REACH_SQ) {
            if (m.getNavigation().isIdle() || ++farmWalkTicks % 40 == 0)
                m.getNavigation().startMovingTo(farmTarget.getX() + 0.5, farmTarget.getY(), farmTarget.getZ() + 0.5, SPEED);
            if (++farmWalkTicks > 400) farmTarget = null; // can't get there, try another
            return;
        }
        m.getNavigation().stop();
        m.swingHand(Hand.MAIN_HAND);
        BlockState ripe = world.getBlockState(farmTarget);
        List<ItemStack> drops = Block.getDroppedStacks(ripe, world, farmTarget, world.getBlockEntity(farmTarget), m, m.getMainHandStack());
        // Replant with one of the seeds it just harvested (or one it was carrying).
        ItemStack seed = ripe.getBlock().getPickStack(world, farmTarget, ripe);
        boolean replanted = false;
        for (ItemStack d : drops) {
            if (!seed.isEmpty() && d.isOf(seed.getItem()) && !replanted) {
                d.decrement(1);
                replanted = true;
            }
        }
        if (!replanted && !seed.isEmpty()) {
            int s = slotOf(inv, seed.getItem());
            if (s >= 0) {
                inv.getStack(s).decrement(1);
                replanted = true;
            }
        }
        world.syncWorldEvent(net.minecraft.world.WorldEvents.BLOCK_BROKEN, farmTarget, Block.getRawIdFromState(ripe));
        world.setBlockState(farmTarget, replanted ? ripe.getBlock().getDefaultState() : net.minecraft.block.Blocks.AIR.getDefaultState());
        for (ItemStack d : drops) {
            if (d.isEmpty()) continue;
            ItemStack rest = inv.addStack(d);
            if (!rest.isEmpty()) Block.dropStack(world, farmTarget, rest);
        }
        inv.markDirty();
        farmHarvested++;
        farmSinceDelivery++;
        addWork(player, 1);
        farmTarget = null;
        farmIdle = 0;
    }

    void stop(ServerPlayerEntity player) {
        fishWanted = 0;
        farmCentre = null;
        if (mob != null && job != null && mob.getWorld() instanceof ServerWorld w) {
            plugShafts(w, HelperData.get(player.getServer()).getOrCreate(owner).inventory);
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
        mode = Mode.RETURN;
    }

    String status(SimpleInventory inv) {
        String doing;
        if (mode == Mode.COLLECT && job != null) {
            doing = "Collecting " + job.spec.display + ": " + job.collected + "/" + job.wanted;
        } else if (mode == Mode.RETURN) {
            doing = job != null && !job.done
                    ? "Bringing you my haul, then back to collecting " + job.spec.display
                    : "Bringing you my haul";
        } else if (mode == Mode.FISH) {
            doing = "Fishing: " + fishCaught + "/" + fishWanted + " caught";
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

    void tick(MinecraftServer server, ServerPlayerEntity player, HelperData.Entry entry) {
        currentEntry = entry;
        MobEntity m = findEntity(server, entry);
        // Flying an Ad Astra rocket or lander: wait, then meet the owner when they've landed (on any planet).
        Entity vehicle = player.getVehicle();
        if (vehicle != null && vehicle != m
                && Registries.ENTITY_TYPE.getId(vehicle.getType()).getNamespace().equals("ad_astra")) {
            if (!toldFlight) {
                toldFlight = true;
                say(player, "Have a good flight! I'll meet you when you land.");
            }
            if (m != null && m.getWorld() == player.getWorld()) m.getNavigation().stop();
            missingTicks = 0;
            return;
        }
        if (toldFlight && m != null && m.getWorld() != player.getWorld()) spawnNear(player, entry); // just landed
        toldFlight = false;
        if (m != null && Planets.isSpace(m.getWorld())) { // no air and freezing or boiling: the helper is fine
            m.setAir(m.getMaxAir());
            m.setFrozenTicks(0);
            m.extinguish();
            Planets.Theme here = Planets.themeOf(m.getWorld());
            String dim = Planets.keyOf(m.getWorld());
            if (here != null && !dim.equals(lastPlanet)) {
                lastPlanet = dim;
                say(player, "We made it to " + here.display() + "! I can mine the ores here too, e.g. /helper collect "
                        + ("moon".equals(m.getWorld().getRegistryKey().getValue().getPath()) ? "desh"
                        : "mars".equals(m.getWorld().getRegistryKey().getValue().getPath()) ? "ostrum" : "calorite")
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
        if (server.getTicks() % 20 == 0) keepLoaded((ServerWorld) m.getWorld(), m);
        if (!((ServerWorld) m.getWorld()).shouldTickEntity(m.getBlockPos())) {
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
        if (m.hasNoGravity() && !m.hasPassengers()) m.setNoGravity(false); // got off a flying helper
        if (m.age % 10 == 0) pickUpXp(m, player, entry);
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
        }
    }

    // ---------------------------------------------------------------------------------------
    // Combat: protect the owner and itself, and help with whatever the owner attacks
    // ---------------------------------------------------------------------------------------

    private boolean tickCombat(MobEntity m, ServerPlayerEntity player, HelperData.Entry entry) {
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
            if (DEBUG) HelperMod.LOG.info("[helper debug] target {} at {}", combatTarget, combatTarget.getBlockPos());
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
        m.getLookControl().lookAt(target, 30f, 30f);
        double d = m.squaredDistanceTo(target);
        if (d < closestSoFar - 0.5) {
            closestSoFar = d;
            lastProgressTick = combatTicks;
        }
        if (combatTicks - lastProgressTick > 80) { // can't get to it (behind walls, in a cave...): skip it
            if (DEBUG) HelperMod.LOG.info("[helper debug] giving up on {}", target);
            ignoredTargets.add(target.getUuid());
            combatTarget = null;
            m.getNavigation().stop();
            return false;
        }
        if (d > Combat.REACH_SQ) {
            if (--repathCooldown <= 0) {
                m.getNavigation().startMovingTo(target, Combat.CHASE_SPEED);
                repathCooldown = 5;
            }
        } else {
            m.getNavigation().stop();
        }
        if (attackCooldown > 0) attackCooldown--;
        if (attackCooldown <= 0 && d <= Combat.REACH_SQ && m.canSee(target)) {
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

    private void addWork(ServerPlayerEntity player, int points) {
        HelperData.Entry e = currentEntry;
        if (e == null || e.level >= HelperData.MAX_LEVEL) return;
        e.work += points;
        int level = HelperData.levelFor(e.work);
        HelperData.get(player.getServer()).markDirty();
        if (level <= e.level) return;
        e.level = level;
        e.inventory.unlocked = HelperData.pocketsFor(level);
        MobEntity m = mob;
        if (m != null) {
            ServerWorld w = (ServerWorld) m.getWorld();
            w.playSound(null, m.getBlockPos(), SoundEvents.ENTITY_PLAYER_LEVELUP, SoundCategory.NEUTRAL, 0.8f, 1.2f);
            w.spawnParticles(net.minecraft.particle.ParticleTypes.HAPPY_VILLAGER,
                    m.getX(), m.getY() + m.getHeight(), m.getZ(), 15, 0.4, 0.4, 0.4, 0.1);
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
    private void keepLoaded(ServerWorld world, MobEntity m) {
        ChunkPos here = new ChunkPos(m.getBlockPos());
        world.getChunkManager().addTicket(KEEP_LOADED_TICKET, here, 3, here);
        if (job != null && job.target != null) {
            ChunkPos there = new ChunkPos(job.target);
            world.getChunkManager().addTicket(KEEP_LOADED_TICKET, there, 2, there);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Riding: the owner sits on the helper and steers with the normal movement keys
    // ---------------------------------------------------------------------------------------

    /** Start riding your helper (right-click it holding a saddle, or /helper ride). */
    boolean ride(ServerPlayerEntity player, HelperData.Entry entry) {
        MobEntity m = findEntity(player.getServer(), entry);
        if (m == null || m.getWorld() != player.getWorld() || m.squaredDistanceTo(player) > 16 * 16) return false;
        if (player.hasVehicle()) player.stopRiding();
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

    private void tickRide(MobEntity m, ServerPlayerEntity rider) {
        m.getNavigation().stop();
        combatTarget = null;
        float yaw = rider.getYaw();
        m.setYaw(yaw);
        m.setBodyYaw(yaw);
        m.setHeadYaw(yaw);
        float forward = rider.forwardSpeed, side = rider.sidewaysSpeed; // the rider's W/A/S/D, sent by the game
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
            m.getMoveControl().moveTo(m.getX(), m.getY(), m.getZ(), 0);
            Vec3d look = rider.getRotationVec(1f);
            double speed = rider.isSprinting() ? 0.9 : 0.6;
            Vec3d v = moving ? new Vec3d(dx * speed, forward > 0 ? look.y * speed : 0, dz * speed) : Vec3d.ZERO;
            if (jump) v = v.add(0, 0.4, 0);
            m.setVelocity(m.getVelocity().multiply(0.5).add(v.multiply(0.5)));
            m.velocityModified = true;
            m.fallDistance = 0;
            return;
        }
        if (m.isTouchingWater()) { // swim properly: full speed through water, space bar swims up
            m.getMoveControl().moveTo(m.getX(), m.getY(), m.getZ(), 0);
            double speed = rider.isSprinting() ? 0.45 : 0.3;
            Vec3d v = moving ? new Vec3d(dx * speed, 0, dz * speed) : Vec3d.ZERO;
            double up = jump ? 0.3 : m.isSubmergedInWater() ? 0.05 : 0; // float up gently
            m.setVelocity(new Vec3d(v.x, Math.max(m.getVelocity().y, up), v.z));
            m.velocityModified = true;
            return;
        }
        if (jump && m.isOnGround()) { // jump like a horse: a good hop, more while moving
            m.setVelocity(m.getVelocity().x + dx * 0.2, 0.6, m.getVelocity().z + dz * 0.2);
            m.velocityModified = true;
        }
        if (!moving) {
            m.getMoveControl().moveTo(m.getX(), m.getY(), m.getZ(), 0);
            return;
        }
        double speed = forward < 0 ? 0.8 : rider.isSprinting() ? 2.2 : 1.6;
        m.getMoveControl().moveTo(m.getX() + dx * 3, m.getY(), m.getZ() + dz * 3, speed);
    }

    private void tickFollow(MobEntity m, ServerPlayerEntity player, HelperData.Entry entry) {
        if (m.getWorld() != player.getWorld()) {
            spawnNear(player, entry);
            return;
        }
        double d = m.squaredDistanceTo(player);
        if (d > 32 * 32) {
            teleportNear(m, player);
        } else if (d > 4 * 4) {
            if (--repathCooldown <= 0) {
                m.getNavigation().startMovingTo(player, SPEED);
                repathCooldown = 10;
            }
            if (isStuck(m, 60)) teleportNear(m, player); // stuck behind a wall for 3 s: phase through to you
        } else if (d < 2.5 * 2.5) {
            m.getNavigation().stop();
        }
    }

    private void tickReturn(MobEntity m, ServerPlayerEntity player, HelperData.Entry entry) {
        if (m.getWorld() != player.getWorld()) {
            spawnNear(player, entry);
            return;
        }
        if (job != null && job.breaking != null) {
            tickBreaking(m, player, (ServerWorld) m.getWorld(), entry.inventory); // e.g. gravel fell on the stairs
            return;
        }
        if (mineStep >= 0 || branchFrom >= 0) {
            // Walk back up the mine's staircase to the surface.
            if (goToStep(m, player, (ServerWorld) m.getWorld(), entry, 0)) {
                mineStep = -1;
                stuckTicks = 0;
            }
            return;
        }
        double d = m.squaredDistanceTo(player);
        if (d > 3 * 3 && ++returnTicks > 600) { // 30 s and still can't reach you: hop over
            returnTicks = 0;
            teleportNear(m, player);
            d = m.squaredDistanceTo(player);
        }
        if (d <= 3 * 3) {
            returnTicks = 0;
            m.getNavigation().stop();
            if (job != null) plugShafts((ServerWorld) m.getWorld(), entry.inventory);
            deliver(m, player, entry.inventory);
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
            m.getNavigation().startMovingTo(player, SPEED);
            repathCooldown = 10;
        }
        if (isStuck(m, 100)) teleportNear(m, player);
    }

    /**
     * Step through a wall: find the first open spot (2 tall, with a floor) up to 5 blocks further along
     * (dx, dz) and pop out there, without breaking anything. False if there's no open spot within reach.
     */
    private boolean phaseThrough(MobEntity m, ServerWorld world, BlockPos cur, int dx, int dz) {
        for (int k = 2; k <= 6; k++) {
            for (int dy : new int[]{0, 1, -1}) {
                BlockPos p = cur.add(dx * k, dy, dz * k);
                if (!world.isChunkLoaded(p)) return false;
                if (!passable(world, p) || !passable(world, p.up())) continue;
                if (!world.getFluidState(p).isEmpty()) continue;
                BlockPos floor = p.down();
                if (!world.getBlockState(floor).isSideSolidFullSquare(world, floor, Direction.UP)) continue;
                m.getNavigation().stop();
                world.spawnParticles(net.minecraft.particle.ParticleTypes.PORTAL, m.getX(), m.getY() + 1, m.getZ(), 20, 0.3, 0.5, 0.3, 0.2);
                m.requestTeleport(p.getX() + 0.5, p.getY(), p.getZ() + 0.5);
                world.playSound(null, p, SoundEvents.ENTITY_ENDERMAN_TELEPORT, SoundCategory.NEUTRAL, 0.4f, 1.4f);
                stuckTicks = 0;
                return true;
            }
        }
        return false;
    }

    private void teleportNear(MobEntity m, ServerPlayerEntity player) {
        mineStep = -1;
        branchFrom = -1;
        Vec3d spot = findSpotNear(player.getServerWorld(), player.getBlockPos());
        m.getNavigation().stop();
        m.requestTeleport(spot.x, spot.y, spot.z);
        stuckTicks = 0;
    }

    private boolean isStuck(MobEntity m, int limit) {
        if (m.getPos().squaredDistanceTo(lastPos) > 0.04) {
            lastPos = m.getPos();
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
    private void pickUpXp(MobEntity m, ServerPlayerEntity player, HelperData.Entry entry) {
        if (player.getWorld() == m.getWorld() && player.squaredDistanceTo(m) < OWNER_NEAR_SQ) {
            // Back with its owner and not on a run: hand over anything it's still holding.
            if (mode == Mode.FOLLOW && entry.xp > 0) {
                int given = giveXp(player);
                if (given > 0) say(player, "Here's " + given + " XP I picked up for you.");
            }
            return;
        }
        int gained = 0;
        for (ExperienceOrbEntity orb : m.getWorld().getEntitiesByClass(ExperienceOrbEntity.class,
                m.getBoundingBox().expand(XP_PICKUP_RADIUS), Entity::isAlive)) {
            gained += orb.getExperienceAmount() * Math.max(1, ((ExperienceOrbAccessor) orb).helpermod$getPickingCount());
            orb.discard();
        }
        if (gained <= 0) return;
        entry.xp = (int) Math.min(Integer.MAX_VALUE, (long) entry.xp + gained);
        HelperData.get(player.getServer()).markDirty();
        m.getWorld().playSound(null, m.getBlockPos(), SoundEvents.ENTITY_EXPERIENCE_ORB_PICKUP,
                SoundCategory.NEUTRAL, 0.2f, 1.4f);
    }

    /** Give the owner the XP the helper has been holding. Returns how much was given. */
    private int giveXp(ServerPlayerEntity player) {
        HelperData.Entry entry = currentEntry;
        if (entry == null || entry.xp <= 0) return 0;
        int xp = entry.xp;
        entry.xp = 0;
        HelperData.get(player.getServer()).markDirty();
        int before = player.experienceLevel;
        player.addExperience(xp);
        player.getWorld().playSound(null, player.getBlockPos(), player.experienceLevel > before
                        ? SoundEvents.ENTITY_PLAYER_LEVELUP : SoundEvents.ENTITY_EXPERIENCE_ORB_PICKUP,
                SoundCategory.PLAYERS, 0.6f, 1f);
        return xp;
    }

    private void deliver(MobEntity m, ServerPlayerEntity player, SimpleInventory inv) {
        Map<String, Integer> given = new LinkedHashMap<>();
        boolean droppedAtFeet = false;
        int keptBuilding = 0;
        for (int i = 0; i < inv.size(); i++) {
            ItemStack stack = inv.getStack(i);
            if (stack.isEmpty() || stack.isDamageable()) continue; // keep tools
            if (isBuildingBlock(stack) && (job == null || !job.spec.counts(stack))
                    && keptBuilding < KEEP_BUILDING_BLOCKS) {
                int keep = Math.min(stack.getCount(), KEEP_BUILDING_BLOCKS - keptBuilding);
                keptBuilding += keep;
                if (keep == stack.getCount()) continue;
                ItemStack give = stack.split(stack.getCount() - keep);
                given.merge(give.getName().getString(), give.getCount(), Integer::sum);
                player.getInventory().offerOrDrop(give);
                continue;
            }
            given.merge(stack.getName().getString(), stack.getCount(), Integer::sum);
            ItemStack give = stack.copy();
            player.getInventory().insertStack(give);
            if (!give.isEmpty()) {
                player.dropItem(give, false, false);
                droppedAtFeet = true;
            }
            inv.setStack(i, ItemStack.EMPTY);
        }
        inv.markDirty();
        int xp = giveXp(player);
        String xpNote = xp > 0 ? " Plus " + xp + " XP I picked up along the way." : "";
        if (given.isEmpty()) {
            say(player, xp > 0 ? "No new items, but here's " + xp + " XP I picked up along the way."
                    : "I don't have anything new for you.");
            return;
        }
        m.getWorld().playSound(null, player.getBlockPos(), SoundEvents.ENTITY_ITEM_PICKUP, SoundCategory.PLAYERS,
                0.4f, 1.2f);
        StringBuilder sb = new StringBuilder();
        given.forEach((name, count) -> {
            if (sb.length() > 0) sb.append(", ");
            sb.append(count).append(' ').append(name);
        });
        danceTicks = Celebrate.DANCE_TICKS;
        m.getNavigation().stop();
        Celebrate.fireworks((ServerWorld) m.getWorld(), m.getPos());
        say(player, "Here you go: " + sb + "." + xpNote + (droppedAtFeet
                ? " Your inventory is full, so I dropped the rest at your feet." : ""));
    }

    // ---------------------------------------------------------------------------------------
    // Collecting
    // ---------------------------------------------------------------------------------------

    private void tickCollect(MobEntity m, ServerPlayerEntity player, HelperData.Entry entry) {
        Job j = job;
        ServerWorld world = (ServerWorld) m.getWorld();
        SimpleInventory inv = entry.inventory;
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
        m.getLookControl().lookAt(Vec3d.ofCenter(target));

        boolean inReach = m.getEyePos().squaredDistanceTo(Vec3d.ofCenter(target)) <= REACH_SQ;
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
    private boolean tickTravel(MobEntity m, ServerWorld world) {
        Job j = job;
        Vec3d here = m.getPos();
        double hx = j.target.getX() + 0.5 - here.x;
        double hz = j.target.getZ() + 0.5 - here.z;
        double h = Math.sqrt(hx * hx + hz * hz);
        if (h <= TRAVEL_DISTANCE || j.travelFailures >= 3) return false;
        if (j.travelFrom == null || here.squaredDistanceTo(j.travelFrom) > 8 * 8) {
            j.travelFrom = here; // making progress
            j.travelFailures = 0;
            j.targetTicks = 0;
        }
        boolean stuck = isStuck(m, 60);
        if (m.getNavigation().isIdle() || stuck) {
            stuckTicks = 0;
            if (stuck) j.travelFailures++;
            int wx = (int) Math.floor(here.x + hx / h * 24);
            int wz = (int) Math.floor(here.z + hz / h * 24);
            int wy = world.getTopY(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, wx, wz);
            Path path = m.getNavigation().findPathTo(new BlockPos(wx, wy, wz), 3);
            if (path == null || path.getLength() <= 1 || !m.getNavigation().startMovingAlong(path, SPEED)) {
                j.travelFailures++;
            }
        }
        return true;
    }

    private static boolean isAdjacent(MobEntity m, BlockPos target) {
        BlockPos feet = m.getBlockPos();
        int dx = Math.abs(target.getX() - feet.getX());
        int dz = Math.abs(target.getZ() - feet.getZ());
        int dy = target.getY() - feet.getY();
        return dx + dz <= 1 && dy >= -1 && dy <= 2;
    }

    private void tickWalk(MobEntity m, ServerWorld world) {
        Job j = job;
        boolean stuck = isStuck(m, 40);
        if (m.getNavigation().isIdle() || stuck) {
            stuckTicks = 0;
            if (++j.pathFailures > 2) {
                j.tunneling = true; // walking isn't working; dig a way there instead
                return;
            }
            Path path = m.getNavigation().findPathTo(j.target, 2);
            if (path == null || !m.getNavigation().startMovingAlong(path, SPEED)) j.tunneling = true;
        }
    }

    private boolean pickTarget(MobEntity m, ServerPlayerEntity player, ServerWorld world, SimpleInventory inv) {
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
                Path path = m.getNavigation().findPathTo(p, 2);
                j.tunneling = path == null || !path.reachesTarget();
                if (!j.tunneling) m.getNavigation().startMovingAlong(path, SPEED);
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
            scan(world, m.getBlockPos(), SCAN_RADII[j.scanStage][0], SCAN_RADII[j.scanStage][1], j);
            j.candidates.removeIf(p -> !isValidTarget(world, p, true));
        }
        Vec3d here = m.getPos();
        j.candidates.sort(Comparator.comparingDouble(p -> Vec3d.ofCenter(p).squaredDistanceTo(here)));

        // 3. Of the closest few, pick the cheapest: walk if there's a path, otherwise dig.
        BlockPos best = null;
        Path bestPath = null;
        double bestCost = Double.MAX_VALUE;
        for (int i = 0; i < Math.min(PATH_CHECKS, j.candidates.size()); i++) {
            BlockPos p = j.candidates.get(i);
            double dist = Math.sqrt(Vec3d.ofCenter(p).squaredDistanceTo(here));
            double cost;
            Path path = null;
            if (m.getEyePos().squaredDistanceTo(Vec3d.ofCenter(p)) <= REACH_SQ && isExposed(world, p)) {
                cost = 0;
            } else {
                if (isExposed(world, p)) path = m.getNavigation().findPathTo(p, 2);
                if (path != null && path.reachesTarget()) cost = path.getLength();
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
        if (bestPath != null) m.getNavigation().startMovingAlong(bestPath, SPEED);
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
    private boolean pickFromBranch(MobEntity m, ServerPlayerEntity player, ServerWorld world, SimpleInventory inv,
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
        Vec3d eye = m.getEyePos();
        BlockPos reachable = null;
        double best = Double.MAX_VALUE;
        for (BlockPos p : j.candidates) {
            double d = eye.squaredDistanceTo(Vec3d.ofCenter(p));
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
    private void planBranches(ServerWorld world, HelperData.Entry entry, BlockPos landing, int length) {
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
                int along = rx * out[k].getOffsetX() + rz * out[k].getOffsetZ();
                int side = Math.abs(rx * out[k].getOffsetZ() - rz * out[k].getOffsetX());
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
    private void tickBranch(MobEntity m, ServerPlayerEntity player, ServerWorld world, SimpleInventory inv,
                            HelperData.Entry entry, BlockPos landing, int length, boolean atBottom) {
        Job j = job;
        if (j.stepCell != null) { // stepping into the block we just opened
            BlockPos cell = j.stepCell;
            Vec3d c = Vec3d.ofBottomCenter(cell);
            if (m.getBlockPos().equals(cell) || m.getPos().squaredDistanceTo(c) < 0.15) j.stepCell = null;
            else if (++j.stepTicks > 25) {
                m.requestTeleport(c.x, c.y, c.z);
                j.stepCell = null;
            } else m.getMoveControl().moveTo(c.x, c.y, c.z, SPEED);
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
        BlockPos head = landing.offset(d, j.branchLen); // where we should be standing
        BlockPos next = head.offset(d);
        // Get back to the end of the tunnel first (e.g. after mining a bit of ore off to the side).
        if (!m.getBlockPos().equals(head) && m.getPos().squaredDistanceTo(Vec3d.ofBottomCenter(head)) > 0.5) {
            if (m.getNavigation().isIdle() || isStuck(m, 40)) {
                Path path = m.getNavigation().findPathTo(head, 0);
                if (path != null) m.getNavigation().startMovingAlong(path, SPEED);
            }
            if (++j.branchTicks > 200) {
                m.requestTeleport(head.getX() + 0.5, head.getY(), head.getZ() + 0.5);
                j.branchTicks = 0;
            }
            return;
        }
        j.branchTicks = 0;
        j.targetTicks = 0;
        for (BlockPos cell : new BlockPos[]{next.up(), next}) {
            BlockState s = world.getBlockState(cell);
            if (s.getFluidState().isIn(FluidTags.LAVA) || lavaNear(world, cell)) {
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
        BlockPos floor = next.down();
        BlockState fs = world.getBlockState(floor);
        if (!fs.isSideSolidFullSquare(world, floor, Direction.UP)) {
            int slot = buildingBlockSlot(inv);
            if (slot >= 0 && fs.isReplaceable()) placeBlock(world, inv, slot, floor);
            else if (!hasGroundWithin(world, floor, 1)) {
                j.branchDir = null; // a drop into a cave and nothing to bridge with
                return;
            }
        }
        j.branchLen++;
        j.stepCell = next;
        j.stepTicks = 0;
        m.getNavigation().stop();
        Vec3d c = Vec3d.ofBottomCenter(next);
        m.getMoveControl().moveTo(c.x, c.y, c.z, SPEED);
    }

    private static boolean isDeepUnderground(ServerWorld world, MobEntity m, BlockPos target) {
        int surface = world.getTopY(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, target.getX(), target.getZ());
        return target.getY() < m.getBlockY() - 3 && target.getY() < surface - 4;
    }

    static BlockPos stepPos(HelperData.Entry entry, int i) {
        int[] c = SPIRAL[i & 3];
        return entry.mineOrigin.add(c[0], -i, c[1]);
    }

    private int bottomStep(ServerWorld world, HelperData.Entry entry) {
        return Math.max(0, entry.mineOrigin.getY() - (world.getBottomY() + 6));
    }

    private void startMine(MobEntity m, ServerPlayerEntity player, ServerWorld world, HelperData.Entry entry,
                           BlockPos target) {
        Job j = job;
        String dim = world.getRegistryKey().getValue().toString();
        boolean marked = entry.mineMarker != null && entry.mineOrigin != null && dim.equals(entry.mineDim);
        boolean reuse = marked || (entry.mineOrigin != null && dim.equals(entry.mineDim)
                && horizontalDistanceSq(entry.mineOrigin, m.getBlockPos()) < 256 * 256);
        if (!reuse) {
            BlockPos spot = findMineSpot(world, m.getBlockPos());
            if (spot == null) {
                finishJob(player, entry.inventory, "I'd have to dig a mine to reach " + j.spec.display
                        + ", but there's no open ground nearby that's away from buildings. "
                        + "Place a Mine Marker (/helper mine marker) where you want my mine, or take me somewhere with plain ground.");
                return;
            }
            entry.mineOrigin = spot;
            entry.mineDim = dim;
            entry.mineDepth = 0;
            HelperData.get(world.getServer()).markDirty();
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
        j.mineTargetY = Math.max(world.getBottomY() + 6, median);
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
    private void tickDescend(MobEntity m, ServerPlayerEntity player, ServerWorld world, HelperData.Entry entry) {
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
    private boolean goToStep(MobEntity m, ServerPlayerEntity player, ServerWorld world, HelperData.Entry entry,
                             int goal) {
        if (entry.mineOrigin == null) return true;
        // Out in a side tunnel: walk back to the landing we came from.
        if (branchFrom >= 0) {
            BlockPos landing = stepPos(entry, branchFrom);
            if (m.getBlockPos().equals(landing) || m.getPos().squaredDistanceTo(Vec3d.ofBottomCenter(landing)) < 0.5) {
                mineStep = branchFrom;
                branchFrom = -1;
                stairTicks = 0;
            } else {
                if (m.getNavigation().isIdle() || isStuck(m, 40)) {
                    Path path = m.getNavigation().findPathTo(landing, 0);
                    if (path != null) m.getNavigation().startMovingAlong(path, SPEED);
                }
                if (++stairTicks > 200) { // tunnel got blocked somehow: hop back
                    m.requestTeleport(landing.getX() + 0.5, landing.getY(), landing.getZ() + 0.5);
                    stairTicks = 0;
                }
                return false;
            }
        }
        // Not on the stairs yet: walk to the entrance.
        if (mineStep < 0) {
            BlockPos top = stepPos(entry, 0);
            if (m.getBlockPos().equals(top) || m.getPos().squaredDistanceTo(Vec3d.ofBottomCenter(top)) < 0.6) {
                mineStep = 0;
                stairTicks = 0;
            } else {
                if (m.getNavigation().isIdle() || isStuck(m, 60)) {
                    Path path = m.getNavigation().findPathTo(top, 0);
                    if (path != null) m.getNavigation().startMovingAlong(path, SPEED);
                }
                if (++stairTicks > 400) {
                    m.requestTeleport(top.getX() + 0.5, top.getY(), top.getZ() + 0.5);
                    stairTicks = 0;
                }
                return false;
            }
        }
        if (mineStep == goal) return true;
        int next = mineStep + Integer.signum(goal - mineStep);
        BlockPos cell = stepPos(entry, next);
        if (!prepareStep(m, player, world, entry, cell)) return false; // digging / sealing this tick
        Vec3d c = Vec3d.ofBottomCenter(cell);
        if (m.getBlockPos().equals(cell) || m.getPos().squaredDistanceTo(c) < 0.15) {
            mineStep = next;
            stairTicks = 0;
            if (next > entry.mineDepth) {
                entry.mineDepth = next;
                HelperData.get(world.getServer()).markDirty();
            }
            return mineStep == goal;
        }
        m.getNavigation().stop();
        m.getMoveControl().moveTo(c.x, c.y, c.z, SPEED);
        if (++stairTicks > 25) {
            m.requestTeleport(c.x, c.y, c.z);
            stairTicks = 0;
        }
        return false;
    }

    /** Make sure a stair step is open, sealed from lava and water, and has a floor. False while working on it. */
    private boolean prepareStep(MobEntity m, ServerPlayerEntity player, ServerWorld world, HelperData.Entry entry,
                                BlockPos cell) {
        if (job == null) return true; // nothing to dig with; just walk (and hop if blocked)
        SimpleInventory inv = entry.inventory;
        for (int dy = 2; dy >= 0; dy--) {
            BlockPos p = cell.up(dy);
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
            if (s.hasBlockEntity() || s.getHardness(world, p) < 0 || protectedHere(world, p, s)) {
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
        BlockPos floor = cell.down();
        BlockState fs = world.getBlockState(floor);
        if (!fs.isSideSolidFullSquare(world, floor, Direction.UP) && fs.isReplaceable()) {
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

    private boolean fluidNear(ServerWorld world, BlockPos p, HelperData.Entry entry) {
        for (Direction dir : Direction.values()) {
            BlockPos n = p.offset(dir);
            if (!world.getFluidState(n).isEmpty() && !isMineCell(entry, n)) return true;
        }
        return false;
    }

    /** Plug water and lava touching the mine. True if it placed something (call again next tick). */
    private boolean sealFluids(ServerWorld world, SimpleInventory inv, BlockPos p, HelperData.Entry entry) {
        boolean placed = false;
        List<BlockPos> spots = new ArrayList<>();
        if (!world.getFluidState(p).isEmpty()) spots.add(p);
        for (Direction dir : Direction.values()) {
            BlockPos n = p.offset(dir);
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
    private boolean checkTool(ServerPlayerEntity player, ServerWorld world, SimpleInventory inv, BlockPos p) {
        BlockState state = world.getBlockState(p);
        int slot = Mining.bestToolSlot(inv, state, world, p, true, job.spec.preferSilk);
        ItemStack tool = slot >= 0 ? inv.getStack(slot) : ItemStack.EMPTY;
        if (!Mining.canHarvest(tool, state)) {
            for (int i = 0; i < inv.size(); i++) {
                ItemStack worn = inv.getStack(i);
                if (!worn.isEmpty() && !Mining.isUsableTool(worn) && worn.isSuitableFor(state)) {
                    finishJob(player, inv, "My " + worn.getName().getString() + " is worn out (it would break). "
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

    private boolean isValidTarget(ServerWorld world, BlockPos p, boolean checkTree) {
        Job j = job;
        if (j.blacklist.contains(p) || !world.isChunkLoaded(p)) return false;
        BlockState state = world.getBlockState(p);
        if (!j.spec.matches(state)) return false;
        if (checkTree && state.isIn(BlockTags.LOGS)) return isPartOfTree(world, p);
        return true;
    }

    /** Logs only count if they're part of a real tree (natural leaves nearby), so cabins are safe. */
    private static boolean isPartOfTree(ServerWorld world, BlockPos p) {
        BlockPos.Mutable q = new BlockPos.Mutable();
        for (int dy = -1; dy <= 8; dy++) {
            for (int dx = -3; dx <= 3; dx++) {
                for (int dz = -3; dz <= 3; dz++) {
                    q.set(p.getX() + dx, p.getY() + dy, p.getZ() + dz);
                    BlockState s = world.getBlockState(q);
                    if (s.isIn(BlockTags.LEAVES) && Materials.isGatherable(s)) return true;
                }
            }
        }
        return false;
    }

    private static boolean isExposed(World world, BlockPos p) {
        for (Direction dir : Direction.values()) {
            BlockPos n = p.offset(dir);
            if (!world.getBlockState(n).isOpaqueFullCube(world, n)) return true;
        }
        return false;
    }

    private static void scan(ServerWorld world, BlockPos center, int radius, int vertical, Job j) {
        int minY = Math.max(world.getBottomY(), center.getY() - vertical);
        int maxY = Math.min(world.getTopY() - 1, center.getY() + vertical);
        Set<BlockPos> seen = new HashSet<>(j.candidates);
        for (int cx = (center.getX() - radius) >> 4; cx <= (center.getX() + radius) >> 4; cx++) {
            for (int cz = (center.getZ() - radius) >> 4; cz <= (center.getZ() + radius) >> 4; cz++) {
                WorldChunk chunk = world.getChunkManager().getWorldChunk(cx, cz);
                if (chunk == null) continue;
                scanChunk(world, chunk, minY, maxY, j, seen, center, radius);
            }
        }
        if (j.candidates.size() > MAX_CANDIDATES) {
            j.candidates.sort(Comparator.comparingDouble(p -> p.getSquaredDistance(center)));
            j.candidates.subList(MAX_CANDIDATES, j.candidates.size()).clear();
        }
    }

    /** Add every matching block in this chunk (within the radius of center, if given) to the candidates. */
    private static void scanChunk(ServerWorld world, WorldChunk chunk, int minY, int maxY, Job j,
                                  Set<BlockPos> seen, BlockPos center, int radius) {
        int r2 = radius * radius;
        int cx = chunk.getPos().x, cz = chunk.getPos().z;
        ChunkSection[] sections = chunk.getSectionArray();
        for (int si = 0; si < sections.length; si++) {
            int baseY = ChunkSectionPos.getBlockCoord(world.getBottomSectionCoord() + si);
            if (baseY + 15 < minY || baseY > maxY) continue;
            ChunkSection section = sections[si];
            if (section == null || section.isEmpty() || !section.hasAny(j.spec::matches)) continue;
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
    private boolean farSearch(MobEntity m, ServerPlayerEntity player, ServerWorld world, SimpleInventory inv) {
        Job j = job;
        if (j.farRing < 0) {
            j.farOrigin = new ChunkPos(m.getBlockPos());
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
        ServerChunkManager chunks = world.getChunkManager();
        Set<BlockPos> seen = new HashSet<>(j.candidates);
        for (java.util.Iterator<ChunkPos> it = j.farPending.iterator(); it.hasNext(); ) {
            ChunkPos cp = it.next();
            WorldChunk chunk = chunks.getWorldChunk(cp.x, cp.z);
            if (chunk == null) continue; // still loading / generating
            it.remove();
            scanChunk(world, chunk, world.getBottomY(), world.getTopY() - 1, j, seen, null, 0);
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
            chunks.addTicket(SEARCH_TICKET, cp, 0, cp);
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
                j.farQueue.add(new ChunkPos(j.farOrigin.x + dx, j.farOrigin.z + dz));
            }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Digging a path (staircases, tunnels, bridging, pillaring)
    // ---------------------------------------------------------------------------------------

    private void tickTunnel(MobEntity m, ServerPlayerEntity player, ServerWorld world, SimpleInventory inv) {
        Job j = job;
        if (j.stepCell != null) {
            BlockPos cell = j.stepCell;
            Vec3d center = Vec3d.ofBottomCenter(cell);
            if (m.getBlockPos().equals(cell) || m.getPos().squaredDistanceTo(center) < 0.15) {
                j.stepCell = null;
            } else if (++j.stepTicks > 25) {
                m.requestTeleport(center.x, center.y, center.z); // nudge into the freshly dug spot
                j.stepCell = null;
            } else {
                // Step straight into the freshly dug cell (pathfinding is unreliable in 1-wide tunnels).
                m.getMoveControl().moveTo(center.x, center.y, center.z, SPEED);
            }
            return;
        }

        BlockPos cur = m.getBlockPos();
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
        BlockPos next = cur.add(sx, sy, sz);
        boolean pillar = sx == 0 && sz == 0 && sy == 1;

        List<BlockPos> toClear = new ArrayList<>();
        if (sy == 1) toClear.add(cur.up(2));
        if (sy == -1) toClear.add(next.up(2));
        toClear.add(next.up());
        toClear.add(next);
        for (BlockPos cell : toClear) {
            if (cell.equals(cur) || cell.equals(cur.up())) continue;
            BlockState s = world.getBlockState(cell);
            if (passable(world, cell)) continue;
            if (s.getFluidState().isIn(FluidTags.LAVA) || lavaNear(world, cell)) {
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
            if (sx == 0 && sz == 0 && sy == -1 && cell.equals(next) && world.isSkyVisible(cur)) {
                j.shaftTops.add(next.toImmutable());
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
            m.requestTeleport(cur.getX() + 0.5, cur.getY() + 1.0, cur.getZ() + 0.5);
            placeBlock(world, inv, slot, cur);
            return;
        }

        BlockPos floor = next.down();
        BlockState floorState = world.getBlockState(floor);
        if (!floorState.isSideSolidFullSquare(world, floor, Direction.UP)) {
            boolean fluid = !floorState.getFluidState().isEmpty();
            if (floorState.isReplaceable() && (fluid || passable(world, floor))) {
                int slot = buildingBlockSlot(inv);
                if (slot >= 0 && nearBuild(world, floor, 3, true)) {
                    abandonTarget(m); // don't bridge through someone's build
                    return;
                } else if (slot >= 0) {
                    placeBlock(world, inv, slot, floor); // bridge over the gap, water or lava
                } else if (floorState.getFluidState().isIn(FluidTags.LAVA)
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
        Vec3d c = Vec3d.ofBottomCenter(next);
        m.getMoveControl().moveTo(c.x, c.y, c.z, SPEED);
    }

    private void plugShafts(ServerWorld world, SimpleInventory inv) {
        for (BlockPos top : job.shaftTops) {
            if (!world.isChunkLoaded(top) || !world.getBlockState(top).isAir()) continue;
            if (mob != null && mob.getBoundingBox().intersects(new net.minecraft.util.math.Box(top))) continue;
            if (nearBuild(world, top, 2, true)) continue; // leave holes next to builds for the owner to deal with
            int slot = buildingBlockSlot(inv);
            if (slot < 0) break;
            placeBlock(world, inv, slot, top);
        }
        job.shaftTops.clear();
    }

    /** Cover any lava in or next to the cell we're about to open. False if we ran out of blocks. */
    private boolean sealLava(ServerWorld world, SimpleInventory inv, BlockPos cell, BlockPos cur) {
        List<BlockPos> spots = new ArrayList<>();
        if (world.getFluidState(cell).isIn(FluidTags.LAVA)) spots.add(cell);
        for (Direction dir : Direction.values()) {
            BlockPos n = cell.offset(dir);
            if (n.equals(cur) || n.equals(cur.up())) continue;
            if (world.getFluidState(n).isIn(FluidTags.LAVA)) spots.add(n);
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
    private boolean canDigThrough(ServerWorld world, BlockPos pos, BlockState s) {
        if (protectedHere(world, pos, s)) return false;
        if (Materials.isTerrain(s) || job.spec.matches(s)) return true;
        if (s.hasBlockEntity()) return false;
        float hardness = s.getHardness(world, pos);
        if (hardness < 0 || hardness >= 30) return false;
        int surface = world.getTopY(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, pos.getX(), pos.getZ());
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
    private boolean protectedHere(ServerWorld world, BlockPos pos, BlockState s) {
        HelperData.Entry e = currentEntry;
        if (e != null && e.mineMarker != null && e.mineOrigin != null
                && world.getRegistryKey().getValue().toString().equals(e.mineDim)
                && Math.abs(pos.getX() - e.mineOrigin.getX()) <= 3 && Math.abs(pos.getZ() - e.mineOrigin.getZ()) <= 3) {
            if (pos.equals(e.mineMarker)) return true; // never dig up the marker itself
            if (s.isOf(net.minecraft.block.Blocks.SPAWNER)) return false;
            return s.hasBlockEntity() || isBuildEvidence(s);
        }
        return isProtected(world, pos, s);
    }

    static boolean isProtected(ServerWorld world, BlockPos pos, BlockState s) {
        if (s.isAir() || s.isOf(net.minecraft.block.Blocks.SPAWNER)) return false;
        if (s.hasBlockEntity()) return true;
        int surface = world.getTopY(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, pos.getX(), pos.getZ());
        boolean shallow = pos.getY() > surface - 8;
        if (shallow && isBuildEvidence(s)) return true;
        return nearBuild(world, pos, 2, shallow);
    }

    /** Is there a placed-looking block (or, when deep, a chest/bed/furnace) within radius? */
    static boolean nearBuild(ServerWorld world, BlockPos center, int radius, boolean shallow) {
        BlockPos.Mutable p = new BlockPos.Mutable();
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dy = -radius; dy <= radius; dy++) {
                for (int dz = -radius; dz <= radius; dz++) {
                    if (dx == 0 && dy == 0 && dz == 0) continue;
                    p.set(center.getX() + dx, center.getY() + dy, center.getZ() + dz);
                    BlockState s = world.getBlockState(p);
                    if (s.isAir()) continue;
                    if (s.hasBlockEntity()) {
                        if (!s.isOf(net.minecraft.block.Blocks.SPAWNER)) return true;
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
        if (s.isIn(BlockTags.LOGS) || s.isIn(BlockTags.LEAVES)) return false;
        if (s.isOf(net.minecraft.block.Blocks.TORCH) || s.isOf(net.minecraft.block.Blocks.WALL_TORCH)) return false;
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
    private static BlockPos findMineSpot(ServerWorld world, BlockPos near) {
        for (int[] o : MINE_SPOT_OFFSETS) {
            int x = near.getX() + o[0], z = near.getZ() + o[1];
            if (!world.getChunkManager().isChunkLoaded(x >> 4, z >> 4)
                    || !world.getChunkManager().isChunkLoaded((x + 2) >> 4, (z + 2) >> 4)
                    || !world.getChunkManager().isChunkLoaded((x - 1) >> 4, (z - 1) >> 4)) continue;
            BlockPos top = world.getTopPosition(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, new BlockPos(x, 0, z));
            if (goodMineSpot(world, top)) return top;
        }
        return null;
    }

    private static boolean goodMineSpot(ServerWorld world, BlockPos top) {
        // The staircase uses a 2x2 column; check a ring around it too.
        for (int dx = -1; dx <= 2; dx++) {
            for (int dz = -1; dz <= 2; dz++) {
                int x = top.getX() + dx, z = top.getZ() + dz;
                int ty = world.getTopY(Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, x, z);
                if (Math.abs(ty - top.getY()) > 2) return false; // roofs, walls or a cliff
                BlockPos ground = new BlockPos(x, ty - 1, z);
                if (!world.getFluidState(ground).isEmpty() || !world.getFluidState(ground.up()).isEmpty()) return false;
                if (!Materials.isTerrain(world.getBlockState(ground))) return false;
            }
        }
        return !nearBuild(world, top.down(), 5, true);
    }

    private static boolean hasGroundWithin(World world, BlockPos from, int depth) {
        for (int i = 1; i <= depth; i++) {
            BlockPos p = from.down(i);
            BlockState s = world.getBlockState(p);
            if (s.getFluidState().isIn(FluidTags.LAVA)) return false;
            if (s.isSideSolidFullSquare(world, p, Direction.UP)) return true;
        }
        return false;
    }

    private static boolean lavaNear(World world, BlockPos cell) {
        for (Direction dir : Direction.values()) {
            if (world.getFluidState(cell.offset(dir)).isIn(FluidTags.LAVA)) return true;
        }
        return false;
    }

    private static boolean isBuildingBlock(ItemStack stack) {
        if (!(stack.getItem() instanceof BlockItem bi)) return false;
        BlockState s = bi.getBlock().getDefaultState();
        if (s.hasBlockEntity() || bi.getBlock() instanceof net.minecraft.block.FallingBlock) return false;
        Item item = stack.getItem();
        String path = net.minecraft.registry.Registries.ITEM.getId(item).getPath();
        return s.isIn(BlockTags.BASE_STONE_OVERWORLD) || s.isIn(BlockTags.BASE_STONE_NETHER)
                || s.isIn(BlockTags.DIRT) || path.equals("cobblestone") || path.equals("cobbled_deepslate");
    }

    private int buildingBlockSlot(SimpleInventory inv) {
        for (int i = 0; i < inv.size(); i++) {
            ItemStack stack = inv.getStack(i);
            if (!stack.isEmpty() && isBuildingBlock(stack) && !job.spec.counts(stack)) return i;
        }
        return -1;
    }

    private static void placeBlock(ServerWorld world, SimpleInventory inv, int slot, BlockPos pos) {
        ItemStack stack = inv.getStack(slot);
        Block block = ((BlockItem) stack.getItem()).getBlock();
        BlockState state = block.getDefaultState();
        world.setBlockState(pos, state);
        world.playSound(null, pos, state.getSoundGroup().getPlaceSound(), SoundCategory.BLOCKS, 0.8f, 1f);
        stack.decrement(1);
        inv.markDirty();
    }

    private void abandonTarget(MobEntity m) {
        Job j = job;
        if (j.target != null) j.blacklist.add(j.target);
        j.target = null;
        j.stepCell = null;
        m.getNavigation().stop();
    }

    // ---------------------------------------------------------------------------------------
    // Breaking blocks
    // ---------------------------------------------------------------------------------------

    private void startBreaking(MobEntity m, ServerPlayerEntity player, ServerWorld world, SimpleInventory inv,
                               BlockPos pos, boolean isTarget) {
        Job j = job;
        BlockState state = world.getBlockState(pos);
        if (protectedHere(world, pos, state)) { // part of someone's build: never break it
            abandonTarget(m);
            return;
        }
        int slot = Mining.bestToolSlot(inv, state, world, pos, isTarget, j.spec.preferSilk);
        ItemStack tool = slot >= 0 ? inv.getStack(slot) : ItemStack.EMPTY;
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
        j.breaking = pos.toImmutable();
        j.breakTotal = ticks;
        j.breakProgress = 0;
        j.breakSlot = slot;
        j.lastStage = -1;
        j.breakingTarget = isTarget;
        m.equipStack(EquipmentSlot.MAINHAND, tool.copy());
    }

    private void tickBreaking(MobEntity m, ServerPlayerEntity player, ServerWorld world, SimpleInventory inv) {
        Job j = job;
        BlockPos pos = j.breaking;
        BlockState state = world.getBlockState(pos);
        if (state.isAir() || (!j.breakingTarget && passable(world, pos))) {
            clearBreaking(m);
            return;
        }
        m.getLookControl().lookAt(Vec3d.ofCenter(pos));
        j.breakProgress++;
        if (j.breakProgress % 4 == 1) {
            m.swingHand(Hand.MAIN_HAND);
            world.playSound(null, pos, state.getSoundGroup().getHitSound(), SoundCategory.NEUTRAL, 0.25f, 0.6f);
        }
        int stage = Math.min(9, (int) (10f * j.breakProgress / j.breakTotal));
        if (stage != j.lastStage) {
            world.setBlockBreakingInfo(m.getId(), pos, stage);
            j.lastStage = stage;
        }
        if (j.breakProgress < j.breakTotal) return;

        // Done: harvest it.
        ItemStack tool = j.breakSlot >= 0 ? inv.getStack(j.breakSlot) : ItemStack.EMPTY;
        if (!tool.isEmpty() && !Mining.isUsableTool(tool)) tool = ItemStack.EMPTY;
        boolean harvest = Mining.canHarvest(tool, state);
        float hardness = state.getHardness(world, pos);
        BlockEntity be = world.getBlockEntity(pos);
        List<ItemStack> drops = !harvest ? List.of()
                : state.isOf(net.minecraft.block.Blocks.SPAWNER) ? List.of(Devices.spawnerItem(be)) // keeps its mob
                : Block.getDroppedStacks(state, world, pos, be, m, tool);
        if (harvest) state.onStacksDropped(world, pos, tool, true);
        world.setBlockBreakingInfo(m.getId(), pos, -1);
        world.breakBlock(pos, false, m);
        if (!tool.isEmpty() && tool.isDamageable() && hardness != 0) {
            tool.damage(1, m, e -> {});
            inv.markDirty();
            if (!Mining.isUsableTool(tool)) {
                say(player, "My " + tool.getName().getString() + " is about to break, so I've stopped using it. "
                        + "Give me a new one, or take it out and repair it.");
            }
        }
        boolean wasTarget = j.breakingTarget;
        j.breaking = null;
        addWork(player, 1);
        for (ItemStack drop : drops) {
            if (wasTarget && j.spec.counts(drop)) j.collected += drop.getCount();
            ItemStack rest = inv.addStack(drop);
            if (!rest.isEmpty()) {
                Block.dropStack(world, pos, rest);
                if (mode == Mode.COLLECT) {
                    say(player, "I'm out of space, so I had to drop " + rest.getCount() + " "
                            + rest.getName().getString() + ". Bringing everything back to you.");
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
                        BlockPos n = pos.add(ox, oy, oz);
                        if (j.spec.matches(world.getBlockState(n)) && !j.blacklist.contains(n)) j.vein.addLast(n);
                    }
        }
        if (j.collected >= j.wanted && !j.done) {
            j.done = true;
            say(player, "Done! Got " + j.collected + " " + j.spec.display + ". Coming back to you.");
            mode = Mode.RETURN;
        }
    }

    private void clearBreaking(MobEntity m) {
        if (job != null && job.breaking != null) {
            m.getWorld().setBlockBreakingInfo(m.getId(), job.breaking, -1);
            job.breaking = null;
        }
    }

    private static final int STRIP_ROUNDS = 4;
    private static final int STRIP_STEP = 32;

    /**
     * Nothing left near the bottom of the mine. Don't give up yet: strip-mine further out from the bottom
     * landing, 32 blocks longer each time, until enough is found (or after a few rounds).
     */
    private void stripMineFurther(ServerPlayerEntity player, SimpleInventory inv, HelperData.Entry entry, int step) {
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

    private void finishJob(ServerPlayerEntity player, SimpleInventory inv, String message) {
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

    private static boolean isFull(SimpleInventory inv) {
        int room = inv instanceof HelperData.Pockets p ? p.unlocked : inv.size();
        for (int i = 0; i < room; i++) if (inv.getStack(i).isEmpty()) return false;
        return true;
    }

    static String summarize(SimpleInventory inv, boolean skipTools) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (int i = 0; i < inv.size(); i++) {
            ItemStack s = inv.getStack(i);
            if (s.isEmpty() || (skipTools && s.isDamageable())) continue;
            counts.merge(s.getName().getString(), s.getCount(), Integer::sum);
        }
        StringBuilder sb = new StringBuilder();
        counts.forEach((name, count) -> {
            if (sb.length() > 0) sb.append(", ");
            sb.append(count).append(' ').append(name);
        });
        return sb.toString();
    }

    static void say(ServerPlayerEntity player, String message) {
        MutableText text = Text.literal("[Helper] ").formatted(Formatting.GOLD)
                .append(Text.literal(message).formatted(Formatting.WHITE));
        if (Mind.sayToAll(player, text, message)) return; // answering chat: everyone sees the reply
        player.sendMessage(text, false);
    }
}
