package ai.naryad.lan;

import android.app.*;
import android.os.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.*;
import android.net.nsd.*;
import android.net.wifi.WifiManager;
import android.print.PrintManager;
import android.speech.RecognizerIntent;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Native LAN discovery around the shared demo. No cloud server or IP baked into the APK. */
public final class MainActivity extends Activity {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private LinearLayout root, content;
    private TextView status;
    private WebView web;
    private NsdManager nsd;
    private NsdManager.DiscoveryListener discovery;
    private WifiManager.MulticastLock multicast;
    private final ArrayDeque<NsdServiceInfo> resolveQueue = new ArrayDeque<>();
    private boolean resolving, destroyed, connected;
    private int generation;
    private String origin = "", voiceTarget = "", preferredServer = "";
    private final LinkedHashSet<String> candidates = new LinkedHashSet<>();
    private final HashSet<String> discoveredNames = new HashSet<>();
    private boolean choiceShown;
    private Uri cameraUri;
    private File cameraFile;
    private ValueCallback<Uri[]> fileResult;
    private byte[] exportBytes;
    private static final int FILE = 10, EXPORT = 11, VOICE = 12, LOCAL = 13;
    private static final String LAN_PERMISSION = "android.permission.ACCESS_LOCAL_NETWORK";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new LinearLayout(this); root.setOrientation(1); root.setBackgroundColor(0xfff4f5ef);
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets b = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(b.left,b.top,b.right,b.bottom); return insets;
            });
        }
        nsd = (NsdManager)getSystemService(NSD_SERVICE);
        if (Build.VERSION.SDK_INT >= 37 && checkSelfPermission(LAN_PERMISSION) != PackageManager.PERMISSION_GRANTED) {
            searchingScreen("Разрешите доступ к локальной сети для поиска ноутбука.");
            requestPermissions(new String[]{LAN_PERMISSION}, LOCAL);
        } else search();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView label(String text, int size) {
        TextView v = new TextView(this); v.setText(text); v.setTextSize(size); v.setTextColor(0xff18201d);
        v.setPadding(dp(20),dp(12),dp(20),dp(12)); return v;
    }
    private Button button(String text, Runnable action) {
        Button b = new Button(this); b.setText(text); b.setAllCaps(false); b.setMinHeight(dp(48));
        b.setOnClickListener(v -> action.run()); return b;
    }
    private void searchingScreen(String message) {
        if(web!=null) { web.removeJavascriptInterface("NaryadAndroid"); web.destroy(); web=null; }
        root.removeAllViews();
        root.addView(label("НарядAI · Wi-Fi",28));
        root.addView(label("Общая смена на всех устройствах",16));
        content = new LinearLayout(this); content.setOrientation(1); content.setPadding(dp(16),dp(20),dp(16),0);
        root.addView(content);
        status=label(message,18); content.addView(status);
        content.addView(label("1. Подключитесь к Wi-Fi ноутбука.\n2. На ноутбуке запустите Start-LAN.\n3. Приложение найдёт сервер автоматически.",16));
        content.addView(button("Найти ещё раз",this::search));
        content.addView(button("Указать адрес вручную",this::manual));
    }
    private void search() {
        if (destroyed) return;
        if (Build.VERSION.SDK_INT >=37 && checkSelfPermission(LAN_PERMISSION)!=PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{LAN_PERMISSION},LOCAL); return;
        }
        connected=false; stopDiscovery(); candidates.clear(); discoveredNames.clear(); choiceShown=false; final int gen=++generation;
        searchingScreen("Ищем сервер в Wi-Fi…");
        preferredServer=getPreferences(0).getString("server","");
        if(!preferredServer.isEmpty()) probe(preferredServer,gen);
        try {
            WifiManager wifi=(WifiManager)getApplicationContext().getSystemService(WIFI_SERVICE);
            multicast=wifi.createMulticastLock("naryadai-discovery"); multicast.setReferenceCounted(false); multicast.acquire();
            discovery=new NsdManager.DiscoveryListener() {
                public void onDiscoveryStarted(String s) {}
                public void onDiscoveryStopped(String s) {}
                public void onServiceLost(NsdServiceInfo s) {}
                public void onStartDiscoveryFailed(String s,int e) { ui.post(() -> discoveryMessage(gen)); }
                public void onStopDiscoveryFailed(String s,int e) {}
                public void onServiceFound(NsdServiceInfo s) { ui.post(() -> {
                    if(gen!=generation || connected)return;
                    if(s.getServiceType().startsWith("_naryadai._tcp")) { discoveredNames.add(s.getServiceName()); resolveQueue.add(s); resolveNext(gen); }
                }); }
            };
            nsd.discoverServices("_naryadai._tcp.",NsdManager.PROTOCOL_DNS_SD,discovery);
        } catch(Exception e) { discoveryMessage(gen); }
        ui.postDelayed(() -> discoveryMessage(gen),12000);
        ui.postDelayed(() -> {if(!destroyed && gen==generation && !connected && !choiceShown)search();},20000);
    }
    private void discoveryMessage(int gen) {
        if(gen==generation && !connected && status!=null)
            status.setText("Сервер пока не найден. Проверьте запуск Start-LAN и общую Wi-Fi-сеть. Поиск продолжается.");
    }
    @SuppressWarnings("deprecation") private void resolveNext(int gen) {
        if(resolving || resolveQueue.isEmpty() || gen!=generation || connected) return;
        resolving=true;
        nsd.resolveService(resolveQueue.remove(),new NsdManager.ResolveListener() {
            public void onResolveFailed(NsdServiceInfo s,int e) { ui.post(() -> {resolving=false;resolveNext(gen);}); }
            public void onServiceResolved(NsdServiceInfo s) { ui.post(() -> {
                resolving=false;
                if(gen==generation && !connected && s.getHost()!=null) {
                    String host=s.getHost().getHostAddress();
                    probe("http://"+(host.contains(":")?"["+host+"]":host)+":"+s.getPort(),gen);
                }
                resolveNext(gen);
            }); }
        });
    }
    private void stopDiscovery() {
        if(discovery!=null) {try{nsd.stopServiceDiscovery(discovery);}catch(Exception ignored){} discovery=null;}
        if(multicast!=null) {try{if(multicast.isHeld())multicast.release();}catch(Exception ignored){} multicast=null;}
        resolveQueue.clear(); resolving=false;
    }
    private static boolean privateAddress(InetAddress a) {
        byte[] bytes=a.getAddress();
        return a.isSiteLocalAddress() || a.isLoopbackAddress() || (bytes.length==16 && (bytes[0]&0xfe)==0xfc);
    }
    private void probe(String candidate,int gen) {
        io.execute(() -> {
            HttpURLConnection c=null;
            try {
                URI u=new URI(candidate);
                if(!"http".equals(u.getScheme()) || u.getHost()==null || u.getRawUserInfo()!=null || u.getRawQuery()!=null || u.getRawFragment()!=null || (u.getPath()!=null&&!u.getPath().isEmpty()&&!u.getPath().equals("/"))) throw new IOException("Адрес должен иметь вид http://192.168.1.10:8788");
                InetAddress[] addresses=InetAddress.getAllByName(u.getHost());
                for(InetAddress address:addresses) if(!privateAddress(address)) throw new IOException("Нужен адрес локальной Wi-Fi-сети");
                String base="http://"+u.getRawAuthority();
                c=(HttpURLConnection)new URL(base+"/api/lan-discovery").openConnection();
                c.setConnectTimeout(3000);c.setReadTimeout(3000);c.setInstanceFollowRedirects(false);
                if(c.getResponseCode()!=200)throw new IOException("Запустите Start-LAN на ноутбуке");
                ByteArrayOutputStream out=new ByteArrayOutputStream();
                try(InputStream in=c.getInputStream()){ byte[] b=new byte[1024];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>8192)throw new IOException();}}
                JSONObject obj=new JSONObject(out.toString("UTF-8"));
                if(!"naryadai".equals(obj.optString("app")) || obj.optInt("protocol")!=1 || !"shared-lan-demo".equals(obj.optString("mode")))throw new IOException("Это не сервер НарядAI Wi-Fi");
                ui.post(() -> {
                    if(destroyed || gen!=generation || connected)return;
                    if(base.equals(preferredServer)){open(base);return;}
                    candidates.add(base);
                    if(candidates.size()>1 || discoveredNames.size()>1)showChoices(gen);
                    else ui.postDelayed(() -> {
                        if(destroyed || gen!=generation || connected)return;
                        if(candidates.size()==1 && discoveredNames.size()<=1)open(candidates.iterator().next());
                        else showChoices(gen);
                    },3500);
                });
            } catch(Exception e) { ui.post(() -> {if(gen==generation&&!connected&&status!=null)status.setText("Ищем сервер… "+(e.getMessage()==null?"Проверьте сеть":e.getMessage()));}); }
            finally {if(c!=null)c.disconnect();}
        });
    }
    private void showChoices(int gen) {
        if(gen!=generation || connected || candidates.isEmpty())return;
        choiceShown=true;
        content.removeAllViews();
        status=label("Найдено несколько серверов. Выберите ноутбук мастера:",18);content.addView(status);
        for(String candidate:candidates)content.addView(button(candidate,()->{if(gen==generation)open(candidate);}));
        content.addView(label("Все телефоны должны выбрать один сервер. Выбор запомнится.",15));
        content.addView(button("Повторить поиск",this::search));
    }
    private void manual() {
        EditText input=new EditText(this); input.setSingleLine(true); input.setInputType(17);
        input.setText(getPreferences(0).getString("server","http://"));
        new AlertDialog.Builder(this).setTitle("Адрес ноутбука").setMessage("Адрес показан в окне Start-LAN. Например: http://192.168.1.10:8788")
            .setView(input).setNegativeButton("Отмена",null).setPositiveButton("Подключиться",(d,w)->probe(input.getText().toString().trim().replaceAll("/$",""),generation)).show();
    }
    private boolean sameServer(String value) {
        try {URI a=new URI(origin),b=new URI(value);return a.getScheme().equals(b.getScheme())&&a.getHost().equals(b.getHost())&&a.getPort()==b.getPort();}catch(Exception e){return false;}
    }
    @SuppressWarnings("deprecation") private void open(String base) {
        connected=true; stopDiscovery(); origin=base; getPreferences(0).edit().putString("server",base).apply();
        root.removeAllViews();
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);bar.setBackgroundColor(0xffe5efb7);
        TextView title=label("НарядAI · Wi-Fi",15);bar.addView(title,new LinearLayout.LayoutParams(0,dp(52),1));
        bar.addView(button("↻",()->{if(web!=null)web.reload();}),new LinearLayout.LayoutParams(dp(52),dp(52)));
        bar.addView(button("Сервер",()->{getPreferences(0).edit().remove("server").apply();search();}));root.addView(bar);
        web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setMediaPlaybackRequiresUserGesture(true);
        android.webkit.CookieManager.getInstance().setAcceptCookie(true);android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.addJavascriptInterface(new Bridge(),"NaryadAndroid");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){
                if(sameServer(r.getUrl().toString()))return false;
                if(r.isForMainFrame()&&r.hasGesture()&&("https".equals(r.getUrl().getScheme())||"http".equals(r.getUrl().getScheme()))) {
                    try{startActivity(new Intent(Intent.ACTION_VIEW,r.getUrl()));}catch(Exception ignored){}
                }return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                String scheme=r.getUrl().getScheme();
                if(("http".equals(scheme)||"https".equals(scheme))&&!sameServer(r.getUrl().toString()))
                    return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
                return null;
            }
            @Override public void onPageFinished(WebView v,String url){if(!destroyed && connected && v==web && sameServer(url))inject();}
            @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){
                if(r.isForMainFrame()) ui.post(()->{if(!destroyed)search();});
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> callback,FileChooserParams p){
                if(fileResult!=null)fileResult.onReceiveValue(null);fileResult=callback;
                Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("image/*");i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,p.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                try{
                    cameraFile=new File(getCacheDir(),"capture-"+System.currentTimeMillis()+".jpg");
                    cameraUri=Uri.parse("content://ai.naryad.lan.files/"+cameraFile.getName());
                    Intent camera=new Intent("android.media.action.IMAGE_CAPTURE");camera.putExtra("output",cameraUri);
                    camera.setClipData(ClipData.newRawUri("Фото",cameraUri));camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    Intent chooser=Intent.createChooser(i,"Фотография для наряда");
                    if(camera.resolveActivity(getPackageManager())!=null)chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS,new Intent[]{camera});
                    startActivityForResult(chooser,FILE);
                }catch(Exception e){fileResult.onReceiveValue(null);fileResult=null;}return true;
            }
        });
        web.setDownloadListener((url,ua,disposition,mime,length)->{
            if(url.startsWith("blob:"))web.evaluateJavascript("window.__naryadExport("+JSONObject.quote(url)+",'naryadai-export.xlsx')",null);
        });
        web.loadUrl(base+"/demo");
    }
    private void inject(){
        web.evaluateJavascript("(function(){if(window.__naryadNative)return;window.__naryadNative=true;window.print=function(){NaryadAndroid.printPage()};window.__naryadExport=async function(u,n){try{const b=await(await fetch(u)).blob();if(b.size>12582912)throw Error('Файл слишком большой');const r=new FileReader();r.onload=()=>NaryadAndroid.saveFile(String(n||'export.xlsx'),String(b.type||'application/octet-stream'),String(r.result).split(',')[1]);r.readAsDataURL(b)}catch(e){alert('Не удалось сохранить файл: '+e.message)}};document.addEventListener('click',function(e){const a=e.target.closest&&e.target.closest('a[download]');if(a&&a.href.startsWith('blob:')){e.preventDefault();e.stopImmediatePropagation();window.__naryadExport(a.href,a.download)}},true)})()",null);
    }
    public final class Bridge {
        @JavascriptInterface public void printPage(){ui.post(()->{if(web!=null)((PrintManager)getSystemService(PRINT_SERVICE)).print("НарядAI",web.createPrintDocumentAdapter("НарядAI"),null);});}
        @JavascriptInterface public void saveFile(String name,String mime,String data){
            if(data==null||data.length()>16777216)return;
            ui.post(()->{
                if(exportBytes!=null){Toast.makeText(MainActivity.this,"Завершите сохранение предыдущего файла",Toast.LENGTH_SHORT).show();return;}
                try{exportBytes=android.util.Base64.decode(data,android.util.Base64.DEFAULT);
                    Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(mime.contains("spreadsheet")?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/octet-stream");
                    i.putExtra(Intent.EXTRA_TITLE,name.replaceAll("[\\\\/:*?\"<>|]","_").substring(0,Math.min(name.length(),120)));startActivityForResult(i,EXPORT);
                }catch(Exception e){exportBytes=null;Toast.makeText(MainActivity.this,"Не удалось открыть сохранение",Toast.LENGTH_SHORT).show();}
            });
        }
        @JavascriptInterface public void startVoice(String target,String lang){ui.post(()->{
            voiceTarget=target;
            Intent i=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE,lang);i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE,true);
            try{startActivityForResult(i,VOICE);}catch(Exception e){voiceResult("");Toast.makeText(MainActivity.this,"На телефоне не установлен сервис распознавания речи",Toast.LENGTH_LONG).show();}
        });}
    }
    private void voiceResult(String text){if(web!=null)web.evaluateJavascript("window.dispatchEvent(new CustomEvent('naryad-native-voice',{detail:{target:"+JSONObject.quote(voiceTarget)+",text:"+JSONObject.quote(text)+"}}))",null);}
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==FILE&&fileResult!=null){
            ArrayList<Uri> urls=new ArrayList<>();if(result==RESULT_OK&&data!=null){if(data.getClipData()!=null)for(int n=0;n<data.getClipData().getItemCount();n++)urls.add(data.getClipData().getItemAt(n).getUri());else if(data.getData()!=null)urls.add(data.getData());}
            if(result==RESULT_OK && urls.isEmpty() && cameraFile!=null && cameraFile.length()>0)urls.add(cameraUri);
            fileResult.onReceiveValue(urls.isEmpty()?null:urls.toArray(new Uri[0]));fileResult=null;cameraUri=null;cameraFile=null;
        }else if(request==EXPORT){
            byte[] bytes=exportBytes;exportBytes=null;
            if(result==RESULT_OK&&data!=null&&data.getData()!=null&&bytes!=null){Uri uri=data.getData();io.execute(()->{try(OutputStream out=getContentResolver().openOutputStream(uri)){if(out==null)throw new IOException();out.write(bytes);ui.post(()->Toast.makeText(this,"Файл сохранён",Toast.LENGTH_SHORT).show());}catch(Exception e){ui.post(()->Toast.makeText(this,"Ошибка сохранения файла",Toast.LENGTH_LONG).show());}});}
        }else if(request==VOICE){ArrayList<String> text=data==null?null:data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);voiceResult(result==RESULT_OK&&text!=null&&!text.isEmpty()?text.get(0):"");}
    }
    @Override public void onRequestPermissionsResult(int request,String[] p,int[] result){super.onRequestPermissionsResult(request,p,result);if(request==LOCAL){if(result.length>0&&result[0]==PackageManager.PERMISSION_GRANTED)search();else searchingScreen("Доступ к локальной сети не разрешён. Разрешите его в настройках приложения и повторите поиск.");}}
    @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onDestroy(){destroyed=true;++generation;stopDiscovery();if(fileResult!=null)fileResult.onReceiveValue(null);if(web!=null)web.destroy();io.shutdownNow();super.onDestroy();}
}
