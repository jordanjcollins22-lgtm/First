package com.helpermod;

import net.minecraft.server.network.ServerPlayerEntity;

/** Public entry points for mixins (Mind itself is package-private). */
public final class HelperHooks {
    private HelperHooks() {}

    /** A chat packet arrived. It may be on the network thread, so only queue it; Mind answers on the server tick. */
    public static void chatPacket(ServerPlayerEntity player, String text) {
        try {
            Mind.heard(player, text);
        } catch (Exception e) {
            HelperMod.LOG.warn("Helper couldn't read a chat line", e);
        }
    }
}
