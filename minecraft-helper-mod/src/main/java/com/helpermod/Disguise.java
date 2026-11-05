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
import net.minecraft.network.packet.s2c.play.EntitySpawnS2CPacket;
import net.minecraft.network.packet.s2c.play.PlayerSpawnS2CPacket;
import net.minecraft.network.listener.ClientPlayPacketListener;
import net.minecraft.network.packet.Packet;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.Vec3d;
import org.jetbrains.annotations.Nullable;
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
 * Shows helpers to every client as a player wearing its owner's skin, or as any mob the owner
 * picked with /helper look <mob>. Server-side only: the
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

    /** Every mob a helper can look like: living entities with attributes, except players and armor stands. */
    public static boolean canLookLike(EntityType<?> type) {
        return type != EntityType.PLAYER && type != EntityType.ARMOR_STAND
                && DefaultAttributeRegistry.hasDefinitionFor(type);
    }

    /** Turns "creeper", "Iron Golem" or "somemod:thing" into a mob type, or null if there's no such mob. */
    @Nullable
    public static EntityType<?> resolveLook(String raw) {
        String name = raw.trim().toLowerCase(java.util.Locale.ROOT).replace(' ', '_');
        Identifier id = Identifier.tryParse(name);
        if (id == null || !Registries.ENTITY_TYPE.containsId(id)) return null;
        EntityType<?> type = Registries.ENTITY_TYPE.get(id);
        return canLookLike(type) ? type : null;
    }

    public static List<String> lookSuggestions() {
        List<String> out = new ArrayList<>();
        for (EntityType<?> type : Registries.ENTITY_TYPE) {
            if (!canLookLike(type)) continue;
            Identifier id = Registries.ENTITY_TYPE.getId(type);
            out.add(id.getNamespace().equals("minecraft") ? id.getPath() : id.toString());
        }
        out.sort(null);
        return out;
    }

    /** The mob this helper should look like, or null to look like its owner. */
    @Nullable
    public static EntityType<?> lookOf(Entity entity) {
        UUID owner = Helper.ownerOf(entity);
        MinecraftServer server = entity.getServer();
        if (owner == null || server == null) return null;
        HelperData.Entry entry = HelperData.get(server).get(owner);
        if (entry == null || entry.look == null) return null;
        Identifier id = Identifier.tryParse(entry.look);
        if (id == null || !Registries.ENTITY_TYPE.containsId(id)) return null;
        EntityType<?> type = Registries.ENTITY_TYPE.get(id);
        return canLookLike(type) ? type : null;
    }

    /** True when the helper is shown as a player (its owner's skin), so it needs a player-list entry. */
    public static boolean looksLikePlayer(Entity entity) {
        return isHelper(entity) && lookOf(entity) == null;
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

    public static Packet<ClientPlayPacketListener> spawnPacket(Entity entity) {
        EntityType<?> look = lookOf(entity);
        if (look != null) {
            return new EntitySpawnS2CPacket(entity.getId(), entity.getUuid(), entity.getX(), entity.getY(),
                    entity.getZ(), entity.getPitch(), entity.getYaw(), look, 0, Vec3d.ZERO, entity.getHeadYaw());
        }
        return playerSpawnPacket(entity);
    }

    private static PlayerSpawnS2CPacket playerSpawnPacket(Entity entity) {
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

    /**
     * Only send entity data the disguise understands (the shared living-entity part), plus skin layers
     * when it is shown as a player.
     */
    public static List<DataTracker.SerializedEntry<?>> filterData(Entity entity,
                                                                   List<DataTracker.SerializedEntry<?>> list,
                                                                   boolean initial) {
        int lastLivingId = DataTrackerAccessor.helpermod$getTrackedEntities().getInt(LivingEntity.class);
        List<DataTracker.SerializedEntry<?>> out = new ArrayList<>();
        if (list != null) {
            for (DataTracker.SerializedEntry<?> entry : list) if (entry.id() <= lastLivingId) out.add(entry);
        }
        if (initial) {
            DataTracker.SerializedEntry<Boolean> baby = Size.babyEntry(entity, lookOf(entity));
            if (baby != null) out.add(baby);
        }
        if (initial && lookOf(entity) == null) {
            out.add(DataTracker.SerializedEntry.of(PlayerEntityAccessor.helpermod$getModelParts(), ALL_SKIN_LAYERS));
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    public static Collection<EntityAttributeInstance> filterAttributes(Entity entity,
                                                                       Collection<EntityAttributeInstance> in) {
        EntityType<?> look = lookOf(entity);
        DefaultAttributeContainer known = DefaultAttributeRegistry.get(look == null ? EntityType.PLAYER
                : (EntityType<? extends LivingEntity>) look);
        List<EntityAttributeInstance> out = new ArrayList<>();
        for (EntityAttributeInstance instance : in) if (known.has(instance.getAttribute())) out.add(instance);
        return out;
    }
}
