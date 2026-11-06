package com.helpermod;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import java.util.function.Supplier;
import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.tags.ItemTags;
import net.minecraft.world.Container;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/**
 * The tycoon's economy update: everything has a coin value, and Tycoon Droppers turn what you put in them into
 * something worth more.
 *
 * Selling: /helper tycoon sell opens a Sell Box; whatever you leave in it is sold when you close it. /helper tycoon
 * price tells you what the item in your hand is worth.
 *
 * Factory droppers: put items in a Tycoon Dropper (right-click it, or feed it with a hopper). Instead of ore it then
 * drops what its recipe makes, e.g. 3 wheat -> bread, wheat + sugar + egg -> cake, apple + 8 gold -> golden apple.
 * The product rides the line like ore (upgraders still multiply it) and is worth more than its inputs. Items with no
 * recipe ride the line as they are and sell for their own value.
 */
final class TycoonFactory {
    private TycoonFactory() {}

    // ---------------------------------------------------------------------------------------
    // What things are worth (in tenths of a coin, per item)
    // ---------------------------------------------------------------------------------------

    private static final Map<Item, Integer> VALUE = new IdentityHashMap<>();

    private static void v(Item item, int tenths) {
        VALUE.put(item, tenths);
    }

    static {
        // Ores and metals
        v(Items.COAL, 20); v(Items.CHARCOAL, 15); v(Items.RAW_COPPER, 20); v(Items.COPPER_INGOT, 30);
        v(Items.RAW_IRON, 50); v(Items.IRON_INGOT, 80); v(Items.IRON_NUGGET, 9); v(Items.IRON_BLOCK, 800);
        v(Items.RAW_GOLD, 80); v(Items.GOLD_INGOT, 120); v(Items.GOLD_NUGGET, 13); v(Items.GOLD_BLOCK, 1300);
        v(Items.DIAMOND, 500); v(Items.DIAMOND_BLOCK, 5000); v(Items.EMERALD, 400); v(Items.EMERALD_BLOCK, 4000);
        v(Items.LAPIS_LAZULI, 30); v(Items.REDSTONE, 10); v(Items.QUARTZ, 30); v(Items.AMETHYST_SHARD, 20);
        v(Items.ANCIENT_DEBRIS, 1000); v(Items.NETHERITE_SCRAP, 1300); v(Items.NETHERITE_INGOT, 6000);
        // Farm goods (not food on their own)
        v(Items.WHEAT, 3); v(Items.SUGAR_CANE, 2); v(Items.SUGAR, 4); v(Items.EGG, 5); v(Items.COCOA_BEANS, 5);
        v(Items.PUMPKIN, 10); v(Items.MELON, 20); v(Items.HAY_BLOCK, 30); v(Items.BOWL, 2);
        v(Items.RED_MUSHROOM, 4); v(Items.BROWN_MUSHROOM, 4); v(Items.MILK_BUCKET, 15);
        // Crafted goods that are worth more than their parts
        v(Items.BREAD, 80); v(Items.CAKE, 450); v(Items.PUMPKIN_PIE, 160); v(Items.COOKIE, 25);
        v(Items.GOLDEN_APPLE, 1500); v(Items.ENCHANTED_GOLDEN_APPLE, 20000); v(Items.GOLDEN_CARROT, 300);
        v(Items.MUSHROOM_STEW, 90); v(Items.BEETROOT_SOUP, 90);
        v(Items.PAPER, 4); v(Items.BOOK, 40); v(Items.BOOKSHELF, 200); v(Items.TNT, 180); v(Items.GLASS, 3);
        v(Items.BRICK, 4); v(Items.STONE, 1);
        // Mob drops
        v(Items.ROTTEN_FLESH, 2); v(Items.BONE, 5); v(Items.STRING, 5); v(Items.SPIDER_EYE, 8); v(Items.GUNPOWDER, 20);
        v(Items.SLIME_BALL, 15); v(Items.LEATHER, 15); v(Items.FEATHER, 3); v(Items.ENDER_PEARL, 100);
        v(Items.BLAZE_ROD, 80); v(Items.GHAST_TEAR, 150); v(Items.PHANTOM_MEMBRANE, 60); v(Items.NETHER_STAR, 50000);
        v(Items.EXPERIENCE_BOTTLE, 50); v(Items.HONEY_BOTTLE, 30); v(Items.ENCHANTED_BOOK, 200);
    }

