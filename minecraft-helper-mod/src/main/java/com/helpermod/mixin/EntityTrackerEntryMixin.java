package com.helpermod.mixin;

import com.helpermod.Disguise;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyArg;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.Collection;
import java.util.List;
import java.util.function.Consumer;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientGamePacketListener;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.server.level.ServerEntity;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;

/**
 * Makes the disguise work (as the owner, or as a mob picked with /helper look): announce the fake player before it spawns, only send
 * the entity data a player understands, and clean up when it stops being visible.
 */
@Mixin(ServerEntity.class)
public abstract class EntityTrackerEntryMixin {
    @Shadow @Final private Entity entity;

    @Inject(method = "sendPairingData", at = @At("HEAD"))
    private void helpermod$announcePlayer(ServerPlayer player,
                                          Consumer<Packet<ClientGamePacketListener>> sender, CallbackInfo ci) {
        if (Disguise.looksLikePlayer(entity)) sender.accept(Disguise.playerListAdd(entity));
    }

    @Inject(method = "removePairing", at = @At("TAIL"))
    private void helpermod$forgetPlayer(ServerPlayer player, CallbackInfo ci) {
        if (Disguise.looksLikePlayer(entity)) player.connection.send(Disguise.playerListRemove(entity));
    }

    @ModifyArg(method = "sendPairingData", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/game/ClientboundSetEntityDataPacket;<init>(ILjava/util/List;)V"),
            index = 1)
    private List<SynchedEntityData.DataValue<?>> helpermod$initialData(List<SynchedEntityData.DataValue<?>> list) {
        return Disguise.isHelper(entity) ? Disguise.filterData(entity, list, true) : list;
    }

    @ModifyArg(method = "sendDirtyEntityData", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/game/ClientboundSetEntityDataPacket;<init>(ILjava/util/List;)V"),
            index = 1)
    private List<SynchedEntityData.DataValue<?>> helpermod$syncData(List<SynchedEntityData.DataValue<?>> list) {
        return Disguise.isHelper(entity) ? Disguise.filterData(entity, list, false) : list;
    }

    @ModifyArg(method = {"sendPairingData", "sendDirtyEntityData"}, at = @At(value = "INVOKE",
            target = "Lnet/minecraft/network/protocol/game/ClientboundUpdateAttributesPacket;<init>(ILjava/util/Collection;)V"),
            index = 1)
    private Collection<AttributeInstance> helpermod$attributes(Collection<AttributeInstance> attributes) {
        return Disguise.isHelper(entity) ? Disguise.filterAttributes(entity, attributes) : attributes;
    }
}
