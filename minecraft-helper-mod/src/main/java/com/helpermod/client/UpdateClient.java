package com.helpermod.client;

import com.helpermod.Updater;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.text.ClickEvent;
import net.minecraft.text.HoverEvent;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

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
                dispatcher.register(ClientCommandManager.literal("helperupdate").executes(ctx -> {
                    if (Updater.available() == null) {
                        ctx.getSource().sendFeedback(Text.literal("Helper Buddies: " + Updater.status()).formatted(Formatting.AQUA));
                    } else {
                        openNextTick = true;
                    }
                    return 1;
                }).then(ClientCommandManager.literal("preview").executes(ctx -> {
                    previewNextTick = true; // see this version's update screen without a release
                    return 1;
                }))));
    }

    private static void tick(MinecraftClient client) {
        if (client.player == null || client.world == null) {
            inWorldTicks = 0;
            return;
        }
        inWorldTicks++;
        if (previewNextTick && client.currentScreen == null) {
            previewNextTick = false;
            client.setScreen(new UpdateScreen(null, true));
            return;
        }
        if (openNextTick && client.currentScreen == null) {
            openNextTick = false;
            client.setScreen(new UpdateScreen(null));
            return;
        }
        String v = Updater.available();
        if (v == null || v.equals(promptedFor) || v.equals(Updater.readyVersion()) || Updater.skipped(v)) return;
        // Wait ~5 seconds after joining, and only pop up when the player isn't in another menu.
        if (inWorldTicks < 100 || client.currentScreen != null) return;
        promptedFor = v;
        client.setScreen(new UpdateScreen(null));
    }

    /** Chat line after "Not now", so the prompt is easy to find again. */
    static void remindInChat(MinecraftClient client) {
        if (client.player == null || Updater.available() == null) return;
        Text link = Text.literal("[Show update]").styled(s -> s.withColor(Formatting.GREEN).withUnderline(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.RUN_COMMAND, "/helperupdate"))
                .withHoverEvent(new HoverEvent(HoverEvent.Action.SHOW_TEXT, Text.literal("See what's new and update"))));
        client.player.sendMessage(Text.literal("Helper Buddies " + Updater.available() + " is available. ")
                .formatted(Formatting.AQUA).append(link), false);
    }
}
