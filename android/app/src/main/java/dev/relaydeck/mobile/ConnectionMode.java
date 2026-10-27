package dev.relaydeck.mobile;

/** UI and lifecycle rules for mutually exclusive connection modes. */
final class ConnectionMode {
    static final String LAN = "lan";
    static final String EASYTIER = "easytier";
    static final String RELAY = "relay";

    private ConnectionMode() {}

    static String normalize(String value) {
        return RELAY.equals(value) || EASYTIER.equals(value) ? value : LAN;
    }

    static boolean usesEasyTier(String value) {
        return EASYTIER.equals(normalize(value));
    }

    static boolean requiresVpn(String value) {
        return usesEasyTier(value);
    }

    static boolean shouldShowEasyTierSetup(String value, boolean hasPairing) {
        return !hasPairing && usesEasyTier(value);
    }

    static boolean shouldShowPairingScanner(String value) {
        return !RELAY.equals(normalize(value));
    }
}
