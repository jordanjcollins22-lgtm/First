package com.helpermod;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.api.EnvType;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Keeps the mod up to date.
 *
 * At launch, and again every 30 minutes while the game is open, this checks the repo's GitHub
 * releases (tags named helper-v1.2.3) in the background. On a player's PC (singleplayer or LAN,
 * host and guests alike) it doesn't download anything by itself: UpdateScreen pops up in game with
 * what's new and asks "Update now?". Pressing Yes downloads the jar in the background.
 * Minecraft loads mod code once at startup, so the new version can't replace the running one:
 * the jar is swapped in after the game closes and runs on the next launch.
 * On a dedicated server there's nobody to ask, so it downloads by itself, like before.
 *
 * config/helpermod-updater.properties:
 *   auto_update=ask     (default; "true" means the same) show the in-game prompt
 *   auto_update=always  download without asking
 *   auto_update=false   never check
 *   skip_version=1.2.3  set by "Skip this version"
 */
public final class Updater {
    private static final String RELEASES = "https://api.github.com/repos/jordanjcollins22-lgtm/First/releases?per_page=30";
    private static final String TAG_PREFIX = "helper-v";
    private static final long RECHECK_MINUTES = 30;

    /** One release newer than the running version, newest first. */
    public record Release(String version, String notes, String page) {}

    private static volatile String status = "Not checked yet.";
    private static volatile String current = "?";
    private static volatile String latestVersion; // newest release that is newer than us
    private static volatile String latestUrl;
    private static volatile List<Release> newer = List.of();
    private static volatile boolean downloading;
    private static volatile String readyVersion; // set once a newer jar has been downloaded
    private static volatile String failed;       // last download error, for the screen
    private static Path runningJar;
    private static Path oldJar;
    private static Path newJar;
    private static Path swapTarget;
    private static boolean hookAdded;
    private static HttpClient http;

    private Updater() {}

