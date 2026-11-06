package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.BlockHitResult;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The Mine Marker: a block the player places to say exactly where their helper digs its mine.
 * The staircase starts right next to it and goes down from there, and the helper always uses that
 * spot (in that dimension) until the marker is broken or another one is placed.
 */
final class MineMarker {
    private MineMarker() {}

    static final String NAME = "Helper Mine Marker";

    private record Pending(ResourceKey<Level> world, BlockPos pos, UUID player, int ticks) {}

    private static final List<Pending> PENDING = new ArrayList<>();

    static ItemStack item() {
        ItemStack stack = new ItemStack(Items.LODESTONE);
        stack.set(net.minecraft.core.component.DataComponents.CUSTOM_NAME, Component.literal(NAME).withStyle(ChatFormatting.AQUA).withStyle(s -> s.withItalic(false)));
        return stack;
    }

    static boolean isMarker(ItemStack stack) {
        return stack.is(Items.LODESTONE) && stack.has(net.minecraft.core.component.DataComponents.CUSTOM_NAME) && stack.getHoverName().getString().equals(NAME);
    }

    static void give(ServerPlayer player) {
        player.getInventory().placeItemBackInInventory(item(), net.minecraft.util.Prediction.SERVER_ONLY);
        Helper.say(player, "Here's a Mine Marker. Place it on open ground where you want my mine, away from your house, "
                + "and I'll dig my staircase down right next to it.");
    }

    static void reset() {
        PENDING.clear();
    }

    static InteractionResult onUseBlock(Player p, Level w, InteractionHand hand, BlockHitResult hit) {
        if (w.isClientSide() || !(p instanceof ServerPlayer player) || p instanceof FakePlayer) return InteractionResult.PASS;
        ItemStack stack = player.getItemInHand(hand);
        if (isMarker(stack)) {
            BlockPos pos = new BlockPlaceContext(player, hand, stack, hit).getClickedPos();
            PENDING.add(new Pending(w.dimension(), pos.immutable(), player.getUUID(), 0));
        }
        return InteractionResult.PASS;
    }

    static void tick(MinecraftServer server) {
        for (int i = PENDING.size() - 1; i >= 0; i--) {
            Pending pd = PENDING.get(i);
            ServerLevel world = server.getLevel(pd.world());
            if (world != null && world.getBlockState(pd.pos()).is(Blocks.LODESTONE)) {
                mark(server, world, pd.pos(), pd.player());
                PENDING.remove(i);
            } else if (pd.ticks() > 5) {
                PENDING.remove(i);
            } else {
                PENDING.set(i, new Pending(pd.world(), pd.pos(), pd.player(), pd.ticks() + 1));
            }
        }
        // A marker that was broken stops counting.
        if (server.getTickCount() % 100 != 0) return;
        HelperData data = HelperData.get(server);
        for (ServerPlayer player : server.getPlayerList().getPlayers()) {
            HelperData.Entry e = data.get(player.getUUID());
            if (e == null || e.mineMarker == null || e.mineDim == null) continue;
            ServerLevel world = player.level().getServer().getLevel(ResourceKey.create(net.minecraft.core.registries.Registries.DIMENSION,
                    net.minecraft.resources.Identifier.parse(e.mineDim)));
            if (world == null || !world.hasChunkAt(e.mineMarker)) continue;
            if (!world.getBlockState(e.mineMarker).is(Blocks.LODESTONE)) {
                e.mineMarker = null;
                e.mineOrigin = null;
                data.setDirty();
                Helper.say(player, "Your Mine Marker is gone, so I'll pick a spot for my mine myself next time.");
            }
        }
    }

    private static void mark(MinecraftServer server, ServerLevel world, BlockPos pos, UUID owner) {
        HelperData data = HelperData.get(server);
        HelperData.Entry e = data.getOrCreate(owner);
        boolean same = e.mineOrigin != null && world.dimension().identifier().toString().equals(e.mineDim)
                && e.mineOrigin.equals(pos.above());
        e.mineMarker = pos.immutable();
        e.mineOrigin = pos.above().immutable(); // the staircase starts beside the marker; the marker itself stays
        e.mineDim = world.dimension().identifier().toString();
        if (!same) e.mineDepth = 0;
        data.setDirty();
        ServerPlayer player = server.getPlayerList().getPlayer(owner);
        if (player != null) Helper.say(player, "Got it! From now on I'll dig my mine here, at " + pos.toShortString()
                + ". Break the marker to let me choose again.");
    }
}
