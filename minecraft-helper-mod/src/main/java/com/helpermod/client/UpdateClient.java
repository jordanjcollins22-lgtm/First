package com.helpermod.client;

import com.helpermod.Updater;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommands;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;

/**
 * Runs on each player's own PC (singleplayer, the LAN host, and any LAN guest who also has the mod),
 * so each copy of the mod gets its own update prompt.
 *
 * A few seconds after you're in a world and not in a menu, UpdateScreen pops up once per new version.
 * "Not now" hides it until the next launch; /helperupdate (or the chat link) brings it back.
 */
public final class UpdateClient implements ClientModInitializer {
    private static String promptedFor;   // version we already popped up for this session
    private static int inWorldTicks;
    private static boolean openNextTick; // /helperupdate: chat closes after the command, so open a tick later
    private static boolean previewNextTick;

    @Override
    public void onInitializeClient() {
        ClientTickEvents.END_CLIENT_TICK.register(UpdateClient::tick);
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> inWorldTicks = 0);
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, access) ->
                dispatcher.register(ClientCommands.literal("helperupdate").executes(ctx -> {
                    if (Updater.available() == null) {
                        ctx.getSource().sendFeedback(Component.literal("Helper Buddies: " + Updater.status()).withStyle(ChatFormatting.AQUA));
                    } else {
                        openNextTick = true;
                    }
                    return 1;
                }).then(ClientCommands.literal("preview").executes(ctx -> {
                    previewNextTick = true; // see this version's update screen without a release
                    return 1;
                }))));
    }

    private static void tick(Minecraft client) {
        if (client.player == null || client.level == null) {
            inWorldTicks = 0;
            return;
        }
        inWorldTicks++;
        if (previewNextTick && ClientCompat.screen(client) == null) {
            previewNextTick = false;
            ClientCompat.show(client, new UpdateScreen(null, true));
            return;
        }
        if (openNextTick && ClientCompat.screen(client) == null) {
            openNextTick = false;
            ClientCompat.show(client, new UpdateScreen(null));
            return;
        }
        String v = Updater.available();
        if (v == null || v.equals(promptedFor) || v.equals(Updater.readyVersion()) || Updater.skipped(v)) return;
        // Wait ~5 seconds after joining, and only pop up when the player isn't in another menu.
        if (inWorldTicks < 100 || ClientCompat.screen(client) != null) return;
        promptedFor = v;
        ClientCompat.show(client, new UpdateScreen(null));
    }

    /** Chat line after "Not now", so the prompt is easy to find again. */
    static void remindInChat(Minecraft client) {
        if (client.player == null || Updater.available() == null) return;
        Component link = Component.literal("[Show update]").withStyle(s -> s.withColor(ChatFormatting.GREEN).withUnderlined(true)
                .withClickEvent(new ClickEvent.RunCommand("/helperupdate"))
                .withHoverEvent(new HoverEvent.ShowText(Component.literal("See what's new and update"))));
        client.player.sendSystemMessage(Component.literal("Helper Buddies " + Updater.available() + " is available. ")
                .withStyle(ChatFormatting.AQUA).append(link));
    }
}
