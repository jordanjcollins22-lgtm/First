package com.helpermod;

import com.helpermod.mixin.PassiveEntityAccessor;
import com.helpermod.mixin.PiglinEntityAccessor;
import com.helpermod.mixin.ZombieEntityAccessor;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.entity.AgeableMob;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.monster.zombie.Zombie;
import net.minecraft.world.entity.monster.piglin.Piglin;
import net.minecraft.world.level.Level;
import org.jetbrains.annotations.Nullable;

import java.lang.reflect.Method;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Makes helpers shorter or taller with Minecraft's own scale attribute (any look, any size).
 */
public final class Size {
    private Size() {}

    public static final float MIN = 0.25f;
    public static final float MAX = 4.0f;

    /** Newer Minecraft has a built-in scale attribute, so helpers can always be resized. */
    public static boolean hasPehkui() {
        return true;
    }

    /** The size saved for this helper's owner (1 = normal). */
    public static float sizeOf(Entity helper) {
        UUID owner = Helper.ownerOf(helper);
        MinecraftServer server = helper.level().getServer();
        if (owner == null || server == null) return 1f;
        HelperData.Entry entry = HelperData.get(server).get(owner);
        return entry == null || entry.size <= 0 ? 1f : entry.size;
    }

    /** Apply the saved size to a freshly spawned helper, with the vanilla scale attribute. */
    public static boolean apply(Entity helper, float size) {
        if (!(helper instanceof net.minecraft.world.entity.LivingEntity living)) return false;
        var scale = living.getAttribute(net.minecraft.world.entity.ai.attributes.Attributes.SCALE);
        if (scale == null) return false;
        scale.setBaseValue(Math.max(MIN, Math.min(MAX, size)));
        return true;
    }

    private static final Map<EntityType<?>, Optional<EntityDataAccessor<Boolean>>> BABY_FLAGS = new ConcurrentHashMap<>();

    /** The baby flag for a mob type, or null if that mob has no baby version. */
    @Nullable
    public static EntityDataAccessor<Boolean> babyFlag(EntityType<?> type, Level world) {
        return BABY_FLAGS.computeIfAbsent(type, t -> {
            Entity sample = null;
            try {
                sample = t.create(world, net.minecraft.world.entity.EntitySpawnReason.MOB_SUMMONED);
                if (sample instanceof Zombie) return Optional.of(ZombieEntityAccessor.helpermod$getBaby());
                if (sample instanceof Piglin) return Optional.of(PiglinEntityAccessor.helpermod$getBaby());
                if (sample instanceof AgeableMob) return Optional.of(PassiveEntityAccessor.helpermod$getBaby());
                return Optional.empty();
            } catch (RuntimeException e) {
                return Optional.empty();
            } finally {
                if (sample != null) sample.discard();
            }
        }).orElse(null);
    }

    /** Without Pehkui, a small helper with a mob look is shown as that mob's baby. */
    @Nullable
    public static SynchedEntityData.DataValue<Boolean> babyEntry(Entity helper, @Nullable EntityType<?> look) {
        if (look == null || hasPehkui() || sizeOf(helper) >= 1f) return null;
        EntityDataAccessor<Boolean> flag = babyFlag(look, helper.level());
        return flag == null ? null : SynchedEntityData.DataValue.create(flag, true);
    }

    public static String describe(float size) {
        if (size == 1f) return "normal size";
        return (size < 1f ? "smaller" : "bigger") + " (" + Math.round(size * 100) + "% size)";
    }
}
