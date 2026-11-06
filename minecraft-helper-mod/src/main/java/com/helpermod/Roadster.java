package com.helpermod;

import net.minecraft.ChatFormatting;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.animal.equine.Horse;
import net.minecraft.world.entity.animal.equine.Markings;
import net.minecraft.world.entity.animal.equine.Variant;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
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
 * Since 2.9.0 it looks like a real car: the horse is shrunk and hidden, and a 3D roadster model
 * (assets/helpermod/items/vehicle/roadster.json, made by tools/furniture_models.py) rides along with it.
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
        s.set(net.minecraft.core.component.DataComponents.DYED_COLOR, new net.minecraft.world.item.component.DyedItemColor(DEFAULT_PAINT));
        s.set(net.minecraft.core.component.DataComponents.CUSTOM_NAME, Component.literal("Star Roadster").withStyle(ChatFormatting.RED));
        return s;
    }

    /** /helper roadster on its own: where to buy one and how to drive it. */
    static void info(ServerPlayer player) {
        Helper.say(player, "The Star Roadster is a flying sports car for " + String.format("%,d", PRICE) + " coins. Buy it in "
                + "/helper tycoon shop (top row, next to the Saddle) or the Fairway Pro Shop (/helper golf shop). "
                + "Hold W and look up to fly. /helper roadster paint <colour>, coat <coat>, name <name>, call.");
    }

    // ---------------------------------------------------------------------------------------
    // Getting one
    // ---------------------------------------------------------------------------------------

    /** Bought in the tycoon shop: park a new roadster next to the player. */
    static boolean spawn(ServerPlayer player) {
        ServerLevel world = player.level();
        Horse horse = EntityTypes.HORSE.create(world, net.minecraft.world.entity.EntitySpawnReason.MOB_SUMMONED);
        if (horse == null) return false;
        Vec3 at = player.position().add(player.getLookAngle().scale(2).multiply(1, 0, 1));
        horse.snapTo(at.x, player.getY(), at.z, player.getYRot(), 0);
        horse.setTamed(true);
        horse.setOwner(player);
        horse.addTag(TAG);
        var speed = horse.getAttribute(Attributes.MOVEMENT_SPEED);
        if (speed != null) speed.setBaseValue(0.42);
        var jump = horse.getAttribute(Attributes.JUMP_STRENGTH);
        if (jump != null) jump.setBaseValue(0.9);
        var hp = horse.getAttribute(Attributes.MAX_HEALTH);
        if (hp != null) hp.setBaseValue(40);
        horse.setHealth(40);
        horse.setCustomName(Component.literal(player.getName().getString() + "'s Star Roadster").withStyle(ChatFormatting.RED));
        horse.setPersistenceRequired();
        world.addFreshEntity(horse);
        dress(horse, Variant.WHITE, DEFAULT_PAINT, true);
        makeCar(horse);
        world.sendParticles(ParticleTypes.FIREWORK, horse.getX(), horse.getY() + 1, horse.getZ(), 30, 0.6, 0.6, 0.6, 0.1);
        Helper.say(player, "Your Star Roadster is parked next to you! Hop on and drive. Hold W and look up to take off, "
                + "let go of W to hover, look down to land. /helper roadster paint <colour> to repaint it.");
        return true;
    }

    /** Saddle, coat and painted armor, set through the horse's own save data so it always sticks. */
    private static void dress(Horse horse, Variant coat, int paint, boolean saddle) {
        horse.setComponent(net.minecraft.core.component.DataComponents.HORSE_VARIANT, coat); // keeps its markings
        ItemStack armor = new ItemStack(Items.LEATHER_HORSE_ARMOR);
        armor.set(net.minecraft.core.component.DataComponents.DYED_COLOR, new net.minecraft.world.item.component.DyedItemColor(paint));
        hide(armor, net.minecraft.world.entity.EquipmentSlot.BODY);
        horse.setItemSlot(net.minecraft.world.entity.EquipmentSlot.BODY, armor);
        if (saddle) horse.setItemSlot(net.minecraft.world.entity.EquipmentSlot.SADDLE, saddle());
        refreshModel(horse);
    }

    /** Still counts as worn, but draws nothing (no equipment asset), so only the car model shows. */
    private static void hide(ItemStack s, net.minecraft.world.entity.EquipmentSlot slot) {
        s.set(net.minecraft.core.component.DataComponents.EQUIPPABLE,
                net.minecraft.world.item.equipment.Equippable.builder(slot).build());
    }

    private static ItemStack saddle() {
        ItemStack s = new ItemStack(Items.SADDLE);
        hide(s, net.minecraft.world.entity.EquipmentSlot.SADDLE);
        return s;
    }

    private static boolean hidden(ItemStack s) {
        var e = s.get(net.minecraft.core.component.DataComponents.EQUIPPABLE);
        return s.isEmpty() || e != null && e.assetId().isEmpty();
    }

    // ---------------------------------------------------------------------------------------
    // The car model: an item display that sits where the horse is, on the ground, turned the same way
    // ---------------------------------------------------------------------------------------

    static final String MODEL_TAG = "helpermod_roadster_model";
    private static final float CAR_SCALE = 0.5f; // the hidden horse: small, so you sit low in the car
    private static final int STRIPE = 0xF4F4F4;
    private static final Map<UUID, Horse> CARS = new HashMap<>();
    private static final Map<UUID, Entity> MODELS = new HashMap<>();

    /** Hide the horse inside the car (also turns roadsters bought before 2.9.0 into cars). */
    static void makeCar(Horse h) {
        if (!h.hasEffect(net.minecraft.world.effect.MobEffects.INVISIBILITY)) {
            h.addEffect(new net.minecraft.world.effect.MobEffectInstance(net.minecraft.world.effect.MobEffects.INVISIBILITY,
                    net.minecraft.world.effect.MobEffectInstance.INFINITE_DURATION, 0, false, false));
        }
        var scale = h.getAttribute(Attributes.SCALE);
        if (scale != null && scale.getBaseValue() != CAR_SCALE) scale.setBaseValue(CAR_SCALE);
        Compat.setStep(h, 1.1f);
        ItemStack armor = h.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.BODY);
        if (!hidden(armor)) {
            ItemStack copy = armor.copy();
            hide(copy, net.minecraft.world.entity.EquipmentSlot.BODY);
            h.setItemSlot(net.minecraft.world.entity.EquipmentSlot.BODY, copy);
        }
        if (!hidden(h.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.SADDLE))) {
            h.setItemSlot(net.minecraft.world.entity.EquipmentSlot.SADDLE, saddle());
        }
        CARS.put(h.getUUID(), h);
    }

    private static int paintOf(Horse h) {
        return net.minecraft.world.item.component.DyedItemColor.getOrDefault(
                h.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.BODY), DEFAULT_PAINT);
    }

    /** Throw the model away so the next tick builds it again (new paint). */
    private static void refreshModel(Horse h) {
        Entity m = MODELS.remove(h.getUUID());
        if (m != null) m.discard();
        else for (Entity e : near(h)) e.discard();
    }

    private static List<Entity> near(Horse h) {
        String link = MODEL_TAG + ":" + h.getUUID();
        return h.level().getEntities((Entity) null, h.getBoundingBox().inflate(8),
                e -> e.entityTags().contains(MODEL_TAG) && e.entityTags().contains(link));
    }

    private static Entity spawnModel(Horse h) {
        ServerLevel world = (ServerLevel) h.level();
        ItemStack look = new ItemStack(Items.STICK);
        look.set(net.minecraft.core.component.DataComponents.ITEM_MODEL,
                net.minecraft.resources.Identifier.fromNamespaceAndPath(HelperMod.MOD_ID, "vehicle/roadster"));
        look.set(net.minecraft.core.component.DataComponents.CUSTOM_MODEL_DATA, new net.minecraft.world.item.component.CustomModelData(
                List.of(), List.of(), List.of(), List.of(paintOf(h), STRIPE)));
        Vec3 seat = h.getPassengerRidingPosition(h);
        float drop = (float) (seat.y - h.getY());
        CompoundTag nbt = new CompoundTag();
        nbt.putString("id", "minecraft:item_display");
        nbt.put("item", Compat.saveStack(look));
        nbt.putString("item_display", "none");
        CompoundTag tf = new CompoundTag();
        tf.put("translation", floats(0, -drop, 0)); // the model's ground line on the ground, the seat under the rider
        tf.put("left_rotation", floats(0, 0, 0, 1));
        tf.put("scale", floats(2, 2, 2)); // the model is drawn at half size
        tf.put("right_rotation", floats(0, 0, 0, 1));
        nbt.put("transformation", tf);
        nbt.putInt("teleport_duration", 2);
        nbt.putFloat("width", 4);
        nbt.putFloat("height", 2);
        nbt.putFloat("view_range", 2);
        net.minecraft.nbt.ListTag tags = new net.minecraft.nbt.ListTag();
        tags.add(net.minecraft.nbt.StringTag.valueOf(MODEL_TAG));
        tags.add(net.minecraft.nbt.StringTag.valueOf(MODEL_TAG + ":" + h.getUUID()));
        nbt.put("Tags", tags);
        Entity e = Compat.loadEntity(nbt, world, entity -> {
            entity.snapTo(seat.x, seat.y, seat.z, h.getYRot(), 0);
            return entity;
        });
        if (e != null) world.addFreshEntity(e);
        return e;
    }

    private static net.minecraft.nbt.ListTag floats(float... f) {
        net.minecraft.nbt.ListTag l = new net.minecraft.nbt.ListTag();
        for (float v : f) l.add(net.minecraft.nbt.FloatTag.valueOf(v));
        return l;
    }

    private static java.lang.reflect.Method rideMethod;

    /** Entity#startRiding(vehicle, force...) whatever extra flags this version has. */
    private static void ride(Entity e, Entity vehicle) {
        try {
            if (rideMethod == null) {
                for (java.lang.reflect.Method m : Entity.class.getMethods()) {
                    Class<?>[] t = m.getParameterTypes();
                    if (!m.getName().equals("startRiding") || t.length < 2 || t[0] != Entity.class) continue;
                    boolean flags = true;
                    for (int i = 1; i < t.length; i++) flags &= t[i] == boolean.class;
                    if (flags && (rideMethod == null || t.length < rideMethod.getParameterCount())) rideMethod = m;
                }
            }
            Object[] args = new Object[rideMethod.getParameterCount()];
            args[0] = vehicle;
            for (int i = 1; i < args.length; i++) args[i] = true;
            rideMethod.invoke(e, args);
        } catch (ReflectiveOperationException | RuntimeException ex) {
            HelperMod.LOG.warn("Couldn't seat the roadster model", ex);
        }
    }

    /**
     * Every tick: keep each car's model on it. While someone drives, the model rides the horse too (the
     * driver's own game moves it, so it never lags behind); parked, it just sits where the horse is.
     */
    private static void moveModels() {
        var it = CARS.entrySet().iterator();
        while (it.hasNext()) {
            var en = it.next();
            Horse h = en.getValue();
            Entity m = MODELS.get(en.getKey());
            if (h.isRemoved()) {
                it.remove();
                if (m != null && (h.getRemovalReason() == null || h.getRemovalReason().shouldDestroy())) m.discard();
                MODELS.remove(en.getKey());
                continue;
            }
            if (m == null || m.isRemoved()) {
                List<Entity> old = near(h);
                m = old.isEmpty() ? spawnModel(h) : old.get(0);
                for (int i = 1; i < old.size(); i++) old.get(i).discard();
                if (m == null) continue;
                MODELS.put(en.getKey(), m);
            }
            boolean driven = h.getFirstPassenger() instanceof net.minecraft.world.entity.player.Player;
            if (driven && m.getVehicle() != h) ride(m, h);
            else if (!driven && m.isPassenger()) m.stopRiding();
            float yaw = h.getYRot();
            if (Math.abs(net.minecraft.util.Mth.wrapDegrees(m.getYRot() - yaw)) > 0.5f) m.setYRot(yaw);
            if (!m.isPassenger()) {
                Vec3 seat = h.getPassengerRidingPosition(h);
                if (m.position().distanceToSqr(seat) > 1e-4) m.teleportTo(seat.x, seat.y, seat.z);
            }
        }
    }

    private static Horse mine(ServerPlayer player) {
        if (player.getVehicle() instanceof Horse h && h.entityTags().contains(TAG)) return h;
        AABB around = player.getBoundingBox().inflate(32);
        List<Horse> list = player.level().getEntitiesOfClass(Horse.class, around,
                h -> h.entityTags().contains(TAG) && Compat.ownedBy(h, player.getUUID()));
        Horse best = null;
        for (Horse h : list) if (best == null || h.distanceToSqr(player) < best.distanceToSqr(player)) best = h;
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
        return dye.getTextureDiffuseColor() & 0xFFFFFF;
    }

    static void paint(ServerPlayer player, String colour) {
        Horse h = mine(player);
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
        dress(h, h.getVariant(), rgb, false);
        ((ServerLevel) h.level()).sendParticles(ParticleTypes.HAPPY_VILLAGER, h.getX(), h.getY() + 1, h.getZ(), 20, 0.6, 0.6, 0.6, 0);
        Helper.say(player, "Fresh paint! Your Star Roadster is now " + colour + ".");
    }

    static void coat(ServerPlayer player, String name) {
        Horse h = mine(player);
        if (h == null) {
            Helper.say(player, "I can't see your Star Roadster nearby.");
            return;
        }
        Variant coat = null;
        for (Variant c : Variant.values()) if (c.getSerializedName().equalsIgnoreCase(name.trim())) coat = c;
        if (coat == null) {
            Helper.say(player, "Coats: white, creamy, chestnut, brown, black, gray, dark_brown.");
            return;
        }
        int paint = net.minecraft.world.item.component.DyedItemColor.getOrDefault(
                h.getItemBySlot(net.minecraft.world.entity.EquipmentSlot.BODY), DEFAULT_PAINT);
        dress(h, coat, paint, false);
        Helper.say(player, "Your Star Roadster's body is " + coat.getSerializedName() + " now.");
    }

    static void rename(ServerPlayer player, String name) {
        Horse h = mine(player);
        if (h == null) {
            Helper.say(player, "I can't see your Star Roadster nearby.");
            return;
        }
        h.setCustomName(Component.literal(name.length() > 32 ? name.substring(0, 32) : name).withStyle(ChatFormatting.RED));
        Helper.say(player, "Your roadster is called " + name + " now.");
    }

    /** /helper roadster call: bring it to you (same world). */
    static void call(ServerPlayer player) {
        Horse found = null;
        for (ServerLevel w : player.level().getServer().getAllLevels()) {
            for (Entity e : w.getAllEntities()) {
                if (e instanceof Horse h && h.entityTags().contains(TAG) && Compat.ownedBy(h, player.getUUID())) {
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
        if (found.level() != player.level()) {
            Helper.say(player, "Your Star Roadster is parked in another world. Go back there to drive it.");
            return;
        }
        found.teleportTo(player.getX() + 1.5, player.getY(), player.getZ());
        Helper.say(player, "Here's your Star Roadster!");
    }

    // ---------------------------------------------------------------------------------------
    // Flying
    // ---------------------------------------------------------------------------------------

    static void tick(MinecraftServer server) {
        for (ServerPlayer rider : server.getPlayerList().getPlayers()) {
            if (!(rider.getVehicle() instanceof Horse h) || !h.entityTags().contains(TAG)) continue;
            fly(rider, h);
        }
        // A parked roadster drops back to the ground. Roadsters that just loaded become cars.
        if (server.getTickCount() % 20 == 0) {
            for (ServerLevel w : server.getAllLevels()) {
                for (Entity e : w.getAllEntities()) {
                    if (!(e instanceof Horse h) || !h.entityTags().contains(TAG)) continue;
                    if (!CARS.containsKey(h.getUUID()) || !h.hasEffect(net.minecraft.world.effect.MobEffects.INVISIBILITY)) makeCar(h);
                    if (h.isNoGravity() && !(h.getFirstPassenger() instanceof net.minecraft.world.entity.player.Player)) land(h);
                }
            }
        }
        moveModels();
    }

    /**
     * A ridden, saddled horse is steered by the rider's own game, not the server, so the server can't fly it.
     * While it's in the air the saddle comes off (it goes back on when it lands): with no saddle the rider
     * is a passenger and the server moves the roadster, so the flying and the autopilot actually happen.
     */
    private static void takeOff(Horse h) {
        h.setNoGravity(true);
        if (h.isSaddled()) h.getSlot(400).set(ItemStack.EMPTY);
        h.getNavigation().stop();
    }

    /** Where the rocket smoke comes out: the nozzles at the back of the car. */
    private static Vec3 exhaust(Horse h) {
        return h.position().subtract(Vec3.directionFromRotation(0, h.getYRot()).scale(2.0)).add(0, 0.4, 0);
    }

    private static void land(Horse h) {
        h.setNoGravity(false);
        if (!h.isSaddled()) h.getSlot(400).set(saddle());
    }

    private static void fly(ServerPlayer rider, Horse h) {
        if (h.isNoGravity()) {
            h.getNavigation().stop(); // its own legs stay out of it while flying
            if (h.isSaddled()) h.getSlot(400).set(ItemStack.EMPTY); // e.g. after a restart mid-flight
        }
        ServerLevel world = rider.level();
        if (autopilot(rider, h, world)) return;
        float forward = rider.zza;
        Vec3 look = rider.getViewVector(1f);
        boolean airborne = h.isNoGravity();
        if (!airborne) {
            if (forward > 0 && rider.getXRot() < -25 || WAYPOINTS.containsKey(rider.getUUID())) { // lift off
                takeOff(h);
                h.setDeltaMovement(h.getDeltaMovement().add(0, 0.5, 0));
                h.needsSync = true;
                world.playSound(null, h.blockPosition(), SoundEvents.FIREWORK_ROCKET_LAUNCH, SoundSource.NEUTRAL, 1f, 0.6f);
            }
            return;
        }
        h.fallDistance = 0;
        rider.fallDistance = 0;
        if (h.onGround() && (rider.getXRot() > 10 || forward <= 0)) { // touched down: drive again
            land(h);
            return;
        }
        h.setYRot(rider.getYRot());
        h.setYBodyRot(rider.getYRot());
        h.setYHeadRot(rider.getYRot());
        double speed = rider.isSprinting() ? 1.3 : 0.85;
        Vec3 v = forward > 0 ? look.scale(speed)
                : h.getDeltaMovement().multiply(0.6, 0, 0.6); // no W: slow to a hover
        h.setDeltaMovement(h.getDeltaMovement().scale(0.4).add(v.scale(0.6)));
        h.needsSync = true;
        // Rocket smoke and flames out the back.
        Vec3 back = exhaust(h);
        world.sendParticles(ParticleTypes.CAMPFIRE_COSY_SMOKE, back.x, back.y, back.z, 2, 0.15, 0.1, 0.15, 0.01);
        world.sendParticles(ParticleTypes.FLAME, back.x, back.y, back.z, 3, 0.1, 0.05, 0.1, 0.02);
        if (forward > 0) world.sendParticles(ParticleTypes.FIREWORK, back.x, back.y, back.z, 1, 0.05, 0.05, 0.05, 0.02);
        if (world.getGameTime() % 30 == 0) {
            world.playSound(null, h.blockPosition(), SoundEvents.BLAZE_BURN, SoundSource.NEUTRAL, 0.5f, 0.6f);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Autopilot: set a temporary waypoint, sit in the roadster, and it flies you there and lands
    // ---------------------------------------------------------------------------------------

    private enum Phase { CLIMB, CRUISE, LAND }

    private static final class Waypoint {
        final net.minecraft.resources.ResourceKey<net.minecraft.world.level.Level> world;
        final double x, z;
        Phase phase = Phase.CLIMB;
        int ticks;

        Waypoint(net.minecraft.resources.ResourceKey<net.minecraft.world.level.Level> world, double x, double z) {
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
        CARS.clear();
        MODELS.clear();
    }

    /** /helper roadster waypoint <x> <z> (or "here" to come back to where you're standing). */
    static void setWaypoint(ServerPlayer player, double x, double z) {
        WAYPOINTS.put(player.getUUID(), new Waypoint(player.level().dimension(), x, z));
        boolean riding = player.getVehicle() instanceof Horse h && h.entityTags().contains(TAG);
        int dist = (int) Math.sqrt(sq(x - player.getX()) + sq(z - player.getZ()));
        Helper.say(player, "Waypoint set at " + (int) Math.floor(x) + ", " + (int) Math.floor(z) + " (" + dist + " blocks away). "
                + (riding ? "Autopilot on: sit back, I'll fly you there and land. Press S to take over."
                : "Hop in your Star Roadster and the autopilot takes you there. /helper roadster waypoint clear cancels it."));
    }

    static void clearWaypoint(ServerPlayer player) {
        Helper.say(player, WAYPOINTS.remove(player.getUUID()) != null ? "Waypoint cleared. You're driving."
                : "You don't have a roadster waypoint set.");
    }

    private static double sq(double d) {
        return d * d;
    }

    /** Flies the roadster to the rider's waypoint. True while the autopilot is in control. */
    private static boolean autopilot(ServerPlayer rider, Horse h, ServerLevel world) {
        Waypoint wp = WAYPOINTS.get(rider.getUUID());
        if (wp == null) return false;
        if (wp.world != world.dimension()) {
            if (wp.ticks++ == 0) Helper.say(rider, "That waypoint is in another dimension, so the autopilot can't get there. Cleared it.");
            WAYPOINTS.remove(rider.getUUID());
            return false;
        }
        if (rider.zza < 0) { // S: the rider takes over
            WAYPOINTS.remove(rider.getUUID());
            rider.sendOverlayMessage(Component.literal("Autopilot off. You're driving.").withStyle(ChatFormatting.YELLOW));
            return false;
        }
        wp.ticks++;
        h.fallDistance = 0;
        rider.fallDistance = 0;
        double dx = wp.x - h.getX(), dz = wp.z - h.getZ();
        double flat = Math.sqrt(dx * dx + dz * dz);
        if (!h.isNoGravity()) {
            takeOff(h);
            world.playSound(null, h.blockPosition(), SoundEvents.FIREWORK_ROCKET_LAUNCH, SoundSource.NEUTRAL, 1f, 0.6f);
            if (wp.phase == Phase.LAND) wp.phase = Phase.CLIMB;
        }
        // How high to fly: well above the ground here and a little ahead (only chunks that are already loaded).
        double nx = flat > 0.01 ? dx / flat : 0, nz = flat > 0.01 ? dz / flat : 0;
        int ground = groundY(world, h.getX(), h.getZ());
        for (int k = 8; k <= 32; k += 8) ground = Math.max(ground, groundY(world, h.getX() + nx * k, h.getZ() + nz * k));
        double cruise = Math.min((world.getMaxY() + 1) - 8, Math.max(MIN_CRUISE_Y, ground + 25));
        Vec3 v;
        if (wp.phase != Phase.LAND && flat < 3) wp.phase = Phase.LAND;
        switch (wp.phase) {
            case CLIMB -> {
                v = new Vec3(nx * 0.2, 0.7, nz * 0.2);
                if (h.getY() >= cruise - 2 || flat < 40 && h.getY() >= ground + 12) wp.phase = Phase.CRUISE;
            }
            case CRUISE -> {
                double speed = Math.min(CRUISE_SPEED, Math.max(0.3, flat / 12)); // slow down coming in
                double up = h.getY() < cruise - 3 && flat > 40 ? 0.4 : h.getY() < ground + 6 ? 0.5 : 0;
                v = new Vec3(nx * speed, up, nz * speed);
            }
            default -> { // LAND: straight down, gently, over the waypoint
                double above = h.getY() - groundY(world, h.getX(), h.getZ());
                v = new Vec3(dx * 0.1, above > 10 ? -0.6 : -0.25, dz * 0.1);
                if (h.onGround() || above < 0.2) {
                    land(h);
                    h.setDeltaMovement(Vec3.ZERO);
                    h.needsSync = true;
                    WAYPOINTS.remove(rider.getUUID());
                    world.sendParticles(ParticleTypes.CLOUD, h.getX(), h.getY(), h.getZ(), 20, 0.8, 0.1, 0.8, 0.02);
                    world.playSound(null, h.blockPosition(), SoundEvents.PLAYER_LEVELUP, SoundSource.NEUTRAL, 0.6f, 1.4f);
                    Helper.say(rider, "Touchdown! We've landed at your waypoint (" + (int) Math.floor(wp.x) + ", " + (int) Math.floor(wp.z) + ").");
                    return true;
                }
            }
        }
        h.setDeltaMovement(h.getDeltaMovement().scale(0.3).add(v.scale(0.7)));
        h.needsSync = true;
        if (flat > 0.5) h.setYRot((float) (Math.toDegrees(Math.atan2(-nx, nz))));
        h.setYBodyRot(h.getYRot());
        // Smoke and flames out the back, same as when you fly it yourself.
        Vec3 back = exhaust(h);
        world.sendParticles(ParticleTypes.CAMPFIRE_COSY_SMOKE, back.x, back.y, back.z, 2, 0.15, 0.1, 0.15, 0.01);
        world.sendParticles(ParticleTypes.FLAME, back.x, back.y, back.z, 3, 0.1, 0.05, 0.1, 0.02);
        if (wp.phase != Phase.LAND) world.sendParticles(ParticleTypes.FIREWORK, back.x, back.y, back.z, 1, 0.05, 0.05, 0.05, 0.02);
        if (wp.ticks % 20 == 0) {
            String what = wp.phase == Phase.CLIMB ? "Taking off" : wp.phase == Phase.CRUISE ? "Autopilot" : "Landing";
            rider.sendOverlayMessage(Component.literal(what + ": " + (int) flat + " blocks to go (S to take over)").withStyle(ChatFormatting.AQUA));
        }
        if (world.getGameTime() % 30 == 0) world.playSound(null, h.blockPosition(), SoundEvents.BLAZE_BURN, SoundSource.NEUTRAL, 0.5f, 0.6f);
        return true;
    }

    /** Top of the ground (ignoring leaves) at x, z; the world bottom when that chunk isn't loaded yet. */
    private static int groundY(ServerLevel world, double x, double z) {
        int bx = (int) Math.floor(x), bz = (int) Math.floor(z);
        if (!world.hasChunk(bx >> 4, bz >> 4)) return world.getMinY();
        return world.getHeight(net.minecraft.world.level.levelgen.Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, bx, bz);
    }
}
