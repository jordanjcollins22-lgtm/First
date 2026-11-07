package com.helpermod;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;

/**
 * Hammers: pickaxes that mine a 3x3 square at once, flat against the face you hit (so a wall, a floor or a
 * ceiling). The extra blocks only break if the hammer could mine them normally and they aren't much harder
 * than the one you hit, and each one wears the hammer down like a normal block. Sneak to mine just one block.
 * Iron, Diamond and Netherite Hammers come from the tycoon shop; Iron and Diamond can be crafted from 3 blocks
 * of the metal on top of 2 sticks.
 */
final class Hammer {
    private Hammer() {}

    static final String TAG = "HelperHammer";
    static final long PRICE_IRON = 600, PRICE_DIAMOND = 3500, PRICE_NETHERITE = 80_000;

    static ItemStack item(String metal) {
        Item base = switch (metal) {
            case "netherite" -> Items.NETHERITE_PICKAXE;
            case "diamond" -> Items.DIAMOND_PICKAXE;
            default -> Items.IRON_PICKAXE;
        };
        ItemStack s = new ItemStack(base);
        CompoundTag t = new CompoundTag();
        t.putString("metal", metal);
        Compat.editTag(s, c -> c.put(TAG, t));
        String name = Character.toUpperCase(metal.charAt(0)) + metal.substring(1) + " Hammer";
        s.set(DataComponents.CUSTOM_NAME, Component.literal(name).withStyle(st -> st.withItalic(false)).withStyle(ChatFormatting.GOLD));
        Compat.lore(s, List.of(
                Component.literal("Mines a 3x3 square at once.").withStyle(st -> st.withItalic(false)).withStyle(ChatFormatting.GRAY),
                Component.literal("Sneak to mine just one block.").withStyle(st -> st.withItalic(false)).withStyle(ChatFormatting.GRAY)));
        return s;
    }

    static boolean is(ItemStack s) {
        return !s.isEmpty() && Compat.hasTag(s) && Compat.tag(s).contains(TAG);
    }

    // ---------------------------------------------------------------------------------------
    // Mining
    // ---------------------------------------------------------------------------------------

    /** The face each player last hit, so the square lies flat against it. */
    private static final Map<UUID, Direction> FACE = new HashMap<>();
    private static boolean busy; // the extra blocks don't each start their own 3x3

    static InteractionResult onAttackBlock(Player p, Level w, InteractionHand hand, BlockPos pos, Direction face) {
        if (!w.isClientSide() && face != null) FACE.put(p.getUUID(), face);
        return InteractionResult.PASS;
    }

    static void afterBreak(Level w, Player p, BlockPos pos, BlockState state, BlockEntity be) {
        if (busy || w.isClientSide() || !(p instanceof ServerPlayer player) || player.isShiftKeyDown()) return;
        ItemStack tool = player.getMainHandItem();
        if (!is(tool) || !tool.isCorrectToolForDrops(state)) return;
        Direction face = FACE.get(player.getUUID());
        if (face == null) face = Math.abs(player.getXRot()) > 60 ? Direction.UP : Direction.fromYRot(player.getYRot());
        float hardness = state.getDestroySpeed(w, pos);
        busy = true;
        try {
            for (int a = -1; a <= 1; a++) {
                for (int b = -1; b <= 1; b++) {
                    if (a == 0 && b == 0) continue;
                    BlockPos at = switch (face.getAxis()) {
                        case X -> pos.offset(0, a, b);
                        case Y -> pos.offset(a, 0, b);
                        default -> pos.offset(a, b, 0);
                    };
                    if (player.getMainHandItem() != tool || tool.isEmpty()) return; // it broke
                    BlockState there = w.getBlockState(at);
                    if (there.isAir()) continue;
                    float h = there.getDestroySpeed(w, at);
                    if (h < 0 || h > hardness + 3 || !tool.isCorrectToolForDrops(there)) continue; // no bedrock, no obsidian from stone
                    player.gameMode.destroyBlock(at); // drops, wear, protection and stats, just like mining it
                }
            }
        } finally {
            busy = false;
        }
    }

    static void forget(UUID id) {
        FACE.remove(id);
    }
}
