package com.helpermod;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.ChatFormatting;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

/**
 * Space Rockets from the tycoon shop, so the planets can be reached in survival without Ad Astra. Hold one and
 * right-click: pick a planet (or home), a countdown runs, you blast off in fire and smoke, and land there.
 * A rocket is never used up. Higher tiers reach more planets:
 * tier 1 Fairway and Ceres, tier 2 adds Europa and Io, tier 3 adds Titan and Bikini Bottom, tier 4 adds Pluto.
 */
final class Rocket {
    private Rocket() {}

    static final String TAG = "HelperRocket";
    static final long[] PRICE = {0, 50_000, 150_000, 400_000, 1_000_000};

    /** Each planet and the lowest rocket tier that reaches it, nearest first. */
    static final List<String[]> ROUTES = List.of(
            new String[]{"fairway", "1"}, new String[]{"ceres", "1"},
            new String[]{"europa", "2"}, new String[]{"io", "2"},
            new String[]{"titan", "3"}, new String[]{"bikini_bottom", "3"},
            new String[]{"pluto", "4"});

    private static final Item[] PLANET_ICONS = {Items.GRASS_BLOCK, Items.COBBLED_DEEPSLATE, Items.PACKED_ICE, Items.MAGMA_BLOCK,
            Items.MUD, Items.PRISMARINE, Items.BLUE_ICE};

    static List<String> reach(int tier) {
        List<String> out = new ArrayList<>();
        for (String[] r : ROUTES) if (Integer.parseInt(r[1]) <= tier && Space.PLANETS.contains(r[0])) out.add(r[0]);
        return out;
    }

    static String reachText(int tier) {
        List<String> names = new ArrayList<>();
        for (String p : reach(tier)) names.add(Space.display(p));
        return String.join(", ", names);
    }

    /** The shop line for a tier, e.g. "Space: Tier 2 Rocket (Fairway, Ceres, Europa, Io)". */
    static String shopName(int tier) {
        return "Space: Tier " + tier + " Rocket (" + (tier == 4 ? "every planet" : reachText(tier)) + ")";
    }

    static ItemStack item(int tier) {
        ItemStack s = new ItemStack(Items.FIREWORK_ROCKET);
        CompoundTag t = new CompoundTag();
        t.putInt("tier", tier);
        Compat.editTag(s, c -> c.put(TAG, t));
        s.set(DataComponents.CUSTOM_NAME, Component.literal("Tier " + tier + " Space Rocket").withStyle(st -> st.withItalic(false))
                .withStyle(ChatFormatting.AQUA));
        s.set(DataComponents.ENCHANTMENT_GLINT_OVERRIDE, true);
        Compat.lore(s, List.of(
                Component.literal("Flies to: " + reachText(tier)).withStyle(st -> st.withItalic(false)).withStyle(ChatFormatting.GRAY),
                Component.literal("Right-click to pick a planet. Never used up.").withStyle(st -> st.withItalic(false))
                        .withStyle(ChatFormatting.GRAY)));
        return s;
    }

    static int tierOf(ItemStack s) {
        if (s.isEmpty() || !Compat.hasTag(s) || !Compat.tag(s).contains(TAG)) return 0;
        return Compat.tag(s).getCompoundOrEmpty(TAG).getIntOr("tier", 0);
    }

    // ---------------------------------------------------------------------------------------
    // Using one
    // ---------------------------------------------------------------------------------------

    static InteractionResult onUseItem(Player p, Level w, InteractionHand hand) {
        int tier = tierOf(p.getItemInHand(hand));
        if (tier == 0) return InteractionResult.PASS;
        if (!w.isClientSide() && p instanceof ServerPlayer player && !(p instanceof FakePlayer)) openPicker(player, tier);
        return InteractionResult.SUCCESS; // never fires off like a firework, never boosts an elytra
    }

    static InteractionResult onUseBlock(Player p, Level w, InteractionHand hand, BlockHitResult hit) {
        return onUseItem(p, w, hand);
    }

    static void openPicker(ServerPlayer player, int tier) {
        if (LAUNCHES.containsKey(player.getUUID())) {
            player.sendOverlayMessage(Component.literal("You're already launching!").withStyle(ChatFormatting.YELLOW));
            return;
        }
        player.openMenu(new SimpleMenuProvider((syncId, inv, p) -> new Picker(syncId, inv, player, tier),
                Component.literal("Tier " + tier + " Rocket: where to?")));
    }

    static final class Picker extends ChestMenu {
        private final ServerPlayer player;
        private final List<String> targets = new ArrayList<>();

        Picker(int syncId, Inventory inv, ServerPlayer player, int tier) {
            this(syncId, inv, player, tier, new SimpleContainer(27));
        }

