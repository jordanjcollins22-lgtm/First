package com.helpermod;

import net.minecraft.block.entity.BarrelBlockEntity;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.ArmorItem;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.item.RangedWeaponItem;
import net.minecraft.item.ShieldItem;
import net.minecraft.item.ToolItem;
import net.minecraft.item.TridentItem;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
import net.minecraft.nbt.NbtString;
import net.minecraft.recipe.CraftingRecipe;
import net.minecraft.recipe.Ingredient;
import net.minecraft.recipe.RecipeType;
import net.minecraft.registry.Registries;
import net.minecraft.screen.GenericContainerScreenHandler;
import net.minecraft.screen.ScreenHandlerType;
import net.minecraft.screen.SimpleNamedScreenHandlerFactory;
import net.minecraft.screen.slot.Slot;
import net.minecraft.screen.slot.SlotActionType;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.PersistentState;

import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Helper Storage: a barrel named "Helper Storage" that opens your own storage with no size limit.
 *
 * Every Helper Storage barrel opens the same personal storage (like an ender chest), so breaking one
 * never loses anything. The screen is a normal 6-row chest screen drawn by the server, so players
 * don't need to install anything: five rows show your items (sorted, in pages, with category tabs
 * and a search), and the bottom row has the controls. Crafting mode lists everything you can make
 * from what's stored and crafts it straight from storage.
 */
public final class Storage {
    private Storage() {}

    public static final String NAME = "Helper Storage";
    private static final int VIEW = 45;
    private static final NumberFormat NUM = NumberFormat.getIntegerInstance(Locale.US);

    // ---------------------------------------------------------------------------------------
    // The block
    // ---------------------------------------------------------------------------------------

    public static boolean isStorageItem(ItemStack stack) {
        return stack.isOf(Items.BARREL) && stack.hasCustomName() && stack.getName().getString().equals(NAME);
    }

    public static ItemStack storageItem() {
        ItemStack stack = new ItemStack(Items.BARREL);
        stack.setCustomName(Text.literal(NAME).styled(s -> s.withItalic(false)).formatted(Formatting.AQUA));
        return stack;
    }

    public static boolean isStorageBlock(ServerWorld world, BlockPos pos) {
        BlockEntity be = world.getBlockEntity(pos);
        return be instanceof BarrelBlockEntity barrel && barrel.hasCustomName()
                && barrel.getCustomName().getString().equals(NAME);
    }

    /** /helper storage: turn the barrel in your hand into a Helper Storage. */
    public static void craft(ServerPlayerEntity player) {
        ItemStack held = player.getMainHandStack();
        if (!held.isOf(Items.BARREL) || isStorageItem(held)) {
            Helper.say(player, "Hold a barrel in your hand and run /helper storage again. "
                    + "I'll turn it into a Helper Storage (or rename a barrel to \"" + NAME + "\" in an anvil).");
            return;
        }
        if (!player.isCreative()) held.decrement(1);
        player.getInventory().offerOrDrop(storageItem());
        Helper.say(player, "Here's your Helper Storage! Place it and right-click it. It holds as much as you want, "
                + "and every Helper Storage you place opens the same storage, so make as many as you like.");
    }

    public static void open(ServerPlayerEntity player) {
        player.openHandledScreen(new SimpleNamedScreenHandlerFactory(
                (syncId, inv, p) -> new Menu(syncId, inv, player), Text.literal(NAME)));
    }

    /** /helper storage find <text>: only show stored items whose name contains the text. */
    public static void find(ServerPlayerEntity player, String text) {
        SEARCH.put(player.getUuid(), text.trim().toLowerCase(Locale.ROOT));
        Data data = Data.get(player.getServer());
        long total = 0;
        int kinds = 0;
        for (Stored s : data.of(player.getUuid())) {
            if (s.name().toLowerCase(Locale.ROOT).contains(SEARCH.get(player.getUuid()))) {
                kinds++;
                total += s.count;
            }
        }
        Helper.say(player, kinds == 0 ? "Nothing in your storage matches \"" + text.trim() + "\"."
                : "Found " + NUM.format(total) + " items (" + kinds + " kinds) matching \"" + text.trim()
                + "\". Open a Helper Storage to see them.");
    }

    private static final Map<UUID, String> SEARCH = new HashMap<>();

    public static void reset() {
        SEARCH.clear();
    }

    // ---------------------------------------------------------------------------------------
    // What's stored
    // ---------------------------------------------------------------------------------------

