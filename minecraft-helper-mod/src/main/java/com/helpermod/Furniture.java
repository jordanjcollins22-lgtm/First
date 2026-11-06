package com.helpermod;

import net.fabricmc.fabric.api.entity.FakePlayer;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.block.LightBlock;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.inventory.Inventories;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.BlockItem;
import net.minecraft.item.DyeItem;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtFloat;
import net.minecraft.nbt.NbtList;
import net.minecraft.nbt.NbtString;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.registry.Registries;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.screen.GenericContainerScreenHandler;
import net.minecraft.screen.ScreenHandlerType;
import net.minecraft.screen.SimpleNamedScreenHandlerFactory;
import net.minecraft.screen.slot.SlotActionType;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.text.Text;
import net.minecraft.util.ActionResult;
import net.minecraft.util.DyeColor;
import net.minecraft.util.Formatting;
import net.minecraft.util.Hand;
import net.minecraft.util.Identifier;
import net.minecraft.util.TypedActionResult;
import net.minecraft.util.collection.DefaultedList;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.hit.EntityHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Direction;
import net.minecraft.world.EmptyBlockView;
import net.minecraft.world.PersistentState;
import net.minecraft.world.World;

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
    private static final Item[] ROOM_ICONS = {Items.SMOKER, Items.RED_BED, Items.OAK_STAIRS, Items.WHITE_BED, Items.CAULDRON, Items.FLOWER_POT};

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
            b("sofa", "Living room", "Sofa (2 seats)", Items.RED_BED).size(2, 1).seat(9).price(90)
                    .p(Role.FABRIC, 0, 0, 2, 32, 7, 16).p(Role.FABRIC, 1, 7, 3, 15.6, 9, 13).p(Role.FABRIC, 16.4, 7, 3, 31, 9, 13)
                    .p(Role.FABRIC, 0, 7, 12, 32, 18, 16).p(Role.FABRIC, 0, 7, 2, 2, 13, 12).p(Role.FABRIC, 30, 7, 2, 32, 13, 12)
                    .p(Role.LEGS, 1, -1, 3, 3, 0, 5).p(Role.LEGS, 29, -1, 3, 31, 0, 5).done(),
            b("armchair", "Living room", "Armchair", Items.RED_WOOL).seat(9).price(60)
                    .p(Role.FABRIC, 0, 0, 2, 16, 7, 16).p(Role.FABRIC, 2, 7, 3, 14, 9, 13).p(Role.FABRIC, 0, 7, 12, 16, 18, 16)
                    .p(Role.FABRIC, 0, 7, 2, 2, 13, 12).p(Role.FABRIC, 14, 7, 2, 16, 13, 12).done(),
            b("coffee_table", "Living room", "Coffee Table", Items.OAK_PRESSURE_PLATE).price(40)
                    .p(Role.WOOD, 1, 6, 3, 15, 8, 13).p(Role.LEGS, 2, 0, 4, 4, 6, 6).p(Role.LEGS, 12, 0, 4, 14, 6, 6)
                    .p(Role.LEGS, 2, 0, 10, 4, 6, 12).p(Role.LEGS, 12, 0, 10, 14, 6, 12).done(),
            b("tv", "Living room", "TV (switch it on)", Items.BLACK_CONCRETE).use(Use.TV).price(120)
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
            b("headboard", "Bedroom", "Bed Headboard (put it behind a bed)", Items.WHITE_BED).size(2, 1).price(40)
                    .p(Role.LEGS, 0, 0, 14, 2, 22, 16).p(Role.LEGS, 30, 0, 14, 32, 22, 16).p(Role.FABRIC, 2, 6, 14.5, 30, 20, 15.5)
                    .p(Role.WOOD, 0, 20, 14, 32, 22, 16).done(),
            b("vanity", "Bedroom", "Vanity Table with Mirror", Items.GLASS).solid().price(70)
                    .p(Role.WOOD, 0, 0, 3, 16, 12, 16).p(Role.LEGS, 1, 7, 2, 15, 11, 3).p(Role.WOOD, 1, 12, 13, 15, 27, 15)
                    .p(Role.GLASS, 2, 13, 12.8, 14, 26, 13).done(),
            // Bathroom
            b("toilet", "Bathroom", "Toilet", Items.WHITE_CONCRETE).seat(9.5).price(40)
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
            b("shower", "Bathroom", "Shower (switch it on)", Items.LIGHT_BLUE_STAINED_GLASS).size(1, 2).use(Use.SHOWER).price(90)
                    .p(Role.WHITE, 0, 0, 0, 16, 1, 16).p(Role.GLASS, 0, 1, 0, 0.5, 30, 16).p(Role.GLASS, 15.5, 1, 0, 16, 30, 16)
                    .p(Role.TOP, 0, 1, 15.5, 16, 30, 16).p(Role.METAL, 7, 28, 10, 9, 29, 15.5).p(Role.METAL, 6, 27, 8, 10, 28, 12).done(),
            b("towel_rack", "Bathroom", "Towel Rack (hang it on a wall)", Items.WHITE_BANNER).price(20)
                    .p(Role.METAL, 1, 12, 14, 2, 13, 16).p(Role.METAL, 14, 12, 14, 15, 13, 16).p(Role.METAL, 1, 12, 13.5, 15, 13, 14.5)
                    .p(Role.FABRIC, 2, 3, 13.8, 14, 12.5, 14.3).done(),
            // Other
            b("office_chair", "Other", "Office Chair", Items.BLACK_WOOL).seat(9).price(50)
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
        SimpleInventory storage;

        NbtCompound materials() {
            NbtCompound m = new NbtCompound();
            m.putString("type", type);
            m.putString("wood", wood);
            m.putString("legs", legs);
            m.putString("fabric", fabric);
            m.putString("top", top);
            return m;
        }

        void readMaterials(NbtCompound m) {
            if (m.contains("wood")) wood = m.getString("wood");
            if (m.contains("legs")) legs = m.getString("legs");
            if (m.contains("fabric")) fabric = m.getString("fabric");
            if (m.contains("top")) top = m.getString("top");
        }
    }

    static final class Data extends PersistentState {
        private static final String ID = "helpermod_furniture";
        final Map<UUID, Placed> placed = new LinkedHashMap<>();

        static Data get(MinecraftServer server) {
            return server.getOverworld().getPersistentStateManager().getOrCreate(Data::fromNbt, Data::new, ID);
        }

        private static Data fromNbt(NbtCompound nbt) {
            Data d = new Data();
            NbtList list = nbt.getList("pieces", NbtElement.COMPOUND_TYPE);
            for (int i = 0; i < list.size(); i++) {
                NbtCompound c = list.getCompound(i);
                Placed p = new Placed();
                p.type = c.getString("type");
                p.world = c.getString("world");
                p.pos = BlockPos.fromLong(c.getLong("pos"));
                p.rot = c.getInt("rot");
                p.readMaterials(c);
                p.on = c.getBoolean("on");
                if (c.contains("items")) {
                    DefaultedList<ItemStack> items = DefaultedList.ofSize(27, ItemStack.EMPTY);
                    Inventories.readNbt(c.getCompound("items"), items);
                    p.storage = new SimpleInventory(27);
                    for (int s = 0; s < 27; s++) p.storage.setStack(s, items.get(s));
                    p.storage.addListener(inv -> d.markDirty());
                }
                d.placed.put(c.getUuid("id"), p);
            }
            return d;
        }

        @Override
        public NbtCompound writeNbt(NbtCompound nbt) {
            NbtList list = new NbtList();
            for (Map.Entry<UUID, Placed> e : placed.entrySet()) {
                Placed p = e.getValue();
                NbtCompound c = p.materials();
                c.putUuid("id", e.getKey());
                c.putString("world", p.world);
                c.putLong("pos", p.pos.asLong());
                c.putInt("rot", p.rot);
                c.putBoolean("on", p.on);
                if (p.storage != null && !p.storage.isEmpty()) {
                    DefaultedList<ItemStack> items = DefaultedList.ofSize(27, ItemStack.EMPTY);
                    for (int s = 0; s < 27; s++) items.set(s, p.storage.getStack(s));
                    c.put("items", Inventories.writeNbt(new NbtCompound(), items));
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

    static ItemStack item(Piece piece, NbtCompound materials) {
        ItemStack stack = new ItemStack(piece.icon());
        NbtCompound m = materials == null ? new NbtCompound() : materials.copy();
        m.putString("type", piece.id());
        stack.getOrCreateNbt().put(ITEM_TAG, m);
        stack.setCustomName(Text.literal(piece.name()).styled(s -> s.withItalic(false)).formatted(Formatting.GOLD));
        NbtList lore = new NbtList();
        lore.add(NbtString.of(Text.Serializer.toJson(Text.literal(piece.room() + " furniture. Right-click a block to place it.")
                .styled(s -> s.withItalic(false)).formatted(Formatting.GRAY))));
        stack.getOrCreateSubNbt("display").put("Lore", lore);
        return stack;
    }

    private static NbtCompound furnitureOf(ItemStack stack) {
        if (!stack.hasNbt() || !stack.getNbt().contains(ITEM_TAG, NbtElement.COMPOUND_TYPE)) return null;
        return stack.getNbt().getCompound(ITEM_TAG);
    }

    // ---------------------------------------------------------------------------------------
    // Building the pieces out of block displays
    // ---------------------------------------------------------------------------------------

    private static String stripped(String planks) {
        Identifier id = Identifier.tryParse(planks);
        if (id == null || !id.getPath().endsWith("_planks")) return planks;
        String wood = id.getPath().substring(0, id.getPath().length() - "_planks".length());
        for (String candidate : new String[]{"stripped_" + wood + "_log", "stripped_" + wood + "_stem", "stripped_" + wood + "_block"}) {
            Identifier c = new Identifier(id.getNamespace(), candidate);
            if (Registries.BLOCK.containsId(c)) return c.toString();
        }
        return planks;
    }

    private static BlockState state(String id, BlockState fallback) {
        Identifier key = Identifier.tryParse(id);
        if (key == null || !Registries.BLOCK.containsId(key)) return fallback;
        return Registries.BLOCK.get(key).getDefaultState();
    }

    private static BlockState stateFor(Role role, Placed p) {
        return switch (role) {
            case WOOD -> state(p.wood, Blocks.OAK_PLANKS.getDefaultState());
            case LEGS -> state(p.legs.isEmpty() ? stripped(p.wood) : p.legs, Blocks.STRIPPED_OAK_LOG.getDefaultState());
            case FABRIC -> state(p.fabric, Blocks.RED_WOOL.getDefaultState());
            case TOP -> state(p.top, Blocks.SMOOTH_QUARTZ.getDefaultState());
            case WHITE -> Blocks.WHITE_CONCRETE.getDefaultState();
            case BLACK -> Blocks.BLACK_CONCRETE.getDefaultState();
            case GRAY -> Blocks.LIGHT_GRAY_CONCRETE.getDefaultState();
            case METAL -> Blocks.IRON_BLOCK.getDefaultState();
            case GLASS -> Blocks.LIGHT_BLUE_STAINED_GLASS.getDefaultState();
            case WATER -> p.on ? Blocks.BLUE_STAINED_GLASS.getDefaultState() : null;
            case SCREEN -> p.on ? Blocks.LIGHT_BLUE_CONCRETE.getDefaultState() : Blocks.GRAY_CONCRETE.getDefaultState();
            case LIGHT -> p.on ? Blocks.GLOWSTONE.getDefaultState() : Blocks.WHITE_STAINED_GLASS.getDefaultState();
            case BURNER -> p.on ? Blocks.MAGMA_BLOCK.getDefaultState() : Blocks.GRAY_CONCRETE.getDefaultState();
            case BOOKS -> Blocks.BOOKSHELF.getDefaultState();
            case PLANT -> Blocks.FLOWERING_AZALEA_LEAVES.getDefaultState();
            case POT -> Blocks.TERRACOTTA.getDefaultState();
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

    private static NbtList floats(float... f) {
        NbtList l = new NbtList();
        for (float v : f) l.add(NbtFloat.of(v));
        return l;
    }

    private static NbtList tags(String... t) {
        NbtList l = new NbtList();
        for (String s : t) l.add(NbtString.of(s));
        return l;
    }

    private static Entity spawn(ServerWorld world, NbtCompound nbt, double x, double y, double z, float yaw) {
        Entity e = EntityType.loadEntityWithPassengers(nbt, world, entity -> {
            entity.refreshPositionAndAngles(x, y, z, yaw, 0);
            return entity;
        });
        if (e != null) world.spawnEntity(e);
        return e;
    }

    private static void build(ServerWorld world, UUID id, Placed p) {
        Piece piece = piece(p.type);
        if (piece == null) return;
        String tag = PART_TAG + ":" + id;
        BlockPos o = p.pos;
        for (Part part : piece.parts()) {
            BlockState st = stateFor(part.role(), p);
            if (st == null) continue;
            float[] a = turn(part.x1(), part.z1(), p.rot), c = turn(part.x2(), part.z2(), p.rot);
            float x1 = Math.min(a[0], c[0]), x2 = Math.max(a[0], c[0]), z1 = Math.min(a[1], c[1]), z2 = Math.max(a[1], c[1]);
            NbtCompound nbt = new NbtCompound();
            nbt.putString("id", "minecraft:block_display");
            NbtCompound bs = new NbtCompound();
            bs.putString("Name", Registries.BLOCK.getId(st.getBlock()).toString());
            nbt.put("block_state", bs);
            NbtCompound tf = new NbtCompound();
            tf.put("translation", floats(x1 / 16f, part.y1() / 16f, z1 / 16f));
            tf.put("scale", floats((x2 - x1) / 16f, (part.y2() - part.y1()) / 16f, (z2 - z1) / 16f));
            tf.put("left_rotation", floats(0, 0, 0, 1));
            tf.put("right_rotation", floats(0, 0, 0, 1));
            nbt.put("transformation", tf);
            nbt.putFloat("width", 3);
            nbt.putFloat("height", 3);
            if (glows(part.role(), p)) {
                NbtCompound light = new NbtCompound();
                light.putInt("block", 15);
                light.putInt("sky", 15);
                nbt.put("brightness", light);
            }
            nbt.put("Tags", tags(PART_TAG, tag));
            spawn(world, nbt, o.getX(), o.getY(), o.getZ(), 0);
        }
        for (BlockPos rel : cells(piece, p.rot)) {
            BlockPos cell = o.add(rel);
            NbtCompound nbt = new NbtCompound();
            nbt.putString("id", "minecraft:interaction");
            nbt.putFloat("width", 1.02f);
            nbt.putFloat("height", 1.02f);
            nbt.putBoolean("response", true);
            nbt.put("Tags", tags(PART_TAG, tag));
            spawn(world, nbt, cell.getX() + 0.5, cell.getY() - 0.01, cell.getZ() + 0.5, 0);
            if (piece.solid() && world.getBlockState(cell).isReplaceable()) world.setBlockState(cell, Blocks.BARRIER.getDefaultState());
        }
        if (piece.use() == Use.LIGHT) {
            BlockPos lightAt = piece.height() > 1 ? o.up() : o;
            BlockState here = world.getBlockState(lightAt);
            if (p.on && (here.isAir() || here.isOf(Blocks.LIGHT))) {
                world.setBlockState(lightAt, Blocks.LIGHT.getDefaultState().with(LightBlock.LEVEL_15, 15));
            } else if (!p.on && here.isOf(Blocks.LIGHT)) {
                world.setBlockState(lightAt, Blocks.AIR.getDefaultState());
            }
        }
    }

    private static void clearEntities(ServerWorld world, UUID id, Placed p) {
        String tag = PART_TAG + ":" + id;
        Box box = new Box(p.pos).expand(4);
        for (Entity e : world.getEntitiesByClass(Entity.class, box, e -> e.getCommandTags().contains(tag))) e.discard();
    }

    private static void rebuild(ServerWorld world, UUID id, Placed p) {
        clearEntities(world, id, p);
        build(world, id, p);
    }

    // ---------------------------------------------------------------------------------------
    // Placing, using, customizing and picking up
    // ---------------------------------------------------------------------------------------

    private static RegistryKey<World> worldKey(String id) {
        return RegistryKey.of(RegistryKeys.WORLD, new Identifier(id));
    }

    static TypedActionResult<ItemStack> onUseItem(PlayerEntity p, World w, Hand hand) {
        ItemStack stack = p.getStackInHand(hand);
        if (furnitureOf(stack) == null) return TypedActionResult.pass(stack);
        if (!w.isClient && p instanceof ServerPlayerEntity player) player.sendMessage(Text.literal("Right-click a block to put it there.")
                .formatted(Formatting.YELLOW), true);
        return TypedActionResult.success(stack);
    }

    static ActionResult onUseBlock(PlayerEntity p, World w, Hand hand, BlockHitResult hit) {
        ItemStack stack = p.getStackInHand(hand);
        NbtCompound m = furnitureOf(stack);
        if (m == null) return ActionResult.PASS;
        if (w.isClient) return ActionResult.SUCCESS;
        if (!(p instanceof ServerPlayerEntity player) || p instanceof FakePlayer) return ActionResult.SUCCESS;
        Piece piece = piece(m.getString("type"));
        if (piece == null) return ActionResult.SUCCESS;
        ServerWorld world = (ServerWorld) w;
        BlockPos pos = hit.getBlockPos();
        if (!world.getBlockState(pos).isReplaceable()) pos = pos.offset(hit.getSide());
        Direction front = player.getHorizontalFacing().getOpposite();
        int rot = switch (front) { case EAST -> 1; case SOUTH -> 2; case WEST -> 3; default -> 0; };
        for (BlockPos rel : cells(piece, rot)) {
            BlockPos cell = pos.add(rel);
            if (!world.getBlockState(cell).isReplaceable() || !world.getEntitiesByClass(Entity.class, new Box(cell),
                    e -> e.getCommandTags().contains(PART_TAG) && e.getType() == EntityType.INTERACTION).isEmpty()) {
                player.sendMessage(Text.literal("There isn't room for the " + piece.name() + " there.").formatted(Formatting.RED), true);
                return ActionResult.SUCCESS;
            }
        }
        Placed placed = new Placed();
        placed.type = piece.id();
        placed.world = world.getRegistryKey().getValue().toString();
        placed.pos = pos.toImmutable();
        placed.rot = rot;
        placed.readMaterials(m);
        if (piece.use() == Use.STORAGE) placed.storage = new SimpleInventory(27);
        Data data = Data.get(world.getServer());
        UUID id = UUID.randomUUID();
        if (placed.storage != null) placed.storage.addListener(inv -> data.markDirty());
        data.placed.put(id, placed);
        data.markDirty();
        build(world, id, placed);
        if (!player.isCreative()) stack.decrement(1);
        world.playSound(null, pos, SoundEvents.BLOCK_WOOD_PLACE, SoundCategory.BLOCKS, 1f, 1f);
        player.swingHand(hand, true);
        return ActionResult.SUCCESS;
    }

    private static UUID idOf(Entity e) {
        for (String t : e.getCommandTags()) {
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
    static ActionResult onAttackEntity(PlayerEntity p, World w, Hand hand, Entity entity, EntityHitResult hit) {
        if (entity.getType() != EntityType.INTERACTION || !entity.getCommandTags().contains(PART_TAG)) return ActionResult.PASS;
        if (w.isClient || !(p instanceof ServerPlayerEntity player) || p instanceof FakePlayer) return ActionResult.SUCCESS;
        UUID id = idOf(entity);
        ServerWorld world = (ServerWorld) w;
        Data data = Data.get(world.getServer());
        Placed placed = id == null ? null : data.placed.get(id);
        if (placed == null) { // left over from something else: just tidy it away
            entity.discard();
            return ActionResult.SUCCESS;
        }
        remove(world, id, placed, data, !player.isCreative());
        world.playSound(null, placed.pos, SoundEvents.BLOCK_WOOD_BREAK, SoundCategory.BLOCKS, 1f, 1f);
        return ActionResult.SUCCESS;
    }

    private static void remove(ServerWorld world, UUID id, Placed placed, Data data, boolean drop) {
        clearEntities(world, id, placed);
        Piece piece = piece(placed.type);
        if (piece != null) {
            for (BlockPos rel : cells(piece, placed.rot)) {
                BlockPos cell = placed.pos.add(rel);
                if (world.getBlockState(cell).isOf(Blocks.BARRIER) || world.getBlockState(cell).isOf(Blocks.LIGHT)) {
                    world.setBlockState(cell, Blocks.AIR.getDefaultState());
                }
            }
            if (drop) net.minecraft.util.ItemScatterer.spawn(world, placed.pos.getX() + 0.5, placed.pos.getY() + 0.5,
                    placed.pos.getZ() + 0.5, item(piece, placed.materials()));
        }
        if (placed.storage != null) net.minecraft.util.ItemScatterer.spawn(world, placed.pos, placed.storage);
        data.placed.remove(id);
        data.markDirty();
    }

    /** Right-click a piece: customize it with what you hold, turn it (sneak), or use it. */
    static ActionResult onUseEntity(PlayerEntity p, World w, Hand hand, Entity entity, EntityHitResult hit) {
        if (entity.getType() != EntityType.INTERACTION || !entity.getCommandTags().contains(PART_TAG)) return ActionResult.PASS;
        if (w.isClient) return ActionResult.SUCCESS;
        if (hand != Hand.MAIN_HAND || !(p instanceof ServerPlayerEntity player) || p instanceof FakePlayer) return ActionResult.SUCCESS;
        UUID id = idOf(entity);
        ServerWorld world = (ServerWorld) w;
        Data data = Data.get(world.getServer());
        Placed placed = id == null ? null : data.placed.get(id);
        Piece piece = placed == null ? null : piece(placed.type);
        if (piece == null) return ActionResult.SUCCESS;
        ItemStack held = player.getMainHandStack();

        if (customize(player, placed, held)) {
            data.markDirty();
            rebuild(world, id, placed);
            world.playSound(null, placed.pos, SoundEvents.BLOCK_WOOL_PLACE, SoundCategory.BLOCKS, 1f, 1.2f);
            return ActionResult.SUCCESS;
        }
        if (held.isEmpty() && player.isSneaking()) {
            int next = (placed.rot + 1) % 4;
            for (BlockPos rel : cells(piece, next)) {
                BlockPos cell = placed.pos.add(rel);
                boolean ours = cells(piece, placed.rot).contains(rel);
                if (!ours && !world.getBlockState(cell).isReplaceable()) {
                    player.sendMessage(Text.literal("No room to turn it that way.").formatted(Formatting.RED), true);
                    return ActionResult.SUCCESS;
                }
            }
            for (BlockPos rel : cells(piece, placed.rot)) {
                BlockPos cell = placed.pos.add(rel);
                if (world.getBlockState(cell).isOf(Blocks.BARRIER)) world.setBlockState(cell, Blocks.AIR.getDefaultState());
            }
            placed.rot = next;
            data.markDirty();
            rebuild(world, id, placed);
            return ActionResult.SUCCESS;
        }
        if (piece.use() == Use.WATER && held.isOf(Items.GLASS_BOTTLE)) {
            held.decrement(1);
            player.getInventory().offerOrDrop(net.minecraft.potion.PotionUtil.setPotion(new ItemStack(Items.POTION),
                    net.minecraft.potion.Potions.WATER));
            world.playSound(null, placed.pos, SoundEvents.ITEM_BOTTLE_FILL, SoundCategory.BLOCKS, 1f, 1f);
            return ActionResult.SUCCESS;
        }
        if (piece.seat() >= 0 && piece.use() != Use.SEAT) { // the bathtub: tap at one end, sit at the other
            BlockPos rel = BlockPos.ofFloored(entity.getX(), entity.getY() + 0.1, entity.getZ()).subtract(placed.pos);
            if (cells(piece, placed.rot).indexOf(rel) != piece.width() - 1) {
                sit(world, player, placed, piece, entity);
                return ActionResult.SUCCESS;
            }
        }
        switch (piece.use()) {
            case SEAT -> sit(world, player, placed, piece, entity);
            case STORAGE -> openStorage(player, data, placed, piece);
            case LIGHT, TV, WATER, STOVE, SHOWER -> {
                placed.on = !placed.on;
                data.markDirty();
                rebuild(world, id, placed);
                world.playSound(null, placed.pos, piece.use() == Use.WATER || piece.use() == Use.SHOWER
                        ? SoundEvents.BLOCK_WATER_AMBIENT : SoundEvents.BLOCK_LEVER_CLICK, SoundCategory.BLOCKS, 0.6f, 1.2f);
            }
            default -> {
                if (piece.use() == Use.NONE && piece.seat() < 0) {
                    player.sendMessage(Text.literal("Hold planks, a log, wool, a dye or a block and right-click to change it. "
                            + "Sneak to turn it, punch to pick it up.").formatted(Formatting.GRAY), true);
                }
            }
        }
        return ActionResult.SUCCESS;
    }

    /** Changes a material if the player holds something that can be one. Never uses the item up. */
    private static boolean customize(ServerPlayerEntity player, Placed placed, ItemStack held) {
        if (held.getItem() instanceof DyeItem dye) {
            Identifier wool = new Identifier("minecraft", dye.getColor().getName() + "_wool");
            if (Registries.BLOCK.containsId(wool)) {
                placed.fabric = wool.toString();
                player.sendMessage(Text.literal("Fabric: " + nice(dye.getColor())).formatted(Formatting.GREEN), true);
                return true;
            }
        }
        if (!(held.getItem() instanceof BlockItem bi)) return false;
        Block block = bi.getBlock();
        BlockState st = block.getDefaultState();
        String id = Registries.BLOCK.getId(block).toString();
        String label = held.getName().getString();
        if (st.isIn(BlockTags.PLANKS)) {
            placed.wood = id;
            placed.legs = "";
            player.sendMessage(Text.literal("Wood: " + label).formatted(Formatting.GREEN), true);
            return true;
        }
        if (st.isIn(BlockTags.LOGS)) {
            placed.legs = id;
            player.sendMessage(Text.literal("Legs and frame: " + label).formatted(Formatting.GREEN), true);
            return true;
        }
        if (st.isIn(BlockTags.WOOL)) {
            placed.fabric = id;
            player.sendMessage(Text.literal("Fabric: " + label).formatted(Formatting.GREEN), true);
            return true;
        }
        if (st.isOpaqueFullCube(EmptyBlockView.INSTANCE, BlockPos.ORIGIN) && !block.getDefaultState().hasBlockEntity()) {
            placed.top = id;
            player.sendMessage(Text.literal("Top: " + label).formatted(Formatting.GREEN), true);
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

    private static void sit(ServerWorld world, ServerPlayerEntity player, Placed placed, Piece piece, Entity clicked) {
        if (player.hasVehicle()) return;
        BlockPos cell = BlockPos.ofFloored(clicked.getX(), clicked.getY() + 0.1, clicked.getZ());
        if (!world.getEntitiesByClass(Entity.class, new Box(cell).expand(0.1), e -> e.getCommandTags().contains(SEAT_TAG)
                && e.hasPassengers()).isEmpty()) {
            player.sendMessage(Text.literal("Someone's already sitting there.").formatted(Formatting.YELLOW), true);
            return;
        }
        Direction front = switch (placed.rot) { case 1 -> Direction.EAST; case 2 -> Direction.SOUTH; case 3 -> Direction.WEST; default -> Direction.NORTH; };
        NbtCompound nbt = new NbtCompound();
        nbt.putString("id", "minecraft:armor_stand");
        nbt.putBoolean("Invisible", true);
        nbt.putBoolean("Marker", true);
        nbt.putBoolean("NoGravity", true);
        nbt.putBoolean("Invulnerable", true);
        nbt.putBoolean("Silent", true);
        nbt.put("Tags", tags(SEAT_TAG));
        double y = cell.getY() + piece.seat() / 16.0 - 0.2;
        Entity seat = spawn(world, nbt, cell.getX() + 0.5, y, cell.getZ() + 0.5, front.asRotation());
        if (seat != null) {
            player.startRiding(seat, true);
            player.sendMessage(Text.literal("Sneak to get up.").formatted(Formatting.GRAY), true);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------

    private static void openStorage(ServerPlayerEntity player, Data data, Placed placed, Piece piece) {
        if (placed.storage == null) {
            placed.storage = new SimpleInventory(27);
            placed.storage.addListener(inv -> data.markDirty());
        }
        SimpleInventory inv = placed.storage;
        player.openHandledScreen(new SimpleNamedScreenHandlerFactory(
                (syncId, pinv, p) -> GenericContainerScreenHandler.createGeneric9x3(syncId, pinv, inv),
                Text.literal(piece.name().replaceAll(" \\(.*\\)", ""))));
        player.getServerWorld().playSound(null, placed.pos, SoundEvents.BLOCK_BARREL_OPEN, SoundCategory.BLOCKS, 0.6f, 1.1f);
    }

    // ---------------------------------------------------------------------------------------
    // Ticking: empty seats go away, showers and taps run, stoves smoke
    // ---------------------------------------------------------------------------------------

    private static int ticks;

    static void tick(MinecraftServer server) {
        if (++ticks % 5 != 0) return;
        for (ServerWorld world : server.getWorlds()) {
            if (ticks % 20 == 0) {
                for (ServerPlayerEntity pl : world.getPlayers()) {
                    for (Entity seat : world.getEntitiesByClass(Entity.class, pl.getBoundingBox().expand(16),
                            e -> e.getCommandTags().contains(SEAT_TAG) && !e.hasPassengers())) {
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
            ServerWorld world = server.getWorld(worldKey(p.world));
            if (world == null || !world.isChunkLoaded(p.pos) || world.getClosestPlayer(p.pos.getX(), p.pos.getY(), p.pos.getZ(), 32, false) == null) continue;
            if (piece.use() == Use.SHOWER) {
                float[] head = turn(8, 10, p.rot);
                world.spawnParticles(ParticleTypes.FALLING_WATER, p.pos.getX() + head[0] / 16, p.pos.getY() + 1.65,
                        p.pos.getZ() + head[1] / 16, 6, 0.15, 0.02, 0.15, 0);
                if (ticks % 40 == 0) world.playSound(null, p.pos, SoundEvents.WEATHER_RAIN, SoundCategory.BLOCKS, 0.25f, 1.6f);
            } else if (piece.use() == Use.STOVE && ticks % 10 == 0) {
                world.spawnParticles(ParticleTypes.SMOKE, p.pos.getX() + 0.5, p.pos.getY() + 1.05, p.pos.getZ() + 0.5, 2, 0.25, 0, 0.25, 0.005);
            } else if (piece.use() == Use.WATER && !"bathtub".equals(p.type)) {
                float[] tap = turn(8, 11.5f, p.rot);
                double ty = "kitchen_sink".equals(p.type) ? 1.2 : 1.05;
                world.spawnParticles(ParticleTypes.FALLING_WATER, p.pos.getX() + tap[0] / 16, p.pos.getY() + ty,
                        p.pos.getZ() + tap[1] / 16, 1, 0.01, 0, 0.01, 0);
            }
        }
    }

    /** Seats left over from before a restart. */
    static void onEntityLoad(Entity entity, ServerWorld world) {
        if (entity.getCommandTags().contains(SEAT_TAG) && !entity.hasPassengers()) world.getServer().execute(() -> {
            if (!entity.hasPassengers()) entity.discard();
        });
    }

    // ---------------------------------------------------------------------------------------
    // The catalogue: /helper furniture
    // ---------------------------------------------------------------------------------------

    static void openCatalog(ServerPlayerEntity player) {
        player.openHandledScreen(new SimpleNamedScreenHandlerFactory(
                (syncId, inv, p) -> new Catalog(syncId, inv, player), Text.literal("Furniture Catalogue")));
    }

    static final class Catalog extends GenericContainerScreenHandler {
        private static final int SIZE = 54;
        private final ServerPlayerEntity player;
        private final SimpleInventory view;
        private int room;
        private final List<Piece> shown = new ArrayList<>();

        Catalog(int syncId, PlayerInventory inv, ServerPlayerEntity player) {
            this(syncId, inv, player, new SimpleInventory(SIZE));
        }

        private Catalog(int syncId, PlayerInventory inv, ServerPlayerEntity player, SimpleInventory view) {
            super(ScreenHandlerType.GENERIC_9X6, syncId, inv, view, 6);
            this.player = player;
            this.view = view;
            refresh();
        }

        private void refresh() {
            for (int i = 0; i < SIZE; i++) view.setStack(i, ItemStack.EMPTY);
            for (int r = 0; r < ROOMS.length; r++) {
                ItemStack tab = Storage.Menu.button(ROOM_ICONS[r], ROOMS[r], r == room ? "Showing now" : "Click to show");
                if (r == room) tab.addEnchantment(net.minecraft.enchantment.Enchantments.UNBREAKING, 1);
                view.setStack(r, tab);
            }
            shown.clear();
            for (Piece p : PIECES) if (p.room().equals(ROOMS[room])) shown.add(p);
            boolean free = player.isCreative();
            for (int i = 0; i < shown.size() && 18 + i < 45; i++) {
                Piece p = shown.get(i);
                ItemStack b = Storage.Menu.button(p.icon(), p.name(), free ? "Free in creative" : "Costs " + p.price() + " tycoon coins",
                        p.width() + "x" + p.height() + (p.use() == Use.STORAGE ? ", holds 27 stacks" : ""), "Click to get one");
                view.setStack(18 + i, b);
            }
            long coins = Tycoon.Data.get(player.getServer()).coins(player.getUuid());
            view.setStack(49, Storage.Menu.button(Items.GOLD_INGOT, coins + " coins", "Earn coins with Tycoon Droppers"));
            view.setStack(53, Storage.Menu.button(Items.BOOK, "How to customize",
                    "Right-click a piece holding planks (wood), a log (legs),", "wool or a dye (fabric), or any block (the top).",
                    "Sneak + empty hand turns it. Empty hand uses it.", "Punch it to pick it up."));
            sendContentUpdates();
        }

        @Override
        public void onSlotClick(int slot, int button, SlotActionType action, PlayerEntity p) {
            if (slot < 0 || slot >= SIZE) {
                if (action != SlotActionType.QUICK_MOVE) super.onSlotClick(slot, button, action, p);
                return;
            }
            if (action == SlotActionType.PICKUP) {
                if (slot < ROOMS.length) room = slot;
                else if (slot >= 18 && slot - 18 < shown.size()) get(shown.get(slot - 18));
            }
            refresh();
        }

        private void get(Piece piece) {
            if (!player.isCreative()) {
                Tycoon.Data data = Tycoon.Data.get(player.getServer());
                if (data.coins(player.getUuid()) < piece.price()) {
                    player.sendMessage(Text.literal("You need " + piece.price() + " tycoon coins (you have "
                            + data.coins(player.getUuid()) + "). /helper tycoon start to begin earning.").formatted(Formatting.RED), true);
                    return;
                }
                data.add(player.getUuid(), -piece.price());
            }
            player.getInventory().offerOrDrop(item(piece, null));
            player.playSound(SoundEvents.ENTITY_VILLAGER_YES, SoundCategory.PLAYERS, 0.6f, 1.2f);
        }

        @Override
        public ItemStack quickMove(PlayerEntity p, int slot) {
            return ItemStack.EMPTY;
        }

        @Override
        public boolean canUse(PlayerEntity p) {
            return true;
        }
    }

    static void reset() {
        ticks = 0;
    }
}
