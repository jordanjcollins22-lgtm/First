package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.NonNullList;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.FloatTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.tags.BlockTags;
import net.minecraft.world.ContainerHelper;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.EntityTypes;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.DyeColor;
import net.minecraft.world.item.DyeItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.LightBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.level.saveddata.SavedDataType;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.EntityHitResult;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Furniture for every room, built from vanilla block display entities so it needs nothing on the client (players
 * without the mod see it too). Each piece is a few scaled blocks, an invisible interaction box per block it covers (to
 * click and punch it), and for solid pieces an invisible barrier so you can't walk through it.
 *
 * Customize by right-clicking a piece with: planks (the wood), a log (the legs and frame), wool or a dye (the fabric), or
 * any other full block (the top: counters, tables, the back of the shower...). Sneak + empty hand turns it. Empty hand
 * uses it: sit on chairs, sofas, toilets and benches; open cupboards; switch lamps, the TV, taps, the stove and showers
 * on and off. Punch it to pick it up (it keeps its materials).
 */
final class Furniture {
    private Furniture() {}

    // ---------------------------------------------------------------------------------------
    // What each piece is made of
    // ---------------------------------------------------------------------------------------

    /** Which material a part uses. WOOD, LEGS, FABRIC and TOP can be changed; the others are fixed or switch on/off. */
    enum Role { WOOD, LEGS, FABRIC, TOP, WHITE, BLACK, GRAY, METAL, GLASS, WATER, SCREEN, LIGHT, BURNER, BOOKS, PLANT, POT }

    enum Use { NONE, SEAT, STORAGE, LIGHT, TV, WATER, STOVE, SHOWER }

    private record Part(Role role, float x1, float y1, float z1, float x2, float y2, float z2) {}

    record Piece(String id, String room, String name, Item icon, int price, int width, int height, boolean solid,
                 Use use, float seat, List<Part> parts) {}

    private static final class Builder {
        final String id, room, name;
        final Item icon;
        int price = 40, width = 1, height = 1;
        boolean solid;
        Use use = Use.NONE;
        float seat = -1;
        final List<Part> parts = new ArrayList<>();

        Builder(String id, String room, String name, Item icon) {
            this.id = id;
            this.room = room;
            this.name = name;
            this.icon = icon;
        }

        Builder p(Role r, double x1, double y1, double z1, double x2, double y2, double z2) {
            parts.add(new Part(r, (float) x1, (float) y1, (float) z1, (float) x2, (float) y2, (float) z2));
            return this;
        }

        Builder size(int w, int h) { width = w; height = h; return this; }
        Builder solid() { solid = true; return this; }
        Builder use(Use u) { use = u; return this; }
        Builder seat(double h) { use = Use.SEAT; seat = (float) h; return this; }
        Builder price(int c) { price = c; return this; }
        Piece done() { return new Piece(id, room, name, icon, price, width, height, solid, use, seat, List.copyOf(parts)); }
    }

    private static Builder b(String id, String room, String name, Item icon) {
        return new Builder(id, room, name, icon);
    }

    static final String[] ROOMS = {"Kitchen", "Living room", "Dining room", "Bedroom", "Bathroom", "Other"};
    private static final Item[] ROOM_ICONS = {Items.SMOKER, Items.BED.red(), Items.OAK_STAIRS, Items.BED.white(), Items.CAULDRON, Items.FLOWER_POT};