    /** Worth of one item in tenths of a coin; 0 means it can't be sold (tools, armour, tycoon parts, special items). */
    static int tenths(ItemStack s) {
        if (s.isEmpty() || s.isDamageableItem() || s.getMaxStackSize() == 1 && !VALUE.containsKey(s.getItem())) return 0;
        if (Compat.hasTag(s) || s.has(DataComponents.CUSTOM_NAME)) return 0; // the mod's own items, renamed things
        Integer known = VALUE.get(s.getItem());
        if (known != null) return known;
        var food = s.get(DataComponents.FOOD);
        if (food != null) return Math.max(2, Math.round(food.nutrition() * 10 + food.saturation() * 5));
        if (s.getItem() instanceof BlockItem) return 1;
        return 3;
    }

    /** Whole coins a stack sells for (rounded down). */
    static long value(ItemStack s) {
        return (long) tenths(s) * s.getCount() / 10;
    }

    static String coins(double c) {
        return c >= 10 || c == Math.floor(c) ? String.valueOf(Math.round(c)) : String.format(java.util.Locale.US, "%.1f", c);
    }

    // ---------------------------------------------------------------------------------------
    // Recipes for factory droppers
    // ---------------------------------------------------------------------------------------

    record Input(Predicate<ItemStack> test, int count, String label) {}

    record Recipe(String name, List<Input> inputs, Supplier<ItemStack> output, double mult) {}

    record Made(ItemStack item, long value, Recipe recipe) {}

    private static Input in(Item item, int count) {
        return new Input(s -> s.is(item), count, count + " " + new ItemStack(item).getHoverName().getString());
    }

    private static Input inTag(net.minecraft.tags.TagKey<Item> tag, int count, String label) {
        return new Input(s -> s.is(tag), count, count + " " + label);
    }

    private static Recipe r(String name, Supplier<ItemStack> out, double mult, Input... inputs) {
        return new Recipe(name, List.of(inputs), out, mult);
    }

    private static Supplier<ItemStack> out(Item item, int count) {
        return () -> new ItemStack(item, count);
    }

    /** Tried in this order: the ones with more inputs first, so a dropper full of mixed farm goods makes the best thing it can. */
    static final List<Recipe> RECIPES = List.of(
            r("Golden Apple", out(Items.GOLDEN_APPLE, 1), 2.0, in(Items.APPLE, 1), in(Items.GOLD_INGOT, 8)),
            r("Golden Carrot", out(Items.GOLDEN_CARROT, 1), 2.0, in(Items.CARROT, 1), in(Items.GOLD_NUGGET, 8)),
            r("Cake", out(Items.CAKE, 1), 2.0, in(Items.WHEAT, 3), in(Items.SUGAR, 2), in(Items.EGG, 1)),
            r("Pumpkin Pie", out(Items.PUMPKIN_PIE, 1), 2.0, in(Items.PUMPKIN, 1), in(Items.SUGAR, 1), in(Items.EGG, 1)),
            r("8 Cookies", out(Items.COOKIE, 8), 2.0, in(Items.WHEAT, 2), in(Items.COCOA_BEANS, 1)),
            r("Mushroom Stew", out(Items.MUSHROOM_STEW, 1), 2.0, in(Items.BOWL, 1), in(Items.RED_MUSHROOM, 1), in(Items.BROWN_MUSHROOM, 1)),
            r("Beetroot Soup", out(Items.BEETROOT_SOUP, 1), 2.0, in(Items.BOWL, 1), in(Items.BEETROOT, 6)),
            r("TNT", out(Items.TNT, 1), 2.0, in(Items.GUNPOWDER, 5), inTag(ItemTags.SAND, 4, "Sand")),
            r("Bookshelf", out(Items.BOOKSHELF, 1), 2.0, in(Items.BOOK, 3), inTag(ItemTags.PLANKS, 6, "Planks")),
            r("Book", out(Items.BOOK, 1), 2.0, in(Items.PAPER, 3), in(Items.LEATHER, 1)),
            r("Diamond Block", out(Items.DIAMOND_BLOCK, 1), 1.25, in(Items.DIAMOND, 9)),
            r("Emerald Block", out(Items.EMERALD_BLOCK, 1), 1.25, in(Items.EMERALD, 9)),
            r("Gold Block", out(Items.GOLD_BLOCK, 1), 1.25, in(Items.GOLD_INGOT, 9)),
            r("Iron Block", out(Items.IRON_BLOCK, 1), 1.25, in(Items.IRON_INGOT, 9)),
            r("Bread", out(Items.BREAD, 1), 1.5, in(Items.WHEAT, 3)),
            r("3 Paper", out(Items.PAPER, 3), 1.5, in(Items.SUGAR_CANE, 3)),
            r("Steak", out(Items.COOKED_BEEF, 1), 1.5, in(Items.BEEF, 1)),
            r("Cooked Porkchop", out(Items.COOKED_PORKCHOP, 1), 1.5, in(Items.PORKCHOP, 1)),
            r("Cooked Chicken", out(Items.COOKED_CHICKEN, 1), 1.5, in(Items.CHICKEN, 1)),
            r("Cooked Mutton", out(Items.COOKED_MUTTON, 1), 1.5, in(Items.MUTTON, 1)),
            r("Cooked Rabbit", out(Items.COOKED_RABBIT, 1), 1.5, in(Items.RABBIT, 1)),
            r("Cooked Cod", out(Items.COOKED_COD, 1), 1.5, in(Items.COD, 1)),
            r("Cooked Salmon", out(Items.COOKED_SALMON, 1), 1.5, in(Items.SALMON, 1)),
            r("Baked Potato", out(Items.BAKED_POTATO, 1), 1.5, in(Items.POTATO, 1)),
            r("Dried Kelp", out(Items.DRIED_KELP, 1), 1.5, in(Items.KELP, 1)),
            r("Iron Ingot", out(Items.IRON_INGOT, 1), 1.5, in(Items.RAW_IRON, 1)),
            r("Gold Ingot", out(Items.GOLD_INGOT, 1), 1.5, in(Items.RAW_GOLD, 1)),
            r("Copper Ingot", out(Items.COPPER_INGOT, 1), 1.5, in(Items.RAW_COPPER, 1)),
            r("Netherite Scrap", out(Items.NETHERITE_SCRAP, 1), 1.5, in(Items.ANCIENT_DEBRIS, 1)),
            r("Glass", out(Items.GLASS, 1), 1.5, inTag(ItemTags.SAND, 1, "Sand")),
            r("Stone", out(Items.STONE, 1), 1.5, in(Items.COBBLESTONE, 1)),
            r("Brick", out(Items.BRICK, 1), 1.5, in(Items.CLAY_BALL, 1)),
            r("4 Planks", () -> ItemStack.EMPTY, 1.5, inTag(ItemTags.LOGS, 1, "Log")) // the log's own planks, see make()
    );

