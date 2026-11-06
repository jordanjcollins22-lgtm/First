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

import java.util.List;
import java.util.Locale;

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
        float forward = rider.forwardSpeed;
        Vec3d look = rider.getRotationVec(1f);
        boolean airborne = h.hasNoGravity();
        if (!airborne) {
            if (forward > 0 && rider.getPitch() < -25) { // looking up while driving: lift off
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
}
