package com.helpermod;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import net.minecraft.command.CommandSource;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

import static net.minecraft.server.command.CommandManager.argument;
import static net.minecraft.server.command.CommandManager.literal;

/** /helper summon | collect <material> [amount] | stop | deliver | status | dismiss */
public final class HelperCommands {
    private HelperCommands() {}

    private static final int DEFAULT_AMOUNT = 64;
    private static final int MAX_AMOUNT = 64 * 36;

    public static void register(CommandDispatcher<ServerCommandSource> dispatcher) {
        dispatcher.register(literal("helper")
                .executes(HelperCommands::help)
                .then(literal("help").executes(HelperCommands::help))
                .then(literal("summon").executes(HelperCommands::summon))
                .then(literal("collect")
                        .then(argument("material", StringArgumentType.greedyString())
                                .suggests((ctx, builder) -> {
                                    if (builder.getRemaining().contains(" ")) return builder.buildFuture();
                                    return CommandSource.suggestMatching(Materials.SUGGESTIONS, builder);
                                })
                                .executes(HelperCommands::collect)))
                .then(literal("stop").executes(HelperCommands::stop))
                .then(literal("deliver").executes(HelperCommands::deliver))
                .then(literal("status").executes(HelperCommands::status))
                .then(literal("guard")
                        .then(literal("on").executes(ctx -> guard(ctx, true)))
                        .then(literal("off").executes(ctx -> guard(ctx, false))))
                .then(literal("dismiss").executes(HelperCommands::dismiss)));
    }

    private static int help(CommandContext<ServerCommandSource> ctx) {
        String[] lines = {
                "/helper summon  - get your helper",
                "/helper collect <material> [amount]  - e.g. /helper collect iron 32",
                "/helper deliver  - bring me what you have now",
                "/helper stop  - stop and follow me",
                "/helper status  - what are you doing?",
                "/helper guard on|off  - fight mobs that come after you (on by default)",
                "/helper dismiss  - send your helper away (it keeps your items)",
                "Right-click your helper to give it tools, weapons and armor, or take items.",
        };
        ctx.getSource().sendFeedback(() -> Text.literal("Helper commands:").formatted(Formatting.GOLD), false);
        for (String line : lines) ctx.getSource().sendFeedback(() -> Text.literal(line), false);
        return 1;
    }

    private static HelperData.Entry ensureSummoned(ServerPlayerEntity player) {
        HelperData data = HelperData.get(player.getServer());
        HelperData.Entry entry = data.getOrCreate(player.getUuid());
        Helper helper = HelperManager.helperFor(player.getUuid());
        if (!entry.active || helper.findEntity(player.getServer(), entry) == null) {
            helper.spawnNear(player, entry);
        }
        return entry;
    }

    private static int summon(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        HelperData.Entry entry = HelperData.get(player.getServer()).getOrCreate(player.getUuid());
        HelperManager.helperFor(player.getUuid()).spawnNear(player, entry);
        Helper.say(player, "Hi! Tell me what to get with /helper collect <material> [amount]. "
                + "Right-click me to give me tools.");
        return 1;
    }

    private static int collect(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        String raw = StringArgumentType.getString(ctx, "material").trim();
        int amount = DEFAULT_AMOUNT;
        int space = raw.lastIndexOf(' ');
        if (space > 0) {
            try {
                amount = Integer.parseInt(raw.substring(space + 1));
                raw = raw.substring(0, space).trim();
            } catch (NumberFormatException ignored) {
                // no amount given; the whole thing is the material name
            }
        }
        amount = Math.max(1, Math.min(MAX_AMOUNT, amount));
        Materials.Spec spec;
        try {
            spec = Materials.resolve(player.getServer(), raw);
        } catch (Materials.ResolveException e) {
            Helper.say(player, e.getMessage());
            return 0;
        }
        ensureSummoned(player);
        HelperManager.helperFor(player.getUuid()).startJob(player, spec, amount);
        return 1;
    }

    private static int stop(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        HelperManager.helperFor(player.getUuid()).stop(player);
        Helper.say(player, "Okay, stopping. I'll follow you.");
        return 1;
    }

    private static int deliver(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        ensureSummoned(player);
        HelperManager.helperFor(player.getUuid()).deliverNow();
        Helper.say(player, "Coming to you with what I've got.");
        return 1;
    }

    private static int status(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        HelperData.Entry entry = HelperData.get(player.getServer()).get(player.getUuid());
        if (entry == null || !entry.active) {
            Helper.say(player, "You don't have a helper out. Use /helper summon");
            return 0;
        }
        Helper.say(player, HelperManager.helperFor(player.getUuid()).status(entry.inventory));
        return 1;
    }

    private static int guard(CommandContext<ServerCommandSource> ctx, boolean on) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        HelperData data = HelperData.get(player.getServer());
        data.getOrCreate(player.getUuid()).guard = on;
        data.markDirty();
        Helper.say(player, on
                ? "I'll protect you! I fight monsters that come after you, and anything you attack."
                : "Okay, no fighting. I'll stay out of trouble.");
        return 1;
    }

    private static int dismiss(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        HelperData.Entry entry = HelperData.get(player.getServer()).get(player.getUuid());
        if (entry == null || !entry.active) {
            Helper.say(player, "You don't have a helper out.");
            return 0;
        }
        HelperManager.helperFor(player.getUuid()).dismiss(player.getServer(), entry);
        String held = Helper.summarize(entry.inventory, false);
        Helper.say(player, "Bye for now!" + (held.isEmpty() ? "" : " I'll hold on to " + held
                + " until you summon me again."));
        return 1;
    }
}
