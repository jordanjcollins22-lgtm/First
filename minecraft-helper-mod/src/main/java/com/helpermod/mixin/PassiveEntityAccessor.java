package com.helpermod.mixin;

import net.minecraft.entity.data.TrackedData;
import net.minecraft.entity.passive.PassiveEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** The baby flag, so a small helper can be shown as the baby version of its mob. */
@Mixin(PassiveEntity.class)
public interface PassiveEntityAccessor {
    @Accessor("CHILD")
    static TrackedData<Boolean> helpermod$getBaby() {
        throw new AssertionError();
    }
}
