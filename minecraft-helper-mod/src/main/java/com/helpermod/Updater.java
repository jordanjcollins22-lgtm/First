package com.helpermod;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Properties;

/**
 * Keeps the mod up to date by itself.
 *
 * When the game starts, this checks the repo's GitHub releases (tags named helper-v1.2.3) in the
 * background. If one is newer than the running version, its jar is downloaded next to the config.
 * The running jar is locked while the game is open, so the swap happens after the game closes:
 * a small script waits for Minecraft to exit, deletes the old jar and moves the new one into mods.
 * The next launch runs the new version.
 *
 * Turn it off with auto_update=false in config/helpermod-updater.properties.
 */
public final class Updater {
    private static final String RELEASES = "https://api.github.com/repos/jordanjcollins22-lgtm/First/releases?per_page=30";
    private static final String TAG_PREFIX = "helper-v";

    private static volatile String status = "Not checked yet.";
    private static volatile String readyVersion; // set once a newer jar has been downloaded
    private static Path oldJar;
    private static Path newJar;
    private static boolean hookAdded;

    private Updater() {}

    /** Called once from mod init. Never blocks the game. */
    public static void start() {
        Properties config = loadConfig();
        if (!"true".equalsIgnoreCase(config.getProperty("auto_update", "true").trim())) {
            status = "Auto-update is off (config/helpermod-updater.properties).";
            return;
        }
        Thread t = new Thread(Updater::check, "helpermod-updater");
        t.setDaemon(true);
        t.start();
    }

    public static String status() {
        return status;
    }

    /** Tell a player who just joined that a new version is waiting for a restart. */
    public static void onJoin(ServerPlayerEntity player) {
        String v = readyVersion;
        if (v == null) return;
        player.sendMessage(Text.literal("Helper Buddies " + v + " has been downloaded. Close and reopen Minecraft to use it.")
                .formatted(Formatting.AQUA), false);
    }

    private static void check() {
        try {
            ModContainer mod = FabricLoader.getInstance().getModContainer(HelperMod.MOD_ID).orElse(null);
            if (mod == null) return;
            String current = mod.getMetadata().getVersion().getFriendlyString();
            Path jar = runningJar(mod);
            if (jar == null) {
                status = "Running from a dev environment, so auto-update is skipped.";
                return;
            }

            HttpClient http = HttpClient.newBuilder()
                    .followRedirects(HttpClient.Redirect.NORMAL)
                    .connectTimeout(Duration.ofSeconds(10))
                    .build();
            HttpResponse<String> res = http.send(HttpRequest.newBuilder(URI.create(RELEASES))
                            .header("Accept", "application/vnd.github+json")
                            .header("User-Agent", "helpermod-updater")
                            .timeout(Duration.ofSeconds(20))
                            .build(),
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() != 200) {
                status = "Couldn't check for updates (GitHub said " + res.statusCode() + ").";
                return;
            }

            String bestVersion = null;
            String bestUrl = null;
            JsonArray releases = JsonParser.parseString(res.body()).getAsJsonArray();
            for (JsonElement el : releases) {
                JsonObject r = el.getAsJsonObject();
                if (r.has("draft") && r.get("draft").getAsBoolean()) continue;
                String tag = r.get("tag_name").getAsString();
                if (!tag.startsWith(TAG_PREFIX)) continue;
                String version = tag.substring(TAG_PREFIX.length());
                String url = jarAsset(r);
                if (url == null) continue;
                if (bestVersion == null || compare(version, bestVersion) > 0) {
                    bestVersion = version;
                    bestUrl = url;
                }
            }
            if (bestVersion == null || compare(bestVersion, current) <= 0) {
                status = "Up to date (" + current + ").";
                return;
            }

            Path dir = FabricLoader.getInstance().getConfigDir().resolve("helpermod").resolve("update");
            Files.createDirectories(dir);
            Path part = dir.resolve("helper-mod-" + bestVersion + ".part");
            Path done = dir.resolve("helper-mod-" + bestVersion + ".jar");
            if (!Files.exists(done)) {
                HttpResponse<InputStream> dl = http.send(HttpRequest.newBuilder(URI.create(bestUrl))
                                .header("User-Agent", "helpermod-updater")
                                .timeout(Duration.ofMinutes(2))
                                .build(),
                        HttpResponse.BodyHandlers.ofInputStream());
                if (dl.statusCode() != 200) {
                    status = "Found " + bestVersion + " but the download failed (" + dl.statusCode() + ").";
                    return;
                }
                try (InputStream in = dl.body(); OutputStream out = Files.newOutputStream(part)) {
                    in.transferTo(out);
                }
                if (Files.size(part) < 1024) {
                    Files.deleteIfExists(part);
                    status = "Found " + bestVersion + " but the download was empty.";
                    return;
                }
                Files.move(part, done, StandardCopyOption.REPLACE_EXISTING);
            }

            scheduleSwap(jar, jar.resolveSibling("helper-mod-" + bestVersion + ".jar"), done);
            readyVersion = bestVersion;
            status = "Version " + bestVersion + " is downloaded. It installs when you close Minecraft.";
            HelperMod.LOG.info("Helper Buddies {} downloaded; it will be installed when the game closes", bestVersion);
        } catch (Exception e) {
            status = "Couldn't check for updates: " + e.getMessage();
            HelperMod.LOG.warn("Helper Buddies update check failed", e);
        }
    }

