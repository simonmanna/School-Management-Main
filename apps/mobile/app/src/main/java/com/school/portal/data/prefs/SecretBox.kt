package com.school.portal.data.prefs

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypts the few strings that must not sit in cleartext on a shared phone —
 * the access and refresh tokens, chiefly.
 *
 * Written directly against the platform keystore rather than using
 * androidx.security:security-crypto, which is deprecated and no longer
 * maintained. The key never leaves the keystore: what lands in preferences is
 * an IV and a ciphertext, so reading the prefs file off the device (adb backup,
 * a pulled userdata image, another app on a rooted handset) yields nothing
 * usable.
 *
 * AES-GCM gives authentication as well as secrecy, so a tampered value fails to
 * decrypt rather than decrypting to something attacker-chosen. A fresh IV per
 * write is mandatory for GCM and is stored alongside the ciphertext.
 */
internal object SecretBox {

    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "school-portal-session-v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128

    /** Encrypt, or return null if the keystore is unusable on this device. */
    fun seal(plaintext: String): String? = runCatching {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val body = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        "${encode(cipher.iv)}:${encode(body)}"
    }.getOrNull()

    /**
     * Decrypt. Null covers every way this legitimately fails: a value written
     * before the key was reset (a restored backup, a cleared keystore), a
     * truncated string, or a tampered ciphertext. The caller treats all three
     * the same way — as "not signed in" — because none of them can be recovered
     * from, and a crash on launch would be the only alternative.
     */
    fun open(sealed: String?): String? {
        val parts = sealed?.split(':') ?: return null
        if (parts.size != 2) return null
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, decode(parts[0])))
            String(cipher.doFinal(decode(parts[1])), Charsets.UTF_8)
        }.getOrNull()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                // Deliberately NOT requiring device unlock: a pupil's phone with
                // no screen lock must still be able to hold a session, and the
                // threat this defends against is offline inspection of the prefs
                // file, not an unlocked phone in someone else's hands.
                .build(),
        )
        return generator.generateKey()
    }

    private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun decode(text: String): ByteArray = Base64.decode(text, Base64.NO_WRAP)
}
