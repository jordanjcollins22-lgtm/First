package com.helpermod;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.item.ItemStack;

import static net.minecraft.commands.Commands.argument;
import static net.minecraft.commands.Commands.literal;

/** /helper summon | collect <material> [amount] | stop | deliver | status | look <mob|me> | dismiss */
public final class HelperCommands {
    private HelperCommands() {}

    private static final int DEFAULT_AMOUNT = 64;
    private static final int MAX_AMOUNT = 64 * 36;

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(literal("helper")
                .executes(HelperCommands::help)
                .then(literal("help").executes(HelperCommands::help))
                .then(literal("summon").executes(HelperCommands::summon))
                .then(literal("collect")
                        .then(argument("material", StringArgumentType.greedyString())
                                .suggests((ctx, builder) -> {
                                    if (builder.getRemaining().contains(" ")) return builder.buildFuture();
                                    return SharedSuggestionProvider.suggest(Materials.SUGGESTIONS, builder);
                                })
                                .executes(HelperCommands::collect)))
                .then(literal("stop").executes(HelperCommands::stop))
                .then(literal("deliver").executes(HelperCommands::deliver))
                .then(literal("status").executes(HelperCommands::status))
                .then(literal("unstick").executes(ctx -> { unstick(ctx.getSource().getPlayerOrException()); return 1; }))
                .then(literal("send")
                        .then(argument("player", StringArgumentType.word())
                                .suggests((ctx, builder) -> SharedSuggestionProvider.suggest(
                                        ctx.getSource().getServer().getPlayerNames(), builder))
                                .executes(ctx -> { send(ctx.getSource().getPlayerOrException(), StringArgumentType.getString(ctx, "player"), "hand"); return 1; })
                                .then(argument("what", StringArgumentType.word())
                                        .suggests((ctx, builder) -> SharedSuggestionProvider.suggest(List.of("hand", "haul"), builder))
                                        .executes(ctx -> {
                                            send(ctx.getSource().getPlayerOrException(), StringArgumentType.getString(ctx, "player"),
                                                    StringArgumentType.getString(ctx, "what"));
                                            return 1;
                                        }))))
                .then(literal("guard")
                        .then(literal("on").executes(ctx -> guard(ctx, true)))
                        .then(literal("off").executes(ctx -> guard(ctx, false))))
                .then(literal("harvester").executes(ctx -> {
                    Devices.craftHarvester(ctx.getSource().getPlayerOrException());
                    return 1;
                }))
                .then(literal("storage")
                        .executes(ctx -> {
                            Storage.craft(ctx.getSource().getPlayerOrException());
                            return 1;
                        })
                        .then(literal("find")
                                .then(argument("name", StringArgumentType.greedyString())
                                        .executes(ctx -> {
                                            Storage.find(ctx.getSource().getPlayerOrException(),
                                                    StringArgumentType.getString(ctx, "name"));
                                            return 1;
                                        })))
                        .then(literal("open").executes(ctx -> { // storage anywhere: no barrel needed
                            Storage.open(ctx.getSource().getPlayerOrException());
                            return 1;
                        }))
                        .then(literal("send").executes(ctx -> {
                            ServerPlayer player = ctx.getSource().getPlayerOrException();
                            HelperData.Entry entry = ensureSummoned(player);
                            HelperManager.helperFor(player.getUUID()).sendToStorage(player, entry);
                            return 1;
                        }))
                        .then(literal("auto")
                                .then(literal("on").executes(ctx -> autoStore(ctx, true)))
                                .then(literal("off").executes(ctx -> autoStore(ctx, false)))))
                .then(literal("fetch")
                        .then(argument("item", StringArgumentType.greedyString())
                                .executes(ctx -> fetch(ctx, StringArgumentType.getString(ctx, "item")))))
                .then(literal("minimap").executes(ctx -> {
                    MiniMapLink.toggle(ctx.getSource().getPlayerOrException());
                    return 1;
                }))
                .then(literal("look")
                        .executes(HelperCommands::lookHelp)
                        .then(argument("mob", StringArgumentType.greedyString())
                                .suggests((ctx, builder) -> {
                                    List<String> options = new ArrayList<>(Disguise.lookSuggestions());
                                    options.add(0, "me");
                                    return SharedSuggestionProvider.suggest(options, builder);
                                })
                                .executes(HelperCommands::look)))
                .then(literal("size")
                        .executes(HelperCommands::sizeHelp)
                        .then(argument("size", StringArgumentType.word())
                                .suggests((ctx, builder) -> SharedSuggestionProvider.suggest(
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
                .then(literal("planet")
                        .executes(ctx -> { Space.list(ctx.getSource().getPlayerOrException()); return 1; })
                        .then(literal("home").executes(ctx -> { Space.home(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(argument("name", com.mojang.brigadier.arguments.StringArgumentType.word())
                                .suggests((ctx, b) -> net.minecraft.commands.SharedSuggestionProvider.suggest(Space.PLANETS, b))
                                .executes(ctx -> { Space.go(ctx.getSource().getPlayerOrException(),
                                        com.mojang.brigadier.arguments.StringArgumentType.getString(ctx, "name")); return 1; })))
                .then(literal("boss").executes(ctx -> {
                    Bosses.tellWhere(ctx.getSource().getPlayerOrException());
                    return 1;
                }))
                .then(literal("furniture").executes(ctx -> { Furniture.openCatalog(ctx.getSource().getPlayerOrException()); return 1; }))
                .then(literal("tycoon")
                        .executes(ctx -> { Tycoon.info(ctx.getSource().getPlayerOrException()); return 1; })
                        .then(literal("start").executes(ctx -> { Tycoon.start(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("shop").executes(ctx -> { Tycoon.openShop(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("upgrade").executes(ctx -> { Tycoon.upgrade(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("fix").executes(ctx -> { Tycoon.fix(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("top").executes(ctx -> { Tycoon.top(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("odds").executes(ctx -> { Loot.odds(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("sell").executes(ctx -> { TycoonFactory.openSell(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("price").executes(ctx -> { TycoonFactory.price(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("recipes").executes(ctx -> { TycoonFactory.recipes(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("sidebar")
                                .then(literal("on").executes(ctx -> { TycoonSidebar.set(ctx.getSource().getPlayerOrException(), true); return 1; }))
                                .then(literal("off").executes(ctx -> { TycoonSidebar.set(ctx.getSource().getPlayerOrException(), false); return 1; })))
                        .then(literal("rebirth")
                                .executes(ctx -> { Tycoon.rebirth(ctx.getSource().getPlayerOrException(), false); return 1; })
                                .then(literal("confirm").executes(ctx -> { Tycoon.rebirth(ctx.getSource().getPlayerOrException(), true); return 1; })))
                        .then(literal("give").requires(net.minecraft.commands.Commands.hasPermission(net.minecraft.commands.Commands.LEVEL_GAMEMASTERS))
                                .then(argument("player", net.minecraft.commands.arguments.EntityArgument.player())
                                        .then(argument("coins", com.mojang.brigadier.arguments.LongArgumentType.longArg(1))
                                                .executes(ctx -> {
                                                    Tycoon.give(net.minecraft.commands.arguments.EntityArgument.getPlayer(ctx, "player"),
                                                            com.mojang.brigadier.arguments.LongArgumentType.getLong(ctx, "coins"));
                                                    return 1;
                                                })))))
                .then(literal("mine")
                        .then(literal("marker").executes(ctx -> { MineMarker.give(ctx.getSource().getPlayerOrException()); return 1; })))
                .then(literal("town").executes(ctx -> {
                    Town.tellWhere(ctx.getSource().getPlayerOrException());
                    return 1;
                }))
                .then(literal("golf").executes(ctx -> { Golf.info(ctx.getSource().getPlayerOrException()); return 1; })
                        .then(literal("shop").executes(ctx -> { Golf.openShop(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("ball").executes(ctx -> { Golf.pickUp(ctx.getSource().getPlayerOrException()); return 1; })))
                .then(literal("roadster").executes(ctx -> { Roadster.info(ctx.getSource().getPlayerOrException()); return 1; })
                        .then(literal("shop").executes(ctx -> { Tycoon.openShop(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("call").executes(ctx -> { Roadster.call(ctx.getSource().getPlayerOrException()); return 1; }))
                        .then(literal("waypoint")
                                .then(literal("clear").executes(ctx -> { Roadster.clearWaypoint(ctx.getSource().getPlayerOrException()); return 1; }))
                                .then(argument("x", com.mojang.brigadier.arguments.DoubleArgumentType.doubleArg())
                                        .then(argument("z", com.mojang.brigadier.arguments.DoubleArgumentType.doubleArg())
                                                .executes(ctx -> {
                                                    Roadster.setWaypoint(ctx.getSource().getPlayerOrException(),
                                                            com.mojang.brigadier.arguments.DoubleArgumentType.getDouble(ctx, "x"),
                                                            com.mojang.brigadier.arguments.DoubleArgumentType.getDouble(ctx, "z"));
                                                    return 1;
                                                }))))
                        .then(literal("paint").then(net.minecraft.commands.Commands.argument("colour",
                                com.mojang.brigadier.arguments.StringArgumentType.greedyString()).executes(ctx -> {
                            Roadster.paint(ctx.getSource().getPlayerOrException(), com.mojang.brigadier.arguments.StringArgumentType.getString(ctx, "colour"));
                            return 1;
                        })))
                        .then(literal("coat").then(net.minecraft.commands.Commands.argument("coat",
                                com.mojang.brigadier.arguments.StringArgumentType.word()).executes(ctx -> {
                            Roadster.coat(ctx.getSource().getPlayerOrException(), com.mojang.brigadier.arguments.StringArgumentType.getString(ctx, "coat"));
                            return 1;
                        })))
                        .then(literal("name").then(net.minecraft.commands.Commands.argument("name",
                                com.mojang.brigadier.arguments.StringArgumentType.greedyString()).executes(ctx -> {
                            Roadster.rename(ctx.getSource().getPlayerOrException(), com.mojang.brigadier.arguments.StringArgumentType.getString(ctx, "name"));
                            return 1;
                        }))))
                .then(literal("blackhole").executes(ctx -> { BlackHole.info(ctx.getSource().getPlayerOrException()); return 1; })
                        .then(literal("leave").executes(ctx -> { BlackHole.leaveCommand(ctx.getSource().getPlayerOrException()); return 1; })))
                .then(literal("update").executes(ctx -> {
                    ctx.getSource().sendSuccess(() -> Component.literal("Auto-update: " + Updater.status()).withStyle(ChatFormatting.AQUA), false);
                    return 1;
                }))
                .then(literal("dismiss").executes(HelperCommands::dismiss)));
    }

    private static int help(CommandContext<CommandSourceStack> ctx) {
        String[] lines = {
                "/helper summon  - get your helper",
                "/helper collect <material> [amount]  - e.g. /helper collect iron 32",
                "/helper deliver  - bring me what you have now",
                "/helper stop  - stop and follow me",
                "/helper status  - what are you doing?",
                "/helper send <player> [hand|haul]  - take what's in your hand (or the helper's haul) to another player",
                "/helper unstick  - stuck somewhere? pop back to me",
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
                "/helper storage open  - open your Helper Storage from anywhere",
                "/helper fetch <item> [amount]  - your helper brings it out of your storage, wherever you are",
                "/helper storage send  - your helper puts what it's carrying into your storage from where it is",
                "/helper storage auto on|off  - when its pockets fill up, it sends the haul to storage and keeps working",
                "/helper ride  - ride your helper (or right-click it holding a saddle). Sneak to get off",
                "/helper boss  - where's this planet's boss arena? (Ad Astra planets)",
                "/helper planet [name|home]  - fly to a planet. In survival, buy a Space Rocket in /helper tycoon shop and right-click it",
                "/helper fish [amount]  - go fishing at the nearest water (give it a fishing rod first)",
                "/helper farm [radius]  - harvest and replant ripe crops around you (16 blocks unless you say)",
                "/helper tycoon  - dropper tycoon: earn coins, /helper tycoon start for a free kit, /helper tycoon shop to spend",
                "/helper furniture  - the furniture catalogue: kitchen, living room, dining room, bedroom, bathroom and more",
                "/helper town  - where's Reef Town? (the undersea town on Bikini Bottom)",
                "/helper mine marker  - get a Mine Marker: place it where you want your helper's mine",
                "/helper golf  - Fairway golf planet: where's the club, your round, /helper golf shop, /helper golf ball (pick up your ball)",
                "/helper roadster  - the Star Roadster flying car: buy it in /helper tycoon shop or /helper golf shop. paint <colour>|coat <coat>|name <name>|call|waypoint <x> <z> (autopilot)",
                "/helper blackhole  - how to make a Singularity and the Black Hole's bosses. /helper blackhole leave gets you out",
                "/helper update  - is a newer version of this mod downloaded? (it updates itself)",
                "Right-click your helper to give it tools, weapons and armor, or take items.",
        };
        ctx.getSource().sendSuccess(() -> Component.literal("Helper commands:").withStyle(ChatFormatting.GOLD), false);
        for (String line : lines) ctx.getSource().sendSuccess(() -> Component.literal(line), false);
        return 1;
    }

    private static int autoStore(CommandContext<CommandSourceStack> ctx, boolean on) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        HelperData data = HelperData.get(player.level().getServer());
        data.getOrCreate(player.getUUID()).autoStore = on;
        data.setDirty();
        Helper.say(player, on ? "Okay! When my pockets fill up I'll send everything to your Helper Storage from wherever "
                + "I am and keep working. /helper deliver still brings things to you."
                : "Okay, I'll bring things back to you (or to a Helper Storage nearby) again.");
        return 1;
    }

    /** /helper fetch <item> [amount] or /helper fetch <amount> <item>: from Helper Storage to you, anywhere. */
    private static int fetch(CommandContext<CommandSourceStack> ctx, String raw) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        String text = raw.trim();
        int amount = 64;
        java.util.regex.Matcher end = java.util.regex.Pattern.compile("^(.*?)\\s+(\\d{1,5})$").matcher(text);
        java.util.regex.Matcher start = java.util.regex.Pattern.compile("^(\\d{1,5})\\s+(.*)$").matcher(text);
        if (end.matches()) {
            text = end.group(1);
            amount = Integer.parseInt(end.group(2));
        } else if (start.matches()) {
            amount = Integer.parseInt(start.group(1));
            text = start.group(2);
        }
        Storage.fetch(player, text, Math.max(1, Math.min(amount, 2304)));
        return 1;
    }

    private static HelperData.Entry ensureSummoned(ServerPlayer player) {
        HelperData data = HelperData.get(player.level().getServer());
        HelperData.Entry entry = data.getOrCreate(player.getUUID());
        Helper helper = HelperManager.helperFor(player.getUUID());
        if (!entry.active || helper.findEntity(player.level().getServer(), entry) == null) {
            helper.spawnNear(player, entry);
        }
        return entry;
    }

    /** Online player by name, ignoring case, or null. */
    static ServerPlayer onlinePlayer(net.minecraft.server.MinecraftServer server, String name) {
        for (ServerPlayer p : server.getPlayerList().getPlayers()) {
            if (p.getGameProfile().name().equalsIgnoreCase(name)) return p;
        }
        return null;
    }

    /** /helper send <player> [hand|haul]: the helper walks the items over to another player. */
    static void send(ServerPlayer player, String targetName, String what) {
        ServerPlayer target = onlinePlayer(player.level().getServer(), targetName);
        if (target == null) {
            Helper.say(player, "I can't find a player called " + targetName + " online.");
            return;
        }
        if (target == player) {
            Helper.say(player, "That's you! Use /helper deliver to get my haul.");
            return;
        }
        HelperData.Entry entry = ensureSummoned(player);
        Helper helper = HelperManager.helperFor(player.getUUID());
        List<ItemStack> items = new ArrayList<>();
        boolean haul = what.equalsIgnoreCase("haul") || what.equalsIgnoreCase("all") || what.equalsIgnoreCase("everything");
        if (haul) {
            var inv = entry.inventory;
            for (int i = 0; i < inv.getContainerSize(); i++) {
                ItemStack s = inv.getItem(i);
                if (s.isEmpty() || s.isDamageableItem()) continue; // keep its tools
                items.add(s.copy());
            }
            if (items.isEmpty()) {
                Helper.say(player, "I'm not carrying anything to take (I keep my tools).");
                return;
            }
            if (!helper.send(player, target, items)) return;
            for (int i = 0; i < inv.getContainerSize(); i++) {
                ItemStack s = inv.getItem(i);
                if (!s.isEmpty() && !s.isDamageableItem()) inv.setItem(i, ItemStack.EMPTY);
            }
            inv.setChanged();
        } else {
            ItemStack hand = player.getMainHandItem();
            if (hand.isEmpty()) {
                Helper.say(player, "Hold the thing you want me to take to " + target.getName().getString()
                        + " in your hand, then ask again. (Or /helper send " + target.getName().getString() + " haul for what I'm carrying.)");
                return;
            }
            items.add(hand.copy());
            if (!helper.send(player, target, items)) return;
            player.getInventory().removeItemNoUpdate(player.getInventory().getSelectedSlot());
        }
        target.sendOverlayMessage(Component.literal(player.getName().getString() + "'s helper is bringing you something!").withStyle(ChatFormatting.GOLD));
    }

    /** /helper unstick, or "helper, are you stuck?" when it is. */
    static void unstick(ServerPlayer player) {
        HelperData.Entry entry = ensureSummoned(player);
        HelperManager.helperFor(player.getUUID()).unstick(player, entry);
        Helper.say(player, "Phew, thanks! I'm out and right next to you. I'll pick up where I left off.");
    }

    private static int summon(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        HelperData.Entry entry = HelperData.get(player.level().getServer()).getOrCreate(player.getUUID());
        HelperManager.helperFor(player.getUUID()).spawnNear(player, entry);
        Helper.say(player, "Hi! Tell me what to get with /helper collect <material> [amount]. "
                + "Right-click me to give me tools.");
        return 1;
    }

    private static int collect(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
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
            spec = Materials.resolve(player.level().getServer(), raw);
        } catch (Materials.ResolveException e) {
            Helper.say(player, e.getMessage());
            return 0;
        }
        String wrongDim = Materials.wrongDimension(player.level().getServer(), spec, player.level());
        if (wrongDim != null) {
            Helper.say(player, wrongDim);
            return 0;
        }
        ensureSummoned(player);
        HelperManager.helperFor(player.getUUID()).startJob(player, spec, amount);
        return 1;
    }

    private static int stop(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        HelperManager.helperFor(player.getUUID()).stop(player);
        Helper.say(player, "Okay, stopping. I'll follow you.");
        return 1;
    }

    private static int deliver(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        ensureSummoned(player);
        HelperManager.helperFor(player.getUUID()).deliverNow();
        Helper.say(player, "Coming to you with what I've got.");
        return 1;
    }

    private static int status(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        HelperData.Entry entry = HelperData.get(player.level().getServer()).get(player.getUUID());
        if (entry == null || !entry.active) {
            Helper.say(player, "You don't have a helper out. Use /helper summon");
            return 0;
        }
        Helper.say(player, HelperManager.helperFor(player.getUUID()).status(entry.inventory));
        return 1;
    }

    private static int guard(CommandContext<CommandSourceStack> ctx, boolean on) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        HelperData data = HelperData.get(player.level().getServer());
        data.getOrCreate(player.getUUID()).guard = on;
        data.setDirty();
        Helper.say(player, on
                ? "I'll protect you! I fight monsters that come after you, and anything you attack."
                : "Okay, no fighting. I'll stay out of trouble.");
        return 1;
    }

    private static int lookHelp(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        Helper.say(player, "Pick a mob for me to look like, e.g. /helper look creeper. "
                + "Use /helper look me to make me look like you again.");
        return 1;
    }

    private static int look(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        String raw = StringArgumentType.getString(ctx, "mob").trim();
        HelperData data = HelperData.get(player.level().getServer());
        HelperData.Entry entry = data.getOrCreate(player.getUUID());
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
            newLook = BuiltInRegistries.ENTITY_TYPE.getKey(type).toString();
            String mobName = type.getDescription().getString();
            String article = "AEIOUaeiou".indexOf(mobName.isEmpty() ? 'x' : mobName.charAt(0)) >= 0 ? "an " : "a ";
            reply = "Ta-da! I'm " + article + mobName + " now. I'll still follow you and help.";
        }
        entry.look = newLook;
        data.setDirty();
        if (entry.active) HelperManager.refreshDisguise(player.level().getServer(), player.getUUID());
        Helper.say(player, entry.active ? reply : reply + " You'll see it when you /helper summon me.");
        return 1;
    }

    private static int sizeHelp(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        Helper.say(player, "Pick a size: /helper size small, normal or big, or a number from "
                + Size.MIN + " to " + Size.MAX + " (1 is normal).");
        return 1;
    }

    private static int size(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
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
        HelperData data = HelperData.get(player.level().getServer());
        HelperData.Entry entry = data.getOrCreate(player.getUUID());
        entry.size = size;
        data.setDirty();
        if (entry.active) HelperManager.refreshDisguise(player.level().getServer(), player.getUUID());
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

    private static int fish(CommandContext<CommandSourceStack> ctx, int amount) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        ensureSummoned(player);
        HelperManager.helperFor(player.getUUID()).startFishing(player, amount);
        return 1;
    }

    private static int farm(CommandContext<CommandSourceStack> ctx, int radius) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        ensureSummoned(player);
        HelperManager.helperFor(player.getUUID()).startFarming(player, radius);
        return 1;
    }

    private static int ride(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        HelperData.Entry entry = HelperData.get(player.level().getServer()).get(player.getUUID());
        if (entry == null || !entry.active) {
            Helper.say(player, "You don't have a helper out. Use /helper summon");
            return 0;
        }
        if (!HelperManager.helperFor(player.getUUID()).ride(player, entry)) {
            Helper.say(player, "I need to be close by for you to hop on. Use /helper stop and I'll come to you.");
            return 0;
        }
        Helper.say(player, "Hop on! Steer with your movement keys, sprint to go faster, sneak to get off.");
        return 1;
    }

    private static int dismiss(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
        ServerPlayer player = ctx.getSource().getPlayerOrException();
        HelperData.Entry entry = HelperData.get(player.level().getServer()).get(player.getUUID());
        if (entry == null || !entry.active) {
            Helper.say(player, "You don't have a helper out.");
            return 0;
        }
        HelperManager.helperFor(player.getUUID()).dismiss(player.level().getServer(), entry);
        String held = Helper.summarize(entry.inventory, false);
        Helper.say(player, "Bye for now!" + (held.isEmpty() ? "" : " I'll hold on to " + held
                + " until you summon me again."));
        return 1;
    }
}
