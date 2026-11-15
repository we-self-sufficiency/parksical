package com.parksical.data.remote

/** Tiny JSON reader for tests (android.jar's org.json is stubbed in JVM unit tests). Numbers: Long or Double. */
internal class MiniJson(private val s: String) {
    private var i = 0

    fun parse(): Any? = value().also { ws(); check(i == s.length) }

    private fun ws() { while (i < s.length && s[i].isWhitespace()) i++ }

    private fun value(): Any? {
        ws()
        return when (val c = s[i]) {
            '{' -> { i++; val m = linkedMapOf<String, Any?>(); ws(); if (s[i] == '}') { i++; return m }
                do { ws(); val k = str(); ws(); i++; m[k] = value(); ws() } while (s[i++] == ','); m }
            '[' -> { i++; val l = mutableListOf<Any?>(); ws(); if (s[i] == ']') { i++; return l }
                do { l += value(); ws() } while (s[i++] == ','); l }
            '"' -> str()
            't' -> { i += 4; true }
            'f' -> { i += 5; false }
            'n' -> { i += 4; null }
            else -> { val st = i; while (i < s.length && (s[i].isDigit() || s[i] in "+-.eE")) i++
                val n = s.substring(st, i); check(c == '-' || c.isDigit()); n.toLongOrNull() ?: n.toDouble() }
        }
    }

    private fun str(): String {
        i++ // opening quote
        val b = StringBuilder()
        while (s[i] != '"') { if (s[i] == '\\') i++; b.append(s[i++]) }
        i++
        return b.toString()
    }
}

@Suppress("UNCHECKED_CAST")
internal fun parseJson(s: String) = MiniJson(s).parse() as Map<String, Any?>
