package com.helpermod;

import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.enchantment.EnchantmentHelper;
import net.minecraft.enchantment.Enchantments;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

/** Tool choice and block-breaking timing, following the same rules players use. */
public final class Mining {
    private Mining() {}

    /** Inventory slot of the best tool, or -1 for bare hands. */
    public static int bestToolSlot(SimpleInventory inv, BlockState state, World world, BlockPos pos,
                                   boolean isTarget, boolean preferSilk) {
        int bestSlot = -1;
        double bestScore = scoreFor(ItemStack.EMPTY, state, world, pos, isTarget, preferSilk);
        for (int i = 0; i < inv.size(); i++) {
            ItemStack stack = inv.getStack(i);
            if (stack.isEmpty() || !isUsableTool(stack)) continue;
            if (stack.getMiningSpeedMultiplier(state) <= 1f && !stack.isSuitableFor(state)) continue;
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
        return !stack.isDamageable() || stack.getMaxDamage() - stack.getDamage() > 1;
    }

    private static double scoreFor(ItemStack tool, BlockState state, World world, BlockPos pos,
                                   boolean isTarget, boolean preferSilk) {
        if (!canHarvest(tool, state)) return 1_000_000; // no drops: only acceptable as a last resort
        double score = breakTicks(tool, state, world, pos);
        if (isTarget && !tool.isEmpty()) {
            boolean silk = EnchantmentHelper.getLevel(Enchantments.SILK_TOUCH, tool) > 0;
            if (silk != preferSilk) score += 10_000;
            score -= EnchantmentHelper.getLevel(Enchantments.FORTUNE, tool) * 20;
        }
        return score;
    }

    public static boolean canHarvest(ItemStack tool, BlockState state) {
        return !state.isToolRequired() || (!tool.isEmpty() && tool.isSuitableFor(state));
    }

    /** Ticks it takes to break the block, using the vanilla player formula. -1 if unbreakable. */
    public static int breakTicks(ItemStack tool, BlockState state, World world, BlockPos pos) {
        float hardness = state.getHardness(world, pos);
        if (hardness < 0) return -1;
        if (hardness == 0) return 1;
        float speed = tool.isEmpty() ? 1f : tool.getMiningSpeedMultiplier(state);
        if (speed > 1f) {
            int efficiency = EnchantmentHelper.getLevel(Enchantments.EFFICIENCY, tool);
            if (efficiency > 0) speed += efficiency * efficiency + 1;
        }
        float delta = speed / hardness / (canHarvest(tool, state) ? 30f : 100f);
        if (delta >= 1f) return 1;
        return (int) Math.ceil(1f / delta);
    }

    /** A friendly description of the tool a block needs, e.g. "an iron pickaxe (or better)". */
    public static String requiredToolName(BlockState state) {
        String type = "tool";
        if (state.isIn(BlockTags.PICKAXE_MINEABLE)) type = "pickaxe";
        else if (state.isIn(BlockTags.AXE_MINEABLE)) type = "axe";
        else if (state.isIn(BlockTags.SHOVEL_MINEABLE)) type = "shovel";
        else if (state.isIn(BlockTags.HOE_MINEABLE)) type = "hoe";
        if (state.isIn(BlockTags.NEEDS_DIAMOND_TOOL)) return "a diamond " + type + " (or better)";
        if (state.isIn(BlockTags.NEEDS_IRON_TOOL)) return "an iron " + type + " (or better)";
        if (state.isIn(BlockTags.NEEDS_STONE_TOOL)) return "a stone " + type + " (or better)";
        return "a " + type;
    }

    public static String blockName(Block block) {
        return block.getName().getString();
    }
}