    /** Called once from mod init. Never blocks the game. */
    public static void start() {
        String mode = mode();
        if (mode.equals("off")) {
            status = "Auto-update is off (config/helpermod-updater.properties).";
            return;
        }
        ScheduledExecutorService ex = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "helpermod-updater");
            t.setDaemon(true);
            return t;
        });
        ex.scheduleWithFixedDelay(Updater::check, 0, RECHECK_MINUTES, TimeUnit.MINUTES);
    }

    public static String status() {
        return status;
    }

    public static String currentVersion() {
        return current;
    }

    /** The newest version the player could update to, or null. */
    public static String available() {
        return latestVersion;
    }

    public static List<Release> newerReleases() {
        return newer;
    }

    public static boolean downloading() {
        return downloading;
    }

    public static String readyVersion() {
        return readyVersion;
    }

    public static String failed() {
        return failed;
    }

    private static volatile String skipVersion;

    public static boolean skipped(String version) {
        if (skipVersion == null) skipVersion = loadConfig().getProperty("skip_version", "").trim();
        return version != null && version.equals(skipVersion);
    }

    public static void skip(String version) {
        skipVersion = version;
        Properties p = loadConfig();
        p.setProperty("skip_version", version);
        saveConfig(p);
    }

    /** Tell a player on a dedicated server that a new version is waiting for a restart. */
    public static void onJoin(ServerPlayerEntity player) {
        if (FabricLoader.getInstance().getEnvironmentType() != EnvType.SERVER) return; // players' PCs get UpdateScreen
        String v = readyVersion;
        if (v == null) return;
        player.sendMessage(Text.literal("Helper Buddies " + v + " has been downloaded. It goes live when the server restarts.")
                .formatted(Formatting.AQUA), false);
    }

    private static String mode() {
        String m = loadConfig().getProperty("auto_update", "ask").trim().toLowerCase(Locale.ROOT);
        if (m.equals("false") || m.equals("off") || m.equals("no")) return "off";
        if (m.equals("always")) return "always";
        return "ask";
    }

    private static void check() {
        try {
            ModContainer mod = FabricLoader.getInstance().getModContainer(HelperMod.MOD_ID).orElse(null);
            if (mod == null) return;
            current = mod.getMetadata().getVersion().getFriendlyString();
            runningJar = runningJar(mod);
            if (runningJar == null) {
                status = "Running from a dev environment, so auto-update is skipped.";
                return;
            }
            if (http == null) {
                http = HttpClient.newBuilder()
                        .followRedirects(HttpClient.Redirect.NORMAL)
                        .connectTimeout(Duration.ofSeconds(10))
                        .build();
            }
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
            List<Release> found = new ArrayList<>();
            JsonArray releases = JsonParser.parseString(res.body()).getAsJsonArray();
            for (JsonElement el : releases) {
                JsonObject r = el.getAsJsonObject();
                if (r.has("draft") && r.get("draft").getAsBoolean()) continue;
                String tag = r.get("tag_name").getAsString();
                if (!tag.startsWith(TAG_PREFIX)) continue;
                String version = tag.substring(TAG_PREFIX.length());
                String url = jarAsset(r);
                if (url == null || compare(version, current) <= 0) continue;
                String body = r.has("body") && !r.get("body").isJsonNull() ? r.get("body").getAsString() : "";
                String page = r.has("html_url") ? r.get("html_url").getAsString() : null;
                found.add(new Release(version, body, page));
                if (bestVersion == null || compare(version, bestVersion) > 0) {
                    bestVersion = version;
                    bestUrl = url;
                }
            }
            found.sort((a, b) -> compare(b.version(), a.version()));
            if (bestVersion == null) {
                status = "Up to date (" + current + ").";
                return;
            }
            newer = List.copyOf(found);
            latestUrl = bestUrl;
            latestVersion = bestVersion;
            if (bestVersion.equals(readyVersion)) return;

            boolean server = FabricLoader.getInstance().getEnvironmentType() == EnvType.SERVER;
            if (server || mode().equals("always")) {
                download();
            } else {
                status = "Version " + bestVersion + " is available. Use the in-game prompt (or /helperupdate) to get it.";
            }
        } catch (Exception e) {
            status = "Couldn't check for updates: " + e.getMessage();
            HelperMod.LOG.warn("Helper Buddies update check failed", e);
        }
    }

    /** Starts downloading the newest version in the background (the "Yes" button). */
    public static void downloadAsync() {
        if (downloading || latestVersion == null || latestVersion.equals(readyVersion)) return;
        downloading = true;
        failed = null;
        Thread t = new Thread(() -> {
            try {
                download();
            } finally {
                downloading = false;
            }
        }, "helpermod-update-download");
        t.setDaemon(true);
        t.start();
    }

    private static synchronized void download() {
        String version = latestVersion;
        String url = latestUrl;
        if (version == null || url == null || version.equals(readyVersion)) return;
        try {
            if (http == null) {
                http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL)
                        .connectTimeout(Duration.ofSeconds(10)).build();
            }
            Path dir = FabricLoader.getInstance().getConfigDir().resolve("helpermod").resolve("update");
            Files.createDirectories(dir);
            Path part = dir.resolve("helper-mod-" + version + ".part");
            Path done = dir.resolve("helper-mod-" + version + ".jar");
            if (!Files.exists(done)) {
                status = "Downloading " + version + "...";
                HttpResponse<InputStream> dl = http.send(HttpRequest.newBuilder(URI.create(url))
                                .header("User-Agent", "helpermod-updater")
                                .timeout(Duration.ofMinutes(2))
                                .build(),
                        HttpResponse.BodyHandlers.ofInputStream());
                if (dl.statusCode() != 200) {
                    failed = status = "Found " + version + " but the download failed (" + dl.statusCode() + ").";
                    return;
                }
                try (InputStream in = dl.body(); OutputStream out = Files.newOutputStream(part)) {
                    in.transferTo(out);
                }
                if (Files.size(part) < 1024) {
                    Files.deleteIfExists(part);
                    failed = status = "Found " + version + " but the download was empty.";
                    return;
                }
                Files.move(part, done, StandardCopyOption.REPLACE_EXISTING);
            }

            scheduleSwap(runningJar, runningJar.resolveSibling("helper-mod-" + version + ".jar"), done);
            readyVersion = version;
            status = "Version " + version + " is downloaded. It installs when you close Minecraft.";
            HelperMod.LOG.info("Helper Buddies {} downloaded; it will be installed when the game closes", version);
        } catch (Exception e) {
            failed = status = "Couldn't download the update: " + e.getMessage();
            HelperMod.LOG.warn("Helper Buddies update download failed", e);
        }
    }

    /** Downloads a small file (a release screenshot). Returns null on any problem. */
    public static byte[] fetchBytes(String url, int maxBytes) {
        try {
            if (http == null) {
                http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL)
                        .connectTimeout(Duration.ofSeconds(10)).build();
            }
            HttpResponse<byte[]> r = http.send(HttpRequest.newBuilder(URI.create(url))
                            .header("User-Agent", "helpermod-updater")
                            .timeout(Duration.ofSeconds(20)).build(),
                    HttpResponse.BodyHandlers.ofByteArray());
            if (r.statusCode() != 200 || r.body().length > maxBytes) return null;
            return r.body();
        } catch (Exception e) {
            return null;
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
        swapTarget = target; // a later, newer download replaces the earlier one
        if (hookAdded) return;
        hookAdded = true;
        Runtime.getRuntime().addShutdownHook(new Thread(Updater::swap, "helpermod-update-install"));
    }

    private static void swap() {
        Path target = swapTarget;
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
                p.setProperty("auto_update", "ask");
                saveConfig(p);
            }
        } catch (IOException ignored) {
        }
        return p;
    }

    private static void saveConfig(Properties p) {
        Path file = FabricLoader.getInstance().getConfigDir().resolve("helpermod-updater.properties");
        try (OutputStream out = Files.newOutputStream(file)) {
            p.store(out, "Helper Buddies updates. auto_update: ask (show an in-game prompt), always (download without asking), false (never check)");
        } catch (IOException ignored) {
        }
    }
}