    /** One kind of item (same item and same NBT) and how many of it are stored. */
    static final class Stored {
        final ItemStack template; // count 1
        long count;

        Stored(ItemStack template, long count) {
            this.template = template;
            this.count = count;
        }

        String name() {
            return template.getName().getString();
        }
    }

    enum Tab {
        ALL("Everything", Items.CHEST), BLOCKS("Blocks", Items.GRASS_BLOCK), GEAR("Tools and armor", Items.IRON_PICKAXE),
        FOOD("Food", Items.BREAD), ITEMS("Other items", Items.STICK);

        final String label;
        final Item icon;

        Tab(String label, Item icon) {
            this.label = label;
            this.icon = icon;
        }

        boolean shows(ItemStack s) {
            Item i = s.getItem();
            boolean gear = i instanceof ToolItem || i instanceof ArmorItem || i instanceof RangedWeaponItem
                    || i instanceof ShieldItem || i instanceof TridentItem;
            return switch (this) {
                case ALL -> true;
                case BLOCKS -> i instanceof BlockItem;
                case GEAR -> gear;
                case FOOD -> i.isFood();
                case ITEMS -> !(i instanceof BlockItem) && !gear && !i.isFood();
            };
        }
    }

    enum Sort {
        NAME("name"), COUNT("amount"), MOD("mod");

        final String label;

        Sort(String label) {
            this.label = label;
        }

        Comparator<Stored> comparator() {
            Comparator<Stored> byName = Comparator.comparing(s -> s.name().toLowerCase(Locale.ROOT));
            return switch (this) {
                case NAME -> byName;
                case COUNT -> Comparator.<Stored>comparingLong(s -> -s.count).thenComparing(byName);
                case MOD -> Comparator.<Stored, String>comparing(
                        s -> Registries.ITEM.getId(s.template.getItem()).getNamespace()).thenComparing(byName);
            };
        }
    }

    /** Everyone's storage, saved with the world. */
    public static final class Data extends PersistentState {
        private static final String ID = "helpermod_storage";
        private final Map<UUID, List<Stored>> stores = new HashMap<>();

        public static Data get(MinecraftServer server) {
            return server.getOverworld().getPersistentStateManager().getOrCreate(Data::fromNbt, Data::new, ID);
        }

        List<Stored> of(UUID player) {
            return stores.computeIfAbsent(player, k -> new ArrayList<>());
        }

        Stored find(UUID player, ItemStack stack) {
            for (Stored s : of(player)) if (ItemStack.canCombine(s.template, stack)) return s;
            return null;
        }

        void add(UUID player, ItemStack stack) {
            if (stack.isEmpty()) return;
            Stored s = find(player, stack);
            if (s == null) of(player).add(new Stored(stack.copyWithCount(1), stack.getCount()));
            else s.count += stack.getCount();
            markDirty();
        }

        /** Take up to {@code amount}; returns what was taken (maybe empty). */
        ItemStack take(UUID player, Stored s, int amount) {
            int n = (int) Math.min(amount, s.count);
            if (n <= 0) return ItemStack.EMPTY;
            s.count -= n;
            if (s.count <= 0) of(player).remove(s);
            markDirty();
            return s.template.copyWithCount(n);
        }

        private static Data fromNbt(NbtCompound nbt) {
            Data data = new Data();
            NbtList players = nbt.getList("players", NbtElement.COMPOUND_TYPE);
            for (int i = 0; i < players.size(); i++) {
                NbtCompound p = players.getCompound(i);
                List<Stored> list = new ArrayList<>();
                NbtList items = p.getList("items", NbtElement.COMPOUND_TYPE);
                for (int k = 0; k < items.size(); k++) {
                    NbtCompound t = items.getCompound(k);
                    ItemStack stack = ItemStack.fromNbt(t.getCompound("item"));
                    long count = t.getLong("count");
                    if (!stack.isEmpty() && count > 0) list.add(new Stored(stack.copyWithCount(1), count));
                }
                data.stores.put(p.getUuid("owner"), list);
            }
            return data;
        }

