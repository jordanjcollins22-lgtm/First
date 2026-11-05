package com.helpermod;

import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.projectile.FireworkRocketEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtList;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.math.Vec3d;

/** The helper's little party when it drops off your items: a spin-and-hop dance and fireworks. */
public final class Celebrate {
    private Celebrate() {}

    /** Two seconds of dancing. */
    public static final int DANCE_TICKS = 40;

    private static final int[][] COLORS = {
            {0xFF5555, 0xFFAA00}, {0x55FF55, 0x55FFFF}, {0x5555FF, 0xFF55FF}, {0xFFFF55, 0xFFFFFF},
    };

    /** Spin in place and hop every half second. */
    public static void danceStep(MobEntity m, int ticksLeft) {
        m.getNavigation().stop();
        float yaw = m.getYaw() + 24f;
        m.setYaw(yaw);
        m.setBodyYaw(yaw);
        m.setHeadYaw(yaw);
        if (ticksLeft % 10 == 0 && m.isOnGround()) m.getJumpControl().setActive();
    }

    /** Two rockets that fly high before bursting, so the blast doesn't hurt anyone nearby. */
    public static void fireworks(ServerWorld world, Vec3d at) {
        // Under a roof a rocket bursts against the ceiling, right next to you. Only launch in the open.
        if (!world.isSkyVisible(net.minecraft.util.math.BlockPos.ofFloored(at).up())) return;
        for (int i = 0; i < 2; i++) {
            ItemStack rocket = rocket(world.random.nextInt(COLORS.length), world.random.nextInt(5));
            double dx = (world.random.nextDouble() - 0.5) * 2.0;
            double dz = (world.random.nextDouble() - 0.5) * 2.0;
            world.spawnEntity(new FireworkRocketEntity(world, at.x + dx, at.y + 1.0, at.z + dz, rocket));
        }
    }

    private static ItemStack rocket(int palette, int shape) {
        ItemStack stack = new ItemStack(Items.FIREWORK_ROCKET);
        NbtCompound fireworks = stack.getOrCreateSubNbt("Fireworks");
        fireworks.putByte("Flight", (byte) 2);
        NbtCompound burst = new NbtCompound();
        burst.putByte("Type", (byte) shape); // ball, big ball, star, creeper face or burst
        burst.putIntArray("Colors", COLORS[palette]);
        burst.putIntArray("FadeColors", new int[]{0xFFFFFF});
        burst.putBoolean("Twinkle", true);
        burst.putBoolean("Trail", true);
        NbtList explosions = new NbtList();
        explosions.add(burst);
        fireworks.put("Explosions", explosions);
        return stack;
    }
}
