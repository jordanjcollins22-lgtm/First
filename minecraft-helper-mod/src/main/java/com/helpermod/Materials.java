package com.helpermod;

import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.block.LeavesBlock;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.registry.tag.TagKey;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Works out which blocks to mine for a requested material, and which blocks count as "natural".
 *
 * Helpers only ever break natural terrain (stone, dirt, ores, trees, ...). That keeps them from
 * dismantling anyone's builds on a shared world.
 */
public final class Materials {
    private Materials() {}

    public static final TagKey<Block> C_ORES = TagKey.of(RegistryKeys.BLOCK, new Identifier("c", "ores"));

    /** Terrain a helper may dig through on its way to a target. */
    private static final List<TagKey<Block>> TERRAIN_TAGS = List.of(
            BlockTags.BASE_STONE_OVERWORLD, BlockTags.BASE_STONE_NETHER, BlockTags.DIRT, BlockTags.SAND,
            BlockTags.TERRACOTTA, BlockTags.NYLIUM, C_ORES);
    private static final Set<Block> TERRAIN_BLOCKS = Set.of(
            Blocks.GRAVEL, Blocks.CLAY, Blocks.SANDSTONE, Blocks.RED_SANDSTONE, Blocks.SNOW_BLOCK, Blocks.SNOW,
            Blocks.CALCITE, Blocks.DRIPSTONE_BLOCK, Blocks.SMOOTH_BASALT, Blocks.SOUL_SAND, Blocks.SOUL_SOIL,
            Blocks.END_STONE, Blocks.MAGMA_BLOCK, Blocks.MOSS_BLOCK, Blocks.MOSS_CARPET, Blocks.GLOW_LICHEN,
            Blocks.POINTED_DRIPSTONE, Blocks.ANCIENT_DEBRIS, Blocks.AMETHYST_BLOCK, Blocks.MUD);

    /** Extra things a helper may gather on purpose (but won't tunnel through). */
    private static final List<TagKey<Block>> GATHER_TAGS = List.of(
            BlockTags.LOGS, BlockTags.LEAVES, BlockTags.FLOWERS, BlockTags.ICE);
    private static final Set<Block> GATHER_BLOCKS = Set.of(
            Blocks.PUMPKIN, Blocks.MELON, Blocks.CACTUS, Blocks.SUGAR_CANE, Blocks.BAMBOO, Blocks.GLOWSTONE,
            Blocks.MUSHROOM_STEM, Blocks.RED_MUSHROOM_BLOCK, Blocks.BROWN_MUSHROOM_BLOCK, Blocks.OBSIDIAN,
            Blocks.AMETHYST_CLUSTER, Blocks.SHROOMLIGHT, Blocks.NETHER_WART_BLOCK, Blocks.WARPED_WART_BLOCK,
            Blocks.SEA_LANTERN, Blocks.PRISMARINE, Blocks.BONE_BLOCK, Blocks.COBWEB, Blocks.SWEET_BERRY_BUSH);

    private static final Map<String, String> ALIASES = Map.ofEntries(
            Map.entry("wood", "#minecraft:logs"), Map.entry("woods", "#minecraft:logs"),
            Map.entry("log", "#minecraft:logs"), Map.entry("logs", "#minecraft:logs"),
            Map.entry("tree", "#minecraft:logs"), Map.entry("trees", "#minecraft:logs"),
            Map.entry("leaves", "#minecraft:leaves"), Map.entry("ores", "#c:ores"),
            Map.entry("cobble", "minecraft:cobblestone"), Map.entry("spawners", "minecraft:spawner"),
            Map.entry("mob_spawner", "minecraft:spawner"), Map.entry("monster_spawner", "minecraft:spawner"), Map.entry("lapis", "minecraft:lapis_lazuli"),
            Map.entry("netherite", "minecraft:ancient_debris"), Map.entry("debris", "minecraft:ancient_debris"),
            Map.entry("quartz", "minecraft:quartz"), Map.entry("glowstone", "minecraft:glowstone_dust"));

    public static final List<String> SUGGESTIONS = List.of(
            "wood", "oak_log", "birch_log", "spruce_log", "dark_oak_log", "jungle_log", "acacia_log", "cherry_log",
            "iron", "gold", "copper", "coal", "diamond", "emerald", "lapis", "redstone", "quartz", "netherite",
            "stone", "cobblestone", "cobbled_deepslate", "dirt", "sand", "red_sand", "gravel", "flint", "clay_ball",
            "netherrack", "obsidian", "amethyst_shard", "glowstone", "deepslate", "andesite", "granite", "diorite",
            "tuff", "calcite", "ice", "snowball", "pumpkin", "melon_slice", "sugar_cane", "cactus", "bamboo", "leaves",
            "ores", "spawner");

