package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.ChatFormatting;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.RandomSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.BlockHitResult;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

/**
 * Tycoon gear (weapons and armour for the shop) and loot boxes: Gear Boxes, Machine Boxes and Mega Boxes.
 * A loot box is a named chest item with a "HelperLootBox" tag. Right-click to open it (it never gets placed).
 */
final class Loot {
    private Loot() {}

    private static final String TAG = "HelperLootBox";

    enum Rarity {
        COMMON("Common", ChatFormatting.WHITE), UNCOMMON("Uncommon", ChatFormatting.GREEN), RARE("Rare", ChatFormatting.AQUA),
        EPIC("Epic", ChatFormatting.LIGHT_PURPLE), LEGENDARY("Legendary", ChatFormatting.GOLD);

        final String label;
        final ChatFormatting color;

        Rarity(String label, ChatFormatting color) {
            this.label = label;
            this.color = color;
        }
    }

    private record Prize(Rarity rarity, String what, Supplier<List<ItemStack>> items) {}

    private record Box(String id, String name, ChatFormatting color, int[] weights, List<Prize> prizes) {}

    // ---------------------------------------------------------------------------------------
    // Gear
    // ---------------------------------------------------------------------------------------

    static ItemStack enchanted(Item item, Object... enchants) {
        ItemStack stack = new ItemStack(item);
        for (int i = 0; i + 1 < enchants.length; i += 2) stack.enchant((Enchantment) enchants[i], (Integer) enchants[i + 1]);
        return stack;
    }

    static ItemStack named(ItemStack stack, String name, ChatFormatting color) {
        stack.set(net.minecraft.core.component.DataComponents.CUSTOM_NAME, Component.literal(name).withStyle(s -> s.withItalic(false)).withStyle(color));
        return stack;
    }

    static List<ItemStack> ironSet() {
        return List.of(new ItemStack(Items.IRON_HELMET), new ItemStack(Items.IRON_CHESTPLATE),
                new ItemStack(Items.IRON_LEGGINGS), new ItemStack(Items.IRON_BOOTS));
    }

    static List<ItemStack> diamondSet() {
        return List.of(new ItemStack(Items.DIAMOND_HELMET), new ItemStack(Items.DIAMOND_CHESTPLATE),
                new ItemStack(Items.DIAMOND_LEGGINGS), new ItemStack(Items.DIAMOND_BOOTS));
    }

    static List<ItemStack> protectedDiamondSet() {
        List<ItemStack> list = new ArrayList<>();
        for (ItemStack s : diamondSet()) {
            s.enchant(Compat.ench(Enchantments.PROTECTION), 4);
            s.enchant(Compat.ench(Enchantments.UNBREAKING), 3);
            list.add(s);
        }
        return list;
    }

    static List<ItemStack> netheriteSet() {
        return List.of(new ItemStack(Items.NETHERITE_HELMET), new ItemStack(Items.NETHERITE_CHESTPLATE),
                new ItemStack(Items.NETHERITE_LEGGINGS), new ItemStack(Items.NETHERITE_BOOTS));
    }

    static List<ItemStack> bowKit() {
        return List.of(new ItemStack(Items.BOW), new ItemStack(Items.ARROW, 32));
    }

    static ItemStack sharpDiamondSword() {
        return enchanted(Items.DIAMOND_SWORD, Enchantments.SHARPNESS, 5, Enchantments.LOOTING, 3, Enchantments.UNBREAKING, 3);
    }

    static ItemStack powerBow() {
        return enchanted(Items.BOW, Enchantments.POWER, 5, Enchantments.INFINITY, 1, Enchantments.FLAME, 1);
    }

    /** The legendary prize: an original sword, only from loot boxes. */
    static ItemStack coinbreaker() {
        ItemStack s = enchanted(Items.NETHERITE_SWORD, Enchantments.SHARPNESS, 5, Enchantments.LOOTING, 3,
                Enchantments.FIRE_ASPECT, 2, Enchantments.SWEEPING_EDGE, 3, Enchantments.MENDING, 1, Enchantments.UNBREAKING, 3);
        return named(s, "Coinbreaker", ChatFormatting.GOLD);
    }