    /**
     * Use up what's in a Tycoon Dropper. The first recipe it has everything for makes its product; otherwise the
     * first sellable item goes out as it is. Null when there's nothing usable inside (then it drops ore as usual).
     */
    static Made make(Container box, int level) {
        for (Recipe rec : RECIPES) {
            if (!has(box, rec)) continue;
            long inTenths = 0;
            ItemStack logUsed = ItemStack.EMPTY;
            for (Input input : rec.inputs()) {
                int need = input.count();
                for (int i = 0; i < box.getContainerSize() && need > 0; i++) {
                    ItemStack s = box.getItem(i);
                    if (s.isEmpty() || !input.test().test(s)) continue;
                    int take = Math.min(need, s.getCount());
                    inTenths += (long) Math.max(1, tenths(s)) * take;
                    if (logUsed.isEmpty() && s.is(ItemTags.LOGS)) logUsed = s.copyWithCount(1);
                    s.shrink(take);
                    need -= take;
                }
            }
            box.setChanged();
            ItemStack product = rec.output().get();
            if (product.isEmpty()) product = planksFor(logUsed);
            if (product.isEmpty()) continue;
            long value = Math.max(value(product), Math.round(inTenths / 10.0 * rec.mult())) + level;
            return new Made(product, value, rec);
        }
        for (int i = 0; i < box.getContainerSize(); i++) { // no recipe: send it down the line to be sold as it is
            ItemStack s = box.getItem(i);
            if (s.isEmpty()) continue;
            ItemStack one = s.copyWithCount(1);
            int t = tenths(one);
            if (t <= 0) continue; // tools and the like stay in the dropper
            s.shrink(1);
            box.setChanged();
            return new Made(one, Math.max(1, Math.round(t / 10.0)) + level, null);
        }
        return null;
    }

    private static boolean has(Container box, Recipe rec) {
        for (Input input : rec.inputs()) {
            int found = 0;
            for (int i = 0; i < box.getContainerSize(); i++) {
                ItemStack s = box.getItem(i);
                if (!s.isEmpty() && input.test().test(s)) found += s.getCount();
            }
            if (found < input.count()) return false;
        }
        return true;
    }

    /** Oak log -> oak planks and so on, by name; any log at all still gives oak planks. */
    private static ItemStack planksFor(ItemStack log) {
        if (log.isEmpty()) return ItemStack.EMPTY;
        var key = net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(log.getItem());
        String wood = key.getPath().replace("stripped_", "").replace("_log", "").replace("_wood", "")
                .replace("_stem", "").replace("_hyphae", "");
        var planks = net.minecraft.resources.Identifier.fromNamespaceAndPath(key.getNamespace(), wood + "_planks");
        Item item = net.minecraft.core.registries.BuiltInRegistries.ITEM.containsKey(planks)
                ? net.minecraft.core.registries.BuiltInRegistries.ITEM.getValue(planks) : Items.OAK_PLANKS;
        return new ItemStack(item, 4);
    }