    // ---------------------------------------------------------------------------------------
    // Natural-block checks
    // ---------------------------------------------------------------------------------------

    private static boolean isNaturalLeaves(BlockState state) {
        if (!state.isIn(BlockTags.LEAVES)) return false;
        return !state.contains(LeavesBlock.PERSISTENT) || !state.get(LeavesBlock.PERSISTENT);
    }

    private static boolean isOreLike(Block block) {
        String path = Registries.BLOCK.getId(block).getPath();
        return path.endsWith("_ore") || path.startsWith("ore_") || path.contains("_ore_");
    }

    /** Natural terrain a helper may dig through to reach a target. */
    public static boolean isTerrain(BlockState state) {
        if (state.hasBlockEntity()) return false;
        Block block = state.getBlock();
        if (TERRAIN_BLOCKS.contains(block) || isOreLike(block) || isNaturalLeaves(state)) return true;
        for (TagKey<Block> tag : TERRAIN_TAGS) if (state.isIn(tag)) return true;
        return false;
    }

    /** Anything a helper may gather: terrain plus trees, plants, ice and similar. */
    public static boolean isGatherable(BlockState state) {
        if (state.isOf(Blocks.SPAWNER)) return true; // helpers carefully dig spawners out (see Devices)
        if (state.hasBlockEntity()) return false;
        if (state.isIn(BlockTags.LEAVES)) return isNaturalLeaves(state);
        if (isTerrain(state)) return true;
        if (GATHER_BLOCKS.contains(state.getBlock())) return true;
        for (TagKey<Block> tag : GATHER_TAGS) if (state.isIn(tag)) return true;
        return false;
    }

    private static final List<String> BUILD_WORDS = List.of(
            "planks", "brick", "glass", "wool", "concrete", "door", "bed", "stairs", "slab", "fence", "wall",
            "carpet", "torch", "lantern", "rail", "ladder", "chest", "barrel", "sign", "banner", "pane", "bars",
            "polished", "smooth", "cut_", "chiseled", "tile", "lamp", "glazed", "pillar", "button", "lever",
            "pressure_plate", "trapdoor", "candle", "shulker", "bookshelf", "crafting", "furnace", "bricks");

    /** A rough "did a player probably place this" check, used for blocks that aren't known terrain. */
    public static boolean looksPlayerMade(BlockState state) {
        if (state.isIn(BlockTags.PLANKS) || state.isIn(BlockTags.WOOL) || state.isIn(BlockTags.LOGS)) return true;
        String path = Registries.BLOCK.getId(state.getBlock()).getPath();
        for (String word : BUILD_WORDS) if (path.contains(word)) return true;
        return false;
    }

    // ---------------------------------------------------------------------------------------
    // Where ores generate: read from each dimension's world-gen, so modded ores and dimensions
    // are covered as long as they use the normal ore feature.
    // ---------------------------------------------------------------------------------------

    private static Map<Block, Set<net.minecraft.registry.RegistryKey<net.minecraft.world.World>>> oreDimensions;

    private static void ensureOreDimensions(MinecraftServer server) {
        if (oreDimensions != null) return;
        Map<Block, Set<net.minecraft.registry.RegistryKey<net.minecraft.world.World>>> map = new HashMap<>();
        for (ServerWorld world : server.getWorlds()) {
            try {
                var biomes = world.getChunkManager().getChunkGenerator().getBiomeSource().getBiomes();
                for (var biome : biomes) {
                    for (var step : biome.value().getGenerationSettings().getFeatures()) {
                        for (var placed : step) {
                            placed.value().getDecoratedFeatures().forEach(feature -> {
                                if (feature.config() instanceof net.minecraft.world.gen.feature.OreFeatureConfig ore) {
                                    for (var target : ore.targets) {
                                        map.computeIfAbsent(target.state.getBlock(), k -> new HashSet<>())
                                                .add(world.getRegistryKey());
                                    }
                                }
                            });
                        }
                    }
                }
            } catch (Throwable t) {
                HelperMod.LOG.warn("Helper Buddies couldn't read ore generation for {}", world.getRegistryKey(), t);
            }
        }
        oreDimensions = map;
    }

