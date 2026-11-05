package com.helpermod.mixin;

import net.minecraft.entity.data.TrackedData;
import net.minecraft.entity.mob.PiglinEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** The baby flag, so a small helper can be shown as the baby version of its mob. */
@Mixin(PiglinEntity.class)
public interface PiglinEntityAccessor {
    @Accessor("BABY")
    static TrackedData<Boolean> helpermod$getBaby() {
        throw new AssertionError();
    }
}
