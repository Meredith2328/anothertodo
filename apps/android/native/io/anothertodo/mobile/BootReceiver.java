package io.anothertodo.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        try { AlarmReceiver.schedule(context); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
}
