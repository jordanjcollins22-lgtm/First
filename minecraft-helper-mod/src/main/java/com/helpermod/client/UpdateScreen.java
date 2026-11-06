package com.helpermod.client;

import com.helpermod.Updater;
import com.mojang.blaze3d.platform.NativeImage;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.minecraft.ChatFormatting;
import net.minecraft.util.Util;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.util.FormattedCharSequence;

/**
 * The in-game "Helper Buddies X is available, update now?" screen.
 *
 * Shows the release notes of every version newer than yours (What's new / What to look for),
 * with screenshots from the notes drawn right in the list. Yes downloads in the background; the
 * new version goes live the next time Minecraft starts, because a running game can't reload a mod.
 */
public class UpdateScreen extends Screen {
    private static final Pattern MD_IMAGE = Pattern.compile("!\\[([^\\]]*)\\]\\(\\s*([^)\\s]+)[^)]*\\)");
    private static final Pattern HTML_IMAGE = Pattern.compile("<img[^>]*src=\"([^\"]+)\"[^>]*>", Pattern.CASE_INSENSITIVE);
    private static final Pattern MD_LINK = Pattern.compile("\\[([^\\]]+)\\]\\([^)]*\\)");
    private static final String RELEASES_PAGE = "https://github.com/jordanjcollins22-lgtm/First/releases";
    private static final int MAX_IMAGE_HEIGHT = 140;

    /** Screenshots, shared between openings of the screen so each downloads once. */
    private static final Map<String, Shot> SHOTS = new ConcurrentHashMap<>();

    private static final class Shot {
        volatile Identifier id;
        volatile int w, h;
        volatile boolean failed;
    }

    /** One piece of the notes: a heading, a text paragraph, a screenshot or a gap. */
    private record Block(Component text, String image, int gap) {}

    private final Screen parent;
    private final boolean preview; // /helperupdate preview: this version's own notes, no download
    private final List<Block> blocks = new ArrayList<>();
    private Button yes, notNow, skip, page, done;
    private double scroll;
    private int contentHeight;

    public UpdateScreen(Screen parent) {
        this(parent, false);
    }

    public UpdateScreen(Screen parent, boolean preview) {
        super(Component.literal("Helper Buddies update"));
        this.parent = parent;
        this.preview = preview;
    }

    private String shownVersion() {
        return preview ? Updater.currentVersion() : Updater.available();
    }

    private List<Updater.Release> releases() {
        if (!preview) return Updater.newerReleases();
        String notes = "";
        try (var in = UpdateScreen.class.getResourceAsStream("/helpermod-release-notes.md")) {
            if (in != null) notes = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception ignored) {
        }
        return List.of(new Updater.Release(Updater.currentVersion(), notes, null));
    }

    @Override
    protected void init() {
        buildBlocks();
        int bw = 150;
        int cx = width / 2;
        int row1 = height - 50, row2 = height - 26;
        yes = addRenderableWidget(Button.builder(Component.literal("Yes, update").withStyle(ChatFormatting.GREEN), b -> Updater.downloadAsync())
                .bounds(cx - bw - 4, row1, bw, 20).build());
        notNow = addRenderableWidget(Button.builder(Component.literal("Not now"), b -> {
                    onClose();
                    UpdateClient.remindInChat(Minecraft.getInstance());
                })
                .bounds(cx + 4, row1, bw, 20).build());
        skip = addRenderableWidget(Button.builder(Component.literal("Skip this version"), b -> {
                    String v = Updater.available();
                    if (v != null) Updater.skip(v);
                    onClose();
                })
                .bounds(cx - bw - 4, row2, bw, 20).build());
        page = addRenderableWidget(Button.builder(Component.literal("Open release page"), b -> Util.getPlatform().openUri(pageUrl()))
                .bounds(cx + 4, row2, bw, 20).build());
        done = addRenderableWidget(Button.builder(Component.literal("Keep playing"), b -> onClose())
                .bounds(cx - bw - 4, row1, bw, 20).build());
        updateButtons();
    }

    private String pageUrl() {
        List<Updater.Release> list = Updater.newerReleases();
        if (!list.isEmpty() && list.get(0).page() != null) return list.get(0).page();
        return RELEASES_PAGE;
    }

