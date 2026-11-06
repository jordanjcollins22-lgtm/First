package com.helpermod;

import net.minecraft.ChatFormatting;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtUtils;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundSetDisplayObjectivePacket;
import net.minecraft.network.protocol.game.ClientboundSetObjectivePacket;
import net.minecraft.network.protocol.game.ClientboundSetScorePacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.ServerScoreboard;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import net.minecraft.world.scores.Objective;
import net.minecraft.world.scores.Scoreboard;
import net.minecraft.world.scores.criteria.ObjectiveCriteria;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The tycoon money panel on the right side of the screen: your total coins and how many you're making per
 * second. Each player only sees their own numbers (the panel is sent to each player on its own, it isn't a
 * shared scoreboard). /helper tycoon sidebar off hides it.
 */
final class TycoonSidebar {
    private TycoonSidebar() {}

    private static final String OBJECTIVE = "helper_tycoon";
    private static final int WINDOW = 10; // seconds averaged for "per second"
    private static final int SIDEBAR_SLOT = 1;

    static final class Data extends SavedData {
        private static final String ID = "helpermod_tycoon_sidebar";
        private static final SavedDataType<Data> TYPE = Compat.dataType(ID, Data::new, Data::fromNbt, d -> d.save(new CompoundTag()));
        final Set<UUID> hidden = new HashSet<>();

        static Data get(MinecraftServer server) {
            return server.overworld().getDataStorage().computeIfAbsent(TYPE);
        }

        private static Data fromNbt(CompoundTag nbt) {
            Data d = new Data();
            ListTag l = nbt.getListOrEmpty("hidden");
            for (int i = 0; i < l.size(); i++) d.hidden.add(Compat.uuidOf(l.get(i)));
            return d;
        }

                public CompoundTag save(CompoundTag nbt) {
            ListTag l = new ListTag();
            for (UUID id : hidden) l.add(Compat.uuidTag(id));
            nbt.put("hidden", l);
            return nbt;
        }
    }

    /** What a player's panel shows right now, so old lines can be taken away. */
    private static final class Shown {
        String total;
        String rate;
    }

    private static final Map<UUID, long[]> EARNED = new HashMap<>(); // coins per second, last WINDOW seconds
    private static final Map<UUID, Shown> SHOWN = new HashMap<>();
    private static final Objective DISPLAY = new Objective(new Scoreboard(), OBJECTIVE,
            ObjectiveCriteria.DUMMY, Component.literal("Tycoon").withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD),
            ObjectiveCriteria.RenderType.INTEGER);

    static void reset() {
        EARNED.clear();
        SHOWN.clear();
    }

    /** A player (re)joined: their game has no panel yet. */
    static void onJoin(ServerPlayer player) {
        SHOWN.remove(player.getUUID());
    }

    /** Called by the collector each time it pays out. */
    static void earned(MinecraftServer server, UUID owner, long coins) {
        long[] buckets = EARNED.computeIfAbsent(owner, k -> new long[WINDOW]);
        int slot = (int) ((server.getTickCount() / 20) % WINDOW);
        buckets[slot] += coins;
    }

    private static long perSecond(MinecraftServer server, UUID id) {
        long[] buckets = EARNED.get(id);
        if (buckets == null) return 0;
        long sum = 0;
        for (long b : buckets) sum += b;
        return Math.round(sum / (double) WINDOW);
    }

    static void tick(MinecraftServer server) {
        if (server.getTickCount() % 20 != 0) return;
        int next = (int) ((server.getTickCount() / 20 + 1) % WINDOW);
        for (long[] buckets : EARNED.values()) buckets[next] = 0; // the oldest second drops off
        Tycoon.Data data = Tycoon.Data.get(server);
        Data prefs = Data.get(server);
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            UUID id = player.getUUID();
            boolean playing = data.coins(id) > 0 || data.droppers.values().stream().anyMatch(d -> d.owner.equals(id));
            if (!playing || prefs.hidden.contains(id)) {
                hide(player);
                continue;
            }
            show(player, "Total: " + String.format("%,d", data.coins(id)) + " coins",
                    "Per second: " + String.format("%,d", perSecond(server, id)));
        }
    }

    private static void show(ServerPlayer player, String total, String rate) {
        Shown s = SHOWN.get(player.getUUID());
        var net = player.connection;
        if (s == null) {
            s = new Shown();
            SHOWN.put(player.getUUID(), s);
            net.send(new ClientboundSetObjectivePacket(DISPLAY, ClientboundSetObjectivePacket.METHOD_ADD));
            net.send(new ClientboundSetDisplayObjectivePacket(SIDEBAR_SLOT, DISPLAY));
        }
        String totalLine = ChatFormatting.GOLD + total;
        String rateLine = ChatFormatting.YELLOW + rate;
        if (!totalLine.equals(s.total)) {
            if (s.total != null) net.send(new ClientboundSetScorePacket(ServerScoreboard.Method.REMOVE, OBJECTIVE, s.total, 0));
            net.send(new ClientboundSetScorePacket(ServerScoreboard.Method.CHANGE, OBJECTIVE, totalLine, 2));
            s.total = totalLine;
        }
        if (!rateLine.equals(s.rate)) {
            if (s.rate != null) net.send(new ClientboundSetScorePacket(ServerScoreboard.Method.REMOVE, OBJECTIVE, s.rate, 0));
            net.send(new ClientboundSetScorePacket(ServerScoreboard.Method.CHANGE, OBJECTIVE, rateLine, 1));
            s.rate = rateLine;
        }
    }

    private static void hide(ServerPlayer player) {
        if (SHOWN.remove(player.getUUID()) == null) return;
        player.connection.send(new ClientboundSetObjectivePacket(DISPLAY, ClientboundSetObjectivePacket.METHOD_REMOVE));
    }

    /** /helper tycoon sidebar on|off */
    static void set(ServerPlayer player, boolean on) {
        Data prefs = Data.get(player.level().getServer());
        if (on) prefs.hidden.remove(player.getUUID());
        else prefs.hidden.add(player.getUUID());
        prefs.setDirty();
        if (!on) hide(player);
        Helper.say(player, on ? "Your coin total and coins per second are back on the side of the screen."
                : "Hid the coin panel. /helper tycoon sidebar on brings it back.");
    }
}
