package com.helpermod.client;

import com.mojang.blaze3d.platform.NativeImage;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.tags.FluidTags;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.monster.Enemy;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraft.world.level.material.MapColor;
import net.minecraft.world.phys.AABB;

/**
 * A small north-up map in the top corner of the screen, drawn on the player's own PC from the chunks it has loaded.
 * Shows the land around you (or the cave you're in), you as an arrow, your helper as a gold dot, other players
 * as blue dots and monsters as red dots, with your coordinates underneath.
 *
 * /minimap toggles it; /minimap size|zoom|corner change it. Settings are kept in config/helpermod-minimap.properties.
 */
final class MiniMap {
    private MiniMap() {}

    static final int TEX = 128; // texels across; each texel is `zoom` blocks
    private static final Identifier ID = Identifier.fromNamespaceAndPath("helpermod", "minimap");

    static boolean enabled = true;
    static int size = 112;      // on-screen pixels across
    static int zoom = 1;        // blocks per texel: 1, 2 or 4
    static boolean left = false; // top-left instead of top-right

    private static DynamicTexture texture;
    private static final int[] pixels = new int[TEX * TEX];
    private static boolean dirty;
    private static int ticks;
    private static boolean cave;

    // ---------------------------------------------------------------------------------------
    // Scanning the world (client tick)
    // ---------------------------------------------------------------------------------------

    static void tick(Minecraft client) {
        if (!enabled || client.player == null || client.level == null) return;
        LocalPlayer p = client.player;
        ClientLevel level = client.level;
        BlockPos feet = p.blockPosition();
        cave = !level.canSeeSky(feet.above());
        if (++ticks % (cave ? 10 : 5) != 0) return;
        int px = feet.getX(), pz = feet.getZ(), py = feet.getY();
        int half = TEX / 2;
        int[] lastRow = new int[TEX];
        BlockPos.MutableBlockPos m = new BlockPos.MutableBlockPos();
        for (int j = 0; j < TEX; j++) {
            for (int i = 0; i < TEX; i++) {
                int wx = px + (i - half) * zoom, wz = pz + (j - half) * zoom;
                int color;
                int y;
                if (!level.hasChunk(wx >> 4, wz >> 4)) {
                    color = 0xFF101010;
                    y = Integer.MIN_VALUE;
                } else if (cave) {
                    // The floor near your height: walls show dark, open floor in its own colour.
                    y = py + 1;
                    m.set(wx, y, wz);
                    BlockState s = level.getBlockState(m);
                    if (!s.isAir()) {
                        color = shade(colorOf(level, m, s), 0.45f);
                    } else {
                        color = 0xFF000000;
                        for (int d = 1; d <= 12; d++) {
                            m.set(wx, py + 1 - d, wz);
                            s = level.getBlockState(m);
                            if (!s.isAir()) {
                                y = py + 1 - d;
                                color = shade(colorOf(level, m, s), 1f - d * 0.04f);
                                break;
                            }
                        }
                    }
                } else {
                    y = level.getHeight(Heightmap.Types.WORLD_SURFACE, wx, wz) - 1;
                    m.set(wx, y, wz);
                    BlockState s = level.getBlockState(m);
                    int guard = 0;
                    while (s.isAir() && y > level.getMinY() && guard++ < 16) {
                        m.set(wx, --y, wz);
                        s = level.getBlockState(m);
                    }
                    color = colorOf(level, m, s);
                    if (s.getFluidState().is(FluidTags.WATER)) { // deeper water reads darker
                        int depth = 0;
                        BlockPos.MutableBlockPos d = m.mutable();
                        while (depth < 10 && level.getFluidState(d.move(0, -1, 0)).is(FluidTags.WATER)) depth++;
                        color = shade(color, 1f - depth * 0.05f);
                    }
                }
                // Light from the north-west: higher than the texel above means brighter, lower means darker.
                if (j > 0 && y != Integer.MIN_VALUE && lastRow[i] != Integer.MIN_VALUE) {
                    if (y > lastRow[i]) color = shade(color, 1.15f);
                    else if (y < lastRow[i]) color = shade(color, 0.82f);
                }
                lastRow[i] = y;
                pixels[j * TEX + i] = color;
            }
        }
        dirty = true;
    }

    private static int colorOf(ClientLevel level, BlockPos pos, BlockState s) {
        MapColor mc = s.getMapColor(level, pos);
        if (mc == null || mc == MapColor.NONE) return 0xFF202020;
        return 0xFF000000 | mc.col;
    }

    private static int shade(int argb, float f) {
        int r = Math.min(255, Math.max(0, Math.round(((argb >> 16) & 0xFF) * f)));
        int g = Math.min(255, Math.max(0, Math.round(((argb >> 8) & 0xFF) * f)));
        int b = Math.min(255, Math.max(0, Math.round((argb & 0xFF) * f)));
        return (argb & 0xFF000000) | (r << 16) | (g << 8) | b;
    }

    // ---------------------------------------------------------------------------------------
    // Drawing (HUD)
    // ---------------------------------------------------------------------------------------

