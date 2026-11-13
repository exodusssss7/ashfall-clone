package com.exodus.ashfall;
import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import java.io.IOException;

public class MainActivity extends Activity {
 private WebView game;
 @Override public void onCreate(Bundle state) {
  super.onCreate(state);
  getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_STABLE|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
  game=new WebView(this);
  game.setBackgroundColor(0xff0b0d0e);
  game.getSettings().setJavaScriptEnabled(true);
  game.getSettings().setDomStorageEnabled(true);
  game.getSettings().setMediaPlaybackRequiresUserGesture(true);
  game.getSettings().setAllowFileAccess(false);
  game.getSettings().setAllowContentAccess(false);
  game.setWebChromeClient(new WebChromeClient());
  // Local HTTPS origin makes module scripts, assets and storage behave like
  // the browser build, without a server or internet permission.
  game.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
    if(!"appassets.androidplatform.net".equals(request.getUrl().getHost()))return new WebResourceResponse("text/plain","UTF-8",null);
    String path=request.getUrl().getPath();
    if(path==null||path.equals("/"))path="/index.html";
    if(path.contains(".."))return new WebResourceResponse("text/plain","UTF-8",null);
    String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".svg")?"image/svg+xml":path.endsWith(".woff2")?"font/woff2":path.endsWith(".ttf")?"font/ttf":path.endsWith(".mp3")?"audio/mpeg":path.endsWith(".txt")?"text/plain":"text/html";
    try{return new WebResourceResponse(mime,"UTF-8",getAssets().open(path.substring(1)));}catch(IOException ex){return new WebResourceResponse("text/plain","UTF-8",null);}
   }
  });
  WebView.setWebContentsDebuggingEnabled(false);
  setContentView(game);
  game.loadUrl("https://appassets.androidplatform.net/index.html?touch=1");
 }
 @Override public void onBackPressed(){game.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true}))",null);}
}