    // Pixel coordinates (0-16 per block). The front faces the player who placed it; extra blocks go to their left.
    static final List<Piece> PIECES = List.of(
            // Kitchen
            b("counter", "Kitchen", "Kitchen Counter (storage)", Items.BARREL).solid().use(Use.STORAGE).price(40)
                    .p(Role.WOOD, 0, 0, 2, 16, 14, 16).p(Role.LEGS, 1, 1, 1, 15, 13, 2).p(Role.METAL, 6, 10, 0.5, 10, 11, 1)
                    .p(Role.TOP, 0, 14, 0, 16, 16, 16).done(),
            b("kitchen_sink", "Kitchen", "Kitchen Sink (tap on/off, fill bottles)", Items.CAULDRON).solid().use(Use.WATER).price(60)
                    .p(Role.WOOD, 0, 0, 2, 16, 12, 16).p(Role.LEGS, 1, 1, 1, 15, 11, 2).p(Role.METAL, 6, 8, 0.5, 10, 9, 1)
                    .p(Role.TOP, 0, 12, 0, 16, 16, 3).p(Role.TOP, 0, 12, 13, 16, 16, 16).p(Role.TOP, 0, 12, 3, 3, 16, 13)
                    .p(Role.TOP, 13, 12, 3, 16, 16, 13).p(Role.METAL, 3, 12, 3, 13, 12.5, 13).p(Role.WATER, 3, 12.5, 3, 13, 14, 13)
                    .p(Role.METAL, 7, 16, 13, 9, 20, 15).p(Role.METAL, 7, 19, 9, 9, 20, 13).done(),
            b("stove", "Kitchen", "Stove (switch the burners on)", Items.SMOKER).solid().use(Use.STOVE).price(80)
                    .p(Role.WHITE, 0, 0, 1, 16, 14, 16).p(Role.BLACK, 2, 2, 0.5, 14, 11, 1).p(Role.METAL, 3, 12, 0.5, 13, 12.8, 1)
                    .p(Role.BLACK, 0, 14, 0, 16, 15, 16).p(Role.BURNER, 2, 15, 2, 6.5, 15.4, 6.5).p(Role.BURNER, 9.5, 15, 2, 14, 15.4, 6.5)
                    .p(Role.BURNER, 2, 15, 9.5, 6.5, 15.4, 14).p(Role.BURNER, 9.5, 15, 9.5, 14, 15.4, 14).done(),
            b("fridge", "Kitchen", "Fridge (storage)", Items.IRON_DOOR).size(1, 2).solid().use(Use.STORAGE).price(100)
                    .p(Role.WHITE, 0, 0, 1, 16, 31, 16).p(Role.GRAY, 0, 20, 0.5, 16, 20.5, 1)
                    .p(Role.METAL, 12, 22, 0, 13, 29, 1).p(Role.METAL, 12, 8, 0, 13, 18, 1).done(),
            b("wall_cabinet", "Kitchen", "Wall Cabinet (storage, hang it up high)", Items.SPRUCE_TRAPDOOR).use(Use.STORAGE).price(40)
                    .p(Role.WOOD, 0, 4, 8, 16, 16, 16).p(Role.LEGS, 1, 5, 7, 15, 15, 8).p(Role.METAL, 6, 6, 6.5, 10, 7, 7).done(),
            // Living room
            b("sofa", "Living room", "Sofa (2 seats)", Items.BED.red()).size(2, 1).seat(9).price(90)
                    .p(Role.FABRIC, 0, 0, 2, 32, 7, 16).p(Role.FABRIC, 1, 7, 3, 15.6, 9, 13).p(Role.FABRIC, 16.4, 7, 3, 31, 9, 13)
                    .p(Role.FABRIC, 0, 7, 12, 32, 18, 16).p(Role.FABRIC, 0, 7, 2, 2, 13, 12).p(Role.FABRIC, 30, 7, 2, 32, 13, 12)
                    .p(Role.LEGS, 1, -1, 3, 3, 0, 5).p(Role.LEGS, 29, -1, 3, 31, 0, 5).done(),
            b("armchair", "Living room", "Armchair", Items.WOOL.red()).seat(9).price(60)
                    .p(Role.FABRIC, 0, 0, 2, 16, 7, 16).p(Role.FABRIC, 2, 7, 3, 14, 9, 13).p(Role.FABRIC, 0, 7, 12, 16, 18, 16)
                    .p(Role.FABRIC, 0, 7, 2, 2, 13, 12).p(Role.FABRIC, 14, 7, 2, 16, 13, 12).done(),
            b("coffee_table", "Living room", "Coffee Table", Items.OAK_PRESSURE_PLATE).price(40)
                    .p(Role.WOOD, 1, 6, 3, 15, 8, 13).p(Role.LEGS, 2, 0, 4, 4, 6, 6).p(Role.LEGS, 12, 0, 4, 14, 6, 6)
                    .p(Role.LEGS, 2, 0, 10, 4, 6, 12).p(Role.LEGS, 12, 0, 10, 14, 6, 12).done(),
            b("tv", "Living room", "TV (switch it on)", Items.CONCRETE.black()).use(Use.TV).price(120)
                    .p(Role.BLACK, 5, 0, 7, 11, 1, 12).p(Role.BLACK, 7, 1, 9, 9, 5, 10).p(Role.BLACK, -4, 5, 9, 20, 18, 10)
                    .p(Role.SCREEN, -3, 6, 8.8, 19, 17, 9).done(),
            b("tv_stand", "Living room", "TV Stand (storage)", Items.SPRUCE_SLAB).size(2, 1).solid().use(Use.STORAGE).price(70)
                    .p(Role.WOOD, 0, 0, 2, 32, 9, 16).p(Role.LEGS, 1, 1, 1, 15.6, 8, 2).p(Role.LEGS, 16.4, 1, 1, 31, 8, 2)
                    .p(Role.METAL, 13, 4, 0.5, 15, 5, 1).p(Role.METAL, 17, 4, 0.5, 19, 5, 1).done(),
            b("floor_lamp", "Living room", "Floor Lamp (switch it on)", Items.LANTERN).size(1, 2).use(Use.LIGHT).price(50)
                    .p(Role.LEGS, 5, 0, 5, 11, 1, 11).p(Role.METAL, 7.5, 1, 7.5, 8.5, 23, 8.5).p(Role.FABRIC, 3, 22, 3, 13, 30, 13)
                    .p(Role.LIGHT, 5.5, 21, 5.5, 10.5, 22, 10.5).done(),
            b("bookshelf", "Living room", "Tall Bookshelf (storage)", Items.BOOKSHELF).size(1, 2).solid().use(Use.STORAGE).price(70)
                    .p(Role.WOOD, 0, 0, 4, 1, 32, 16).p(Role.WOOD, 15, 0, 4, 16, 32, 16).p(Role.WOOD, 1, 0, 15, 15, 32, 16)
                    .p(Role.WOOD, 1, 0, 4, 15, 1, 15).p(Role.WOOD, 1, 10.5, 4, 15, 11.5, 15).p(Role.WOOD, 1, 21, 4, 15, 22, 15)
                    .p(Role.WOOD, 1, 31, 4, 15, 32, 15).p(Role.BOOKS, 1.5, 1, 6, 14.5, 10.5, 15).p(Role.BOOKS, 1.5, 11.5, 6, 14.5, 21, 15)
                    .p(Role.BOOKS, 1.5, 22, 6, 14.5, 31, 15).done(),
            // Dining room
            b("dining_table", "Dining room", "Dining Table", Items.OAK_SLAB).size(2, 1).solid().price(70)
                    .p(Role.WOOD, 0, 14, 0, 32, 16, 16).p(Role.LEGS, 1, 0, 1, 3, 14, 3).p(Role.LEGS, 29, 0, 1, 31, 14, 3)
                    .p(Role.LEGS, 1, 0, 13, 3, 14, 15).p(Role.LEGS, 29, 0, 13, 31, 14, 15).done(),
            b("dining_chair", "Dining room", "Dining Chair", Items.OAK_STAIRS).seat(10).price(30)
                    .p(Role.LEGS, 3, 0, 3, 5, 8, 5).p(Role.LEGS, 11, 0, 3, 13, 8, 5).p(Role.LEGS, 3, 0, 11, 5, 8, 13)
                    .p(Role.LEGS, 11, 0, 11, 13, 8, 13).p(Role.WOOD, 2, 8, 2, 14, 10, 14).p(Role.FABRIC, 3, 10, 3, 13, 10.8, 12)
                    .p(Role.WOOD, 2, 10, 12, 14, 22, 14).done(),
            b("cupboard", "Dining room", "Glass Cupboard (storage)", Items.GLASS_PANE).size(1, 2).solid().use(Use.STORAGE).price(80)
                    .p(Role.WOOD, 0, 0, 2, 16, 14, 16).p(Role.LEGS, 1, 1, 1, 15, 13, 2).p(Role.TOP, 0, 14, 0, 16, 15, 16)
                    .p(Role.WOOD, 0, 15, 8, 16, 30, 16).p(Role.GLASS, 1, 16, 7.5, 15, 29, 8).p(Role.WOOD, 0, 30, 7, 16, 31, 16).done(),
            // Bedroom
            b("wardrobe", "Bedroom", "Wardrobe (storage)", Items.SPRUCE_DOOR).size(1, 2).solid().use(Use.STORAGE).price(90)
                    .p(Role.WOOD, 0, 0, 2, 16, 31, 16).p(Role.LEGS, 0.5, 1, 1, 7.8, 30, 2).p(Role.LEGS, 8.2, 1, 1, 15.5, 30, 2)
                    .p(Role.METAL, 6.5, 14, 0.5, 7.3, 18, 1).p(Role.METAL, 8.7, 14, 0.5, 9.5, 18, 1).done(),
            b("bedside_table", "Bedroom", "Bedside Table with Lamp (storage)", Items.SPRUCE_PLANKS).solid().use(Use.STORAGE).price(40)
                    .p(Role.WOOD, 1, 0, 2, 15, 10, 15).p(Role.LEGS, 2, 5, 1, 14, 9, 2).p(Role.METAL, 7.5, 6.5, 0.5, 8.5, 7.5, 1)
                    .p(Role.LEGS, 7, 10, 8, 9, 12, 10).p(Role.FABRIC, 5, 12, 6, 11, 16, 12).done(),
            b("dresser", "Bedroom", "Dresser (storage)", Items.CHEST).size(2, 1).solid().use(Use.STORAGE).price(80)
                    .p(Role.WOOD, 0, 0, 3, 32, 14, 16).p(Role.LEGS, 1, 1, 2, 31, 4.5, 3).p(Role.LEGS, 1, 5, 2, 31, 8.5, 3)
                    .p(Role.LEGS, 1, 9, 2, 31, 12.5, 3).p(Role.METAL, 15, 2.5, 1.5, 17, 3.2, 2).p(Role.METAL, 15, 6.5, 1.5, 17, 7.2, 2)
                    .p(Role.METAL, 15, 10.5, 1.5, 17, 11.2, 2).p(Role.TOP, 0, 14, 2, 32, 15, 16).done(),
            b("desk", "Bedroom", "Desk", Items.CRAFTING_TABLE).size(2, 1).solid().price(70)
                    .p(Role.WOOD, 0, 13, 0, 32, 15, 16).p(Role.WOOD, 0, 0, 1, 2, 13, 15).p(Role.WOOD, 22, 0, 1, 32, 13, 15)
                    .p(Role.LEGS, 23, 1, 0.5, 31, 6, 1).p(Role.LEGS, 23, 7, 0.5, 31, 12, 1).done(),
            b("headboard", "Bedroom", "Bed Headboard (put it behind a bed)", Items.BED.white()).size(2, 1).price(40)
                    .p(Role.LEGS, 0, 0, 14, 2, 22, 16).p(Role.LEGS, 30, 0, 14, 32, 22, 16).p(Role.FABRIC, 2, 6, 14.5, 30, 20, 15.5)
                    .p(Role.WOOD, 0, 20, 14, 32, 22, 16).done(),
            b("vanity", "Bedroom", "Vanity Table with Mirror", Items.GLASS).solid().price(70)
                    .p(Role.WOOD, 0, 0, 3, 16, 12, 16).p(Role.LEGS, 1, 7, 2, 15, 11, 3).p(Role.WOOD, 1, 12, 13, 15, 27, 15)
                    .p(Role.GLASS, 2, 13, 12.8, 14, 26, 13).done(),
            // Bathroom
            b("toilet", "Bathroom", "Toilet", Items.CONCRETE.white()).seat(9.5).price(40)
                    .p(Role.WHITE, 5, 0, 4, 11, 6, 12).p(Role.WHITE, 3, 6, 2, 13, 9, 12).p(Role.WOOD, 3, 9, 2, 13, 9.5, 12)
                    .p(Role.WHITE, 2, 8, 12, 14, 18, 16).p(Role.METAL, 11, 16, 11.5, 13, 17, 12).done(),
            b("bathtub", "Bathroom", "Bathtub (click the tap end for water, the other end to sit)", Items.QUARTZ_SLAB).size(2, 1).seat(3)
                    .use(Use.WATER).price(90)
                    .p(Role.WHITE, 0, 0, 0, 32, 2, 16).p(Role.WHITE, 0, 2, 0, 32, 10, 2).p(Role.WHITE, 0, 2, 14, 32, 10, 16)
                    .p(Role.WHITE, 0, 2, 2, 2, 10, 14).p(Role.WHITE, 30, 2, 2, 32, 10, 14).p(Role.WATER, 2, 2, 2, 30, 8, 14)
                    .p(Role.METAL, 30.5, 10, 7, 31.5, 13, 9).p(Role.METAL, 28.5, 12, 7, 30.5, 13, 9).done(),
            b("bathroom_sink", "Bathroom", "Bathroom Sink with Mirror (tap on/off)", Items.QUARTZ_PILLAR).use(Use.WATER).price(50)
                    .p(Role.WHITE, 6, 0, 8, 10, 10, 12).p(Role.WHITE, 2, 10, 4, 14, 11, 16).p(Role.WHITE, 2, 11, 4, 14, 14, 5)
                    .p(Role.WHITE, 2, 11, 15, 14, 14, 16).p(Role.WHITE, 2, 11, 5, 3, 14, 15).p(Role.WHITE, 13, 11, 5, 14, 14, 15)
                    .p(Role.WATER, 3, 11, 5, 13, 13, 15).p(Role.METAL, 7, 14, 13, 9, 18, 15).p(Role.METAL, 7, 17, 10, 9, 18, 13)
                    .p(Role.WOOD, 1, 19, 15, 15, 32, 16).p(Role.GLASS, 2, 20, 14.8, 14, 31, 15).done(),
            b("shower", "Bathroom", "Shower (switch it on)", Items.STAINED_GLASS.lightBlue()).size(1, 2).use(Use.SHOWER).price(90)
                    .p(Role.WHITE, 0, 0, 0, 16, 1, 16).p(Role.GLASS, 0, 1, 0, 0.5, 30, 16).p(Role.GLASS, 15.5, 1, 0, 16, 30, 16)
                    .p(Role.TOP, 0, 1, 15.5, 16, 30, 16).p(Role.METAL, 7, 28, 10, 9, 29, 15.5).p(Role.METAL, 6, 27, 8, 10, 28, 12).done(),
            b("towel_rack", "Bathroom", "Towel Rack (hang it on a wall)", Items.BANNER.white()).price(20)
                    .p(Role.METAL, 1, 12, 14, 2, 13, 16).p(Role.METAL, 14, 12, 14, 15, 13, 16).p(Role.METAL, 1, 12, 13.5, 15, 13, 14.5)
                    .p(Role.FABRIC, 2, 3, 13.8, 14, 12.5, 14.3).done(),
            // Other
            b("office_chair", "Other", "Office Chair", Items.WOOL.black()).seat(9).price(50)
                    .p(Role.METAL, 2, 0, 7, 14, 1, 9).p(Role.METAL, 7, 0, 2, 9, 1, 14).p(Role.METAL, 7, 1, 7, 9, 7, 9)
                    .p(Role.FABRIC, 2, 7, 2, 14, 9, 14).p(Role.FABRIC, 3, 9, 12, 13, 22, 14).done(),
            b("garden_bench", "Other", "Garden Bench (2 seats)", Items.OAK_FENCE).size(2, 1).seat(9).price(50)
                    .p(Role.METAL, 1, 0, 3, 3, 8, 13).p(Role.METAL, 29, 0, 3, 31, 8, 13).p(Role.WOOD, 0, 8, 2, 32, 9, 6)
                    .p(Role.WOOD, 0, 8, 7, 32, 9, 11).p(Role.WOOD, 0, 8, 12, 32, 9, 15).p(Role.WOOD, 0, 10, 14, 32, 13, 15)
                    .p(Role.WOOD, 0, 15, 14, 32, 18, 15).p(Role.METAL, 1, 8, 14, 3, 19, 16).p(Role.METAL, 29, 8, 14, 31, 19, 16).done(),
            b("plant_pot", "Other", "Big Potted Plant", Items.FLOWER_POT).price(20)
                    .p(Role.POT, 4, 0, 4, 12, 8, 12).p(Role.PLANT, 2, 8, 2, 14, 20, 14).done(),
            b("ceiling_light", "Other", "Ceiling Light (switch it on)", Items.GLOWSTONE).use(Use.LIGHT).price(40)
                    .p(Role.METAL, 7.5, 10, 7.5, 8.5, 16, 8.5).p(Role.FABRIC, 4, 6, 4, 12, 10, 12).p(Role.LIGHT, 6, 5, 6, 10, 6, 10).done(),
            b("wall_clock", "Other", "Wall Clock", Items.CLOCK).price(30)
                    .p(Role.WOOD, 3, 4, 15, 13, 14, 16).p(Role.WHITE, 4, 5, 14.8, 12, 13, 15).p(Role.BLACK, 7.5, 9, 14.6, 8.5, 12, 14.8)
                    .p(Role.BLACK, 8, 8.5, 14.6, 11, 9.5, 14.8).done());

