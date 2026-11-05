package com.helpermod;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import net.minecraft.command.CommandSource;
import net.minecraft.entity.EntityType;
import net.minecraft.registry.Registries;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

import java.util.ArrayList;
import java.util.List;

import static net.minecraft.server.command.CommandManager.argument;
import static net.minecraft.server.command.CommandManager.literal;

/** /helper summon | collect <material> [amount] | stop | deliver | status | look <mob|me> | dismiss */
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
                .then(literal("harvester").executes(ctx -> {
                    Devices.craftHarvester(ctx.getSource().getPlayerOrThrow());
                    return 1;
                }))
                .then(literal("storage")
                        .executes(ctx -> {
                            Storage.craft(ctx.getSource().getPlayerOrThrow());
                            return 1;
                        })
                        .then(literal("find")
                                .then(argument("name", StringArgumentType.greedyString())
                                        .executes(ctx -> {
                                            Storage.find(ctx.getSource().getPlayerOrThrow(),
                                                    StringArgumentType.getString(ctx, "name"));
                                            return 1;
                                        }))))
                .then(literal("look")
                        .executes(HelperCommands::lookHelp)
                        .then(argument("mob", StringArgumentType.greedyString())
                                .suggests((ctx, builder) -> {
                                    List<String> options = new ArrayList<>(Disguise.lookSuggestions());
                                    options.add(0, "me");
                                    return CommandSource.suggestMatching(options, builder);
                                })
                                .executes(HelperCommands::look)))
                .then(literal("size")
                        .executes(HelperCommands::sizeHelp)
                        .then(argument("size", StringArgumentType.word())
                                .suggests((ctx, builder) -> CommandSource.suggestMatching(
                                        List.of("small", "normal", "big", "tiny", "giant", "0.5", "1.5"), builder))
                                .executes(HelperCommands::size)))
                .then(literal("fish")
                        .executes(ctx -> fish(ctx, 16))
                        .then(argument("amount", com.mojang.brigadier.arguments.IntegerArgumentType.integer(1, MAX_AMOUNT))
                                .executes(ctx -> fish(ctx, com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(ctx, "amount")))))
                .then(literal("farm")
                        .executes(ctx -> farm(ctx, 16))
                        .then(argument("radius", com.mojang.brigadier.arguments.IntegerArgumentType.integer(4, 48))
                                .executes(ctx -> farm(ctx, com.mojang.brigadier.arguments.IntegerArgumentType.getInteger(ctx, "radius")))))
                .then(literal("ride").executes(HelperCommands::ride))
                .then(literal("boss").executes(ctx -> {
                    Bosses.tellWhere(ctx.getSource().getPlayerOrThrow());
                    return 1;
                }))
                .then(literal("tycoon")
                        .executes(ctx -> { Tycoon.info(ctx.getSource().getPlayerOrThrow()); return 1; })
                        .then(literal("start").executes(ctx -> { Tycoon.start(ctx.getSource().getPlayerOrThrow()); return 1; }))
                        .then(literal("shop").executes(ctx -> { Tycoon.openShop(ctx.getSource().getPlayerOrThrow()); return 1; }))
                        .then(literal("upgrade").executes(ctx -> { Tycoon.upgrade(ctx.getSource().getPlayerOrThrow()); return 1; }))
                        .then(literal("fix").executes(ctx -> { Tycoon.fix(ctx.getSource().getPlayerOrThrow()); return 1; }))
                        .then(literal("top").executes(ctx -> { Tycoon.top(ctx.getSource().getPlayerOrThrow()); return 1; }))
                        .then(literal("rebirth")
                                .executes(ctx -> { Tycoon.rebirth(ctx.getSource().getPlayerOrThrow(), false); return 1; })
                                .then(literal("confirm").executes(ctx -> { Tycoon.rebirth(ctx.getSource().getPlayerOrThrow(), true); return 1; })))
                        .then(literal("give").requires(src -> src.hasPermissionLevel(2))
                                .then(argument("player", net.minecraft.command.argument.EntityArgumentType.player())
                                        .then(argument("coins", com.mojang.brigadier.arguments.LongArgumentType.longArg(1))
                                                .executes(ctx -> {
                                                    Tycoon.give(net.minecraft.command.argument.EntityArgumentType.getPlayer(ctx, "player"),
                                                            com.mojang.brigadier.arguments.LongArgumentType.getLong(ctx, "coins"));
                                                    return 1;
                                                })))))
                .then(literal("town").executes(ctx -> {
                    Town.tellWhere(ctx.getSource().getPlayerOrThrow());
                    return 1;
                }))
                .then(literal("update").executes(ctx -> {
                    ctx.getSource().sendFeedback(() -> Text.literal("Auto-update: " + Updater.status()).formatted(Formatting.AQUA), false);
                    return 1;
                }))
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
                "/helper look <mob>  - make your helper look like any mob, e.g. /helper look creeper",
                "/helper look me  - make your helper look like you again",
                "/helper size small|normal|big  - make your helper shorter or taller (or a number like 0.5)",
                "/helper dismiss  - send your helper away (it keeps your items)",
                "/helper collect spawner  - dig up a monster spawner you can place anywhere",
                "/helper harvester  - turn the hopper in your hand into a Monster Harvester",
                "  (kills monsters around it, loot goes into a chest below, sneak + right-click for XP)",
                "/helper storage  - turn the barrel in your hand into a Helper Storage (no size limit)",
                "/helper storage find <name>  - search your storage",
                "/helper ride  - ride your helper (or right-click it holding a saddle). Sneak to get off",
                "/helper boss  - where's this planet's boss arena? (Ad Astra planets)",
                "/helper fish [amount]  - go fishing at the nearest water (give it a fishing rod first)",
                "/helper farm [radius]  - harvest and replant ripe crops around you (16 blocks unless you say)",
                "/helper tycoon  - dropper tycoon: earn coins, /helper tycoon start for a free kit, /helper tycoon shop to spend",
                "/helper town  - where's Reef Town? (the undersea town on Bikini Bottom)",
                "/helper update  - is a newer version of this mod downloaded? (it updates itself)",
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
        String wrongDim = Materials.wrongDimension(player.getServer(), spec, player.getServerWorld());
        if (wrongDim != null) {
            Helper.say(player, wrongDim);
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

    private static int lookHelp(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        Helper.say(player, "Pick a mob for me to look like, e.g. /helper look creeper. "
                + "Use /helper look me to make me look like you again.");
        return 1;
    }

    private static int look(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        String raw = StringArgumentType.getString(ctx, "mob").trim();
        HelperData data = HelperData.get(player.getServer());
        HelperData.Entry entry = data.getOrCreate(player.getUuid());
        String lower = raw.toLowerCase(java.util.Locale.ROOT);
        String newLook;
        String reply;
        if (lower.equals("me") || lower.equals("player") || lower.equals("reset") || lower.equals("default")) {
            newLook = null;
            reply = "Back to looking like you!";
        } else {
            EntityType<?> type = Disguise.resolveLook(raw);
            if (type == null) {
                Helper.say(player, "I don't know a mob called \"" + raw + "\". Press Tab after /helper look "
                        + "to see the ones I can be.");
                return 0;
            }
            newLook = Registries.ENTITY_TYPE.getId(type).toString();
            String mobName = type.getName().getString();
            String article = "AEIOUaeiou".indexOf(mobName.isEmpty() ? 'x' : mobName.charAt(0)) >= 0 ? "an " : "a ";
            reply = "Ta-da! I'm " + article + mobName + " now. I'll still follow you and help.";
        }
        entry.look = newLook;
        data.markDirty();
        if (entry.active) HelperManager.refreshDisguise(player.getServer(), player.getUuid());
        Helper.say(player, entry.active ? reply : reply + " You'll see it when you /helper summon me.");
        return 1;
    }

    private static int sizeHelp(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        Helper.say(player, "Pick a size: /helper size small, normal or big, or a number from "
                + Size.MIN + " to " + Size.MAX + " (1 is normal).");
        return 1;
    }

    private static int size(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        String raw = StringArgumentType.getString(ctx, "size").toLowerCase(java.util.Locale.ROOT);
        float size;
        switch (raw) {
            case "tiny" -> size = 0.25f;
            case "small", "short", "baby", "little" -> size = 0.5f;
            case "normal", "default", "reset" -> size = 1f;
            case "big", "tall" -> size = 1.5f;
            case "giant", "huge" -> size = 2.5f;
            default -> {
                try {
                    size = Float.parseFloat(raw.replace("x", "").replace("%", ""));
                    if (raw.endsWith("%")) size /= 100f;
                } catch (NumberFormatException e) {
                    Helper.say(player, "I don't know the size \"" + raw + "\". Try small, normal, big or a number like 0.5.");
                    return 0;
                }
            }
        }
        if (Float.isNaN(size) || size < Size.MIN || size > Size.MAX) {
            Helper.say(player, "I can only be between " + Size.MIN + " and " + Size.MAX + " times my normal size.");
            return 0;
        }
        HelperData data = HelperData.get(player.getServer());
        HelperData.Entry entry = data.getOrCreate(player.getUuid());
        entry.size = size;
        data.markDirty();
        if (entry.active) HelperManager.refreshDisguise(player.getServer(), player.getUuid());
        String reply;
        if (size == 1f) {
            reply = "Back to normal size!";
        } else if (Size.hasPehkui()) {
            reply = "Okay! I'm " + Size.describe(size) + " now.";
        } else if (size < 1f) {
            reply = "I'll be the baby version of my look (try /helper look zombie or /helper look fox). "
                    + "To change size exactly, or to look like you and be smaller, the server needs the Pehkui mod.";
        } else {
            reply = "I can't get bigger without the Pehkui mod on the server. I saved the size, so it works once Pehkui is added.";
        }
        Helper.say(player, entry.active || size == 1f ? reply : reply + " You'll see it when you /helper summon me.");
        return 1;
    }

    private static int fish(CommandContext<ServerCommandSource> ctx, int amount) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        ensureSummoned(player);
        HelperManager.helperFor(player.getUuid()).startFishing(player, amount);
        return 1;
    }

    private static int farm(CommandContext<ServerCommandSource> ctx, int radius) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        ensureSummoned(player);
        HelperManager.helperFor(player.getUuid()).startFarming(player, radius);
        return 1;
    }

    private static int ride(CommandContext<ServerCommandSource> ctx) throws CommandSyntaxException {
        ServerPlayerEntity player = ctx.getSource().getPlayerOrThrow();
        HelperData.Entry entry = HelperData.get(player.getServer()).get(player.getUuid());
        if (entry == null || !entry.active) {
            Helper.say(player, "You don't have a helper out. Use /helper summon");
            return 0;
        }
        if (!HelperManager.helperFor(player.getUuid()).ride(player, entry)) {
            Helper.say(player, "I need to be close by for you to hop on. Use /helper stop and I'll come to you.");
            return 0;
        }
        Helper.say(player, "Hop on! Steer with your movement keys, sprint to go faster, sneak to get off.");
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
