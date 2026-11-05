package com.helpermod.mixin;

import com.helpermod.Disguise;
import net.minecraft.entity.Entity;
import net.minecraft.entity.attribute.EntityAttributeInstance;
import net.minecraft.entity.data.DataTracker;
import net.minecraft.network.listener.ClientPlayPacketListener;
import net.minecraft.network.packet.Packet;
import net.minecraft.server.network.EntityTrackerEntry;
import net.minecraft.server.network.ServerPlayerEntity;
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

/**
 * Makes the disguise work (as the owner, or as a mob picked with /helper look): announce the fake player before it spawns, only send
 * the entity data a player understands, and clean up when it stops being visible.
 */
@Mixin(EntityTrackerEntry.class)
public abstract class EntityTrackerEntryMixin {
    @Shadow @Final private Entity entity;

    @Inject(method = "sendPackets", at = @At("HEAD"))
    private void helpermod$announcePlayer(ServerPlayerEntity player,
                                          Consumer<Packet<ClientPlayPacketListener>> sender, CallbackInfo ci) {
        if (Disguise.looksLikePlayer(entity)) sender.accept(Disguise.playerListAdd(entity));
    }

    @Inject(method = "stopTracking", at = @At("TAIL"))
    private void helpermod$forgetPlayer(ServerPlayerEntity player, CallbackInfo ci) {
        if (Disguise.looksLikePlayer(entity)) player.networkHandler.sendPacket(Disguise.playerListRemove(entity));
    }

    @ModifyArg(method = "sendPackets", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/network/packet/s2c/play/EntityTrackerUpdateS2CPacket;<init>(ILjava/util/List;)V"),
            index = 1)
    private List<DataTracker.SerializedEntry<?>> helpermod$initialData(List<DataTracker.SerializedEntry<?>> list) {
        return Disguise.isHelper(entity) ? Disguise.filterData(entity, list, true) : list;
    }

    @ModifyArg(method = "syncEntityData", at = @At(value = "INVOKE",
            target = "Lnet/minecraft/network/packet/s2c/play/EntityTrackerUpdateS2CPacket;<init>(ILjava/util/List;)V"),
            index = 1)
    private List<DataTracker.SerializedEntry<?>> helpermod$syncData(List<DataTracker.SerializedEntry<?>> list) {
        return Disguise.isHelper(entity) ? Disguise.filterData(entity, list, false) : list;
    }

    @ModifyArg(method = {"sendPackets", "syncEntityData"}, at = @At(value = "INVOKE",
            target = "Lnet/minecraft/network/packet/s2c/play/EntityAttributesS2CPacket;<init>(ILjava/util/Collection;)V"),
            index = 1)
    private Collection<EntityAttributeInstance> helpermod$attributes(Collection<EntityAttributeInstance> attributes) {
        return Disguise.isHelper(entity) ? Disguise.filterAttributes(entity, attributes) : attributes;
    }
}