    static Piece piece(String id) {
        for (Piece p : PIECES) if (p.id().equals(id)) return p;
        return null;
    }

    // ---------------------------------------------------------------------------------------
    // Placed furniture, saved with the world
    // ---------------------------------------------------------------------------------------

    static final class Placed {
        String type, world;
        BlockPos pos;
        int rot;
        String wood = "minecraft:oak_planks", legs = "", fabric = "minecraft:red_wool", top = "minecraft:smooth_quartz";
        boolean on;
        SimpleContainer storage;

        CompoundTag materials() {
            CompoundTag m = new CompoundTag();
            m.putString("type", type);
            m.putString("wood", wood);
            m.putString("legs", legs);
            m.putString("fabric", fabric);
            m.putString("top", top);
            return m;
        }

        void readMaterials(CompoundTag m) {
            if (m.contains("wood")) wood = m.getStringOr("wood", "");
            if (m.contains("legs")) legs = m.getStringOr("legs", "");
            if (m.contains("fabric")) fabric = m.getStringOr("fabric", "");
            if (m.contains("top")) top = m.getStringOr("top", "");
        }
    }

    static final class Data extends SavedData {
        private static final String ID = "helpermod_furniture";
        private static final SavedDataType<Data> TYPE = Compat.dataType(ID, Data::new, Data::fromNbt, d -> d.save(new CompoundTag()));
        final Map<UUID, Placed> placed = new LinkedHashMap<>();

