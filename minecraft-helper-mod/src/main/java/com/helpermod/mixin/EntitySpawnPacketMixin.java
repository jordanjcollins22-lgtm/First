package com.helpermod.mixin;

import com.helpermod.Disguise;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientGamePacketListener;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Helpers are sent to clients as players (their owner's skin) or as the mob their owner picked. */
@Mixin(Entity.class)
public abstract class EntitySpawnPacketMixin {
    @Inject(method = "createSpawnPacket", at = @At("HEAD"), cancellable = true)
    private void helpermod$spawnAsPlayer(CallbackInfoReturnable<Packet<ClientGamePacketListener>> cir) {
        Entity self = (Entity) (Object) this;
        if (Disguise.isHelper(self)) cir.setReturnValue(Disguise.spawnPacket(self));
    }
}