    /**
     * If what's being collected is an ore that only generates in other dimensions, returns a message
     * saying where to find it. Null when it's fine (or we can't tell).
     */
    public static String wrongDimension(MinecraftServer server, Spec spec, ServerWorld here) {
        ensureOreDimensions(server);
        Set<net.minecraft.registry.RegistryKey<net.minecraft.world.World>> dims = new HashSet<>();
        for (Block block : spec.blocks) dims.addAll(oreDimensions.getOrDefault(block, Set.of()));
        if (dims.isEmpty() || dims.contains(here.getRegistryKey())) return null;
        List<String> names = new ArrayList<>();
        for (var dim : dims) names.add(dimensionName(dim));
        names.sort(null);
        return spec.display + " doesn't generate in " + dimensionName(here.getRegistryKey())
                + ". You can find it in " + String.join(" or ", names)
                + ". Take me there and ask again.";
    }

    public static String dimensionName(net.minecraft.registry.RegistryKey<net.minecraft.world.World> key) {
        Identifier id = key.getValue();
        if (id.equals(net.minecraft.world.World.OVERWORLD.getValue())) return "the Overworld";
        if (id.equals(net.minecraft.world.World.NETHER.getValue())) return "the Nether";
        if (id.equals(net.minecraft.world.World.END.getValue())) return "the End";
        String[] words = id.getPath().split("_");
        StringBuilder sb = new StringBuilder("the");
        for (String w : words) if (!w.isEmpty()) sb.append(' ').append(Character.toUpperCase(w.charAt(0))).append(w.substring(1));
        return sb.toString();
    }

    // ---------------------------------------------------------------------------------------
    // Drop index: which natural block drops which item (computed once from the loot tables,
    // so modded ores and blocks from the modpack work too).
    // ---------------------------------------------------------------------------------------

    private static Map<Item, Set<Block>> blocksByDrop;
    private static Map<Block, Set<Item>> dropsByBlock;

    public static void reset() {
        oreDimensions = null;
        blocksByDrop = null;
        dropsByBlock = null;
    }

    static void ensureIndex(MinecraftServer server) {
        if (blocksByDrop != null) return;
        long start = System.currentTimeMillis();
        Map<Item, Set<Block>> byDrop = new HashMap<>();
        Map<Block, Set<Item>> byBlock = new HashMap<>();
        ServerWorld world = server.getOverworld();
        ItemStack[] tools = {
                new ItemStack(Items.NETHERITE_PICKAXE), new ItemStack(Items.NETHERITE_AXE),
                new ItemStack(Items.NETHERITE_SHOVEL), new ItemStack(Items.NETHERITE_HOE), ItemStack.EMPTY};
        for (Block block : Registries.BLOCK) {
            BlockState state = block.getDefaultState();
            if (!isGatherable(state)) continue;
            Set<Item> drops = new HashSet<>();
            for (ItemStack tool : tools) {
                if (state.isToolRequired() && (tool.isEmpty() || !tool.isSuitableFor(state))) continue;
                try {
                    for (int roll = 0; roll < 3; roll++) {
                        for (ItemStack drop : Block.getDroppedStacks(state, world, BlockPos.ORIGIN, null, null, tool)) {
                            if (!drop.isEmpty()) drops.add(drop.getItem());
                        }
                    }
                } catch (Throwable t) {
                    // Some modded loot tables need real context. Skip them.
                }
            }
            byBlock.put(block, drops);
            for (Item item : drops) byDrop.computeIfAbsent(item, k -> new LinkedHashSet<>()).add(block);
        }
        blocksByDrop = byDrop;
        dropsByBlock = byBlock;
        HelperMod.LOG.info("Helper Buddies indexed {} natural blocks in {} ms", byBlock.size(),
                System.currentTimeMillis() - start);
    }

    // ---------------------------------------------------------------------------------------
    // Resolving what the player typed
    // ---------------------------------------------------------------------------------------

    /** What a job is looking for. */
    public static final class Spec {
        public final String display;
        public final Set<Block> blocks;
        /** Items that count toward the requested amount. */
        public final Set<Item> countItems;
        /** The block itself was asked for and normally drops nothing, so use silk touch if available. */
        public final boolean preferSilk;

        Spec(String display, Set<Block> blocks, Set<Item> countItems, boolean preferSilk) {
            this.display = display;
            this.blocks = blocks;
            this.countItems = countItems;
            this.preferSilk = preferSilk;
        }

        public boolean matches(BlockState state) {
            return blocks.contains(state.getBlock()) && isGatherable(state);
        }

        public boolean counts(ItemStack stack) {
            return countItems == null || countItems.contains(stack.getItem());
        }
    }

    public static final class ResolveException extends Exception {
        public ResolveException(String message) {
            super(message);
        }
    }

