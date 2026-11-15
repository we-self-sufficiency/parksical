package com.parksical.ui.common

import androidx.compose.runtime.compositionLocalOf

/** Non-null while the app shows mock data because the server is unreachable. Null in previews and server mode. */
class MockInfo(val reason: String, val retry: () -> Unit)

val LocalMockInfo = compositionLocalOf<MockInfo?> { null }
