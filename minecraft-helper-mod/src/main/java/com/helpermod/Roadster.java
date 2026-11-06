package com.helpermod;

import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.passive.HorseColor;
import net.minecraft.entity.passive.HorseEntity;
import net.minecraft.entity.passive.HorseMarking;
import net.minecraft.item.DyeableItem;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.DyeColor;
import net.minecraft.util.Formatting;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * The Star Roadster: a flying sports car (on the horse model) from the tycoon shop. Drive it like a horse;
 * hold W and look up to take off, look where you want to fly, let go of W to hover, look down to land.
 * Rocket smoke and flames pour out the back while it flies. Its paint is dyed horse armor, so any colour
 * works: /helper roadster paint red (or a hex code like #ff8800), and /helper roadster coat for the body.
 */
final class Roadster {
    private Roadster() {}

    static final String TAG = "helpermod_roadster";
    private static final int DEFAULT_PAINT = 0xCC1111; // cherry red
    /** Coins, in both the tycoon shop (first row) and the Fairway Pro Shop. */
    static final long PRICE = 250_000;

    /** The red horse-armor button the shops show for it. */
    static ItemStack shopIcon() {
        ItemStack s = new ItemStack(Items.LEATHER_HORSE_ARMOR);
        ((DyeableItem) Items.LEATHER_HORSE_ARMOR).setColor(s, DEFAULT_PAINT);
        s.setCustomName(Text.literal("Star Roadster").formatted(Formatting.RED));
        return s;
    }

    /** /helper roadster on its own: where to buy one and how to drive it. */
    static void info(ServerPlayerEntity player) {
        Helper.say(player, "The Star Roadster is a flying sports car for " + String.format("%,d", PRICE) + " coins. Buy it in "
                + "/helper tycoon shop (top row, next to the Saddle) or the Fairway Pro Shop (/helper golf shop). "
                + "Hold W and look up to fly. /helper roadster paint <colour>, coat <coat>, name <name>, call.");
    }

    // ---------------------------------------------------------------------------------------
    // Getting one
    // ---------------------------------------------------------------------------------------

    /** Bought in the tycoon shop: park a new roadster next to the player. */
    static boolean spawn(ServerPlayerEntity player) {
        ServerWorld world = player.getServerWorld();
        HorseEntity horse = EntityType.HORSE.create(world);
        if (horse == null) return false;
        Vec3d at = player.getPos().add(player.getRotationVector().multiply(2).multiply(1, 0, 1));
        horse.refreshPositionAndAngles(at.x, player.getY(), at.z, player.getYaw(), 0);
        horse.setTame(true);
        horse.setOwnerUuid(player.getUuid());
        horse.addCommandTag(TAG);
        var speed = horse.getAttributeInstance(EntityAttributes.GENERIC_MOVEMENT_SPEED);
        if (speed != null) speed.setBaseValue(0.42);
        var jump = horse.getAttributeInstance(EntityAttributes.HORSE_JUMP_STRENGTH);
        if (jump != null) jump.setBaseValue(0.9);
        var hp = horse.getAttributeInstance(EntityAttributes.GENERIC_MAX_HEALTH);
        if (hp != null) hp.setBaseValue(40);
        horse.setHealth(40);
        horse.setCustomName(Text.literal(player.getName().getString() + "'s Star Roadster").formatted(Formatting.RED));
        horse.setPersistent();
        world.spawnEntity(horse);
        dress(horse, HorseColor.WHITE, DEFAULT_PAINT, true);
        world.spawnParticles(ParticleTypes.FIREWORK, horse.getX(), horse.getY() + 1, horse.getZ(), 30, 0.6, 0.6, 0.6, 0.1);
        Helper.say(player, "Your Star Roadster is parked next to you! Hop on and drive. Hold W and look up to take off, "
                + "let go of W to hover, look down to land. /helper roadster paint <colour> to repaint it.");
        return true;
    }

    /** Saddle, coat and painted armor, set through the horse's own save data so it always sticks. */
    private static void dress(HorseEntity horse, HorseColor coat, int paint, boolean saddle) {
        NbtCompound nbt = new NbtCompound();
        horse.writeCustomDataToNbt(nbt);
        HorseMarking marking = HorseMarking.byIndex((nbt.getInt("Variant") >> 8) & 0xFF);
        nbt.putInt("Variant", (coat.getId() & 0xFF) | (marking.getId() & 0xFF) << 8);
        ItemStack armor = new ItemStack(Items.LEATHER_HORSE_ARMOR);
        ((DyeableItem) Items.LEATHER_HORSE_ARMOR).setColor(armor, paint);
        nbt.put("ArmorItem", armor.writeNbt(new NbtCompound()));
        if (saddle) nbt.put("SaddleItem", new ItemStack(Items.SADDLE).writeNbt(new NbtCompound()));
        horse.readCustomDataFromNbt(nbt);
    }

    private static HorseEntity mine(ServerPlayerEntity player) {
        if (player.getVehicle() instanceof HorseEntity h && h.getCommandTags().contains(TAG)) return h;
        Box around = player.getBoundingBox().expand(32);
        List<HorseEntity> list = player.getServerWorld().getEntitiesByClass(HorseEntity.class, around,
                h -> h.getCommandTags().contains(TAG) && player.getUuid().equals(h.getOwnerUuid()));
        HorseEntity best = null;
        for (HorseEntity h : list) if (best == null || h.squaredDistanceTo(player) < best.squaredDistanceTo(player)) best = h;
        return best;
    }

    // ---------------------------------------------------------------------------------------
    // Customising
    // ---------------------------------------------------------------------------------------

    /** "red", "light_blue", "#ff8800" or "ff8800" -> an RGB colour, or -1. */
    static int parseColour(String s) {
        String t = s.trim().toLowerCase(Locale.ROOT).replace(' ', '_');
        if (t.startsWith("#")) t = t.substring(1);
        if (t.matches("[0-9a-f]{6}")) return Integer.parseInt(t, 16);
        switch (t) {
            case "gold": return 0xF5C542;
            case "silver": return 0xC8C8C8;
            case "chrome": return 0xE8EEF2;
            case "midnight": return 0x101830;
            case "hot_pink": return 0xFF3FA4;
            default: break;
        }
        DyeColor dye = DyeColor.byName(t, null);
        if (dye == null) return -1;
        float[] c = dye.getColorComponents();
        return ((int) (c[0] * 255) << 16) | ((int) (c[1] * 255) << 8) | (int) (c[2] * 255);
    }

    static void paint(ServerPlayerEntity player, String colour) {
        HorseEntity h = mine(player);
        if (h == null) {
            Helper.say(player, "I can't see your Star Roadster nearby. Buy one in /helper tycoon shop, or stand next to it.");
            return;
        }
        int rgb = parseColour(colour);
        if (rgb < 0) {
            Helper.say(player, "I don't know the colour \"" + colour + "\". Try red, blue, lime, black, gold, chrome, "
                    + "hot_pink, or a hex code like #ff8800.");
            return;
        }
        NbtCompound nbt = new NbtCompound();
        h.writeCustomDataToNbt(nbt);
        dress(h, HorseColor.byId(nbt.getInt("Variant") & 0xFF), rgb, false);
        ((ServerWorld) h.getWorld()).spawnParticles(ParticleTypes.HAPPY_VILLAGER, h.getX(), h.getY() + 1, h.getZ(), 20, 0.6, 0.6, 0.6, 0);
        Helper.say(player, "Fresh paint! Your Star Roadster is now " + colour + ".");
    }

    static void coat(ServerPlayerEntity player, String name) {
        HorseEntity h = mine(player);
        if (h == null) {
            Helper.say(player, "I can't see your Star Roadster nearby.");
            return;
        }
        HorseColor coat = null;
        for (HorseColor c : HorseColor.values()) if (c.asString().equalsIgnoreCase(name.trim())) coat = c;
        if (coat == null) {
            Helper.say(player, "Coats: white, creamy, chestnut, brown, black, gray, dark_brown.");
            return;
        }
        NbtCompound nbt = new NbtCompound();
        h.writeCustomDataToNbt(nbt);
        int paint = DEFAULT_PAINT;
        if (nbt.contains("ArmorItem")) {
            ItemStack armor = ItemStack.fromNbt(nbt.getCompound("ArmorItem"));
            if (armor.getItem() instanceof DyeableItem d) paint = d.getColor(armor);
        }
        dress(h, coat, paint, false);
        Helper.say(player, "Your Star Roadster's body is " + coat.asString() + " now.");
    }

    static void rename(ServerPlayerEntity player, String name) {
        HorseEntity h = mine(player);
        if (h == null) {
            Helper.say(player, "I can't see your Star Roadster nearby.");
            return;
        }
        h.setCustomName(Text.literal(name.length() > 32 ? name.substring(0, 32) : name).formatted(Formatting.RED));
        Helper.say(player, "Your roadster is called " + name + " now.");
    }

    /** /helper roadster call: bring it to you (same world). */
    static void call(ServerPlayerEntity player) {
        HorseEntity found = null;
        for (ServerWorld w : player.getServer().getWorlds()) {
            for (Entity e : w.iterateEntities()) {
                if (e instanceof HorseEntity h && h.getCommandTags().contains(TAG) && player.getUuid().equals(h.getOwnerUuid())) {
                    found = h;
                    break;
                }
            }
            if (found != null) break;
        }
        if (found == null) {
            Helper.say(player, "Your Star Roadster isn't loaded anywhere. If it's far away, go back to where you parked it.");
            return;
        }
        if (found.getWorld() != player.getWorld()) {
            Helper.say(player, "Your Star Roadster is parked in another world. Go back there to drive it.");
            return;
        }
        found.requestTeleport(player.getX() + 1.5, player.getY(), player.getZ());
        Helper.say(player, "Here's your Star Roadster!");
    }

    // ---------------------------------------------------------------------------------------
    // Flying
    // ---------------------------------------------------------------------------------------

    static void tick(MinecraftServer server) {
        for (ServerPlayerEntity rider : server.getPlayerManager().getPlayerList()) {
            if (!(rider.getVehicle() instanceof HorseEntity h) || !h.getCommandTags().contains(TAG)) continue;
            fly(rider, h);
        }
        // A parked roadster drops back to the ground.
        if (server.getTicks() % 20 == 0) {
            for (ServerWorld w : server.getWorlds()) {
                for (Entity e : w.iterateEntities()) {
                    if (e instanceof HorseEntity h && h.hasNoGravity() && h.getCommandTags().contains(TAG) && !h.hasPassengers()) {
                        h.setNoGravity(false);
                    }
                }
            }
        }
    }

    private static void fly(ServerPlayerEntity rider, HorseEntity h) {
        ServerWorld world = rider.getServerWorld();
        if (autopilot(rider, h, world)) return;
        float forward = rider.forwardSpeed;
        Vec3d look = rider.getRotationVec(1f);
        boolean airborne = h.hasNoGravity();
        if (!airborne) {
            if (forward > 0 && rider.getPitch() < -25 || WAYPOINTS.containsKey(rider.getUuid())) { // lift off
                h.setNoGravity(true);
                h.setVelocity(h.getVelocity().add(0, 0.5, 0));
                h.velocityModified = true;
                world.playSound(null, h.getBlockPos(), SoundEvents.ENTITY_FIREWORK_ROCKET_LAUNCH, SoundCategory.NEUTRAL, 1f, 0.6f);
            }
            return;
        }
        h.fallDistance = 0;
        rider.fallDistance = 0;
        if (h.isOnGround() && rider.getPitch() > 10) { // touched down looking down: drive again
            h.setNoGravity(false);
            return;
        }
        double speed = rider.isSprinting() ? 1.3 : 0.85;
        Vec3d v = forward > 0 ? look.multiply(speed)
                : h.getVelocity().multiply(0.6, 0, 0.6); // no W: slow to a hover
        h.setVelocity(h.getVelocity().multiply(0.4).add(v.multiply(0.6)));
        h.velocityModified = true;
        // Rocket smoke and flames out the back.
        Vec3d back = h.getPos().subtract(Vec3d.fromPolar(0, h.getYaw()).multiply(1.4)).add(0, 0.7, 0);
        world.spawnParticles(ParticleTypes.CAMPFIRE_COSY_SMOKE, back.x, back.y, back.z, 2, 0.15, 0.1, 0.15, 0.01);
        world.spawnParticles(ParticleTypes.FLAME, back.x, back.y, back.z, 3, 0.1, 0.05, 0.1, 0.02);
        if (forward > 0) world.spawnParticles(ParticleTypes.FIREWORK, back.x, back.y, back.z, 1, 0.05, 0.05, 0.05, 0.02);
        if (world.getTime() % 30 == 0) {
            world.playSound(null, h.getBlockPos(), SoundEvents.ENTITY_BLAZE_BURN, SoundCategory.NEUTRAL, 0.5f, 0.6f);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Autopilot: set a temporary waypoint, sit in the roadster, and it flies you there and lands
    // ---------------------------------------------------------------------------------------

    private enum Phase { CLIMB, CRUISE, LAND }

    private static final class Waypoint {
        final net.minecraft.registry.RegistryKey<net.minecraft.world.World> world;
        final double x, z;
        Phase phase = Phase.CLIMB;
        int ticks;

        Waypoint(net.minecraft.registry.RegistryKey<net.minecraft.world.World> world, double x, double z) {
            this.world = world;
            this.x = x;
            this.z = z;
        }
    }

    /** Temporary: one per player, gone once it lands you (or you cancel, or the server restarts). */
    private static final Map<UUID, Waypoint> WAYPOINTS = new HashMap<>();
    private static final double CRUISE_SPEED = 1.2;
    private static final int MIN_CRUISE_Y = 120;

    static void reset() {
        WAYPOINTS.clear();
    }

    /** /helper roadster waypoint <x> <z> (or "here" to come back to where you're standing). */
    static void setWaypoint(ServerPlayerEntity player, double x, double z) {
        WAYPOINTS.put(player.getUuid(), new Waypoint(player.getWorld().getRegistryKey(), x, z));
        boolean riding = player.getVehicle() instanceof HorseEntity h && h.getCommandTags().contains(TAG);
        int dist = (int) Math.sqrt(sq(x - player.getX()) + sq(z - player.getZ()));
        Helper.say(player, "Waypoint set at " + (int) Math.floor(x) + ", " + (int) Math.floor(z) + " (" + dist + " blocks away). "
                + (riding ? "Autopilot on: sit back, I'll fly you there and land. Press S to take over."
                : "Hop in your Star Roadster and the autopilot takes you there. /helper roadster waypoint clear cancels it."));
    }

    static void clearWaypoint(ServerPlayerEntity player) {
        Helper.say(player, WAYPOINTS.remove(player.getUuid()) != null ? "Waypoint cleared. You're driving."
                : "You don't have a roadster waypoint set.");
    }

    private static double sq(double d) {
        return d * d;
    }

    /** Flies the roadster to the rider's waypoint. True while the autopilot is in control. */
    private static boolean autopilot(ServerPlayerEntity rider, HorseEntity h, ServerWorld world) {
        Waypoint wp = WAYPOINTS.get(rider.getUuid());
        if (wp == null) return false;
        if (wp.world != world.getRegistryKey()) {
            if (wp.ticks++ == 0) Helper.say(rider, "That waypoint is in another dimension, so the autopilot can't get there. Cleared it.");
            WAYPOINTS.remove(rider.getUuid());
            return false;
        }
        if (rider.forwardSpeed < 0) { // S: the rider takes over
            WAYPOINTS.remove(rider.getUuid());
            rider.sendMessage(Text.literal("Autopilot off. You're driving.").formatted(Formatting.YELLOW), true);
            return false;
        }
        wp.ticks++;
        h.fallDistance = 0;
        rider.fallDistance = 0;
        double dx = wp.x - h.getX(), dz = wp.z - h.getZ();
        double flat = Math.sqrt(dx * dx + dz * dz);
        if (!h.hasNoGravity()) {
            h.setNoGravity(true);
            world.playSound(null, h.getBlockPos(), SoundEvents.ENTITY_FIREWORK_ROCKET_LAUNCH, SoundCategory.NEUTRAL, 1f, 0.6f);
            if (wp.phase == Phase.LAND) wp.phase = Phase.CLIMB;
        }
        // How high to fly: well above the ground here and a little ahead (only chunks that are already loaded).
        double nx = flat > 0.01 ? dx / flat : 0, nz = flat > 0.01 ? dz / flat : 0;
        int ground = groundY(world, h.getX(), h.getZ());
        for (int k = 8; k <= 32; k += 8) ground = Math.max(ground, groundY(world, h.getX() + nx * k, h.getZ() + nz * k));
        double cruise = Math.min(world.getTopY() - 8, Math.max(MIN_CRUISE_Y, ground + 25));
        Vec3d v;
        if (wp.phase != Phase.LAND && flat < 3) wp.phase = Phase.LAND;
        switch (wp.phase) {
            case CLIMB -> {
                v = new Vec3d(nx * 0.2, 0.7, nz * 0.2);
                if (h.getY() >= cruise - 2 || flat < 40 && h.getY() >= ground + 12) wp.phase = Phase.CRUISE;
            }
            case CRUISE -> {
                double speed = Math.min(CRUISE_SPEED, Math.max(0.3, flat / 12)); // slow down coming in
                double up = h.getY() < cruise - 3 && flat > 40 ? 0.4 : h.getY() < ground + 6 ? 0.5 : 0;
                v = new Vec3d(nx * speed, up, nz * speed);
            }
            default -> { // LAND: straight down, gently, over the waypoint
                double above = h.getY() - groundY(world, h.getX(), h.getZ());
                v = new Vec3d(dx * 0.1, above > 10 ? -0.6 : -0.25, dz * 0.1);
                if (h.isOnGround() || above < 0.2) {
                    h.setNoGravity(false);
                    h.setVelocity(Vec3d.ZERO);
                    h.velocityModified = true;
                    WAYPOINTS.remove(rider.getUuid());
                    world.spawnParticles(ParticleTypes.CLOUD, h.getX(), h.getY(), h.getZ(), 20, 0.8, 0.1, 0.8, 0.02);
                    world.playSound(null, h.getBlockPos(), SoundEvents.ENTITY_PLAYER_LEVELUP, SoundCategory.NEUTRAL, 0.6f, 1.4f);
                    Helper.say(rider, "Touchdown! We've landed at your waypoint (" + (int) Math.floor(wp.x) + ", " + (int) Math.floor(wp.z) + ").");
                    return true;
                }
            }
        }
        h.setVelocity(h.getVelocity().multiply(0.3).add(v.multiply(0.7)));
        h.velocityModified = true;
        if (flat > 0.5) h.setYaw((float) (Math.toDegrees(Math.atan2(-nx, nz))));
        h.setBodyYaw(h.getYaw());
        // Smoke and flames out the back, same as when you fly it yourself.
        Vec3d back = h.getPos().subtract(Vec3d.fromPolar(0, h.getYaw()).multiply(1.4)).add(0, 0.7, 0);
        world.spawnParticles(ParticleTypes.CAMPFIRE_COSY_SMOKE, back.x, back.y, back.z, 2, 0.15, 0.1, 0.15, 0.01);
        world.spawnParticles(ParticleTypes.FLAME, back.x, back.y, back.z, 3, 0.1, 0.05, 0.1, 0.02);
        if (wp.phase != Phase.LAND) world.spawnParticles(ParticleTypes.FIREWORK, back.x, back.y, back.z, 1, 0.05, 0.05, 0.05, 0.02);
        if (wp.ticks % 20 == 0) {
            String what = wp.phase == Phase.CLIMB ? "Taking off" : wp.phase == Phase.CRUISE ? "Autopilot" : "Landing";
            rider.sendMessage(Text.literal(what + ": " + (int) flat + " blocks to go (S to take over)").formatted(Formatting.AQUA), true);
        }
        if (world.getTime() % 30 == 0) world.playSound(null, h.getBlockPos(), SoundEvents.ENTITY_BLAZE_BURN, SoundCategory.NEUTRAL, 0.5f, 0.6f);
        return true;
    }

    /** Top of the ground (ignoring leaves) at x, z; the world bottom when that chunk isn't loaded yet. */
    private static int groundY(ServerWorld world, double x, double z) {
        int bx = (int) Math.floor(x), bz = (int) Math.floor(z);
        if (!world.isChunkLoaded(bx >> 4, bz >> 4)) return world.getBottomY();
        return world.getTopY(net.minecraft.world.Heightmap.Type.MOTION_BLOCKING_NO_LEAVES, bx, bz);
    }
}