    private static String jarAsset(JsonObject release) {
        if (!release.has("assets")) return null;
        for (JsonElement a : release.getAsJsonArray("assets")) {
            JsonObject asset = a.getAsJsonObject();
            String name = asset.get("name").getAsString().toLowerCase(Locale.ROOT);
            if (name.endsWith(".jar") && !name.contains("sources")) {
                return asset.get("browser_download_url").getAsString();
            }
        }
        return null;
    }

    private static Path runningJar(ModContainer mod) {
        try {
            List<Path> paths = mod.getOrigin().getPaths();
            if (paths.size() != 1) return null;
            Path p = paths.get(0);
            if (!Files.isRegularFile(p) || !p.getFileName().toString().endsWith(".jar")) return null;
            return p;
        } catch (UnsupportedOperationException e) {
            return null;
        }
    }

    /** Compares versions like 1.15.0 and 1.16.0 number by number. */
    static int compare(String a, String b) {
        String[] x = a.split("[.\\-+]");
        String[] y = b.split("[.\\-+]");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? num(x[i]) : 0;
            int q = i < y.length ? num(y[i]) : 0;
            if (p != q) return Integer.compare(p, q);
        }
        return 0;
    }

    private static int num(String s) {
        try {
            return Integer.parseInt(s.replaceAll("\\D", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static synchronized void scheduleSwap(Path current, Path target, Path downloaded) {
        oldJar = current;
        newJar = downloaded;
        if (hookAdded) return;
        hookAdded = true;
        Path finalTarget = target;
        Runtime.getRuntime().addShutdownHook(new Thread(() -> swap(finalTarget), "helpermod-update-install"));
    }

    private static void swap(Path target) {
        try {
            boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
            if (!windows) {
                // Linux and macOS let us replace a jar that is still open.
                Files.copy(newJar, target, StandardCopyOption.REPLACE_EXISTING);
                if (!oldJar.equals(target)) Files.deleteIfExists(oldJar);
                Files.deleteIfExists(newJar);
                return;
            }
            // Windows keeps the jar locked until Java exits, so a script waits and then swaps it.
            Path bat = newJar.resolveSibling("install-update.bat");
            String script = String.join("\r\n",
                    "@echo off",
                    "set tries=0",
                    ":wait",
                    "set /a tries+=1",
                    "if %tries% gtr 90 goto end",
                    "timeout /t 2 /nobreak >nul",
                    "del /f /q \"" + oldJar + "\" >nul 2>&1",
                    "if exist \"" + oldJar + "\" goto wait",
                    "move /y \"" + newJar + "\" \"" + target + "\" >nul",
                    ":end",
                    "(goto) 2>nul & del \"%~f0\"",
                    "");
            Files.writeString(bat, script, StandardCharsets.UTF_8);
            new ProcessBuilder("cmd.exe", "/c", "start", "/min", "cmd.exe", "/c", bat.toString())
                    .redirectErrorStream(true)
                    .start();
        } catch (IOException e) {
            HelperMod.LOG.warn("Couldn't install the Helper Buddies update", e);
        }
    }

    private static Properties loadConfig() {
        Properties p = new Properties();
        Path file = FabricLoader.getInstance().getConfigDir().resolve("helpermod-updater.properties");
        try {
            if (Files.exists(file)) {
                try (InputStream in = Files.newInputStream(file)) {
                    p.load(in);
                }
            } else {
                Files.writeString(file, "# Set to false to stop Helper Buddies updating itself\nauto_update=true\n");
            }
        } catch (IOException ignored) {
        }
        return p;
    }
}