    public static Spec resolve(MinecraftServer server, String input) throws ResolveException {
        ensureIndex(server);
        String s = input.trim().toLowerCase(Locale.ROOT).replace(' ', '_');
        if (s.isEmpty()) throw new ResolveException("Tell me what to collect, like: /helper collect iron 32");
        s = ALIASES.getOrDefault(s, s);

        if (s.startsWith("#")) return resolveTag(s.substring(1), input);

        Item item = findItem(s);
        if (item == null) {
            throw new ResolveException("I don't know what \"" + input + "\" is. Try something like iron, "
                    + "oak_log, diamond, sand or cobblestone.");
        }
        return resolveItem(item);
    }

    private static Spec resolveTag(String id, String input) throws ResolveException {
        Identifier tagId = Identifier.tryParse(id.contains(":") ? id : "minecraft:" + id);
        if (tagId == null) throw new ResolveException("\"" + input + "\" isn't a valid tag.");
        TagKey<Block> tag = TagKey.of(RegistryKeys.BLOCK, tagId);
        Set<Block> blocks = new LinkedHashSet<>();
        for (Block block : Registries.BLOCK) {
            BlockState state = block.getDefaultState();
            if (state.isIn(tag) && isGatherable(state)) blocks.add(block);
        }
        if (blocks.isEmpty()) throw new ResolveException("There are no natural blocks in the tag #" + tagId + ".");
        String display = tagId.getPath().replace('_', ' ');
        return new Spec(display, blocks, null, false);
    }

    private static Item findItem(String s) {
        List<String> tries = new ArrayList<>();
        tries.add(s);
        if (!s.contains(":")) {
            tries.add("raw_" + s);
            tries.add(s + "_ore");
            tries.add(s + "_log");
            if (s.endsWith("s")) tries.add(s.substring(0, s.length() - 1));
        }
        for (String attempt : tries) {
            Item item = lookupItem(attempt);
            if (item != null) return item;
        }
        return null;
    }

    private static Item lookupItem(String s) {
        if (s.contains(":")) {
            Identifier id = Identifier.tryParse(s);
            if (id == null || !Registries.ITEM.containsId(id)) return null;
            return Registries.ITEM.get(id);
        }
        Identifier vanilla = Identifier.tryParse("minecraft:" + s);
        if (vanilla != null && Registries.ITEM.containsId(vanilla)) return Registries.ITEM.get(vanilla);
        // Modded item with the same name, e.g. "raw_tin".
        for (Identifier id : Registries.ITEM.getIds()) {
            if (id.getPath().equals(s)) return Registries.ITEM.get(id);
        }
        return null;
    }

    private static Spec resolveItem(Item item) throws ResolveException {
        String name = item.getName().getString();
        Set<Block> blocks = new LinkedHashSet<>();
        Set<Item> count = new HashSet<>();
        boolean preferSilk = false;

        if (item instanceof BlockItem blockItem && blockItem.getBlock() != Blocks.AIR
                && isGatherable(blockItem.getBlock().getDefaultState())) {
            Block block = blockItem.getBlock();
            blocks.add(block);
            Set<Item> drops = dropsByBlock.getOrDefault(block, Set.of());
            count.add(item);
            if (drops.contains(item)) {
                // e.g. dirt: also mine grass blocks, which drop dirt.
                blocks.addAll(blocksByDrop.getOrDefault(item, Set.of()));
            } else if (!drops.isEmpty()) {
                // e.g. iron_ore: mine every ore that drops raw iron (deepslate and modded variants too).
                count.addAll(drops);
                for (Item drop : drops) {
                    if (drop instanceof BlockItem) continue; // don't widen to everything that drops cobblestone
                    blocks.addAll(blocksByDrop.getOrDefault(drop, Set.of()));
                }
            } else {
                preferSilk = true; // e.g. glass-like blocks that only drop with silk touch
            }
        } else {
            // e.g. cobblestone (from stone), diamond (from diamond ores), flint (from gravel).
            Set<Block> sources = blocksByDrop.get(item);
            if ((sources == null || sources.isEmpty()) && item instanceof BlockItem) {
                throw new ResolveException("I only gather natural materials, so I won't take " + name
                        + " out of anyone's builds. Try what it's made from, like logs or stone.");
            }
            if (sources == null || sources.isEmpty()) {
                throw new ResolveException("I can't mine " + name + " directly. I can gather blocks and ores, "
                        + "like iron, coal, diamond, oak_log, sand or stone.");
            }
            blocks.addAll(sources);
            count.add(item);
        }
        return new Spec(name, blocks, count, preferSilk);
    }
}