        private Picker(int syncId, Inventory inv, ServerPlayer player, int tier, SimpleContainer view) {
            super(MenuType.GENERIC_9x3, syncId, inv, view, 3);
            this.player = player;
            String here = player.level().dimension().identifier().getPath();
            boolean inSpace = Planets.isSpace(player.level());
            for (int i = 0; i < ROUTES.size(); i++) {
                String planet = ROUTES.get(i)[0];
                int need = Integer.parseInt(ROUTES.get(i)[1]);
                int slot = 10 + i;
                if (!Space.PLANETS.contains(planet)) continue;
                if (need > tier) {
                    view.setItem(slot, Storage.Menu.button(Items.BARRIER, Space.display(planet), "Needs a Tier " + need + " Rocket"));
                    targets.add(null);
                } else if (inSpace && planet.equals(here)) {
                    view.setItem(slot, Storage.Menu.button(PLANET_ICONS[i], Space.display(planet), "You're here"));
                    targets.add(null);
                } else {
                    view.setItem(slot, Storage.Menu.button(PLANET_ICONS[i], Space.display(planet), "Click to blast off"));
                    targets.add(planet);
                }
            }
            view.setItem(22, Storage.Menu.button(Items.COMPASS, "Home", inSpace ? "Fly back to where you took off" : "You're already home",
                    inSpace ? "Click to blast off" : ""));
        }

        @Override
        public void clicked(int slot, int button, ContainerInput action, Player p) {
            if (action != ContainerInput.PICKUP) return;
            String target = null;
            if (slot == 22 && Planets.isSpace(player.level())) target = "home";
            else if (slot >= 10 && slot - 10 < targets.size()) target = targets.get(slot - 10);
            if (target == null) return;
            String go = target;
            player.level().getServer().execute(() -> {
                player.closeContainer();
                launch(player, go);
            });
        }

        @Override
        public ItemStack quickMoveStack(Player p, int slot) {
            return ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(Player p) {
            return true;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Countdown and lift-off
    // ---------------------------------------------------------------------------------------

    private static final int COUNTDOWN = 60, FLIGHT = 50;

    private static final class Launch {
        final String target;
        int ticks;

        Launch(String target) {
            this.target = target;
        }
    }

    private static final Map<UUID, Launch> LAUNCHES = new HashMap<>();

    static void launch(ServerPlayer player, String target) {
        if (player.isPassenger()) player.stopRiding();
        LAUNCHES.put(player.getUUID(), new Launch(target));
        String where = target.equals("home") ? "home" : Space.display(target);
        Helper.say(player, "Rocket ready. Next stop: " + where + "!");
    }

    static void tick(MinecraftServer server) {
        if (LAUNCHES.isEmpty()) return;
        Iterator<Map.Entry<UUID, Launch>> it = LAUNCHES.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<UUID, Launch> e = it.next();
            ServerPlayer p = server.getPlayerList().getPlayer(e.getKey());
            if (p == null || !p.isAlive()) {
                it.remove();
                continue;
            }
            Launch l = e.getValue();
            ServerLevel world = (ServerLevel) p.level();
            int t = l.ticks++;
            if (t < COUNTDOWN) {
                if (t % 20 == 0) {
                    int n = 3 - t / 20;
                    p.sendOverlayMessage(Component.literal(n + "...").withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD));
                    world.playSound(null, p.blockPosition(), SoundEvents.NOTE_BLOCK_BELL.value(), SoundSource.PLAYERS, 1f, 0.7f + t / 60f);
                }
                world.sendParticles(ParticleTypes.CAMPFIRE_COSY_SMOKE, p.getX(), p.getY() + 0.1, p.getZ(), 2, 0.3, 0.05, 0.3, 0.01);
                continue;
            }
            if (t == COUNTDOWN) {
                p.sendOverlayMessage(Component.literal("Lift-off!").withStyle(ChatFormatting.RED, ChatFormatting.BOLD));
                world.playSound(null, p.blockPosition(), SoundEvents.FIREWORK_ROCKET_LAUNCH, SoundSource.PLAYERS, 2f, 0.5f);
                world.playSound(null, p.blockPosition(), SoundEvents.GENERIC_EXPLODE.value(), SoundSource.PLAYERS, 0.6f, 1.4f);
            }
            p.setDeltaMovement(new Vec3(0, Math.min(1.6, 0.3 + (t - COUNTDOWN) * 0.05), 0));
            p.hurtMarked = true;
            p.resetFallDistance();
            world.sendParticles(ParticleTypes.FLAME, p.getX(), p.getY() - 0.2, p.getZ(), 6, 0.15, 0.1, 0.15, 0.02);
            world.sendParticles(ParticleTypes.LARGE_SMOKE, p.getX(), p.getY() - 0.6, p.getZ(), 4, 0.25, 0.2, 0.25, 0.02);
            if (t % 10 == 0) world.playSound(null, p.blockPosition(), SoundEvents.BLAZE_SHOOT, SoundSource.PLAYERS, 0.6f, 0.6f);
            if (t < COUNTDOWN + FLIGHT) continue;
            it.remove();
            p.resetFallDistance();
            p.setDeltaMovement(Vec3.ZERO);
            p.hurtMarked = true;
            if (l.target.equals("home")) Space.home(p);
            else Space.go(p, l.target);
            p.addEffect(new MobEffectInstance(MobEffects.SLOW_FALLING, 200, 0, true, false));
            p.level().playSound(null, p.blockPosition(), SoundEvents.GENERIC_EXPLODE.value(), SoundSource.PLAYERS, 0.4f, 1.8f);
        }
    }

    static void reset() {
        LAUNCHES.clear();
    }
}
