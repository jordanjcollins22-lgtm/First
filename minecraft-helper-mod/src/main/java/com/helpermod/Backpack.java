package com.helpermod;

import java.util.List;
import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.ChatFormatting;
import net.minecraft.core.NonNullList;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.DyedItemColor;
import net.minecraft.world.item.component.ItemContainerContents;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;

/**
 * Backpacks: hold one and right-click to open it, anywhere. A Backpack has 3 rows (27 slots), a Big Backpack 6 rows
 * (54 slots). What's inside is kept on the item itself, so it goes wherever the backpack goes (drop it, store it,
 * give it to a friend). Dye it in a crafting grid like leather armour. Backpacks can't go inside backpacks.
 * Get one from the tycoon shop or craft it: 8 leather around a chest (Backpack), or leather, 2 chests and a diamond
 * (Big Backpack).
 */
final class Backpack {
    private Backpack() {}

    static final String TAG = "HelperBackpack";
    static final int BROWN = 0x8B5A2B;
    static final long PRICE_SMALL = 300, PRICE_BIG = 1500;

    static ItemStack item(int rows) {
        ItemStack s = new ItemStack(Items.LEATHER_HORSE_ARMOR);
        CompoundTag t = new CompoundTag();
        t.putInt("rows", rows);
        Compat.editTag(s, c -> c.put(TAG, t));
        s.set(DataComponents.DYED_COLOR, new DyedItemColor(BROWN));
        s.set(DataComponents.CUSTOM_NAME, Component.literal(rows >= 6 ? "Big Backpack" : "Backpack")
                .withStyle(st -> st.withItalic(false)).withStyle(ChatFormatting.GOLD));
        Compat.lore(s, List.of(
                Component.literal((rows * 9) + " slots. Right-click to open.").withStyle(st -> st.withItalic(false)).withStyle(ChatFormatting.GRAY),
                Component.literal("Your things stay inside when you drop or store it.").withStyle(st -> st.withItalic(false))
                        .withStyle(ChatFormatting.GRAY),
                Component.literal("Dye it in a crafting grid to change its colour.").withStyle(st -> st.withItalic(false))
                        .withStyle(ChatFormatting.GRAY)));
        return s;
    }

    /** 3 or 6 for a backpack, 0 for anything else. */
    static int rowsOf(ItemStack s) {
        if (s.isEmpty() || !Compat.hasTag(s) || !Compat.tag(s).contains(TAG)) return 0;
        int rows = Compat.tag(s).getCompoundOrEmpty(TAG).getIntOr("rows", 3);
        return rows >= 6 ? 6 : 3;
    }

    static boolean is(ItemStack s) {
        return rowsOf(s) > 0;
    }

    // ---------------------------------------------------------------------------------------
    // Opening one
    // ---------------------------------------------------------------------------------------

    static InteractionResult onUseItem(Player p, Level w, InteractionHand hand) {
        if (!is(p.getItemInHand(hand))) return InteractionResult.PASS;
        if (!w.isClientSide() && p instanceof ServerPlayer player && !(p instanceof FakePlayer)) open(player, hand);
        return InteractionResult.SUCCESS;
    }

    /** Right-clicking a block or a horse with a backpack opens it too (never placed, never put on a horse). */
    static InteractionResult onUseBlock(Player p, Level w, InteractionHand hand, BlockHitResult hit) {
        if (!is(p.getItemInHand(hand)) || p.isShiftKeyDown()) return InteractionResult.PASS;
        return onUseItem(p, w, hand);
    }

    static InteractionResult onUseEntity(Player p, Level w, InteractionHand hand, Entity e, EntityHitResult hit) {
        return onUseItem(p, w, hand);
    }

