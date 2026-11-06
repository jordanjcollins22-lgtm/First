package com.helpermod;

import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.mob.MobEntity;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.network.message.MessageType;
import net.minecraft.network.message.SignedMessage;
import net.minecraft.registry.RegistryKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.world.World;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The helper's mind: it understands plain chat, notices what's going on around you and acts on its own.
 *
 * Talk to it in chat by starting a message with "helper" (or "buddy"), for example
 * "helper, get 20 iron", "helper go fishing", "helper follow me" or "helper how are you?".
 * It also speaks up by itself: when night falls, when it rains, when you're hurt or hungry
 * (it hands you food it's carrying), and when you arrive somewhere new. While it follows you,
 * it picks up items lying around.
 */
final class Mind {
    private Mind() {}

    private static final Pattern NUMBER = Pattern.compile("\\b(\\d{1,4})\\b");
    private static final Pattern WAKE = Pattern.compile("^\\s*(hey\\s+|ok\\s+|okay\\s+)?(helper|buddy)\\b[\\s,:!.-]*", Pattern.CASE_INSENSITIVE);
    /** "hi helper", "thanks buddy", "good job helper!" */
    private static final Pattern WAKE_END = Pattern.compile("[\\s,]+(my\\s+)?(helper|buddy)[\\s?!.]*$", Pattern.CASE_INSENSITIVE);

    /** Who the helper is answering right now; while set, its replies go to everyone so others see the conversation. */
    private static ServerPlayerEntity talkingTo;
    /** Last chat line handled per player, so a message seen twice (event and fallback) is answered once. */
    private static final Map<UUID, String> LAST_CHAT = new HashMap<>();
    private static final Map<UUID, Long> LAST_CHAT_AT = new HashMap<>();
    /** Answers wait a few ticks so they show up after the player's own chat line. */
    private static final java.util.List<Object[]> PENDING = new java.util.ArrayList<>();

    /** Per player: what it last said about each thing, so it doesn't repeat itself. */
    private static final class Memory {
        long night = -1;
        boolean rain;
        RegistryKey<World> dim;
        long hurtAt, fedAt, chatterAt;
        int chats;
    }

    private static final Map<UUID, Memory> MEMORY = new HashMap<>();

    static void reset() {
        MEMORY.clear();
        LAST_CHAT.clear();
        LAST_CHAT_AT.clear();
        synchronized (PENDING) {
            PENDING.clear();
        }
    }

    // ---------------------------------------------------------------------------------------
    // Chat
    // ---------------------------------------------------------------------------------------

    static void onChat(SignedMessage message, ServerPlayerEntity player, MessageType.Parameters params) {
        heard(player, message.getSignedContent());
    }

    /**
     * Every chat line a player sends. Called from the Fabric chat event and, as a fallback for chat mods
     * that replace the normal chat broadcast, straight from the chat packet (see ChatPacketMixin).
     */
    static void heard(ServerPlayerEntity player, String text) {
        if (player == null || text == null || text.startsWith("/")) return;
        String ask;
        Matcher wake = WAKE.matcher(text);
        Matcher end = WAKE_END.matcher(text);
        if (wake.find()) ask = text.substring(wake.end());
        else if (end.find()) ask = text.substring(0, end.start());
        else return;
        String clean = ask.trim().toLowerCase(Locale.ROOT).replaceAll("[?!.,]+$", "");
        MinecraftServer server = player.getServer();
        if (server == null) return;
        long now = System.currentTimeMillis();
        synchronized (LAST_CHAT) {
            Long at = LAST_CHAT_AT.get(player.getUuid());
            if (text.equals(LAST_CHAT.get(player.getUuid())) && at != null && now - at < 1500) return; // already handled
            LAST_CHAT.put(player.getUuid(), text);
            LAST_CHAT_AT.put(player.getUuid(), now);
        }
        synchronized (PENDING) {
            PENDING.add(new Object[]{player, clean, 3});
        }
    }

    private static void runPending() {
        java.util.List<Object[]> ready = new java.util.ArrayList<>();
        synchronized (PENDING) {
            for (java.util.Iterator<Object[]> it = PENDING.iterator(); it.hasNext(); ) {
                Object[] p = it.next();
                int left = (Integer) p[2] - 1;
                p[2] = left;
                if (left <= 0) {
                    ready.add(p);
                    it.remove();
                }
            }
        }
        for (Object[] p : ready) {
            ServerPlayerEntity player = (ServerPlayerEntity) p[0];
            if (player.isRemoved()) continue;
            talkingTo = player;
            try {
                answer(player, (String) p[1]);
            } catch (Exception e) {
                HelperMod.LOG.warn("Helper chat answer failed", e);
                Helper.say(player, "Sorry, something went wrong there. Try /helper help.");
            } finally {
                talkingTo = null;
            }
        }
    }

    /** While answering chat, the helper speaks so everyone can see it (others saw the question too). */
    static boolean sayToAll(ServerPlayerEntity player, net.minecraft.text.Text text, String message) {
        if (talkingTo == null || talkingTo != player || player.getServer() == null) return false;
        net.minecraft.text.Text named = net.minecraft.text.Text.literal("[" + player.getName().getString() + "'s Helper] ")
                .formatted(net.minecraft.util.Formatting.GOLD)
                .append(net.minecraft.text.Text.literal(message).formatted(net.minecraft.util.Formatting.WHITE));
        for (ServerPlayerEntity p : player.getServer().getPlayerManager().getPlayerList()) {
            p.sendMessage(p == player ? text : named, false);
        }
        return true;
    }

    private static void run(ServerPlayerEntity player, String command) {
        player.getServer().getCommandManager().executeWithPrefix(player.getCommandSource(), command);
    }

    private static int number(String ask, int fallback) {
        Matcher m = NUMBER.matcher(ask);
        return m.find() ? Math.max(1, Integer.parseInt(m.group(1))) : fallback;
    }

    private static boolean has(String ask, String... words) {
        for (String w : words) if (Pattern.compile("\\b" + w + "\\b").matcher(ask).find()) return true;
        return false;
    }

    private static void answer(ServerPlayerEntity player, String ask) {
        Memory mem = MEMORY.computeIfAbsent(player.getUuid(), k -> new Memory());
        mem.chats++;
        if (ask.isEmpty()) {
            Helper.say(player, pick(player, "Yes? I'm right here.", "What's up?", "Need something?"));
            return;
        }
        if (askAboutSelf(player, ask)) return;
        Matcher flyTo = Pattern.compile("\\b(fly|take|drive)\\b.*?\\bto\\s+(-?\\d+)[\\s,]+(?:-?\\d+[\\s,]+)?(-?\\d+)\\b").matcher(ask);
        if (flyTo.find()) { // "helper, fly me to 300 -150": roadster autopilot waypoint (y in the middle is ignored)
            Roadster.setWaypoint(player, Integer.parseInt(flyTo.group(2)) + 0.5, Integer.parseInt(flyTo.group(3)) + 0.5);
            return;
        }
        Matcher sendTo = Pattern.compile("\\b(give|take|bring|send|deliver|carry|hand)\\b.*?\\bto\\s+([a-z0-9_]{3,16})\\b").matcher(ask);
        if (sendTo.find() && !sendTo.group(2).equals("me")
                && HelperCommands.onlinePlayer(player.getServer(), sendTo.group(2)) != null) {
            boolean haul = has(ask, "haul", "everything", "all", "your stuff", "what you have", "what you've got", "your items");
            HelperCommands.send(player, sendTo.group(2), haul ? "haul" : "hand");
            return;
        }
        Matcher collect = Pattern.compile("\\b(get|collect|mine|gather|find|fetch|grab|dig)\\b\\s+(?:me\\s+)?(?:some\\s+)?(?:\\d+\\s+)?(?:of\\s+)?([a-z_:]+)").matcher(ask);
        if (has(ask, "fish", "fishing")) {
            run(player, "helper fish " + Math.min(number(ask, 16), 999));
        } else if (has(ask, "farm", "farming", "harvest", "crops")) {
            run(player, "helper farm");
        } else if (has(ask, "ride", "mount")) {
            run(player, "helper ride");
        } else if (has(ask, "deliver", "bring", "give me", "hand over")) {
            run(player, "helper deliver");
        } else if (has(ask, "status", "doing", "busy")) {
            run(player, "helper status");
        } else if (has(ask, "boss")) {
            run(player, "helper boss");
        } else if (has(ask, "town")) {
            run(player, "helper town");
        } else if (has(ask, "coins", "money", "tycoon")) {
            run(player, "helper tycoon");
        } else if (collect.find()) {
            String what = collect.group(2);
            if (what.equals("me") || what.equals("some")) what = "iron";
            run(player, "helper collect " + what + " " + Math.min(number(ask, 32), 2304));
        } else if (has(ask, "stop", "follow", "come", "here", "wait", "cancel", "home")) {
            run(player, "helper stop");
            Helper.say(player, pick(player, "Coming!", "Right behind you.", "On my way."));
        } else if (has(ask, "summon", "appear")) {
            run(player, "helper summon");
        } else if (has(ask, "how are you", "how is it going", "how's it going", "hows it going", "how you doing",
                "how are you doing", "you ok", "you good", "feeling", "what's up", "whats up")) {
            HelperData.Entry e = HelperData.get(player.getServer()).get(player.getUuid());
            int level = e == null ? 1 : HelperData.levelFor(e.work);
            Helper.say(player, level >= 5
                    ? "Never better. Level " + level + " and still learning. Thanks for asking, " + player.getName().getString() + "."
                    : "I'm good! Level " + level + " so far. Give me more jobs and I'll get better at them.");
        } else if (has(ask, "thanks", "thank you", "good job", "nice", "well done", "love you")) {
            Helper.say(player, pick(player, "Any time!", "Happy to help.", "That's what I'm here for.", "Aw, thanks."));
        } else if (has(ask, "hi", "hello", "hey", "yo", "sup")) {
            Helper.say(player, pick(player, "Hi " + player.getName().getString() + "!", "Hello! Ready when you are.", "Hey! What are we doing today?"));
        } else if (has(ask, "who are you", "your name", "what are you")) {
            Helper.say(player, "I'm your helper. I mine, fish, farm, fight and carry things for you. Ask me in chat, like \"helper, get 20 iron\".");
        } else if (has(ask, "help", "what can you do")) {
            Helper.say(player, "Try: \"helper, get 32 coal\", \"helper go fishing\", \"helper farm\", \"helper follow me\", "
                    + "\"helper bring it to me\", \"helper give this to Steve\", \"helper are you stuck?\" or \"helper where are you?\".");
        } else {
            Helper.say(player, "Sorry, I didn't get that. Try \"helper, get 20 iron\", \"helper go fishing\" or \"helper follow me\".");
        }
    }

    /**
     * Basic questions about the helper itself: are you stuck, where are you, are you ok, are you full,
     * how far along are you. Answered from what it's really doing. True if the question was one of these.
     */
    private static boolean askAboutSelf(ServerPlayerEntity player, String ask) {
        HelperData.Entry entry = HelperData.get(player.getServer()).get(player.getUuid());
        if (has(ask, "unstick", "get unstuck")) {
            HelperCommands.unstick(player);
            return true;
        }
        if (!has(ask, "stuck", "trapped", "are you lost", "you lost", "where are you", "where r u", "where are u", "where you at", "where did you go",
                "are you ok", "are you okay", "you ok", "you okay", "r u ok", "are you alright", "are you hurt", "you hurt",
                "health", "are you alive", "are you dead", "are you full", "you full", "inventory full", "pockets",
                "what do you have", "what have you got", "what are you carrying", "what you got",
                "are you done", "you done", "done yet", "finished", "how long", "how many more", "how much more", "progress",
                "can you hear me", "are you there", "you there", "are you listening",
                "what level", "your level", "how strong", "hungry", "tired", "sleepy", "are you happy", "do you like me")) {
            return false;
        }
        if (entry == null || !entry.active) {
            Helper.say(player, "I'm not out right now! /helper summon and I'll be right there.");
            return true;
        }
        Helper helper = HelperManager.helperFor(player.getUuid());
        SimpleInventory inv = entry.inventory;
        if (has(ask, "stuck", "trapped", "are you lost", "you lost")) {
            if (helper.looksStuck(player)) {
                HelperCommands.unstick(player);
            } else {
                Helper.say(player, "Nope, I'm moving fine! " + helper.whereText(player) + " " + helper.progressText()
                        + " If I ever look stuck to you, say \"helper unstick\" and I'll pop over.");
            }
        } else if (has(ask, "where are you", "where r u", "where are u", "where you at", "where did you go")) {
            Helper.say(player, helper.whereText(player));
        } else if (has(ask, "are you full", "you full", "inventory full", "pockets", "what do you have", "what have you got",
                "what are you carrying", "what you got")) {
            Helper.say(player, helper.pocketsText(inv));
        } else if (has(ask, "are you done", "you done", "done yet", "finished", "how long", "how many more", "how much more", "progress")) {
            Helper.say(player, helper.progressText());
        } else if (has(ask, "can you hear me", "are you there", "you there", "are you listening")) {
            Helper.say(player, pick(player, "Loud and clear!", "Yep, I'm here.", "Always listening, boss.") + " " + helper.whereText(player));
        } else if (has(ask, "what level", "your level", "how strong")) {
            Helper.say(player, Helper.levelText(entry) + ", " + entry.inventory.unlocked + " pockets. I level up by doing jobs for you.");
        } else if (has(ask, "hungry")) {
            Helper.say(player, "Helpers don't eat, but thanks for asking! Are YOU hungry? Keep some food on you.");
        } else if (has(ask, "tired", "sleepy")) {
            Helper.say(player, "Never tired! " + (player.getWorld().isNight() ? "It is night though, maybe you should sleep." : "Let's keep going."));
        } else if (has(ask, "are you happy", "do you like me")) {
            Helper.say(player, pick(player, "Of course! You're the best boss.", "Very happy. I love a good job.", "Yes! Thanks for keeping me busy."));
        } else { // are you ok / hurt / health / alive
            Helper.say(player, helper.healthText() + ". " + (helper.looksStuck(player)
                    ? "I think I'm stuck though. Say \"helper unstick\" and I'll pop over." : helper.progressText()));
        }
        return true;
    }

    private static String pick(ServerPlayerEntity player, String... lines) {
        return lines[player.getRandom().nextInt(lines.length)];
    }

    // ---------------------------------------------------------------------------------------
    // Noticing things and acting on its own
    // ---------------------------------------------------------------------------------------

    static void tick(MinecraftServer server) {
        runPending();
        if (server.getTicks() % 20 != 7) return;
        HelperData data = HelperData.get(server);
        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            HelperData.Entry entry = data.get(player.getUuid());
            if (entry == null || !entry.active) continue;
            Helper helper = HelperManager.helperFor(player.getUuid());
            MobEntity mob = helper.mobEntity();
            if (mob == null || !mob.isAlive() || mob.getWorld() != player.getWorld()) continue;
            Memory mem = MEMORY.computeIfAbsent(player.getUuid(), k -> new Memory());
            ServerWorld world = player.getServerWorld();
            long now = world.getTime();

            notice(player, world, mem, now);
            care(player, entry.inventory, mem, now);
            if (helper.mode == Helper.Mode.FOLLOW && !helper.isFighting()) tidyUp(mob, entry.inventory, world);
        }
    }

    private static void notice(ServerPlayerEntity player, ServerWorld world, Memory mem, long now) {
        if (mem.dim != world.getRegistryKey()) {
            boolean first = mem.dim == null;
            mem.dim = world.getRegistryKey();
            if (!first) {
                String where = world.getRegistryKey().getValue().toString();
                if (world.getRegistryKey() == World.NETHER) Helper.say(player, "Phew, it's hot in here. Watch out for the lava, I'll watch your back.");
                else if (world.getRegistryKey() == World.END) Helper.say(player, "The End... Don't look the Endermen in the eye. I'll stay close.");
                else if (world.getRegistryKey() == World.OVERWORLD) Helper.say(player, "Home sweet home.");
                else if (Planets.isSpace(world)) { /* Planets already greets you on arrival */ }
                else Helper.say(player, "Ooh, somewhere new (" + where + "). Let's look around.");
            }
        }
        if (world.getDimension().hasSkyLight() && world.getRegistryKey() == World.OVERWORLD) {
            long day = world.getTimeOfDay() / 24000L;
            long time = world.getTimeOfDay() % 24000L;
            if (time >= 12800 && time < 13600 && mem.night != day) {
                mem.night = day;
                Helper.say(player, "The sun's going down. Monsters will be out soon, so stay close to me.");
            }
            boolean raining = world.isRaining();
            if (raining && !mem.rain) Helper.say(player, world.isThundering() ? "A thunderstorm! Careful, charged creepers are no joke." : "Looks like rain.");
            mem.rain = raining;
        }
        if (player.getHealth() <= 6 && player.isAlive() && now - mem.hurtAt > 1200) {
            mem.hurtAt = now;
            Helper.say(player, "You're hurt! Back off and eat something. I'll hold them off.");
        }
        if (now - mem.chatterAt > 12000 && player.getRandom().nextInt(400) == 0) {
            mem.chatterAt = now;
            Helper.say(player, pick(player,
                    "Just so you know, you can talk to me in chat. Say \"helper, get 20 iron\".",
                    "I like working with you.",
                    "If you ever need anything mined, fished or farmed, just say so.",
                    "Nice day for an adventure."));
        }
    }

    /** Hand the owner food it's carrying when they're hungry. */
    private static void care(ServerPlayerEntity player, SimpleInventory inv, Memory mem, long now) {
        if (player.getHungerManager().getFoodLevel() > 12 || now - mem.fedAt < 600) return;
        for (int i = 0; i < inv.size(); i++) {
            ItemStack s = inv.getStack(i);
            if (!s.isFood() || s.isOf(Items.ROTTEN_FLESH) || s.isOf(Items.SPIDER_EYE) || s.isOf(Items.POISONOUS_POTATO)
                    || s.isOf(Items.PUFFERFISH) || s.isOf(Items.CHORUS_FRUIT) || s.isOf(Items.SUSPICIOUS_STEW)) continue;
            ItemStack give = s.split(Math.min(s.getCount(), 4));
            inv.markDirty();
            player.getInventory().offerOrDrop(give);
            mem.fedAt = now;
            Helper.say(player, "You look hungry. Here, have some " + give.getName().getString() + ".");
            return;
        }
    }

    /** While following, pick up things lying around nearby (not ore on a tycoon line, not things you just dropped). */
    private static void tidyUp(MobEntity mob, SimpleInventory inv, ServerWorld world) {
        for (ItemEntity item : world.getEntitiesByClass(ItemEntity.class, mob.getBoundingBox().expand(3.5), e -> e.isAlive()
                && !e.cannotPickup() && e.getItemAge() > 100 && !e.getCommandTags().contains("helpermod_ore"))) {
            ItemStack rest = inv.addStack(item.getStack().copy());
            if (rest.getCount() == item.getStack().getCount()) continue; // no room
            if (rest.isEmpty()) item.discard();
            else item.setStack(rest);
            inv.markDirty();
            world.playSound(null, mob.getBlockPos(), SoundEvents.ENTITY_ITEM_PICKUP, SoundCategory.NEUTRAL, 0.3f, 1.4f);
        }
    }
}
