package io.anothertodo.mobile;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.view.View;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.graphics.Insets;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Iterator;
import java.util.Map;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.util.AtomicFile;

public final class MainActivity extends Activity {
    private WebView web;
    private FrameLayout root;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private String documentRequest;
    private JSONObject documentArgs;
    private boolean ready;
    private boolean debug;
    private static final String ORIGIN = "https://appassets.androidplatform.net/";
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        debug = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        web = new WebView(this);
        root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root); configureColors();
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                FrameLayout.LayoutParams layout = (FrameLayout.LayoutParams) web.getLayoutParams();
                layout.setMargins(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                web.setLayoutParams(layout);
                return new WindowInsets.Builder(insets).setInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime(), Insets.NONE).build();
            });
        }
        WebView.setWebContentsDebuggingEnabled(debug);
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(0); web.getSettings().setSupportZoom(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equals(uri.getScheme()) || !"appassets.androidplatform.net".equals(uri.getHost())) return blocked();
                String path = uri.getPath();
                if (path == null || path.contains("..")) return blocked();
                try {
                    String name = path.equals("/") ? "index.html" : path.substring(1);
                    String mime = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "application/javascript" : "application/octet-stream";
                    return new WebResourceResponse(mime, "UTF-8", getAssets().open(name));
                } catch (java.io.IOException error) { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0])); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith(ORIGIN);
            }
            @Override public void onPageFinished(WebView view, String url) { ready = true; }
        });
        web.addJavascriptInterface(new Bridge(), "Native"); web.loadUrl(ORIGIN);
    }
    private WebResourceResponse blocked() { return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null, new ByteArrayInputStream(new byte[0])); }
    private void configureColors() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int color = dark ? 0xff1c1e21 : 0xfff7f7f7; getWindow().setStatusBarColor(color); getWindow().setNavigationBarColor(dark ? 0xff23262b : 0xffffffff);
        root.setBackgroundColor(color);
        getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        web.setBackgroundColor(color);
        if (ready) web.evaluateJavascript("window.nativeTheme && window.nativeTheme(" + JSONObject.quote(dark ? "dark" : "light") + ")", null);
    }
    @Override public void onConfigurationChanged(Configuration config) { super.onConfigurationChanged(config); configureColors(); }
    @Override public void onResume() {
        super.onResume();
        try { AlarmReceiver.schedule(this); } catch (Exception error) { throw new IllegalStateException(error); }
        if (ready) web.evaluateJavascript("window.nativeRefresh && window.nativeRefresh()", null);
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        String task = intent.getStringExtra("task");
        if (ready && task != null) web.evaluateJavascript("window.nativeOpenTask && window.nativeOpenTask(" + JSONObject.quote(task) + ")", null);
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("window.nativeBack ? window.nativeBack() : false", handled -> { if (!"true".equals(handled)) finish(); });
    }
    @Override public void onDestroy() { ready = false; web.removeJavascriptInterface("Native"); web.destroy(); worker.shutdown(); super.onDestroy(); }
    private JSONObject result(Object value) throws Exception { return new JSONObject().put("ok", true).put("value", value == null ? JSONObject.NULL : value); }
    private JSONObject failure(Exception error) {
        if (!(error instanceof java.io.FileNotFoundException) && !(error instanceof java.nio.file.FileAlreadyExistsException)) android.util.Log.e("AnotherTODO", "原生操作失败", error);
        try { return new JSONObject().put("ok", false).put("error", error.getMessage() == null ? error.toString() : error.getMessage()).put("code", error instanceof java.io.FileNotFoundException ? "ENOENT" : error instanceof java.nio.file.FileAlreadyExistsException ? "EEXIST" : "ERROR"); }
        catch (Exception invalid) { throw new IllegalStateException(invalid); }
    }
    private void reply(String id, JSONObject result) { runOnUiThread(() -> { if (!isDestroyed()) web.evaluateJavascript("window.nativeResult(" + JSONObject.quote(id) + "," + result + ")", null); }); }
    private JSONObject permissions() throws Exception {
        boolean notifications = getSystemService(NotificationManager.class).areNotificationsEnabled();
        boolean exact = Build.VERSION.SDK_INT < 31 || getSystemService(AlarmManager.class).canScheduleExactAlarms();
        return new JSONObject().put("notifications", notifications).put("exact", exact).put("debug", debug);
    }
    public final class Bridge {
        @JavascriptInterface public String invoke(String method, String raw) {
            try { return result(call(method, new JSONObject(raw))).toString(); }
            catch (Exception error) { return failure(error).toString(); }
        }
        @JavascriptInterface public void request(String id, String method, String raw) {
            worker.execute(() -> {
                try {
                    JSONObject args = new JSONObject(raw);
                    if (method.equals("http")) reply(id, result(http(args)));
                    else if (method.equals("import") || method.equals("export")) runOnUiThread(() -> {
                        try { document(id, method, args); } catch (Exception error) { reply(id, failure(error)); }
                    });
                    else throw new IllegalArgumentException("未知异步操作：" + method);
                } catch (Exception error) { reply(id, failure(error)); }
            });
        }
    }
    private Object call(String method, JSONObject args) throws Exception {
        Data data = Data.get(this);
        switch (method) {
            case "theme": return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES ? "dark" : "light";
            case "launchTask": return getIntent().getStringExtra("task");
            case "load": return data.load();
            case "save": {
                long version = data.save(args.getLong("version"), args.getJSONObject("state"), args.getJSONObject("config"));
                AlarmReceiver.schedule(this); return version;
            }
            case "permissions": return permissions();
            case "notificationPermission": runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 3);
                else startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
            }); return true;
            case "alarmPermission": runOnUiThread(() -> { if (Build.VERSION.SDK_INT >= 31) startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()))); }); return true;
            case "syncSettings": { String raw = data.secret("sync", ""); return raw.isEmpty() ? JSONObject.NULL : new JSONObject(raw); }
            case "saveSyncSettings": data.setSecret("sync", args.toString()); return true;
            case "hooksText": return data.secret("hooks", "{}");
            case "saveHooks": data.setSecret("hooks", args.getJSONObject("hooks").toString()); return true;
            case "fs": return fs(args);
            default: throw new IllegalArgumentException("未知原生操作：" + method);
        }
    }
    private File file(String path) throws Exception {
        File root = new File(getFilesDir(), "git"); if (!root.exists() && !root.mkdirs()) throw new java.io.IOException("同步目录创建失败");
        File value = new File(root, path.startsWith("/") ? path.substring(1) : path).getCanonicalFile();
        if (!value.getPath().startsWith(root.getCanonicalPath() + File.separator) && !value.equals(root)) throw new SecurityException("文件路径超出同步目录");
        return value;
    }
    private Object fs(JSONObject args) throws Exception {
        String method = args.getString("method"); File target = file(args.getString("path"));
        switch (method) {
            case "readFile": {
                if (!target.isFile()) throw new java.io.FileNotFoundException(target.getName());
                byte[] value = Files.readAllBytes(target.toPath());
                return args.optBoolean("text") ? new String(value, StandardCharsets.UTF_8) : Base64.encodeToString(value, Base64.NO_WRAP);
            }
            case "writeFile": {
                byte[] value = args.optBoolean("text") ? args.getString("data").getBytes(StandardCharsets.UTF_8) : Base64.decode(args.getString("data"), Base64.NO_WRAP);
                if (!target.getParentFile().isDirectory()) throw new java.io.FileNotFoundException(target.getParent());
                AtomicFile atomic = new AtomicFile(target); java.io.FileOutputStream stream = atomic.startWrite();
                try { stream.write(value); atomic.finishWrite(stream); } catch (Exception error) { atomic.failWrite(stream); throw error; }
                return true;
            }
            case "mkdir": {
                if (target.exists()) throw new java.nio.file.FileAlreadyExistsException(target.getPath());
                if (!args.optBoolean("recursive") && !target.getParentFile().isDirectory()) throw new java.io.FileNotFoundException(target.getParent());
                if (!(args.optBoolean("recursive") ? target.mkdirs() : target.mkdir())) throw new java.io.IOException("目录创建失败：" + target.getName()); return true;
            }
            case "readdir": { if (!target.isDirectory()) throw new java.io.FileNotFoundException(target.getName()); String[] names = target.list(); if (names == null) throw new java.io.IOException("目录读取失败"); return new JSONArray(names); }
            case "stat": case "lstat": {
                if (!target.exists()) throw new java.io.FileNotFoundException(target.getName());
                BasicFileAttributes attrs = Files.readAttributes(target.toPath(), BasicFileAttributes.class);
                return new JSONObject().put("size", attrs.size()).put("mtimeMs", attrs.lastModifiedTime().toMillis()).put("ctimeMs", attrs.creationTime().toMillis()).put("directory", attrs.isDirectory()).put("mode", attrs.isDirectory() ? 0040755 : 0100644);
            }
            case "unlink": case "rmdir": { if (!target.exists()) throw new java.io.FileNotFoundException(target.getName()); if (!target.delete()) throw new java.io.IOException("文件删除失败：" + target.getName()); return true; }
            case "rename": Files.move(target.toPath(), file(args.getString("dest")).toPath(), StandardCopyOption.REPLACE_EXISTING); return true;
            case "chmod": android.system.Os.chmod(target.getPath(), args.getInt("mode") & 0777); return true;
            default: throw new IllegalArgumentException("未知文件操作：" + method);
        }
    }
    JSONObject http(JSONObject args) throws Exception {
        URL url = new URL(args.getString("url"));
        if (!url.getProtocol().equals("https") && !(debug && url.getProtocol().equals("http"))) throw new SecurityException("连接需要 HTTPS");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000); connection.setReadTimeout(20000); connection.setInstanceFollowRedirects(false); connection.setRequestMethod(args.optString("method", "GET"));
        JSONObject headers = args.optJSONObject("headers");
        if (headers != null) for (Iterator<String> iterator = headers.keys(); iterator.hasNext();) { String name = iterator.next(); connection.setRequestProperty(name, headers.getString(name)); }
        try {
            String body = args.optString("body", "");
            if (!body.isEmpty()) { connection.setDoOutput(true); byte[] bytes = Base64.decode(body, Base64.NO_WRAP); connection.setFixedLengthStreamingMode(bytes.length); try (OutputStream output = connection.getOutputStream()) { output.write(bytes); } }
            int status = connection.getResponseCode();
            JSONObject responseHeaders = new JSONObject(); for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) if (entry.getKey() != null) responseHeaders.put(entry.getKey().toLowerCase(java.util.Locale.ROOT), String.join(",", entry.getValue()));
            InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream(); byte[] bytes;
            if (input == null) bytes = new byte[0]; else try (InputStream stream = input) { bytes = readAll(stream, 64 * 1024 * 1024); }
            return new JSONObject().put("url", connection.getURL().toString()).put("statusCode", status).put("statusMessage", connection.getResponseMessage()).put("headers", responseHeaders).put("body", Base64.encodeToString(bytes, Base64.NO_WRAP));
        } finally { connection.disconnect(); }
    }
    private static byte[] readAll(InputStream input, int limit) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[16384]; int count;
        while ((count = input.read(buffer)) != -1) { if (output.size() + count > limit) throw new java.io.IOException("文件超过允许大小"); output.write(buffer, 0, count); }
        return output.toByteArray();
    }
    private void document(String id, String method, JSONObject args) throws Exception {
        if (documentRequest != null) throw new IllegalStateException("已有文件操作正在执行");
        if (method.equals("export") && args.optBoolean("share")) {
            File directory = new File(getCacheDir(), "exports"); if (!directory.exists() && !directory.mkdirs()) throw new java.io.IOException("分享目录创建失败");
            String name = new File(args.getString("filename")).getName(); File target = new File(directory, name);
            Files.write(target.toPath(), args.getString("text").getBytes(StandardCharsets.UTF_8));
            Uri uri = Uri.parse("content://" + getPackageName() + ".exports/" + Uri.encode(name));
            Intent intent = new Intent(Intent.ACTION_SEND).setType(args.getString("mime")).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(intent, "分享任务")); reply(id, result(true)); return;
        }
        Intent intent = new Intent(method.equals("import") ? Intent.ACTION_OPEN_DOCUMENT : Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(method.equals("import") ? "*/*" : args.getString("mime"));
        if (!method.equals("import")) intent.putExtra(Intent.EXTRA_TITLE, args.getString("filename"));
        documentRequest = id; documentArgs = args;
        startActivityForResult(intent, method.equals("import") ? 1 : 2);
    }
    @Override protected void onActivityResult(int code, int resultCode, Intent intent) {
        super.onActivityResult(code, resultCode, intent);
        if (code != 1 && code != 2) return;
        String id = documentRequest; JSONObject args = documentArgs; documentRequest = null; documentArgs = null;
        worker.execute(() -> {
            try {
                if (resultCode != RESULT_OK || intent == null || intent.getData() == null) throw new IllegalStateException("已取消文件选择");
                Uri uri = intent.getData();
                if (code == 1) { try (InputStream input = getContentResolver().openInputStream(uri)) { reply(id, result(new JSONObject().put("text", new String(readAll(input, 32 * 1024 * 1024), StandardCharsets.UTF_8)))); } }
                else { try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) { output.write(args.getString("text").getBytes(StandardCharsets.UTF_8)); } reply(id, result(true)); }
            } catch (Exception error) { reply(id, failure(error)); }
        });
    }
}
