package com.parksical

import android.app.Application
import com.kakao.vectormap.KakaoMapSdk

class ParksicalApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.KAKAO_NATIVE_APP_KEY.isNotEmpty()) KakaoMapSdk.init(this, BuildConfig.KAKAO_NATIVE_APP_KEY)
        container = AppContainer(this)
        container.drive.start()
    }
}