    static void render(GuiGraphicsExtractor ctx) {
        Minecraft client = Minecraft.getInstance();
        if (!enabled || client.player == null || client.level == null || ClientCompat.hudHidden(client)) return;
        if (ClientCompat.screen(client) != null) return; // keep menus clean
        if (texture == null) {
            texture = new DynamicTexture(() -> "helpermod_minimap", new NativeImage(TEX, TEX, false));
            client.getTextureManager().register(ID, texture);
        }
        if (dirty) {
            NativeImage img = texture.getPixels();
            if (img != null) {
                for (int j = 0; j < TEX; j++) for (int i = 0; i < TEX; i++) img.setPixel(i, j, pixels[j * TEX + i]);
                texture.upload();
            }
            dirty = false;
        }
        int sw = client.getWindow().getGuiScaledWidth();
        int x = left ? 6 : sw - size - 6, y = 6;
        Font font = client.font;

        ctx.fill(x - 2, y - 2, x + size + 2, y + size + 2, 0xCC000000);
        ctx.blit(net.minecraft.client.renderer.RenderPipelines.GUI_TEXTURED, ID, x, y, 0f, 0f, size, size, TEX, TEX, TEX, TEX);

        LocalPlayer p = client.player;
        double scale = (double) size / (TEX * zoom); // screen pixels per block
        double cx = x + size / 2.0, cy = y + size / 2.0;
        double radius = TEX * zoom / 2.0;

        // Dots: monsters red, other players blue, helpers gold (yours brighter).
        String me = p.getGameProfile().name();
        AABB box = p.getBoundingBox().inflate(radius, 48, radius);
        for (Entity e : client.level.getEntities((Entity) null, box, e -> e != p && e.isAlive())) {
            int color;
            int dot = 2;
            String name = e.getCustomName() == null ? "" : e.getCustomName().getString();
            if (name.endsWith("'s Helper")) {
                color = name.equals(me + "'s Helper") ? 0xFFFFC800 : 0xFFC08A30;
                dot = 3;
            } else if (e instanceof Player) {
                color = 0xFF4FA8FF;
                dot = 3;
            } else if (e instanceof Enemy) {
                color = 0xFFFF3030;
            } else {
                continue;
            }
            int ex = (int) Math.round(cx + (e.getX() - p.getX()) * scale);
            int ey = (int) Math.round(cy + (e.getZ() - p.getZ()) * scale);
            if (ex < x + 1 || ey < y + 1 || ex > x + size - 2 || ey > y + size - 2) continue;
            ctx.fill(ex - dot / 2 - 1, ey - dot / 2 - 1, ex - dot / 2 + dot + 1, ey - dot / 2 + dot + 1, 0xFF000000);
            ctx.fill(ex - dot / 2, ey - dot / 2, ex - dot / 2 + dot, ey - dot / 2 + dot, color);
        }

        // You: a white square with a yellow pointer the way you're facing.
        double yaw = Math.toRadians(p.getYRot());
        double dx = -Math.sin(yaw), dz = Math.cos(yaw);
        for (int k = 2; k <= 6; k++) {
            int ax = (int) Math.round(cx + dx * k), ay = (int) Math.round(cy + dz * k);
            ctx.fill(ax - 1, ay - 1, ax + 1, ay + 1, 0xFFFFE040);
        }
        int pcx = (int) Math.round(cx), pcy = (int) Math.round(cy);
        ctx.fill(pcx - 2, pcy - 2, pcx + 2, pcy + 2, 0xFF000000);
        ctx.fill(pcx - 1, pcy - 1, pcx + 1, pcy + 1, 0xFFFFFFFF);

        // North marker and coordinates.
        ctx.centeredText(font, Component.literal("N").withStyle(ChatFormatting.BOLD), x + size / 2, y + 2, 0xFFFFFFFF);
        BlockPos b = p.blockPosition();
        String coords = b.getX() + ", " + b.getY() + ", " + b.getZ() + (cave ? "  (cave)" : "");
        ctx.centeredText(font, Component.literal(coords), x + size / 2, y + size + 5, 0xFFFFFFFF);
    }

    // ---------------------------------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------------------------------

    private static Path file() {
        return FabricLoader.getInstance().getConfigDir().resolve("helpermod-minimap.properties");
    }

    static void load() {
        Properties props = new Properties();
        try (Reader r = Files.newBufferedReader(file())) {
            props.load(r);
        } catch (IOException ignored) {
            return; // first run: defaults
        }
        enabled = !"false".equals(props.getProperty("enabled"));
        size = clampSize(parse(props.getProperty("size"), size));
        zoom = clampZoom(parse(props.getProperty("zoom"), zoom));
        left = "left".equals(props.getProperty("corner"));
    }

    static void save() {
        Properties props = new Properties();
        props.setProperty("enabled", String.valueOf(enabled));
        props.setProperty("size", String.valueOf(size));
        props.setProperty("zoom", String.valueOf(zoom));
        props.setProperty("corner", left ? "left" : "right");
        try (Writer w = Files.newBufferedWriter(file())) {
            props.store(w, "Helper Buddies mini map");
        } catch (IOException ignored) {
        }
    }

    static int clampSize(int s) {
        return Math.max(64, Math.min(192, s));
    }

    static int clampZoom(int z) {
        return z >= 4 ? 4 : z >= 2 ? 2 : 1;
    }

    private static int parse(String s, int fallback) {
        try {
            return s == null ? fallback : Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
