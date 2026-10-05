package com.school.portal

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.school.portal.ui.nav.PortalApp
import com.school.portal.ui.theme.SchoolPortalTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as PortalApplication).container
        setContent {
            SchoolPortalTheme {
                PortalApp(container)
            }
        }
    }
}
