package com.helpermod.mixin;

import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.world.entity.monster.piglin.Piglin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** The baby flag, so a small helper can be shown as the baby version of its mob. */
@Mixin(Piglin.class)
public interface PiglinEntityAccessor {
    @Accessor("DATA_BABY_ID")
    static EntityDataAccessor<Boolean> helpermod$getBaby() {
        throw new AssertionError();
    }
}
