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
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> Disguise.prepare(handler.player));
        // Work out which blocks drop what while the world is loading, not mid-game on the first /helper collect.
        ServerLifecycleEvents.SERVER_STARTED.register(Materials::ensureIndex);
        ServerLifecycleEvents.SERVER_STOPPED.register(server -> {
            HelperManager.reset();
            Materials.reset();
            Disguise.reset();
            Devices.reset();
            Storage.reset();
        });
        Space.register();
        LOG.info("Helper Buddies loaded");
    }
}
