package com.helpermod;

import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.NonNullList;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.ContainerLevelAccess;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.inventory.TransientCraftingContainer;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.ProjectileWeaponItem;
import net.minecraft.world.item.ShieldItem;
import net.minecraft.world.item.TieredItem;
import net.minecraft.world.item.TridentItem;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraft.world.item.crafting.RecipeType;
import net.minecraft.world.level.block.entity.BarrelBlockEntity;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.saveddata.SavedData;
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
        return stack.is(Items.BARREL) && stack.hasCustomHoverName() && stack.getHoverName().getString().equals(NAME);
    }

    public static ItemStack storageItem() {
        ItemStack stack = new ItemStack(Items.BARREL);
        stack.setHoverName(Component.literal(NAME).withStyle(s -> s.withItalic(false)).withStyle(ChatFormatting.AQUA));
        return stack;
    }

    public static boolean isStorageBlock(ServerLevel world, BlockPos pos) {
        BlockEntity be = world.getBlockEntity(pos);
        return be instanceof BarrelBlockEntity barrel && barrel.hasCustomName()
                && barrel.getCustomName().getString().equals(NAME);
    }

    /** /helper storage: turn the barrel in your hand into a Helper Storage. */
    public static void craft(ServerPlayer player) {
        ItemStack held = player.getMainHandItem();
        if (!held.is(Items.BARREL) || isStorageItem(held)) {
            Helper.say(player, "Hold a barrel in your hand and run /helper storage again. "
                    + "I'll turn it into a Helper Storage (or rename a barrel to \"" + NAME + "\" in an anvil).");
            return;
        }
        if (!player.isCreative()) held.shrink(1);
        player.getInventory().placeItemBackInInventory(storageItem());
        Helper.say(player, "Here's your Helper Storage! Place it and right-click it. It holds as much as you want, "
                + "and every Helper Storage you place opens the same storage, so make as many as you like.");
    }

    public static void open(ServerPlayer player) {
        player.openMenu(new SimpleMenuProvider(
                (syncId, inv, p) -> new Menu(syncId, inv, player), Component.literal(NAME)));
    }

    /** /helper storage find <text>: only show stored items whose name contains the text. */
    public static void find(ServerPlayer player, String text) {
        SEARCH.put(player.getUUID(), text.trim().toLowerCase(Locale.ROOT));
        Data data = Data.get(player.level().getServer());
        long total = 0;
        int kinds = 0;
        for (Stored s : data.of(player.getUUID())) {
            if (s.name().toLowerCase(Locale.ROOT).contains(SEARCH.get(player.getUUID()))) {
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
            return template.getHoverName().getString();
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
            boolean gear = i instanceof TieredItem || i instanceof ArmorItem || i instanceof ProjectileWeaponItem
                    || i instanceof ShieldItem || i instanceof TridentItem;
            return switch (this) {
                case ALL -> true;
                case BLOCKS -> i instanceof BlockItem;
                case GEAR -> gear;
                case FOOD -> i.isEdible();
                case ITEMS -> !(i instanceof BlockItem) && !gear && !i.isEdible();
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
                        s -> BuiltInRegistries.ITEM.getKey(s.template.getItem()).getNamespace()).thenComparing(byName);
            };
        }
    }

    /** Everyone's storage, saved with the world. */
    public static final class Data extends SavedData {
        private static final String ID = "helpermod_storage";
        private final Map<UUID, List<Stored>> stores = new HashMap<>();

        public static Data get(MinecraftServer server) {
            return server.overworld().getDataStorage().computeIfAbsent(Data::fromNbt, Data::new, ID);
        }

        List<Stored> of(UUID player) {
            return stores.computeIfAbsent(player, k -> new ArrayList<>());
        }

        Stored find(UUID player, ItemStack stack) {
            for (Stored s : of(player)) if (ItemStack.isSameItemSameComponents(s.template, stack)) return s;
            return null;
        }

        void add(UUID player, ItemStack stack) {
            if (stack.isEmpty()) return;
            Stored s = find(player, stack);
            if (s == null) of(player).add(new Stored(stack.copyWithCount(1), stack.getCount()));
            else s.count += stack.getCount();
            setDirty();
        }

        /** Take up to {@code amount}; returns what was taken (maybe empty). */
        ItemStack take(UUID player, Stored s, int amount) {
            int n = (int) Math.min(amount, s.count);
            if (n <= 0) return ItemStack.EMPTY;
            s.count -= n;
            if (s.count <= 0) of(player).remove(s);
            setDirty();
            return s.template.copyWithCount(n);
        }

        private static Data fromNbt(CompoundTag nbt) {
            Data data = new Data();
            ListTag players = nbt.getListOrEmpty("players");
            for (int i = 0; i < players.size(); i++) {
                CompoundTag p = players.getCompoundOrEmpty(i);
                List<Stored> list = new ArrayList<>();
                ListTag items = p.getListOrEmpty("items");
                for (int k = 0; k < items.size(); k++) {
                    CompoundTag t = items.getCompoundOrEmpty(k);
                    ItemStack stack = ItemStack.of(t.getCompound("item"));
                    long count = t.getLongOr("count", 0L);
                    if (!stack.isEmpty() && count > 0) list.add(new Stored(stack.copyWithCount(1), count));
                }
                data.stores.put(p.getUUID("owner"), list);
            }
            return data;
        }

        @Override
        public CompoundTag save(CompoundTag nbt) {
            ListTag players = new ListTag();
            stores.forEach((owner, list) -> {
                if (list.isEmpty()) return;
                CompoundTag p = new CompoundTag();
                p.putUUID("owner", owner);
                ListTag items = new ListTag();
                for (Stored s : list) {
                    CompoundTag t = new CompoundTag();
                    t.put("item", s.template.save(new CompoundTag()));
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

    private static void open(ServerPlayer player, Look look) {
        LOOK.put(player.getUUID(), look);
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

    static final class Menu extends ChestMenu {
        private final ServerPlayer player;
        private final SimpleContainer view;
        private final TransientCraftingContainer grid;
        private final List<Stored> shown = new ArrayList<>();
        private int page;
        private Tab tab = Tab.ALL;
        private Sort sort = Sort.NAME;
        private boolean crafting;

        Menu(int syncId, Inventory inv, ServerPlayer player) {
            this(syncId, inv, player, new SimpleContainer(54));
        }

        private Menu(int syncId, Inventory inv, ServerPlayer player, SimpleContainer view) {
            super(MenuType.GENERIC_9x6, syncId, inv, view, 6);
            this.player = player;
            this.view = view;
            this.grid = new TransientCraftingContainer(this, 3, 3);
            Look look = LOOK.get(player.getUUID());
            if (look != null) {
                tab = look.tab();
                sort = look.sort();
                crafting = look.crafting();
            }
            refresh();
        }

        private Data data() {
            return Data.get(player.level().getServer());
        }

        private UUID owner() {
            return player.getUUID();
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
            ServerLevel world = player.level();
            return world.getRecipeManager().getRecipeFor(RecipeType.CRAFTING, grid, world)
                    .map(r -> r.assemble(grid, world.registryAccess()))
                    .orElse(ItemStack.EMPTY);
        }

        private void refresh() {
            view.clearContent();
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
                ItemStack icon = s.template.copyWithCount((int) Math.max(1, Math.min(s.count, s.template.getMaxStackSize())));
                lore(icon, Component.literal("Stored: " + NUM.format(s.count)).withStyle(ChatFormatting.AQUA),
                        Component.literal(crafting
                                ? "Click: pick up a stack, then click a grid square to put it in. Right-click: half"
                                : "Click: take a stack. Right-click: take half. Shift-click: to your inventory")
                                .withStyle(ChatFormatting.GRAY));
                view.setItem(slots[i], icon);
            }
            if (crafting) {
                ItemStack wall = button(Items.STAINED_GLASS_PANE.black(), " ");
                for (int row = 0; row < 5; row++) for (int col = 0; col < 5; col++) view.setItem(row * 9 + col, wall.copy());
                for (int i = 0; i < 9; i++) {
                    ItemStack g = grid.getItem(i);
                    view.setItem(GRID[i], g.isEmpty() ? ItemStack.EMPTY : g.copy());
                }
                ItemStack out = result();
                if (out.isEmpty()) {
                    view.setItem(RESULT, button(Items.BARRIER, "Nothing to make yet",
                            "Put items in the 3x3 grid like a crafting table"));
                } else {
                    ItemStack icon = out.copy();
                    lore(icon, Component.literal("Click: make it").withStyle(ChatFormatting.GREEN),
                            Component.literal("Shift-click: make as many as you can (refills from storage)").withStyle(ChatFormatting.GREEN));
                    view.setItem(RESULT, icon);
                }
                view.setItem(3, button(Items.LAVA_BUCKET, "Clear the grid", "Puts the grid's items back in storage"));
                view.setItem(21, button(Items.ARROW, "→"));
            }
            long items = 0;
            for (Stored s : data().of(owner())) items += s.count;
            String search = SEARCH.getOrDefault(owner(), "");
            ItemStack filler = button(Items.STAINED_GLASS_PANE.gray(), " ");
            for (int i = VIEW; i < 54; i++) view.setItem(i, filler.copy());
            view.setItem(45, button(Items.ARROW, "Previous page"));
            view.setItem(46, button(tab.icon, "Showing: " + tab.label, "Click to change what's shown"));
            view.setItem(47, button(Items.HOPPER, "Sorted by " + sort.label, "Click to sort another way"));
            view.setItem(48, button(Items.SPYGLASS, search.isEmpty() ? "Search" : "Searching: " + search,
                    search.isEmpty() ? "Click to type what you're looking for"
                            : "Click to search for something else. Right-click to clear the search"));
            view.setItem(49, button(Items.BOOK, "Page " + (page + 1) + " of " + pages,
                    NUM.format(items) + " items stored (" + data().of(owner()).size() + " kinds)"));
            view.setItem(50, button(Items.CHEST, "Put my items in",
                    "Moves everything from your inventory (not your hotbar or armor) into storage"));
            view.setItem(51, button(Items.CRAFTING_TABLE, crafting ? "Back to storage" : "Crafting grid",
                    crafting ? "Click to see all your items again" : "Craft with a 3x3 grid, using items straight from storage"));
            view.setItem(53, button(Items.ARROW, "Next page"));
            broadcastChanges();
        }

        @Override
        public boolean canTakeItemForPickAll(ItemStack stack, Slot slot) {
            return slot.container != view && super.canTakeItemForPickAll(stack, slot);
        }

        @Override
        public void clicked(int slotIndex, int button, ContainerInput action, Player p) {
            if (slotIndex < 0 || slotIndex >= 54) {
                super.clicked(slotIndex, button, action, p);
                return;
            }
            if (action == ContainerInput.QUICK_CRAFT || action == ContainerInput.PICKUP_ALL
                    || action == ContainerInput.CLONE || action == ContainerInput.THROW) {
                refresh();
                return;
            }
            boolean shift = action == ContainerInput.QUICK_MOVE;
            if (slotIndex >= VIEW) control(slotIndex, button);
            else if (crafting && gridPos(slotIndex) >= 0) gridClick(gridPos(slotIndex), button, shift, action);
            else if (crafting && slotIndex == RESULT) craft(shift);
            else if (crafting && slotIndex == 3) clearGrid();
            else if (!crafting || itemPos(slotIndex) >= 0) click(itemPos(slotIndex), button, shift, action);
            refresh();
        }

        @Override
        public ItemStack quickMoveStack(Player p, int index) {
            if (index < 54) return ItemStack.EMPTY;
            Slot slot = slots.get(index);
            if (slot.hasItem()) {
                data().add(owner(), slot.getItem().copy());
                slot.setByPlayer(ItemStack.EMPTY);
                refresh();
            }
            return ItemStack.EMPTY;
        }

        @Override
        public void removed(Player p) {
            super.removed(p);
            clearGrid(); // whatever was left in the grid goes back into storage
        }

        private void click(int pos, int button, boolean shift, ContainerInput action) {
            ItemStack cursor = getCarried();
            if (!cursor.isEmpty() && action != ContainerInput.SWAP) {
                // Holding something: put it in (unless it's the same thing and we're topping up the stack).
                Stored here = pos >= 0 && pos < shown.size() ? shown.get(pos) : null;
                if (here == null || !ItemStack.isSameItemSameComponents(here.template, cursor) || cursor.getCount() >= cursor.getMaxStackSize()) {
                    data().add(owner(), cursor.copy());
                    setCarried(ItemStack.EMPTY);
                    return;
                }
                int want = button == 1 ? 1 : cursor.getMaxStackSize() - cursor.getCount();
                ItemStack got = data().take(owner(), here, want);
                cursor.grow(got.getCount());
                return;
            }
            if (pos < 0 || pos >= shown.size()) return;
            Stored s = shown.get(pos);
            int max = s.template.getMaxStackSize();
            if (action == ContainerInput.SWAP) { // number key: straight to that hotbar slot if it's empty
                if (button >= 0 && button < 9 && player.getInventory().getItem(button).isEmpty()) {
                    player.getInventory().setItem(button, data().take(owner(), s, max));
                }
                return;
            }
            if (shift) {
                ItemStack got = data().take(owner(), s, max);
                player.getInventory().add(got);
                if (!got.isEmpty()) data().add(owner(), got); // inventory full: keep the rest stored
                return;
            }
            int amount = button == 1 ? (int) Math.max(1, (Math.min(s.count, max) + 1) / 2) : max;
            setCarried(data().take(owner(), s, amount));
        }

        /** The 3x3 grid works like a crafting table's: place, pick up, split and swap stacks. */
        private void gridClick(int g, int button, boolean shift, ContainerInput action) {
            if (action == ContainerInput.SWAP) return;
            ItemStack in = grid.getItem(g).copy();
            ItemStack cursor = getCarried();
            if (shift) { // back into storage
                if (!in.isEmpty()) data().add(owner(), in);
                grid.setItem(g, ItemStack.EMPTY);
                return;
            }
            if (cursor.isEmpty()) {
                if (in.isEmpty()) return;
                int take = button == 1 ? (in.getCount() + 1) / 2 : in.getCount();
                setCarried(in.split(take));
                grid.setItem(g, in.isEmpty() ? ItemStack.EMPTY : in);
                return;
            }
            if (in.isEmpty()) {
                grid.setItem(g, cursor.split(button == 1 ? 1 : cursor.getCount()));
                return;
            }
            if (ItemStack.isSameItemSameComponents(in, cursor)) {
                int put = Math.min(in.getMaxStackSize() - in.getCount(), button == 1 ? 1 : cursor.getCount());
                in.grow(put);
                cursor.shrink(put);
                grid.setItem(g, in);
                return;
            }
            grid.setItem(g, cursor.copy()); // different items: swap
            setCarried(in);
        }

        private void clearGrid() {
            for (int i = 0; i < 9; i++) {
                ItemStack s = grid.getItem(i);
                if (!s.isEmpty()) data().add(owner(), s.copy());
                grid.setItem(i, ItemStack.EMPTY);
            }
        }

        /** Make what the grid shows. Shift: keep going, topping the grid up from storage each time. */
        private void craft(boolean shift) {
            ServerLevel world = player.level();
            int made = 0;
            int limit = shift ? 64 : 1;
            for (int n = 0; n < limit; n++) {
                Optional<CraftingRecipe> recipe = world.getRecipeManager().getRecipeFor(RecipeType.CRAFTING, grid, world);
                if (recipe.isEmpty()) break;
                ItemStack result = recipe.get().assemble(grid, world.registryAccess());
                if (result.isEmpty()) break;
                ItemStack cursor = getCarried();
                if (!shift && !cursor.isEmpty() && !(ItemStack.isSameItemSameComponents(cursor, result)
                        && cursor.getCount() + result.getCount() <= cursor.getMaxStackSize())) break;
                NonNullList<ItemStack> leftovers = world.getRecipeManager().getRemainingItemsFor(RecipeType.CRAFTING, grid, world);
                for (int i = 0; i < 9; i++) {
                    ItemStack before = grid.getItem(i).copy();
                    if (before.isEmpty()) continue;
                    grid.removeItem(i, 1);
                    if (grid.getItem(i).isEmpty()) { // ran out: top up from storage
                        Stored more = data().find(owner(), before);
                        grid.setItem(i, more == null ? ItemStack.EMPTY : data().take(owner(), more, 1));
                    }
                    ItemStack left = leftovers.get(i);
                    if (!left.isEmpty()) data().add(owner(), left.copy()); // e.g. empty buckets
                }
                result.onCraftedBy(world, player, result.getCount());
                if (shift) {
                    player.getInventory().add(result);
                    if (!result.isEmpty()) data().add(owner(), result); // inventory full: into storage
                } else if (cursor.isEmpty()) {
                    setCarried(result);
                } else {
                    cursor.grow(result.getCount());
                }
                made++;
            }
            if (made > 0) world.playSound(null, player.blockPosition(), SoundEvents.WOOD_HIT, SoundSource.BLOCKS, 0.6f, 1.2f);
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
                        player.level().getServer().execute(() -> player.openMenu(new SimpleMenuProvider(
                                (syncId, inv, p) -> new Search(syncId, inv, player, look, current),
                                Component.literal("Search your storage"))));
                    }
                }
                case 50 -> {
                    Inventory inv = player.getInventory();
                    for (int i = 9; i < 36; i++) {
                        ItemStack s = inv.getItem(i);
                        if (s.isEmpty()) continue;
                        data().add(owner(), s.copy());
                        inv.setItem(i, ItemStack.EMPTY);
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
            stack.setHoverName(Component.literal(name).withStyle(s -> s.withItalic(false)).withStyle(ChatFormatting.YELLOW));
            Component[] texts = new Component[lines.length];
            for (int i = 0; i < lines.length; i++) texts[i] = Component.literal(lines[i]).withStyle(ChatFormatting.GRAY);
            lore(stack, texts);
            return stack;
        }

        private static void lore(ItemStack stack, Component... lines) {
            if (lines.length == 0) return;
            CompoundTag display = stack.getOrCreateTagElement("display");
            ListTag lore = new ListTag();
            for (Component t : lines) {
                lore.add(StringTag.valueOf(Component.Serializer.toJson(t.copy().withStyle(s -> s.withItalic(false)))));
            }
            display.put("Lore", lore);
        }
    }

    /**
     * Typing a search: an anvil screen whose name box is the search box. Type what you want, then click
     * the result (or press Escape) and your storage opens showing only what matches.
     */
    static final class Search extends AnvilMenu {
        private final ServerPlayer player;
        private final Look look;
        private String text;
        private boolean done;

        Search(int syncId, Inventory inv, ServerPlayer player, Look look, String current) {
            super(syncId, inv, ContainerLevelAccess.NULL);
            this.player = player;
            this.look = look;
            this.text = current;
            ItemStack paper = new ItemStack(Items.PAPER);
            paper.setHoverName(Component.literal(current));
            inputSlots.setItem(0, paper);
            showResult();
        }

        @Override
        public boolean setItemName(String name) {
            text = name == null ? "" : name;
            showResult();
            return true;
        }

        @Override
        public void createResult() {
            showResult();
        }

        private void showResult() {
            if (player == null) return; // still being set up
            String t = text == null ? "" : text.trim();
            resultSlots.setItem(0, Menu.button(Items.SPYGLASS, t.isEmpty() ? "Show everything" : "Search for: " + t,
                    "Click here (or press Escape) to see the results"));
            broadcastChanges();
        }

        @Override
        public void clicked(int slotIndex, int button, ContainerInput action, Player p) {
            if (slotIndex == 2) {
                finish();
                return;
            }
            if (slotIndex == 0 || slotIndex == 1) { // the paper stays put
                broadcastChanges();
                return;
            }
            super.clicked(slotIndex, button, action, p);
        }

        @Override
        public ItemStack quickMoveStack(Player p, int index) {
            return ItemStack.EMPTY;
        }

        @Override
        public void removed(Player p) {
            inputSlots.clearContent();
            resultSlots.clearContent();
            super.removed(p);
            if (!done && !player.hasDisconnected()) player.level().getServer().execute(this::finish);
        }

        private void finish() {
            if (done) return;
            done = true;
            String t = text == null ? "" : text.trim().toLowerCase(Locale.ROOT);
            if (t.isEmpty()) SEARCH.remove(player.getUUID());
            else SEARCH.put(player.getUUID(), t);
            inputSlots.clearContent();
            resultSlots.clearContent();
            open(player, look);
        }
    }
}
