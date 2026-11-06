package com.helpermod.mixin;

import net.minecraft.world.entity.ExperienceOrb;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ExperienceOrb.class)
public interface ExperienceOrbAccessor {
    /** How many orbs have merged into this one. */
    @Accessor("count")
    int helpermod$getPickingCount();
}