        static Data get(MinecraftServer server) {
            return server.overworld().getDataStorage().computeIfAbsent(TYPE);
        }

        private static Data fromNbt(CompoundTag nbt) {
            Data d = new Data();
            ListTag list = nbt.getListOrEmpty("pieces");
            for (int i = 0; i < list.size(); i++) {
                CompoundTag c = list.getCompoundOrEmpty(i);
                Placed p = new Placed();
                p.type = c.getStringOr("type", "");
                p.world = c.getStringOr("world", "");
                p.pos = BlockPos.of(c.getLongOr("pos", 0L));
                p.rot = c.getIntOr("rot", 0);
                p.readMaterials(c);
                p.on = c.getBooleanOr("on", false);
                if (c.contains("items")) {
                    NonNullList<ItemStack> items = NonNullList.withSize(27, ItemStack.EMPTY);
                    Compat.loadItems(c.getCompoundOrEmpty("items"), items);
                    p.storage = new SimpleContainer(27);
                    for (int s = 0; s < 27; s++) p.storage.setItem(s, items.get(s));
                }
                d.placed.put(Compat.getUUID(c, "id"), p);
            }
            return d;
        }

        /** Items in storage furniture change without telling the saved data, so always save. */
        @Override
        public boolean isDirty() {
            return true;
        }

        public CompoundTag save(CompoundTag nbt) {
            ListTag list = new ListTag();
            for (Map.Entry<UUID, Placed> e : placed.entrySet()) {
                Placed p = e.getValue();
                CompoundTag c = p.materials();
                Compat.putUUID(c, "id", e.getKey());
                c.putString("world", p.world);
                c.putLong("pos", p.pos.asLong());
                c.putInt("rot", p.rot);
                c.putBoolean("on", p.on);
                if (p.storage != null && !p.storage.isEmpty()) {
                    NonNullList<ItemStack> items = NonNullList.withSize(27, ItemStack.EMPTY);
                    for (int s = 0; s < 27; s++) items.set(s, p.storage.getItem(s));
                    c.put("items", Compat.saveItems(items));
                }
                list.add(c);
            }
            nbt.put("pieces", list);
            return nbt;
        }
    }

    // ---------------------------------------------------------------------------------------
    // Items
    // ---------------------------------------------------------------------------------------

    private static final String ITEM_TAG = "HelperFurniture";
    private static final String PART_TAG = "hfurn";
    private static final String SEAT_TAG = "hfurnseat";

    static ItemStack item(Piece piece, CompoundTag materials) {
        ItemStack stack = new ItemStack(piece.icon());
        CompoundTag m = materials == null ? new CompoundTag() : materials.copy();
        m.putString("type", piece.id());
        Compat.editTag(stack, t -> t.put(ITEM_TAG, m));
        stack.set(net.minecraft.core.component.DataComponents.CUSTOM_NAME, Component.literal(piece.name()).withStyle(s -> s.withItalic(false)).withStyle(ChatFormatting.GOLD));
        Compat.lore(stack, java.util.List.of(Component.literal(piece.room() + " furniture. Right-click a block to place it.")
                .withStyle(s -> s.withItalic(false)).withStyle(ChatFormatting.GRAY)));
        return stack;
    }

    private static CompoundTag furnitureOf(ItemStack stack) {
        if (!Compat.hasTag(stack) || !Compat.tag(stack).contains(ITEM_TAG)) return null;
        return Compat.tag(stack).getCompoundOrEmpty(ITEM_TAG);
    }

    // ---------------------------------------------------------------------------------------
    // Building the pieces out of block displays
    // ---------------------------------------------------------------------------------------

    private static String stripped(String planks) {
        Identifier id = Identifier.tryParse(planks);
        if (id == null || !id.getPath().endsWith("_planks")) return planks;
        String wood = id.getPath().substring(0, id.getPath().length() - "_planks".length());
        for (String candidate : new String[]{"stripped_" + wood + "_log", "stripped_" + wood + "_stem", "stripped_" + wood + "_block"}) {
            Identifier c = Identifier.fromNamespaceAndPath(id.getNamespace(), candidate);
            if (BuiltInRegistries.BLOCK.containsKey(c)) return c.toString();
        }
        return planks;
    }

    private static BlockState state(String id, BlockState fallback) {
        Identifier key = Identifier.tryParse(id);
        if (key == null || !BuiltInRegistries.BLOCK.containsKey(key)) return fallback;
        return BuiltInRegistries.BLOCK.getValue(key).defaultBlockState();
    }

