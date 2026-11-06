package com.helpermod;

import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.attribute.EntityAttributeModifier;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.item.ArmorItem;
import net.minecraft.item.AxeItem;
import net.minecraft.item.HoeItem;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.MiningToolItem;
import net.minecraft.item.RangedWeaponItem;
import net.minecraft.item.ShieldItem;
import net.minecraft.item.SwordItem;
import net.minecraft.item.TridentItem;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Every weapon and piece of armour in the mod pack (vanilla and every other mod), found by scanning the item registry
 * once. Each gets a price from how strong it is, a shop tier from its price, and a loot box rarity.
 */
final class ModGear {
    private ModGear() {}

    record Gear(Item item, String name, long price, int tier, Loot.Rarity rarity, boolean armour) {}

    private static List<Gear> cache;

    /** Debug, creative-only and admin items some mods add: never sold or won. */
    private static final String[] SKIP = {"debug", "creative", "admin", "test", "dev_", "_dev", "cheat", "infinity_", "op_"};

    static synchronized List<Gear> all() {
        if (cache != null) return cache;
        List<Gear> list = new ArrayList<>();
        for (Item item : Registries.ITEM) {
            Identifier id = Registries.ITEM.getId(item);
            String path = id.getPath().toLowerCase(Locale.ROOT);
            boolean skip = false;
            for (String s : SKIP) if (path.contains(s)) skip = true;
            if (skip || item.getMaxDamage() <= 0) continue;
            long price = price(item);
            if (price <= 0) continue;
            int tier = price < 1_000 ? 1 : price < 20_000 ? 2 : 3;
            list.add(new Gear(item, name(item, id), price, tier, rarityFor(price), item instanceof ArmorItem));
        }
        list.sort(Comparator.comparingLong(Gear::price));
        cache = List.copyOf(list);
        HelperMod.LOG.info("[Helper] Tycoon gear: found {} weapons and armour pieces in the mod pack", cache.size());
        return cache;
    }

    static void reset() {
        cache = null;
    }

    static Loot.Rarity rarityFor(long price) {
        if (price < 300) return Loot.Rarity.COMMON;
        if (price < 1_500) return Loot.Rarity.UNCOMMON;
        if (price < 8_000) return Loot.Rarity.RARE;
        if (price < 50_000) return Loot.Rarity.EPIC;
        return Loot.Rarity.LEGENDARY;
    }

    static List<Gear> ofRarity(Loot.Rarity rarity) {
        List<Gear> out = new ArrayList<>();
        for (Gear g : all()) if (g.rarity() == rarity) out.add(g);
        return out;
    }

    private static double attackDamage(Item item) {
        double dmg = 0;
        for (EntityAttributeModifier m : item.getAttributeModifiers(EquipmentSlot.MAINHAND).get(EntityAttributes.GENERIC_ATTACK_DAMAGE)) {
            if (m.getOperation() == EntityAttributeModifier.Operation.ADDITION) dmg += m.getValue();
        }
        return dmg + 1; // players hit for 1 with an empty hand
    }

    /** 0 = not a weapon or armour. */
    static long price(Item item) {
        double durability = 1 + item.getMaxDamage() / 2000.0;
        double p;
        if (item instanceof ArmorItem armor) {
            double points = armor.getProtection() + armor.getToughness() * 1.0;
            if (points <= 0) return 0;
            p = 10 * Math.pow(2, points - 2) * (1 + item.getMaxDamage() / 1000.0);
        } else if (item instanceof ShieldItem) {
            p = 80 + item.getMaxDamage() / 2.0;
        } else if (item instanceof RangedWeaponItem) {
            p = 150 + item.getMaxDamage() * 1.5;
        } else {
            boolean weapon = item instanceof SwordItem || item instanceof AxeItem || item instanceof TridentItem;
            if (!weapon && (item instanceof MiningToolItem || item instanceof HoeItem)) return 0; // pickaxes, shovels, hoes
            double dmg = attackDamage(item);
            if (!weapon && dmg < 5) return 0; // modded weapons that don't extend SwordItem still count when they hit hard
            if (dmg > 100) return 0; // creative-only
            p = 10 * Math.pow(3, dmg - 4) * durability;
        }
        return Math.max(20, Math.min(5_000_000, Math.round(p / 10.0) * 10));
    }

    private static String name(Item item, Identifier id) {
        String n = new ItemStack(item).getName().getString();
        if (n.isEmpty() || n.equals(item.getTranslationKey())) {
            StringBuilder sb = new StringBuilder();
            for (String w : id.getPath().split("_")) {
                if (w.isEmpty()) continue;
                sb.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1)).append(' ');
            }
            n = sb.toString().trim();
        }
        if (!id.getNamespace().equals("minecraft")) n += " (" + modName(id.getNamespace()) + ")";
        return n;
    }

    private static String modName(String namespace) {
        return net.fabricmc.loader.api.FabricLoader.getInstance().getModContainer(namespace)
                .map(c -> c.getMetadata().getName()).orElse(namespace);
    }

    static Set<Item> soldElsewhere() {
        return Set.of(net.minecraft.item.Items.IRON_SWORD, net.minecraft.item.Items.IRON_AXE, net.minecraft.item.Items.BOW,
                net.minecraft.item.Items.SHIELD, net.minecraft.item.Items.DIAMOND_SWORD, net.minecraft.item.Items.CROSSBOW,
                net.minecraft.item.Items.TRIDENT, net.minecraft.item.Items.NETHERITE_SWORD);
    }
}
