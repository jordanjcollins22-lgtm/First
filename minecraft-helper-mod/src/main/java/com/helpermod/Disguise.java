package com.helpermod;

import com.google.common.collect.Iterables;
import com.helpermod.mixin.DataTrackerAccessor;
import com.helpermod.mixin.PlayerEntityAccessor;
import com.mojang.authlib.GameProfile;
import com.mojang.authlib.properties.Property;
import com.mojang.authlib.properties.PropertyMap;
import io.netty.buffer.Unpooled;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.DefaultAttributeRegistry;
import net.minecraft.entity.attribute.EntityAttributeInstance;
import net.minecraft.entity.data.DataTracker;
import net.minecraft.network.PacketByteBuf;
import net.minecraft.network.packet.s2c.play.PlayerListS2CPacket;
import net.minecraft.network.packet.s2c.play.PlayerRemoveS2CPacket;
import net.minecraft.network.packet.s2c.play.PlayerSpawnS2CPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.util.Util;
import net.minecraft.util.math.MathHelper;

import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Shows helpers to every client as a player wearing its owner's skin. Server-side only: the
 * helper is still a normal mob on the server, it is just described to clients as a player.
 */
public final class Disguise {
    private Disguise() {}

    private static final Map<UUID, Property> SKINS = new ConcurrentHashMap<>();
    private static final Set<UUID> FETCHING = ConcurrentHashMap.newKeySet();
    private static final byte ALL_SKIN_LAYERS = 0x7F;

    public static boolean isHelper(Entity entity) {
        return !entity.getWorld().isClient && entity.getCommandTags().contains(Helper.TAG);
    }

    /** Remember the owner's skin. Fetches it from Mojang if the server doesn't have it yet. */
    public static void prepare(ServerPlayerEntity player) {
        UUID id = player.getUuid();
        Property textures = Iterables.getFirst(player.getGameProfile().getProperties().get("textures"), null);
        if (textures != null) {
            SKINS.put(id, textures);
            return;
        }
        if (SKINS.containsKey(id) || !FETCHING.add(id)) return;
        MinecraftServer server = player.getServer();
        GameProfile lookup = new GameProfile(id, player.getGameProfile().getName());
        CompletableFuture.supplyAsync(() -> server.getSessionService().fillProfileProperties(lookup, false),
                        Util.getMainWorkerExecutor())
                .whenComplete((filled, error) -> server.execute(() -> {
                    FETCHING.remove(id);
                    Property t = filled == null ? null
                            : Iterables.getFirst(filled.getProperties().get("textures"), null);
                    if (t != null) {
                        SKINS.put(id, t);
                        HelperManager.refreshDisguise(server, id); // re-show with the real skin
                    }
                }));
    }

    public static void reset() {
        SKINS.clear();
        FETCHING.clear();
    }

    private static String profileName(Entity entity) {
        String owner = Helper.ownerNameOf(entity);
        String name = owner + "'s Helper";
        if (name.length() > 16) name = owner + " Jr";
        if (name.length() > 16) name = owner.substring(0, 16);
        return name;
    }

    private static PropertyMap properties(Entity entity) {
        PropertyMap map = new PropertyMap();
        UUID owner = Helper.ownerOf(entity);
        Property skin = owner == null ? null : SKINS.get(owner);
        if (skin != null) map.put("textures", skin);
        return map;
    }

    /** Adds a hidden (not in the tab list) player entry so the client knows the name and skin. */
    public static PlayerListS2CPacket playerListAdd(Entity entity) {
        PacketByteBuf buf = new PacketByteBuf(Unpooled.buffer());
        buf.writeEnumSet(EnumSet.of(PlayerListS2CPacket.Action.ADD_PLAYER), PlayerListS2CPacket.Action.class);
        buf.writeVarInt(1);
        buf.writeUuid(entity.getUuid());
        buf.writeString(profileName(entity), 16);
        buf.writePropertyMap(properties(entity));
        return new PlayerListS2CPacket(buf);
    }

    public static PlayerRemoveS2CPacket playerListRemove(Entity entity) {
        return new PlayerRemoveS2CPacket(List.of(entity.getUuid()));
    }

    public static PlayerSpawnS2CPacket spawnPacket(Entity entity) {
        PacketByteBuf buf = new PacketByteBuf(Unpooled.buffer());
        buf.writeVarInt(entity.getId());
        buf.writeUuid(entity.getUuid());
        buf.writeDouble(entity.getX());
        buf.writeDouble(entity.getY());
        buf.writeDouble(entity.getZ());
        buf.writeByte((byte) MathHelper.floor(entity.getYaw() * 256f / 360f));
        buf.writeByte((byte) MathHelper.floor(entity.getPitch() * 256f / 360f));
        return new PlayerSpawnS2CPacket(buf);
    }

    /** Only send entity data a player understands (the shared living-entity part), plus skin layers. */
    public static List<DataTracker.SerializedEntry<?>> filterData(List<DataTracker.SerializedEntry<?>> list,
                                                                   boolean initial) {
        int lastLivingId = DataTrackerAccessor.helpermod$getTrackedEntities().getInt(LivingEntity.class);
        List<DataTracker.SerializedEntry<?>> out = new ArrayList<>();
        if (list != null) {
            for (DataTracker.SerializedEntry<?> entry : list) if (entry.id() <= lastLivingId) out.add(entry);
        }
        if (initial) {
            out.add(DataTracker.SerializedEntry.of(PlayerEntityAccessor.helpermod$getModelParts(), ALL_SKIN_LAYERS));
        }
        return out;
    }

    public static Collection<EntityAttributeInstance> filterAttributes(Collection<EntityAttributeInstance> in) {
        DefaultAttributeContainer player = DefaultAttributeRegistry.get(EntityType.PLAYER);
        List<EntityAttributeInstance> out = new ArrayList<>();
        for (EntityAttributeInstance instance : in) if (player.has(instance.getAttribute())) out.add(instance);
        return out;
    }
}