    private static BlockState stateFor(Role role, Placed p) {
        return switch (role) {
            case WOOD -> state(p.wood, Blocks.OAK_PLANKS.defaultBlockState());
            case LEGS -> state(p.legs.isEmpty() ? stripped(p.wood) : p.legs, Blocks.STRIPPED_OAK_LOG.defaultBlockState());
            case FABRIC -> state(p.fabric, Blocks.WOOL.red().defaultBlockState());
            case TOP -> state(p.top, Blocks.SMOOTH_QUARTZ.defaultBlockState());
            case WHITE -> Blocks.CONCRETE.white().defaultBlockState();
            case BLACK -> Blocks.CONCRETE.black().defaultBlockState();
            case GRAY -> Blocks.CONCRETE.lightGray().defaultBlockState();
            case METAL -> Blocks.IRON_BLOCK.defaultBlockState();
            case GLASS -> Blocks.STAINED_GLASS.lightBlue().defaultBlockState();
            case WATER -> p.on ? Blocks.STAINED_GLASS.blue().defaultBlockState() : null;
            case SCREEN -> p.on ? Blocks.CONCRETE.lightBlue().defaultBlockState() : Blocks.CONCRETE.gray().defaultBlockState();
            case LIGHT -> p.on ? Blocks.GLOWSTONE.defaultBlockState() : Blocks.STAINED_GLASS.white().defaultBlockState();
            case BURNER -> p.on ? Blocks.MAGMA_BLOCK.defaultBlockState() : Blocks.CONCRETE.gray().defaultBlockState();
            case BOOKS -> Blocks.BOOKSHELF.defaultBlockState();
            case PLANT -> Blocks.FLOWERING_AZALEA_LEAVES.defaultBlockState();
            case POT -> Blocks.TERRACOTTA.defaultBlockState();
        };
    }

    private static boolean glows(Role role, Placed p) {
        return p.on && (role == Role.SCREEN || role == Role.LIGHT || role == Role.BURNER);
    }

    /** Turn a point in the piece's own pixels (front facing north) by rot quarter turns clockwise, about the first block's centre. */
    private static float[] turn(float x, float z, int rot) {
        for (int i = 0; i < rot; i++) {
            float nx = 16 - z;
            z = x;
            x = nx;
        }
        return new float[]{x, z};
    }

    /** The blocks a piece covers, relative to where it was placed. */
    static List<BlockPos> cells(Piece piece, int rot) {
        List<BlockPos> out = new ArrayList<>();
        for (int x = 0; x < piece.width(); x++) {
            for (int y = 0; y < piece.height(); y++) {
                float[] c = turn(x * 16 + 8, 8, rot);
                out.add(new BlockPos((int) Math.floor(c[0] / 16), y, (int) Math.floor(c[1] / 16)));
            }
        }
        return out;
    }

    private static ListTag floats(float... f) {
        ListTag l = new ListTag();
        for (float v : f) l.add(FloatTag.valueOf(v));
        return l;
    }

    private static ListTag tags(String... t) {
        ListTag l = new ListTag();
        for (String s : t) l.add(StringTag.valueOf(s));
        return l;
    }

    private static Entity spawn(ServerLevel world, CompoundTag nbt, double x, double y, double z, float yaw) {
        Entity e = Compat.loadEntity(nbt, world, entity -> {
            entity.snapTo(x, y, z, yaw, 0);
            return entity;
        });
        if (e != null) world.addFreshEntity(e);
        return e;
    }

    private static void build(ServerLevel world, UUID id, Placed p) {
        Piece piece = piece(p.type);
        if (piece == null) return;
        String tag = PART_TAG + ":" + id;
        BlockPos o = p.pos;
        for (Part part : piece.parts()) {
            BlockState st = stateFor(part.role(), p);
            if (st == null) continue;
            float[] a = turn(part.x1(), part.z1(), p.rot), c = turn(part.x2(), part.z2(), p.rot);
            float x1 = Math.min(a[0], c[0]), x2 = Math.max(a[0], c[0]), z1 = Math.min(a[1], c[1]), z2 = Math.max(a[1], c[1]);
            CompoundTag nbt = new CompoundTag();
            nbt.putString("id", "minecraft:block_display");
            CompoundTag bs = new CompoundTag();
            bs.putString("Name", BuiltInRegistries.BLOCK.getKey(st.getBlock()).toString());
            nbt.put("block_state", bs);
            CompoundTag tf = new CompoundTag();
            tf.put("translation", floats(x1 / 16f, part.y1() / 16f, z1 / 16f));
            tf.put("scale", floats((x2 - x1) / 16f, (part.y2() - part.y1()) / 16f, (z2 - z1) / 16f));
            tf.put("left_rotation", floats(0, 0, 0, 1));
            tf.put("right_rotation", floats(0, 0, 0, 1));
            nbt.put("transformation", tf);
            nbt.putFloat("width", 3);
            nbt.putFloat("height", 3);
            if (glows(part.role(), p)) {
                CompoundTag light = new CompoundTag();
                light.putInt("block", 15);
                light.putInt("sky", 15);
                nbt.put("brightness", light);
            }
            nbt.put("Tags", tags(PART_TAG, tag));
            spawn(world, nbt, o.getX(), o.getY(), o.getZ(), 0);
        }
        for (BlockPos rel : cells(piece, p.rot)) {
            BlockPos cell = o.offset(rel);
            CompoundTag nbt = new CompoundTag();
            nbt.putString("id", "minecraft:interaction");
            nbt.putFloat("width", 1.02f);
            nbt.putFloat("height", 1.02f);
            nbt.putBoolean("response", true);
            nbt.put("Tags", tags(PART_TAG, tag));
            spawn(world, nbt, cell.getX() + 0.5, cell.getY() - 0.01, cell.getZ() + 0.5, 0);
            if (piece.solid() && world.getBlockState(cell).canBeReplaced()) world.setBlockAndUpdate(cell, Blocks.BARRIER.defaultBlockState());
        }
        if (piece.use() == Use.LIGHT) {
            BlockPos lightAt = piece.height() > 1 ? o.above() : o;
            BlockState here = world.getBlockState(lightAt);
            if (p.on && (here.isAir() || here.is(Blocks.LIGHT))) {
                world.setBlockAndUpdate(lightAt, Blocks.LIGHT.defaultBlockState().setValue(LightBlock.LEVEL, 15));
            } else if (!p.on && here.is(Blocks.LIGHT)) {
                world.setBlockAndUpdate(lightAt, Blocks.AIR.defaultBlockState());
            }
        }
    }

    private static void clearEntities(ServerLevel world, UUID id, Placed p) {
        String tag = PART_TAG + ":" + id;
        AABB box = new AABB(p.pos).inflate(4);
        for (Entity e : world.getEntitiesOfClass(Entity.class, box, e -> e.entityTags().contains(tag))) e.discard();
    }

    private static void rebuild(ServerLevel world, UUID id, Placed p) {
        clearEntities(world, id, p);
        build(world, id, p);
    }

