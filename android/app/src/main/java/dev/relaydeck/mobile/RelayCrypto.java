package dev.relaydeck.mobile;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.security.KeyFactory;

/** P-256 ECDH, HKDF and AES-GCM for the relay data plane. */
final class RelayCrypto {
    private RelayCrypto() {}

    static KeyPair ephemeral() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new java.security.spec.ECGenParameterSpec("secp256r1"));
        return generator.generateKeyPair();
    }

    static String publicKey(KeyPair pair) {
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(pair.getPublic().getEncoded());
    }

    static PublicKey parsePublic(String value) throws Exception {
        return KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(java.util.Base64.getUrlDecoder().decode(value)));
    }

    static PrivateKey parsePrivate(String value) throws Exception {
        return KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(java.util.Base64.getUrlDecoder().decode(value)));
    }

    static String fingerprint(String publicKey) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(java.util.Base64.getUrlDecoder().decode(publicKey)));
    }

    static boolean verify(String publicKey, String message, String signature) {
        try {
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(parsePublic(publicKey));
            verifier.update(message.getBytes(StandardCharsets.UTF_8));
            return verifier.verify(java.util.Base64.getUrlDecoder().decode(signature));
        } catch (Exception ignored) {
            return false;
        }
    }

    static byte[][] sessionKeys(KeyPair ours, String peerPublic, String machineId, String machineNonce, String deviceNonce) throws Exception {
        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(ours.getPrivate());
        agreement.doPhase(parsePublic(peerPublic), true);
        byte[] secret = agreement.generateSecret();
        boolean machineFirst = machineNonce.compareTo(deviceNonce) < 0;
        String salt = machineFirst ? machineNonce + ":" + deviceNonce : deviceNonce + ":" + machineNonce;
        byte[] material = hkdf(secret, salt.getBytes(StandardCharsets.UTF_8), ("relaydeck-relay:" + machineId).getBytes(StandardCharsets.UTF_8), 64);
        return new byte[][] { Arrays.copyOfRange(material, 0, 32), Arrays.copyOfRange(material, 32, 64) };
    }

    static byte[] seal(byte[] key, byte[] plaintext, long sequence) throws Exception {
        byte[] nonce = new byte[12];
        new java.security.SecureRandom().nextBytes(nonce);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        cipher.updateAAD(("relaydeck-relay-v1:" + sequence).getBytes(StandardCharsets.UTF_8));
        byte[] body = cipher.doFinal(plaintext);
        ByteArrayOutputStream result = new ByteArrayOutputStream(1 + 12 + body.length);
        result.write(1); result.write(nonce); result.write(body);
        return result.toByteArray();
    }

    static byte[] open(byte[] key, byte[] frame, long sequence) throws Exception {
        if (frame == null || frame.length < 29 || frame[0] != 1) throw new Exception("Relay 数据帧格式无效");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, Arrays.copyOfRange(frame, 1, 13)));
        cipher.updateAAD(("relaydeck-relay-v1:" + sequence).getBytes(StandardCharsets.UTF_8));
        return cipher.doFinal(Arrays.copyOfRange(frame, 13, frame.length));
    }

    static String signHandshake(PrivateKey key, String machineId, String runtimeId, String machinePublic, String ephemeralPublic, String nonce) throws Exception {
        Signature signer = Signature.getInstance("SHA256withECDSA");
        signer.initSign(key);
        signer.update(handshakeMessage(machineId, runtimeId, machinePublic, ephemeralPublic, nonce).getBytes(StandardCharsets.UTF_8));
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(signer.sign());
    }

    static String handshakeMessage(String machineId, String runtimeId, String machinePublic, String ephemeralPublic, String nonce) {
        return "relaydeck-relay-v1\n" + 1 + "\n" + machineId + "\n" + runtimeId + "\n" + machinePublic + "\n" + ephemeralPublic + "\n" + nonce;
    }

    private static byte[] hkdf(byte[] secret, byte[] salt, byte[] info, int length) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(salt.length == 0 ? new byte[32] : salt, "HmacSHA256"));
        byte[] prk = mac.doFinal(secret);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] prior = new byte[0];
        for (int counter = 1; output.size() < length; counter++) {
            mac.init(new SecretKeySpec(prk, "HmacSHA256"));
            mac.update(prior); mac.update(info); mac.update((byte) counter);
            prior = mac.doFinal();
            output.write(prior);
        }
        return Arrays.copyOf(output.toByteArray(), length);
    }

    private static String hex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format(java.util.Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }

    static JSONObject parse(String value) {
        try { return new JSONObject(value); } catch (Exception ignored) { return null; }
    }
}