        @Override
        public NbtCompound writeNbt(NbtCompound nbt) {
            NbtList players = new NbtList();
            stores.forEach((owner, list) -> {
                if (list.isEmpty()) return;
                NbtCompound p = new NbtCompound();
                p.putUuid("owner", owner);
                NbtList items = new NbtList();
                for (Stored s : list) {
                    NbtCompound t = new NbtCompound();
                    t.put("item", s.template.writeNbt(new NbtCompound()));
                    t.putLong("count", s.count);
                    items.add(t);
                }
                p.put("items", items);
                players.add(p);
            });
            nbt.put("players", players);
            return nbt;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Crafting from storage
    // ---------------------------------------------------------------------------------------

    /** A recipe and the stored items it would use, one per ingredient. */
    private record Plan(CraftingRecipe recipe, ItemStack output, List<Stored> uses) {}

    /** Work out which stored items a recipe would use, or null if storage doesn't have enough. */
    private static List<Stored> plan(CraftingRecipe recipe, Map<Item, List<Stored>> byItem) {
        Map<Stored, Long> used = new IdentityHashMap<>();
        List<Stored> uses = new ArrayList<>();
        for (Ingredient ing : recipe.getIngredients()) {
            if (ing.isEmpty()) continue;
            Stored pick = null;
            for (ItemStack option : ing.getMatchingStacks()) {
                List<Stored> candidates = byItem.get(option.getItem());
                if (candidates == null) continue;
                for (Stored s : candidates) {
                    if (s.count - used.getOrDefault(s, 0L) > 0 && ing.test(s.template)) {
                        pick = s;
                        break;
                    }
                }
                if (pick != null) break;
            }
            if (pick == null) return null;
            used.merge(pick, 1L, Long::sum);
            uses.add(pick);
        }
        return uses.isEmpty() ? null : uses;
    }

    private static List<Plan> craftables(ServerWorld world, List<Stored> stored) {
        Map<Item, List<Stored>> byItem = new HashMap<>();
        for (Stored s : stored) byItem.computeIfAbsent(s.template.getItem(), k -> new ArrayList<>()).add(s);
        List<Plan> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (CraftingRecipe recipe : world.getRecipeManager().listAllOfType(RecipeType.CRAFTING)) {
            if (recipe.isIgnoredInRecipeBook()) continue; // fireworks, banners and other special recipes
            ItemStack output = recipe.getOutput(world.getRegistryManager());
            if (output.isEmpty()) continue;
            String key = Registries.ITEM.getId(output.getItem()) + "|" + output.getNbt();
            if (seen.contains(key)) continue;
            List<Stored> uses = plan(recipe, byItem);
            if (uses == null) continue;
            seen.add(key);
            out.add(new Plan(recipe, output, uses));
        }
        out.sort(Comparator.comparing(p -> p.output().getName().getString().toLowerCase(Locale.ROOT)));
        return out;
    }

    // ---------------------------------------------------------------------------------------
    // The screen
    // ---------------------------------------------------------------------------------------

    static final class Menu extends GenericContainerScreenHandler {
        private final ServerPlayerEntity player;
        private final SimpleInventory view;
        private final List<Stored> shown = new ArrayList<>();
        private final List<Plan> shownPlans = new ArrayList<>();
        private List<Plan> plans = List.of();
        private int page;
        private Tab tab = Tab.ALL;
        private Sort sort = Sort.NAME;
        private boolean crafting;

        Menu(int syncId, PlayerInventory inv, ServerPlayerEntity player) {
            this(syncId, inv, player, new SimpleInventory(54));
        }

        private Menu(int syncId, PlayerInventory inv, ServerPlayerEntity player, SimpleInventory view) {
            super(ScreenHandlerType.GENERIC_9X6, syncId, inv, view, 6);
            this.player = player;
            this.view = view;
            refresh();
        }

        private Data data() {
            return Data.get(player.getServer());
        }

        private UUID owner() {
            return player.getUuid();
        }

        private List<Stored> visible() {
            String search = SEARCH.getOrDefault(owner(), "");
            List<Stored> list = new ArrayList<>();
            for (Stored s : data().of(owner())) {
                if (!tab.shows(s.template)) continue;
                if (!search.isEmpty() && !s.name().toLowerCase(Locale.ROOT).contains(search)) continue;
                list.add(s);
            }
            list.sort(sort.comparator());
            return list;
        }

        private void refresh() {
            view.clear();
            shown.clear();
            shownPlans.clear();
            int total;
            if (crafting) {
                total = plans.size();
                int pages = Math.max(1, (total + VIEW - 1) / VIEW);
                page = Math.min(page, pages - 1);
                for (int i = 0; i < VIEW && page * VIEW + i < total; i++) {
                    Plan p = plans.get(page * VIEW + i);
                    shownPlans.add(p);
                    ItemStack icon = p.output().copy();
                    lore(icon, Text.literal("Click: make " + p.output().getCount()).formatted(Formatting.GREEN),
                            Text.literal("Shift-click: make as many as fit in a stack").formatted(Formatting.GREEN),
                            Text.literal("Uses: " + ingredientsText(p)).formatted(Formatting.GRAY));
                    view.setStack(i, icon);
                }
            } else {
                List<Stored> list = visible();
                total = list.size();
                int pages = Math.max(1, (total + VIEW - 1) / VIEW);
                page = Math.min(page, pages - 1);
                for (int i = 0; i < VIEW && page * VIEW + i < total; i++) {
                    Stored s = list.get(page * VIEW + i);
                    shown.add(s);
                    ItemStack icon = s.template.copyWithCount((int) Math.max(1, Math.min(s.count, s.template.getMaxCount())));
                    lore(icon, Text.literal("Stored: " + NUM.format(s.count)).formatted(Formatting.AQUA),
                            Text.literal("Click: take a stack. Right-click: take half. Shift-click: to your inventory")
                                    .formatted(Formatting.GRAY));
                    view.setStack(i, icon);
                }
            }
            int pages = Math.max(1, (total + VIEW - 1) / VIEW);
            long items = 0;
            for (Stored s : data().of(owner())) items += s.count;
            String search = SEARCH.getOrDefault(owner(), "");
            ItemStack filler = button(Items.GRAY_STAINED_GLASS_PANE, " ");
            for (int i = VIEW; i < 54; i++) view.setStack(i, filler.copy());
            view.setStack(45, button(Items.ARROW, "Previous page"));
            view.setStack(46, button(tab.icon, "Showing: " + tab.label, "Click to change what's shown"));
            view.setStack(47, button(Items.HOPPER, "Sorted by " + sort.label, "Click to sort another way"));
            view.setStack(48, button(Items.SPYGLASS, search.isEmpty() ? "Search" : "Searching: " + search,
                    search.isEmpty() ? "Type /helper storage find <name> to search" : "Click to clear the search"));
            view.setStack(49, button(Items.BOOK, "Page " + (page + 1) + " of " + pages,
                    NUM.format(items) + " items stored (" + data().of(owner()).size() + " kinds)"));
            view.setStack(50, button(Items.CHEST, "Put my items in",
                    "Moves everything from your inventory (not your hotbar or armor) into storage"));
            view.setStack(51, button(Items.CRAFTING_TABLE, crafting ? "Back to storage" : "Crafting",
                    crafting ? "Click to see your items again" : "See everything you can make from what's stored"));
            view.setStack(53, button(Items.ARROW, "Next page"));
            sendContentUpdates();
        }

        private static String ingredientsText(Plan p) {
            Map<Stored, Integer> counts = new IdentityHashMap<>();
            for (Stored s : p.uses()) counts.merge(s, 1, Integer::sum);
            List<String> parts = new ArrayList<>();
            counts.forEach((s, n) -> parts.add(n + " " + s.name()));
            return String.join(", ", parts);
        }

        @Override
        public boolean canInsertIntoSlot(ItemStack stack, Slot slot) {
            return slot.inventory != view && super.canInsertIntoSlot(stack, slot);
        }

        @Override
        public void onSlotClick(int slotIndex, int button, SlotActionType action, PlayerEntity p) {
            if (slotIndex < 0 || slotIndex >= 54) {
                super.onSlotClick(slotIndex, button, action, p);
                return;
            }
            if (action == SlotActionType.QUICK_CRAFT || action == SlotActionType.PICKUP_ALL
                    || action == SlotActionType.CLONE || action == SlotActionType.THROW) {
                refresh();
                return;
            }
            boolean shift = action == SlotActionType.QUICK_MOVE;
            if (slotIndex >= VIEW) control(slotIndex);
            else if (crafting) craft(slotIndex, shift);
            else click(slotIndex, button, shift, action);
            refresh();
        }

        @Override
        public ItemStack quickMove(PlayerEntity p, int index) {
            if (index < 54) return ItemStack.EMPTY;
            Slot slot = slots.get(index);
            if (slot.hasStack()) {
                data().add(owner(), slot.getStack().copy());
                slot.setStack(ItemStack.EMPTY);
                refresh();
            }
            return ItemStack.EMPTY;
        }

        private void click(int index, int button, boolean shift, SlotActionType action) {
            ItemStack cursor = getCursorStack();
            if (!cursor.isEmpty() && action != SlotActionType.SWAP) {
                // Holding something: put it in (unless it's the same thing and we're topping up the stack).
                Stored here = index < shown.size() ? shown.get(index) : null;
                if (here == null || !ItemStack.canCombine(here.template, cursor) || cursor.getCount() >= cursor.getMaxCount()) {
                    data().add(owner(), cursor.copy());
                    setCursorStack(ItemStack.EMPTY);
                    return;
                }
                int want = button == 1 ? 1 : cursor.getMaxCount() - cursor.getCount();
                ItemStack got = data().take(owner(), here, want);
                cursor.increment(got.getCount());
                return;
            }
            if (index >= shown.size()) return;
            Stored s = shown.get(index);
            int max = s.template.getMaxCount();
            if (action == SlotActionType.SWAP) { // number key: straight to that hotbar slot if it's empty
                if (button >= 0 && button < 9 && player.getInventory().getStack(button).isEmpty()) {
                    player.getInventory().setStack(button, data().take(owner(), s, max));
                }
                return;
            }
            if (shift) {
                ItemStack got = data().take(owner(), s, max);
                player.getInventory().insertStack(got);
                if (!got.isEmpty()) data().add(owner(), got); // inventory full: keep the rest stored
                return;
            }
            int amount = button == 1 ? (int) Math.max(1, (Math.min(s.count, max) + 1) / 2) : max;
            setCursorStack(data().take(owner(), s, amount));
        }

        private void craft(int index, boolean shift) {
            if (index >= shownPlans.size()) return;
            Plan plan = shownPlans.get(index);
            ServerWorld world = player.getServerWorld();
            int made = 0;
            int limit = shift ? Math.max(1, plan.output().getMaxCount() / Math.max(1, plan.output().getCount())) : 1;
            for (int n = 0; n < limit; n++) {
                Map<Item, List<Stored>> byItem = new HashMap<>();
                for (Stored s : data().of(owner())) byItem.computeIfAbsent(s.template.getItem(), k -> new ArrayList<>()).add(s);
                List<Stored> uses = plan(plan.recipe(), byItem);
                if (uses == null) break;
                for (Stored s : uses) {
                    ItemStack used = data().take(owner(), s, 1);
                    Item remainder = used.getItem().getRecipeRemainder();
                    if (remainder != null) data().add(owner(), new ItemStack(remainder)); // e.g. empty buckets
                }
                ItemStack result = plan.recipe().getOutput(world.getRegistryManager()).copy();
                result.onCraft(world, player, result.getCount());
                player.getInventory().offerOrDrop(result);
                made++;
            }
            if (made > 0) {
                world.playSound(null, player.getBlockPos(), SoundEvents.BLOCK_WOOD_HIT, SoundCategory.BLOCKS, 0.6f, 1.2f);
                plans = craftables(world, data().of(owner()));
            }
        }

        private void control(int index) {
            switch (index) {
                case 45 -> page = Math.max(0, page - 1);
                case 53 -> page++;
                case 46 -> {
                    tab = Tab.values()[(tab.ordinal() + 1) % Tab.values().length];
                    page = 0;
                }
                case 47 -> sort = Sort.values()[(sort.ordinal() + 1) % Sort.values().length];
                case 48 -> {
                    SEARCH.remove(owner());
                    page = 0;
                }
                case 50 -> {
                    PlayerInventory inv = player.getInventory();
                    for (int i = 9; i < 36; i++) {
                        ItemStack s = inv.getStack(i);
                        if (s.isEmpty()) continue;
                        data().add(owner(), s.copy());
                        inv.setStack(i, ItemStack.EMPTY);
                    }
                }
                case 51 -> {
                    crafting = !crafting;
                    page = 0;
                    if (crafting) plans = craftables(player.getServerWorld(), data().of(owner()));
                }
                default -> {}
            }
        }

        private static ItemStack button(Item item, String name, String... lines) {
            ItemStack stack = new ItemStack(item);
            stack.setCustomName(Text.literal(name).styled(s -> s.withItalic(false)).formatted(Formatting.YELLOW));
            Text[] texts = new Text[lines.length];
            for (int i = 0; i < lines.length; i++) texts[i] = Text.literal(lines[i]).formatted(Formatting.GRAY);
            lore(stack, texts);
            return stack;
        }

        private static void lore(ItemStack stack, Text... lines) {
            if (lines.length == 0) return;
            NbtCompound display = stack.getOrCreateSubNbt("display");
            NbtList lore = new NbtList();
            for (Text t : lines) {
                lore.add(NbtString.of(Text.Serializer.toJson(t.copy().styled(s -> s.withItalic(false)))));
            }
            display.put("Lore", lore);
        }
    }
}
