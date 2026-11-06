package com.helpermod.mixin;

import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Minecraft 26 has no public setter for "never takes damage", so set the field directly. */
@Mixin(Entity.class)
public interface EntityAccessor {
    @Accessor("permanentlyInvulnerable")
    void helpermod$setInvulnerable(boolean invulnerable);
}
