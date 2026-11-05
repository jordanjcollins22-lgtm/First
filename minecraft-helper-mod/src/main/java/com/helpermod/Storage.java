package com.helpermod;

import net.minecraft.block.entity.BarrelBlockEntity;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.util.collection.DefaultedList;
import net.minecraft.screen.ScreenHandlerContext;
import net.minecraft.screen.AnvilScreenHandler;
import net.minecraft.inventory.CraftingInventory;
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
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Helper Storage: a barrel named "Helper Storage" that opens your own storage with no size limit.
 *
 * Every Helper Storage barrel opens the same personal storage (like an ender chest), so breaking one
 * never loses anything. The screen is a normal 6-row chest screen drawn by the server, so players
 * don't need to install anything: five rows show your items (sorted, in pages, with category tabs
 * and a search box), and the bottom row has the controls. The crafting grid is a 3x3 grid like a
 * crafting table's, with your stored items beside it, and shift-crafting tops the grid up from storage.
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
        LOOK.clear();
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
    // The screen
    // ---------------------------------------------------------------------------------------

    /** What each player last had open (tab, sort, crafting), so the screen comes back the same after a search. */
    private record Look(Tab tab, Sort sort, boolean crafting) {}

    private static final Map<UUID, Look> LOOK = new HashMap<>();

    private static void open(ServerPlayerEntity player, Look look) {
        LOOK.put(player.getUuid(), look);
        open(player);
    }

    /** Storage mode: 45 item slots. Crafting mode: a 3x3 grid and its result on the left, 20 item slots on the right. */
    private static final int[] ALL_ITEMS = new int[VIEW];
    private static final int[] CRAFT_ITEMS = new int[20];
    private static final int[] GRID = {9, 10, 11, 18, 19, 20, 27, 28, 29};
    private static final int RESULT = 22;

    static {
        for (int i = 0; i < VIEW; i++) ALL_ITEMS[i] = i;
        int k = 0;
        for (int row = 0; row < 5; row++) for (int col = 5; col < 9; col++) CRAFT_ITEMS[k++] = row * 9 + col;
    }

    static final class Menu extends GenericContainerScreenHandler {
        private final ServerPlayerEntity player;
        private final SimpleInventory view;
        private final CraftingInventory grid;
        private final List<Stored> shown = new ArrayList<>();
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
            this.grid = new CraftingInventory(this, 3, 3);
            Look look = LOOK.get(player.getUuid());
            if (look != null) {
                tab = look.tab();
                sort = look.sort();
                crafting = look.crafting();
            }
            refresh();
        }

        private Data data() {
            return Data.get(player.getServer());
        }

        private UUID owner() {
            return player.getUuid();
        }

        private void remember() {
            LOOK.put(owner(), new Look(tab, sort, crafting));
        }

        private int[] itemSlots() {
            return crafting ? CRAFT_ITEMS : ALL_ITEMS;
        }

        private int itemPos(int slot) {
            int[] slots = itemSlots();
            for (int i = 0; i < slots.length; i++) if (slots[i] == slot) return i;
            return -1;
        }

        private static int gridPos(int slot) {
            for (int i = 0; i < GRID.length; i++) if (GRID[i] == slot) return i;
            return -1;
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

        /** What the grid makes right now, or nothing. */
        private ItemStack result() {
            ServerWorld world = player.getServerWorld();
            return world.getRecipeManager().getFirstMatch(RecipeType.CRAFTING, grid, world)
                    .map(r -> r.craft(grid, world.getRegistryManager()))
                    .orElse(ItemStack.EMPTY);
        }

        private void refresh() {
            view.clear();
            shown.clear();
            List<Stored> list = visible();
            int[] slots = itemSlots();
            int per = slots.length;
            int total = list.size();
            int pages = Math.max(1, (total + per - 1) / per);
            page = Math.min(page, pages - 1);
            for (int i = 0; i < per && page * per + i < total; i++) {
                Stored s = list.get(page * per + i);
                shown.add(s);
                ItemStack icon = s.template.copyWithCount((int) Math.max(1, Math.min(s.count, s.template.getMaxCount())));
                lore(icon, Text.literal("Stored: " + NUM.format(s.count)).formatted(Formatting.AQUA),
                        Text.literal(crafting
                                ? "Click: pick up a stack, then click a grid square to put it in. Right-click: half"
                                : "Click: take a stack. Right-click: take half. Shift-click: to your inventory")
                                .formatted(Formatting.GRAY));
                view.setStack(slots[i], icon);
            }
            if (crafting) {
                ItemStack wall = button(Items.BLACK_STAINED_GLASS_PANE, " ");
                for (int row = 0; row < 5; row++) for (int col = 0; col < 5; col++) view.setStack(row * 9 + col, wall.copy());
                for (int i = 0; i < 9; i++) {
                    ItemStack g = grid.getStack(i);
                    view.setStack(GRID[i], g.isEmpty() ? ItemStack.EMPTY : g.copy());
                }
                ItemStack out = result();
                if (out.isEmpty()) {
                    view.setStack(RESULT, button(Items.BARRIER, "Nothing to make yet",
                            "Put items in the 3x3 grid like a crafting table"));
                } else {
                    ItemStack icon = out.copy();
                    lore(icon, Text.literal("Click: make it").formatted(Formatting.GREEN),
                            Text.literal("Shift-click: make as many as you can (refills from storage)").formatted(Formatting.GREEN));
                    view.setStack(RESULT, icon);
                }
                view.setStack(3, button(Items.LAVA_BUCKET, "Clear the grid", "Puts the grid's items back in storage"));
                view.setStack(21, button(Items.ARROW, "→"));
            }
            long items = 0;
            for (Stored s : data().of(owner())) items += s.count;
            String search = SEARCH.getOrDefault(owner(), "");
            ItemStack filler = button(Items.GRAY_STAINED_GLASS_PANE, " ");
            for (int i = VIEW; i < 54; i++) view.setStack(i, filler.copy());
            view.setStack(45, button(Items.ARROW, "Previous page"));
            view.setStack(46, button(tab.icon, "Showing: " + tab.label, "Click to change what's shown"));
            view.setStack(47, button(Items.HOPPER, "Sorted by " + sort.label, "Click to sort another way"));
            view.setStack(48, button(Items.SPYGLASS, search.isEmpty() ? "Search" : "Searching: " + search,
                    search.isEmpty() ? "Click to type what you're looking for"
                            : "Click to search for something else. Right-click to clear the search"));
            view.setStack(49, button(Items.BOOK, "Page " + (page + 1) + " of " + pages,
                    NUM.format(items) + " items stored (" + data().of(owner()).size() + " kinds)"));
            view.setStack(50, button(Items.CHEST, "Put my items in",
                    "Moves everything from your inventory (not your hotbar or armor) into storage"));
            view.setStack(51, button(Items.CRAFTING_TABLE, crafting ? "Back to storage" : "Crafting grid",
                    crafting ? "Click to see all your items again" : "Craft with a 3x3 grid, using items straight from storage"));
            view.setStack(53, button(Items.ARROW, "Next page"));
            sendContentUpdates();
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
            if (slotIndex >= VIEW) control(slotIndex, button);
            else if (crafting && gridPos(slotIndex) >= 0) gridClick(gridPos(slotIndex), button, shift, action);
            else if (crafting && slotIndex == RESULT) craft(shift);
            else if (crafting && slotIndex == 3) clearGrid();
            else if (!crafting || itemPos(slotIndex) >= 0) click(itemPos(slotIndex), button, shift, action);
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

        @Override
        public void onClosed(PlayerEntity p) {
            super.onClosed(p);
            clearGrid(); // whatever was left in the grid goes back into storage
        }

        private void click(int pos, int button, boolean shift, SlotActionType action) {
            ItemStack cursor = getCursorStack();
            if (!cursor.isEmpty() && action != SlotActionType.SWAP) {
                // Holding something: put it in (unless it's the same thing and we're topping up the stack).
                Stored here = pos >= 0 && pos < shown.size() ? shown.get(pos) : null;
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
            if (pos < 0 || pos >= shown.size()) return;
            Stored s = shown.get(pos);
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

        /** The 3x3 grid works like a crafting table's: place, pick up, split and swap stacks. */
        private void gridClick(int g, int button, boolean shift, SlotActionType action) {
            if (action == SlotActionType.SWAP) return;
            ItemStack in = grid.getStack(g).copy();
            ItemStack cursor = getCursorStack();
            if (shift) { // back into storage
                if (!in.isEmpty()) data().add(owner(), in);
                grid.setStack(g, ItemStack.EMPTY);
                return;
            }
            if (cursor.isEmpty()) {
                if (in.isEmpty()) return;
                int take = button == 1 ? (in.getCount() + 1) / 2 : in.getCount();
                setCursorStack(in.split(take));
                grid.setStack(g, in.isEmpty() ? ItemStack.EMPTY : in);
                return;
            }
            if (in.isEmpty()) {
                grid.setStack(g, cursor.split(button == 1 ? 1 : cursor.getCount()));
                return;
            }
            if (ItemStack.canCombine(in, cursor)) {
                int put = Math.min(in.getMaxCount() - in.getCount(), button == 1 ? 1 : cursor.getCount());
                in.increment(put);
                cursor.decrement(put);
                grid.setStack(g, in);
                return;
            }
            grid.setStack(g, cursor.copy()); // different items: swap
            setCursorStack(in);
        }

        private void clearGrid() {
            for (int i = 0; i < 9; i++) {
                ItemStack s = grid.getStack(i);
                if (!s.isEmpty()) data().add(owner(), s.copy());
                grid.setStack(i, ItemStack.EMPTY);
            }
        }

        /** Make what the grid shows. Shift: keep going, topping the grid up from storage each time. */
        private void craft(boolean shift) {
            ServerWorld world = player.getServerWorld();
            int made = 0;
            int limit = shift ? 64 : 1;
            for (int n = 0; n < limit; n++) {
                Optional<CraftingRecipe> recipe = world.getRecipeManager().getFirstMatch(RecipeType.CRAFTING, grid, world);
                if (recipe.isEmpty()) break;
                ItemStack result = recipe.get().craft(grid, world.getRegistryManager());
                if (result.isEmpty()) break;
                ItemStack cursor = getCursorStack();
                if (!shift && !cursor.isEmpty() && !(ItemStack.canCombine(cursor, result)
                        && cursor.getCount() + result.getCount() <= cursor.getMaxCount())) break;
                DefaultedList<ItemStack> leftovers = world.getRecipeManager().getRemainingStacks(RecipeType.CRAFTING, grid, world);
                for (int i = 0; i < 9; i++) {
                    ItemStack before = grid.getStack(i).copy();
                    if (before.isEmpty()) continue;
                    grid.removeStack(i, 1);
                    if (grid.getStack(i).isEmpty()) { // ran out: top up from storage
                        Stored more = data().find(owner(), before);
                        grid.setStack(i, more == null ? ItemStack.EMPTY : data().take(owner(), more, 1));
                    }
                    ItemStack left = leftovers.get(i);
                    if (!left.isEmpty()) data().add(owner(), left.copy()); // e.g. empty buckets
                }
                result.onCraft(world, player, result.getCount());
                if (shift) {
                    player.getInventory().insertStack(result);
                    if (!result.isEmpty()) data().add(owner(), result); // inventory full: into storage
                } else if (cursor.isEmpty()) {
                    setCursorStack(result);
                } else {
                    cursor.increment(result.getCount());
                }
                made++;
            }
            if (made > 0) world.playSound(null, player.getBlockPos(), SoundEvents.BLOCK_WOOD_HIT, SoundCategory.BLOCKS, 0.6f, 1.2f);
        }

        private void control(int index, int button) {
            switch (index) {
                case 45 -> page = Math.max(0, page - 1);
                case 53 -> page++;
                case 46 -> {
                    tab = Tab.values()[(tab.ordinal() + 1) % Tab.values().length];
                    page = 0;
                }
                case 47 -> sort = Sort.values()[(sort.ordinal() + 1) % Sort.values().length];
                case 48 -> {
                    page = 0;
                    if (button == 1) SEARCH.remove(owner());
                    else {
                        Look look = new Look(tab, sort, crafting);
                        String current = SEARCH.getOrDefault(owner(), "");
                        player.getServer().execute(() -> player.openHandledScreen(new SimpleNamedScreenHandlerFactory(
                                (syncId, inv, p) -> new Search(syncId, inv, player, look, current),
                                Text.literal("Search your storage"))));
                    }
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
                    if (crafting) clearGrid();
                    crafting = !crafting;
                    page = 0;
                }
                default -> {}
            }
            remember();
        }

        static ItemStack button(Item item, String name, String... lines) {
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

    /**
     * Typing a search: an anvil screen whose name box is the search box. Type what you want, then click
     * the result (or press Escape) and your storage opens showing only what matches.
     */
    static final class Search extends AnvilScreenHandler {
        private final ServerPlayerEntity player;
        private final Look look;
        private String text;
        private boolean done;

        Search(int syncId, PlayerInventory inv, ServerPlayerEntity player, Look look, String current) {
            super(syncId, inv, ScreenHandlerContext.EMPTY);
            this.player = player;
            this.look = look;
            this.text = current;
            ItemStack paper = new ItemStack(Items.PAPER);
            paper.setCustomName(Text.literal(current));
            input.setStack(0, paper);
            showResult();
        }

        @Override
        public boolean setNewItemName(String name) {
            text = name == null ? "" : name;
            showResult();
            return true;
        }

        @Override
        public void updateResult() {
            showResult();
        }

        private void showResult() {
            if (player == null) return; // still being set up
            String t = text == null ? "" : text.trim();
            output.setStack(0, Menu.button(Items.SPYGLASS, t.isEmpty() ? "Show everything" : "Search for: " + t,
                    "Click here (or press Escape) to see the results"));
            sendContentUpdates();
        }

        @Override
        public void onSlotClick(int slotIndex, int button, SlotActionType action, PlayerEntity p) {
            if (slotIndex == 2) {
                finish();
                return;
            }
            if (slotIndex == 0 || slotIndex == 1) { // the paper stays put
                sendContentUpdates();
                return;
            }
            super.onSlotClick(slotIndex, button, action, p);
        }

        @Override
        public ItemStack quickMove(PlayerEntity p, int index) {
            return ItemStack.EMPTY;
        }

        @Override
        public void onClosed(PlayerEntity p) {
            input.clear();
            output.clear();
            super.onClosed(p);
            if (!done && !player.isDisconnected()) player.getServer().execute(this::finish);
        }

        private void finish() {
            if (done) return;
            done = true;
            String t = text == null ? "" : text.trim().toLowerCase(Locale.ROOT);
            if (t.isEmpty()) SEARCH.remove(player.getUuid());
            else SEARCH.put(player.getUuid(), t);
            input.clear();
            output.clear();
            open(player, look);
        }
    }
}
