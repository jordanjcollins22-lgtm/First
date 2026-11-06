package com.helpermod;

import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.common.ClientboundResourcePackPushPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/**
 * The furniture's 3D models live in the mod's assets, so players with the mod see them straight away. Friends who join
 * without the mod are offered the same models as a small resource pack when they join (it's optional; without it the
 * furniture shows as missing-texture boxes). The pack is hosted on GitHub, named after its own SHA-1, so every version
 * of the mod points at exactly the pack it was built with.
 */
final class FurniturePack {
    private FurniturePack() {}

    static final String BASE = "https://raw.githubusercontent.com/jordanjcollins22-lgtm/First/claude/helper-assets/";
    private static final UUID PACK_ID = UUID.nameUUIDFromBytes("helpermod:furniture".getBytes());
    private static String sha1;
    private static boolean looked;
    private static final Map<UUID, Integer> WAITING = new HashMap<>();

    /** The bundled pack's SHA-1, or null if it's missing from the jar. */
    static String sha1() {
        if (!looked) {
            looked = true;
            try (InputStream in = FurniturePack.class.getResourceAsStream("/helper-furniture-pack.zip")) {
                if (in != null) sha1 = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(in.readAllBytes()));
            } catch (Exception e) {
                HelperMod.LOG.warn("Couldn't read the furniture pack", e);
            }
        }
        return sha1;
    }

    static String url() {
        return BASE + "helper-furniture-pack-" + sha1() + ".zip";
    }

    static void onJoin(ServerPlayer player) {
        WAITING.put(player.getUUID(), 60); // once the client has said whether it has the mod
    }

    static void tick(MinecraftServer server) {
        if (WAITING.isEmpty()) return;
        WAITING.replaceAll((id, t) -> t - 1);
        WAITING.entrySet().removeIf(e -> {
            if (e.getValue() > 0) return false;
            ServerPlayer p = server.getPlayerList().getPlayer(e.getKey());
            if (p != null && !MiniMapLink.hasClientMap(p)) send(p);
            return true;
        });
    }

    static void send(ServerPlayer p) {
        if (sha1() == null) return;
        p.connection.send(new ClientboundResourcePackPushPacket(PACK_ID, url(), sha1(), false,
                Optional.of(Component.literal("Helper Buddies 3D models. Say yes to see the furniture and the Star Roadster in 3D.")
                        .withStyle(ChatFormatting.GOLD))));
    }

    static void reset() {
        WAITING.clear();
    }
}
