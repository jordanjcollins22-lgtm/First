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
 * uses it: sit on chairs, sofas, toilets and benches; sleep in the bed; craft at the desk; open cupboards; switch lamps,
 * the TV, taps, the stove and showers on and off. Lit stoves, grills and fire pits cook raw food; showers and tubs wash you
 * (the hot tub heals). Punch it to pick it up (it keeps its materials).
 */
final class Furniture {
    private Furniture() {}

    // ---------------------------------------------------------------------------------------
    // What each piece is made of
    // ---------------------------------------------------------------------------------------

    /** Which material a part uses. WOOD, LEGS, FABRIC and TOP can be changed; the others are fixed or switch on/off. */
    enum Role { WOOD, LEGS, FABRIC, TOP, WHITE, BLACK, GRAY, METAL, GLASS, WATER, SCREEN, LIGHT, BURNER, BOOKS, PLANT, POT }

    enum Use { NONE, SEAT, STORAGE, LIGHT, TV, WATER, STOVE, SHOWER, BED, CRAFT, CLOCK }

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

    static final String[] ROOMS = {"Kitchen", "Living room", "Dining room", "Bedroom", "Bathroom", "Outdoor", "Other"};
    private static final Item[] ROOM_ICONS = {Items.SMOKER, Items.BED.red(), Items.OAK_STAIRS, Items.BED.white(), Items.CAULDRON,
            Items.CAMPFIRE, Items.FLOWER_POT};

