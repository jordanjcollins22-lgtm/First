package com.helpermod;

import net.minecraft.entity.Entity;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Items;
import net.minecraft.screen.GenericContainerScreenHandler;
import net.minecraft.screen.SimpleNamedScreenHandlerFactory;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.EntityHitResult;
import net.minecraft.world.World;
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
        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            HelperData.Entry entry = data.get(player.getUuid());
            if (entry == null || !entry.active) continue;
            try {
                helperFor(player.getUuid()).tick(server, player, entry);
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
    public static void onEntityLoad(Entity entity, ServerWorld world) {
        if (!(entity instanceof MobEntity mob) || !entity.getCommandTags().contains(Helper.TAG)) return;
        UUID owner = Helper.ownerOf(entity);
        HelperData.Entry entry = owner == null ? null : HelperData.get(world.getServer()).get(owner);
        if (entry == null || !entry.active || !entity.getUuid().equals(entry.entity)) {
            PENDING_DISCARD.add(entity);
            return;
        }
        Helper.applyBrain(mob);
    }

    /** Right-click your helper to open its inventory (give it tools, take out loot). */
    public static ActionResult onUseEntity(PlayerEntity player, World world, Hand hand, Entity entity,
                                           @Nullable EntityHitResult hit) {
        if (world.isClient || !entity.getCommandTags().contains(Helper.TAG)) return ActionResult.PASS;
        if (hand != Hand.MAIN_HAND) return ActionResult.SUCCESS;
        UUID owner = Helper.ownerOf(entity);
        if (!player.getUuid().equals(owner)) {
            player.sendMessage(Text.literal("That's " + entity.getName().getString().replace("'s Helper", "")
                    + "'s helper. Get your own with /helper summon"), true);
            return ActionResult.SUCCESS;
        }
        HelperData.Entry entry = HelperData.get(world.getServer()).getOrCreate(owner);
        if (player.getMainHandStack().isOf(Items.SADDLE) && player instanceof ServerPlayerEntity sp) {
            if (helperFor(owner).ride(sp, entry)) {
                player.sendMessage(Text.literal("Hop on! Steer with your movement keys, sprint to go faster, sneak to get off."), true);
            }
            return ActionResult.SUCCESS;
        }
        player.openHandledScreen(new SimpleNamedScreenHandlerFactory(
                (syncId, playerInventory, p) ->
                        GenericContainerScreenHandler.createGeneric9x6(syncId, playerInventory, entry.inventory),
                Text.literal("Your Helper: level " + entry.level + ", " + entry.inventory.unlocked + " pockets")));
        return ActionResult.SUCCESS;
    }
}
