package com.helpermod;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.projectile.FireworkRocketEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.Vec3;

/** The helper's little party when it drops off your items: a spin-and-hop dance and fireworks. */
public final class Celebrate {
    private Celebrate() {}

    /** Two seconds of dancing. */
    public static final int DANCE_TICKS = 40;

    private static final int[][] COLORS = {
            {0xFF5555, 0xFFAA00}, {0x55FF55, 0x55FFFF}, {0x5555FF, 0xFF55FF}, {0xFFFF55, 0xFFFFFF},
    };

    /** Spin in place and hop every half second. */
    public static void danceStep(Mob m, int ticksLeft) {
        m.getNavigation().stop();
        float yaw = m.getYRot() + 24f;
        m.setYRot(yaw);
        m.setYBodyRot(yaw);
        m.setYHeadRot(yaw);
        if (ticksLeft % 10 == 0 && m.onGround()) m.getJumpControl().jump();
    }

    /** Two rockets that fly high before bursting, so the blast doesn't hurt anyone nearby. */
    public static void fireworks(ServerLevel world, Vec3 at) {
        // Under a roof a rocket bursts against the ceiling, right next to you. Only launch in the open.
        if (!world.canSeeSky(net.minecraft.core.BlockPos.containing(at).above())) return;
        for (int i = 0; i < 2; i++) {
            ItemStack rocket = rocket(world.getRandom().nextInt(COLORS.length), world.getRandom().nextInt(5));
            double dx = (world.getRandom().nextDouble() - 0.5) * 2.0;
            double dz = (world.getRandom().nextDouble() - 0.5) * 2.0;
            world.addFreshEntity(new FireworkRocketEntity(world, at.x + dx, at.y + 1.0, at.z + dz, rocket));
        }
    }

    private static ItemStack rocket(int palette, int shape) {
        ItemStack stack = new ItemStack(Items.FIREWORK_ROCKET);
        // ball, big ball, star, creeper face or burst
        net.minecraft.world.item.component.FireworkExplosion burst = new net.minecraft.world.item.component.FireworkExplosion(
                net.minecraft.world.item.component.FireworkExplosion.Shape.byId(shape),
                it.unimi.dsi.fastutil.ints.IntList.of(COLORS[palette]), it.unimi.dsi.fastutil.ints.IntList.of(0xFFFFFF), true, true);
        stack.set(net.minecraft.core.component.DataComponents.FIREWORKS,
                new net.minecraft.world.item.component.Fireworks(2, java.util.List.of(burst)));
        return stack;
    }
}
