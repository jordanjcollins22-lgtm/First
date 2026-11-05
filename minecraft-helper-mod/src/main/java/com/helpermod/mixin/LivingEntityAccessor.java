package com.helpermod.mixin;

import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.player.PlayerEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Lets a helper's hit count as its owner's, so mobs it kills drop XP (and player-only loot). */
@Mixin(LivingEntity.class)
public interface LivingEntityAccessor {
    @Accessor("attackingPlayer")
    void helpermod$setAttackingPlayer(PlayerEntity player);

    @Accessor("playerHitTimer")
    void helpermod$setPlayerHitTimer(int ticks);
}
