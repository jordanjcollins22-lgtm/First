package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.enchantment.Enchantment;
import net.minecraft.enchantment.Enchantments;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtList;
import net.minecraft.nbt.NbtString;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Formatting;
import net.minecraft.util.Hand;
import net.minecraft.util.TypedActionResult;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.random.Random;
import net.minecraft.world.World;

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
        COMMON("Common", Formatting.WHITE), UNCOMMON("Uncommon", Formatting.GREEN), RARE("Rare", Formatting.AQUA),
        EPIC("Epic", Formatting.LIGHT_PURPLE), LEGENDARY("Legendary", Formatting.GOLD);

        final String label;
        final Formatting color;

        Rarity(String label, Formatting color) {
            this.label = label;
            this.color = color;
        }
    }

    private record Prize(Rarity rarity, String what, Supplier<List<ItemStack>> items) {}

    private record Box(String id, String name, Formatting color, int[] weights, List<Prize> prizes) {}

    // ---------------------------------------------------------------------------------------
    // Gear
    // ---------------------------------------------------------------------------------------

    static ItemStack enchanted(Item item, Object... enchants) {
        ItemStack stack = new ItemStack(item);
        for (int i = 0; i + 1 < enchants.length; i += 2) stack.addEnchantment((Enchantment) enchants[i], (Integer) enchants[i + 1]);
        return stack;
    }

    static ItemStack named(ItemStack stack, String name, Formatting color) {
        stack.setCustomName(Text.literal(name).styled(s -> s.withItalic(false)).formatted(color));
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
            s.addEnchantment(Enchantments.PROTECTION, 4);
            s.addEnchantment(Enchantments.UNBREAKING, 3);
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
                Enchantments.FIRE_ASPECT, 2, Enchantments.SWEEPING, 3, Enchantments.MENDING, 1, Enchantments.UNBREAKING, 3);
        return named(s, "Coinbreaker", Formatting.GOLD);
    }

    /** Netherite armour with everything: only from loot boxes. */
    static List<ItemStack> vaultguardSet() {
        List<ItemStack> list = new ArrayList<>();
        String[] names = {"Vaultguard Helm", "Vaultguard Chestplate", "Vaultguard Leggings", "Vaultguard Boots"};
        int i = 0;
        for (ItemStack s : netheriteSet()) {
            s.addEnchantment(Enchantments.PROTECTION, 4);
            s.addEnchantment(Enchantments.UNBREAKING, 3);
            s.addEnchantment(Enchantments.MENDING, 1);
            list.add(named(s, names[i++], Formatting.GOLD));
        }
        return list;
    }

    static boolean giveAll(ServerPlayerEntity player, List<ItemStack> items) {
        for (ItemStack s : items) player.getInventory().offerOrDrop(s.copy());
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
            new Box("gear", "Gear Box", Formatting.RED, new int[]{550, 280, 120, 42, 8}, GEAR),
            new Box("machine", "Machine Box", Formatting.YELLOW, new int[]{550, 280, 120, 42, 8}, MACHINES),
            new Box("mega", "Mega Box", Formatting.LIGHT_PURPLE, new int[]{0, 300, 400, 230, 70}, MEGA),
    };

    private static Box box(String id) {
        for (Box b : BOXES) if (b.id().equals(id)) return b;
        return null;
    }

    static ItemStack boxItem(String id) {
        Box b = box(id);
        ItemStack stack = new ItemStack(Items.CHEST);
        stack.getOrCreateNbt().putString(TAG, id);
        named(stack, b.name(), b.color());
        NbtList lore = new NbtList();
        String inside = id.equals("gear") ? "Weapons and armour" : id.equals("machine") ? "Tycoon machines and droppers" : "Gear and machines, better odds";
        lore.add(NbtString.of(Text.Serializer.toJson(Text.literal(inside).styled(s -> s.withItalic(false)).formatted(Formatting.GRAY))));
        lore.add(NbtString.of(Text.Serializer.toJson(Text.literal("Right-click to open").styled(s -> s.withItalic(false)).formatted(Formatting.GREEN))));
        stack.getOrCreateSubNbt("display").put("Lore", lore);
        return stack;
    }

    static String boxOf(ItemStack stack) {
        if (!stack.isOf(Items.CHEST) || !stack.hasNbt()) return null;
        String id = stack.getNbt().getString(TAG);
        return box(id) == null ? null : id;
    }

    static TypedActionResult<ItemStack> onUseItem(PlayerEntity p, World w, Hand hand) {
        ItemStack stack = p.getStackInHand(hand);
        if (boxOf(stack) == null) return TypedActionResult.pass(stack);
        if (!w.isClient && p instanceof ServerPlayerEntity player && !(p instanceof FakePlayer)) open(player, stack);
        return TypedActionResult.success(stack);
    }

    /** Clicking a block with a box opens it instead of placing a chest. */
    static ActionResult onUseBlock(PlayerEntity p, World w, Hand hand, BlockHitResult hit) {
        ItemStack stack = p.getStackInHand(hand);
        if (boxOf(stack) == null) return ActionResult.PASS;
        if (!w.isClient && p instanceof ServerPlayerEntity player && !(p instanceof FakePlayer)) open(player, stack);
        return ActionResult.SUCCESS;
    }

    private static void open(ServerPlayerEntity player, ItemStack stack) {
        Box b = box(boxOf(stack));
        if (b == null) return;
        Random random = player.getRandom();
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
        stack.decrement(1);
        giveAll(player, prize.items().get());

        Text line = Text.literal(b.name() + ": ").formatted(Formatting.GRAY)
                .append(Text.literal(rarity.label + " ").formatted(rarity.color, Formatting.BOLD))
                .append(Text.literal(prize.what()).formatted(rarity.color));
        player.sendMessage(line, false);
        player.sendMessage(Text.literal(rarity.label + "! " + prize.what()).formatted(rarity.color), true);
        ServerWorld world = player.getServerWorld();
        double x = player.getX(), y = player.getY() + 1.2, z = player.getZ();
        world.playSound(null, player.getBlockPos(), SoundEvents.BLOCK_CHEST_OPEN, SoundCategory.PLAYERS, 0.8f, 1.1f);
        switch (rarity) {
            case COMMON, UNCOMMON -> world.spawnParticles(ParticleTypes.HAPPY_VILLAGER, x, y, z, 10, 0.4, 0.4, 0.4, 0);
            case RARE -> {
                world.spawnParticles(ParticleTypes.ENCHANT, x, y, z, 40, 0.5, 0.5, 0.5, 0.5);
                world.playSound(null, player.getBlockPos(), SoundEvents.ENTITY_PLAYER_LEVELUP, SoundCategory.PLAYERS, 0.6f, 1.4f);
            }
            default -> {
                world.spawnParticles(ParticleTypes.TOTEM_OF_UNDYING, x, y, z, 60, 0.5, 0.8, 0.5, 0.4);
                world.playSound(null, player.getBlockPos(), SoundEvents.UI_TOAST_CHALLENGE_COMPLETE, SoundCategory.PLAYERS, 0.8f, 1.0f);
                if (rarity == Rarity.LEGENDARY) {
                    player.getServer().getPlayerManager().broadcast(Text.literal(player.getName().getString() + " opened a ")
                            .formatted(Formatting.GOLD).append(Text.literal(b.name()).formatted(b.color()))
                            .append(Text.literal(" and got the LEGENDARY " + prize.what() + "!").formatted(Formatting.GOLD)), false);
                }
            }
        }
    }

    private static Rarity roll(int[] weights, Random random) {
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
    static void odds(ServerPlayerEntity player) {
        List<ModGear.Gear> gear = ModGear.all();
        long mods = gear.stream().map(g -> net.minecraft.registry.Registries.ITEM.getId(g.item()).getNamespace()).distinct().count();
        player.sendMessage(Text.literal(gear.size() + " weapons and armour pieces from " + mods
                + " mods are in the shop and the Gear and Mega Boxes.").formatted(Formatting.GRAY), false);
        for (Box b : BOXES) {
            StringBuilder sb = new StringBuilder(b.name() + ": ");
            for (int i = 0; i < 5; i++) {
                if (b.weights()[i] == 0) continue;
                sb.append(Rarity.values()[i].label).append(' ').append(b.weights()[i] / 10.0).append("%  ");
            }
            player.sendMessage(Text.literal(sb.toString().trim()).formatted(b.color()), false);
        }
    }
}