    // ---------------------------------------------------------------------------------------
    // Placing, using, customizing and picking up
    // ---------------------------------------------------------------------------------------

    private static ResourceKey<Level> worldKey(String id) {
        return ResourceKey.create(Registries.DIMENSION, Identifier.parse(id));
    }

    static InteractionResult onUseItem(Player p, Level w, InteractionHand hand) {
        ItemStack stack = p.getItemInHand(hand);
        if (furnitureOf(stack) == null) return InteractionResult.PASS;
        if (!w.isClientSide() && p instanceof ServerPlayer player) player.sendOverlayMessage(Component.literal("Right-click a block to put it there.")
                .withStyle(ChatFormatting.YELLOW));
        return InteractionResult.SUCCESS;
    }

    static InteractionResult onUseBlock(Player p, Level w, InteractionHand hand, BlockHitResult hit) {
        ItemStack stack = p.getItemInHand(hand);
        CompoundTag m = furnitureOf(stack);
        if (m == null) return InteractionResult.PASS;
        if (w.isClientSide()) return InteractionResult.SUCCESS;
        if (!(p instanceof ServerPlayer player) || p instanceof FakePlayer) return InteractionResult.SUCCESS;
        Piece piece = piece(m.getStringOr("type", ""));
        if (piece == null) return InteractionResult.SUCCESS;
        ServerLevel world = (ServerLevel) w;
        BlockPos pos = hit.getBlockPos();
        if (!world.getBlockState(pos).canBeReplaced()) pos = pos.relative(hit.getDirection());
        Direction front = player.getDirection().getOpposite();
        int rot = switch (front) { case EAST -> 1; case SOUTH -> 2; case WEST -> 3; default -> 0; };
        for (BlockPos rel : cells(piece, rot)) {
            BlockPos cell = pos.offset(rel);
            if (!world.getBlockState(cell).canBeReplaced() || !world.getEntitiesOfClass(Entity.class, new AABB(cell),
                    e -> e.entityTags().contains(PART_TAG) && e.getType() == EntityTypes.INTERACTION).isEmpty()) {
                player.sendOverlayMessage(Component.literal("There isn't room for the " + piece.name() + " there.").withStyle(ChatFormatting.RED));
                return InteractionResult.SUCCESS;
            }
        }
        Placed placed = new Placed();
        placed.type = piece.id();
        placed.world = world.dimension().identifier().toString();
        placed.pos = pos.immutable();
        placed.rot = rot;
        placed.readMaterials(m);
        if (piece.use() == Use.STORAGE) placed.storage = new SimpleContainer(27);
        Data data = Data.get(world.getServer());
        UUID id = UUID.randomUUID();
        
        data.placed.put(id, placed);
        data.setDirty();
        build(world, id, placed);
        if (!player.isCreative()) stack.shrink(1);
        world.playSound(null, pos, SoundEvents.WOOD_PLACE, SoundSource.BLOCKS, 1f, 1f);
        Compat.swing(player, hand);
        return InteractionResult.SUCCESS;
    }

    private static UUID idOf(Entity e) {
        for (String t : e.entityTags()) {
            if (t.startsWith(PART_TAG + ":")) {
                try {
                    return UUID.fromString(t.substring(PART_TAG.length() + 1));
                } catch (IllegalArgumentException ignored) {
                    return null;
                }
            }
        }
        return null;
    }

    /** Punch a piece to pick it up. */
    static InteractionResult onAttackEntity(Player p, Level w, InteractionHand hand, Entity entity, EntityHitResult hit) {
        if (entity.getType() != EntityTypes.INTERACTION || !entity.entityTags().contains(PART_TAG)) return InteractionResult.PASS;
        if (w.isClientSide() || !(p instanceof ServerPlayer player) || p instanceof FakePlayer) return InteractionResult.SUCCESS;
        UUID id = idOf(entity);
        ServerLevel world = (ServerLevel) w;
        Data data = Data.get(world.getServer());
        Placed placed = id == null ? null : data.placed.get(id);
        if (placed == null) { // left over from something else: just tidy it away
            entity.discard();
            return InteractionResult.SUCCESS;
        }
        remove(world, id, placed, data, !player.isCreative());
        world.playSound(null, placed.pos, SoundEvents.WOOD_BREAK, SoundSource.BLOCKS, 1f, 1f);
        return InteractionResult.SUCCESS;
    }

    private static void remove(ServerLevel world, UUID id, Placed placed, Data data, boolean drop) {
        clearEntities(world, id, placed);
        Piece piece = piece(placed.type);
        if (piece != null) {
            for (BlockPos rel : cells(piece, placed.rot)) {
                BlockPos cell = placed.pos.offset(rel);
                if (world.getBlockState(cell).is(Blocks.BARRIER) || world.getBlockState(cell).is(Blocks.LIGHT)) {
                    world.setBlockAndUpdate(cell, Blocks.AIR.defaultBlockState());
                }
            }
            if (drop) net.minecraft.world.Containers.dropItemStack(world, placed.pos.getX() + 0.5, placed.pos.getY() + 0.5,
                    placed.pos.getZ() + 0.5, item(piece, placed.materials()));
        }
        if (placed.storage != null) net.minecraft.world.Containers.dropContents(world, placed.pos, placed.storage);
        data.placed.remove(id);
        data.setDirty();
    }