    /** Netherite armour with everything: only from loot boxes. */
    static List<ItemStack> vaultguardSet() {
        List<ItemStack> list = new ArrayList<>();
        String[] names = {"Vaultguard Helm", "Vaultguard Chestplate", "Vaultguard Leggings", "Vaultguard Boots"};
        int i = 0;
        for (ItemStack s : netheriteSet()) {
            s.enchant(Compat.ench(Enchantments.PROTECTION), 4);
            s.enchant(Compat.ench(Enchantments.UNBREAKING), 3);
            s.enchant(Compat.ench(Enchantments.MENDING), 1);
            list.add(named(s, names[i++], ChatFormatting.GOLD));
        }
        return list;
    }

    static boolean giveAll(ServerPlayer player, List<ItemStack> items) {
        for (ItemStack s : items) player.getInventory().placeItemBackInInventory(s.copy(), net.minecraft.util.Prediction.SERVER_ONLY);
        return true;
    }

    private static Supplier<List<ItemStack>> one(Supplier<ItemStack> s) {
        return () -> List.of(s.get());
    }

    private static Supplier<List<ItemStack>> randomPiece(Supplier<List<ItemStack>> set) {
        return () -> {
            List<ItemStack> all = set.get();
            return List.of(all.get((int) (Math.random() * all.size())));
        };
    }

    // ---------------------------------------------------------------------------------------
    // Boxes
    // ---------------------------------------------------------------------------------------

    private static final List<Prize> GEAR = List.of(
            new Prize(Rarity.COMMON, "Iron Sword", one(() -> new ItemStack(Items.IRON_SWORD))),
            new Prize(Rarity.COMMON, "Iron Axe", one(() -> new ItemStack(Items.IRON_AXE))),
            new Prize(Rarity.COMMON, "Bow and 32 Arrows", Loot::bowKit),
            new Prize(Rarity.COMMON, "Shield", one(() -> new ItemStack(Items.SHIELD))),
            new Prize(Rarity.COMMON, "an iron armour piece", randomPiece(Loot::ironSet)),
            new Prize(Rarity.UNCOMMON, "Iron Armour Set", Loot::ironSet),
            new Prize(Rarity.UNCOMMON, "Diamond Sword", one(() -> new ItemStack(Items.DIAMOND_SWORD))),
            new Prize(Rarity.UNCOMMON, "Crossbow", one(() -> new ItemStack(Items.CROSSBOW))),
            new Prize(Rarity.UNCOMMON, "a diamond armour piece", randomPiece(Loot::diamondSet)),
            new Prize(Rarity.RARE, "Diamond Armour Set", Loot::diamondSet),
            new Prize(Rarity.RARE, "Sharpness V Diamond Sword", one(Loot::sharpDiamondSword)),
            new Prize(Rarity.RARE, "Power V Bow", one(Loot::powerBow)),
            new Prize(Rarity.EPIC, "Netherite Sword", one(() -> new ItemStack(Items.NETHERITE_SWORD))),
            new Prize(Rarity.EPIC, "Protection IV Diamond Armour", Loot::protectedDiamondSet),
            new Prize(Rarity.EPIC, "Trident", one(() -> enchanted(Items.TRIDENT, Enchantments.LOYALTY, 3, Enchantments.IMPALING, 3))),
            new Prize(Rarity.LEGENDARY, "Coinbreaker (the best sword there is)", one(Loot::coinbreaker)),
            new Prize(Rarity.LEGENDARY, "Vaultguard Armour (maxed netherite)", Loot::vaultguardSet));

