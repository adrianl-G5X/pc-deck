package fr.pcdeck.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.media.MediaPlayer;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.MediaController;
import android.widget.TextView;
import android.widget.VideoView;
import android.app.DownloadManager;
import android.os.Environment;
import android.speech.RecognizerIntent;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.widget.Toast;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * PC Deck pour Android.
 * L'interface est affichée sous une adresse interne (http://pcdeck.localhost/).
 * Chaque fichier demandé est récupéré sur le PC : d'abord par le chemin qui a
 * marché la dernière fois, sinon par USB (127.0.0.1:8787 grâce à adb reverse),
 * sinon par le Wi-Fi. Une copie est gardée pour démarrer même si le PC est éteint.
 * La connexion en direct (WebSocket) est gérée par l'interface elle-même.
 */
public class MainActivity extends Activity {
    static final String HOST = "pcdeck.localhost";
    static final String START_URL = "http://" + HOST + "/";
    static final String USB = "127.0.0.1:8787";
    static final int PORT = 8787;

    WebView web;
    static final int SPEECH = 42;

    // Résultat de la reconnaissance vocale -> l'interface
    void speech(String text) {
        final String js = "window.onNativeSpeech && window.onNativeSpeech(" + (text == null ? "null" : JSONObject.quote(text)) + ")";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(js, null);
            }
        });
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != SPEECH) return;
        ArrayList<String> heard = result == RESULT_OK && data != null ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        speech(heard != null && !heard.isEmpty() ? heard.get(0) : null);
    }
    SharedPreferences prefs;
    volatile String lastGood;
    volatile String pendingCode; // code d'appairage reçu par un QR code
    final Runnable reload = new Runnable() {
        @Override
        public void run() {
            web.loadUrl(START_URL);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("pcdeck", MODE_PRIVATE);
        lastGood = prefs.getString("lastGood", null);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(0xFF1B1D1F);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setAllowFileAccess(false);
        web.addJavascriptInterface(new Bridge(), "PcDeckNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                return serve(u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                // On reste dans l'interface PC Deck : aucune navigation vers un autre site.
                return !HOST.equals(req.getUrl().getHost());
            }
        });
        setContentView(web);
        hideBars();
        web.loadUrl(START_URL);
        handleDeepLink(getIntent());
        IntentFilter filter = new IntentFilter(ACTION_INSTALL);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(installReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(installReceiver, filter);
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(installReceiver); } catch (Exception ignored) { }
        super.onDestroy();
    }

    // ---------- Mise à jour de l'appli (APK fourni par le PC) ----------
    static final String ACTION_INSTALL = "fr.pcdeck.app.INSTALL_STATUS";

    // Réponse d'Android après l'envoi du nouvel APK : demande de confirmation à l'utilisateur, ou erreur
    final BroadcastReceiver installReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent i) {
            int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = (Intent) i.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(confirm);
                }
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                toast("Mise à jour non installée : " + i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
            }
        }
    };

    void toast(final String text) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, text, Toast.LENGTH_LONG).show();
            }
        });
    }

    // Télécharge l'APK depuis le PC puis le confie à Android (qui demande confirmation)
    void installUpdate() {
        String host = lastGood != null ? lastGood : USB;
        Fetched f = fetch(host, "/download/PC-Deck.apk");
        if (f == null || f.code != 200 || f.body.length < 1000) {
            toast("PC injoignable : mise à jour impossible pour l'instant.");
            return;
        }
        PackageInstaller.Session session = null;
        try {
            PackageInstaller pi = getPackageManager().getPackageInstaller();
            int id = pi.createSession(new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL));
            session = pi.openSession(id);
            OutputStream out = session.openWrite("pcdeck.apk", 0, f.body.length);
            out.write(f.body);
            session.fsync(out);
            out.close();
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pending = PendingIntent.getBroadcast(this, 0, new Intent(ACTION_INSTALL).setPackage(getPackageName()), flags);
            session.commit(pending.getIntentSender());
        } catch (Exception e) {
            toast("Mise à jour impossible : " + e.getMessage());
        } finally {
            if (session != null) session.close();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleDeepLink(intent);
    }

    // QR code de la page « Connecter un appareil » : pcdeck://pair?h=192.168.1.24:8787&c=123456
    // On demande confirmation : un lien piégé ne peut pas rediriger l'appli en douce.
    void handleDeepLink(Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        if (u == null || !"pcdeck".equals(u.getScheme()) || !"pair".equals(u.getHost())) return;
        intent.setData(null); // une seule fois (rotation de l'écran...)
        final String h = u.getQueryParameter("h");
        final String c = u.getQueryParameter("c");
        if (h == null || !h.matches("[0-9A-Za-z.\\-]+(:\\d{1,5})?") || c == null || !c.matches("\\d{6}")) return;
        new AlertDialog.Builder(this)
            .setTitle("Connecter ce PC ?")
            .setMessage("PC Deck va se connecter au PC " + h + ".")
            .setPositiveButton("Connecter", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int which) {
                    String host = withPort(h);
                    prefs.edit().putString("wifi", h).putString("lastGood", host).apply();
                    lastGood = host;
                    pendingCode = c;
                    web.loadUrl(START_URL);
                }
            })
            .setNegativeButton("Annuler", null)
            .show();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideBars();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause(); // arrête aussi les vidéos et la musique de la page
        if (videoView != null) videoView.pause(); // appli quittée (Accueil, autre appli) : la vidéo s'arrête
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (videoBox != null) { closeVideo(); return; } // retour = fermer la vidéo
        // Retour : d'abord dans la page (dossier d'avant, fermer un outil) ; sinon l'appli passe en arrière-plan
        web.evaluateJavascript("window.pcdeckBack ? String(window.pcdeckBack()) : 'false'", new android.webkit.ValueCallback<String>() {
            @Override
            public void onReceiveValue(String handled) {
                if (!"\"true\"".equals(handled)) moveTaskToBack(true);
            }
        });
    }

    // ---------- Lecteur vidéo dans l'appli (décodeurs de la tablette : 4K, HEVC, MKV…), par-dessus PC Deck ----------
    FrameLayout videoBox = null;
    VideoView videoView = null;
    void playVideo(String url) {
        closeVideo();
        final FrameLayout box = new FrameLayout(this);
        box.setBackgroundColor(Color.BLACK);
        final VideoView vv = new VideoView(this);
        vv.setZOrderMediaOverlay(true); // image de la vidéo au-dessus de la page (sinon : le son sans l'image)
        box.addView(vv, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        final MediaController mc = new MediaController(this);
        mc.setAnchorView(vv);
        vv.setMediaController(mc);
        vv.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
            @Override
            public void onPrepared(MediaPlayer mp) {
                vv.start();
                mc.show(3000);
            }
        });
        vv.setOnErrorListener(new MediaPlayer.OnErrorListener() {
            @Override
            public boolean onError(MediaPlayer mp, int what, int extra) {
                Toast.makeText(MainActivity.this, "Cette tablette ne sait pas lire ce format de vidéo", Toast.LENGTH_LONG).show();
                closeVideo();
                return true;
            }
        });
        vv.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
            @Override
            public void onCompletion(MediaPlayer mp) {
                mc.show(0);
            }
        });
        TextView close = new TextView(this);
        close.setText("✕  Fermer");
        close.setTextColor(Color.WHITE);
        close.setTextSize(18);
        close.setPadding(36, 24, 36, 24);
        close.setBackgroundColor(0x99000000);
        close.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                closeVideo();
            }
        });
        box.addView(close, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.END));
        box.setOnClickListener(new View.OnClickListener() { // toucher l'image : afficher les commandes
            @Override
            public void onClick(View v) {
                mc.show(3000);
            }
        });
        addContentView(box, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        videoBox = box;
        videoView = vv;
        vv.setVideoURI(Uri.parse(url));
    }
    void closeVideo() {
        if (videoBox == null) return;
        videoView.stopPlayback();
        ((ViewGroup) videoBox.getParent()).removeView(videoBox);
        videoBox = null;
        videoView = null;
        hideBars();
    }

    // Plein écran : barres d'état et de navigation cachées (glisser du bord pour les revoir)
    @SuppressWarnings("deprecation")
    void hideBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
    }

    // ---------- Chemins vers le PC ----------
    List<String> candidates() {
        LinkedHashSet<String> list = new LinkedHashSet<>();
        if (lastGood != null) list.add(lastGood);
        list.add(USB);
        String manual = withPort(prefs.getString("wifi", ""));
        if (manual != null) list.add(manual);
        try {
            JSONObject net = new JSONObject(prefs.getString("lan", "{}"));
            int port = net.optInt("port", PORT);
            JSONArray lan = net.optJSONArray("lan");
            if (lan != null) for (int i = 0; i < lan.length(); i++) list.add(lan.getString(i) + ":" + port);
        } catch (Exception ignored) {
        }
        return new ArrayList<>(list);
    }

    static String withPort(String h) {
        if (h == null) return null;
        h = h.trim();
        if (h.isEmpty()) return null;
        return h.contains(":") ? h : h + ":" + PORT;
    }

    // ---------- Fichiers de l'interface ----------
    WebResourceResponse serve(String path) {
        if (path == null || path.isEmpty()) path = "/";
        if (path.equals("/setup")) return asset("setup.html");

        for (String host : candidates()) {
            Fetched f = fetch(host, path);
            if (f == null) continue; // PC injoignable par ce chemin
            if (!host.equals(lastGood)) {
                lastGood = host;
                prefs.edit().putString("lastGood", host).apply();
            }
            if (f.code == 200) saveCache(path, f);
            return f.toResponse();
        }
        Fetched cached = readCache(path);
        if (cached != null) return cached.toResponse();
        if (path.equals("/") || path.equals("/index.html")) return asset("setup.html");
        return new Fetched(404, "text/plain", new byte[0]).toResponse();
    }

    static class Fetched {
        int code;
        String type;
        byte[] body;

        Fetched(int code, String type, byte[] body) {
            this.code = code;
            this.type = type == null ? "application/octet-stream" : type;
            this.body = body;
        }

        WebResourceResponse toResponse() {
            String mime = type;
            String enc = null;
            int semi = type.indexOf(';');
            if (semi >= 0) {
                mime = type.substring(0, semi).trim();
                int cs = type.toLowerCase().indexOf("charset=");
                if (cs >= 0) enc = type.substring(cs + 8).trim();
            }
            Map<String, String> headers = Collections.singletonMap("Cache-Control", "no-store");
            return new WebResourceResponse(mime, enc, code, code == 200 ? "OK" : "Error", headers,
                new ByteArrayInputStream(body));
        }
    }

    Fetched fetch(String host, String path) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://" + host + path).openConnection();
            c.setConnectTimeout(host.equals(USB) ? 1200 : 2000);
            c.setReadTimeout(6000);
            c.setUseCaches(false);
            int code = c.getResponseCode();
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            return new Fetched(code, c.getContentType(), in == null ? new byte[0] : readAll(in));
        } catch (IOException e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    // ---------- Copie locale ----------
    File cacheFile(String path, String ext) {
        String name = path.equals("/") ? "index.html" : path.substring(1).replaceAll("[^A-Za-z0-9._-]", "_");
        File dir = new File(getFilesDir(), "web");
        dir.mkdirs();
        return new File(dir, name + ext);
    }

    void saveCache(String path, Fetched f) {
        try (FileOutputStream b = new FileOutputStream(cacheFile(path, ""));
             FileOutputStream t = new FileOutputStream(cacheFile(path, ".type"))) {
            b.write(f.body);
            t.write(f.type.getBytes("UTF-8"));
        } catch (IOException ignored) {
        }
    }

    Fetched readCache(String path) {
        File b = cacheFile(path, "");
        File t = cacheFile(path, ".type");
        if (!b.exists() || !t.exists()) return null;
        try {
            return new Fetched(200, new String(readAll(new FileInputStream(t)), "UTF-8"), readAll(new FileInputStream(b)));
        } catch (IOException e) {
            return null;
        }
    }

    WebResourceResponse asset(String name) {
        try {
            return new Fetched(200, "text/html; charset=utf-8", readAll(getAssets().open(name))).toResponse();
        } catch (IOException e) {
            return null;
        }
    }

    // ---------- Pont avec l'interface (JavaScript) ----------
    class Bridge {
        @JavascriptInterface
        public String wifiHost() {
            return prefs.getString("wifi", "");
        }

        @JavascriptInterface
        public void setWifiHost(String host) {
            rememberHost(host);
            runOnUiThread(reload);
        }

        // Retient l'adresse d'un PC (trouvé par la recherche) sans recharger la page
        @JavascriptInterface
        public void rememberHost(String host) {
            String h = withPort(host);
            prefs.edit().putString("wifi", host == null ? "" : host.trim()).putString("lastGood", h).apply();
            if (h != null) lastGood = h;
        }

        @JavascriptInterface
        public int appVersionCode() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                return Build.VERSION.SDK_INT >= 28 ? (int) info.getLongVersionCode() : info.versionCode;
            } catch (Exception e) {
                return 0;
            }
        }

        // Dictée / commande vocale : reconnaissance vocale du téléphone (Google), réponse dans window.onNativeSpeech(texte)
        @JavascriptInterface
        public void listen() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "fr-FR");
                    i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Je t'écoute…");
                    try {
                        startActivityForResult(i, SPEECH);
                    } catch (Exception e) {
                        speech(null);
                    }
                }
            });
        }

        // Fichier du PC enregistré dans « Téléchargements » du téléphone (l'adresse contient le laissez-passer)
        @JavascriptInterface
        public void download(String url, String name) {
            try {
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                r.setTitle(name);
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "Téléchargement impossible : " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }

        // Vidéo du PC lue dans l'appli, par les décodeurs de la tablette (4K HEVC des drones / téléphones, MKV…)
        @JavascriptInterface
        public void playVideo(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.playVideo(url);
                }
            });
        }

        @JavascriptInterface
        public void installUpdate() {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.installUpdate();
                }
            }).start();
        }

        // Code venu d'un QR code (pcdeck://pair?...), donné une seule fois à l'interface
        @JavascriptInterface
        public String takePairCode() {
            String c = pendingCode;
            pendingCode = null;
            return c == null ? "" : c;
        }

        // Cherche les PC qui font tourner PC Deck sur le Wi-Fi (environ 1,5 s).
        // Renvoie [{"name":"PC-SALON","host":"192.168.1.24:8787"}, ...]
        @JavascriptInterface
        public String discover() {
            JSONArray out = new JSONArray();
            LinkedHashSet<String> seen = new LinkedHashSet<>();
            DatagramSocket s = null;
            try {
                s = new DatagramSocket();
                s.setBroadcast(true);
                s.setSoTimeout(300);
                byte[] q = "PCDECK?".getBytes("UTF-8");
                s.send(new DatagramPacket(q, q.length, InetAddress.getByName("255.255.255.255"), PORT));
                byte[] buf = new byte[1024];
                long end = System.currentTimeMillis() + 1500;
                while (System.currentTimeMillis() < end) {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    try {
                        s.receive(p);
                    } catch (SocketTimeoutException e) {
                        continue;
                    }
                    try {
                        JSONObject r = new JSONObject(new String(p.getData(), 0, p.getLength(), "UTF-8"));
                        if (!"pcdeck".equals(r.optString("app"))) continue;
                        String host = p.getAddress().getHostAddress() + ":" + r.optInt("port", PORT);
                        if (!seen.add(host)) continue;
                        out.put(new JSONObject().put("name", r.optString("name", "PC")).put("host", host));
                    } catch (Exception ignored) {
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (s != null) s.close();
            }
            return out.toString();
        }

        // Allume le PC à distance (Wake-on-LAN) : « paquet magique » envoyé sur le Wi-Fi.
        // macs : adresses des cartes réseau du PC, séparées par des virgules (ex. "a1:b2:c3:d4:e5:f6").
        @JavascriptInterface
        public boolean wake(String macs) {
            boolean sent = false;
            DatagramSocket s = null;
            try {
                s = new DatagramSocket();
                s.setBroadcast(true);
                for (String mac : macs.split(",")) {
                    String[] hex = mac.trim().split("[:-]");
                    if (hex.length != 6) continue;
                    byte[] p = new byte[102];
                    for (int i = 0; i < 6; i++) p[i] = (byte) 0xff;
                    for (int i = 6; i < 102; i++) p[i] = (byte) Integer.parseInt(hex[(i - 6) % 6], 16);
                    for (int port : new int[] { 9, 7 }) s.send(new DatagramPacket(p, p.length, InetAddress.getByName("255.255.255.255"), port));
                    sent = true;
                }
            } catch (Exception ignored) {
            } finally {
                if (s != null) s.close();
            }
            return sent;
        }

        @JavascriptInterface
        public void setLan(String json) {
            prefs.edit().putString("lan", json == null ? "{}" : json).apply();
        }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(reload);
        }
    }
}