    /** Right-click a piece: customize it with what you hold, turn it (sneak), or use it. */
    static InteractionResult onUseEntity(Player p, Level w, InteractionHand hand, Entity entity, EntityHitResult hit) {
        if (entity.getType() != EntityTypes.INTERACTION || !entity.entityTags().contains(PART_TAG)) return InteractionResult.PASS;
        if (w.isClientSide()) return InteractionResult.SUCCESS;
        if (hand != InteractionHand.MAIN_HAND || !(p instanceof ServerPlayer player) || p instanceof FakePlayer) return InteractionResult.SUCCESS;
        UUID id = idOf(entity);
        ServerLevel world = (ServerLevel) w;
        Data data = Data.get(world.getServer());
        Placed placed = id == null ? null : data.placed.get(id);
        Piece piece = placed == null ? null : piece(placed.type);
        if (piece == null) return InteractionResult.SUCCESS;
        ItemStack held = player.getMainHandItem();

        if (customize(player, placed, held)) {
            data.setDirty();
            rebuild(world, id, placed);
            world.playSound(null, placed.pos, SoundEvents.WOOL_PLACE, SoundSource.BLOCKS, 1f, 1.2f);
            return InteractionResult.SUCCESS;
        }
        if (held.isEmpty() && player.isShiftKeyDown()) {
            int next = (placed.rot + 1) % 4;
            for (BlockPos rel : cells(piece, next)) {
                BlockPos cell = placed.pos.offset(rel);
                boolean ours = cells(piece, placed.rot).contains(rel);
                if (!ours && !world.getBlockState(cell).canBeReplaced()) {
                    player.sendOverlayMessage(Component.literal("No room to turn it that way.").withStyle(ChatFormatting.RED));
                    return InteractionResult.SUCCESS;
                }
            }
            for (BlockPos rel : cells(piece, placed.rot)) {
                BlockPos cell = placed.pos.offset(rel);
                if (world.getBlockState(cell).is(Blocks.BARRIER)) world.setBlockAndUpdate(cell, Blocks.AIR.defaultBlockState());
            }
            placed.rot = next;
            data.setDirty();
            rebuild(world, id, placed);
            return InteractionResult.SUCCESS;
        }
        if (piece.use() == Use.WATER && held.is(Items.GLASS_BOTTLE)) {
            held.shrink(1);
            player.getInventory().placeItemBackInInventory(net.minecraft.world.item.alchemy.PotionContents.createItemStack(Items.POTION,
                    net.minecraft.world.item.alchemy.Potions.WATER), net.minecraft.util.Prediction.SERVER_ONLY);
            world.playSound(null, placed.pos, SoundEvents.BOTTLE_FILL, SoundSource.BLOCKS, 1f, 1f);
            return InteractionResult.SUCCESS;
        }
        if (piece.seat() >= 0 && piece.use() != Use.SEAT) { // the bathtub: tap at one end, sit at the other
            BlockPos rel = BlockPos.containing(entity.getX(), entity.getY() + 0.1, entity.getZ()).subtract(placed.pos);
            if (cells(piece, placed.rot).indexOf(rel) != piece.width() - 1) {
                sit(world, player, placed, piece, entity);
                return InteractionResult.SUCCESS;
            }
        }
        switch (piece.use()) {
            case SEAT -> sit(world, player, placed, piece, entity);
            case STORAGE -> openStorage(player, data, placed, piece);
            case LIGHT, TV, WATER, STOVE, SHOWER -> {
                placed.on = !placed.on;
                data.setDirty();
                rebuild(world, id, placed);
                world.playSound(null, placed.pos, piece.use() == Use.WATER || piece.use() == Use.SHOWER
                        ? SoundEvents.WATER_AMBIENT : SoundEvents.LEVER_CLICK, SoundSource.BLOCKS, 0.6f, 1.2f);
            }
            default -> {
                if (piece.use() == Use.NONE && piece.seat() < 0) {
                    player.sendOverlayMessage(Component.literal("Hold planks, a log, wool, a dye or a block and right-click to change it. "
                            + "Sneak to turn it, punch to pick it up.").withStyle(ChatFormatting.GRAY));
                }
            }
        }
        return InteractionResult.SUCCESS;
    }

    /** Changes a material if the player holds something that can be one. Never uses the item up. */
    private static boolean customize(ServerPlayer player, Placed placed, ItemStack held) {
        if (held.getItem() instanceof DyeItem dye) {
            Identifier wool = Identifier.fromNamespaceAndPath("minecraft", dye.getDefaultInstance().get(net.minecraft.core.component.DataComponents.DYE).getName() + "_wool");
            if (BuiltInRegistries.BLOCK.containsKey(wool)) {
                placed.fabric = wool.toString();
                player.sendOverlayMessage(Component.literal("Fabric: " + nice(dye.getDefaultInstance().get(net.minecraft.core.component.DataComponents.DYE))).withStyle(ChatFormatting.GREEN));
                return true;
            }
        }
        if (!(held.getItem() instanceof BlockItem bi)) return false;
        Block block = bi.getBlock();
        BlockState st = block.defaultBlockState();
        String id = BuiltInRegistries.BLOCK.getKey(block).toString();
        String label = held.getHoverName().getString();
        if (st.is(BlockTags.PLANKS)) {
            placed.wood = id;
            placed.legs = "";
            player.sendOverlayMessage(Component.literal("Wood: " + label).withStyle(ChatFormatting.GREEN));
            return true;
        }
        if (st.is(BlockTags.LOGS)) {
            placed.legs = id;
            player.sendOverlayMessage(Component.literal("Legs and frame: " + label).withStyle(ChatFormatting.GREEN));
            return true;
        }
        if (st.is(BlockTags.WOOL)) {
            placed.fabric = id;
            player.sendOverlayMessage(Component.literal("Fabric: " + label).withStyle(ChatFormatting.GREEN));
            return true;
        }
        if (st.isSolidRender() && !block.defaultBlockState().hasBlockEntity()) {
            placed.top = id;
            player.sendOverlayMessage(Component.literal("Top: " + label).withStyle(ChatFormatting.GREEN));
            return true;
        }
        return false;
    }

    private static String nice(DyeColor c) {
        String n = c.getName().replace('_', ' ');
        return Character.toUpperCase(n.charAt(0)) + n.substring(1);
    }

    // ---------------------------------------------------------------------------------------
    // Sitting
    // ---------------------------------------------------------------------------------------

    private static void sit(ServerLevel world, ServerPlayer player, Placed placed, Piece piece, Entity clicked) {
        if (player.isPassenger()) return;
        BlockPos cell = BlockPos.containing(clicked.getX(), clicked.getY() + 0.1, clicked.getZ());
        if (!world.getEntitiesOfClass(Entity.class, new AABB(cell).inflate(0.1), e -> e.entityTags().contains(SEAT_TAG)
                && e.isVehicle()).isEmpty()) {
            player.sendOverlayMessage(Component.literal("Someone's already sitting there.").withStyle(ChatFormatting.YELLOW));
            return;
        }
        Direction front = switch (placed.rot) { case 1 -> Direction.EAST; case 2 -> Direction.SOUTH; case 3 -> Direction.WEST; default -> Direction.NORTH; };
        CompoundTag nbt = new CompoundTag();
        nbt.putString("id", "minecraft:armor_stand");
        nbt.putBoolean("Invisible", true);
        nbt.putBoolean("Marker", true);
        nbt.putBoolean("NoGravity", true);
        nbt.putBoolean("Invulnerable", true);
        nbt.putBoolean("Silent", true);
        nbt.put("Tags", tags(SEAT_TAG));
        double y = cell.getY() + piece.seat() / 16.0 - 0.2;
        Entity seat = spawn(world, nbt, cell.getX() + 0.5, y, cell.getZ() + 0.5, front.toYRot());
        if (seat != null) {
            player.startRiding(seat, true, true);
            player.sendOverlayMessage(Component.literal("Sneak to get up.").withStyle(ChatFormatting.GRAY));
        }
    }

    // ---------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------

    private static void openStorage(ServerPlayer player, Data data, Placed placed, Piece piece) {
        if (placed.storage == null) {
            placed.storage = new SimpleContainer(27);
        }
        SimpleContainer inv = placed.storage;
        player.openMenu(new SimpleMenuProvider(
                (syncId, pinv, p) -> ChestMenu.threeRows(syncId, pinv, inv),
                Component.literal(piece.name().replaceAll(" \\(.*\\)", ""))));
        player.level().playSound(null, placed.pos, SoundEvents.BARREL_OPEN, SoundSource.BLOCKS, 0.6f, 1.1f);
    }