    private static final List<Prize> MACHINES = List.of(
            new Prize(Rarity.COMMON, "16 Conveyors", one(() -> Tycoon.conveyors(16))),
            new Prize(Rarity.COMMON, "2 Lifters", one(() -> { ItemStack s = Tycoon.lifter(); s.setCount(2); return s; })),
            new Prize(Rarity.COMMON, "2 Upgraders x2", one(() -> Tycoon.machine("upgrader", 2))),
            new Prize(Rarity.COMMON, "8 Speed Belts", one(() -> Tycoon.machine("speed", 8))),
            new Prize(Rarity.UNCOMMON, "2 Polishers (+10)", one(() -> Tycoon.machine("polisher", 2))),
            new Prize(Rarity.UNCOMMON, "Super Upgrader x3", one(() -> Tycoon.machine("super", 1))),
            new Prize(Rarity.UNCOMMON, "Tycoon Dropper", one(Tycoon::dropperItem)),
            new Prize(Rarity.RARE, "Smelter (x1.5, turns ore into ingots)", one(() -> Tycoon.machine("smelter", 1))),
            new Prize(Rarity.RARE, "Mega Upgrader x5", one(() -> Tycoon.machine("mega", 1))),
            new Prize(Rarity.RARE, "Lucky Upgrader (1 in 8 for x20)", one(() -> Tycoon.machine("lucky", 1))),
            new Prize(Rarity.EPIC, "Level 5 Tycoon Dropper", one(() -> Tycoon.dropperItem(5))),
            new Prize(Rarity.EPIC, "Star Upgrader x10", one(Tycoon::starUpgrader)),
            new Prize(Rarity.LEGENDARY, "Level 10 Tycoon Dropper (maxed)", one(() -> Tycoon.dropperItem(10))),
            new Prize(Rarity.LEGENDARY, "3 Star Upgraders x10", one(() -> { ItemStack s = Tycoon.starUpgrader(); s.setCount(3); return s; })));

    private static final List<Prize> MEGA;

    static {
        List<Prize> all = new ArrayList<>(GEAR);
        all.addAll(MACHINES);
        MEGA = List.copyOf(all);
    }

    // Weights per rarity: common, uncommon, rare, epic, legendary (out of 1000)
    private static final Box[] BOXES = {
            new Box("gear", "Gear Box", ChatFormatting.RED, new int[]{550, 280, 120, 42, 8}, GEAR),
            new Box("machine", "Machine Box", ChatFormatting.YELLOW, new int[]{550, 280, 120, 42, 8}, MACHINES),
            new Box("mega", "Mega Box", ChatFormatting.LIGHT_PURPLE, new int[]{0, 300, 400, 230, 70}, MEGA),
    };

    private static Box box(String id) {
        for (Box b : BOXES) if (b.id().equals(id)) return b;
        return null;
    }

    static ItemStack boxItem(String id) {
        Box b = box(id);
        ItemStack stack = new ItemStack(Items.CHEST);
        Compat.editTag(stack, t -> t.putString(TAG, id));
        named(stack, b.name(), b.color());
        ListTag lore = new ListTag();
        String inside = id.equals("gear") ? "Weapons and armour" : id.equals("machine") ? "Tycoon machines and droppers" : "Gear and machines, better odds";
        lore.add(Component.literal(inside).withStyle(s -> s.withItalic(false)).withStyle(ChatFormatting.GRAY));
        lore.add(Component.literal("Right-click to open").withStyle(s -> s.withItalic(false)).withStyle(ChatFormatting.GREEN));
        Compat.lore(stack, lore);
        return stack;
    }

    static String boxOf(ItemStack stack) {
        if (!stack.is(Items.CHEST) || !Compat.hasTag(stack)) return null;
        String id = Compat.tag(stack).getStringOr(TAG, "");
        return box(id) == null ? null : id;
    }

    static InteractionResult onUseItem(Player p, Level w, InteractionHand hand) {
        ItemStack stack = p.getItemInHand(hand);
        if (boxOf(stack) == null) return InteractionResult.PASS;
        if (!w.isClientSide() && p instanceof ServerPlayer player && !(p instanceof FakePlayer)) open(player, stack);
        return InteractionResult.SUCCESS;
    }

    /** Clicking a block with a box opens it instead of placing a chest. */
    static InteractionResult onUseBlock(Player p, Level w, InteractionHand hand, BlockHitResult hit) {
        ItemStack stack = p.getItemInHand(hand);
        if (boxOf(stack) == null) return InteractionResult.PASS;
        if (!w.isClientSide() && p instanceof ServerPlayer player && !(p instanceof FakePlayer)) open(player, stack);
        return InteractionResult.SUCCESS;
    }

