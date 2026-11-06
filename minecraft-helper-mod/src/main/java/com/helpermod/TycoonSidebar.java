package com.helpermod;

import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtHelper;
import net.minecraft.nbt.NbtList;
import net.minecraft.network.packet.s2c.play.ScoreboardDisplayS2CPacket;
import net.minecraft.network.packet.s2c.play.ScoreboardObjectiveUpdateS2CPacket;
import net.minecraft.network.packet.s2c.play.ScoreboardPlayerUpdateS2CPacket;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.scoreboard.ScoreboardCriterion;
import net.minecraft.scoreboard.ScoreboardObjective;
import net.minecraft.scoreboard.ServerScoreboard;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.world.PersistentState;

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

    static final class Data extends PersistentState {
        private static final String ID = "helpermod_tycoon_sidebar";
        final Set<UUID> hidden = new HashSet<>();

        static Data get(MinecraftServer server) {
            return server.getOverworld().getPersistentStateManager().getOrCreate(Data::fromNbt, Data::new, ID);
        }

        private static Data fromNbt(NbtCompound nbt) {
            Data d = new Data();
            NbtList l = nbt.getList("hidden", NbtElement.INT_ARRAY_TYPE);
            for (int i = 0; i < l.size(); i++) d.hidden.add(NbtHelper.toUuid(l.get(i)));
            return d;
        }

        @Override
        public NbtCompound writeNbt(NbtCompound nbt) {
            NbtList l = new NbtList();
            for (UUID id : hidden) l.add(NbtHelper.fromUuid(id));
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
    private static final ScoreboardObjective DISPLAY = new ScoreboardObjective(new Scoreboard(), OBJECTIVE,
            ScoreboardCriterion.DUMMY, Text.literal("Tycoon").formatted(Formatting.GOLD, Formatting.BOLD),
            ScoreboardCriterion.RenderType.INTEGER);

    static void reset() {
        EARNED.clear();
        SHOWN.clear();
    }

    /** A player (re)joined: their game has no panel yet. */
    static void onJoin(ServerPlayerEntity player) {
        SHOWN.remove(player.getUuid());
    }

    /** Called by the collector each time it pays out. */
    static void earned(MinecraftServer server, UUID owner, long coins) {
        long[] buckets = EARNED.computeIfAbsent(owner, k -> new long[WINDOW]);
        int slot = (int) ((server.getTicks() / 20) % WINDOW);
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
        if (server.getTicks() % 20 != 0) return;
        int next = (int) ((server.getTicks() / 20 + 1) % WINDOW);
        for (long[] buckets : EARNED.values()) buckets[next] = 0; // the oldest second drops off
        Tycoon.Data data = Tycoon.Data.get(server);
        Data prefs = Data.get(server);
        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            UUID id = player.getUuid();
            boolean playing = data.coins(id) > 0 || data.droppers.values().stream().anyMatch(d -> d.owner.equals(id));
            if (!playing || prefs.hidden.contains(id)) {
                hide(player);
                continue;
            }
            show(player, "Total: " + String.format("%,d", data.coins(id)) + " coins",
                    "Per second: " + String.format("%,d", perSecond(server, id)));
        }
    }

    private static void show(ServerPlayerEntity player, String total, String rate) {
        Shown s = SHOWN.get(player.getUuid());
        var net = player.networkHandler;
        if (s == null) {
            s = new Shown();
            SHOWN.put(player.getUuid(), s);
            net.sendPacket(new ScoreboardObjectiveUpdateS2CPacket(DISPLAY, ScoreboardObjectiveUpdateS2CPacket.ADD_MODE));
            net.sendPacket(new ScoreboardDisplayS2CPacket(SIDEBAR_SLOT, DISPLAY));
        }
        String totalLine = Formatting.GOLD + total;
        String rateLine = Formatting.YELLOW + rate;
        if (!totalLine.equals(s.total)) {
            if (s.total != null) net.sendPacket(new ScoreboardPlayerUpdateS2CPacket(ServerScoreboard.UpdateMode.REMOVE, OBJECTIVE, s.total, 0));
            net.sendPacket(new ScoreboardPlayerUpdateS2CPacket(ServerScoreboard.UpdateMode.CHANGE, OBJECTIVE, totalLine, 2));
            s.total = totalLine;
        }
        if (!rateLine.equals(s.rate)) {
            if (s.rate != null) net.sendPacket(new ScoreboardPlayerUpdateS2CPacket(ServerScoreboard.UpdateMode.REMOVE, OBJECTIVE, s.rate, 0));
            net.sendPacket(new ScoreboardPlayerUpdateS2CPacket(ServerScoreboard.UpdateMode.CHANGE, OBJECTIVE, rateLine, 1));
            s.rate = rateLine;
        }
    }

    private static void hide(ServerPlayerEntity player) {
        if (SHOWN.remove(player.getUuid()) == null) return;
        player.networkHandler.sendPacket(new ScoreboardObjectiveUpdateS2CPacket(DISPLAY, ScoreboardObjectiveUpdateS2CPacket.REMOVE_MODE));
    }

    /** /helper tycoon sidebar on|off */
    static void set(ServerPlayerEntity player, boolean on) {
        Data prefs = Data.get(player.getServer());
        if (on) prefs.hidden.remove(player.getUuid());
        else prefs.hidden.add(player.getUuid());
        prefs.markDirty();
        if (!on) hide(player);
        Helper.say(player, on ? "Your coin total and coins per second are back on the side of the screen."
                : "Hid the coin panel. /helper tycoon sidebar on brings it back.");
    }
}