    // ---------------------------------------------------------------------------------------
    // Ticking: empty seats go away, showers and taps run, stoves smoke
    // ---------------------------------------------------------------------------------------

    private static int ticks;

    static void tick(MinecraftServer server) {
        if (++ticks % 5 != 0) return;
        for (ServerLevel world : server.getAllLevels()) {
            if (ticks % 20 == 0) {
                for (ServerPlayer pl : world.players()) {
                    for (Entity seat : world.getEntitiesOfClass(Entity.class, pl.getBoundingBox().inflate(16),
                            e -> e.entityTags().contains(SEAT_TAG) && !e.isVehicle())) {
                        seat.discard();
                    }
                }
            }
        }
        Data data = Data.get(server);
        for (Placed p : data.placed.values()) {
            if (!p.on) continue;
            Piece piece = piece(p.type);
            if (piece == null || (piece.use() != Use.SHOWER && piece.use() != Use.STOVE && piece.use() != Use.WATER)) continue;
            ServerLevel world = server.getLevel(worldKey(p.world));
            if (world == null || !world.hasChunkAt(p.pos) || world.getNearestPlayer(p.pos.getX(), p.pos.getY(), p.pos.getZ(), 32, false) == null) continue;
            if (piece.use() == Use.SHOWER) {
                float[] head = turn(8, 10, p.rot);
                world.sendParticles(ParticleTypes.FALLING_WATER, p.pos.getX() + head[0] / 16, p.pos.getY() + 1.65,
                        p.pos.getZ() + head[1] / 16, 6, 0.15, 0.02, 0.15, 0);
                if (ticks % 40 == 0) world.playSound(null, p.pos, SoundEvents.WEATHER_RAIN, SoundSource.BLOCKS, 0.25f, 1.6f);
            } else if (piece.use() == Use.STOVE && ticks % 10 == 0) {
                world.sendParticles(ParticleTypes.SMOKE, p.pos.getX() + 0.5, p.pos.getY() + 1.05, p.pos.getZ() + 0.5, 2, 0.25, 0, 0.25, 0.005);
            } else if (piece.use() == Use.WATER && !"bathtub".equals(p.type)) {
                float[] tap = turn(8, 11.5f, p.rot);
                double ty = "kitchen_sink".equals(p.type) ? 1.2 : 1.05;
                world.sendParticles(ParticleTypes.FALLING_WATER, p.pos.getX() + tap[0] / 16, p.pos.getY() + ty,
                        p.pos.getZ() + tap[1] / 16, 1, 0.01, 0, 0.01, 0);
            }
        }
    }

    /** Seats left over from before a restart. */
    static void onEntityLoad(Entity entity, ServerLevel world) {
        if (entity.entityTags().contains(SEAT_TAG) && !entity.isVehicle()) world.getServer().execute(() -> {
            if (!entity.isVehicle()) entity.discard();
        });
    }

    // ---------------------------------------------------------------------------------------
    // The catalogue: /helper furniture
    // ---------------------------------------------------------------------------------------

    static void openCatalog(ServerPlayer player) {
        player.openMenu(new SimpleMenuProvider(
                (syncId, inv, p) -> new Catalog(syncId, inv, player), Component.literal("Furniture Catalogue")));
    }

    static final class Catalog extends ChestMenu {
        private static final int SIZE = 54;
        private final ServerPlayer player;
        private final SimpleContainer view;
        private int room;
        private final List<Piece> shown = new ArrayList<>();

        Catalog(int syncId, Inventory inv, ServerPlayer player) {
            this(syncId, inv, player, new SimpleContainer(SIZE));
        }

        private Catalog(int syncId, Inventory inv, ServerPlayer player, SimpleContainer view) {
            super(MenuType.GENERIC_9x6, syncId, inv, view, 6);
            this.player = player;
            this.view = view;
            refresh();
        }

        private void refresh() {
            for (int i = 0; i < SIZE; i++) view.setItem(i, ItemStack.EMPTY);
            for (int r = 0; r < ROOMS.length; r++) {
                ItemStack tab = Storage.Menu.button(ROOM_ICONS[r], ROOMS[r], r == room ? "Showing now" : "Click to show");
                if (r == room) tab.set(net.minecraft.core.component.DataComponents.ENCHANTMENT_GLINT_OVERRIDE, true);
                view.setItem(r, tab);
            }
            shown.clear();
            for (Piece p : PIECES) if (p.room().equals(ROOMS[room])) shown.add(p);
            boolean free = player.isCreative();
            for (int i = 0; i < shown.size() && 18 + i < 45; i++) {
                Piece p = shown.get(i);
                ItemStack b = Storage.Menu.button(p.icon(), p.name(), free ? "Free in creative" : "Costs " + p.price() + " tycoon coins",
                        p.width() + "x" + p.height() + (p.use() == Use.STORAGE ? ", holds 27 stacks" : ""), "Click to get one");
                view.setItem(18 + i, b);
            }
            long coins = Tycoon.Data.get(player.level().getServer()).coins(player.getUUID());
            view.setItem(49, Storage.Menu.button(Items.GOLD_INGOT, coins + " coins", "Earn coins with Tycoon Droppers"));
            view.setItem(53, Storage.Menu.button(Items.BOOK, "How to customize",
                    "Right-click a piece holding planks (wood), a log (legs),", "wool or a dye (fabric), or any block (the top).",
                    "Sneak + empty hand turns it. Empty hand uses it.", "Punch it to pick it up."));
            broadcastChanges();
        }

        @Override
        public void clicked(int slot, int button, ContainerInput action, Player p) {
            if (slot < 0 || slot >= SIZE) {
                if (action != ContainerInput.QUICK_MOVE) super.clicked(slot, button, action, p);
                return;
            }
            if (action == ContainerInput.PICKUP) {
                if (slot < ROOMS.length) room = slot;
                else if (slot >= 18 && slot - 18 < shown.size()) get(shown.get(slot - 18));
            }
            refresh();
        }

        private void get(Piece piece) {
            if (!player.isCreative()) {
                Tycoon.Data data = Tycoon.Data.get(player.level().getServer());
                if (data.coins(player.getUUID()) < piece.price()) {
                    player.sendOverlayMessage(Component.literal("You need " + piece.price() + " tycoon coins (you have "
                            + data.coins(player.getUUID()) + "). /helper tycoon start to begin earning.").withStyle(ChatFormatting.RED));
                    return;
                }
                data.add(player.getUUID(), -piece.price());
            }
            player.getInventory().placeItemBackInInventory(item(piece, null), net.minecraft.util.Prediction.SERVER_ONLY);
            Compat.notifySound(player, SoundEvents.VILLAGER_YES, SoundSource.PLAYERS, 0.6f, 1.2f);
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

    static void reset() {
        ticks = 0;
    }
}