    static void recipes(ServerPlayer player) {
        Helper.say(player, "Factory droppers: put items in a Tycoon Dropper (right-click it or feed it with a hopper) and it "
                + "drops what they make instead of ore. Products are worth more than their parts, and upgraders still multiply them.");
        for (Recipe rec : RECIPES) {
            StringBuilder sb = new StringBuilder();
            for (Input input : rec.inputs()) {
                if (sb.length() > 0) sb.append(" + ");
                sb.append(input.label());
            }
            player.sendSystemMessage(Component.literal(sb + "  ->  " + rec.name()).withStyle(ChatFormatting.GRAY));
        }
        player.sendSystemMessage(Component.literal("Anything else you put in rides the line as it is and sells for its own value.")
                .withStyle(ChatFormatting.GRAY));
    }

    // ---------------------------------------------------------------------------------------
    // Selling
    // ---------------------------------------------------------------------------------------

    static void price(ServerPlayer player) {
        ItemStack held = player.getMainHandItem();
        if (held.isEmpty()) {
            Helper.say(player, "Hold something and run /helper tycoon price to see what it sells for.");
            return;
        }
        int t = tenths(held);
        if (t <= 0) {
            Helper.say(player, held.getHoverName().getString() + " can't be sold (tools, armour and special items are kept safe).");
            return;
        }
        double bonus = Tycoon.rebirthBonus(Tycoon.Data.get(player.level().getServer()).rebirths(player.getUUID()));
        Helper.say(player, held.getHoverName().getString() + " sells for " + coins(t / 10.0 * bonus) + " coins each, "
                + coins(t / 10.0 * bonus * held.getCount()) + " for the " + held.getCount() + " you're holding. "
                + "Put it in a Tycoon Dropper to make it worth more.");
    }

    /** /helper tycoon sell: a Sell Box. What's left in it when you close it is sold; anything unsellable comes back. */
    static void openSell(ServerPlayer player) {
        SimpleContainer box = new SimpleContainer(27);
        player.openMenu(new SimpleMenuProvider((syncId, inv, p) -> new SellBox(syncId, inv, box, player),
                Component.literal("Sell Box: put items in, close to sell")));
    }

    static final class SellBox extends ChestMenu {
        private final SimpleContainer box;
        private final ServerPlayer owner;

        SellBox(int syncId, Inventory inv, SimpleContainer box, ServerPlayer owner) {
            super(MenuType.GENERIC_9x3, syncId, inv, box, 3);
            this.box = box;
            this.owner = owner;
        }

        @Override
        public void removed(Player p) {
            super.removed(p);
            long tenthsTotal = 0;
            Map<String, Integer> sold = new LinkedHashMap<>();
            List<ItemStack> back = new ArrayList<>();
            for (int i = 0; i < box.getContainerSize(); i++) {
                ItemStack s = box.getItem(i);
                if (s.isEmpty()) continue;
                int t = tenths(s);
                if (t <= 0) {
                    back.add(s.copy());
                } else {
                    tenthsTotal += (long) t * s.getCount();
                    sold.merge(s.getHoverName().getString(), s.getCount(), Integer::sum);
                }
                box.setItem(i, ItemStack.EMPTY);
            }
            for (ItemStack s : back) owner.getInventory().placeItemBackInInventory(s, net.minecraft.util.Prediction.SERVER_ONLY);
            if (sold.isEmpty()) {
                if (!back.isEmpty()) Helper.say(owner, "Those can't be sold, so I gave them back.");
                return;
            }
            Tycoon.Data data = Tycoon.Data.get(owner.level().getServer());
            long coins = Math.max(1, Math.round(tenthsTotal / 10.0 * Tycoon.rebirthBonus(data.rebirths(owner.getUUID()))));
            data.add(owner.getUUID(), coins);
            TycoonSidebar.earned(owner.level().getServer(), owner.getUUID(), coins);
            Compat.notifySound(owner, SoundEvents.EXPERIENCE_ORB_PICKUP, SoundSource.PLAYERS, 0.8f, 1.4f);
            StringBuilder sb = new StringBuilder();
            sold.forEach((name, n) -> {
                if (sb.length() > 0) sb.append(", ");
                sb.append(n).append(' ').append(name);
            });
            Helper.say(owner, "Sold " + sb + " for " + coins + " coins. You have " + data.coins(owner.getUUID()) + " now."
                    + (back.isEmpty() ? "" : " Some things can't be sold, so I gave them back."));
        }
    }
}
