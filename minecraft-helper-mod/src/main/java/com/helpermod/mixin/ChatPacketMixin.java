package com.helpermod.mixin;

import com.helpermod.HelperHooks;
import net.minecraft.network.protocol.game.ServerboundChatPacket;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Hears chat straight from the packet, for servers where a chat mod replaces the normal chat broadcast
 * and the Fabric chat event never fires. Mind skips lines it already answered.
 */
@Mixin(ServerGamePacketListenerImpl.class)
public abstract class ChatPacketMixin {
    @Shadow public ServerPlayer player;

    @Inject(method = "handleChat", at = @At("HEAD"), require = 0)
    private void helpermod$hearChat(ServerboundChatPacket packet, CallbackInfo ci) {
        HelperHooks.chatPacket(player, packet.message());
    }
}