    private void updateButtons() {
        if (preview) {
            yes.visible = notNow.visible = skip.visible = false;
            done.visible = true;
            done.setMessage(Component.literal("Close preview"));
            return;
        }
        boolean ready = Updater.readyVersion() != null && Updater.readyVersion().equals(Updater.available());
        boolean busy = Updater.downloading();
        yes.visible = !ready;
        yes.active = !busy;
        yes.setMessage(busy ? Component.literal("Downloading...") : Updater.failed() != null
                ? Component.literal("Try again").withStyle(ChatFormatting.GREEN) : Component.literal("Yes, update").withStyle(ChatFormatting.GREEN));
        notNow.visible = !ready;
        skip.visible = !ready && !busy;
        done.visible = ready;
    }

    @Override
    public void tick() {
        updateButtons();
    }

    private int contentWidth() {
        return Math.min(380, width - 40);
    }

    private void buildBlocks() {
        blocks.clear();
        List<Updater.Release> list = releases();
        if (list.isEmpty()) {
            blocks.add(new Block(Component.literal("No notes for this update."), null, 0));
            return;
        }
        for (Updater.Release r : list) {
            blocks.add(new Block(Component.literal("Helper Buddies " + r.version()).withStyle(ChatFormatting.GOLD, ChatFormatting.BOLD), null, 0));
            boolean any = false;
            for (String raw : r.notes().replace("\r", "").split("\n")) {
                String line = raw.strip();
                // Pull screenshots out of the line, in order.
                List<String> images = new ArrayList<>();
                Matcher m = MD_IMAGE.matcher(line);
                while (m.find()) images.add(m.group(2));
                line = m.replaceAll("");
                Matcher h = HTML_IMAGE.matcher(line);
                while (h.find()) images.add(h.group(1));
                line = h.replaceAll("").replaceAll("<[^>]+>", "").strip();

                if (line.startsWith("Built from ")) continue; // old automatic release text
                if (!line.isEmpty()) {
                    any = true;
                    line = MD_LINK.matcher(line).replaceAll("$1").replace("**", "").replace("__", "").replace("`", "");
                    if (line.startsWith("#")) {
                        String head = line.replaceFirst("^#+\\s*", "");
                        blocks.add(new Block(null, null, 4));
                        blocks.add(new Block(Component.literal(head).withStyle(ChatFormatting.YELLOW, ChatFormatting.BOLD), null, 0));
                    } else if (line.startsWith("- ") || line.startsWith("* ")) {
                        blocks.add(new Block(Component.literal("• " + line.substring(2).strip()), null, 0));
                    } else if (line.matches("^\\d+[.)]\\s.*")) {
                        blocks.add(new Block(Component.literal(line), null, 0));
                    } else {
                        blocks.add(new Block(Component.literal(line).withStyle(ChatFormatting.GRAY), null, 0));
                    }
                } else if (images.isEmpty()) {
                    blocks.add(new Block(null, null, 4));
                }
                for (String url : images) {
                    any = true;
                    blocks.add(new Block(null, url, 0));
                    loadShot(url);
                }
            }
            if (!any) blocks.add(new Block(Component.literal("No notes for this version.").withStyle(ChatFormatting.GRAY), null, 0));
            blocks.add(new Block(null, null, 10));
        }
    }

    private static void loadShot(String url) {
        if (SHOTS.containsKey(url)) return;
        Shot shot = new Shot();
        SHOTS.put(url, shot);
        Thread t = new Thread(() -> {
            byte[] bytes = Updater.fetchBytes(url, 8 * 1024 * 1024);
            if (bytes == null) {
                shot.failed = true;
                return;
            }
            try {
                NativeImage img = NativeImage.read(new ByteArrayInputStream(bytes)); // PNG screenshots
                Minecraft client = Minecraft.getInstance();
                client.execute(() -> {
                    DynamicTexture tex = new DynamicTexture(img);
                    shot.w = img.getWidth();
                    shot.h = img.getHeight();
                    shot.id = client.getTextureManager().register("helpermod_update_shot", tex);
                });
            } catch (Exception e) {
                shot.failed = true;
            }
        }, "helpermod-update-shot");
        t.setDaemon(true);
        t.start();
    }

