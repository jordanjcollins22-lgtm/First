package com.helpermod;

import net.minecraft.core.BlockPos;
import net.minecraft.tags.BlockTags;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;

/** Tool choice and block-breaking timing, following the same rules players use. */
public final class Mining {
    private Mining() {}

    /** Inventory slot of the best tool, or -1 for bare hands. */
    public static int bestToolSlot(SimpleContainer inv, BlockState state, Level world, BlockPos pos,
                                   boolean isTarget, boolean preferSilk) {
        int bestSlot = -1;
        double bestScore = scoreFor(ItemStack.EMPTY, state, world, pos, isTarget, preferSilk);
        for (int i = 0; i < inv.getContainerSize(); i++) {
            ItemStack stack = inv.getItem(i);
            if (stack.isEmpty() || !isUsableTool(stack)) continue;
            if (stack.getDestroySpeed(state) <= 1f && !stack.isCorrectToolForDrops(state)) continue;
            double score = scoreFor(stack, state, world, pos, isTarget, preferSilk);
            if (score < bestScore) {
                bestScore = score;
                bestSlot = i;
            }
        }
        return bestSlot;
    }

    /** Won't use a tool that is one hit from breaking, so players never lose their gear. */
    public static boolean isUsableTool(ItemStack stack) {
        return !stack.isDamageableItem() || stack.getMaxDamage() - stack.getDamageValue() > 1;
    }

    private static double scoreFor(ItemStack tool, BlockState state, Level world, BlockPos pos,
                                   boolean isTarget, boolean preferSilk) {
        if (!canHarvest(tool, state)) return 1_000_000; // no drops: only acceptable as a last resort
        double score = breakTicks(tool, state, world, pos);
        if (isTarget && !tool.isEmpty()) {
            boolean silk = EnchantmentHelper.getItemEnchantmentLevel(Enchantments.SILK_TOUCH, tool) > 0;
            if (silk != preferSilk) score += 10_000;
            score -= EnchantmentHelper.getItemEnchantmentLevel(Enchantments.BLOCK_FORTUNE, tool) * 20;
        }
        return score;
    }

    public static boolean canHarvest(ItemStack tool, BlockState state) {
        return !state.requiresCorrectToolForDrops() || (!tool.isEmpty() && tool.isCorrectToolForDrops(state));
    }

    /** Ticks it takes to break the block, using the vanilla player formula. -1 if unbreakable. */
    public static int breakTicks(ItemStack tool, BlockState state, Level world, BlockPos pos) {
        float hardness = state.getDestroySpeed(world, pos);
        if (hardness < 0) return -1;
        if (hardness == 0) return 1;
        float speed = tool.isEmpty() ? 1f : tool.getDestroySpeed(state);
        if (speed > 1f) {
            int efficiency = EnchantmentHelper.getItemEnchantmentLevel(Enchantments.BLOCK_EFFICIENCY, tool);
            if (efficiency > 0) speed += efficiency * efficiency + 1;
        }
        float delta = speed / hardness / (canHarvest(tool, state) ? 30f : 100f);
        if (delta >= 1f) return 1;
        return (int) Math.ceil(1f / delta);
    }

    /** A friendly description of the tool a block needs, e.g. "an iron pickaxe (or better)". */
    public static String requiredToolName(BlockState state) {
        String type = "tool";
        if (state.is(BlockTags.MINEABLE_WITH_PICKAXE)) type = "pickaxe";
        else if (state.is(BlockTags.MINEABLE_WITH_AXE)) type = "axe";
        else if (state.is(BlockTags.MINEABLE_WITH_SHOVEL)) type = "shovel";
        else if (state.is(BlockTags.MINEABLE_WITH_HOE)) type = "hoe";
        if (state.is(BlockTags.NEEDS_DIAMOND_TOOL)) return "a diamond " + type + " (or better)";
        if (state.is(BlockTags.NEEDS_IRON_TOOL)) return "an iron " + type + " (or better)";
        if (state.is(BlockTags.NEEDS_STONE_TOOL)) return "a stone " + type + " (or better)";
        return "a " + type;
    }

    public static String blockName(Block block) {
        return block.getName().getString();
    }
}