    // Pixel coordinates (0-16 per block). The front faces the player who placed it; extra blocks go to their left.
    static final List<Piece> PIECES = List.of(
            // Kitchen
            b("counter", "Kitchen", "Kitchen Counter (storage)", Items.BARREL).solid().use(Use.STORAGE).price(40)
                    .p(Role.WOOD, 0, 0, 2, 16, 14, 16).p(Role.LEGS, 1, 1, 1, 15, 13, 2).p(Role.METAL, 6, 10, 0.5, 10, 11, 1)
                    .p(Role.TOP, 0, 14, 0, 16, 16, 16).done(),
            b("kitchen_sink", "Kitchen", "Kitchen Sink (fill bottles and buckets)", Items.CAULDRON).solid().use(Use.WATER).price(60)
                    .p(Role.WOOD, 0, 0, 2, 16, 12, 16).p(Role.LEGS, 1, 1, 1, 15, 11, 2).p(Role.METAL, 6, 8, 0.5, 10, 9, 1)
                    .p(Role.TOP, 0, 12, 0, 16, 16, 3).p(Role.TOP, 0, 12, 13, 16, 16, 16).p(Role.TOP, 0, 12, 3, 3, 16, 13)
                    .p(Role.TOP, 13, 12, 3, 16, 16, 13).p(Role.METAL, 3, 12, 3, 13, 12.5, 13).p(Role.WATER, 3, 12.5, 3, 13, 14, 13)
                    .p(Role.METAL, 7, 16, 13, 9, 20, 15).p(Role.METAL, 7, 19, 9, 9, 20, 13).done(),
            b("stove", "Kitchen", "Stove (light it, then cook raw food on it)", Items.SMOKER).solid().use(Use.STOVE).price(80)
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
            b("tv", "Living room", "TV (switch it on to watch)", Items.CONCRETE.black()).use(Use.TV).price(120)
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
            b("desk", "Bedroom", "Desk (a working crafting table)", Items.CRAFTING_TABLE).size(2, 1).solid().use(Use.CRAFT).price(70)
                    .p(Role.WOOD, 0, 13, 0, 32, 15, 16).p(Role.WOOD, 0, 0, 1, 2, 13, 15).p(Role.WOOD, 22, 0, 1, 32, 13, 15)
                    .p(Role.LEGS, 23, 1, 0.5, 31, 6, 1).p(Role.LEGS, 23, 7, 0.5, 31, 12, 1).done(),
            b("headboard", "Bedroom", "Bed Headboard (put it behind a bed)", Items.BED.white()).size(2, 1).price(40)
                    .p(Role.LEGS, 0, 0, 14, 2, 22, 16).p(Role.LEGS, 30, 0, 14, 32, 22, 16).p(Role.FABRIC, 2, 6, 14.5, 30, 20, 15.5)
                    .p(Role.WOOD, 0, 20, 14, 32, 22, 16).done(),
            // A real vanilla bed (the fabric colour) inside a wooden frame: sleep in it and it sets your spawn.
            b("bed", "Bedroom", "Bed (sleep in it, sets your spawn)", Items.BED.red()).size(2, 1).use(Use.BED).price(80)
                    .p(Role.LEGS, -2, 0, 0, 0, 24, 2).p(Role.LEGS, -2, 0, 14, 0, 24, 16).p(Role.WOOD, -2, 4, 2, 0, 22, 14)
                    .p(Role.LEGS, 32, 0, 0, 34, 13, 2).p(Role.LEGS, 32, 0, 14, 34, 13, 16).p(Role.WOOD, 32, 3, 2, 34, 12, 14).done(),
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
            b("bathroom_sink", "Bathroom", "Bathroom Sink with Mirror (fill bottles and buckets)", Items.QUARTZ_PILLAR).use(Use.WATER).price(50)
                    .p(Role.WHITE, 6, 0, 8, 10, 10, 12).p(Role.WHITE, 2, 10, 4, 14, 11, 16).p(Role.WHITE, 2, 11, 4, 14, 14, 5)
                    .p(Role.WHITE, 2, 11, 15, 14, 14, 16).p(Role.WHITE, 2, 11, 5, 3, 14, 15).p(Role.WHITE, 13, 11, 5, 14, 14, 15)
                    .p(Role.WATER, 3, 11, 5, 13, 13, 15).p(Role.METAL, 7, 14, 13, 9, 18, 15).p(Role.METAL, 7, 17, 10, 9, 18, 13)
                    .p(Role.WOOD, 1, 19, 15, 15, 32, 16).p(Role.GLASS, 2, 20, 14.8, 14, 31, 15).done(),
            b("shower", "Bathroom", "Shower (switch it on, stand in it to wash)", Items.STAINED_GLASS.lightBlue()).size(1, 2).use(Use.SHOWER).price(90)
                    .p(Role.WHITE, 0, 0, 0, 16, 1, 16).p(Role.GLASS, 0, 1, 0, 0.5, 30, 16).p(Role.GLASS, 15.5, 1, 0, 16, 30, 16)
                    .p(Role.TOP, 0, 1, 15.5, 16, 30, 16).p(Role.METAL, 7, 28, 10, 9, 29, 15.5).p(Role.METAL, 6, 27, 8, 10, 28, 12).done(),
            b("towel_rack", "Bathroom", "Towel Rack (hang it on a wall)", Items.BANNER.white()).price(20)
                    .p(Role.METAL, 1, 12, 14, 2, 13, 16).p(Role.METAL, 14, 12, 14, 15, 13, 16).p(Role.METAL, 1, 12, 13.5, 15, 13, 14.5)
                    .p(Role.FABRIC, 2, 3, 13.8, 14, 12.5, 14.3).done(),
            // Outdoor
            b("picnic_table", "Outdoor", "Picnic Table (seats on both sides)", Items.OAK_TRAPDOOR).size(2, 1).seat(7).price(80)
                    .p(Role.WOOD, 0, 11, 3, 32, 13, 13).p(Role.WOOD, 0, 6, 0, 32, 7.5, 2.5).p(Role.WOOD, 0, 6, 13.5, 32, 7.5, 16)
                    .p(Role.LEGS, 3, 0, 1, 5, 11, 15).p(Role.LEGS, 27, 0, 1, 29, 11, 15).done(),
            b("patio_umbrella", "Outdoor", "Patio Umbrella", Items.WOOL.yellow()).size(1, 2).price(60)
                    .p(Role.GRAY, 5, 0, 5, 11, 1, 11).p(Role.METAL, 7.5, 1, 7.5, 8.5, 27, 8.5)
                    .p(Role.FABRIC, -8, 25.5, -8, 24, 27, 24).p(Role.FABRIC, -3, 27, -3, 19, 28.5, 19).p(Role.FABRIC, 3, 28.5, 3, 13, 29.5, 13).done(),
            b("sun_lounger", "Outdoor", "Sun Lounger", Items.WOOL.white()).seat(7).price(60)
                    .p(Role.LEGS, 1, 0, 1, 3, 4, 3).p(Role.LEGS, 13, 0, 1, 15, 4, 3).p(Role.LEGS, 1, 0, 13, 3, 4, 15).p(Role.LEGS, 13, 0, 13, 15, 4, 15)
                    .p(Role.WOOD, 1, 4, 0, 15, 6, 16).p(Role.FABRIC, 2, 6, 0.5, 14, 7, 11).p(Role.FABRIC, 2, 6, 11, 14, 16, 14).done(),
            b("bbq_grill", "Outdoor", "BBQ Grill (light it, then cook raw food on it)", Items.BLAST_FURNACE).solid().use(Use.STOVE).price(120)
                    .p(Role.METAL, 2, 0, 2, 4, 9, 4).p(Role.METAL, 12, 0, 2, 14, 9, 4).p(Role.METAL, 2, 0, 12, 4, 9, 14)
                    .p(Role.METAL, 12, 0, 12, 14, 9, 14).p(Role.BLACK, 1, 9, 1, 15, 14, 15).p(Role.BURNER, 2, 14, 2, 14, 14.4, 13)
                    .p(Role.BLACK, 1, 14, 13, 15, 22, 15).p(Role.WOOD, 15, 12, 4, 19, 13, 12).done(),
            b("fire_pit", "Outdoor", "Fire Pit (light it, then cook raw food on it)", Items.CAMPFIRE).use(Use.STOVE).price(70)
                    .p(Role.GRAY, 1, 0, 1, 15, 4, 3).p(Role.GRAY, 1, 0, 13, 15, 4, 15).p(Role.GRAY, 1, 0, 3, 3, 4, 13)
                    .p(Role.GRAY, 13, 0, 3, 15, 4, 13).p(Role.LEGS, 4, 0.5, 6, 12, 2.5, 8).p(Role.LEGS, 6, 0.5, 4, 8, 2.5, 12)
                    .p(Role.BURNER, 5, 2.5, 5, 11, 4, 11).done(),
            b("lamp_post", "Outdoor", "Garden Lamp Post (switch it on)", Items.LANTERN).size(1, 2).use(Use.LIGHT).price(60)
                    .p(Role.BLACK, 5, 0, 5, 11, 2, 11).p(Role.BLACK, 7, 2, 7, 9, 26, 9).p(Role.LIGHT, 5, 26, 5, 11, 31, 11)
                    .p(Role.BLACK, 4.5, 31, 4.5, 11.5, 32, 11.5).done(),
            b("mailbox", "Outdoor", "Mailbox (storage)", Items.IRON_TRAPDOOR).use(Use.STORAGE).price(40)
                    .p(Role.LEGS, 7, 0, 7, 9, 10, 9).p(Role.TOP, 4, 10, 3, 12, 16, 15).p(Role.BLACK, 4.5, 10.5, 2.5, 11.5, 15.5, 3)
                    .p(Role.FABRIC, 12, 13, 10, 12.6, 19, 12).done(),
            b("planter_box", "Outdoor", "Planter Box", Items.FLOWERING_AZALEA).size(2, 1).solid().price(40)
                    .p(Role.WOOD, 0, 0, 2, 32, 8, 14).p(Role.POT, 1, 6, 3, 31, 7.5, 13).p(Role.PLANT, 2, 7.5, 4, 30, 13, 12).done(),
            b("hot_tub", "Outdoor", "Hot Tub (fill it, sit in it to heal)", Items.WATER_BUCKET).size(2, 1).seat(4)
                    .use(Use.WATER).price(150)
                    .p(Role.WOOD, 0, 0, 0, 32, 2, 16).p(Role.WOOD, 0, 2, 0, 32, 12, 2).p(Role.WOOD, 0, 2, 14, 32, 12, 16)
                    .p(Role.WOOD, 0, 2, 2, 2, 12, 14).p(Role.WOOD, 30, 2, 2, 32, 12, 14).p(Role.WATER, 2, 2, 2, 30, 10, 14)
                    .p(Role.TOP, 0, 12, 0, 32, 13, 2).p(Role.TOP, 0, 12, 14, 32, 13, 16).p(Role.METAL, 29, 12, 7, 31, 14, 9).done(),
            b("fountain", "Outdoor", "Garden Fountain (switch it on)", Items.STONE_BRICK_WALL).solid().use(Use.WATER).price(100)
                    .p(Role.GRAY, 0, 0, 0, 16, 5, 16).p(Role.WATER, 1, 3, 1, 15, 4.5, 15).p(Role.GRAY, 6, 5, 6, 10, 14, 10)
                    .p(Role.GRAY, 3, 14, 3, 13, 15, 13).p(Role.WATER, 4, 15, 4, 12, 15.5, 12).done(),
            b("patio_chair", "Outdoor", "Patio Chair", Items.BIRCH_STAIRS).seat(8).price(30)
                    .p(Role.METAL, 2, 0, 2, 3, 8, 3).p(Role.METAL, 13, 0, 2, 14, 8, 3).p(Role.METAL, 2, 0, 13, 3, 8, 14)
                    .p(Role.METAL, 13, 0, 13, 14, 8, 14).p(Role.WOOD, 2, 7, 2, 14, 8, 14).p(Role.WOOD, 2, 8, 13, 14, 18, 14).done(),
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
            b("wall_clock", "Other", "Wall Clock (shows the real time)", Items.CLOCK).use(Use.CLOCK).price(30)
                    .p(Role.WOOD, 3, 4, 15, 13, 14, 16).p(Role.WHITE, 4, 5, 14.8, 12, 13, 15).done());

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
        /** Raw food cooking on a stove, grill or fire pit, and how long it has been on. */
        final List<ItemStack> cooking = new ArrayList<>();
        int cookTicks;

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
                if (c.contains("cooking")) {
                    NonNullList<ItemStack> food = NonNullList.withSize(COOK_SLOTS, ItemStack.EMPTY);
                    Compat.loadItems(c.getCompoundOrEmpty("cooking"), food);
                    for (ItemStack st : food) if (!st.isEmpty()) p.cooking.add(st);
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
                if (!p.cooking.isEmpty()) {
                    NonNullList<ItemStack> food = NonNullList.withSize(COOK_SLOTS, ItemStack.EMPTY);
                    for (int s = 0; s < p.cooking.size() && s < COOK_SLOTS; s++) food.set(s, p.cooking.get(s));
                    c.put("cooking", Compat.saveItems(food));
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
        // The piece itself: its 3D model (resource pack) on an item display, tinted with its materials.
        spawnModel(world, tag, p, piece, false);
        if (p.on && hasGlow(piece)) spawnModel(world, tag, p, piece, true); // screens, bulbs and burners, lit up
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
        if (piece.use() == Use.BED) placeBed(world, p, piece);
        if (piece.use() == Use.TV || piece.use() == Use.CLOCK) showText(world, id, p, piece);
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

    // ---------------------------------------------------------------------------------------
    // 3D models: assets/helpermod/items/furniture/<id>.json (made by tools/furniture_models.py)
    // ---------------------------------------------------------------------------------------

    private static boolean hasGlow(Piece piece) {
        for (Part part : piece.parts()) if (part.role() == Role.SCREEN || part.role() == Role.LIGHT || part.role() == Role.BURNER) return true;
        return false;
    }

    private static void spawnModel(ServerLevel world, String tag, Placed p, Piece piece, boolean glow) {
        ItemStack look = new ItemStack(Items.STICK);
        look.set(net.minecraft.core.component.DataComponents.ITEM_MODEL,
                Identifier.fromNamespaceAndPath(HelperMod.MOD_ID, "furniture/" + piece.id() + (glow ? "_glow" : "")));
        look.set(net.minecraft.core.component.DataComponents.CUSTOM_MODEL_DATA, new net.minecraft.world.item.component.CustomModelData(
                List.of(), List.of(p.on), List.of(), List.of(tint(Role.WOOD, p), tint(Role.LEGS, p), tint(Role.FABRIC, p), tint(Role.TOP, p))));
        CompoundTag nbt = new CompoundTag();
        nbt.putString("id", "minecraft:item_display");
        nbt.put("item", Compat.saveStack(look));
        nbt.putString("item_display", "none");
        // The model is drawn at half size around the first block's centre; scale it back up and turn it to face the player.
        double angle = -Math.PI / 2 * p.rot;
        CompoundTag tf = new CompoundTag();
        tf.put("translation", floats(0, 0, 0));
        tf.put("left_rotation", floats(0, (float) Math.sin(angle / 2), 0, (float) Math.cos(angle / 2)));
        tf.put("scale", floats(2, 2, 2));
        tf.put("right_rotation", floats(0, 0, 0, 1));
        nbt.put("transformation", tf);
        nbt.putFloat("width", 3);
        nbt.putFloat("height", 3);
        nbt.putFloat("view_range", 1.5f);
        if (glow) {
            CompoundTag light = new CompoundTag();
            light.putInt("block", 15);
            light.putInt("sky", 15);
            nbt.put("brightness", light);
        }
        nbt.put("Tags", tags(PART_TAG, tag));
        spawn(world, nbt, p.pos.getX() + 0.5, p.pos.getY() + 0.5, p.pos.getZ() + 0.5, 0);
    }

    /** Real wood colours (the map colours are too dull), by the wood's name. */
    private static final String[][] WOODS = {
            {"pale_oak", "E6DCD8"}, {"dark_oak", "553A1F"}, {"oak", "B8945F"}, {"spruce", "7A5A34"}, {"birch", "D8C58C"},
            {"jungle", "B4825C"}, {"acacia", "B8613A"}, {"mangrove", "773934"}, {"cherry", "E3B4AE"}, {"bamboo", "C9B25A"},
            {"crimson", "7E3A56"}, {"warped", "3A8E8C"}};

    private static int tint(Role role, Placed p) {
        String id = switch (role) {
            case WOOD -> p.wood;
            case LEGS -> p.legs.isEmpty() ? stripped(p.wood) : p.legs;
            case FABRIC -> p.fabric;
            default -> p.top;
        };
        Identifier key = Identifier.tryParse(id);
        String path = key == null ? "" : key.getPath();
        if (path.endsWith("_wool") || path.endsWith("_carpet")) {
            DyeColor dye = DyeColor.byName(path.substring(0, path.lastIndexOf('_')), null);
            if (dye != null) return 0xFF000000 | dye.getTextureDiffuseColor();
        }
        if (role != Role.TOP || path.contains("planks") || path.contains("log") || path.contains("wood") || path.contains("stem")) {
            for (String[] w : WOODS) {
                if (path.contains(w[0])) {
                    int c = Integer.parseInt(w[1], 16);
                    boolean bark = (path.endsWith("_log") || path.endsWith("_wood") || path.endsWith("_stem")) && !path.startsWith("stripped_");
                    return 0xFF000000 | (bark ? shade(c, 0.6f) : c);
                }
            }
        }
        BlockState st = state(id, Blocks.SMOOTH_QUARTZ.defaultBlockState());
        int c = st.getMapColor(EmptyBlockGetter.INSTANCE, BlockPos.ZERO).col;
        return 0xFF000000 | (c == 0 ? 0xF0F0F0 : c);
    }

    private static int shade(int rgb, float f) {
        int r = Math.min(255, Math.round(((rgb >> 16) & 255) * f)), g = Math.min(255, Math.round(((rgb >> 8) & 255) * f)),
                b = Math.min(255, Math.round((rgb & 255) * f));
        return (r << 16) | (g << 8) | b;
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
            // deflate: each piece's click box pokes 0.01 into the blocks around it, which used to block the next piece
            if (!world.getBlockState(cell).canBeReplaced() || !world.getEntitiesOfClass(Entity.class, new AABB(cell).deflate(0.1),
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
            clearBlocks(world, piece, placed, placed.rot);
            if (drop) net.minecraft.world.Containers.dropItemStack(world, placed.pos.getX() + 0.5, placed.pos.getY() + 0.5,
                    placed.pos.getZ() + 0.5, item(piece, placed.materials()));
        }
        if (placed.storage != null) net.minecraft.world.Containers.dropContents(world, placed.pos, placed.storage);
        for (ItemStack food : placed.cooking) net.minecraft.world.Containers.dropItemStack(world, placed.pos.getX() + 0.5,
                placed.pos.getY() + 1, placed.pos.getZ() + 0.5, food);
        placed.cooking.clear();
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

        // Holding another piece: put it right next to this one, on the side you clicked (or on top).
        if (furnitureOf(held) != null) {
            net.minecraft.world.phys.Vec3 rel = hit.getLocation().subtract(entity.position());
            double dx = rel.x, dy = rel.y - entity.getBbHeight() / 2, dz = rel.z;
            Direction side = Math.abs(dy) >= Math.abs(dx) && Math.abs(dy) >= Math.abs(dz) ? (dy > 0 ? Direction.UP : Direction.DOWN)
                    : Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? Direction.EAST : Direction.WEST) : (dz > 0 ? Direction.SOUTH : Direction.NORTH);
            BlockPos next = entity.blockPosition().relative(side);
            return onUseBlock(player, w, hand, new BlockHitResult(hit.getLocation(), side, next, false));
        }

        if (piece.use() == Use.STOVE && cookedOf(held) != null) {
            cook(world, player, placed, piece, held);
            data.setDirty();
            if (!placed.on) {
                placed.on = true;
                rebuild(world, id, placed);
            }
            return InteractionResult.SUCCESS;
        }
        if (piece.use() == Use.WATER && held.is(Items.BUCKET)) {
            held.shrink(1);
            player.getInventory().placeItemBackInInventory(new ItemStack(Items.WATER_BUCKET), net.minecraft.util.Prediction.SERVER_ONLY);
            world.playSound(null, placed.pos, SoundEvents.BUCKET_FILL, SoundSource.BLOCKS, 1f, 1f);
            return InteractionResult.SUCCESS;
        }
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
            clearBlocks(world, piece, placed, placed.rot);
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
            case BED -> sleep(world, player, placed, piece);
            case CRAFT -> openCrafting(world, player, placed);
            case CLOCK -> player.sendOverlayMessage(Component.literal("It's " + clockText(world) + ".").withStyle(ChatFormatting.YELLOW));
            case LIGHT, TV, WATER, STOVE, SHOWER -> {
                if (piece.use() == Use.STOVE && placed.on && !placed.cooking.isEmpty()) {
                    player.sendOverlayMessage(Component.literal("Still cooking. It'll pop out when it's done.").withStyle(ChatFormatting.YELLOW));
                    return InteractionResult.SUCCESS;
                }
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
        if (piece.use() == Use.STOVE && placed.on && held.isEmpty() && !player.isShiftKeyDown()) {
            player.sendOverlayMessage(Component.literal("Lit. Right-click it holding raw meat, fish or potatoes to cook them.")
                    .withStyle(ChatFormatting.GRAY));
        }
        return InteractionResult.SUCCESS;
    }

    // ---------------------------------------------------------------------------------------
    // Working like the real thing: beds, cooking, crafting, washing, screens
    // ---------------------------------------------------------------------------------------

    static final int COOK_SLOTS = 8;
    private static final int COOK_TIME = 200; // ticks: 10 seconds, half a furnace

    /** What raw food turns into on a stove, grill or fire pit. */
    static Item cookedOf(ItemStack raw) {
        if (raw.isEmpty()) return null;
        Item i = raw.getItem();
        if (i == Items.BEEF) return Items.COOKED_BEEF;
        if (i == Items.PORKCHOP) return Items.COOKED_PORKCHOP;
        if (i == Items.CHICKEN) return Items.COOKED_CHICKEN;
        if (i == Items.MUTTON) return Items.COOKED_MUTTON;
        if (i == Items.RABBIT) return Items.COOKED_RABBIT;
        if (i == Items.COD) return Items.COOKED_COD;
        if (i == Items.SALMON) return Items.COOKED_SALMON;
        if (i == Items.POTATO) return Items.BAKED_POTATO;
        if (i == Items.KELP) return Items.DRIED_KELP;
        return null;
    }

    private static int cookingCount(Placed p) {
        int n = 0;
        for (ItemStack s : p.cooking) n += s.getCount();
        return n;
    }

    private static void cook(ServerLevel world, ServerPlayer player, Placed placed, Piece piece, ItemStack held) {
        int room = COOK_SLOTS - cookingCount(placed);
        if (room <= 0) {
            player.sendOverlayMessage(Component.literal("It's full. Wait for this batch to finish.").withStyle(ChatFormatting.YELLOW));
            return;
        }
        int n = Math.min(room, held.getCount());
        ItemStack in = held.copyWithCount(n);
        held.shrink(n);
        boolean merged = false;
        for (ItemStack s : placed.cooking) {
            if (ItemStack.isSameItemSameComponents(s, in)) {
                s.grow(n);
                merged = true;
                break;
            }
        }
        if (!merged) placed.cooking.add(in);
        placed.cookTicks = Math.min(placed.cookTicks, COOK_TIME / 2); // new food needs a moment too
        world.playSound(null, placed.pos, SoundEvents.FIRECHARGE_USE, SoundSource.BLOCKS, 0.4f, 1.6f);
        player.sendOverlayMessage(Component.literal("Cooking " + cookingCount(placed) + " on the " + piece.name().replaceAll(" \\(.*\\)", "")
                + ". Ready in about 10 seconds.").withStyle(ChatFormatting.GREEN));
    }

    private static void tickCooking(ServerLevel world, Placed p) {
        if (p.cooking.isEmpty()) {
            p.cookTicks = 0;
            return;
        }
        p.cookTicks += 5;
        if (p.cookTicks % 40 == 0) world.playSound(null, p.pos, SoundEvents.CAMPFIRE_CRACKLE, SoundSource.BLOCKS, 0.5f, 1.3f);
        if (p.cookTicks < COOK_TIME) return;
        for (ItemStack raw : p.cooking) {
            Item cooked = cookedOf(raw);
            if (cooked == null) continue;
            net.minecraft.world.entity.item.ItemEntity drop = new net.minecraft.world.entity.item.ItemEntity(world,
                    p.pos.getX() + 0.5, p.pos.getY() + ("fire_pit".equals(p.type) ? 0.5 : 1.1), p.pos.getZ() + 0.5,
                    new ItemStack(cooked, raw.getCount()));
            drop.setDeltaMovement(0, 0.2, 0);
            world.addFreshEntity(drop);
        }
        p.cooking.clear();
        p.cookTicks = 0;
        world.playSound(null, p.pos, SoundEvents.ITEM_PICKUP, SoundSource.BLOCKS, 0.7f, 0.8f);
        world.sendParticles(ParticleTypes.CLOUD, p.pos.getX() + 0.5, p.pos.getY() + 1.1, p.pos.getZ() + 0.5, 6, 0.2, 0.1, 0.2, 0.01);
    }

    /** Barriers, our light and our bed blocks, in the cells the piece covers when turned rot times. */
    private static void clearBlocks(ServerLevel world, Piece piece, Placed placed, int rot) {
        for (BlockPos rel : cells(piece, rot)) {
            BlockPos cell = placed.pos.offset(rel);
            BlockState st = world.getBlockState(cell);
            boolean bed = piece.use() == Use.BED && st.getBlock() instanceof net.minecraft.world.level.block.BedBlock;
            if (st.is(Blocks.BARRIER) || st.is(Blocks.LIGHT) || bed) {
                world.setBlock(cell, Blocks.AIR.defaultBlockState(), Block.UPDATE_ALL);
            }
        }
    }

    private static Direction frontOf(Placed placed) {
        return switch (placed.rot) { case 1 -> Direction.EAST; case 2 -> Direction.SOUTH; case 3 -> Direction.WEST; default -> Direction.NORTH; };
    }

    /** The two bed cells: the head on the placed block, the foot beside it. */
    private static BlockPos[] bedCells(Piece piece, Placed placed) {
        List<BlockPos> c = cells(piece, placed.rot);
        return new BlockPos[]{placed.pos.offset(c.get(0)), placed.pos.offset(c.get(1))};
    }

    private static void placeBed(ServerLevel world, Placed placed, Piece piece) {
        BlockPos[] at = bedCells(piece, placed);
        BlockPos head = at[0], foot = at[1];
        Direction facing = Direction.NORTH;
        for (Direction d : Direction.Plane.HORIZONTAL) if (foot.relative(d).equals(head)) facing = d;
        BlockState bed = Blocks.BED.red().defaultBlockState();
        Identifier colour = Identifier.tryParse(placed.fabric.replace("_wool", "_bed"));
        if (colour != null && BuiltInRegistries.BLOCK.containsKey(colour)) {
            BlockState s = BuiltInRegistries.BLOCK.getValue(colour).defaultBlockState();
            if (s.getBlock() instanceof net.minecraft.world.level.block.BedBlock) bed = s;
        }
        bed = bed.setValue(net.minecraft.world.level.block.BedBlock.FACING, facing);
        for (BlockPos c : at) {
            BlockState here = world.getBlockState(c);
            if (!here.canBeReplaced() && !(here.getBlock() instanceof net.minecraft.world.level.block.BedBlock)) return;
        }
        world.setBlock(foot, bed.setValue(net.minecraft.world.level.block.BedBlock.PART,
                net.minecraft.world.level.block.state.properties.BedPart.FOOT), Block.UPDATE_CLIENTS);
        world.setBlock(head, bed.setValue(net.minecraft.world.level.block.BedBlock.PART,
                net.minecraft.world.level.block.state.properties.BedPart.HEAD), Block.UPDATE_ALL);
    }

    private static void sleep(ServerLevel world, ServerPlayer player, Placed placed, Piece piece) {
        BlockPos head = bedCells(piece, placed)[0];
        if (!(world.getBlockState(head).getBlock() instanceof net.minecraft.world.level.block.BedBlock)) {
            placeBed(world, placed, piece);
            if (!(world.getBlockState(head).getBlock() instanceof net.minecraft.world.level.block.BedBlock)) {
                player.sendOverlayMessage(Component.literal("Something's in the way of the mattress.").withStyle(ChatFormatting.RED));
                return;
            }
        }
        // Exactly like right-clicking a vanilla bed: night check, monsters, spawn point, the Nether explosion.
        BlockHitResult hit = new BlockHitResult(net.minecraft.world.phys.Vec3.atCenterOf(head), Direction.UP, head, false);
        world.getBlockState(head).useWithoutItem(world, player, hit);
    }

    private static void openCrafting(ServerLevel world, ServerPlayer player, Placed placed) {
        net.minecraft.world.inventory.ContainerLevelAccess access = net.minecraft.world.inventory.ContainerLevelAccess.create(world, placed.pos);
        player.openMenu(new SimpleMenuProvider((syncId, inv, p) -> new net.minecraft.world.inventory.CraftingMenu(syncId, inv, access) {
            @Override
            public boolean stillValid(Player who) {
                return who.distanceToSqr(placed.pos.getX() + 0.5, placed.pos.getY() + 0.5, placed.pos.getZ() + 0.5) < 64;
            }
        }, Component.literal("Desk")));
    }

    private static final String TEXT_TAG = "hfurntext";

    /** The in-game time as a 24-hour clock, or day/night if this version hides the time of day. */
    static String clockText(ServerLevel world) {
        Long t = dayTime(world);
        if (t == null) return world.isDarkOutside() ? "night time" : "day time";
        long ticks = Math.floorMod(t + 6000, 24000L); // tick 0 is 6:00 in the morning
        long h = ticks / 1000, m = (ticks % 1000) * 60 / 1000;
        return String.format(java.util.Locale.ROOT, "%02d:%02d", h, m);
    }

    private static java.lang.reflect.Method dayTimeMethod;
    private static boolean dayTimeLooked;

    private static Long dayTime(ServerLevel world) {
        if (!dayTimeLooked) {
            dayTimeLooked = true;
            for (String name : new String[]{"getDayTime", "getOverworldClockTime", "getDefaultClockTime", "dayTime"}) {
                try {
                    java.lang.reflect.Method m = world.getClass().getMethod(name);
                    if (m.getReturnType() == long.class) {
                        dayTimeMethod = m;
                        break;
                    }
                } catch (ReflectiveOperationException ignored) {
                }
            }
        }
        if (dayTimeMethod == null) return null;
        try {
            return (Long) dayTimeMethod.invoke(world);
        } catch (ReflectiveOperationException | RuntimeException e) {
            return null;
        }
    }

    private static final String[] NEWS = {
            "Local helper mines a whole mountain, asks for a snack",
            "Creeper spotted near town. Residents told to stay calm",
            "Tycoon coin prices hit an all-time high",
            "Scientists confirm: diamonds are still at the bottom",
            "Weather team says rain later, maybe, possibly",
            "Furniture sales boom as everyone gets a hot tub",
            "Helper wins Most Helpful award for the 9th year",
            "Pig refuses to comment on missing carrots"};

    private static String tvText(ServerLevel world) {
        long slot = world.getGameTime() / 120; // a new channel every 6 seconds
        return switch ((int) (slot % 4)) {
            case 0 -> "Helper TV\n" + clockText(world);
            case 1 -> "Weather\n" + (world.isThundering() ? "Thunderstorms" : world.isRaining() ? "Rain" : world.isDarkOutside() ? "Clear night" : "Sunny");
            case 2 -> "Helper News\n" + NEWS[(int) ((slot / 4) % NEWS.length)];
            default -> "Tonight\n" + (world.isDarkOutside() ? "Stay inside, mobs about" : "Good day for mining");
        };
    }

    /** Puts the TV picture or the clock face on the piece (replacing what was there). */
    private static void showText(ServerLevel world, UUID id, Placed p, Piece piece) {
        String tag = PART_TAG + ":" + id;
        for (Entity e : world.getEntitiesOfClass(Entity.class, new AABB(p.pos).inflate(2),
                e -> e.entityTags().contains(TEXT_TAG) && e.entityTags().contains(tag))) e.discard();
        boolean tv = piece.use() == Use.TV;
        if (tv && !p.on) return;
        String text = tv ? tvText(world) : clockText(world);
        float[] at = tv ? turn(8, 8.7f, p.rot) : turn(8, 14.7f, p.rot);
        double y = p.pos.getY() + (tv ? 6.5 : 7.8) / 16.0;
        float scale = 0.6f;
        CompoundTag nbt = new CompoundTag();
        nbt.putString("id", "minecraft:text_display");
        nbt.putString("text", text);
        nbt.putInt("line_width", tv ? 85 : 60);
        nbt.putInt("background", tv ? 0xFF1E3A5F : 0);
        nbt.putBoolean("shadow", tv);
        CompoundTag tf = new CompoundTag();
        tf.put("translation", floats(0, 0, 0));
        tf.put("scale", floats(scale, scale, scale));
        tf.put("left_rotation", floats(0, 0, 0, 1));
        tf.put("right_rotation", floats(0, 0, 0, 1));
        nbt.put("transformation", tf);
        CompoundTag light = new CompoundTag();
        light.putInt("block", 15);
        light.putInt("sky", 15);
        nbt.put("brightness", light);
        nbt.put("Tags", tags(PART_TAG, tag, TEXT_TAG));
        spawn(world, nbt, p.pos.getX() + at[0] / 16, y, p.pos.getZ() + at[1] / 16, frontOf(p).toYRot());
    }

    private static void wash(ServerPlayer pl, boolean heal) {
        boolean dirty = pl.isOnFire() || pl.hasEffect(net.minecraft.world.effect.MobEffects.POISON)
                || pl.hasEffect(net.minecraft.world.effect.MobEffects.HUNGER) || pl.hasEffect(net.minecraft.world.effect.MobEffects.WITHER);
        pl.clearFire();
        pl.removeEffect(net.minecraft.world.effect.MobEffects.POISON);
        pl.removeEffect(net.minecraft.world.effect.MobEffects.HUNGER);
        pl.removeEffect(net.minecraft.world.effect.MobEffects.WITHER);
        if (heal && !pl.hasEffect(net.minecraft.world.effect.MobEffects.REGENERATION)) {
            pl.addEffect(new net.minecraft.world.effect.MobEffectInstance(net.minecraft.world.effect.MobEffects.REGENERATION, 100, 0, true, false));
        }
        if (dirty) pl.sendOverlayMessage(Component.literal("All washed off. You feel better.").withStyle(ChatFormatting.AQUA));
    }

    private static AABB area(Piece piece, Placed p) {
        AABB box = null;
        for (BlockPos rel : cells(piece, p.rot)) {
            AABB b = new AABB(p.pos.offset(rel));
            box = box == null ? b : box.minmax(b);
        }
        return box == null ? new AABB(p.pos) : box;
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
        for (Map.Entry<UUID, Placed> entry : data.placed.entrySet()) {
            Placed p = entry.getValue();
            Piece piece = piece(p.type);
            if (piece == null) continue;
            boolean screen = piece.use() == Use.CLOCK || (piece.use() == Use.TV && p.on);
            if (!screen && !p.on) continue;
            if (!screen && piece.use() != Use.SHOWER && piece.use() != Use.STOVE && piece.use() != Use.WATER) continue;
            ServerLevel world = server.getLevel(worldKey(p.world));
            if (world == null || !world.hasChunkAt(p.pos) || world.getNearestPlayer(p.pos.getX(), p.pos.getY(), p.pos.getZ(), 32, false) == null) continue;
            if (screen) {
                if (ticks % 20 == 0) showText(world, entry.getKey(), p, piece);
                continue;
            }
            if (piece.use() == Use.STOVE) tickCooking(world, p);
            if (ticks % 20 == 0 && (piece.use() == Use.SHOWER || "bathtub".equals(p.type) || "hot_tub".equals(p.type))) {
                AABB box = area(piece, p);
                boolean hot = "hot_tub".equals(p.type);
                for (ServerPlayer pl : world.players()) {
                    if (!pl.getBoundingBox().intersects(box)) continue;
                    if (piece.use() == Use.SHOWER || pl.isPassenger()) wash(pl, hot);
                }
            }
            if (piece.use() == Use.SHOWER) {
                float[] head = turn(8, 10, p.rot);
                world.sendParticles(ParticleTypes.FALLING_WATER, p.pos.getX() + head[0] / 16, p.pos.getY() + 1.65,
                        p.pos.getZ() + head[1] / 16, 6, 0.15, 0.02, 0.15, 0);
                if (ticks % 40 == 0) world.playSound(null, p.pos, SoundEvents.WEATHER_RAIN, SoundSource.BLOCKS, 0.25f, 1.6f);
            } else if (piece.use() == Use.STOVE && ticks % 10 == 0 && !"fire_pit".equals(p.type)) {
                world.sendParticles(ParticleTypes.SMOKE, p.pos.getX() + 0.5, p.pos.getY() + 1.05, p.pos.getZ() + 0.5, 2, 0.25, 0, 0.25, 0.005);
            } else if ("fire_pit".equals(p.type) && ticks % 5 == 0) { // flames as well as smoke
                world.sendParticles(ParticleTypes.FLAME, p.pos.getX() + 0.5, p.pos.getY() + 0.3, p.pos.getZ() + 0.5, 2, 0.15, 0.05, 0.15, 0.01);
                if (ticks % 40 == 0) world.playSound(null, p.pos, SoundEvents.CAMPFIRE_CRACKLE, SoundSource.BLOCKS, 0.6f, 1f);
            } else if ("hot_tub".equals(p.type) && ticks % 4 == 0) { // bubbling
                float[] mid = turn(16, 8, p.rot);
                world.sendParticles(ParticleTypes.BUBBLE_POP, p.pos.getX() + mid[0] / 16, p.pos.getY() + 0.65,
                        p.pos.getZ() + mid[1] / 16, 3, 0.5, 0, 0.3, 0);
            } else if ("fountain".equals(p.type)) {
                world.sendParticles(ParticleTypes.SPLASH, p.pos.getX() + 0.5, p.pos.getY() + 1.05, p.pos.getZ() + 0.5, 2, 0.2, 0.05, 0.2, 0);
            } else if (piece.use() == Use.WATER && !"bathtub".equals(p.type) && !"hot_tub".equals(p.type)) {
                float[] tap = turn(8, 11.5f, p.rot);
                double ty = "kitchen_sink".equals(p.type) ? 1.2 : 1.05;
                world.sendParticles(ParticleTypes.FALLING_WATER, p.pos.getX() + tap[0] / 16, p.pos.getY() + ty,
                        p.pos.getZ() + tap[1] / 16, 1, 0.01, 0, 0.01, 0);
            }
        }
    }

    /** Seats left over from before a restart. */
    static void onEntityLoad(Entity entity, ServerLevel world) {
        // Furniture placed before 2.7.0 is made of block displays: swap it for the 3D model once.
        if (entity.getType() == EntityTypes.BLOCK_DISPLAY && entity.entityTags().contains(PART_TAG)) {
            UUID id = idOf(entity);
            world.getServer().execute(() -> {
                entity.discard();
                Data data = Data.get(world.getServer());
                Placed placed = id == null ? null : data.placed.get(id);
                if (placed != null && UPGRADED.add(id)) rebuild(world, id, placed);
            });
            return;
        }
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

    private static final java.util.Set<UUID> UPGRADED = new java.util.HashSet<>();

    static void reset() {
        UPGRADED.clear();
        ticks = 0;
    }
}
