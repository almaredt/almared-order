package com.almared.orderlist;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private static final String START_URL = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final int REQ_FILE = 101;
    private static final int REQ_CAM_PERM_WEB = 201;
    private static final int REQ_CAM_PERM_PICK = 202;
    private static final int INK = Color.parseColor("#1D1916");

    private WebView web;
    private WebView printView; // kept alive while the print job is prepared
    private ValueCallback<Uri[]> fileCallback;
    private WebChromeClient.FileChooserParams pendingChooserParams;
    private Uri cameraOutputUri;
    private PermissionRequest pendingWebPermission;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(INK);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setupSystemBars(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsCamera = false;
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
                    }
                    if (!wantsCamera) { request.deny(); return; }
                    if (hasCameraPermission()) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    } else {
                        pendingWebPermission = request;
                        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM_PERM_WEB);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                pendingChooserParams = params;
                if (params.isCaptureEnabled() && !hasCameraPermission()) {
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAM_PERM_PICK);
                    return true;
                }
                launchChooser(params);
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidApp");
        registerBack();
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    /* ---------- system bars / edge-to-edge (Android 15 enforces it) ---------- */
    private void setupSystemBars(View root) {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        if (Build.VERSION.SDK_INT < 35) {
            getWindow().setStatusBarColor(INK);
            getWindow().setNavigationBarColor(INK);
        }
    }

    /* ---------- file chooser (photo from camera or gallery) ---------- */
    private void launchChooser(WebChromeClient.FileChooserParams params) {
        Intent cameraIntent = null;
        if (hasCameraPermission()) {
            try {
                File dir = new File(getCacheDir(), "camera");
                if (!dir.exists()) dir.mkdirs();
                File photo = new File(dir, "photo_" + System.currentTimeMillis() + ".jpg");
                cameraOutputUri = FileProvider.getUriForFile(this, getPackageName() + ".files", photo);
                cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
                cameraIntent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception e) {
                cameraIntent = null;
                cameraOutputUri = null;
            }
        } else {
            cameraOutputUri = null;
        }

        Intent toLaunch;
        if (params.isCaptureEnabled() && cameraIntent != null) {
            toLaunch = cameraIntent;
        } else {
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            String[] types = params.getAcceptTypes();
            String type = (types != null && types.length > 0 && types[0] != null && !types[0].isEmpty()) ? types[0] : "*/*";
            if (type.startsWith(".")) type = "*/*";
            pick.setType(type);
            if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            toLaunch = Intent.createChooser(pick, "انتخاب فایل");
            if (cameraIntent != null && type.startsWith("image")) {
                toLaunch.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cameraIntent});
            }
        }
        try {
            startActivityForResult(toLaunch, REQ_FILE);
        } catch (ActivityNotFoundException e) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = null;
            Toast.makeText(this, "برنامه‌ای برای این کار پیدا نشد", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            List<Uri> uris = new ArrayList<>();
            if (data != null && data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            } else if (data != null && data.getData() != null) {
                uris.add(data.getData());
            } else if (cameraOutputUri != null) {
                uris.add(cameraOutputUri);
            }
            if (!uris.isEmpty()) result = uris.toArray(new Uri[0]);
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_CAM_PERM_WEB && pendingWebPermission != null) {
            if (granted) pendingWebPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingWebPermission.deny();
            pendingWebPermission = null;
        } else if (requestCode == REQ_CAM_PERM_PICK && pendingChooserParams != null) {
            launchChooser(pendingChooserParams); // falls back to gallery if camera was refused
        }
    }

    private boolean isInstalled(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private boolean hasCameraPermission() {
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    /* ---------- back button ----------
       Android 13+ (and required behaviour when targeting Android 16): OnBackInvokedCallback.
       Older Android: onBackPressed. Either way the web page decides first (close sheet, camera, order). */
    private OnBackInvokedCallback backCallback;

    private void registerBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    private void handleBack() {
        web.evaluateJavascript("(window.appBack && window.appBack()) ? 'yes' : 'no'", value -> {
            if (value == null || !value.contains("yes")) {
                if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
                    getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
                    backCallback = null;
                }
                finish();
            }
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.evaluateJavascript("window.dispatchEvent(new Event('pagehide'))", null);
    }

    /* ---------- JavaScript bridge ---------- */
    private class Bridge {

        @JavascriptInterface
        public boolean isApp() { return true; }

        /** Saves into the public Downloads folder. Returns a content:// or file:// uri, or "ERR:message". */
        @JavascriptInterface
        public String saveFile(String base64, String name, String mime) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                Uri uri;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/ALMARED Order");
                    uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) return "ERR:Downloads not available";
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os == null) return "ERR:cannot write";
                        os.write(bytes);
                    }
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) dir = new File(getFilesDir(), "downloads");
                    if (!dir.exists()) dir.mkdirs();
                    File f = new File(dir, name);
                    try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                    uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                }
                return uri.toString();
            } catch (Exception e) {
                return "ERR:" + e.getMessage();
            }
        }

        @JavascriptInterface
        public String shareFile(String base64, String name, String mime) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, name);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                final Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                final Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.putExtra(Intent.EXTRA_SUBJECT, name);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(send, "ارسال " + name)));
                return "OK";
            } catch (Exception e) {
                return "ERR:" + e.getMessage();
            }
        }

        /** Sends the file straight to WhatsApp (or WhatsApp Business). Returns "OK", "NOWA" or "ERR:message". */
        @JavascriptInterface
        public String shareToWhatsApp(String base64, String name, String mime) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, name);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                String[] pkgs = {"com.whatsapp", "com.whatsapp.w4b"};
                for (String pkg : pkgs) {
                    if (!isInstalled(pkg)) continue;
                    final Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(mime);
                    send.setPackage(pkg);
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    runOnUiThread(() -> {
                        try { startActivity(send); }
                        catch (ActivityNotFoundException e) { Toast.makeText(MainActivity.this, "واتساپ باز نشد", Toast.LENGTH_SHORT).show(); }
                    });
                    return "OK";
                }
                return "NOWA";
            } catch (Exception e) {
                return "ERR:" + e.getMessage();
            }
        }

        @JavascriptInterface
        public void openFile(String uriString, String mime) {
            runOnUiThread(() -> {
                try {
                    Intent view = new Intent(Intent.ACTION_VIEW);
                    view.setDataAndType(Uri.parse(uriString), mime);
                    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(view);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "برنامه‌ای برای باز کردن این فایل نصب نیست", Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void printHtml(final String html, final String jobName) {
            runOnUiThread(() -> {
                final WebView pv = new WebView(MainActivity.this);
                pv.getSettings().setJavaScriptEnabled(false);
                pv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        new Handler(Looper.getMainLooper()).postDelayed(() -> {
                            PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                            PrintAttributes attrs = new PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                    .build();
                            pm.print(jobName, view.createPrintDocumentAdapter(jobName), attrs);
                        }, 400);
                    }
                });
                printView = pv;
                pv.loadDataWithBaseURL("https://appassets.androidplatform.net/assets/www/", html, "text/html", "UTF-8", null);
            });
        }
    }
}
