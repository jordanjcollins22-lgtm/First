package com.helpermod.mixin;

import com.helpermod.Disguise;
import net.minecraft.entity.Entity;
import net.minecraft.network.listener.ClientPlayPacketListener;
import net.minecraft.network.packet.Packet;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Helpers are sent to clients as players, so they show up with their owner's skin. */
@Mixin(Entity.class)
public abstract class EntitySpawnPacketMixin {
    @Inject(method = "createSpawnPacket", at = @At("HEAD"), cancellable = true)
    private void helpermod$spawnAsPlayer(CallbackInfoReturnable<Packet<ClientPlayPacketListener>> cir) {
        Entity self = (Entity) (Object) this;
        if (Disguise.isHelper(self)) cir.setReturnValue(Disguise.spawnPacket(self));
    }
}
