package com.helpermod.mixin;

import com.helpermod.HelperHooks;
import net.minecraft.network.packet.c2s.play.ChatMessageC2SPacket;
import net.minecraft.server.network.ServerPlayNetworkHandler;
import net.minecraft.server.network.ServerPlayerEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Hears chat straight from the packet, for servers where a chat mod replaces the normal chat broadcast
 * and the Fabric chat event never fires. Mind skips lines it already answered.
 */
@Mixin(ServerPlayNetworkHandler.class)
public abstract class ChatPacketMixin {
    @Shadow public ServerPlayerEntity player;

    @Inject(method = "onChatMessage", at = @At("HEAD"), require = 0)
    private void helpermod$hearChat(ChatMessageC2SPacket packet, CallbackInfo ci) {
        HelperHooks.chatPacket(player, packet.chatMessage());
    }
}
