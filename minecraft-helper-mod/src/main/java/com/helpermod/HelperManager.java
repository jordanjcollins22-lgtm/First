package com.helpermod;

import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.EntityHitResult;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Keeps track of every player's helper and routes events to it. */
public final class HelperManager {
    private HelperManager() {}

    private static final Map<UUID, Helper> HELPERS = new HashMap<>();
    private static final List<Entity> PENDING_DISCARD = new ArrayList<>();

    public static void reset() {
        HELPERS.clear();
        PENDING_DISCARD.clear();
    }

    /** Server stopping: any delivery still on its way goes into the sender's Helper Storage. */
    public static void saveParcels(MinecraftServer server) {
        for (Helper h : HELPERS.values()) h.saveParcel(server);
    }

    public static Helper helperFor(UUID owner) {
        return HELPERS.computeIfAbsent(owner, Helper::new);
    }

    public static void tick(MinecraftServer server) {
        for (Entity e : PENDING_DISCARD) if (!e.isRemoved()) e.discard();
        PENDING_DISCARD.clear();

        HelperData data = HelperData.get(server);
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            HelperData.Entry entry = data.get(player.getUUID());
            if (entry == null || !entry.active) continue;
            try {
                helperFor(player.getUUID()).tick(server, player, entry);
            } catch (Exception ex) {
                HelperMod.LOG.error("Helper for {} hit an error", player.getGameProfile().getName(), ex);
            }
        }
    }

    /** The owner's skin just arrived: re-show their helper so everyone sees it. */
    public static void refreshDisguise(MinecraftServer server, UUID owner) {
        HelperData.Entry entry = HelperData.get(server).get(owner);
        if (entry == null || !entry.active) return;
        helperFor(owner).respawnInPlace(server, entry);
    }

    /** Re-apply the helper brain when a helper loads, and clean up stale duplicates. */
    public static void onEntityLoad(Entity entity, ServerLevel world) {
        if (!(entity instanceof Mob mob) || !entity.getTags().contains(Helper.TAG)) return;
        UUID owner = Helper.ownerOf(entity);
        HelperData.Entry entry = owner == null ? null : HelperData.get(world.getServer()).get(owner);
        if (entry == null || !entry.active || !entity.getUUID().equals(entry.entity)) {
            PENDING_DISCARD.add(entity);
            return;
        }
        Helper.applyBrain(mob);
    }

    /** Right-click your helper to open its inventory (give it tools, take out loot). */
    public static InteractionResult onUseEntity(Player player, Level world, InteractionHand hand, Entity entity,
                                           @Nullable EntityHitResult hit) {
        if (world.isClientSide || !entity.getTags().contains(Helper.TAG)) return InteractionResult.PASS;
        if (hand != InteractionHand.MAIN_HAND) return InteractionResult.SUCCESS;
        UUID owner = Helper.ownerOf(entity);
        if (!player.getUUID().equals(owner)) {
            player.displayClientMessage(Component.literal("That's " + entity.getName().getString().replace("'s Helper", "")
                    + "'s helper. Get your own with /helper summon"), true);
            return InteractionResult.SUCCESS;
        }
        HelperData.Entry entry = HelperData.get(world.getServer()).getOrCreate(owner);
        if (player.getMainHandItem().is(Items.SADDLE) && player instanceof ServerPlayer sp) {
            if (helperFor(owner).ride(sp, entry)) {
                player.displayClientMessage(Component.literal("Hop on! Steer with your movement keys, sprint to go faster, sneak to get off."), true);
            }
            return InteractionResult.SUCCESS;
        }
        player.openMenu(new SimpleMenuProvider(
                (syncId, playerInventory, p) ->
                        ChestMenu.sixRows(syncId, playerInventory, entry.inventory),
                Component.literal("Your Helper: level " + entry.level + ", " + entry.inventory.unlocked + " pockets")));
        return InteractionResult.SUCCESS;
    }
}
