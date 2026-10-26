package com.voicenotesummarizer.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareReceiverPlugin.class);
        super.onCreate(savedInstanceState);
        // App opened from the share menu (cold start)
        ShareReceiverPlugin.receive(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // App already open and another voice note was shared
        ShareReceiverPlugin.receive(this, intent);
    }
}
