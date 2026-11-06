package com.helpermod.mixin;

import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Lets the mod read whether a rider is pressing jump, and lets a helper's hit count as its owner's, so mobs it kills drop XP (and player-only loot). */
@Mixin(LivingEntity.class)
public interface LivingEntityAccessor {
    @Accessor("attackingPlayer")
    void helpermod$setAttackingPlayer(Player player);

    /** Whether the player is holding jump (sent by their game even while riding). */
    @Accessor("jumping")
    boolean helpermod$isJumping();

    @Accessor("playerHitTimer")
    void helpermod$setPlayerHitTimer(int ticks);
}