    @Override
    public void render(GuiGraphics ctx, int mouseX, int mouseY, float delta) {
        renderBackground(ctx);
        Font tr = font;
        int cw = contentWidth();
        int left = (width - cw) / 2;
        String v = shownVersion();
        ctx.drawCenteredString(tr, Component.literal((preview ? "Preview: " : "") + "Helper Buddies " + (v == null ? "" : v) + " is available!")
                .withStyle(ChatFormatting.AQUA, ChatFormatting.BOLD), width / 2, 8, 0xFFFFFF);

        Component sub;
        boolean ready = !preview && v != null && v.equals(Updater.readyVersion());
        if (preview) {
            sub = Component.literal("This is how the update screen looks when this version comes out. Nothing downloads from here.")
                    .withStyle(ChatFormatting.YELLOW);
        } else if (ready) {
            sub = Component.literal("Downloaded! It goes live the next time you open Minecraft. Keep playing for now.").withStyle(ChatFormatting.GREEN);
        } else if (Updater.downloading()) {
            sub = Component.literal("Downloading in the background... you can keep playing.").withStyle(ChatFormatting.YELLOW);
        } else if (Updater.failed() != null) {
            sub = Component.literal(Updater.failed()).withStyle(ChatFormatting.RED);
        } else {
            sub = Component.literal("You have " + Updater.currentVersion() + ". Update now? A restart is needed: it goes live next time you open Minecraft.")
                    .withStyle(ChatFormatting.WHITE);
        }
        int y = 22;
        for (FormattedCharSequence line : tr.split(sub, cw)) {
            ctx.drawCenteredString(tr, line, width / 2, y, 0xFFFFFF);
            y += 10;
        }
        ctx.drawCenteredString(tr, Component.literal("On LAN, the host's copy runs the helpers, so the host is the one who must update.")
                .withStyle(ChatFormatting.DARK_GRAY), width / 2, y, 0xFFFFFF);
        y += 14;

        int top = y, bottom = height - 56;
        ctx.fill(left - 6, top - 4, left + cw + 6, bottom + 4, 0xAA000000);
        ctx.enableScissor(left - 6, top - 2, left + cw + 6, bottom + 2);
        int cy = top - (int) scroll;
        for (Block b : blocks) {
            if (b.gap() > 0) {
                cy += b.gap();
            } else if (b.text() != null) {
                for (FormattedCharSequence line : tr.split(b.text(), cw)) {
                    ctx.drawString(tr, line, left, cy, 0xFFFFFF);
                    cy += 10;
                }
            } else if (b.image() != null) {
                Shot s = SHOTS.get(b.image());
                if (s != null && s.id != null && s.w > 0) {
                    float scale = Math.min(1f, Math.min((float) cw / s.w, (float) MAX_IMAGE_HEIGHT / s.h));
                    int dw = Math.max(1, (int) (s.w * scale)), dh = Math.max(1, (int) (s.h * scale));
                    ctx.blit(s.id, left + (cw - dw) / 2, cy + 2, dw, dh, 0, 0, s.w, s.h, s.w, s.h);
                    cy += dh + 6;
                } else {
                    String msg = s != null && s.failed ? "(Screenshot: press Open release page to see it)" : "(Loading screenshot...)";
                    ctx.drawString(tr, Component.literal(msg).withStyle(ChatFormatting.DARK_GRAY, ChatFormatting.ITALIC), left, cy, 0xFFFFFF);
                    cy += 12;
                }
            }
        }
        ctx.disableScissor();
        contentHeight = cy + (int) scroll - top;
        int maxScroll = Math.max(0, contentHeight - (bottom - top));
        if (scroll > maxScroll) scroll = maxScroll;
        if (maxScroll > 0) {
            // simple scrollbar
            int barH = Math.max(10, (bottom - top) * (bottom - top) / contentHeight);
            int barY = top + (int) ((bottom - top - barH) * (scroll / maxScroll));
            ctx.fill(left + cw + 3, barY, left + cw + 5, barY + barH, 0xFFAAAAAA);
        }
        super.render(ctx, mouseX, mouseY, delta);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double amount) {
        scroll = Math.max(0, scroll - amount * 14);
        return true;
    }

    @Override
    public void onClose() {
        Minecraft.getInstance().setScreen(parent);
    }
}
