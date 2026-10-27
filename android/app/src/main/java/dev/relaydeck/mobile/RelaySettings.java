package dev.relaydeck.mobile;

import org.json.JSONObject;

/** Safe Relay connection metadata for the phone settings UI. */
final class RelaySettings {
    private RelaySettings() {}

    static boolean isRelay(JSONObject connection) {
        return connection != null && ConnectionMode.RELAY.equals(connection.optString("networkMode"));
    }

    static String relayUrl(JSONObject connection) {
        JSONObject relay = connection == null ? null : connection.optJSONObject("relay");
        return relay == null ? "" : relay.optString("url");
    }

    static String machineId(JSONObject connection) {
        JSONObject relay = connection == null ? null : connection.optJSONObject("relay");
        return relay == null ? "" : relay.optString("machineId");
    }

    static String machineFingerprint(JSONObject connection) {
        JSONObject relay = connection == null ? null : connection.optJSONObject("relay");
        return relay == null ? "" : relay.optString("machineFingerprint").toLowerCase(java.util.Locale.ROOT);
    }

    static boolean hasCredential(JSONObject connection) {
        JSONObject relay = connection == null ? null : connection.optJSONObject("relay");
        return relay != null && !relay.optString("credential").isEmpty();
    }

    static String shortMachineId(String value) {
        String text = value == null ? "" : value.trim();
        return text.length() <= 12 ? text : text.substring(0, 8) + "…" + text.substring(text.length() - 4);
    }

    static String fingerprintLabel(String value) {
        String text = value == null ? "" : value.replaceAll("\\s", "").toLowerCase(java.util.Locale.ROOT);
        if (!text.matches("[a-f0-9]{64}")) return "未验证";
        return text.substring(0, 8) + " " + text.substring(8, 16) + " … " + text.substring(56);
    }
}
