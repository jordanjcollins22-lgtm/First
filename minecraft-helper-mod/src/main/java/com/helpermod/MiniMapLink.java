package com.helpermod;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.MapItem;

/**
 * The corner mini map is drawn by the mod on each player's own PC, so a friend who joins without the mod (or with an
 * older copy) can't see it. This works out who has it and gives everyone else a fallback: /helper minimap puts a
 * "Helper Mini Map" in their off hand, a normal map that keeps re-centring on them as they walk, which every client
 * can show.
 */
public final class MiniMapLink {
    private MiniMapLink() {}

    /** Sent to nobody: a client with the mod registers a receiver for it, which is how the server can tell. */
    public record Hello() implements CustomPacketPayload {
        public static final Type<Hello> TYPE = new Type<>(Identifier.fromNamespaceAndPath(HelperMod.MOD_ID, "minimap_hello"));
        static final StreamCodec<RegistryFriendlyByteBuf, Hello> CODEC = StreamCodec.unit(new Hello());

        @Override
        public Type<? extends CustomPacketPayload> type() {
            return TYPE;
        }
    }

    private static final String MAP_TAG = "HelperMiniMap";
    private static final int RECENTRE = 80; // blocks from the map's centre before it re-centres (it shows 256 across)
    private static final Map<UUID, Integer> JOIN_CHECK = new HashMap<>();

    static void register() {
        // The server-to-client play registry, found by name: it's playS2C() in older Fabric API and renamed in newer.
        for (var m : PayloadTypeRegistry.class.getMethods()) {
            String n = m.getName().toLowerCase(java.util.Locale.ROOT);
            if (!java.lang.reflect.Modifier.isStatic(m.getModifiers()) || m.getParameterCount() != 0
                    || !PayloadTypeRegistry.class.isAssignableFrom(m.getReturnType())) continue;
            if (!(n.contains("play") && (n.contains("s2c") || n.contains("clientbound")))) continue;
            try {
                PayloadTypeRegistry<?> reg = (PayloadTypeRegistry<?>) m.invoke(null);
                for (var r : reg.getClass().getMethods()) {
                    if (r.getName().equals("register") && r.getParameterCount() == 2) {
                        r.invoke(reg, Hello.TYPE, Hello.CODEC);
                        return;
                    }
                }
            } catch (ReflectiveOperationException e) {
                HelperMod.LOG.warn("Couldn't register the mini map hello payload", e);
            }
        }
        HelperMod.LOG.warn("No play payload registry found; everyone will be offered the follow-me map");
    }

    /** True when this player's own game has the mod's client part (so it draws the corner map itself). */
    static boolean hasClientMap(ServerPlayer player) {
        try {
            return ServerPlayNetworking.canSend(player, Hello.TYPE);
        } catch (RuntimeException e) {
            return false;
        }
    }

    static void onJoin(ServerPlayer player) {
        JOIN_CHECK.put(player.getUUID(), 100); // look again in 5 s, once the client has said what it can do
    }

    static void tick(MinecraftServer server) {
        if (!JOIN_CHECK.isEmpty()) {
            JOIN_CHECK.replaceAll((id, t) -> t - 1);
            JOIN_CHECK.entrySet().removeIf(e -> {
                if (e.getValue() > 0) return false;
                ServerPlayer p = server.getPlayerList().getPlayer(e.getKey());
                if (p != null && !hasClientMap(p) && !holdsMap(p)) tellAboutFallback(p);
                return true;
            });
        }
        if (server.getTickCount() % 20 != 0) return;
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            for (InteractionHand hand : InteractionHand.values()) {
                ItemStack held = p.getItemInHand(hand);
                CompoundTag tag = mapTag(held);
                if (tag == null) continue;
                int cx = tag.getIntOr("cx", 0), cz = tag.getIntOr("cz", 0);
                String dim = tag.getStringOr("dim", "");
                boolean otherWorld = !dim.equals(p.level().dimension().identifier().toString());
                if (otherWorld || Math.abs(p.getBlockX() - cx) > RECENTRE || Math.abs(p.getBlockZ() - cz) > RECENTRE) {
                    p.setItemInHand(hand, newMap(p)); // walked off the edge: a fresh map centred on them
                }
            }
        }
    }

    private static void tellAboutFallback(ServerPlayer p) {
        Component link = Component.literal("[Get a mini map]").withStyle(s -> s.withColor(ChatFormatting.GREEN).withUnderlined(true)
                .withClickEvent(new ClickEvent.RunCommand("/helper minimap"))
                .withHoverEvent(new HoverEvent.ShowText(Component.literal("A map in your off hand that follows you"))));
        p.sendSystemMessage(Component.literal("[Helper] ").withStyle(ChatFormatting.GOLD)
                .append(Component.literal("The corner mini map needs Helper Buddies 2.1.0 or newer on your own PC. Until then, ")
                        .withStyle(ChatFormatting.WHITE))
                .append(link));
    }

    private static CompoundTag mapTag(ItemStack s) {
        if (s.isEmpty() || !Compat.hasTag(s) || !Compat.tag(s).contains(MAP_TAG)) return null;
        return Compat.tag(s).getCompoundOrEmpty(MAP_TAG);
    }

    private static boolean holdsMap(ServerPlayer p) {
        for (int i = 0; i < p.getInventory().getContainerSize(); i++) if (mapTag(p.getInventory().getItem(i)) != null) return true;
        return false;
    }

    private static ItemStack newMap(ServerPlayer p) {
        ServerLevel level = (ServerLevel) p.level();
        ItemStack map = MapItem.create(level, p.getBlockX(), p.getBlockZ(), (byte) 1, true, true);
        map.set(DataComponents.CUSTOM_NAME, Component.literal("Helper Mini Map").withStyle(s -> s.withItalic(false))
                .withStyle(ChatFormatting.AQUA));
        CompoundTag t = new CompoundTag();
        t.putInt("cx", p.getBlockX());
        t.putInt("cz", p.getBlockZ());
        t.putString("dim", level.dimension().identifier().toString());
        Compat.editTag(map, c -> c.put(MAP_TAG, t));
        return map;
    }

    /** /helper minimap: give or take back the follow-me map. */
    static void toggle(ServerPlayer p) {
        for (int i = 0; i < p.getInventory().getContainerSize(); i++) {
            if (mapTag(p.getInventory().getItem(i)) != null) {
                p.getInventory().setItem(i, ItemStack.EMPTY);
                Helper.say(p, "Took the Helper Mini Map back. /helper minimap gives it to you again.");
                return;
            }
        }
        for (InteractionHand hand : InteractionHand.values()) {
            if (mapTag(p.getItemInHand(hand)) != null) {
                p.setItemInHand(hand, ItemStack.EMPTY);
                Helper.say(p, "Took the Helper Mini Map back. /helper minimap gives it to you again.");
                return;
            }
        }
        ItemStack map = newMap(p);
        if (p.getOffhandItem().isEmpty()) p.setItemInHand(InteractionHand.OFF_HAND, map);
        else p.getInventory().placeItemBackInInventory(map, net.minecraft.util.Prediction.SERVER_ONLY);
        Helper.say(p, hasClientMap(p)
                ? "Here's a Helper Mini Map too. Your corner mini map already works (/minimap to change it)."
                : "Here's a Helper Mini Map in your off hand. It fills in as you explore and re-centres on you as you walk. "
                + "Install Helper Buddies 2.1.0+ on your own PC to get the corner mini map instead.");
    }
}
