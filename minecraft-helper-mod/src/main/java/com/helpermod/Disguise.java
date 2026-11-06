package com.helpermod;

import com.google.common.collect.Iterables;
import com.helpermod.mixin.DataTrackerAccessor;
import com.helpermod.mixin.PlayerEntityAccessor;
import com.mojang.authlib.GameProfile;
import com.mojang.authlib.properties.Property;
import com.mojang.authlib.properties.PropertyMap;
import io.netty.buffer.Unpooled;
import org.jetbrains.annotations.Nullable;
import net.minecraft.Util;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.game.ClientGamePacketListener;
import net.minecraft.network.protocol.game.ClientboundAddEntityPacket;
import net.minecraft.network.protocol.game.ClientboundAddPlayerPacket;
import net.minecraft.network.protocol.game.ClientboundPlayerInfoRemovePacket;
import net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.DefaultAttributes;
import net.minecraft.world.phys.Vec3;
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
        return !entity.level().isClientSide && entity.getTags().contains(Helper.TAG);
    }

    /** Every mob a helper can look like: living entities with attributes, except players and armor stands. */
    public static boolean canLookLike(EntityType<?> type) {
        return type != EntityType.PLAYER && type != EntityType.ARMOR_STAND
                && DefaultAttributes.hasSupplier(type);
    }

    /** Turns "creeper", "Iron Golem" or "somemod:thing" into a mob type, or null if there's no such mob. */
    @Nullable
    public static EntityType<?> resolveLook(String raw) {
        String name = raw.trim().toLowerCase(java.util.Locale.ROOT).replace(' ', '_');
        ResourceLocation id = ResourceLocation.tryParse(name);
        if (id == null || !BuiltInRegistries.ENTITY_TYPE.containsKey(id)) return null;
        EntityType<?> type = BuiltInRegistries.ENTITY_TYPE.get(id);
        return canLookLike(type) ? type : null;
    }

    public static List<String> lookSuggestions() {
        List<String> out = new ArrayList<>();
        for (EntityType<?> type : BuiltInRegistries.ENTITY_TYPE) {
            if (!canLookLike(type)) continue;
            ResourceLocation id = BuiltInRegistries.ENTITY_TYPE.getKey(type);
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
        ResourceLocation id = ResourceLocation.tryParse(entry.look);
        if (id == null || !BuiltInRegistries.ENTITY_TYPE.containsKey(id)) return null;
        EntityType<?> type = BuiltInRegistries.ENTITY_TYPE.get(id);
        return canLookLike(type) ? type : null;
    }

    /** True when the helper is shown as a player (its owner's skin), so it needs a player-list entry. */
    public static boolean looksLikePlayer(Entity entity) {
        return isHelper(entity) && lookOf(entity) == null;
    }

    /** Remember the owner's skin. Fetches it from Mojang if the server doesn't have it yet. */
    public static void prepare(ServerPlayer player) {
        UUID id = player.getUUID();
        Property textures = Iterables.getFirst(player.getGameProfile().getProperties().get("textures"), null);
        if (textures != null) {
            SKINS.put(id, textures);
            return;
        }
        if (SKINS.containsKey(id) || !FETCHING.add(id)) return;
        MinecraftServer server = player.getServer();
        GameProfile lookup = new GameProfile(id, player.getGameProfile().getName());
        CompletableFuture.supplyAsync(() -> server.getSessionService().fillProfileProperties(lookup, false),
                        Util.backgroundExecutor())
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
    public static ClientboundPlayerInfoUpdatePacket playerListAdd(Entity entity) {
        FriendlyByteBuf buf = new FriendlyByteBuf(Unpooled.buffer());
        buf.writeEnumSet(EnumSet.of(ClientboundPlayerInfoUpdatePacket.Action.ADD_PLAYER), ClientboundPlayerInfoUpdatePacket.Action.class);
        buf.writeVarInt(1);
        buf.writeUUID(entity.getUUID());
        buf.writeUtf(profileName(entity), 16);
        buf.writeGameProfileProperties(properties(entity));
        return new ClientboundPlayerInfoUpdatePacket(buf);
    }

    public static ClientboundPlayerInfoRemovePacket playerListRemove(Entity entity) {
        return new ClientboundPlayerInfoRemovePacket(List.of(entity.getUUID()));
    }

    public static Packet<ClientGamePacketListener> spawnPacket(Entity entity) {
        EntityType<?> look = lookOf(entity);
        if (look != null) {
            return new ClientboundAddEntityPacket(entity.getId(), entity.getUUID(), entity.getX(), entity.getY(),
                    entity.getZ(), entity.getXRot(), entity.getYRot(), look, 0, Vec3.ZERO, entity.getYHeadRot());
        }
        return playerSpawnPacket(entity);
    }

    private static ClientboundAddPlayerPacket playerSpawnPacket(Entity entity) {
        FriendlyByteBuf buf = new FriendlyByteBuf(Unpooled.buffer());
        buf.writeVarInt(entity.getId());
        buf.writeUUID(entity.getUUID());
        buf.writeDouble(entity.getX());
        buf.writeDouble(entity.getY());
        buf.writeDouble(entity.getZ());
        buf.writeByte((byte) Mth.floor(entity.getYRot() * 256f / 360f));
        buf.writeByte((byte) Mth.floor(entity.getXRot() * 256f / 360f));
        return new ClientboundAddPlayerPacket(buf);
    }

    /**
     * Only send entity data the disguise understands (the shared living-entity part), plus skin layers
     * when it is shown as a player.
     */
    public static List<SynchedEntityData.DataValue<?>> filterData(Entity entity,
                                                                   List<SynchedEntityData.DataValue<?>> list,
                                                                   boolean initial) {
        int lastLivingId = DataTrackerAccessor.helpermod$getTrackedEntities().getInt(LivingEntity.class);
        List<SynchedEntityData.DataValue<?>> out = new ArrayList<>();
        if (list != null) {
            for (SynchedEntityData.DataValue<?> entry : list) if (entry.id() <= lastLivingId) out.add(entry);
        }
        if (initial) {
            SynchedEntityData.DataValue<Boolean> baby = Size.babyEntry(entity, lookOf(entity));
            if (baby != null) out.add(baby);
        }
        if (initial && lookOf(entity) == null) {
            out.add(SynchedEntityData.DataValue.create(PlayerEntityAccessor.helpermod$getModelParts(), ALL_SKIN_LAYERS));
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    public static Collection<AttributeInstance> filterAttributes(Entity entity,
                                                                       Collection<AttributeInstance> in) {
        EntityType<?> look = lookOf(entity);
        AttributeSupplier known = DefaultAttributes.getSupplier(look == null ? EntityType.PLAYER
                : (EntityType<? extends LivingEntity>) look);
        List<AttributeInstance> out = new ArrayList<>();
        for (AttributeInstance instance : in) if (known.hasAttribute(instance.getAttribute())) out.add(instance);
        return out;
    }
}
