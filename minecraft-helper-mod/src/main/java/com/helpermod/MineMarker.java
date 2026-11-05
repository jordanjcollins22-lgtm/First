package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.block.Blocks;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.ItemPlacementContext;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.RegistryKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Formatting;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

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

    private record Pending(RegistryKey<World> world, BlockPos pos, UUID player, int ticks) {}

    private static final List<Pending> PENDING = new ArrayList<>();

    static ItemStack item() {
        ItemStack stack = new ItemStack(Items.LODESTONE);
        stack.setCustomName(Text.literal(NAME).formatted(Formatting.AQUA).styled(s -> s.withItalic(false)));
        return stack;
    }

    static boolean isMarker(ItemStack stack) {
        return stack.isOf(Items.LODESTONE) && stack.hasCustomName() && stack.getName().getString().equals(NAME);
    }

    static void give(ServerPlayerEntity player) {
        player.getInventory().offerOrDrop(item());
        Helper.say(player, "Here's a Mine Marker. Place it on open ground where you want my mine, away from your house, "
                + "and I'll dig my staircase down right next to it.");
    }

    static void reset() {
        PENDING.clear();
    }

    static ActionResult onUseBlock(PlayerEntity p, World w, Hand hand, BlockHitResult hit) {
        if (w.isClient || !(p instanceof ServerPlayerEntity player) || p instanceof FakePlayer) return ActionResult.PASS;
        ItemStack stack = player.getStackInHand(hand);
        if (isMarker(stack)) {
            BlockPos pos = new ItemPlacementContext(player, hand, stack, hit).getBlockPos();
            PENDING.add(new Pending(w.getRegistryKey(), pos.toImmutable(), player.getUuid(), 0));
        }
        return ActionResult.PASS;
    }

    static void tick(MinecraftServer server) {
        for (int i = PENDING.size() - 1; i >= 0; i--) {
            Pending pd = PENDING.get(i);
            ServerWorld world = server.getWorld(pd.world());
            if (world != null && world.getBlockState(pd.pos()).isOf(Blocks.LODESTONE)) {
                mark(server, world, pd.pos(), pd.player());
                PENDING.remove(i);
            } else if (pd.ticks() > 5) {
                PENDING.remove(i);
            } else {
                PENDING.set(i, new Pending(pd.world(), pd.pos(), pd.player(), pd.ticks() + 1));
            }
        }
        // A marker that was broken stops counting.
        if (server.getTicks() % 100 != 0) return;
        HelperData data = HelperData.get(server);
        for (ServerPlayerEntity player : server.getPlayerManager().getPlayerList()) {
            HelperData.Entry e = data.get(player.getUuid());
            if (e == null || e.mineMarker == null || e.mineDim == null) continue;
            ServerWorld world = player.getServer().getWorld(RegistryKey.of(net.minecraft.registry.RegistryKeys.WORLD,
                    new net.minecraft.util.Identifier(e.mineDim)));
            if (world == null || !world.isChunkLoaded(e.mineMarker)) continue;
            if (!world.getBlockState(e.mineMarker).isOf(Blocks.LODESTONE)) {
                e.mineMarker = null;
                e.mineOrigin = null;
                data.markDirty();
                Helper.say(player, "Your Mine Marker is gone, so I'll pick a spot for my mine myself next time.");
            }
        }
    }

    private static void mark(MinecraftServer server, ServerWorld world, BlockPos pos, UUID owner) {
        HelperData data = HelperData.get(server);
        HelperData.Entry e = data.getOrCreate(owner);
        boolean same = e.mineOrigin != null && world.getRegistryKey().getValue().toString().equals(e.mineDim)
                && e.mineOrigin.equals(pos.up());
        e.mineMarker = pos.toImmutable();
        e.mineOrigin = pos.up().toImmutable(); // the staircase starts beside the marker; the marker itself stays
        e.mineDim = world.getRegistryKey().getValue().toString();
        if (!same) e.mineDepth = 0;
        data.markDirty();
        ServerPlayerEntity player = server.getPlayerManager().getPlayer(owner);
        if (player != null) Helper.say(player, "Got it! From now on I'll dig my mine here, at " + pos.toShortString()
                + ". Break the marker to let me choose again.");
    }
}
