package com.helpermod;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.event.player.UseEntityCallback;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Helper Buddies: every player can summon a personal helper that gathers materials.
 *
 * The mod is server-side only. The helper is a vanilla mob driven by this mod, so players
 * joining a server or LAN world do not need to install anything.
 */
public class HelperMod implements ModInitializer {
    public static final String MOD_ID = "helpermod";
    public static final Logger LOG = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) ->
                HelperCommands.register(dispatcher));
        ServerTickEvents.END_SERVER_TICK.register(HelperManager::tick);
        ServerEntityEvents.ENTITY_LOAD.register(HelperManager::onEntityLoad);
        UseEntityCallback.EVENT.register(HelperManager::onUseEntity);
        net.fabricmc.fabric.api.event.player.UseBlockCallback.EVENT.register(Devices::onUseBlock);
        ServerTickEvents.END_SERVER_TICK.register(Devices::tick);
        ServerTickEvents.END_SERVER_TICK.register(Planets::tick); // themed monsters on every planet
        ServerTickEvents.END_SERVER_TICK.register(Bosses::tick); // a boss arena on every planet
        ServerEntityEvents.ENTITY_LOAD.register(Bosses::onEntityLoad);
        ServerTickEvents.END_SERVER_TICK.register(Town::tick);
        ServerTickEvents.END_SERVER_TICK.register(Tycoon::tick); // dropper tycoon
        ServerTickEvents.END_SERVER_TICK.register(Mind::tick);
        ServerTickEvents.END_SERVER_TICK.register(MineMarker::tick); // "dig your mine here"
        net.fabricmc.fabric.api.event.player.UseBlockCallback.EVENT.register(MineMarker::onUseBlock); // the helper notices things and acts on its own
        net.fabricmc.fabric.api.message.v1.ServerMessageEvents.CHAT_MESSAGE.register(Mind::onChat); // "helper, get 20 iron"
        ServerEntityEvents.ENTITY_LOAD.register(Tycoon::onEntityLoad);
        net.fabricmc.fabric.api.event.lifecycle.v1.ServerBlockEntityEvents.BLOCK_ENTITY_LOAD.register(Tycoon::onBlockEntityLoad);
        net.fabricmc.fabric.api.event.player.UseBlockCallback.EVENT.register(Tycoon::onUseBlock); // Reef Town on the Bikini Bottom planet
        ServerTickEvents.END_SERVER_TICK.register(Golf::tick); // Fairway golf planet
        ServerTickEvents.END_SERVER_TICK.register(BlackHole::tick); // ore piles -> Singularity -> the Black Hole
        ServerTickEvents.END_SERVER_TICK.register(TycoonSidebar::tick); // coin total + per second on the side
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> TycoonSidebar.onJoin(handler.player));
        net.fabricmc.fabric.api.event.player.UseItemCallback.EVENT.register(BlackHole::onUseItem);
        net.fabricmc.fabric.api.event.player.UseBlockCallback.EVENT.register(BlackHole::onUseBlock); // Rift Caches
        net.fabricmc.fabric.api.event.player.UseItemCallback.EVENT.register(Golf::onUseItem);
        net.fabricmc.fabric.api.event.player.UseBlockCallback.EVENT.register(Golf::onUseBlock);
        UseEntityCallback.EVENT.register(Golf::onUseEntity);
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> Disguise.prepare(handler.player));
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> Updater.onJoin(handler.player));
        // Work out which blocks drop what while the world is loading, not mid-game on the first /helper collect.
        ServerLifecycleEvents.SERVER_STARTED.register(Materials::ensureIndex);
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> {
            HelperManager.reset();
            Materials.reset();
            Disguise.reset();
            Devices.reset();
            Storage.reset();
            Bosses.reset();
            Town.reset();
            Tycoon.reset();
            Mind.reset();
            MineMarker.reset();
            Golf.reset();
            BlackHole.reset();
            TycoonSidebar.reset();
        });
        Space.register();
        Updater.start(); // checks GitHub for a newer version in the background
        LOG.info("Helper Buddies loaded");
    }
}