    private static void open(ServerPlayer player, ItemStack stack) {
        Box b = box(boxOf(stack));
        if (b == null) return;
        RandomSource random = player.getRandom();
        Rarity rarity = roll(b.weights(), random);
        List<Prize> pool = new ArrayList<>();
        for (Prize pr : b.prizes()) if (pr.rarity() == rarity) pool.add(pr);
        if (pool.isEmpty()) pool.addAll(b.prizes());
        Prize prize = pool.get(random.nextInt(pool.size()));
        // Gear can come from any mod in the pack: half the gear prizes in a Gear Box (a third in a Mega Box) are a
        // random weapon or armour piece of the same rarity from the whole pack.
        double modChance = b.id().equals("gear") ? 0.5 : b.id().equals("mega") ? 0.35 : 0;
        if (modChance > 0 && random.nextDouble() < modChance) {
            List<ModGear.Gear> mod = ModGear.ofRarity(rarity);
            if (!mod.isEmpty()) {
                ModGear.Gear g = mod.get(random.nextInt(mod.size()));
                prize = new Prize(rarity, g.name(), () -> List.of(new ItemStack(g.item())));
            }
        }
        stack.shrink(1);
        giveAll(player, prize.items().get());

        Component line = Component.literal(b.name() + ": ").withStyle(ChatFormatting.GRAY)
                .append(Component.literal(rarity.label + " ").withStyle(rarity.color, ChatFormatting.BOLD))
                .append(Component.literal(prize.what()).withStyle(rarity.color));
        player.sendSystemMessage(line);
        player.sendOverlayMessage(Component.literal(rarity.label + "! " + prize.what()).withStyle(rarity.color));
        ServerLevel world = player.level();
        double x = player.getX(), y = player.getY() + 1.2, z = player.getZ();
        world.playSound(null, player.blockPosition(), SoundEvents.CHEST_OPEN, SoundSource.PLAYERS, 0.8f, 1.1f);
        switch (rarity) {
            case COMMON, UNCOMMON -> world.sendParticles(ParticleTypes.HAPPY_VILLAGER, x, y, z, 10, 0.4, 0.4, 0.4, 0);
            case RARE -> {
                world.sendParticles(ParticleTypes.ENCHANT, x, y, z, 40, 0.5, 0.5, 0.5, 0.5);
                world.playSound(null, player.blockPosition(), SoundEvents.PLAYER_LEVELUP, SoundSource.PLAYERS, 0.6f, 1.4f);
            }
            default -> {
                world.sendParticles(ParticleTypes.TOTEM_OF_UNDYING, x, y, z, 60, 0.5, 0.8, 0.5, 0.4);
                world.playSound(null, player.blockPosition(), SoundEvents.UI_TOAST_CHALLENGE_COMPLETE, SoundSource.PLAYERS, 0.8f, 1.0f);
                if (rarity == Rarity.LEGENDARY) {
                    player.level().getServer().getPlayerList().broadcastSystemMessage(Component.literal(player.getName().getString() + " opened a ")
                            .withStyle(ChatFormatting.GOLD).append(Component.literal(b.name()).withStyle(b.color()))
                            .append(Component.literal(" and got the LEGENDARY " + prize.what() + "!").withStyle(ChatFormatting.GOLD)), false);
                }
            }
        }
    }

    private static Rarity roll(int[] weights, RandomSource random) {
        int total = 0;
        for (int w : weights) total += w;
        int r = random.nextInt(Math.max(1, total));
        for (int i = 0; i < weights.length; i++) {
            r -= weights[i];
            if (r < 0) return Rarity.values()[i];
        }
        return Rarity.COMMON;
    }

    /** What /helper tycoon odds shows. */
    static void odds(ServerPlayer player) {
        List<ModGear.Gear> gear = ModGear.all();
        long mods = gear.stream().map(g -> net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(g.item()).getNamespace()).distinct().count();
        player.sendSystemMessage(Component.literal(gear.size() + " weapons and armour pieces from " + mods
                + " mods are in the shop and the Gear and Mega Boxes.").withStyle(ChatFormatting.GRAY));
        for (Box b : BOXES) {
            StringBuilder sb = new StringBuilder(b.name() + ": ");
            for (int i = 0; i < 5; i++) {
                if (b.weights()[i] == 0) continue;
                sb.append(Rarity.values()[i].label).append(' ').append(b.weights()[i] / 10.0).append("%  ");
            }
            player.sendSystemMessage(Component.literal(sb.toString().trim()).withStyle(b.color()));
        }
    }
}