    static void open(ServerPlayer player, InteractionHand hand) {
        ItemStack bag = player.getItemInHand(hand);
        int rows = rowsOf(bag);
        if (rows == 0) return;
        SimpleContainer box = new SimpleContainer(rows * 9);
        NonNullList<ItemStack> items = NonNullList.withSize(rows * 9, ItemStack.EMPTY);
        bag.getOrDefault(DataComponents.CONTAINER, ItemContainerContents.EMPTY).copyInto(items);
        for (int i = 0; i < items.size(); i++) box.setItem(i, items.get(i));
        int handSlot = hand == InteractionHand.MAIN_HAND ? player.getInventory().getSelectedSlot() : -1;
        Component title = bag.has(DataComponents.CUSTOM_NAME) ? bag.getHoverName() : Component.literal("Backpack");
        player.openMenu(new SimpleMenuProvider((syncId, inv, p) -> new Menu(syncId, inv, box, rows, player, hand, bag, handSlot), title));
        player.level().playSound(null, player.blockPosition(), SoundEvents.ARMOR_EQUIP_LEATHER.value(), SoundSource.PLAYERS, 0.8f, 1.1f);
    }

    static final class Menu extends ChestMenu {
        private final SimpleContainer box;
        private final ServerPlayer player;
        private final InteractionHand hand;
        private final ItemStack bag;
        private final int bagSlot; // the backpack's slot in this menu, or -1 when it's in the off hand

        Menu(int syncId, Inventory inv, SimpleContainer box, int rows, ServerPlayer player, InteractionHand hand, ItemStack bag, int hotbar) {
            super(rows >= 6 ? MenuType.GENERIC_9x6 : MenuType.GENERIC_9x3, syncId, inv, box, rows);
            this.box = box;
            this.player = player;
            this.hand = hand;
            this.bag = bag;
            this.bagSlot = hotbar < 0 ? -1 : rows * 9 + 27 + hotbar; // 27 main slots, then the hotbar
        }

        @Override
        public void clicked(int slot, int button, ContainerInput action, Player p) {
            // The open backpack stays where it is: it can't be picked up, swapped, thrown or moved while open.
            if (bagSlot >= 0 && slot == bagSlot) return;
            if (action == ContainerInput.SWAP && (hand == InteractionHand.MAIN_HAND ? button == player.getInventory().getSelectedSlot() : button == 40)) return;
            super.clicked(slot, button, action, p);
            kickOutBackpacks();
            save();
        }

        @Override
        public ItemStack quickMoveStack(Player p, int slot) {
            if (bagSlot >= 0 && slot == bagSlot) return ItemStack.EMPTY;
            ItemStack out = super.quickMoveStack(p, slot);
            kickOutBackpacks();
            save();
            return out;
        }

        /** Backpacks can't go inside backpacks: any that got in go back to the player. */
        private void kickOutBackpacks() {
            boolean told = false;
            for (int i = 0; i < box.getContainerSize(); i++) {
                ItemStack s = box.getItem(i);
                if (!is(s)) continue;
                box.setItem(i, ItemStack.EMPTY);
                player.getInventory().placeItemBackInInventory(s, net.minecraft.util.Prediction.SERVER_ONLY);
                if (!told) player.sendOverlayMessage(Component.literal("A backpack can't go inside a backpack.").withStyle(ChatFormatting.YELLOW));
                told = true;
            }
        }

        /** Writes what's inside back onto the backpack item. */
        private void save() {
            if (bag.isEmpty()) { // the backpack itself is gone: hand the things back instead of losing them
                for (int i = 0; i < box.getContainerSize(); i++) {
                    ItemStack s = box.removeItemNoUpdate(i);
                    if (!s.isEmpty()) player.getInventory().placeItemBackInInventory(s, net.minecraft.util.Prediction.SERVER_ONLY);
                }
                return;
            }
            NonNullList<ItemStack> items = NonNullList.withSize(box.getContainerSize(), ItemStack.EMPTY);
            for (int i = 0; i < items.size(); i++) items.set(i, box.getItem(i).copy());
            bag.set(DataComponents.CONTAINER, ItemContainerContents.fromItems(items));
        }

        @Override
        public boolean stillValid(Player p) {
            return p.isAlive() && p.getItemInHand(hand) == bag;
        }

        @Override
        public void removed(Player p) {
            kickOutBackpacks();
            save();
            super.removed(p);
            player.level().playSound(null, player.blockPosition(), SoundEvents.ARMOR_EQUIP_LEATHER.value(), SoundSource.PLAYERS, 0.6f, 0.9f);
        }
    }
}
