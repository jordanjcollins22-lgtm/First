package com.helpermod.mixin;

import net.minecraft.entity.ExperienceOrbEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ExperienceOrbEntity.class)
public interface ExperienceOrbAccessor {
    /** How many orbs have merged into this one. */
    @Accessor("pickingCount")
    int helpermod$getPickingCount();
}
